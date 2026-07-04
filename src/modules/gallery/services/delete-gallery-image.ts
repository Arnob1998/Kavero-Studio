import type { SupabaseClient } from "@supabase/supabase-js";
import { deleteStorageObjects } from "@/modules/storage/dispatch/storage-object-dispatch";
import { getRuntimeManagedStorageDispatchDependencies } from "@/modules/storage/managed/runtime";
import { deleteGoogleDriveGeneratedImageFiles } from "@/modules/storage/providers/google-drive/generated-image-storage";
import { resolveGeneratedImageDeleteRefs } from "../utils/gallery-delete-storage-refs";

export type DeleteGalleryImageResult =
  | { success: false; status: number; error: string }
  | { success: true; removed: boolean; driveFilesDeleted: boolean };

export async function deleteGalleryImage(
  supabase: SupabaseClient,
  userId: string,
  imageId: string,
  deleteDriveFiles: boolean
): Promise<DeleteGalleryImageResult> {
  const { data: image, error: imageError } = await supabase
    .from("generated_images")
    .select(
      "id, drive_file_id, drive_file_name, drive_web_view_link, drive_metadata_file_id, drive_status, storage_provider, storage_kind, storage_status, storage_ref, metadata_storage_ref",
    )
    .eq("id", imageId)
    .eq("user_id", userId)
    .maybeSingle();

  if (imageError) {
    console.error("Unable to load gallery image for deletion", imageError);
    return { success: false, status: 500, error: "Unable to load gallery image." };
  }

  if (!image) {
    return { success: false, status: 404, error: "Not found" };
  }

  if (deleteDriveFiles) {
    const { googleDriveFileIds, managedObjectRefs, unsupportedRefs } =
      resolveGeneratedImageDeleteRefs(image);
    if (unsupportedRefs.length > 0) {
      console.warn("Skipping unsupported gallery image storage refs during delete", unsupportedRefs);
    }

    const driveDelete =
      googleDriveFileIds.length > 0
        ? await deleteGoogleDriveGeneratedImageFiles({
            userId,
            fileIds: googleDriveFileIds,
          })
        : null;

    if (driveDelete && !driveDelete.success && driveDelete.reason === "missing-token") {
      return {
        success: false,
        status: 502,
        error: "Unable to refresh Google Drive access. Reconnect Drive and try again.",
      };
    }

    if (driveDelete && !driveDelete.success) {
      console.error("Unable to delete gallery image files from Google Drive", driveDelete.failures);
      return {
        success: false,
        status: 502,
        error: "Unable to delete image from Google Drive. Gallery record was kept.",
      };
    }

    if (managedObjectRefs.length > 0) {
      const dependenciesResult = getRuntimeManagedStorageDispatchDependencies();
      if (!dependenciesResult.ok) {
        console.error("Managed gallery image storage delete is not configured", dependenciesResult.error);
        return {
          success: false,
          status: 502,
          error: "Unable to delete image from managed storage. Gallery record was kept.",
        };
      }

      const managedDelete = await deleteStorageObjects({
        userId,
        refs: managedObjectRefs,
        dependencies: dependenciesResult.dependencies,
      });
      if (managedDelete.unsupportedRefs.length > 0) {
        console.warn(
          "Skipping unsupported managed gallery image storage refs during delete",
          managedDelete.unsupportedRefs,
        );
      }
      if (!managedDelete.ok) {
        console.error("Unable to delete gallery image files from managed storage", managedDelete);
        return {
          success: false,
          status: 502,
          error: "Unable to delete image from managed storage. Gallery record was kept.",
        };
      }
    }
  }

  const { error: deleteError } = await supabase
    .from("generated_images")
    .delete()
    .eq("id", image.id)
    .eq("user_id", userId);

  if (deleteError) {
    console.error("Unable to delete gallery image row", deleteError);
    return { success: false, status: 500, error: "Unable to remove gallery image." };
  }

  return { success: true, removed: true, driveFilesDeleted: deleteDriveFiles };
}
