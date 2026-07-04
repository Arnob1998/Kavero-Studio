import {
  isStorageObjectStatus,
  isStorageProviderId,
  isStorageProviderKind,
  isStoragePurpose,
  type StoredObjectRef,
} from "@/modules/storage/storage-provider";

export type CanvasAssetStorageRow = {
  drive_file_id: string | null;
  drive_status: "available" | "missing" | "unknown";
  storage_ref?: unknown;
};

export function isCanvasAssetStoredObjectRef(value: unknown): value is StoredObjectRef {
  if (!value || typeof value !== "object") return false;

  const ref = value as Partial<StoredObjectRef>;
  return (
    isStorageProviderId(ref.providerId) &&
    isStorageProviderKind(ref.kind) &&
    isStoragePurpose(ref.purpose) &&
    ref.purpose === "canvas-asset" &&
    typeof ref.objectKey === "string" &&
    ref.objectKey.length > 0 &&
    isStorageObjectStatus(ref.status) &&
    ref.version === 1
  );
}

export function getCanvasAssetStorageRef(asset: CanvasAssetStorageRow): StoredObjectRef | null {
  if (isCanvasAssetStoredObjectRef(asset.storage_ref)) return asset.storage_ref;
  if (!asset.drive_file_id) return null;

  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "canvas-asset",
    objectKey: asset.drive_file_id,
    bucket: "google-drive",
    path: asset.drive_file_id,
    externalId: asset.drive_file_id,
    externalUrl: null,
    metadata: {},
    status: asset.drive_status,
    version: 1,
  };
}

export function getCanvasAssetGoogleDriveDeleteFileId(asset: CanvasAssetStorageRow) {
  const storageRef = getCanvasAssetStorageRef(asset);
  if (!storageRef || storageRef.providerId !== "google-drive" || storageRef.status === "missing") {
    return null;
  }

  return storageRef.externalId ?? storageRef.objectKey;
}
