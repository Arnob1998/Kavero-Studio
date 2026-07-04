import type { SupabaseClient } from "@supabase/supabase-js";
import type { GalleryRun } from "../types";
import { withResolvedGalleryImageStorageRefs } from "../utils/gallery-storage-refs";

export async function getGalleryData(supabase: SupabaseClient, userId: string) {
  const [{ data: connection }, { data: runs }, { data: metadata }, { count: generationCount }] =
    await Promise.all([
      supabase
        .from("user_drive_connections")
        .select("folder_name, google_email, status")
        .eq("user_id", userId)
        .eq("provider", "google-drive")
        .eq("status", "active")
        .maybeSingle(),
      supabase
        .from("generation_runs")
        .select(
          "id, prompt, model_id, model_label, settings, generated_text, created_at, generated_images(id, variant, mime_type, drive_file_id, drive_file_name, drive_web_view_link, drive_metadata_file_id, drive_status, storage_provider, storage_kind, storage_status, storage_ref, metadata_storage_ref, storage_metadata, storage_external_id, storage_external_url, created_at)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase.from("user_metadata").select("plan").eq("user_id", userId).maybeSingle(),
      supabase
        .from("generation_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

  return {
    connection,
    runs: normalizeGalleryRuns((runs ?? []) as GalleryRun[]),
    metadata,
    generationCount,
  };
}

function normalizeGalleryRuns(runs: GalleryRun[]): GalleryRun[] {
  return runs.map((run) => {
    if (!run.generated_images) return run;

    return {
      ...run,
      generated_images: run.generated_images.map(withResolvedGalleryImageStorageRefs),
    };
  });
}
