// @vitest-environment node
import { beforeEach, afterEach, it, expect, vi } from 'vitest';
const m = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn(), host: vi.fn(), discover: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: m.user } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: m.rpc }) }));
vi.mock('./host-bridge', () => ({ localHostRequest: m.host }));
vi.mock('../../../../scripts/local-generation/model-discovery.mjs', () => ({ discoverModel: m.discover }));
import { compatibilityPOST } from './compatibility-service';
import { previewOwner as ownerId, previewDevice as deviceId, previewSource as source, previewSnapshot, previewSetup } from './compatibility.test-fixtures';
import { existingJobSnapshot, canonicalSnapshot } from './job-snapshot';
import { digest } from './connect/protocol';
import { modelImportsGET } from './import-service';
const origin = 'https://kavero.test';
const request = (body: unknown, headers: Record<string, string> = {}) => new Request(origin + '/api/local-generation/compatibility', { method: 'POST', headers: { origin, 'x-kavero-connect-owner': ownerId, ...headers }, body: JSON.stringify(body) });
const local = () => ({ source, destination: { kind: 'local' } });
const remote = () => ({ source, destination: { kind: 'remote', deviceId } });
function remoteRow() {
  const stamp = new Date().toISOString();
  const binding = { profile: 'qwen-image-2.1-q4-evaluation', workerEpoch: crypto.randomUUID(), ledgerIdentity: crypto.randomUUID(), executionDevice: 'a'.repeat(64), permission: true, maintenance: false, execute: true, recipeSnapshot: existingJobSnapshot() };
  return { id: deviceId, name: 'Studio PC', expires_at: new Date(Date.now() + 86400000).toISOString(), revoked_at: null, last_seen_at: stamp, report: { platform: 'win32', arch: 'x64', node: '24.11.1', ramMiB: 32768, gpus: [{ label: 'GPU', vramMiB: 24000 }] }, binding, binding_hash: digest(canonicalSnapshot(binding)), binding_at: stamp, seen_at: stamp, outstanding: 0 };
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const flag of ['ENABLED','DELIVERY_ENABLED','EXECUTION_ENABLED','RESULTS_ENABLED']) vi.stubEnv('KAVERO_CONNECT_' + flag, '1');
  vi.stubEnv('KAVERO_CONNECT_ORIGIN', origin); vi.stubEnv('KAVERO_API_ORIGIN', origin); vi.stubEnv('KAVERO_STORAGE_PROVIDER', 'kavero-managed'); vi.stubEnv('KAVERO_MANAGED_STORAGE_BACKEND', 'supabase-storage'); vi.stubEnv('KAVERO_LOCAL_GENERATION_ENABLED', '1');
  m.user.mockResolvedValue({ data: { user: { id: ownerId } }, error: null }); m.rpc.mockResolvedValue({ data: { computers: [remoteRow()], ownerOutstanding: 0 }, error: null });
  m.discover.mockResolvedValue(previewSnapshot()); m.host.mockResolvedValue({ status: 200, body: { setup: previewSetup() } });
});
afterEach(() => vi.unstubAllEnvs());
it('uses read-only local setup and strips private setup fields', async () => {
  const response = await compatibilityPOST(request(local())); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ownerId, ready: true, installable: false });
  expect(m.host).toHaveBeenCalledWith('/host/setup', { owner: ownerId, profile: 'qwen-image-2.1-q4-evaluation' }); expect(m.rpc).not.toHaveBeenCalled();
});
it('checks a permitted remote destination with local generation disabled and without using the local helper', async () => {
  vi.stubEnv('KAVERO_LOCAL_GENERATION_ENABLED', '0');
  const response = await compatibilityPOST(request(remote())); expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ destinationName: 'Studio PC', ready: true, installable: false }); expect(m.host).not.toHaveBeenCalled();
  expect(m.rpc).toHaveBeenCalledWith('connect_computers_owner', { p_owner: ownerId, p_origin: origin });
});
it('rejects wrong origin/account/destination and ended pairing before metadata requests', async () => {
  expect((await compatibilityPOST(request(remote(), { origin: 'https://evil.test' }))).status).toBe(403);
  expect((await compatibilityPOST(request(remote(), { 'x-kavero-connect-owner': deviceId }))).status).toBe(409);
  m.rpc.mockResolvedValue({ data: { computers: [] } }); expect((await compatibilityPOST(request(remote()))).status).toBe(404);
  m.rpc.mockResolvedValue({ data: { computers: [{ ...remoteRow(), revoked_at: new Date().toISOString() }] } }); expect((await compatibilityPOST(request(remote()))).status).toBe(409);
  expect(m.discover).not.toHaveBeenCalled();
});
it('preserves gate and authentication rejection before discovery', async () => {
  vi.stubEnv('KAVERO_CONNECT_ENABLED', '0'); expect((await compatibilityPOST(request(remote()))).status).toBe(404);
  vi.stubEnv('KAVERO_LOCAL_GENERATION_ENABLED', '0'); expect((await compatibilityPOST(request(local()))).status).toBe(404);
  vi.stubEnv('KAVERO_LOCAL_GENERATION_ENABLED', '1'); m.user.mockResolvedValue({ data: { user: null } }); expect((await compatibilityPOST(request(local()))).status).toBe(401);
  expect(m.discover).not.toHaveBeenCalled(); expect(m.host).not.toHaveBeenCalled();
});
it('rejects browser snapshots/owners and oversized bodies', async () => {
  expect((await compatibilityPOST(new Request(request(local()).url + '?owner=other', { method: 'POST', body: JSON.stringify(local()) }))).status).toBe(400);
  for (const change of [{ ownerId }, { snapshot: previewSnapshot() }, { command: 'install' }]) expect((await compatibilityPOST(request({ ...local(), ...change }))).status).toBe(400);
  expect((await compatibilityPOST(request({ source: { ...source, source: 'x'.repeat(5000) } }))).status).toBe(413);
  expect(m.discover).not.toHaveBeenCalled();
});
it('keeps missing local evidence unknown and redacts failure details', async () => {
  m.host.mockRejectedValue(Error('private helper secret'));
  const response = await compatibilityPOST(request(local())); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ ready: false, hardware: { state: 'unknown' } });
  m.discover.mockRejectedValue(Error('private upstream path')); const failed = await compatibilityPOST(request(local())); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain('private upstream path');
});
it('bounds concurrent checks per account without starting another remote operation', async () => {
  let finish!: (value: unknown) => void; m.discover.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = compatibilityPOST(request(local())); await vi.waitFor(() => expect(m.discover).toHaveBeenCalledOnce());
  expect((await compatibilityPOST(request(local()))).status).toBe(429);
  finish(previewSnapshot()); expect((await first).status).toBe(200);
});
it('allows gated Remote public search independently of local imports and never forwards it to a native host', async () => {
  vi.stubEnv('KAVERO_LOCAL_GENERATION_ENABLED', '0');
  // Invalid bounded search is rejected after Remote auth, without any network call.
  const response = await modelImportsGET(new Request(origin + '/api/local-generation/models?discover=1&scope=remote&search=' + 'x'.repeat(121)));
  expect(response.status).toBe(400); expect(m.user).toHaveBeenCalled(); expect(m.host).not.toHaveBeenCalled();
  expect((await modelImportsGET(new Request(origin + '/api/local-generation/models?scope=remote&id=' + deviceId))).status).toBe(400);
  expect((await modelImportsGET(new Request(origin + '/api/local-generation/models?offset=0'))).status).toBe(404);
});
