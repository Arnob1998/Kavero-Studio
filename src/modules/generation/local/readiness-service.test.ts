// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), readiness: vi.fn(), destination: vi.fn() }));
vi.mock("./service", () => ({ context: mocks.context }));
vi.mock("./save-storage", () => ({ resolveLocalSaveDestination: mocks.destination }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/modules/model-providers/local/bridge", () => ({ getLocalReadiness: mocks.readiness }));
import { localUIReadiness } from "./readiness-service";
beforeEach(() => {
  vi.stubEnv("KAVERO_LOCAL_GENERATION_INTERNAL", "1"); vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", "1");
  mocks.context.mockResolvedValue({ owner: "owner-a" });
  mocks.readiness.mockResolvedValue({ ready: true, deviceId: "private-id", packageFingerprint: "private-fingerprint", hardware: { freeVramMiB: 7000, freeRamBytes: 1e10 } });
  mocks.destination.mockResolvedValue({ destination: { provider: "kavero-managed", backendId: "local-filesystem", location: "private-path" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Internal UI readiness", () => {
  it("requires both server-only gates before auth or host scanning", async () => {
    vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", "0"); expect((await localUIReadiness()).status).toBe(404); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    mocks.context.mockResolvedValue({ response: new Response(null, { status: 401 }) }); expect((await localUIReadiness()).status).toBe(401); expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it("returns only needed hardware/destination summaries", async () => {
    const res = await localUIReadiness(), data = await res.json(); expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(data).toEqual({ ownerId: "owner-a", ready: true, saveAvailable: true, saveDestination: "This machine · Gallery", hardware: { freeVramMiB: 7000, freeRamBytes: 1e10 } }); expect(JSON.stringify(data)).not.toContain("private");
  });
  it("keeps unverified Drive saving unavailable without blocking local inference", async () => {
    mocks.destination.mockResolvedValue({ destination: { provider: "google-drive" } }); const data = await (await localUIReadiness()).json(); expect(data.ready).toBe(true); expect(data.saveAvailable).toBe(false);
  });
  it("reports runtime offline while retaining the storage summary", async () => {
    mocks.readiness.mockRejectedValue(new Error("private diagnostic")); const data = await (await localUIReadiness()).json(); expect(data.ready).toBe(false); expect(data.saveAvailable).toBe(true); expect(JSON.stringify(data)).not.toContain("diagnostic");
  });
});
