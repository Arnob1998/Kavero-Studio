import { describe, expect, it, vi } from "vitest";
import { localDockerRunCommand, runLocalDockerStack, userSelectedLocalEnabled, runAttachedCommand } from "./run.mjs";

describe("setup runner", () => {
  it("reads operator disable from the Compose env file with shell precedence", () => {
    expect(userSelectedLocalEnabled("unused", {}, () => "0")).toBe(false);
    expect(userSelectedLocalEnabled("unused", {}, () => '"0"')).toBe(false);
    expect(userSelectedLocalEnabled("unused", { KAVERO_LOCAL_GENERATION_ENABLED: "1" }, () => "0")).toBe(true);
    expect(() => userSelectedLocalEnabled("unused", {}, () => "invalid")).toThrow("local-generation-setting-invalid");
  });
  it("uses one Docker Compose command for local setup", () => {
    expect(localDockerRunCommand()).toEqual({
      command: "docker",
      args: ["compose", "--env-file", ".env.docker.local", "up", "--build"],
    });
  });

  it("runs the local Docker stack with inherited stdio", async () => {
    const spawnSyncImpl = vi.fn(() => ({ status: 0 }));
    const result = await runLocalDockerStack({ cwd: "C:/repo", spawnSyncImpl, platform: "linux" });

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
  it("automatically adds the private managed host overlay and closes only that host", async () => {
    const assert = vi.fn(), close = vi.fn(), spawnSyncImpl = vi.fn(() => ({ status: 0 }));
    const prepareHost = vi.fn(async () => ({ overlay: "C:/private/compose-host.json", assert, close }));
    expect((await runLocalDockerStack({ cwd: "C:/repo", platform: "win32", arch: "x64", prepareHost, spawnSyncImpl })).status).toBe(0);
    expect(prepareHost).toHaveBeenCalledWith({ cwd: "C:/repo", userSelectedModels: true });expect(assert).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();
    expect(spawnSyncImpl.mock.calls[0][1]).toEqual(["compose", "--env-file", ".env.docker.local", "-f", "compose.yml", "-f", "C:/private/compose-host.json", "up", "--build"]);
  });
  it("refuses Compose startup when an unknown host port blocks bootstrap", async () => {
    const spawnSyncImpl = vi.fn();await expect(runLocalDockerStack({ platform: "win32", arch: "x64", prepareHost: async () => { throw Error("host-response-invalid"); }, spawnSyncImpl })).rejects.toThrow("host-response-invalid");expect(spawnSyncImpl).not.toHaveBeenCalled();
  });
  it("respects an operator disabling the normal Local option", async () => {
    const prepareHost = vi.fn(async () => ({ overlay: "private", assert() {}, async close() {} }));
    await runLocalDockerStack({ platform: "win32", arch: "x64", env: { KAVERO_LOCAL_GENERATION_ENABLED: "0" }, prepareHost, spawnSyncImpl: () => ({ status: 0 }) });
    expect(prepareHost).toHaveBeenCalledWith({ cwd: process.cwd(), userSelectedModels: false });
  });
  it("closes the owned agent even if Docker launch fails", async () => {
    const close = vi.fn();await expect(runLocalDockerStack({ platform: "win32", arch: "x64", prepareHost: async () => ({ overlay: "private", assert() {}, close }), spawnSyncImpl: () => { throw Error("Docker missing"); } })).rejects.toThrow("Docker missing");expect(close).toHaveBeenCalledOnce();
  });
  it("keeps the host alive until an asynchronous Docker command has exited", async () => {
    const close = vi.fn(); let finish;
    const docker = new Promise(resolve => { finish = resolve; });
    const running = runLocalDockerStack({ platform: "win32", arch: "x64", prepareHost: async () => ({ overlay: "private", assert() {}, close }), spawnSyncImpl: () => docker });
    await Promise.resolve(); await Promise.resolve(); expect(close).not.toHaveBeenCalled();
    finish({ status: 0 }); expect((await running).status).toBe(0); expect(close).toHaveBeenCalledOnce();
  });
  it("processes launcher events while its attached command is running", async () => {
    let ticked = false;
    const timer = setTimeout(() => { ticked = true; }, 20);
    try {
      const running = runAttachedCommand(process.execPath, ["-e", "setTimeout(()=>{},200)"], { cwd: process.cwd(), stdio: "ignore", shell: false });
      await new Promise(resolve => setTimeout(resolve, 60)); expect(ticked).toBe(true);
      expect(await running).toEqual({ status: 0, signal: null });
    } finally { clearTimeout(timer); }
  });
});
