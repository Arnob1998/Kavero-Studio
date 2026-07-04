import { describe, it, expect, vi, beforeEach } from "vitest";
import { deleteGalleryImage } from "./delete-gallery-image";
import { deleteStorageObjects } from "@/modules/storage/dispatch/storage-object-dispatch";
import { getRuntimeManagedStorageDispatchDependencies } from "@/modules/storage/managed/runtime";
import { deleteGoogleDriveGeneratedImageFiles } from "@/modules/storage/providers/google-drive/generated-image-storage";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

vi.mock("@/modules/storage/providers/google-drive/generated-image-storage", () => ({
  deleteGoogleDriveGeneratedImageFiles: vi.fn(),
}));

vi.mock("@/modules/storage/dispatch/storage-object-dispatch", () => ({
  deleteStorageObjects: vi.fn(),
}));

vi.mock("@/modules/storage/managed/runtime", () => ({
  getRuntimeManagedStorageDispatchDependencies: vi.fn(),
}));

const mockDeleteGoogleDriveGeneratedImageFiles = vi.mocked(deleteGoogleDriveGeneratedImageFiles);
const mockDeleteStorageObjects = vi.mocked(deleteStorageObjects);
const mockGetRuntimeManagedStorageDispatchDependencies = vi.mocked(
  getRuntimeManagedStorageDispatchDependencies,
);

