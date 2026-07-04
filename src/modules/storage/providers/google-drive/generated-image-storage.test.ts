import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteGoogleDriveGeneratedImageFiles,
  GOOGLE_DRIVE_GENERATED_HISTORY_NOT_CONNECTED_WARNING,
  GOOGLE_DRIVE_GENERATED_HISTORY_TOKEN_WARNING,
  prepareGoogleDriveGeneratedImageStorage,
  uploadGoogleDriveGeneratedImageWithMetadata,
} from "./generated-image-storage";
import {
  createGoogleDriveFolder,
  deleteGoogleDriveFile,
  getGoogleDriveAccessTokenForUser,
  getGoogleDriveConnection,
  markGoogleDriveFolderMissing,
  updateGoogleDriveFolder,
  uploadGoogleDriveFile,
  GoogleDriveApiError,
} from "@/lib/google-drive";

vi.mock("@/lib/google-drive", async () => {
  const actual = await vi.importActual<typeof import("@/lib/google-drive")>("@/lib/google-drive");

  return {
    GoogleDriveApiError: actual.GoogleDriveApiError,
    isGoogleDriveMissingError: actual.isGoogleDriveMissingError,
    createGoogleDriveFolder: vi.fn(),
    deleteGoogleDriveFile: vi.fn(),
    extensionForMimeType: actual.extensionForMimeType,
    getGoogleDriveAccessTokenForUser: vi.fn(),
    getGoogleDriveConnection: vi.fn(),
    markGoogleDriveFolderMissing: vi.fn(),
    parseImageDataUrl: actual.parseImageDataUrl,
    updateGoogleDriveFolder: vi.fn(),
    uploadGoogleDriveFile: vi.fn(),
  };
});

const mockCreateGoogleDriveFolder = vi.mocked(createGoogleDriveFolder);
const mockDeleteGoogleDriveFile = vi.mocked(deleteGoogleDriveFile);
const mockGetGoogleDriveAccessTokenForUser = vi.mocked(getGoogleDriveAccessTokenForUser);
const mockGetGoogleDriveConnection = vi.mocked(getGoogleDriveConnection);
const mockMarkGoogleDriveFolderMissing = vi.mocked(markGoogleDriveFolderMissing);
const mockUpdateGoogleDriveFolder = vi.mocked(updateGoogleDriveFolder);
const mockUploadGoogleDriveFile = vi.mocked(uploadGoogleDriveFile);

function createReadyStorage() {
  return {
    ready: true,
    providerId: "google-drive",
    kind: "connected",
    userId: "user-1",
    accessToken: "drive-token",
    folderId: "folder-1",
  } as const;
}

