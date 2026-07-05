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

function hasValue(value) {
  return String(value ?? "").trim() !== "";
}

function isValidSkSecret(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed.startsWith("sk-") && trimmed.length > 8 && !isPlaceholderValue(trimmed);
}

const publicEnvPrefix = "NEXT_PUBLIC";
const liteLlmEnvToken = "LITE" + "LLM";

function hasLiteLlmPublicExposure(key) {
  const upperKey = key.toUpperCase();
  return upperKey.includes(publicEnvPrefix) && upperKey.includes(liteLlmEnvToken);
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

  for (const key of [
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_INTERNAL_URL",
    "NEXT_PUBLIC_SITE_URL",
    "KAVERO_API_ORIGIN",
    "KAVERO_LITELLM_BASE_URL",
  ]) {
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

  for (const key of Object.keys(env)) {
    if (hasLiteLlmPublicExposure(key)) {
      checks.push(check("fail", key, "LiteLLM values must stay server-only."));
    }
  }

  const gatewayConfigured =
    profileId === "local-docker" ||
    hasValue(env.KAVERO_MODEL_GATEWAY) ||
    hasValue(env.KAVERO_LITELLM_BASE_URL) ||
    hasValue(env.KAVERO_LITELLM_API_KEY);

  if (gatewayConfigured) {
    if (env.KAVERO_MODEL_GATEWAY && env.KAVERO_MODEL_GATEWAY !== "litellm") {
      checks.push(check("fail", "KAVERO_MODEL_GATEWAY", "Must be litellm when configured."));
    }

    if (env.KAVERO_MODEL_GATEWAY === "litellm") {
      if (!hasValue(env.KAVERO_LITELLM_BASE_URL)) {
        checks.push(check("fail", "KAVERO_LITELLM_BASE_URL", "Missing value."));
      }

      if (!hasValue(env.KAVERO_LITELLM_API_KEY)) {
        checks.push(check("fail", "KAVERO_LITELLM_API_KEY", "Missing value."));
      }
    }

    if (hasValue(env.KAVERO_LITELLM_API_KEY) && !isValidSkSecret(env.KAVERO_LITELLM_API_KEY)) {
      checks.push(check("fail", "KAVERO_LITELLM_API_KEY", "Must be a non-placeholder sk- secret."));
    }
  }

  if (hasValue(env.LITELLM_MASTER_KEY) && !isValidSkSecret(env.LITELLM_MASTER_KEY)) {
    checks.push(check("fail", "LITELLM_MASTER_KEY", "Must be a non-placeholder sk- secret."));
  }

  for (const key of ["OPENAI_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY"]) {
    if (hasValue(env[key]) && isPlaceholderValue(env[key])) {
      checks.push(check("fail", key, "Blank or a real value is required."));
    }
  }

  if (hasValue(env.OLLAMA_BASE_URL)) {
    if (isPlaceholderValue(env.OLLAMA_BASE_URL)) {
      checks.push(check("fail", "OLLAMA_BASE_URL", "Blank or an http(s) URL is required."));
    } else if (!isValidUrl(env.OLLAMA_BASE_URL)) {
      checks.push(check("fail", "OLLAMA_BASE_URL", "Must be an http(s) URL."));
    }
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
