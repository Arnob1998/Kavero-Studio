// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { inspectLocalBridgeJob, retrieveLocalOutput } from "./bridge";
import { validateLocalPNG } from "./png";
import type { LocalJobRecord } from "@/modules/generation/local/contracts";
// @ts-expect-error Native fixture has no declarations.
import { pngFixture } from "../../../../scripts/local-generation/png-fixture.mjs";
const bytes = pngFixture();
const job: LocalJobRecord = { id: "11111111-1111-4111-8111-111111111111", owner_id: "22222222-2222-4222-8222-222222222222",
  submission_key: "33333333-3333-4333-8333-333333333333", request_hash: "a".repeat(64), package_fingerprint: "b".repeat(64),
  device_id: "gpu", worker_identity: "44444444-4444-4444-8444-444444444444", state: "generated-unvalidated", created_at: "2099-01-01T00:00:00.000Z",
  intent: { profile: "qwen-image-2.1-q4-evaluation", prompt: "A vase", width: 512, height: 512, count: 1 } };
job.output_descriptor = { ...validateLocalPNG(bytes), jobId: job.id, ownerId: job.owner_id, ledgerIdentity: job.worker_identity,
  requestHash: job.request_hash, packageFingerprint: job.package_fingerprint, deviceId: job.device_id,
  generatedAt: "2099-01-01T00:00:00.000Z", expiresAt: "2099-01-02T00:00:00.000Z" };
const fetcher = vi.fn();
beforeEach(() => { vi.stubEnv("KAVERO_LOCAL_GENERATION_INTERNAL", "1"); vi.stubEnv("KAVERO_LOCAL_BRIDGE_SECRET", "s".repeat(64));
  vi.stubEnv("KAVERO_LOCAL_BRIDGE_URL", "http://127.0.0.1:8791"); vi.stubGlobal("fetch", fetcher); fetcher.mockReset(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("Signed bounded output transport", () => {
  it("accepts bounded failure codes but rejects raw diagnostic fields", async () => { const status = { id: job.id, state: "failed", ledgerIdentity: job.worker_identity, output: { state: "invalid", descriptor: null }, failure: { stage: "hardware", code: "gpu-memory-low", recordedAt: new Date().toISOString() } }; fetcher.mockResolvedValueOnce(Response.json(status)); expect((await inspectLocalBridgeJob(job)).failure?.code).toBe("gpu-memory-low"); fetcher.mockResolvedValueOnce(Response.json({ ...status, failure: { ...status.failure, stderr: "private" } })); await expect(inspectLocalBridgeJob(job)).rejects.toThrow(); });
  it("signs the owner/job/ledger body and checks decoded bytes against the frozen checksum", async () => {
    fetcher.mockResolvedValue(new Response(bytes, { headers: { "content-type": "image/png", "x-kavero-sha256": job.output_descriptor!.sha256 } }));
    expect(await retrieveLocalOutput(job)).toEqual(bytes);
    const [url, options] = fetcher.mock.calls[0]; expect(url.pathname).toBe("/output");
    expect(JSON.parse(options.body)).toEqual({ id: job.id, owner: job.owner_id, ledgerIdentity: job.worker_identity });
    expect(options.headers["x-kavero-signature"]).toMatch(/^[a-f0-9]{64}$/); expect(options.redirect).toBe("error");
  });
  it("rejects MIME spoofing and a valid but different image", async () => {
    fetcher.mockResolvedValueOnce(new Response(bytes, { headers: { "content-type": "text/html" } })); await expect(retrieveLocalOutput(job)).rejects.toThrow("local-output-invalid");
    fetcher.mockResolvedValueOnce(new Response(pngFixture({ color: 7 }), { headers: { "content-type": "image/png", "x-kavero-sha256": job.output_descriptor!.sha256 } }));
    await expect(retrieveLocalOutput(job)).rejects.toThrow("local-output-identity-mismatch");
  });
  it("caps chunked responses despite missing or lying content length", async () => {
    let cancelled = false;
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } });
    fetcher.mockResolvedValue(new Response(body, { headers: { "content-type": "image/png", "content-length": "1" } }));
    await expect(retrieveLocalOutput(job)).rejects.toThrow("local-bridge-response-invalid"); expect(cancelled).toBe(true);
  });
  it.each(["ownerId", "jobId", "ledgerIdentity", "requestHash", "packageFingerprint", "deviceId"])("rejects mismatched %s attribution", async field => {
    const descriptor = { ...job.output_descriptor!, [field]: field.endsWith("Hash") || field === "packageFingerprint" ? "d".repeat(64) : field === "deviceId" ? "other" : "55555555-5555-4555-8555-555555555555" };
    fetcher.mockResolvedValue(Response.json({ id: job.id, state: job.state, ledgerIdentity: job.worker_identity, output: { state: "generated", descriptor } }));
    await expect(inspectLocalBridgeJob(job)).rejects.toThrow("local-output-identity-mismatch");
  });
  it("rejects a replaced ledger even when the job UUID is reused", async () => {
    fetcher.mockResolvedValue(Response.json({ id: job.id, state: job.state, ledgerIdentity: "55555555-5555-4555-8555-555555555555", output: { state: "pending", descriptor: null } }));
    await expect(inspectLocalBridgeJob(job)).rejects.toThrow("local-bridge-job-mismatch");
  });
});
