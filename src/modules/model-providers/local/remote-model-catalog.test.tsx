import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { RemoteModelCatalog } from './remote-model-catalog';
import { projectCompatibility } from './compatibility-projection';
import { previewOwner as ownerId, previewDevice as deviceId, previewSnapshot } from './compatibility.test-fixtures';
import type { Computer } from './connect/computer-contract';
const second = '55697489-d22b-432b-818b-155f201cc52d';
const computers: Computer[] = [deviceId, second].map((id, index) => ({ id, name: index ? 'Laptop' : 'Studio PC', status: 'not-ready', lastSeenAt: new Date().toISOString(), model: null, capability: null, outstanding: 0, hardware: null }));
const fetcher = vi.fn();
beforeEach(() => {
  vi.stubGlobal('fetch', fetcher);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); } });
  fetcher.mockImplementation(async (_url, options) => { const body = JSON.parse(options.body); return Response.json(projectCompatibility({ ownerId, ...body, snapshot: previewSnapshot(), computer: computers.find(c => c.id === body.destination.deviceId) })); });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); fetcher.mockReset(); });
it('requires an explicit model destination with several computers and never treats All computers as one', async () => {
  render(<RemoteModelCatalog ownerId={ownerId} computers={computers}/>);
  expect(screen.getByRole('button', { name: 'View Qwen Image' })).toBeDisabled(); expect(fetcher).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole('combobox', { name: 'Model destination' }), { target: { value: second } });
  fireEvent.click(screen.getByRole('button', { name: 'View Qwen Image' }));
  fireEvent.click(screen.getByRole('button', { name: 'Inspect Abiray/Qwen-Image-2.1-GGUF' }));
  expect(screen.getByRole('dialog', { name: 'Remote model details' })).toBeVisible(); expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Check model compatibility' }));
  expect(await screen.findByText('Runtime support')).toBeVisible();
  expect(JSON.parse(fetcher.mock.calls[0][1].body).destination).toEqual({ kind: 'remote', deviceId: second });
  expect(fetcher.mock.calls.every(([url]) => url === '/api/local-generation/compatibility')).toBe(true);
});
it('drops actionable details when the destination snapshot becomes unavailable', () => {
  const view = render(<RemoteModelCatalog ownerId={ownerId} computers={[computers[0]]}/>);
  fireEvent.click(screen.getByRole('button', { name: 'Check a model link' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Hugging Face model link' }), { target: { value: 'https://huggingface.co/owner/model' } });
  expect(screen.getByRole('button', { name: 'Check model compatibility' })).toBeVisible();
  view.rerender(<RemoteModelCatalog ownerId={ownerId} computers={null}/>);
  expect(screen.queryByRole('button', { name: 'Check model compatibility' })).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
});
