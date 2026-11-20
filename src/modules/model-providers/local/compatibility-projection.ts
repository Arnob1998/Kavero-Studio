import { createHash } from 'node:crypto';
import { profileForSnapshot } from './browser-profiles';
import type { HubSnapshot, HubSource } from './model-hub-contract';
import type { SetupSnapshot } from '@/modules/generation/local/setup-contract';
import type { Computer } from './connect/computer-contract';
import { compatibilityResult, type ModelDestination, type CompatibilityResult } from './compatibility-contract';

export function verifiedSnapshotProfile(snapshot: HubSnapshot | null) {
  return profileForSnapshot(snapshot);
}
export function projectCompatibility({ ownerId, source, destination, snapshot, setup, computer, now = Date.now() }: {
  ownerId: string; source: HubSource; destination: ModelDestination; snapshot: HubSnapshot | null;
  setup?: SetupSnapshot; computer?: Computer; now?: number;
}) {
  const profile = verifiedSnapshotProfile(snapshot);
  const unknown = (message: string) => ({ state: 'unknown' as const, message });
  const pass = (message: string) => ({ state: 'pass' as const, message });
  const blocked = (message: string) => ({ state: 'blocked' as const, message });
  const runtime = profile ? pass('The selected file matches a verified Kavero recipe.')
    : snapshot?.recipeSupport === 'unsupported-runtime' || snapshot?.recipeSupport === 'unsupported-format'
      ? blocked('Kavero does not support this source and file yet.')
      : unknown(snapshot?.recipeSupport === 'needs-variant' ? 'Choose a repository file before checking runtime support.' : 'A complete current recipe could not be verified.');
  let hardware: CompatibilityResult['hardware'] = unknown('Hardware has not been verified for this model.'), storage: CompatibilityResult['storage'] = unknown('Installation and free setup space are not verified.');
  let access: CompatibilityResult['access'] = unknown('Permission for this model has not been verified.'), availability: CompatibilityResult['availability'] = unknown('Computer status could not be verified.');
  let ready = false;
  const destinationName = destination.kind === 'local' ? 'This computer' : computer?.name ?? 'Remote computer';
  if (destination.kind === 'local' && profile && setup?.manifest === profile.manifest
    && setup.packageId === (profile.profile === 'qwen-image-2.1-q3-evaluation' ? 'qwen-2-1-q3-research-delivery-v1' : 'qwen-2-1-research-delivery-v1')) {
    hardware = setup.supported && setup.compatibility === 'eligible' ? pass('Existing native checks meet this workload’s minimum requirements; this is not a performance benchmark.')
      : ['windows-only','multiple-gpus','gpu-too-small','ram-too-small'].includes(setup.compatibility ?? '') ? blocked(`Native requirement check: ${setup.compatibility}.`) : unknown('Native GPU/backend eligibility is not verified.');
    storage = setup.installed ? pass('The model is installed on this computer.')
      : setup.freeBytes >= setup.requiredFreeBytes ? pass('Existing setup reports enough disk space for its required components.') : blocked('This computer needs more free disk space for setup.');
    access = setup.accepted ? pass('This account has accepted the current model terms here.') : blocked('Review and accept this model’s terms in the existing setup flow.');
    availability = setup.ready ? pass('The native host reports this model ready.') : unknown('The model is not currently ready; review its existing setup status.');
    ready = setup.ready && setup.installed && setup.accepted && setup.supported;
  } else if (destination.kind === 'remote' && computer) {
    const fresh = !!computer.lastSeenAt && Date.parse(computer.lastSeenAt) > now - 150000 && Date.parse(computer.lastSeenAt) <= now + 60000;
    const active = fresh && profile && computer.model?.profile === profile.profile && computer.capability !== null && ['ready','busy'].includes(computer.status);
    availability = !fresh || computer.status === 'offline' ? blocked('This computer is offline or its evidence is stale.')
      : computer.status === 'ready' ? pass('The connected computer is online.')
      : computer.status === 'busy' ? blocked('This computer is busy. Existing work will not be interrupted.') : unknown(`Computer status: ${computer.status}.`);
    hardware = active ? pass('The current native binding verifies this installed workload. Free memory is not reported.')
      : unknown('Reported GPU/RAM totals do not verify this candidate’s backend, free memory or eligibility.');
    storage = active ? pass('This exact model has a verified active binding. Free setup disk space is not reported.') : unknown('The companion does not report candidate installation or free disk space.');
    access = active ? pass('The current binding includes permission for this model and account.')
      : computer.status === 'permission-needed' && profile && computer.model?.profile === profile.profile ? blocked('Approve model access in Kavero Connect on this computer.') : unknown('Permission for this exact model is not verified.');
    ready = !!active && computer.status === 'ready';
  }
  const checkedAt = new Date(now).toISOString();
  const lastSeen = Date.parse(computer?.lastSeenAt ?? '');
  const remoteExpiry = destination.kind === 'remote' && computer && ['ready','busy'].includes(computer.status) && Number.isFinite(lastSeen) ? lastSeen + 150000 : now + 150000;
  const expiresAt = new Date(Math.max(now, Math.min(now + 150000, remoteExpiry))).toISOString();
  const assessmentId = createHash('sha256').update(JSON.stringify({ ownerId, source, destination, revision: snapshot?.revision, manifest: snapshot?.recipeManifest, seen: computer?.lastSeenAt, binding: computer?.capability?.bindingHash, setup, checkedAt })).digest('hex');
  return compatibilityResult.parse({ version: 1, ownerId, source, destination, destinationName, snapshot, assessmentId, checkedAt, expiresAt, runtime, hardware, storage, access, availability, ready, installable: false });
}
