import { beforeEach, afterEach, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { ModelCompatibilityPreview } from './model-compatibility-preview';
import { projectCompatibility } from './compatibility-projection';
import { previewOwner as ownerId, previewDevice as deviceId, previewSource as source, previewSnapshot } from './compatibility.test-fixtures';
const fetcher = vi.fn();
const result = () => projectCompatibility({ ownerId, source, destination: { kind: 'local' }, snapshot: previewSnapshot() });
beforeEach(() => { vi.stubGlobal('fetch', fetcher); fetcher.mockImplementation(async () => Response.json(result())); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); fetcher.mockReset(); });
it('checks explicitly and presents unknown evidence without install controls', async () => {
  render(<ModelCompatibilityPreview ownerId={ownerId} source={source} destination={{ kind: 'local' }} destinationName="This computer"/>);
  expect(fetcher).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Check model compatibility' }));
  expect(await screen.findByText('Runtime support')).toBeVisible(); expect(screen.getAllByText('Not verified')).toHaveLength(4);
  expect(fetcher.mock.calls[0][0]).toBe('/api/local-generation/compatibility');
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({ source, destination: { kind: 'local' } });
  expect(screen.queryByRole('button', { name: /Download|Install|Use on/ })).toBeNull();
});
it('does not display a late response for a previous destination', async () => {
  let finish!: (value: Response) => void; fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ModelCompatibilityPreview ownerId={ownerId} source={source} destination={{ kind: 'local' }} destinationName="This computer"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Check model compatibility' }));
  view.rerender(<ModelCompatibilityPreview ownerId={ownerId} source={source} destination={{ kind: 'remote', deviceId }} destinationName="Studio PC"/>);
  await act(async () => finish(Response.json(result())));
  expect(screen.queryByText('Runtime support')).toBeNull(); expect(screen.getByText('Check on Studio PC')).toBeVisible();
});
it('rejects an account or model identity mismatch', async () => {
  fetcher.mockImplementation(async () => Response.json({ ...result(), ownerId: deviceId }));
  render(<ModelCompatibilityPreview ownerId={ownerId} source={source} destination={{ kind: 'local' }} destinationName="This computer"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Check model compatibility' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('account or computer changed');
  expect(screen.queryByText('Runtime support')).toBeNull();
});
it('accepts unfinished link editing without crashing or starting a request', () => {
  render(<ModelCompatibilityPreview ownerId={ownerId} source={{ id: 'editing', source: 'h' }} destination={{ kind: 'local' }} destinationName="This computer"/>);
  expect(screen.getByRole('button', { name: 'Check model compatibility' })).toBeVisible(); expect(fetcher).not.toHaveBeenCalled();
});
it('invalidates an expired assessment rather than retaining a green result', async () => {
  const value = result(); value.expiresAt = new Date(Date.now() + 30).toISOString(); fetcher.mockImplementation(async () => Response.json(value));
  render(<ModelCompatibilityPreview ownerId={ownerId} source={source} destination={{ kind: 'local' }} destinationName="This computer"/>);
  fireEvent.click(screen.getByRole('button', { name: 'Check model compatibility' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('out of date'));
  expect(screen.queryByText('Runtime support')).toBeNull();
});
