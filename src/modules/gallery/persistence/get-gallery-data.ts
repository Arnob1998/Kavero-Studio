import type { SupabaseClient } from "@supabase/supabase-js";
import type { GalleryRun } from "../types";
import { withResolvedGalleryImageStorageRefs } from "../utils/gallery-storage-refs";

export const GALLERY_PAGE_SIZE = 24;

export async function getGalleryData(supabase: SupabaseClient, userId: string, options: { page?: string; generationId?: string } = {}) {
  const { count: generationCount, error: countError } = await supabase.from("generation_runs")
    .select("id", { count: "exact", head: true }).eq("user_id", userId);
  if (countError) throw new Error("Unable to load Gallery history.");
  const totalPages = Math.max(1, Math.ceil((generationCount ?? 0) / GALLERY_PAGE_SIZE));
  const requestedPage = Number(options.page);
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;
  const [{ data: connection }, { data: runs, error: runsError }] =
    await Promise.all([
      supabase
        .from("user_drive_connections")
        .select("folder_name, google_email, status")
        .eq("user_id", userId)
        .eq("provider", "google-drive")
        .eq("status", "active")
        .maybeSingle(),
      (() => {
        const query = supabase.from("generation_runs").select(
          "id, prompt, model_id, model_label, settings, generated_text, created_at, generated_images(id, variant, mime_type, drive_file_id, drive_file_name, drive_web_view_link, drive_metadata_file_id, drive_status, storage_provider, storage_kind, storage_status, storage_ref, metadata_storage_ref, storage_metadata, storage_external_id, storage_external_url, created_at)",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false }).order("id", { ascending: false });
        return options.generationId
          ? query.eq("id", options.generationId)
          : query.range((page - 1) * GALLERY_PAGE_SIZE, page * GALLERY_PAGE_SIZE - 1);
      })(),
    ]);

  if (runsError) throw new Error("Unable to load Gallery history.");
  return {
    page, totalPages,
    connection,
    runs: normalizeGalleryRuns((runs ?? []) as GalleryRun[]),
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
