import { spawn } from "node:child_process";
import { prepareManagedHost } from "../local-generation/host/bootstrap.mjs";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnvContent } from "./env-file.mjs";

export function runAttachedCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true });
    child.once("error", reject);
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
}

export function userSelectedLocalEnabled(cwd, env = process.env, readSetting = () => {
  const filename = path.join(cwd, ".env.docker.local");
  return existsSync(filename) ? parseEnvContent(readFileSync(filename, "utf8")).values.KAVERO_LOCAL_GENERATION_ENABLED : undefined;
}) {
  const raw = env.KAVERO_LOCAL_GENERATION_ENABLED ?? readSetting();
  const setting = raw?.trim().replace(/^(['"])(.*)\1$/, "$2");
  if (setting !== undefined && !["0", "1"].includes(setting)) throw Error("local-generation-setting-invalid");
  return setting !== "0";
}

export function localDockerRunCommand() {
  return {
    command: "docker",
    args: ["compose", "--env-file", ".env.docker.local", "up", "--build"],
  };
}

export async function runLocalDockerStack({ cwd = process.cwd(), runCommand = runAttachedCommand, spawnSyncImpl, platform = process.platform, arch = process.arch, prepareHost = prepareManagedHost, env = process.env } = {}) {
  const { command, args } = localDockerRunCommand();
  // Unsupported hosts keep the existing cloud/Docker path. Windows receives
  // a user-selected research profile; model downloads still require owner consent.
  const host = platform === "win32" && arch === "x64" ? await prepareHost({ cwd, userSelectedModels: userSelectedLocalEnabled(cwd, env) }) : null;
  try {
    host?.assert();
    // Keep the event loop responsive during an attached Docker session. Await
    // its exit before the finally block closes the owned native host. Retain
    // the existing synchronous injection hook for callers/tests.
    return await (spawnSyncImpl ?? runCommand)(command, host ? ["compose", "--env-file", ".env.docker.local", "-f", "compose.yml", "-f", host.overlay, "up", "--build"] : args, {
      cwd,
      stdio: "inherit",
      shell: false,
    });
  } finally { await host?.close(); }
}
