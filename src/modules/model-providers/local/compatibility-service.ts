import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { localGenerationUIEnabled } from './enabled';
import { localHostRequest } from './host-bridge';
import { RequestError } from './connect/service';
import { remotePreviewOwner } from './connect/preview-context';
import { projectComputer } from './connect/computer-projection';
import { compatibilityRequest } from './compatibility-contract';
import { projectCompatibility, verifiedSnapshotProfile } from './compatibility-projection';
import { hubSnapshot } from './model-hub-contract';
import { setupSnapshotSchema } from '@/modules/generation/local/setup-contract';
// @ts-expect-error Reuse the existing bounded, metadata-only native resolver.
import { discoverModel } from '../../../../scripts/local-generation/model-discovery.mjs';

const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
const checkingOwners = new Set<string>();
export async function compatibilityPOST(request: Request) {
  try {
    if (new URL(request.url).search) return reply({ error: 'Invalid model check query.' }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    const reader = request.body?.getReader(); if (!reader) return reply({ error: 'Missing model check.' }, 400);
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); return reply({ error: 'Model check is too large.' }, 413); } chunks.push(value); } } finally { reader.releaseLock(); }
    const input = compatibilityRequest.safeParse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))));
    if (!input.success) return reply({ error: 'Invalid model or destination.' }, 400);
    const { source, destination } = input.data;
    let ownerId: string, computer;
    if (destination.kind === 'remote') {
      const ctx = await remotePreviewOwner(request); ownerId = ctx.ownerId;
      const { data, error } = await createAdminClient().rpc('connect_computers_owner', { p_owner: ownerId, p_origin: ctx.origin });
      if (error || !data || !Array.isArray(data.computers) || data.computers.length > 50) throw Error('computer-status-unavailable');
      const row = data.computers.find((row: { id?: unknown }) => row?.id === destination.deviceId);
      if (!row) return reply({ error: 'This computer is not available to your account.' }, 404);
      computer = projectComputer(row);
      if (['revoked', 'expired'].includes(computer.status)) return reply({ error: 'This computer connection has ended.' }, 409);
    } else {
      if (!localGenerationUIEnabled()) return reply({ error: 'Local models are not enabled.' }, 404);
      const client = await createClient(), { data: { user }, error } = await client.auth.getUser();
      if (error || !user) return reply({ error: 'Sign in to check models.' }, 401);
      ownerId = user.id;
      const expected = request.headers.get('x-kavero-connect-owner');
      if (expected && expected !== ownerId) return reply({ error: 'Your account changed. Reload before checking.' }, 409);
      const origin = request.headers.get('origin'), configured = process.env.KAVERO_API_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL;
      if (origin && (!configured || origin !== new URL(configured).origin)) return reply({ error: 'Check models from the Kavero website.' }, 403);
    }
    if (checkingOwners.has(ownerId) || checkingOwners.size >= 8) return reply({ error: 'Another model check is in progress. Try again shortly.' }, 429);
    checkingOwners.add(ownerId);
    try {
    const snapshot = hubSnapshot.parse(await discoverModel(source, { signal: request.signal }));
    let setup;
    const profile = verifiedSnapshotProfile(snapshot);
    if (destination.kind === 'local' && profile) {
      try {
        const result = await localHostRequest('/host/setup', { owner: ownerId, profile: profile.profile });
        if (result.status === 200) setup = setupSnapshotSchema.parse((result.body as { setup: unknown }).setup);
      } catch { /* Public metadata remains available; missing host evidence stays unknown. */ }
    }
    return reply(projectCompatibility({ ownerId, source, destination, snapshot, setup, computer }));
    } finally { checkingOwners.delete(ownerId); }
  } catch (error) {
    if (error instanceof RequestError) return reply({ error: error.message }, error.status);
    if (error instanceof Error && 'code' in error && ['invalid-model-source','unsupported-model-link','conflicting-model-file'].includes(String(error.code))) return reply({ error: 'Enter a public Hugging Face repository or model-file link.' }, 400);
    if (error instanceof SyntaxError || error instanceof TypeError) return reply({ error: 'Invalid model check.' }, 400);
    return reply({ error: 'Model information or computer status could not be verified. Try again.' }, 503);
  }
}
