import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { acquireLocalOutputLease, manageLocalOutputLease, retrieveLocalOutput, acknowledgeLocalOutputSaved } from "@/modules/model-providers/local/bridge";
import { validateLocalPNG } from "@/modules/model-providers/local/png";
import { context, load, inspectAndCheckpoint } from "./service";
import { localSaveSummary, sameLocalSaveDestination, type LocalSaveRecord } from "./save-contract";
import { resolveLocalSaveDestination, createLocalSaveMapping, readLocalSaveObject, ensureLocalSaveObject } from "./save-storage";
import type { LocalJobRecord } from "./contracts";

const reply = (error: string, status: number) => Response.json({ error }, { status });
async function loadSave(owner: string, id: string) {
  const { data, error } = await createAdminClient().from("local_generation_saves").select("*")
    .eq("job_id", id).eq("owner_id", owner).maybeSingle<LocalSaveRecord>();
  if (error) throw new Error("local-save-database-unavailable");
  return data;
}
async function savedReply(job: LocalJobRecord, save: LocalSaveRecord) {
  const { data, error } = await createAdminClient().from("generated_images").select("id").eq("id", save.image_id).eq("user_id", job.owner_id).maybeSingle();
  if (error) throw new Error("local-save-database-unavailable");
  // A saved tombstone never recreates deliberately removed Gallery history.
  try { await acknowledgeLocalOutputSaved(job); } catch { /* Retain staging until ordinary expiry if acknowledgement is unavailable. */ }
  return Response.json({ save: { ...localSaveSummary(save), historyRemoved: !data } });
}
async function checkpoint(save: LocalSaveRecord, action: string, mapping?: LocalSaveRecord["object_mapping"]) {
  const { data, error } = await createAdminClient().rpc("checkpoint_local_generation_save", {
    p_owner: save.owner_id, p_job: save.job_id, p_token: save.attempt_token, p_action: action, p_mapping: mapping ?? null,
  });
  if (error) throw new Error(error.message.includes("attempt-expired") ? "local-save-attempt-expired" : "local-save-database-unavailable");
  const row = (Array.isArray(data) ? data[0] : data) as LocalSaveRecord;
  if (!row || row.job_id !== save.job_id || row.owner_id !== save.owner_id) throw new Error("local-save-database-unavailable");
  return row;
}
export async function getLocalSave(id: string) {
  const ctx = await context(); if (ctx.response) return ctx.response;
  if (!z.string().uuid().safeParse(id).success) return reply("Job not found.", 404);
  try {
    const job = await load(ctx.owner, id); if (!job) return reply("Job not found.", 404);
    const save = await loadSave(ctx.owner, id);
    if (save?.state === "saved") return savedReply(job, save);
    return Response.json({ save: save ? localSaveSummary(save) : { state: "unsaved" } });
  } catch { return reply("Local save status unavailable.", 503); }
}
export async function saveLocalOutput(id: string, request: Request) {
  const ctx = await context(); if (ctx.response) return ctx.response;
  if (!z.string().uuid().safeParse(id).success) return reply("Job not found.", 404);
  if (request.body) {
    const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > 1024) { await reader.cancel(); return reply("Invalid save request.", 413); } chunks.push(value); }
    try { if (size && !z.object({}).strict().safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8"))).success) return reply("Invalid save request.", 400); }
    catch { return reply("Invalid save request.", 400); }
  }
  let job: LocalJobRecord | null = null, save: LocalSaveRecord | null = null, leaseToken: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined, renewing = false, lostLease = false;
  const deadline = Date.now() + 90000;
  const assertActive = () => { if (lostLease || Date.now() >= deadline) throw new Error("local-save-attempt-expired"); };
  try {
    job = await load(ctx.owner, id); if (!job) return reply("Job not found.", 404);
    save = await loadSave(ctx.owner, id);
    if (save?.state === "saved") return savedReply(job, save);
    if (save?.state === "saving" && Date.parse(save.lease_until) > Date.now()) return Response.json({ save: localSaveSummary(save) }, { status: 202 });
    if (!job.output_descriptor) {
      job = await inspectAndCheckpoint(job);
      if (!job.output_descriptor || job.output_status?.state !== "generated") return reply("The local result is not available to save.", job.output_status?.state === "expired" ? 410 : job.output_status?.state === "invalid" ? 422 : 409);
    }
    const runtime = await resolveLocalSaveDestination(ctx.owner, createAdminClient()); assertActive();
    // Normal Local exposure must not expose an unaccepted Drive save transport.
    // This server-only override belongs solely to the isolated live proof app.
    if (runtime.destination.provider === "google-drive" && process.env.KAVERO_LOCAL_GENERATION_ENABLED === "1"
      && process.env.KAVERO_LOCAL_GENERATION_DRIVE_EVALUATION !== "1") {
      return reply("Local saving to Google Drive is not available yet. Download this result instead.", 503);
    }
    const token = randomUUID();
    const claimed = await createAdminClient().rpc("claim_local_generation_save", { p_owner: ctx.owner, p_job: id, p_token: token, p_destination: runtime.destination });
    if (claimed.error) throw new Error(claimed.error.message.includes("destination-changed") ? "local-save-destination-changed" : "local-save-database-unavailable");
    save = (Array.isArray(claimed.data) ? claimed.data[0] : claimed.data) as LocalSaveRecord;
    if (!save || save.job_id !== id || save.owner_id !== ctx.owner || save.sha256 !== job.output_descriptor.sha256) throw new Error("local-save-database-unavailable");
    if (save.state === "saved") return savedReply(job, save);
    if (save.attempt_token !== token) return Response.json({ save: localSaveSummary(save) }, { status: 202 });
    const attempt = save;
    heartbeat = setInterval(async () => {
      if (renewing || Date.now() >= deadline) { if (Date.now() >= deadline) lostLease = true; return; }
      renewing = true;
      try { await checkpoint(attempt, "renew"); if (leaseToken) await manageLocalOutputLease(job!, leaseToken); }
      catch { lostLease = true; }
      finally { renewing = false; }
    }, 15000);
    if (!save.object_mapping) {
      const mapping = await createLocalSaveMapping(save, job, runtime); assertActive();
      save = await checkpoint(save, "mapping", mapping); assertActive();
    }
    const mapping = save.object_mapping!;
    // Existing immutable final objects allow DB/metadata recovery even when
    // native staging has expired or the host is disconnected.
    let bytes = await readLocalSaveObject(runtime, save, mapping.imageRef, save.sha256, job.output_descriptor.sizeBytes); assertActive();
    if (!bytes) {
      const lease = await acquireLocalOutputLease(job); leaseToken = lease.token; assertActive();
      bytes = await retrieveLocalOutput(job, leaseToken); assertActive();
    }
    const info = validateLocalPNG(bytes);
    if (info.sha256 !== save.sha256) throw new Error("local-save-object-conflict");
    await ensureLocalSaveObject(runtime, save, mapping.imageRef, bytes, assertActive);
    await ensureLocalSaveObject(runtime, save, mapping.metadataRef, Buffer.from(mapping.metadataBody, "utf8"), assertActive);
    const currentDestination = await resolveLocalSaveDestination(ctx.owner, createAdminClient()); assertActive();
    if (!sameLocalSaveDestination(currentDestination.destination, save.destination)) throw new Error("local-save-destination-changed");
    assertActive(); save = await checkpoint(save, "finish");
    return await savedReply(job, save);
  } catch (error) {
    if (job) {
      try { const latest = await loadSave(ctx.owner, id); if (latest?.state === "saved") return await savedReply(job, latest); } catch { /* Preserve uncertain publication for reconnection. */ }
    }
    if (save) { try { save = await checkpoint(save, "fail"); } catch { /* Another attempt or a committed save owns the durable record. */ } }
    const reason = error instanceof Error ? error.message : "";
    const status = reason === "local-output-expired" ? 410 : ["local-save-destination-changed", "local-save-object-conflict", "local-save-attempt-expired"].includes(reason) ? 409 : 503;
    return Response.json({ error: reason === "local-save-destination-changed" ? "The save destination changed. Restore its original configuration to retry this save."
      : reason === "local-output-expired" ? "The staged result expired before saving. No generation was repeated."
      : "Saving could not be confirmed. The existing result can be downloaded or this save retried when storage reconnects.", ...(save ? { save: localSaveSummary(save) } : {}) }, { status });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (job && leaseToken) { try { await manageLocalOutputLease(job, leaseToken, true); } catch { /* Bounded abandoned lease expires on the host. */ } }
  }
}
