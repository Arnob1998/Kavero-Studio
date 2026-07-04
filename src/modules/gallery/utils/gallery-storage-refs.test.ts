import { describe, expect, it } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import type { GalleryImage } from "../types";
import { getGalleryImageMetadataStorageRef, getGalleryImageStorageRef } from "./gallery-storage-refs";

describe("gallery storage refs", () => {
  const baseImage: GalleryImage = {
    id: "image-1",
    variant: 1,
    mime_type: "image/png",
    drive_file_id: "drive-image-1",
    drive_file_name: "image.png",
    drive_web_view_link: "https://drive.google.com/file/d/drive-image-1/view",
    drive_metadata_file_id: "drive-metadata-1",
    drive_status: "available",
    storage_provider: null,
    storage_kind: null,
    storage_status: null,
    storage_ref: null,
    metadata_storage_ref: null,
    storage_metadata: null,
    storage_external_id: null,
    storage_external_url: null,
    resolved_storage_ref: null,
    resolved_metadata_storage_ref: null,
    created_at: "2026-05-26T12:00:00Z",
  };

  it("uses a valid storage_ref as canonical", () => {
    const storageRef: StoredObjectRef = {
      providerId: "google-drive",
      kind: "connected",
      purpose: "generated-image",
      objectKey: "stored-object-1",
      bucket: null,
      path: null,
      externalId: "stored-object-1",
      externalUrl: "https://drive.google.com/file/d/stored-object-1/view",
      metadata: { name: "stored.png" },
      status: "available",
      version: 1,
    };

    expect(getGalleryImageStorageRef({ ...baseImage, storage_ref: storageRef })).toEqual(
      storageRef,
    );
  });

  it("synthesizes a Google Drive image ref from legacy fields when storage_ref is missing", () => {
    expect(getGalleryImageStorageRef(baseImage)).toEqual({
      providerId: "google-drive",
      kind: "connected",
      purpose: "generated-image",
      objectKey: "drive-image-1",
      bucket: null,
      path: null,
      externalId: "drive-image-1",
      externalUrl: "https://drive.google.com/file/d/drive-image-1/view",
      metadata: { name: "image.png" },
      status: "available",
      version: 1,
    });
  });

  it("uses a valid metadata_storage_ref as canonical", () => {
    const metadataRef: StoredObjectRef = {
      providerId: "google-drive",
      kind: "connected",
      purpose: "generated-metadata",
      objectKey: "metadata-object-1",
      bucket: null,
      path: null,
      externalId: "metadata-object-1",
      externalUrl: null,
      metadata: { name: "metadata.json" },
      status: "available",
      version: 1,
    };

    expect(
      getGalleryImageMetadataStorageRef({ ...baseImage, metadata_storage_ref: metadataRef }),
    ).toEqual(metadataRef);
  });

  it("synthesizes a metadata ref only when drive_metadata_file_id exists", () => {
    expect(getGalleryImageMetadataStorageRef(baseImage)).toEqual({
      providerId: "google-drive",
      kind: "connected",
      purpose: "generated-metadata",
      objectKey: "drive-metadata-1",
      bucket: null,
      path: null,
      externalId: "drive-metadata-1",
      externalUrl: null,
      metadata: {},
      status: "available",
      version: 1,
    });

    expect(
      getGalleryImageMetadataStorageRef({ ...baseImage, drive_metadata_file_id: null }),
    ).toBeNull();
  });

  it("falls back to legacy Drive fields when storage_ref is malformed", () => {
    expect(
      getGalleryImageStorageRef({
        ...baseImage,
        storage_ref: { providerId: "not-a-provider", objectKey: "bad" },
      }),
    ).toEqual({
      providerId: "google-drive",
      kind: "connected",
      purpose: "generated-image",
      objectKey: "drive-image-1",
      bucket: null,
      path: null,
      externalId: "drive-image-1",
      externalUrl: "https://drive.google.com/file/d/drive-image-1/view",
      metadata: { name: "image.png" },
      status: "available",
      version: 1,
    });
  });
});
