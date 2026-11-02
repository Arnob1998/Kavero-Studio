import { localGenerationEnabled } from "./enabled";
import { z } from "zod";
import { signLocalBridgeRequest } from "./signature";
import { localJobStates, type LocalJobRecord } from "@/modules/generation/local/contracts";
import { localOutputStatusSchema, localOutputDescriptorSchema } from "@/modules/generation/local/output-contract";
import { LOCAL_IMAGE_MAX_BYTES, validateLocalPNG } from "./png";
import { LOCAL_FAILURE_CODES, LOCAL_FAILURE_STAGES } from "./failure";
import {canonicalSnapshot,validateSnapshotIntent} from "./job-snapshot";

const readinessSchema = z.object({
  ready: z.literal(true), epoch: z.string().uuid(), ledgerIdentity: z.string().uuid(),
  packageFingerprint: z.string().regex(/^[a-f0-9]{64}$/), deviceId: z.string().min(1),
  hardware: z.object({ freeVramMiB: z.number().nonnegative(), freeRamBytes: z.number().nonnegative() }).optional(),
});
const failureSchema = z.object({ code: z.enum(LOCAL_FAILURE_CODES), stage: z.enum(LOCAL_FAILURE_STAGES), recordedAt: z.string().datetime() }).strict();
const statusSchema = z.object({ id: z.string().uuid(), state: z.enum(localJobStates), ledgerIdentity: z.string().uuid(), output: localOutputStatusSchema, failure: failureSchema.optional() });

export function localBridgeConfigured() {
  return localGenerationEnabled();
}
async function bridgeResponse(path: string, body: unknown) {
  if (!localBridgeConfigured()) throw new Error("local-generation-disabled");
  const url = new URL(process.env.KAVERO_LOCAL_BRIDGE_URL ?? "http://127.0.0.1:8791");
  // Only a fixed operator-controlled host bridge, never a browser-supplied URL.
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "host.docker.internal"].includes(url.hostname)
    || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("local-bridge-config-invalid");
  const secret = process.env.KAVERO_LOCAL_BRIDGE_SECRET ?? "";
  if (secret.length < 64) throw new Error("local-bridge-secret-missing");
  const encoded = JSON.stringify(body);
  const response = await fetch(new URL(path, url), {
    method: "POST", headers: { "content-type": "application/json", ...signLocalBridgeRequest(secret, "POST", path, encoded) },
    body: encoded, signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(({ 404: "local-bridge-job-not-found", 410: "local-output-expired", 409: "local-output-not-ready", 422: "local-output-invalid", 507: "local-staging-full" } as Record<number, string>)[response.status] ?? "local-bridge-unavailable");
  }
  return response;
}
async function boundedResponse(response: Response, max: number) {
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body?.getReader();
  if (!reader) throw new Error("local-bridge-response-invalid");
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > max) { await reader.cancel(); throw new Error("local-bridge-response-invalid"); }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
export async function localBridgeRequest(path: string, body: unknown) {
  return JSON.parse((await boundedResponse(await bridgeResponse(path, body), 8192)).toString("utf8")) as unknown;
}
function verifyJobStatus(job: LocalJobRecord, result: z.infer<typeof statusSchema>) {
  if (result.id !== job.id || result.ledgerIdentity !== job.worker_identity) throw new Error("local-bridge-job-mismatch");
  const descriptor = result.output.descriptor;
  if(job.recipe_snapshot)validateSnapshotIntent(job.intent,job.recipe_snapshot,job.package_fingerprint);
  if(descriptor&&canonicalSnapshot(descriptor.recipeSnapshot??null)!==canonicalSnapshot(job.recipe_snapshot??null))throw new Error("local-output-identity-mismatch");
  if (descriptor && (descriptor.jobId !== job.id || descriptor.ownerId !== job.owner_id || descriptor.ledgerIdentity !== job.worker_identity
    || descriptor.requestHash !== job.request_hash || descriptor.packageFingerprint !== job.package_fingerprint || descriptor.deviceId !== job.device_id)) throw new Error("local-output-identity-mismatch");
  return result;
}
export async function getLocalReadiness() {
  return readinessSchema.parse(await localBridgeRequest("/ready", {}));
}
export async function submitLocalBridgeJob(job: LocalJobRecord, epoch: string) {
  const result = statusSchema.parse(await localBridgeRequest("/submit", {
    id: job.id, owner: job.owner_id, key: job.submission_key, intent: job.intent,
    hash: job.request_hash, fingerprint: job.package_fingerprint, device: job.device_id, ledgerIdentity: job.worker_identity, epoch,
    ...(job.recipe_snapshot?{recipeSnapshot:validateSnapshotIntent(job.intent,job.recipe_snapshot,job.package_fingerprint)}:{}),
  }));
  return verifyJobStatus(job, result);
}
export async function inspectLocalBridgeJob(job: LocalJobRecord, cancel = false) {
  const result = statusSchema.parse(await localBridgeRequest(cancel ? "/cancel" : "/status", { id: job.id, owner: job.owner_id }));
  return verifyJobStatus(job, result);
}
export async function retrieveLocalOutput(job: LocalJobRecord, token?: string) {
  const response = await bridgeResponse("/output", { id: job.id, owner: job.owner_id, ledgerIdentity: job.worker_identity, ...(token ? { token } : {}) });
  if (response.headers.get("content-type") !== "image/png") { await response.body?.cancel(); throw new Error("local-output-invalid"); }
  const bytes = await boundedResponse(response, LOCAL_IMAGE_MAX_BYTES);
  const info = validateLocalPNG(bytes);
  if (!job.output_descriptor || info.sha256 !== job.output_descriptor.sha256 || info.sizeBytes !== job.output_descriptor.sizeBytes
    || response.headers.get("x-kavero-sha256") !== info.sha256) throw new Error("local-output-identity-mismatch");
  return bytes;
}
const leaseSchema = z.object({ token: z.string().uuid(), expiresAt: z.string().datetime(), descriptor: localOutputDescriptorSchema });
export async function acquireLocalOutputLease(job: LocalJobRecord) {
  const lease = leaseSchema.parse(await localBridgeRequest("/lease", { id: job.id, owner: job.owner_id, ledgerIdentity: job.worker_identity }));
  verifyJobStatus(job, { id: job.id, state: job.state, ledgerIdentity: job.worker_identity, output: { state: "generated", descriptor: lease.descriptor } });
  if (!job.output_descriptor || JSON.stringify(localOutputDescriptorSchema.parse(job.output_descriptor)) !== JSON.stringify(lease.descriptor)) throw new Error("local-output-identity-mismatch");
  return lease;
}
export async function manageLocalOutputLease(job: LocalJobRecord, token: string, release = false) {
  return localBridgeRequest(release ? "/lease/release" : "/lease/renew", { id: job.id, owner: job.owner_id, ledgerIdentity: job.worker_identity, token });
}
export async function acknowledgeLocalOutputSaved(job: LocalJobRecord) {
  if (!job.output_descriptor) throw new Error("local-output-not-ready");
  return localBridgeRequest("/saved", { id: job.id, owner: job.owner_id, ledgerIdentity: job.worker_identity, sha256: job.output_descriptor.sha256 });
}