function storageRef(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "generated-image",
    objectKey: "storage-file-1",
    bucket: null,
    path: null,
    externalId: "storage-file-1",
    externalUrl: null,
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

describe("deleteGalleryImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockDeleteGoogleDriveGeneratedImageFiles.mockResolvedValue({ success: true, deleted: true });
    mockDeleteStorageObjects.mockResolvedValue({ ok: true, deleted: 0, unsupportedRefs: [] });
    mockGetRuntimeManagedStorageDispatchDependencies.mockReturnValue({
      ok: true,
      dependencies: {},
    });
  });

  const createMockSupabase = (
    imageResult: any = { data: null, error: null },
    deleteResult: any = { error: null }
  ) => {
    const eqMock = vi.fn().mockReturnThis();
    const maybeSingleMock = vi.fn().mockResolvedValue(imageResult);
    const deleteMock = vi.fn().mockReturnThis();
    
    // For the delete call
    const deleteEqMock = vi.fn().mockReturnThis();
    const deleteFinalMock = vi.fn().mockResolvedValue(deleteResult);
    
    const fromMock = vi.fn((table: string) => {
      if (table === "generated_images") {
        return {
          select: vi.fn().mockReturnThis(),
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: deleteFinalMock,
            })),
          })),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: maybeSingleMock,
        };
      }
      return {};
    });

    return {
      from: fromMock,
      __mocks: { fromMock },
    } as any;
  };

  it("returns 500 if loading image fails", async () => {
    const supabase = createMockSupabase({ error: new Error("DB error") });
    const result = await deleteGalleryImage(supabase, "user-1", "img-1", false);
    
    expect(result).toEqual({ success: false, status: 500, error: "Unable to load gallery image." });
  });

  it("returns 404 if image is not found", async () => {
    const supabase = createMockSupabase({ data: null });
    const result = await deleteGalleryImage(supabase, "user-1", "img-1", false);
    
    expect(result).toEqual({ success: false, status: 404, error: "Not found" });
  });

  it("returns 502 if Drive token is missing when deleteDriveFiles is true", async () => {
    const supabase = createMockSupabase({
      data: { id: "img-1", drive_file_id: "file-1", drive_metadata_file_id: null },
    });
    mockDeleteGoogleDriveGeneratedImageFiles.mockResolvedValue({
      success: false,
      reason: "missing-token",
    });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);
    
    expect(result).toEqual({
      success: false,
      status: 502,
      error: "Unable to refresh Google Drive access. Reconnect Drive and try again.",
    });
  });

  it("returns 502 if deleting from Drive fails", async () => {
    const supabase = createMockSupabase({
      data: { id: "img-1", drive_file_id: "file-1", drive_metadata_file_id: null },
    });
    mockDeleteGoogleDriveGeneratedImageFiles.mockResolvedValue({
      success: false,
      reason: "delete-failed",
      failures: [
        {
          status: "rejected",
          reason: new Error("Drive error"),
        },
      ],
    });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);
    
    expect(result).toEqual({
      success: false,
      status: 502,
      error: "Unable to delete image from Google Drive. Gallery record was kept.",
    });
  });

  it("deletes from DB only when deleteDriveFiles is false", async () => {
    const supabase = createMockSupabase({
      data: { id: "img-1", drive_file_id: "file-1", drive_metadata_file_id: null },
    });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", false);
    
    expect(mockDeleteGoogleDriveGeneratedImageFiles).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: false });
  });

  it("deletes from Drive and DB successfully", async () => {
    const supabase = createMockSupabase({
      data: { id: "img-1", drive_file_id: "file-1", drive_metadata_file_id: "meta-1" },
    });
    mockDeleteGoogleDriveGeneratedImageFiles.mockResolvedValue({ success: true, deleted: true });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);
    
    expect(mockDeleteGoogleDriveGeneratedImageFiles).toHaveBeenCalledWith({
      userId: "user-1",
      fileIds: ["file-1", "meta-1"],
    });
    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: true });
  });

  it("deletes from Drive using storage refs before legacy Drive fields", async () => {
    const supabase = createMockSupabase({
      data: {
        id: "img-1",
        drive_file_id: "legacy-file",
        drive_file_name: "legacy.png",
        drive_web_view_link: null,
        drive_metadata_file_id: "legacy-meta",
        drive_status: "available",
        storage_provider: "google-drive",
        storage_kind: "connected",
        storage_status: "available",
        storage_ref: storageRef({ objectKey: "storage-image-object", externalId: "storage-image" }),
        metadata_storage_ref: storageRef({
          purpose: "generated-metadata",
          objectKey: "storage-meta-object",
          externalId: "storage-meta",
        }),
      },
    });
    mockDeleteGoogleDriveGeneratedImageFiles.mockResolvedValue({ success: true, deleted: true });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);

    expect(mockDeleteGoogleDriveGeneratedImageFiles).toHaveBeenCalledWith({
      userId: "user-1",
      fileIds: ["storage-image", "storage-meta"],
    });
    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: true });
  });

  it("deletes managed image and metadata refs through managed storage dispatch", async () => {
    const supabase = createMockSupabase({
      data: {
        id: "img-1",
        drive_file_id: null,
        drive_file_name: null,
        drive_web_view_link: null,
        drive_metadata_file_id: null,
        drive_status: "available",
        storage_provider: "kavero-managed",
        storage_kind: "managed",
        storage_status: "available",
        storage_ref: storageRef({
          providerId: "kavero-managed",
          kind: "managed",
          objectKey: "managed-image",
          bucket: "kavero-generated-images",
          path: "managed-image",
          externalId: null,
          metadata: { backendProviderId: "supabase-storage" },
        }),
        metadata_storage_ref: storageRef({
          providerId: "kavero-managed",
          kind: "managed",
          purpose: "generated-metadata",
          objectKey: "managed-metadata",
          bucket: "kavero-generated-metadata",
          path: "managed-metadata",
          externalId: null,
          metadata: { backendProviderId: "supabase-storage" },
        }),
      },
    });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);

    expect(mockDeleteGoogleDriveGeneratedImageFiles).not.toHaveBeenCalled();
    expect(mockDeleteStorageObjects).toHaveBeenCalledWith({
      userId: "user-1",
      refs: [
        expect.objectContaining({ providerId: "kavero-managed", objectKey: "managed-image" }),
        expect.objectContaining({
          providerId: "kavero-managed",
          objectKey: "managed-metadata",
        }),
      ],
      dependencies: {},
    });
    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: true });
  });

  it("deletes Drive image and metadata refs through Google Drive", async () => {
    const supabase = createMockSupabase({
      data: {
        id: "img-1",
        drive_file_id: "legacy-file",
        drive_file_name: "legacy.png",
        drive_web_view_link: null,
        drive_metadata_file_id: "legacy-meta",
        drive_status: "available",
        storage_provider: "google-drive",
        storage_kind: "connected",
        storage_status: "available",
        storage_ref: storageRef({ objectKey: "drive-image-ref", externalId: "drive-image-ref" }),
        metadata_storage_ref: storageRef({
          purpose: "generated-metadata",
          objectKey: "drive-meta-ref",
          externalId: "drive-meta-ref",
        }),
      },
    });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);

    expect(mockDeleteGoogleDriveGeneratedImageFiles).toHaveBeenCalledWith({
      userId: "user-1",
      fileIds: ["drive-image-ref", "drive-meta-ref"],
    });
    expect(mockDeleteStorageObjects).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: true });
  });

  it("uses legacy Drive image and metadata IDs when refs are missing", async () => {
    const supabase = createMockSupabase({
      data: {
        id: "img-1",
        drive_file_id: "legacy-file",
        drive_file_name: "legacy.png",
        drive_web_view_link: null,
        drive_metadata_file_id: "legacy-meta",
        drive_status: "available",
        storage_provider: null,
        storage_kind: null,
        storage_status: null,
        storage_ref: null,
        metadata_storage_ref: null,
      },
    });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);

    expect(mockDeleteGoogleDriveGeneratedImageFiles).toHaveBeenCalledWith({
      userId: "user-1",
      fileIds: ["legacy-file", "legacy-meta"],
    });
    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: true });
  });

  it("does not use KAVERO_STORAGE_PROVIDER to decide how existing image objects are deleted", async () => {
    vi.stubEnv("KAVERO_STORAGE_PROVIDER", "google-drive");
    const supabase = createMockSupabase({
      data: {
        id: "img-1",
        drive_file_id: "legacy-file",
        drive_file_name: "legacy.png",
        drive_web_view_link: null,
        drive_metadata_file_id: null,
        drive_status: "available",
        storage_provider: "kavero-managed",
        storage_kind: "managed",
        storage_status: "available",
        storage_ref: storageRef({
          providerId: "kavero-managed",
          kind: "managed",
          objectKey: "managed-image",
          bucket: "kavero-generated-images",
          path: "managed-image",
          externalId: null,
          metadata: { backendProviderId: "supabase-storage" },
        }),
        metadata_storage_ref: null,
      },
    });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);

    expect(mockDeleteStorageObjects).toHaveBeenCalledWith({
      userId: "user-1",
      refs: [expect.objectContaining({ providerId: "kavero-managed", objectKey: "managed-image" })],
      dependencies: {},
    });
    expect(mockDeleteGoogleDriveGeneratedImageFiles).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: true });
  });

  it("skips unsupported provider refs and still deletes the DB row", async () => {
    const supabase = createMockSupabase({
      data: {
        id: "img-1",
        drive_file_id: "legacy-file",
        drive_file_name: "legacy.png",
        drive_web_view_link: null,
        drive_metadata_file_id: null,
        drive_status: "available",
        storage_provider: "s3-compatible",
        storage_kind: "managed",
        storage_status: "available",
        storage_ref: storageRef({
          providerId: "s3-compatible",
          kind: "managed",
          objectKey: "s3-image",
          externalId: null,
        }),
        metadata_storage_ref: null,
      },
    });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);

    expect(mockDeleteGoogleDriveGeneratedImageFiles).not.toHaveBeenCalled();
    expect(mockDeleteStorageObjects).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: true });
  });

  it("treats managed missing-object deletes as safe when dispatch reports success", async () => {
    const supabase = createMockSupabase({
      data: {
        id: "img-1",
        drive_file_id: null,
        drive_file_name: null,
        drive_web_view_link: null,
        drive_metadata_file_id: null,
        drive_status: "available",
        storage_provider: "kavero-managed",
        storage_kind: "managed",
        storage_status: "available",
        storage_ref: storageRef({
          providerId: "kavero-managed",
          kind: "managed",
          objectKey: "already-missing",
          bucket: "kavero-generated-images",
          path: "already-missing",
          externalId: null,
          metadata: { backendProviderId: "supabase-storage" },
        }),
        metadata_storage_ref: null,
      },
    });
    mockDeleteStorageObjects.mockResolvedValueOnce({ ok: true, deleted: 1, unsupportedRefs: [] });

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", true);

    expect(result).toEqual({ success: true, removed: true, driveFilesDeleted: true });
  });

  it("returns 500 if deleting from DB fails", async () => {
    const supabase = createMockSupabase(
      { data: { id: "img-1", drive_file_id: "file-1", drive_metadata_file_id: null } },
      { error: new Error("DB Delete error") }
    );

    const result = await deleteGalleryImage(supabase, "user-1", "img-1", false);
    
    expect(result).toEqual({ success: false, status: 500, error: "Unable to remove gallery image." });
  });
});
