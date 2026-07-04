import { describe, expect, it } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import {
  getCanvasAssetGoogleDriveDeleteFileId,
  getCanvasAssetStorageRef,
  isCanvasAssetStoredObjectRef,
} from "./canvas-asset-storage-refs";

function googleDriveRef(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "canvas-asset",
    objectKey: "ref-drive-file",
    bucket: "google-drive",
    path: "ref-drive-file",
    externalId: "ref-external-file",
    externalUrl: "https://drive.example/ref-external-file",
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

describe("canvas asset storage refs", () => {
  it("returns a ref-derived Google Drive delete id for valid storage refs", () => {
    expect(
      getCanvasAssetGoogleDriveDeleteFileId({
        drive_file_id: "legacy-file",
        drive_status: "available",
        storage_ref: googleDriveRef(),
      }),
    ).toBe("ref-external-file");
  });

  it("falls back to legacy Drive fields when storage_ref is missing", () => {
    expect(
      getCanvasAssetGoogleDriveDeleteFileId({
        drive_file_id: "legacy-file",
        drive_status: "available",
        storage_ref: null,
      }),
    ).toBe("legacy-file");
  });

  it("falls back to legacy Drive fields when storage_ref is malformed", () => {
    expect(
      getCanvasAssetGoogleDriveDeleteFileId({
        drive_file_id: "legacy-file",
        drive_status: "available",
        storage_ref: { providerId: "google-drive" },
      }),
    ).toBe("legacy-file");
  });

  it("skips valid unsupported provider refs", () => {
    expect(
      getCanvasAssetGoogleDriveDeleteFileId({
        drive_file_id: "legacy-file",
        drive_status: "available",
        storage_ref: googleDriveRef({
          providerId: "s3-compatible",
          kind: "managed",
          objectKey: "asset-1.png",
          externalId: null,
        }),
      }),
    ).toBeNull();
  });

  it("does not produce delete targets for missing assets", () => {
    expect(
      getCanvasAssetGoogleDriveDeleteFileId({
        drive_file_id: "legacy-file",
        drive_status: "missing",
        storage_ref: null,
      }),
    ).toBeNull();
    expect(
      getCanvasAssetGoogleDriveDeleteFileId({
        drive_file_id: "legacy-file",
        drive_status: "available",
        storage_ref: googleDriveRef({ status: "missing" }),
      }),
    ).toBeNull();
  });

  it("exposes parsed storage refs for read fallback", () => {
    const ref = googleDriveRef({ externalId: null });
    expect(isCanvasAssetStoredObjectRef(ref)).toBe(true);
    expect(
      getCanvasAssetStorageRef({
        drive_file_id: null,
        drive_status: "available",
        storage_ref: ref,
      }),
    ).toMatchObject({ objectKey: "ref-drive-file" });
  });
});
