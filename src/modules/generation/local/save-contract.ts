import type { StoredObjectRef } from "@/modules/storage/storage-provider";
export type LocalSaveDestination =
  | { provider: "kavero-managed"; backendId: "supabase-storage" | "local-filesystem"; location: string }
  | { provider: "google-drive"; connectionId: string; email: string | null; folderId: string };
export type LocalSaveMapping = { imageRef: StoredObjectRef; metadataRef: StoredObjectRef; metadataBody: string };
export type LocalSaveRecord = {
  job_id: string; owner_id: string; generation_id: string; image_id: string; sha256: string;
  destination: LocalSaveDestination; object_mapping: LocalSaveMapping | null;
  state: "saving" | "save-failed" | "saved"; attempt_token: string; lease_until: string; created_at: string;
};
export function localSaveSummary(save: LocalSaveRecord) {
  return { state: save.state, generationId: save.generation_id, imageId: save.image_id,
    storageProvider: save.destination.provider, ...(save.destination.provider === "kavero-managed" ? { storageBackend: save.destination.backendId } : {}) };
}
export function sameLocalSaveDestination(a: LocalSaveDestination, b: LocalSaveDestination) {
  // JSONB changes object key order; compare the primitive identity fields
  // canonically rather than mistaking a round trip for a destination change.
  const canonical = (value: LocalSaveDestination) => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
  return canonical(a) === canonical(b);
}
