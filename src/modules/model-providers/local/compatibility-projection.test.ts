// @vitest-environment node
import { it, expect } from 'vitest';
import { projectCompatibility } from './compatibility-projection';
import { previewOwner as ownerId, previewDevice as deviceId, previewSource as source, previewSnapshot, previewSetup } from './compatibility.test-fixtures';
import { localProfiles } from './browser-profiles';
import type { Computer } from './connect/computer-contract';
const computer = (): Computer => ({ id: deviceId, name: 'Studio PC', status: 'ready', lastSeenAt: new Date().toISOString(), model: { profile: localProfiles[0].profile, label: localProfiles[0].label }, capability: { bindingHash: 'a'.repeat(64), width: 512, height: 512, count: 1, promptLimit: 1000 }, outstanding: 0, hardware: { ramMiB: 1000000, gpus: [{ label: 'Large GPU', vramMiB: 1000000 }] } });
it('uses native local evidence but never grants install permission or exposes its consent token', () => {
  const result = projectCompatibility({ ownerId, source, destination: { kind: 'local' }, snapshot: previewSnapshot(), setup: previewSetup() });
  expect(result).toMatchObject({ runtime: { state: 'pass' }, hardware: { state: 'pass' }, storage: { state: 'pass' }, access: { state: 'pass' }, ready: true, installable: false });
  expect(JSON.stringify(result)).not.toContain('consentToken');
});
it('keeps missing local host evidence unknown without losing recipe support', () => {
  const result = projectCompatibility({ ownerId, source, destination: { kind: 'local' }, snapshot: previewSnapshot() });
  expect(result.runtime.state).toBe('pass'); for (const field of ['hardware','storage','access','availability'] as const) expect(result[field].state).toBe('unknown');
  expect(result.ready).toBe(false);
});
it('does not turn a huge reported remote GPU or another active profile into candidate compatibility', () => {
  const candidate = previewSnapshot({ source: { ...source, preferredFile: localProfiles[1].file }, recipeId: localProfiles[1].recipeId, recipeManifest: localProfiles[1].manifest, selectedFile: { name: localProfiles[1].file, bytes: 1, sha256: 'a'.repeat(64) } });
  const result = projectCompatibility({ ownerId, source, destination: { kind: 'remote', deviceId }, snapshot: candidate, computer: computer() });
  expect(result.runtime.state).toBe('pass'); expect(result.hardware.state).toBe('unknown'); expect(result.storage.state).toBe('unknown'); expect(result.access.state).toBe('unknown'); expect(result.ready).toBe(false);
});
it('recognizes only fresh matching active remote bindings and separates busy availability', () => {
  const c = computer();
  const result = projectCompatibility({ ownerId, source, destination: { kind: 'remote', deviceId }, snapshot: previewSnapshot(), computer: c });
  expect(result.ready).toBe(true); expect(result.hardware.message).toContain('Free memory is not reported'); expect(result.installable).toBe(false);
  c.status = 'busy'; expect(projectCompatibility({ ownerId, source, destination: { kind: 'remote', deviceId }, snapshot: previewSnapshot(), computer: c })).toMatchObject({ ready: false, storage: { state: 'pass' }, availability: { state: 'blocked' } });
  c.lastSeenAt = new Date(Date.now() - 151000).toISOString();
  expect(projectCompatibility({ ownerId, source, destination: { kind: 'remote', deviceId }, snapshot: previewSnapshot(), computer: c })).toMatchObject({ ready: false, hardware: { state: 'unknown' }, access: { state: 'unknown' } });
});
it('rejects wrong manifests/files and keeps revision uncertainty distinct from unsupported runtime', () => {
  for (const snapshot of [previewSnapshot({ recipeManifest: 'f'.repeat(64) }), previewSnapshot({ selectedFile: { name: 'other.gguf', bytes: 1, sha256: null } }), previewSnapshot({ recipeSupport: 'revision-changed' })])
    expect(projectCompatibility({ ownerId, source, destination: { kind: 'local' }, snapshot, setup: previewSetup() }).runtime.state).toBe('unknown');
  expect(projectCompatibility({ ownerId, source, destination: { kind: 'local' }, snapshot: previewSnapshot({ recipeSupport: 'unsupported-runtime' }) }).runtime.state).toBe('blocked');
});
it('distinguishes disk, permission and invalid local package evidence', () => {
  expect(projectCompatibility({ ownerId, source, destination: { kind: 'local' }, snapshot: previewSnapshot(), setup: previewSetup({ installed: false, ready: false, accepted: false, freeBytes: 1 }) })).toMatchObject({ storage: { state: 'blocked' }, access: { state: 'blocked' }, ready: false });
  expect(projectCompatibility({ ownerId, source, destination: { kind: 'local' }, snapshot: previewSnapshot(), setup: previewSetup({ packageId: 'qwen-2-1-q3-research-delivery-v1' }) }).hardware.state).toBe('unknown');
});
