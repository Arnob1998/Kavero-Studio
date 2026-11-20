// Server-only metadata discovery. No publisher data becomes runtime policy.
// @ts-expect-error The existing DNS-restricted native HTTPS transport has no TS declarations.
import { httpsTransport } from '../../../../scripts/local-generation/install/download.mjs';
import { huggingFacePage, type HuggingFaceModel } from './hugging-face-contract';

type Transport = (url: URL, options: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number; headers: Record<string, string | string[] | undefined>;
  body: AsyncIterable<Uint8Array>; dispose: () => void;
}>;
export class HuggingFaceSearchError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
export function searchParameters(query: URLSearchParams) {
  if ([...query.keys()].some(key => !['discover', 'search', 'cursor', 'format', 'task'].includes(key) || query.getAll(key).length !== 1)
    || query.get('discover') !== '1') throw new HuggingFaceSearchError('Invalid model search.', 400);
  const search = (query.get('search') ?? '').trim(), cursor = query.get('cursor'), format = query.get('format') ?? 'all', task = query.get('task') ?? 'text-to-image';
  if (search.length > 120 || /[\x00-\x1f\x7f]/.test(search)
    || cursor !== null && (!/^[A-Za-z0-9_+/=-]{1,2048}$/.test(cursor))
    || !['all', 'gguf'].includes(format) || !['text-to-image', 'image-to-image'].includes(task))
    throw new HuggingFaceSearchError('Invalid model search.', 400);
  return { search, cursor, format, task };
}
export async function searchHuggingFace(query: URLSearchParams, transport: Transport = httpsTransport) {
  const { search, cursor, format, task } = searchParameters(query);
  const url = new URL('https://huggingface.co/api/models');
  url.searchParams.set('pipeline_tag', task);
  url.searchParams.set('sort', 'downloads'); url.searchParams.set('direction', '-1');
  url.searchParams.set('limit', '12');
  if (search) url.searchParams.set('search', search);
  if (format === 'gguf') url.searchParams.set('filter', 'gguf');
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await transport(url, { headers: { 'accept-encoding': 'identity', 'user-agent': 'Kavero-Model-Browser/1' }, signal: AbortSignal.timeout(12000) });
  try {
    if (response.status === 429) throw new HuggingFaceSearchError('Hugging Face is receiving too many requests. Please try again shortly.', 429);
    if (response.status !== 200 || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')
      throw new HuggingFaceSearchError('Hugging Face could not be reached. Your installed models are still available.');
    const length = response.headers['content-length'];
    if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > 1024 * 1024)) throw new HuggingFaceSearchError('Model search response is too large.');
    const chunks: Uint8Array[] = []; let size = 0;
    for await (const bytes of response.body) {
      size += bytes.length;
      if (size > 1024 * 1024) throw new HuggingFaceSearchError('Model search response is too large.');
      chunks.push(bytes);
    }
    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    if (!Array.isArray(data) || data.length > 12) throw new HuggingFaceSearchError('Invalid model search response.');
    const models: HuggingFaceModel[] = [];
    for (const item of data) {
      if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !/^[\w-]+\/[\w.-]+$/.test(item.id) || item.id.length > 180
        || item.pipeline_tag !== task || item.private === true || item.disabled === true) continue;
      const tags: string[] = Array.isArray(item.tags) ? item.tags.filter((value: unknown) => typeof value === 'string').slice(0, 300) : [];
      const license = tags.find(tag => tag.startsWith('license:'))?.slice(8, 108) ?? null;
      const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
      const [author, name] = item.id.split('/');
      models.push({ id: item.id, author, name, downloads: count(item.downloads), likes: count(item.likes), task: task as HuggingFaceModel['task'],
        format: tags.includes('gguf') ? 'GGUF' : tags.includes('diffusers') ? 'Diffusers' : tags.includes('safetensors') ? 'Safetensors' : 'Model',
        license, gated: item.gated !== false && item.gated != null });
    }
    let nextCursor: string | null = null;
    const link = response.headers.link;
    if (typeof link === 'string' && link.length < 8192) {
      const next = link.match(/<([^>]+)>;\s*rel="next"/);
      if (next) {
        const candidate = new URL(next[1]);
        if (candidate.origin === url.origin && candidate.pathname === url.pathname && !candidate.username && !candidate.password && !candidate.hash) {
          const value = candidate.searchParams.get('cursor');
          if (value && /^[A-Za-z0-9_+/=-]{1,2048}$/.test(value)) nextCursor = value;
        }
      }
    }
    return huggingFacePage.parse({ models, nextCursor });
  } finally { response.dispose(); }
}
