import { isCanvasAssetStoredObjectRef } from "@/modules/assets/canvas-asset-storage-refs";
import { isStorageObjectStatus, type StorageObjectStatus } from "@/modules/storage/storage-provider";

type CanvasAssetStatusInput = {
  drive_file_id?: string | null;
  drive_status: "available" | "missing" | "unknown";
  storage_provider?: string | null;
  storage_ref?: unknown;
  storage_status?: unknown;
};

export type CanvasAssetDisplayStatus = {
  status: StorageObjectStatus;
  canPreview: boolean;
  title: string;
  description: string;
};

export function getCanvasAssetDisplayStatus(asset: CanvasAssetStatusInput): CanvasAssetDisplayStatus {
  const status = getCanvasAssetStatus(asset);
  const googleDriveBacked = isGoogleDriveBackedAsset(asset);

  if (status === "available") {
    return {
      status,
      canPreview: true,
      title: "",
      description: "",
    };
  }

  if (status === "missing") {
    return {
      status,
      canPreview: false,
      title: googleDriveBacked ? "Missing" : "Image missing",
      description: googleDriveBacked ? "Missing in Drive" : "The asset file is missing.",
    };
  }

  if (status === "reconnect_required") {
    return {
      status,
      canPreview: false,
      title: "Reconnect storage",
      description: "Storage needs to be reconnected before this asset can be previewed.",
    };
  }

  if (status === "unavailable") {
    return {
      status,
      canPreview: false,
      title: "Image unavailable",
      description: "This asset is currently unavailable.",
    };
  }

  return {
    status,
    canPreview: false,
    title: "Storage status unknown",
    description: "This asset cannot be previewed until storage status is refreshed.",
  };
}

function getCanvasAssetStatus(asset: CanvasAssetStatusInput): StorageObjectStatus {
  if (isCanvasAssetStoredObjectRef(asset.storage_ref)) return asset.storage_ref.status;
  if (isStorageObjectStatus(asset.storage_status)) return asset.storage_status;
  if (asset.drive_status === "available" || asset.drive_status === "missing") return asset.drive_status;
  return "unknown";
}

function isGoogleDriveBackedAsset(asset: CanvasAssetStatusInput) {
  if (isCanvasAssetStoredObjectRef(asset.storage_ref)) return asset.storage_ref.providerId === "google-drive";
  return asset.storage_provider === "google-drive" || Boolean(asset.drive_file_id);
}
