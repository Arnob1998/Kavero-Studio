// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { devLocalEnvironment, readDevHostConfig, runLocalDev } from './dev-local.mjs';

const secret = 'a'.repeat(64), instanceId = '12345678-1234-1234-1234-123456789abc';
const base = { LOCALAPPDATA: os.tmpdir(), NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-key' };
describe('local hot reload launcher', () => {
  it('maps Docker-only connections to loopback and keeps credentials server-only', () => {
    const env = devLocalEnvironment('/repo', { ...base, SUPABASE_INTERNAL_URL: 'http://supabase-kong:8000', KAVERO_LOCAL_HOST_URL: 'http://host.docker.internal:8792' }, { secret });
    expect(env.SUPABASE_INTERNAL_URL).toBe(base.NEXT_PUBLIC_SUPABASE_URL);
    expect(env.KAVERO_LOCAL_HOST_URL).toBe('http://127.0.0.1:8792');
    expect(env.KAVERO_LOCAL_BRIDGE_SECRET).toBe(secret);
    expect(Object.entries(env).filter(([key]) => key.startsWith('NEXT_PUBLIC_')).some(([, value]) => value === secret)).toBe(false);
    expect(env.KAVERO_LOCAL_GENERATION_ENABLED).toBe('1');
    expect(devLocalEnvironment('/repo', { ...base, KAVERO_LOCAL_GENERATION_ENABLED: '0' }, { secret }).KAVERO_LOCAL_GENERATION_ENABLED).toBe('0');
    expect(env.KAVERO_LOCAL_STORAGE_ROOT).toBe(path.join('/repo', '.kavero', 'dev-storage'));
  });
  it('authenticates the existing helper before starting Next without eval/env-file flags', async () => {
    const child = new EventEmitter(), spawnImpl = vi.fn(() => child), request = vi.fn(async () => ({}));
    const pending = runLocalDev({ cwd: process.cwd(), platform: 'win32', env: base, readEnv: () => ({}), readConfig: () => ({ secret }), request, spawnImpl });
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledOnce());
    expect(request).toHaveBeenCalledWith({ secret }, '/host/status');
    const [, args, options] = spawnImpl.mock.calls[0];
    expect(args.slice(1)).toEqual(['dev', '--hostname', '127.0.0.1', '--port', '3001']);
    expect(args.join(' ')).not.toContain(secret);
    expect(options.env.KAVERO_LOCAL_HOST_SECRET).toBe(secret);
    child.emit('close', 0);
    expect(await pending).toBe(0);
    expect(request).toHaveBeenCalledTimes(1); // Never shuts down the helper owned by setup:run.
  });
  it('refuses to spawn on missing or unauthenticated helper', async () => {
    const spawnImpl = vi.fn();
    await expect(runLocalDev({ platform: 'win32', env: base, readEnv: () => ({}), readConfig: () => ({ secret }), request: async () => { throw Error(secret); }, spawnImpl })).rejects.toThrow('Keep pnpm.cmd setup:run running');
    expect(spawnImpl).not.toHaveBeenCalled();
  });
  it('rejects absent Supabase configuration before reading private credentials', async () => {
    const readConfig = vi.fn();
    await expect(runLocalDev({ platform: 'win32', env: {}, readEnv: () => ({}), readConfig })).rejects.toThrow('Supabase configuration is missing');
    expect(readConfig).not.toHaveBeenCalled();
  });
  it('validates the private root, instance, fixed port and secret', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kavero-dev-test-'));
    try {
      writeFileSync(path.join(root, '.instance.json'), JSON.stringify({ schema: 1, instanceId }));
      const config = { schema: 1, root, instanceId, port: 8792, secret };
      const save = value => writeFileSync(path.join(root, 'bootstrap-config.json'), JSON.stringify(value));
      save(config);
      expect(readDevHostConfig(root)).toEqual(config);
      for (const change of [{ port: 9000 }, { secret: 'bad' }, { root: os.tmpdir() }, { instanceId: 'different' }]) {
        save({ ...config, ...change });
        expect(() => readDevHostConfig(root)).toThrow('dev-host-config-invalid');
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('refuses linked host directories', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'kavero-dev-link-'));
    try {
      symlinkSync(root, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
      expect(() => readDevHostConfig(path.join(root, 'linked'))).toThrow('dev-host-unsafe-path');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