describe("Google Drive generated image storage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current warning when no Drive connection exists", async () => {
    mockGetGoogleDriveConnection.mockResolvedValue(null);

    await expect(prepareGoogleDriveGeneratedImageStorage("user-1")).resolves.toEqual({
      ready: false,
      providerId: "google-drive",
      kind: "connected",
      warning: GOOGLE_DRIVE_GENERATED_HISTORY_NOT_CONNECTED_WARNING,
    });
    expect(mockGetGoogleDriveAccessTokenForUser).not.toHaveBeenCalled();
  });

  it("returns the current warning when Drive access token is missing", async () => {
    mockGetGoogleDriveConnection.mockResolvedValue({
      id: "connection-1",
      user_id: "user-1",
      google_email: "user@example.com",
      folder_id: "folder-1",
      folder_name: "Kavero Generated Images",
      scope: "drive.file",
      status: "active",
      folder_status: "available",
      canvas_folder_id: null,
      canvas_folder_name: null,
      canvas_folder_status: "unknown",
      connected_at: "2026-05-26T00:00:00.000Z",
      updated_at: "2026-05-26T00:00:00.000Z",
    });
    mockGetGoogleDriveAccessTokenForUser.mockResolvedValue(null);

    await expect(prepareGoogleDriveGeneratedImageStorage("user-1")).resolves.toEqual({
      ready: false,
      providerId: "google-drive",
      kind: "connected",
      warning: GOOGLE_DRIVE_GENERATED_HISTORY_TOKEN_WARNING,
    });
  });

  it("uploads generated image and metadata with legacy fields and provider refs", async () => {
    const storage = createReadyStorage();
    mockUploadGoogleDriveFile
      .mockResolvedValueOnce({
        id: "image-file-1",
        name: "file-base.png",
        mimeType: "image/png",
        webViewLink: "https://drive.example/image-file-1",
      })
      .mockResolvedValueOnce({
        id: "metadata-file-1",
        name: "file-base.json",
        mimeType: "application/json",
        webViewLink: "https://drive.example/metadata-file-1",
      });

    const upload = await uploadGoogleDriveGeneratedImageWithMetadata({
      storage,
      fileBase: "file-base",
      dataUrl: "data:image/png;base64,aGVsbG8=",
      metadata: {
        prompt: "A prompt",
        model: "gemini-2.5-flash-image",
        modelLabel: "Gemini 2.5 Flash Image",
        settings: { aspectRatio: "1:1" },
        variant: 1,
        generatedText: "Generated text",
        referenceImages: [{ name: "Reference image", mimeType: "image/png" }],
        createdAt: "2026-05-26T00:00:00.000Z",
      },
    });

    expect(upload).toMatchObject({
      mimeType: "image/png",
      driveFileId: "image-file-1",
      driveFileName: "file-base.png",
      driveWebViewLink: "https://drive.example/image-file-1",
      driveMetadataFileId: "metadata-file-1",
      imageObject: {
        ref: {
          providerId: "google-drive",
          kind: "connected",
          purpose: "generated-image",
          objectKey: "image-file-1",
          externalId: "image-file-1",
          externalUrl: "https://drive.example/image-file-1",
          status: "available",
          version: 1,
        },
      },
      metadataObject: {
        ref: {
          providerId: "google-drive",
          kind: "connected",
          purpose: "generated-metadata",
          objectKey: "metadata-file-1",
          externalId: "metadata-file-1",
          externalUrl: "https://drive.example/metadata-file-1",
          status: "available",
          version: 1,
        },
      },
    });
    expect(mockUploadGoogleDriveFile).toHaveBeenNthCalledWith(
      1,
      "drive-token",
      expect.objectContaining({
        name: "file-base.png",
        mimeType: "image/png",
        folderId: "folder-1",
      }),
    );
    expect(mockUploadGoogleDriveFile).toHaveBeenNthCalledWith(
      2,
      "drive-token",
      expect.objectContaining({
        name: "file-base.json",
        mimeType: "application/json",
        folderId: "folder-1",
      }),
    );
  });

  it("recovers a missing generated images folder and retries upload in the replacement folder", async () => {
    const storage = createReadyStorage();
    const missingFolderError = new GoogleDriveApiError("Missing folder", 404);
    mockUploadGoogleDriveFile
      .mockRejectedValueOnce(missingFolderError)
      .mockResolvedValueOnce({
        id: "image-file-1",
        name: "file-base.png",
        mimeType: "image/png",
        webViewLink: "https://drive.example/image-file-1",
      })
      .mockResolvedValueOnce({
        id: "metadata-file-1",
        name: "file-base.json",
        mimeType: "application/json",
      });
    mockCreateGoogleDriveFolder.mockResolvedValue({ id: "replacement-folder" });

    await uploadGoogleDriveGeneratedImageWithMetadata({
      storage,
      fileBase: "file-base",
      dataUrl: "data:image/png;base64,aGVsbG8=",
      metadata: {
        prompt: "A prompt",
        model: "gemini-2.5-flash-image",
        modelLabel: "Gemini 2.5 Flash Image",
        settings: {},
        variant: 1,
        generatedText: "",
        referenceImages: [],
        createdAt: "2026-05-26T00:00:00.000Z",
      },
    });

    expect(mockMarkGoogleDriveFolderMissing).toHaveBeenCalledWith("user-1");
    expect(mockCreateGoogleDriveFolder).toHaveBeenCalledWith("drive-token");
    expect(mockUpdateGoogleDriveFolder).toHaveBeenCalledWith("user-1", "replacement-folder");
    expect(mockUploadGoogleDriveFile).toHaveBeenNthCalledWith(
      2,
      "drive-token",
      expect.objectContaining({ folderId: "replacement-folder" }),
    );
  });

  it("returns missing-token when delete cannot refresh Drive access", async () => {
    mockGetGoogleDriveAccessTokenForUser.mockResolvedValue(null);

    await expect(
      deleteGoogleDriveGeneratedImageFiles({ userId: "user-1", fileIds: ["image-file-1"] }),
    ).resolves.toEqual({ success: false, reason: "missing-token" });
    expect(mockDeleteGoogleDriveFile).not.toHaveBeenCalled();
  });

  it("reports failed Drive deletes without hiding failures", async () => {
    mockGetGoogleDriveAccessTokenForUser.mockResolvedValue("drive-token");
    mockDeleteGoogleDriveFile
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Drive delete failed"));

    const result = await deleteGoogleDriveGeneratedImageFiles({
      userId: "user-1",
      fileIds: ["image-file-1", "metadata-file-1"],
    });

    expect(result.success).toBe(false);
    if (!result.success && result.reason === "delete-failed") {
      expect(result.failures).toHaveLength(1);
    }
  });

  it("deletes image and metadata files when both IDs exist", async () => {
    mockGetGoogleDriveAccessTokenForUser.mockResolvedValue("drive-token");
    mockDeleteGoogleDriveFile.mockResolvedValue(undefined);

    await expect(
      deleteGoogleDriveGeneratedImageFiles({
        userId: "user-1",
        fileIds: ["image-file-1", "metadata-file-1"],
      }),
    ).resolves.toEqual({ success: true, deleted: true });
    expect(mockDeleteGoogleDriveFile).toHaveBeenCalledWith("drive-token", "image-file-1");
    expect(mockDeleteGoogleDriveFile).toHaveBeenCalledWith("drive-token", "metadata-file-1");
  });
});
