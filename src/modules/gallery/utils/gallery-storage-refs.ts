import {
  isStorageObjectStatus,
  isStorageProviderId,
  isStorageProviderKind,
  isStoragePurpose,
  type StoredObjectRef,
} from "@/modules/storage/storage-provider";
import type { GalleryImage } from "../types";

export function getGalleryImageStorageRef(image: GalleryImage): StoredObjectRef | null {
  const parsedRef = parseStoredObjectRef(image.storage_ref);
  if (parsedRef) return parsedRef;

  if (!image.drive_file_id) return null;

  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "generated-image",
    objectKey: image.drive_file_id,
    bucket: null,
    path: null,
    externalId: image.drive_file_id,
    externalUrl: image.drive_web_view_link,
    metadata: {
      name: image.drive_file_name,
    },
    status: image.drive_status,
    version: 1,
  };
}

export function getGalleryImageMetadataStorageRef(image: GalleryImage): StoredObjectRef | null {
  const parsedRef = parseStoredObjectRef(image.metadata_storage_ref);
  if (parsedRef) return parsedRef;

  if (!image.drive_metadata_file_id) return null;

  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "generated-metadata",
    objectKey: image.drive_metadata_file_id,
    bucket: null,
    path: null,
    externalId: image.drive_metadata_file_id,
    externalUrl: null,
    metadata: {},
    status: image.drive_status,
    version: 1,
  };
}

export function withResolvedGalleryImageStorageRefs(image: GalleryImage): GalleryImage {
  return {
    ...image,
    resolved_storage_ref: getGalleryImageStorageRef(image),
    resolved_metadata_storage_ref: getGalleryImageMetadataStorageRef(image),
  };
}

function parseStoredObjectRef(value: unknown): StoredObjectRef | null {
  if (!isRecord(value)) return null;

  const {
    providerId,
    kind,
    purpose,
    objectKey,
    bucket,
    path,
    externalId,
    externalUrl,
    metadata,
    status,
    version,
  } = value;

  if (!isStorageProviderId(providerId)) return null;
  if (!isStorageProviderKind(kind)) return null;
  if (!isStoragePurpose(purpose)) return null;
  if (typeof objectKey !== "string" || objectKey.length === 0) return null;
  if (!isStorageObjectStatus(status)) return null;
  if (version !== 1) return null;

  return {
    providerId,
    kind,
    purpose,
    objectKey,
    bucket: typeof bucket === "string" || bucket === null ? bucket : undefined,
    path: typeof path === "string" || path === null ? path : undefined,
    externalId: typeof externalId === "string" || externalId === null ? externalId : undefined,
    externalUrl: typeof externalUrl === "string" || externalUrl === null ? externalUrl : undefined,
    metadata: isRecord(metadata) ? metadata : undefined,
    status,
    version,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
