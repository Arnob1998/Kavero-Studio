import { describe, expect, it } from "vitest";
import { getCanvasAssetDisplayStatus } from "./canvas-asset-status";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

function googleDriveRef(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "canvas-asset",
    objectKey: "drive-file-1",
    bucket: "google-drive",
    path: "drive-file-1",
    externalId: "drive-file-1",
    externalUrl: null,
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

function asset(overrides: Record<string, unknown> = {}) {
  return {
    drive_file_id: "legacy-file",
    drive_status: "available" as const,
    storage_provider: "google-drive",
    storage_ref: null,
    storage_status: null,
    ...overrides,
  };
}

describe("getCanvasAssetDisplayStatus", () => {
  it("allows preview for an available storage_ref", () => {
    expect(getCanvasAssetDisplayStatus(asset({ storage_ref: googleDriveRef({ status: "available" }) }))).toMatchObject({
      status: "available",
      canPreview: true,
    });
  });

  it("suppresses preview for a missing storage_ref", () => {
    expect(getCanvasAssetDisplayStatus(asset({ storage_ref: googleDriveRef({ status: "missing" }) }))).toMatchObject({
      status: "missing",
      canPreview: false,
      title: "Missing",
      description: "Missing in Drive",
    });
  });

  it.each(["reconnect_required", "unavailable", "unknown"] as const)(
    "uses scalar storage_status %s when storage_ref is missing",
    (status) => {
      expect(getCanvasAssetDisplayStatus(asset({ storage_ref: null, storage_status: status }))).toMatchObject({
        status,
        canPreview: false,
      });
    },
  );

  it("falls back to legacy drive_status when storage_ref is missing", () => {
    expect(getCanvasAssetDisplayStatus(asset({ storage_ref: null, storage_status: null, drive_status: "missing" }))).toMatchObject({
      status: "missing",
      canPreview: false,
    });
  });

  it("falls back to scalar status before legacy status when storage_ref is malformed", () => {
    expect(
      getCanvasAssetDisplayStatus(
        asset({
          storage_ref: { providerId: "google-drive" },
          storage_status: "unavailable",
          drive_status: "available",
        }),
      ),
    ).toMatchObject({
      status: "unavailable",
      canPreview: false,
    });
  });

  it("uses generic copy for non-Drive missing assets", () => {
    expect(
      getCanvasAssetDisplayStatus({
        drive_file_id: null,
        drive_status: "available",
        storage_provider: "kavero-managed",
        storage_ref: googleDriveRef({
          providerId: "kavero-managed",
          kind: "managed",
          bucket: null,
          path: null,
          externalId: null,
          status: "missing",
        }),
      }),
    ).toMatchObject({
      status: "missing",
      canPreview: false,
      title: "Image missing",
    });
  });
});
