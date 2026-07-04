import { spawnSync as defaultSpawnSync } from "node:child_process";
import path from "node:path";
import {
  getSetupProfile,
  isPlaceholderValue,
  requiredEnvKeysForProfile,
  sensitiveEnvKeys,
} from "./config.mjs";
import { readEnvFile } from "./env-file.mjs";

function check(status, label, message) {
  return { status, label, message };
}

function commandResult(spawnSyncImpl, command, args) {
  const result = spawnSyncImpl(command, args, { encoding: "utf8", shell: false });
  if (result.error) return { ok: false, message: result.error.message };
  if (result.status !== 0) {
    const message = result.stderr?.trim() || result.stdout?.trim() || `exit ${result.status}`;
    return { ok: false, message };
  }
  return { ok: true, message: result.stdout?.trim() || "ok" };
}

function isValidUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function validateEnvForProfile({ profileId, env }) {
  const checks = [];
  const requiredKeys = requiredEnvKeysForProfile(profileId);

  for (const key of requiredKeys) {
    const value = env[key];
    if (value === undefined || String(value).trim() === "") {
      checks.push(check("fail", key, "Missing value."));
      continue;
    }

    if (isPlaceholderValue(value)) {
      checks.push(check("fail", key, "Still uses a placeholder value."));
      continue;
    }

    checks.push(check("pass", key, sensitiveEnvKeys.has(key) ? "Set." : String(value)));
  }

  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_INTERNAL_URL", "NEXT_PUBLIC_SITE_URL", "KAVERO_API_ORIGIN"]) {
    if (env[key] && !isValidUrl(env[key])) {
      checks.push(check("fail", key, "Must be an http(s) URL."));
    }
  }

  for (const key of ["KAVERO_APP_PORT", "SUPABASE_KONG_PORT"]) {
    if (env[key] && !isValidPort(env[key])) {
      checks.push(check("fail", key, "Must be a port from 1 to 65535."));
    }
  }

  if (profileId === "local-docker" && env.KAVERO_LOCAL_STORAGE_ROOT !== "/data/kavero-storage") {
    checks.push(check("fail", "KAVERO_LOCAL_STORAGE_ROOT", "Docker setup must use /data/kavero-storage."));
  }

  return checks;
}

export function summarizeChecks(checks) {
  const failed = checks.filter((item) => item.status === "fail").length;
  const warned = checks.filter((item) => item.status === "warn").length;
  return { ok: failed === 0, failed, warned, total: checks.length };
}

export function runDoctor({
  profileId = "local-docker",
  cwd = process.cwd(),
  spawnSyncImpl = defaultSpawnSync,
  runComposeConfig = true,
} = {}) {
  const profile = getSetupProfile(profileId);
  if (!profile) throw new Error(`Unknown setup profile: ${profileId}`);

  const checks = [];
  const envPath = path.join(cwd, profile.envFile);
  const env = readEnvFile(envPath);

  checks.push(check("pass", "Profile", `${profile.label} (${profile.envFile})`));

  const nodeResult = commandResult(spawnSyncImpl, "node", ["--version"]);
  checks.push(check(nodeResult.ok ? "pass" : "fail", "Node.js", nodeResult.ok ? nodeResult.message : nodeResult.message));

  const pnpmResult = commandResult(spawnSyncImpl, "pnpm", ["--version"]);
  checks.push(check(pnpmResult.ok ? "pass" : "fail", "pnpm", pnpmResult.ok ? pnpmResult.message : pnpmResult.message));

  if (profile.docker) {
    const dockerResult = commandResult(spawnSyncImpl, "docker", ["--version"]);
    checks.push(check(dockerResult.ok ? "pass" : "fail", "Docker", dockerResult.ok ? dockerResult.message : dockerResult.message));

    const composeResult = commandResult(spawnSyncImpl, "docker", ["compose", "version"]);
    checks.push(check(composeResult.ok ? "pass" : "fail", "Docker Compose", composeResult.ok ? composeResult.message : composeResult.message));

    if (runComposeConfig && composeResult.ok) {
      const configResult = commandResult(spawnSyncImpl, "docker", [
        "compose",
        "--env-file",
        profile.envFile,
        "config",
      ]);
      checks.push(check(configResult.ok ? "pass" : "fail", "Compose config", configResult.ok ? "Valid." : configResult.message));
    }
  }

  checks.push(...validateEnvForProfile({ profileId, env }));

  return {
    profile,
    envPath,
    checks,
    summary: summarizeChecks(checks),
  };
}
