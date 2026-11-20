// @vitest-environment node
import { it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { createHmac, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
const f = vi.hoisted(() => ({ rpc: vi.fn(), context: vi.fn(), profiles: [] }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: f.rpc }) }));
vi.mock('@/modules/generation/local/service', () => ({ context: f.context }));
vi.mock('@/modules/generation/local/readiness-service', () => ({ localUIEnabled: () => true }));
vi.mock('@/modules/model-providers/local/browser-profiles', () => ({ localProfiles: f.profiles }));
import { localRemovalGET, localRemovalPOST } from '@/modules/model-providers/local/removal-service';
import { initializeHost } from './bootstrap.mjs';
import { ActivationManager } from './activation.mjs';
import { SetupManager } from './setup.mjs';
import { SetupHub } from './setup-hub.mjs';
import { NativeRemovalManager } from './removal.mjs';
import { RemovalWire } from './removal-wire.mjs';
import { PackageInstaller } from '../install/transaction.mjs';
import { sha } from '../install/manifest.mjs';
import { verifyRequest } from '../protocol.mjs';
it('runs the authenticated API over actual signed HTTP into disposable native deletion and reinstall, without model-sized fixtures', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kavero-removal-roundtrip-')), base = initializeHost(root, { protect: () => { } }), config = { ...base.config, internalEvaluation: true };
    const db = new DatabaseSync(':memory:'), activation = new ActivationManager(config, db, { files: base.files });
    const installers = [];
    const setup = new SetupHub(config, db, activation, { factory: (packageId) => {
            const data = Buffer.from('Disposable roundtrip ' + packageId), manifest = { schema: 1, id: packageId, publicApproved: false, noticesVerified: true, termsDigest: sha('fixture terms'), artifacts: [{ id: 'fixture', role: 'test-fixture', revision: 'a'.repeat(40), url: 'https://example.com/model', hosts: ['example.com'], bytes: data.length, sha256: sha(data), destination: 'weights/model.gguf' }] };
            const installer = new PackageInstaller({ root: path.join(root, 'delivery'), instanceId: config.instanceId, catalog: [manifest], purpose: 'internal-evaluation', dependencies: { protect: () => { }, inspectProcess: async (pid) => ({ pid, creation: '1' }), transport: async () => ({ status: 200, headers: { etag: '"fixture"' }, body: (async function* () { yield data; })(), dispose() { } }) } });
            installers.push(installer);
            const manager = new SetupManager(config, db, activation, { packageId, manifest, installer, hardware: async () => ({ freeVramMiB: 8000, freeRamBytes: 16 * 1024 ** 3 }) });
            manager.initializing = false;
            return manager;
        } });
    const native = new NativeRemovalManager(config, db, activation, setup), wire = new RemovalWire(native), owner = randomUUID(), manager = setup.manager();
    const profile = { profile: 'qwen-image-2.1-q4-evaluation', packageId: manager.packageId, manifest: manager.verified.hash };
    f.profiles.push(profile);
    f.context.mockResolvedValue({ owner });
    let row = null;
    const calls = [];
    // Actual database locking/grants are accepted separately by db-proof.sql.
    // This fixture supplies the server RPC record to exercise wire/byte handling.
    f.rpc.mockImplementation(async (name, args) => {
        calls.push(name);
        if (name === 'begin_local_model_removal')
            row ??= { id: randomUUID(), owner_id: owner, submission_key: args.p_key, instance_id: config.instanceId, package_id: profile.packageId, manifest: profile.manifest, state: 'pending', host_operation: null };
        if (name === 'settle_local_model_removal')
            row = { ...row, host_operation: args.p_host, state: args.p_removed ? 'removed' : 'pending' };
        return { data: row };
    });
    const requests = [], nonces = new Set();
    const server = createServer(async (req, res) => {
        try {
            let encoded = '';
            for await (const chunk of req)
                encoded += chunk.toString();
            verifyRequest({ nonce: (nonce) => { if (nonces.has(nonce))
                    throw Error('replay'); nonces.add(nonce); } }, config.secret, 'POST', req.url, req.headers, encoded);
            const body = JSON.parse(encoded);
            requests.push(req.url);
            if (req.url === '/host/removal/start')
                expect(calls).toContain('begin_local_model_removal');
            const result = req.url === '/host/status' ? { status: 200, body: {} } : await wire.handle(req.url, body), bytes = JSON.stringify({ instanceId: config.instanceId, ...result.body });
            res.writeHead(result.status, { 'content-type': 'application/json', 'x-kavero-response': createHmac('sha256', config.secret).update(req.headers['x-kavero-nonce'] + '\n' + sha(bytes)).digest('hex') });
            res.end(bytes);
        }
        catch {
            res.writeHead(500);
            res.end('{}');
        }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const originalFetch = globalThis.fetch;
    vi.stubEnv('KAVERO_LOCAL_HOST_URL', 'http://127.0.0.1:8792');
    vi.stubEnv('KAVERO_LOCAL_HOST_SECRET', config.secret);
    vi.stubGlobal('fetch', (url, init) => originalFetch(String(url).replace('127.0.0.1:8792', `127.0.0.1:${address.port}`), init));
    try {
        const terms = { owner, key: randomUUID(), accepted: true, purpose: 'research-evaluation', manifest: manager.verified.hash, termsDigest: manager.verified.manifest.termsDigest, consentToken: manager.consentToken(owner) };
        const install = await setup.admit(terms);
        manager.pending = null;
        await manager.installer.run(owner, install.id);
        base.files.write('generation/preserved-output.png', Buffer.from('saved-output-sentinel'));
        const get = () => localRemovalGET(new Request('http://localhost/api/local-generation/removals?profile=' + profile.profile));
        expect((await (await get()).json()).review.canRemove).toBe(true);
        const body = { key: randomUUID(), instanceId: config.instanceId, packageId: profile.packageId, manifest: profile.manifest, confirmed: true };
        expect((await localRemovalPOST(new Request('http://localhost/api/local-generation/removals', { method: 'POST', body: JSON.stringify(body) }))).status).toBe(202);
        await vi.waitFor(async () => expect((await (await get()).json()).operation.state).toBe('removed'), { timeout: 5000 });
        expect(row.state).toBe('removed');
        expect(base.files.exists(`delivery/versions/${profile.manifest}`)).toBe(false);
        expect(base.files.read('generation/preserved-output.png').toString()).toBe('saved-output-sentinel');
        const fresh = await setup.admit({ ...terms, key: randomUUID() });
        manager.pending = null;
        await manager.installer.run(owner, fresh.id);
        expect(await manager.installer.verifyVersion(`versions/${profile.manifest}`, manager.verified)).toBe(true);
        expect((await (await get()).json()).operation.state).toBe('removed');
        expect(requests.filter(p => p === '/host/removal/start')).toHaveLength(1);
    }
    finally {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
        await new Promise(resolve => { server.close(() => resolve()); server.closeIdleConnections(); });
        for (const installer of installers)
            installer.close();
        db.close();
        rmSync(root, { recursive: true, force: true });
        f.profiles.splice(0);
    }
}, 20000);
