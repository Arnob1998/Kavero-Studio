import { describe, expect, it, vi } from "vitest";
import { localDockerRunCommand, runLocalDockerStack } from "./run.mjs";

describe("setup runner", () => {
  it("uses one Docker Compose command for local setup", () => {
    expect(localDockerRunCommand()).toEqual({
      command: "docker",
      args: ["compose", "--env-file", ".env.docker.local", "up", "--build"],
    });
  });

  it("runs the local Docker stack with inherited stdio", () => {
    const spawnSyncImpl = vi.fn(() => ({ status: 0 }));
    const result = runLocalDockerStack({ cwd: "C:/repo", spawnSyncImpl });

    expect(result.status).toBe(0);
    expect(spawnSyncImpl).toHaveBeenCalledWith(
      "docker",
      ["compose", "--env-file", ".env.docker.local", "up", "--build"],
      {
        cwd: "C:/repo",
        stdio: "inherit",
        shell: false,
      },
    );
  });
});
