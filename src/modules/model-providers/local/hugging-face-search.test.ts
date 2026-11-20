// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { searchHuggingFace } from './hugging-face-search';
const query = (suffix = '') => new URLSearchParams('discover=1' + suffix);
const model = { id: 'publisher/image-model', pipeline_tag: 'text-to-image', downloads: 12, likes: 3, tags: ['gguf', 'license:apache-2.0'], gated: false };
function fixture(data: unknown = [model], headers: Record<string, string> = {}, status = 200) {
  const dispose = vi.fn();
  const transport = vi.fn(async (_url: URL, _options: unknown) => ({ status, headers, body: (async function* () { yield Buffer.from(JSON.stringify(data)); })(), dispose }));
  return { transport, dispose };
}
it('queries a fixed public metadata endpoint and returns only bounded presentation fields', async () => {
  const { transport, dispose } = fixture([{ ...model, secret: 'hidden', command: 'evil' }]);
  const page = await searchHuggingFace(query('&search=flux%26owner%3Devil&format=gguf'), transport);
  const url = transport.mock.calls[0][0] as URL;
  expect(url.origin + url.pathname).toBe('https://huggingface.co/api/models');
  expect(url.searchParams.get('search')).toBe('flux&owner=evil');
  expect(url.searchParams.get('filter')).toBe('gguf');
  expect(url.searchParams.has('owner')).toBe(false);
  expect(page.models[0]).toEqual({ id: model.id, author: 'publisher', name: 'image-model', downloads: 12, likes: 3, task: 'text-to-image', format: 'GGUF', license: 'apache-2.0', gated: false });
  expect(dispose).toHaveBeenCalledOnce();
});
it('rejects arbitrary destinations, injected query modes, tasks and unbounded cursors before network access', async () => {
  const { transport } = fixture();
  for (const suffix of ['&url=https://localhost', '&search=a&search=b', '&search=' + 'x'.repeat(121), '&cursor=https://example.com', '&cursor=' + 'x'.repeat(2049), '&task=text-generation', '&format=exe', '&search=%00']) {
    await expect(searchHuggingFace(query(suffix), transport)).rejects.toMatchObject({ status: 400 });
  }
  expect(transport).not.toHaveBeenCalled();
});
it('skips private, disabled, invalid repositories and other task types', async () => {
  const { transport } = fixture([model, { ...model, private: true }, { ...model, disabled: true }, { ...model, id: '../../bad' }, { ...model, pipeline_tag: 'text-generation' }]);
  expect((await searchHuggingFace(query(), transport)).models).toHaveLength(1);
});
it('extracts only opaque pagination tokens and never follows Link destinations', async () => {
  for (const [link, expected] of [['<https://huggingface.co/api/models?cursor=abc123%3D>; rel="next"', 'abc123='], ['<https://127.0.0.1/api/models?cursor=evil>; rel="next"', null], ['<https://huggingface.co/evil?cursor=evil>; rel="next"', null]]) {
    const { transport } = fixture([model], { link: link! });
    expect((await searchHuggingFace(query(), transport)).nextCursor).toBe(expected);
    expect(transport).toHaveBeenCalledTimes(1);
  }
});
it('rejects redirects, oversized/encoded responses and excessive result counts, disposing each response', async () => {
  for (const [headers, status, body] of [[{}, 302, []], [{ 'content-length': '1048577' }, 200, []], [{ 'content-encoding': 'gzip' }, 200, []], [{}, 200, Array(13).fill(model)], [{}, 200, ['x'.repeat(1024 * 1024)]]] as const) {
    const { transport, dispose } = fixture(body, headers, status);
    await expect(searchHuggingFace(query(), transport)).rejects.toThrow();
    expect(dispose).toHaveBeenCalledOnce();
  }
});
it('preserves upstream rate limits as a retryable user message', async () => {
  const { transport, dispose } = fixture([], {}, 429);
  await expect(searchHuggingFace(query(), transport)).rejects.toMatchObject({ status: 429 });
  expect(dispose).toHaveBeenCalledOnce();
});
