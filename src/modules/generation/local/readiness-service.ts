import { localGenerationUIEnabled } from "@/modules/model-providers/local/enabled";
import { createAdminClient } from "@/lib/supabase/admin";
import { getLocalReadiness } from "@/modules/model-providers/local/bridge";
import { context } from "./service";
import { resolveLocalSaveDestination } from "./save-storage";
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
    return Response.json({ ownerId: ctx.owner, ready: true, saveAvailable, saveDestination, hardware: ready.hardware }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ ownerId: ctx.owner, ready: false, saveAvailable, saveDestination }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
