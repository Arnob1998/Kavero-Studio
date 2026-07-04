import { spawnSync as defaultSpawnSync } from "node:child_process";

export function localDockerRunCommand() {
  return {
    command: "docker",
    args: ["compose", "--env-file", ".env.docker.local", "up", "--build"],
  };
}

export function runLocalDockerStack({ cwd = process.cwd(), spawnSyncImpl = defaultSpawnSync } = {}) {
  const { command, args } = localDockerRunCommand();
  return spawnSyncImpl(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
}
