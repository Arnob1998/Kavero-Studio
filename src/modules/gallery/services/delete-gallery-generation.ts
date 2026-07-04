import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteStorageObjects } from "@/modules/storage/dispatch/storage-object-dispatch";
import { getRuntimeManagedStorageDispatchDependencies } from "@/modules/storage/managed/runtime";
import { deleteGoogleDriveGeneratedImageFiles } from "@/modules/storage/providers/google-drive/generated-image-storage";
import { resolveGeneratedImagesDeleteRefs } from "../utils/gallery-delete-storage-refs";

export type DeleteGalleryGenerationResult =
  | { success: false; status: number; error: string }
  | { success: true; removed: boolean; removedRecords: number; driveFilesDeleted: boolean };

export async function deleteGalleryGeneration(
  supabase: SupabaseClient,
  userId: string,
  generationId: string,
  deleteDriveFiles: boolean
): Promise<DeleteGalleryGenerationResult> {
  const { data: images, error: imageError } = await supabase
    .from("generated_images")
    .select(
      "id, drive_file_id, drive_file_name, drive_web_view_link, drive_metadata_file_id, drive_status, storage_provider, storage_kind, storage_status, storage_ref, metadata_storage_ref",
    )
    .eq("generation_id", generationId)
    .eq("user_id", userId);

  if (imageError) {
    console.error("Unable to load gallery generation for deletion", imageError);
    return { success: false, status: 500, error: "Unable to load gallery folder." };
  }

  if (!images?.length) {
    return { success: false, status: 404, error: "Not found" };
  }

  if (deleteDriveFiles) {
    const { googleDriveFileIds, managedObjectRefs, unsupportedRefs } =
      resolveGeneratedImagesDeleteRefs(images);
    if (unsupportedRefs.length > 0) {
      console.warn("Skipping unsupported gallery generation storage refs during delete", unsupportedRefs);
    }

    const driveDelete =
      googleDriveFileIds.length > 0
        ? await deleteGoogleDriveGeneratedImageFiles({ userId, fileIds: googleDriveFileIds })
        : null;

    if (driveDelete && !driveDelete.success && driveDelete.reason === "missing-token") {
      return {
        success: false,
        status: 502,
        error: "Unable to refresh Google Drive access. Reconnect Drive and try again.",
      };
    }

    if (driveDelete && !driveDelete.success) {
      console.error("Unable to delete gallery generation files from Google Drive", driveDelete.failures);
      return {
        success: false,
        status: 502,
        error: "Unable to delete folder files from Google Drive. Gallery records were kept.",
      };
    }

    if (managedObjectRefs.length > 0) {
      const dependenciesResult = getRuntimeManagedStorageDispatchDependencies();
      if (!dependenciesResult.ok) {
        console.error("Managed gallery generation storage delete is not configured", dependenciesResult.error);
        return {
          success: false,
          status: 502,
          error: "Unable to delete folder files from managed storage. Gallery records were kept.",
        };
      }

      const managedDelete = await deleteStorageObjects({
        userId,
        refs: managedObjectRefs,
        dependencies: dependenciesResult.dependencies,
      });
      if (managedDelete.unsupportedRefs.length > 0) {
        console.warn(
          "Skipping unsupported managed gallery generation storage refs during delete",
          managedDelete.unsupportedRefs,
        );
      }
      if (!managedDelete.ok) {
        console.error("Unable to delete gallery generation files from managed storage", managedDelete);
        return {
          success: false,
          status: 502,
          error: "Unable to delete folder files from managed storage. Gallery records were kept.",
        };
      }
    }
  }

  const { error: deleteError } = await supabase
    .from("generation_runs")
    .delete()
    .eq("id", generationId)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("Unable to delete gallery generation rows", deleteError);
    return { success: false, status: 500, error: "Unable to remove gallery folder." };
  }

  return {
    success: true,
    removed: true,
    removedRecords: images.length,
    driveFilesDeleted: deleteDriveFiles,
  };
}
