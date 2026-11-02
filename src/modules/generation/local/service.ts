import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getLocalReadiness, inspectLocalBridgeJob, localBridgeConfigured, submitLocalBridgeJob, retrieveLocalOutput } from "@/modules/model-providers/local/bridge";
import { localJobRequestHash, localJobSummary, localSubmissionSchema, type LocalJobRecord } from "./contracts";
import {jobSnapshotForProfile,validateSnapshotIntent,canonicalSnapshot} from "@/modules/model-providers/local/job-snapshot";
import { z } from "zod";
import { localOutputDescriptorSchema, type LocalOutputStatus } from "./output-contract";
import type { LocalFailure } from "@/modules/model-providers/local/failure";
import { localHostRequest } from "@/modules/model-providers/local/host-bridge";

const reply = (error: string, status: number) => Response.json({ error }, { status });
export async function context() {
  if (!localBridgeConfigured()) return { response: reply("Local generation is not enabled.", 404) };
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return { response: reply("Sign in to manage local jobs.", 401) };
  return { client, owner: user.id };
}
export async function load(owner: string, id: string) {
  const { data, error } = await createAdminClient().from("local_generation_jobs")
    .select("*").eq("id", id).eq("owner_id", owner).maybeSingle<LocalJobRecord>();
  if (error) throw new Error("job-storage-unavailable");
  return data;
}
async function checkpoint(job: LocalJobRecord, state: LocalJobRecord["state"], output?: LocalOutputStatus, failure?: LocalFailure) {
  if (output?.descriptor) {
    const descriptor = localOutputDescriptorSchema.parse(output.descriptor);
    if (!job.output_descriptor) {
      const { error } = await createAdminClient().from("local_generation_jobs").update({ output_descriptor: descriptor })
        .eq("id", job.id).eq("owner_id", job.owner_id).is("output_descriptor", null);
      if (error) throw new Error("output-storage-unavailable");
      job = await load(job.owner_id, job.id) ?? job;
    }
    if (!job.output_descriptor || JSON.stringify(localOutputDescriptorSchema.parse(job.output_descriptor)) !== JSON.stringify(descriptor)) {
      throw new Error("local-output-identity-mismatch");
    }
  }
  // Compare-and-swap avoids an older polling response overwriting newer state.
  const { data, error } = await createAdminClient().from("local_generation_jobs")
    .update({ state, updated_at: new Date().toISOString() })
    .eq("id", job.id).eq("owner_id", job.owner_id).eq("state", job.state).select("*").maybeSingle<LocalJobRecord>();
  if (error) throw new Error("job-storage-unavailable");
  const current = data ?? await load(job.owner_id, job.id) ?? job;
  return { ...current, ...(output ? { output_status: output } : {}), ...(failure && current.state === state ? { failure } : {}) };
}
export async function inspectAndCheckpoint(job: LocalJobRecord, cancel = false) {
  const status = await inspectLocalBridgeJob(job, cancel);
  return checkpoint(job, status.state, status.output, status.failure);
}
async function reconcile(job: LocalJobRecord) {
  if (job.state === "pending" || job.state === "submission-unknown") {
    try { return await inspectAndCheckpoint(job); }
    catch (error) {
      if (!(error instanceof Error) || error.message !== "local-bridge-job-not-found") throw error;
    }
    const ready = await getLocalReadiness();
    if (ready.ledgerIdentity !== job.worker_identity) throw new Error("local-worker-ledger-changed");
    // Same durable job token: bridge duplicate admission never dispatches twice.
    const status = await submitLocalBridgeJob(job, ready.epoch);
    return checkpoint(job, status.state, status.output, status.failure);
  }
  return inspectAndCheckpoint(job);
}
async function refreshOutstandingJobs() {
  const { data, error } = await createAdminClient().from("local_generation_jobs").select("*")
    .in("state", ["pending", "queued", "dispatching", "running", "cancel-requested", "submission-unknown"]).limit(5);
  if (error) throw new Error("job-storage-unavailable");
  // Release completed capacity even if its owner's browser was closed.
  // Never submit another owner's pending work from this admission request.
  for (const row of data ?? []) {
    const job = row as LocalJobRecord;
    try { await inspectAndCheckpoint(job); }
    catch { /* Unresolved admissions keep their capacity reservation. */ }
  }
}
export async function submitLocalJob(request: Request) {
  const ctx = await context();
  if (ctx.response) return ctx.response;
  const reader = request.body?.getReader();
  if (!reader) return reply("Invalid local generation request.", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.length;
    if (size > 8192) { await reader.cancel(); return reply("Request exceeds 8 KiB.", 413); }
    chunks.push(value);
  }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return reply("Invalid JSON.", 400); }
  const parsed = localSubmissionSchema.safeParse(body);
  if (!parsed.success) return reply("Unsupported local image parameters.", 400);
  const { intent, idempotencyKey } = parsed.data;
  try {
    const previous = await createAdminClient().from("local_generation_jobs").select("*")
      .eq("owner_id", ctx.owner).eq("submission_key", idempotencyKey).maybeSingle<LocalJobRecord>();
    if (previous.error) return reply("Local job storage unavailable.", 503);
    let job = previous.data;
    if (job && job.request_hash !== localJobRequestHash(intent,job.recipe_snapshot)) return reply("Idempotency key already used with another request.", 409);
    if (!job) {
      const access=await localHostRequest("/host/setup/access",{owner:ctx.owner,...(intent.profile==='qwen-image-2.1-q3-evaluation'?{profile:intent.profile}:{})});
      if(access.status!==200||(access.body as {allowed?:boolean}).allowed!==true)return reply("Accept this model's research terms and finish setup before creating an image.",403);
      await refreshOutstandingJobs();
      const ready = await getLocalReadiness();
      const snapshot=validateSnapshotIntent(intent,jobSnapshotForProfile(intent.profile),ready.packageFingerprint);
      const { data, error } = await createAdminClient().rpc("admit_local_generation_job_v2", {
        p_owner: ctx.owner, p_key: idempotencyKey, p_hash: localJobRequestHash(intent,snapshot), p_intent: intent,p_snapshot:snapshot,
        p_package: ready.packageFingerprint, p_device: ready.deviceId, p_worker: ready.ledgerIdentity,
      });
      if (error) {
        if(/local-runtime-switching|local-runtime-identity-changed/.test(error.message))return reply("Local model is switching or readiness changed. Refresh and retry.",409);
        return reply(error.message.includes("queue-full") ? "Local queue is full." : "Unable to admit local job.", error.message.includes("queue-full") ? 429 : error.message.includes("idempotency-conflict") ? 409 : 503);
      }
      // PostgREST may encode a composite RPC result as a one-row array.
      job = (Array.isArray(data) ? data[0] : data) as LocalJobRecord;
      if (!job?.id || job.owner_id !== ctx.owner || job.request_hash !== localJobRequestHash(intent,snapshot) || canonicalSnapshot(job.recipe_snapshot??null)!==canonicalSnapshot(snapshot)) {
        return reply("Invalid local admission record.", 503);
      }
    }
    try { job = await reconcile(job); }
    catch (error) {
      if (job.state === "pending") job = await checkpoint(job, "submission-unknown");
      if (error instanceof Error && error.message === "local-staging-full") {
        return Response.json({ error: "Local staging is full. Free space or wait for retained results to expire, then retry this job.", job: localJobSummary(job) }, { status: 507 });
      }
    }
    return Response.json({ job: localJobSummary(job) }, { status: 202 });
  } catch { return reply("Local runtime or job storage unavailable.", 503); }
}
export async function manageLocalJob(id: string, cancel = false) {
  const ctx = await context(); if (ctx.response) return ctx.response;
  if (!z.string().uuid().safeParse(id).success) return reply("Job not found.", 404);
  try {
    let job = await load(ctx.owner, id); if (!job) return reply("Job not found.", 404);
    try {
      job = await reconcile(job);
      if (cancel) job = await inspectAndCheckpoint(job, true);
    } catch { return Response.json({ job: localJobSummary(job), reconnecting: true }, { status: cancel ? 503 : 200 }); }
    return Response.json({ job: localJobSummary(job) });
  } catch { return reply("Local job storage unavailable.", 503); }
}
export async function downloadLocalOutput(id: string) {
  const ctx = await context(); if (ctx.response) return ctx.response;
  if (!z.string().uuid().safeParse(id).success) return reply("Job not found.", 404);
  try {
    let job = await load(ctx.owner, id); if (!job) return reply("Job not found.", 404);
    if (job.output_descriptor && Date.parse(job.output_descriptor.expiresAt) <= Date.now()) return reply("This local result has expired.", 410);
    // Downloads inspect an existing job only; they never submit inference.
    job = await inspectAndCheckpoint(job);
    if (job.output_status?.state === "expired") return reply("This local result has expired.", 410);
    if (job.output_status?.state === "invalid") return reply("The local result failed validation.", 422);
    if (job.output_status?.state !== "generated") return reply("The local result is not ready.", 409);
    const bytes = await retrieveLocalOutput(job);
    return new Response(new Uint8Array(bytes), { headers: {
      "Content-Type": "image/png", "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="kavero-${id}.png"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof Error && error.message === "local-output-expired") return reply("This local result has expired.", 410);
    if (error instanceof Error && error.message === "local-output-not-ready") return reply("The local result is not ready.", 409);
    if (error instanceof Error && ["local-output-invalid", "local-output-identity-mismatch", "invalid-local-image"].includes(error.message)) return reply("The local result failed validation.", 422);
    return reply("Local runtime or output storage unavailable. Retry the download when it reconnects.", 503);
  }
}

