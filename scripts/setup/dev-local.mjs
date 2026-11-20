import { spawn } from 'node:child_process';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';
import { hostRoot } from '../local-generation/host/bootstrap.mjs';
import { hostControl } from '../local-generation/host/control.mjs';

// Attach only: the original setup:run process retains ownership of the helper.
export function readDevHostConfig(root) {
  const absolute = path.resolve(root);
  let ancestor = absolute;
  for (;;) {
    if (lstatSync(ancestor).isSymbolicLink()) throw Error('dev-host-unsafe-path');
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const read = name => {
    const filename = path.join(absolute, name), info = lstatSync(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096
      || realpathSync(filename).toLowerCase() !== filename.toLowerCase()) throw Error('dev-host-config-invalid');
    return JSON.parse(readFileSync(filename, 'utf8'));
  };
  const identity = read('.instance.json'), config = read('bootstrap-config.json');
  if (identity.schema !== 1 || config.schema !== 1 || config.instanceId !== identity.instanceId
    || !/^[a-f0-9-]{36}$/i.test(config.instanceId) || config.port !== 8792
    || config.root?.toLowerCase() !== absolute.toLowerCase()
    || !/^[a-f0-9]{64}$/.test(config.secret)) throw Error('dev-host-config-invalid');
  return config;
}

export function devLocalEnvironment(cwd, baseEnv, config) {
  return {
    ...baseEnv,
    NODE_ENV: 'development',
    SUPABASE_INTERNAL_URL: baseEnv.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SITE_URL: 'http://127.0.0.1:3001',
    KAVERO_API_ORIGIN: 'http://127.0.0.1:3001',
    KAVERO_LITELLM_BASE_URL: 'http://127.0.0.1:4000',
    KAVERO_LOCAL_STORAGE_ROOT: path.join(cwd, '.kavero', 'dev-storage'),
    KAVERO_LOCAL_GENERATION_ENABLED: baseEnv.KAVERO_LOCAL_GENERATION_ENABLED === '0' ? '0' : '1',
    KAVERO_LOCAL_HOST_URL: 'http://127.0.0.1:8792',
    KAVERO_LOCAL_HOST_SECRET: config.secret,
    KAVERO_LOCAL_BRIDGE_URL: 'http://127.0.0.1:8791',
    KAVERO_LOCAL_BRIDGE_SECRET: config.secret,
  };
}

export async function runLocalDev({ cwd = process.cwd(), env = process.env, platform = process.platform,
  readConfig = readDevHostConfig, request = hostControl, spawnImpl = spawn,
  readEnv = () => parseEnv(readFileSync(path.join(cwd, '.env.docker.local'), 'utf8')) } = {}) {
  if (platform !== 'win32') throw Error('dev:local currently requires Windows and the managed local helper.');
  const baseEnv = { ...readEnv(), ...env };
  if (!baseEnv.NEXT_PUBLIC_SUPABASE_URL || !baseEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    throw Error('Local Supabase configuration is missing. Run pnpm.cmd setup first.');
  let config;
  try {
    config = readConfig(hostRoot(cwd, env));
    await request(config, '/host/status');
  } catch {
    throw Error('Local helper unavailable. Keep pnpm.cmd setup:run running in another terminal, then retry pnpm.cmd dev:local.');
  }
  const child = spawnImpl(process.execPath,
    [path.join(cwd, 'node_modules', 'next', 'dist', 'bin', 'next'), 'dev', '--hostname', '127.0.0.1', '--port', '3001'],
    { cwd, env: devLocalEnvironment(cwd, baseEnv, config), stdio: 'inherit', windowsHide: true, shell: false });
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runLocalDev().then(code => { process.exitCode = code; }).catch(error => {
    // Never include config objects or child environment in diagnostics.
    console.error(error.message);
    process.exitCode = 1;
  });
}
