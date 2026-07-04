import {
  isStorageObjectStatus,
  type StorageObjectStatus,
} from "@/modules/storage/storage-provider";
import type { GalleryImage } from "../types";

export type GalleryImageDisplayStatus = {
  status: StorageObjectStatus;
  canPreview: boolean;
  title: string;
  description: string;
};

export function getGalleryImageDisplayStatus(image: GalleryImage): GalleryImageDisplayStatus {
  const status = resolveGalleryImageStatus(image);
  const isGoogleDriveImage =
    image.resolved_storage_ref?.providerId === "google-drive" ||
    image.storage_provider === "google-drive" ||
    Boolean(image.drive_file_id);

  return {
    status,
    canPreview: status === "available",
    ...getStatusCopy(status, isGoogleDriveImage),
  };
}

function resolveGalleryImageStatus(image: GalleryImage): StorageObjectStatus {
  if (image.resolved_storage_ref?.status) {
    return image.resolved_storage_ref.status;
  }

  if (isStorageObjectStatus(image.storage_status)) {
    return image.storage_status;
  }

  if (isStorageObjectStatus(image.drive_status)) {
    return image.drive_status;
  }

  return "unknown";
}

function getStatusCopy(status: StorageObjectStatus, isGoogleDriveImage: boolean) {
  if (status === "missing") {
    return isGoogleDriveImage
      ? {
          title: "Missing in Drive",
          description: "Remove it from Gallery to clear this record.",
        }
      : {
          title: "Image missing",
          description: "Remove it from Gallery to clear this record.",
        };
  }

  if (status === "reconnect_required") {
    return {
      title: "Reconnect storage",
      description: "Reconnect storage to view this generated image.",
    };
  }

  if (status === "unavailable") {
    return {
      title: "Image unavailable",
      description: "This generated image is not available from storage.",
    };
  }

  if (status === "unknown") {
    return {
      title: "Storage status unknown",
      description: "Kavero cannot confirm this generated image is available.",
    };
  }

  return {
    title: "",
    description: "",
  };
}
