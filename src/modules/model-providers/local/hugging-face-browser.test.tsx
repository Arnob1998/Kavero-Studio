import { afterEach, beforeEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { HuggingFaceBrowser } from './hugging-face-browser';
const model = { id: 'artist/new-image-architecture', author: 'artist', name: 'new-image-architecture', downloads: 12500, likes: 25, task: 'text-to-image', format: 'GGUF', license: 'mit', gated: false };
const fetcher = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetcher); fetcher.mockImplementation(async () => Response.json({ models: [model], nextCursor: 'next123' })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetcher.mockReset(); });
it('renders upstream model identity and sends only an explicit model choice to the shared inspection flow', async () => {
  const select = vi.fn(); render(<HuggingFaceBrowser initialView="hub" onSelect={select} disabled={false}/>);
  expect(await screen.findByText('new-image-architecture')).toBeVisible();
  expect(screen.getByText('artist')).toBeVisible(); expect(screen.getByText('12.5K')).toBeVisible();
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'View artist/new-image-architecture' }));
  expect(select).toHaveBeenCalledWith(model);
  expect(fetcher.mock.calls.every(([, init]) => init.method === 'GET')).toBe(true);
});
it('searches explicitly, pages with opaque tokens and resets paging on a new filter', async () => {
  render(<HuggingFaceBrowser initialView="hub" onSelect={vi.fn()} disabled={false}/>);
  await screen.findByText('new-image-architecture');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search Hugging Face models' }), { target: { value: 'flux & qwen' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', { name: 'Search models' }));
  await waitFor(() => expect(new URL(fetcher.mock.calls.at(-1)![0], 'http://localhost').searchParams.get('search')).toBe('flux & qwen'));
  await screen.findByText('new-image-architecture');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(new URL(fetcher.mock.calls.at(-1)![0], 'http://localhost').searchParams.get('cursor')).toBe('next123'));
  await screen.findByText('new-image-architecture');
  fireEvent.change(screen.getByRole('combobox', { name: 'Model format' }), { target: { value: 'gguf' } });
  await waitFor(() => expect(new URL(fetcher.mock.calls.at(-1)![0], 'http://localhost').searchParams.get('format')).toBe('gguf'));
  expect(new URL(fetcher.mock.calls.at(-1)![0], 'http://localhost').searchParams.has('cursor')).toBe(false);
});
it('shows upstream errors with a retry and does not fabricate a supported-model list', async () => {
  fetcher.mockImplementation(async () => Response.json({ error: 'Rate limited. Try again later.' }, { status: 429 }));
  render(<HuggingFaceBrowser initialView="hub" onSelect={vi.fn()} disabled={false}/>);
  expect(await screen.findByText('Rate limited. Try again later.')).toBeVisible();
  expect(screen.queryByText('new-image-architecture')).toBeNull();
  fetcher.mockImplementation(async () => Response.json({ models: [model], nextCursor: null }));
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('new-image-architecture')).toBeVisible();
});
it('blocks another inspection while a prior request requires exact retry', async () => {
  const select = vi.fn(); render(<HuggingFaceBrowser initialView="hub" onSelect={select} disabled/>);
  expect(await screen.findByRole('button', { name: 'View artist/new-image-architecture' })).toBeDisabled();
  expect(select).not.toHaveBeenCalled();
});
