// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), readiness: vi.fn(), destination: vi.fn(),host:vi.fn() }));
vi.mock('@/modules/model-providers/local/host-bridge',()=>({localHostRequest:mocks.host}));
vi.mock("./service", () => ({ context: mocks.context }));
vi.mock("./save-storage", () => ({ resolveLocalSaveDestination: mocks.destination }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/modules/model-providers/local/bridge", () => ({ getLocalReadiness: mocks.readiness }));
import { localUIReadiness } from "./readiness-service";
import {existingJobSnapshot,q3JobSnapshot} from '@/modules/model-providers/local/job-snapshot';
beforeEach(() => {
  vi.stubEnv("KAVERO_LOCAL_GENERATION_INTERNAL", "1"); vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", "1");
  mocks.context.mockResolvedValue({ owner: "owner-a" });
  mocks.host.mockResolvedValue({status:200,body:{allowed:true}});
  mocks.readiness.mockResolvedValue({ ready: true, deviceId: "private-id", packageFingerprint: existingJobSnapshot().packageFingerprint, hardware: { freeVramMiB: 7000, freeRamBytes: 1e10 } });
  mocks.destination.mockResolvedValue({ destination: { provider: "kavero-managed", backendId: "local-filesystem", location: "private-path" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("Internal UI readiness", () => {
  it('does not grant another owner access to an installed active model',async()=>{
    mocks.host.mockResolvedValueOnce({status:200,body:{allowed:false}});
    const data=await (await localUIReadiness()).json();expect(data.ready).toBe(false);expect(data.model.profile).toBe(existingJobSnapshot().profile);
  });
  it('does not infer compatibility from health or an unknown fingerprint',async()=>{
    mocks.readiness.mockResolvedValueOnce({ready:true,packageFingerprint:'unknown'});
    const data=await (await localUIReadiness()).json();expect(data.ready).toBe(false);expect(data.model).toBeNull();expect(mocks.host).not.toHaveBeenCalled();
  });
  it('reports the exact verified Q3 model and checks its own owner permission',async()=>{
    mocks.readiness.mockResolvedValue({ready:true,packageFingerprint:q3JobSnapshot().packageFingerprint});const data=await (await localUIReadiness()).json();expect(data.ready).toBe(true);expect(data.model.profile).toBe('qwen-image-2.1-q3-evaluation');expect(mocks.host).toHaveBeenCalledWith('/host/setup/access',{owner:'owner-a',profile:data.model.profile});
  });
  it("requires both server-only gates before auth or host scanning", async () => {
    vi.stubEnv("KAVERO_LOCAL_GENERATION_UI_INTERNAL", "0"); expect((await localUIReadiness()).status).toBe(404); expect(mocks.context).not.toHaveBeenCalled(); expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it("requires authentication", async () => {
    mocks.context.mockResolvedValue({ response: new Response(null, { status: 401 }) }); expect((await localUIReadiness()).status).toBe(401); expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it("returns only needed hardware/destination summaries", async () => {
    const res = await localUIReadiness(), data = await res.json(); expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(data).toMatchObject({ ownerId: "owner-a", ready: true,model:{profile:'qwen-image-2.1-q4-evaluation',label:'Qwen Image 2.1 · Q4',editing:false,planning:false}, saveAvailable: true, saveDestination: "This machine · Gallery", hardware: { freeVramMiB: 7000, freeRamBytes: 1e10 } }); expect(JSON.stringify(data)).not.toContain("private");
  });
  it("keeps unverified Drive saving unavailable without blocking local inference", async () => {
    mocks.destination.mockResolvedValue({ destination: { provider: "google-drive" } }); const data = await (await localUIReadiness()).json(); expect(data.ready).toBe(true); expect(data.saveAvailable).toBe(false);
  });
  it("reports runtime offline while retaining the storage summary", async () => {
    mocks.readiness.mockRejectedValue(new Error("private diagnostic")); const data = await (await localUIReadiness()).json(); expect(data.ready).toBe(false); expect(data.saveAvailable).toBe(true); expect(JSON.stringify(data)).not.toContain("diagnostic");
  });
});
