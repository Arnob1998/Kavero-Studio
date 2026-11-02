import { localGenerationUIEnabled } from "@/modules/model-providers/local/enabled";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLocalReadiness } from "@/modules/model-providers/local/bridge";
import { context } from "./service";
import { resolveLocalSaveDestination } from "./save-storage";
import {existingJobSnapshot,q3JobSnapshot} from "@/modules/model-providers/local/job-snapshot";
import {localProfile,localImageLimits} from "@/modules/model-providers/local/browser-profiles";
import {localHostRequest} from "@/modules/model-providers/local/host-bridge";
export function localUIEnabled() {
  return localGenerationUIEnabled();
}
export async function localUIReadiness() {
  if (!localUIEnabled()) return Response.json({ error: "Local generation is not enabled." }, { status: 404 });
  const ctx = await context(); if (ctx.response) return ctx.response;
  let saveAvailable = false, saveDestination = "Storage unavailable";
  try {
    const { destination } = await resolveLocalSaveDestination(ctx.owner!, createAdminClient());
    if (destination.provider === "kavero-managed") {
      saveAvailable = true;
      saveDestination = destination.backendId === "local-filesystem" ? "This machine · Gallery" : "Supabase Storage · Gallery";
    } else saveDestination = "Google Drive · local saving not verified yet";
  } catch { /* A download remains useful when configured storage is offline. */ }
  try {
    const ready = await getLocalReadiness();
    const snapshot=[existingJobSnapshot(),q3JobSnapshot()].find(model=>model.packageFingerprint===ready.packageFingerprint);
    const model=localProfile(snapshot?.profile);
    const access=model?await localHostRequest('/host/setup/access',{owner:ctx.owner,...(model.profile==='qwen-image-2.1-q3-evaluation'?{profile:model.profile}:{})}):null;
    const allowed=access?.status===200&&(access.body as {allowed?:boolean}).allowed===true;
    return Response.json({ ownerId: ctx.owner, ready: !!model&&allowed, model:model?{profile:model.profile,label:model.label,...localImageLimits}:null, saveAvailable, saveDestination, hardware: ready.hardware }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ ownerId: ctx.owner, ready: false, saveAvailable, saveDestination }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
