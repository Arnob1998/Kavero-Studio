import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import type { GalleryImage } from "../types";
import {
  getGalleryImageMetadataStorageRef,
  getGalleryImageStorageRef,
} from "./gallery-storage-refs";

export type GalleryDeleteStorageImage = Pick<
  GalleryImage,
  | "id"
  | "drive_file_id"
  | "drive_file_name"
  | "drive_web_view_link"
  | "drive_metadata_file_id"
  | "drive_status"
  | "storage_provider"
  | "storage_kind"
  | "storage_status"
  | "storage_ref"
  | "metadata_storage_ref"
> &
  Partial<
    Pick<
      GalleryImage,
      | "variant"
      | "mime_type"
      | "storage_metadata"
      | "storage_external_id"
      | "storage_external_url"
      | "resolved_storage_ref"
      | "resolved_metadata_storage_ref"
      | "created_at"
    >
  >;

export type GalleryDeleteStorageRefs = {
  googleDriveFileIds: string[];
  managedObjectRefs: StoredObjectRef[];
  unsupportedRefs: StoredObjectRef[];
};

export function resolveGeneratedImageDeleteRefs(
  image: GalleryDeleteStorageImage,
): GalleryDeleteStorageRefs {
  return collectDeleteRefs([
    getGalleryImageStorageRef(toGalleryImage(image)),
    getGalleryImageMetadataStorageRef(toGalleryImage(image)),
  ]);
}

export function resolveGeneratedImagesDeleteRefs(
  images: GalleryDeleteStorageImage[],
): GalleryDeleteStorageRefs {
  return collectDeleteRefs(
    images.flatMap((image) => {
      const galleryImage = toGalleryImage(image);
      return [
        getGalleryImageStorageRef(galleryImage),
        getGalleryImageMetadataStorageRef(galleryImage),
      ];
    }),
  );
}

function collectDeleteRefs(refs: Array<StoredObjectRef | null>): GalleryDeleteStorageRefs {
  const googleDriveFileIds: string[] = [];
  const seenGoogleDriveFileIds = new Set<string>();
  const managedObjectRefs: StoredObjectRef[] = [];
  const unsupportedRefs: StoredObjectRef[] = [];

  for (const ref of refs) {
    if (!ref) continue;

    if (ref.providerId === "kavero-managed" || ref.providerId === "supabase-storage") {
      managedObjectRefs.push(ref);
      continue;
    }

    if (ref.providerId !== "google-drive") {
      unsupportedRefs.push(ref);
      continue;
    }

    const fileId = ref.externalId ?? ref.objectKey;
    if (!fileId || seenGoogleDriveFileIds.has(fileId)) continue;

    seenGoogleDriveFileIds.add(fileId);
    googleDriveFileIds.push(fileId);
  }

  return { googleDriveFileIds, managedObjectRefs, unsupportedRefs };
}

function toGalleryImage(image: GalleryDeleteStorageImage): GalleryImage {
  return {
    id: image.id,
    variant: image.variant ?? 1,
    mime_type: image.mime_type ?? "image/png",
    drive_file_id: image.drive_file_id,
    drive_file_name: image.drive_file_name,
    drive_web_view_link: image.drive_web_view_link,
    drive_metadata_file_id: image.drive_metadata_file_id,
    drive_status: image.drive_status,
    storage_provider: image.storage_provider,
    storage_kind: image.storage_kind,
    storage_status: image.storage_status,
    storage_ref: image.storage_ref,
    metadata_storage_ref: image.metadata_storage_ref,
    storage_metadata: image.storage_metadata ?? null,
    storage_external_id: image.storage_external_id ?? null,
    storage_external_url: image.storage_external_url ?? null,
    resolved_storage_ref: image.resolved_storage_ref ?? null,
    resolved_metadata_storage_ref: image.resolved_metadata_storage_ref ?? null,
    created_at: image.created_at ?? "",
  };
}
