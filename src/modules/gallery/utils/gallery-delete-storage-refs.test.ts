import { describe, expect, it } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import {
  resolveGeneratedImageDeleteRefs,
  resolveGeneratedImagesDeleteRefs,
  type GalleryDeleteStorageImage,
} from "./gallery-delete-storage-refs";

function image(overrides: Partial<GalleryDeleteStorageImage> = {}): GalleryDeleteStorageImage {
  return {
    id: "image-1",
    drive_file_id: "legacy-image",
    drive_file_name: "legacy.png",
    drive_web_view_link: "https://drive.google.com/file/d/legacy-image/view",
    drive_metadata_file_id: "legacy-metadata",
    drive_status: "available",
    storage_provider: null,
    storage_kind: null,
    storage_status: null,
    storage_ref: null,
    metadata_storage_ref: null,
    ...overrides,
  };
}

function ref(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "generated-image",
    objectKey: "storage-image",
    bucket: null,
    path: null,
    externalId: "storage-image",
    externalUrl: null,
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

describe("Gallery delete storage refs", () => {
  it("uses Google Drive storage refs for image and metadata IDs", () => {
    expect(
      resolveGeneratedImageDeleteRefs(
        image({
          storage_ref: ref({ objectKey: "image-object", externalId: "image-file" }),
          metadata_storage_ref: ref({
            purpose: "generated-metadata",
            objectKey: "metadata-object",
            externalId: "metadata-file",
          }),
        }),
      ),
    ).toEqual({
      googleDriveFileIds: ["image-file", "metadata-file"],
      managedObjectRefs: [],
      unsupportedRefs: [],
    });
  });

  it("falls back to legacy Drive fields for legacy-only rows", () => {
    expect(resolveGeneratedImageDeleteRefs(image())).toEqual({
      googleDriveFileIds: ["legacy-image", "legacy-metadata"],
      managedObjectRefs: [],
      unsupportedRefs: [],
    });
  });

  it("omits metadata when no metadata ref or legacy metadata ID exists", () => {
    expect(resolveGeneratedImageDeleteRefs(image({ drive_metadata_file_id: null }))).toEqual({
      googleDriveFileIds: ["legacy-image"],
      managedObjectRefs: [],
      unsupportedRefs: [],
    });
  });

  it("returns managed refs without falling back for valid managed refs", () => {
    const managedRef = ref({
      providerId: "kavero-managed",
      kind: "managed",
      objectKey: "managed-image",
      externalId: "managed-image",
    });

    expect(
      resolveGeneratedImageDeleteRefs(
        image({
          storage_ref: managedRef,
          metadata_storage_ref: ref({
            purpose: "generated-metadata",
            objectKey: "metadata-object",
            externalId: "metadata-file",
          }),
        }),
      ),
    ).toEqual({
      googleDriveFileIds: ["metadata-file"],
      managedObjectRefs: [managedRef],
      unsupportedRefs: [],
    });
  });

  it("returns unsupported refs without falling back for valid non-managed unsupported refs", () => {
    const unsupportedRef = ref({
      providerId: "s3-compatible",
      kind: "managed",
      objectKey: "s3-image",
      externalId: null,
      bucket: "images",
      path: "s3-image",
    });

    expect(resolveGeneratedImageDeleteRefs(image({ storage_ref: unsupportedRef }))).toEqual({
      googleDriveFileIds: ["legacy-metadata"],
      managedObjectRefs: [],
      unsupportedRefs: [unsupportedRef],
    });
  });

  it("falls back to legacy Drive fields for malformed refs", () => {
    expect(
      resolveGeneratedImageDeleteRefs(
        image({
          storage_ref: { providerId: "not-supported", objectKey: "bad" },
        }),
      ),
    ).toEqual({
      googleDriveFileIds: ["legacy-image", "legacy-metadata"],
      managedObjectRefs: [],
      unsupportedRefs: [],
    });
  });

  it("deduplicates Google Drive file IDs across multiple rows", () => {
    expect(
      resolveGeneratedImagesDeleteRefs([
        image({ id: "image-1", drive_file_id: "same-file", drive_metadata_file_id: null }),
        image({ id: "image-2", drive_file_id: "same-file", drive_metadata_file_id: "meta-2" }),
      ]),
    ).toEqual({
      googleDriveFileIds: ["same-file", "meta-2"],
      managedObjectRefs: [],
      unsupportedRefs: [],
    });
  });
});
