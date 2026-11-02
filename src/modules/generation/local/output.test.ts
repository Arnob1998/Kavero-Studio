// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LocalJobRecord } from "./contracts";
import type { LocalOutputDescriptor } from "./output-contract";
const mock = vi.hoisted(() => ({ enabled: true, owner: "11111111-1111-4111-8111-111111111111" as string | null,
  record: null as LocalJobRecord | null, inspect: vi.fn(), retrieve: vi.fn(), submit: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mock.owner ? { id: mock.owner } : null }, error: null }) } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mock.admin }));
vi.mock("@/modules/model-providers/local/bridge", () => ({ localBridgeConfigured: () => mock.enabled, inspectLocalBridgeJob: mock.inspect,
  retrieveLocalOutput: mock.retrieve, submitLocalBridgeJob: mock.submit, getLocalReadiness: vi.fn() }));
import { downloadLocalOutput } from "./service";
const id = "22222222-2222-4222-8222-222222222222";
const descriptor: LocalOutputDescriptor = {
  jobId: id, ownerId: "11111111-1111-4111-8111-111111111111", ledgerIdentity: "33333333-3333-4333-8333-333333333333",
  requestHash: "a".repeat(64), packageFingerprint: "b".repeat(64), deviceId: "gpu", sha256: "c".repeat(64),
  sizeBytes: 3, width: 512, height: 512, mimeType: "image/png",
  generatedAt: "2099-01-01T00:00:00.000Z", expiresAt: "2099-01-02T00:00:00.000Z",
};
beforeEach(() => {
  vi.clearAllMocks(); mock.enabled = true; mock.owner = descriptor.ownerId;
  mock.record = { id, owner_id: descriptor.ownerId, submission_key: id, request_hash: descriptor.requestHash,
    intent: { profile: "qwen-image-2.1-q4-evaluation", prompt: "A vase", width: 512, height: 512, count: 1 },
    package_fingerprint: descriptor.packageFingerprint, device_id: descriptor.deviceId, worker_identity: descriptor.ledgerIdentity,
    state: "generated-unvalidated", created_at: descriptor.generatedAt, output_descriptor: descriptor };
  mock.inspect.mockResolvedValue({ id, state: "generated-unvalidated", output: { state: "generated", descriptor } });
  mock.retrieve.mockResolvedValue(Buffer.from([1, 2, 3]));
  mock.admin.mockImplementation(() => ({ from: () => {
    const filters: Record<string, unknown> = {}; let update: Record<string, unknown> | null = null;
    const result = () => {
      const match = mock.record && mock.record.id === filters.id && mock.record.owner_id === filters.owner_id;
      if (!match) return { data: null, error: null };
      if (update && (filters.output_descriptor !== null || mock.record?.output_descriptor == null)) mock.record = { ...mock.record!, ...update };
      return { data: mock.record, error: null };
    };
    const chain = { select: () => chain, eq: (key: string, value: unknown) => { filters[key] = value; return chain; },
      is: (key: string, value: unknown) => { filters[key] = value; return chain; }, update: (value: Record<string, unknown>) => { update = value; return chain; },
      maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return chain;
  } }));
});
describe("Owner-only local downloads", () => {
  it("keeps disabled/anonymous requests away from database and bridge", async () => {
    mock.enabled = false; expect((await downloadLocalOutput(id)).status).toBe(404);
    mock.enabled = true; mock.owner = null; expect((await downloadLocalOutput(id)).status).toBe(401);
    expect(mock.admin).not.toHaveBeenCalled(); expect(mock.inspect).not.toHaveBeenCalled();
  });
  it("rejects another owner's job and invalid paths before runtime traffic", async () => {
    mock.owner = "44444444-4444-4444-8444-444444444444";
    expect((await downloadLocalOutput(id)).status).toBe(404);
    expect((await downloadLocalOutput("../../runtime/final.png")).status).toBe(404);
    expect(mock.inspect).not.toHaveBeenCalled(); expect(mock.retrieve).not.toHaveBeenCalled();
  });
  it("returns an attachment without resubmission on repeated downloads", async () => {
    for (let i = 0; i < 2; i++) {
      const response = await downloadLocalOutput(id); expect(response.status).toBe(200);
      expect(response.headers.get("content-disposition")).toContain(id + ".png");
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect(mock.submit).not.toHaveBeenCalled();
  });
  it.each([["pending", 409], ["invalid", 422], ["expired", 410]])("reports %s without reading bytes", async (state, status) => {
    mock.inspect.mockResolvedValue({ id, state: "generated-unvalidated", output: { state, descriptor } });
    expect((await downloadLocalOutput(id)).status).toBe(status); expect(mock.retrieve).not.toHaveBeenCalled();
  });
  it("reports persisted expiry while the host is disconnected", async () => {
    mock.record!.output_descriptor = { ...descriptor, generatedAt: "2020-01-01T00:00:00.000Z", expiresAt: "2020-01-02T00:00:00.000Z" };
    expect((await downloadLocalOutput(id)).status).toBe(410); expect(mock.inspect).not.toHaveBeenCalled();
  });
  it("stores the first verified descriptor before retrieving bytes", async () => {
    mock.record!.output_descriptor = null;
    expect((await downloadLocalOutput(id)).status).toBe(200); expect(mock.record!.output_descriptor).toEqual(descriptor);
    expect(mock.retrieve.mock.calls[0][0].output_descriptor).toEqual(descriptor);
  });
  it("rejects a changed descriptor without replacing the saved checksum", async () => {
    mock.inspect.mockResolvedValue({ id, state: "generated-unvalidated", output: { state: "generated", descriptor: { ...descriptor, sha256: "d".repeat(64) } } });
    expect((await downloadLocalOutput(id)).status).toBe(422); expect(mock.record!.output_descriptor).toEqual(descriptor);
    expect(mock.retrieve).not.toHaveBeenCalled();
  });
  it("handles expiry between status and retrieval and disconnected host without inference", async () => {
    mock.retrieve.mockRejectedValueOnce(new Error("local-output-expired")); expect((await downloadLocalOutput(id)).status).toBe(410);
    mock.retrieve.mockRejectedValueOnce(new Error("local-bridge-unavailable")); expect((await downloadLocalOutput(id)).status).toBe(503);
    expect(mock.submit).not.toHaveBeenCalled();
  });
});
