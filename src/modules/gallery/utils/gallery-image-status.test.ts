import { describe, expect, it } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import type { GalleryImage } from "../types";
import { getGalleryImageDisplayStatus } from "./gallery-image-status";

function image(overrides: Partial<GalleryImage> = {}): GalleryImage {
  return {
    id: "image-1",
    variant: 1,
    mime_type: "image/png",
    drive_file_id: "drive-file-1",
    drive_file_name: "image.png",
    drive_web_view_link: null,
    drive_metadata_file_id: null,
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
    ...overrides,
  };
}

function ref(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "generated-image",
    objectKey: "drive-file-1",
    bucket: null,
    path: null,
    externalId: "drive-file-1",
    externalUrl: null,
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

describe("getGalleryImageDisplayStatus", () => {
  it("allows preview for available resolved storage refs", () => {
    expect(
      getGalleryImageDisplayStatus(
        image({ resolved_storage_ref: ref({ status: "available" }), drive_status: "missing" }),
      ),
    ).toMatchObject({ status: "available", canPreview: true });
  });

  it("suppresses preview for missing resolved storage refs", () => {
    expect(
      getGalleryImageDisplayStatus(image({ resolved_storage_ref: ref({ status: "missing" }) })),
    ).toMatchObject({
      status: "missing",
      canPreview: false,
      title: "Missing in Drive",
    });
  });

  it("uses reconnect_required storage_status when no resolved ref is present", () => {
    expect(getGalleryImageDisplayStatus(image({ storage_status: "reconnect_required" }))).toMatchObject({
      status: "reconnect_required",
      canPreview: false,
      title: "Reconnect storage",
    });
  });

  it("uses unavailable storage_status when no resolved ref is present", () => {
    expect(getGalleryImageDisplayStatus(image({ storage_status: "unavailable" }))).toMatchObject({
      status: "unavailable",
      canPreview: false,
      title: "Image unavailable",
    });
  });

  it("uses unknown storage_status when no resolved ref is present", () => {
    expect(getGalleryImageDisplayStatus(image({ storage_status: "unknown" }))).toMatchObject({
      status: "unknown",
      canPreview: false,
      title: "Storage status unknown",
    });
  });

  it("falls back to legacy drive_status", () => {
    expect(getGalleryImageDisplayStatus(image({ drive_status: "missing" }))).toMatchObject({
      status: "missing",
      canPreview: false,
      title: "Missing in Drive",
    });
  });

  it("falls back to drive_status when storage_status is malformed", () => {
    expect(
      getGalleryImageDisplayStatus(
        image({ storage_status: "not-a-status", drive_status: "available" }),
      ),
    ).toMatchObject({ status: "available", canPreview: true });
  });

  it("uses generic missing text for non-Drive provider-neutral rows", () => {
    expect(
      getGalleryImageDisplayStatus(
        image({
          drive_file_id: "",
          storage_provider: "kavero-managed",
          resolved_storage_ref: ref({
            providerId: "kavero-managed",
            kind: "managed",
            objectKey: "managed-image",
            externalId: null,
            status: "missing",
          }),
        }),
      ),
    ).toMatchObject({
      status: "missing",
      canPreview: false,
      title: "Image missing",
    });
  });
});
