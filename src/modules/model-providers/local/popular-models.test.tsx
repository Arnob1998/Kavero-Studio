import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HuggingFaceBrowser } from './hugging-face-browser';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('starts with family cards including Qwen and local logos, without a live search or inspection', () => {
  const fetcher = vi.fn(), select = vi.fn(); vi.stubGlobal('fetch', fetcher);
  render(<HuggingFaceBrowser onSelect={select} disabled={false}/>);
  for (const name of ['Qwen Image', 'FLUX', 'Stable Diffusion', 'Z-Image', 'MiniMax Image', 'Hunyuan Image'])
    expect(screen.getByRole('button', { name: `View ${name}` })).toBeVisible();
  expect(new URL(screen.getByRole('img', { name: 'Qwen publisher avatar' }).getAttribute('src')!, window.location.href).pathname).toBe('/models/catalog/qwen.webp');
  expect(screen.queryByText('Higher precision')).toBeNull();
  expect(fetcher).not.toHaveBeenCalled(); expect(select).not.toHaveBeenCalled();
});
it('groups versions and distinguishes an official source from a community package before inspection', () => {
  const select = vi.fn(); render(<HuggingFaceBrowser onSelect={select} disabled={false}/>);
  fireEvent.click(screen.getByRole('button', { name: 'View Qwen Image' }));
  expect(screen.getByRole('dialog', { name: 'Qwen Image' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Inspect Qwen/Qwen-Image-2.1' })).toHaveTextContent('Official publisher');
  const community = screen.getByRole('button', { name: 'Inspect Abiray/Qwen-Image-2.1-GGUF' });
  expect(community).toHaveTextContent('Community package'); expect(select).not.toHaveBeenCalled();
  fireEvent.click(community);
  expect(select).toHaveBeenCalledWith({ id: 'Abiray/Qwen-Image-2.1-GGUF' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('loads upstream search only on Browse Hugging Face and preserves the default collection offline', async () => {
  const fetcher = vi.fn(async () => Response.json({ models: [], nextCursor: null })); vi.stubGlobal('fetch', fetcher);
  render(<HuggingFaceBrowser onSelect={vi.fn()} disabled={false}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Browse Hugging Face' }));
  expect(await screen.findByText('No models found')).toBeVisible(); expect(fetcher).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Popular models' }));
  expect(screen.getByRole('button', { name: 'View Qwen Image' })).toBeVisible();
  expect(fetcher).toHaveBeenCalledOnce();
});
