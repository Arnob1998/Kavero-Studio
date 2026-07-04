import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCanvasUser: vi.fn(),
  requireCanvasAccess: vi.fn(),
  requireCanvasAdmin: vi.fn(),
  createGoogleDriveFolder: vi.fn(),
  deleteGoogleDriveFile: vi.fn(),
  getGoogleDriveAccessTokenForUser: vi.fn(),
  getGoogleDriveConnection: vi.fn(),
  isGoogleDriveReconnectError: vi.fn(),
  markGoogleDriveReconnectRequired: vi.fn(),
  updateGoogleDriveCanvasFolder: vi.fn(),
  uploadGoogleDriveFile: vi.fn(),
  resolveRuntimeManagedStorageBackend: vi.fn(),
  getRuntimeManagedStorageDispatchDependencies: vi.fn(),
  deleteStorageObjects: vi.fn(),
}));

vi.mock("@/lib/canvas/api", () => ({
  CANVAS_LIMITS: {
    designsPerUser: 10,
    pagesPerDesign: 20,
    driveAssetsPerUser: 50,
    driveAssetBytesPerFile: 10 * 1024 * 1024,
  },
  getCanvasUser: mocks.getCanvasUser,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  requireCanvasAccess: mocks.requireCanvasAccess,
  requireCanvasAdmin: mocks.requireCanvasAdmin,
}));

vi.mock("@/lib/google-drive", () => ({
  createGoogleDriveFolder: mocks.createGoogleDriveFolder,
  deleteGoogleDriveFile: mocks.deleteGoogleDriveFile,
  getGoogleDriveAccessTokenForUser: mocks.getGoogleDriveAccessTokenForUser,
  getGoogleDriveConnection: mocks.getGoogleDriveConnection,
  googleDriveCanvasFolderName: "Kavero Canvas Assets",
  isGoogleDriveReconnectError: mocks.isGoogleDriveReconnectError,
  markGoogleDriveReconnectRequired: mocks.markGoogleDriveReconnectRequired,
  updateGoogleDriveCanvasFolder: mocks.updateGoogleDriveCanvasFolder,
  uploadGoogleDriveFile: mocks.uploadGoogleDriveFile,
}));

vi.mock("@/modules/storage/managed/runtime", () => ({
  resolveRuntimeManagedStorageBackend: mocks.resolveRuntimeManagedStorageBackend,
  getRuntimeManagedStorageDispatchDependencies: mocks.getRuntimeManagedStorageDispatchDependencies,
}));

vi.mock("@/modules/storage/dispatch/storage-object-dispatch", () => ({
  deleteStorageObjects: mocks.deleteStorageObjects,
}));

import { DELETE, GET, POST } from "./route";

function imageRequest(file = new File(["image-bytes"], "Product Photo.png", { type: "image/png" })) {
  const form = new FormData();
  form.append("file", file);

  return {
    formData: vi.fn(async () => form),
  } as unknown as Request;
}

function createCanvasAssetsAdmin(options: {
  countResult?: { count: number | null; error: unknown | null };
  insertResult?: { data: Record<string, unknown> | null; error: unknown | null };
  assetsResult?: { data: Array<Record<string, unknown>> | null; error: unknown | null };
  designCountResult?: { count: number | null };
  pageCountResult?: { count: number | null };
  deleteRowsResult?: { error: unknown | null };
} = {}) {
  const countResult = options.countResult ?? { count: 0, error: null };
  const insertResult = options.insertResult ?? {
    data: {
      id: "asset-fixed-id",
      original_name: "Product Photo.png",
      content_type: "image/png",
      size_bytes: 11,
      public_url: "/api/canvas/assets/asset-fixed-id",
      drive_file_id: "drive-file-1",
      drive_file_name: "Product-Photo-asset-fi.png",
      drive_web_view_link: "https://drive.example/drive-file-1",
      drive_status: "available",
      last_used_at: null,
      created_at: "2026-05-26T00:00:00.000Z",
    },
    error: null,
  };
  const assetsResult = options.assetsResult ?? { data: [], error: null };
  const designCountResult = options.designCountResult ?? { count: 0 };
  const pageCountResult = options.pageCountResult ?? { count: 0 };
  const deleteRowsResult = options.deleteRowsResult ?? { error: null };

  const countEq = vi.fn(async () => countResult);
  const assetQueryResult = Promise.resolve(assetsResult);
  const assetQuery = {
    in: vi.fn(async () => assetsResult),
    then: assetQueryResult.then.bind(assetQueryResult),
  };
  const assetLimit = vi.fn(() => assetQuery);
  const assetOrder = vi.fn(() => ({ limit: assetLimit }));
  const assetEq = vi.fn(() => ({ order: assetOrder, limit: assetLimit }));
  const select = vi.fn((_columns?: string, options?: { count?: string; head?: boolean }) => {
    if (options?.count === "exact" && options.head === true) {
      return { eq: countEq };
    }

    return { eq: assetEq };
  });
  const insertSingle = vi.fn(async () => insertResult);
  const insertSelect = vi.fn(() => ({ single: insertSingle }));
  const insert = vi.fn(() => ({ select: insertSelect }));
  const deleteIn = vi.fn(async () => deleteRowsResult);
  const deleteEq = vi.fn(() => ({ in: deleteIn }));
  const deleteRows = vi.fn(() => ({ eq: deleteEq }));
  const from = vi.fn((table: string) => {
    if (table === "canvas_designs") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: null, error: null, count: designCountResult.count })),
        })),
      };
    }

    if (table === "canvas_pages") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: null, error: null, count: pageCountResult.count })),
        })),
      };
    }

    if (table !== "canvas_assets") return {};

    return {
      select,
      insert,
      delete: deleteRows,
    };
  });

  return {
    from,
    __mocks: {
      countEq,
      select,
      assetEq,
      assetOrder,
      assetLimit,
      assetQuery,
      insert,
      insertSelect,
      insertSingle,
      deleteRows,
      deleteEq,
      deleteIn,
    },
  };
}

function jsonRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/canvas/assets", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setDefaultMocks(admin = createCanvasAssetsAdmin()) {
  mocks.getCanvasUser.mockResolvedValue({ id: "user-1" });
  mocks.requireCanvasAccess.mockResolvedValue({ response: null });
  mocks.requireCanvasAdmin.mockReturnValue({ admin, response: null });
  mocks.getGoogleDriveAccessTokenForUser.mockResolvedValue("drive-token");
  mocks.getGoogleDriveConnection.mockResolvedValue({
    id: "connection-1",
    user_id: "user-1",
    google_email: "user@example.com",
    folder_id: "generated-folder",
    folder_name: "Kavero Generated Images",
    scope: "drive.file",
    status: "active",
    folder_status: "available",
    canvas_folder_id: "canvas-folder-1",
    canvas_folder_name: "Kavero Canvas Assets",
    canvas_folder_status: "available",
    connected_at: "2026-05-26T00:00:00.000Z",
    updated_at: "2026-05-26T00:00:00.000Z",
  });
  mocks.uploadGoogleDriveFile.mockResolvedValue({
    id: "drive-file-1",
    name: "Product-Photo-asset-fi.png",
    mimeType: "image/png",
    webViewLink: "https://drive.example/drive-file-1",
  });
  mocks.resolveRuntimeManagedStorageBackend.mockReturnValue({
    ok: true,
    backend: managedBackend(),
  });
  mocks.getRuntimeManagedStorageDispatchDependencies.mockReturnValue({
    ok: true,
    dependencies: { managedBackends: { "supabase-storage": managedBackend() } },
  });
  mocks.deleteStorageObjects.mockResolvedValue({ ok: true, deleted: 1, unsupportedRefs: [] });

  return admin;
}

function managedRef(overrides: Record<string, unknown> = {}) {
  return {
    providerId: "kavero-managed",
    kind: "managed",
    purpose: "canvas-asset",
    objectKey: "users/user-1/canvas-assets/asset-fixed-id/Product-Photo-asset-fi.png",
    bucket: "kavero-canvas-assets",
    path: "users/user-1/canvas-assets/asset-fixed-id/Product-Photo-asset-fi.png",
    externalId: null,
    externalUrl: null,
    metadata: { backendProviderId: "supabase-storage", contentType: "image/png" },
    status: "available",
    version: 1,
    ...overrides,
  };
}

function managedBackend(id = "supabase-storage") {
  return {
    id,
    kind: "managed",
    ensureReady: vi.fn(async () => ({ providerId: "kavero-managed", kind: "managed", ready: true, connected: true })),
    uploadObject: vi.fn(async (input: {
      name: string;
      mimeType: string;
      metadata: { objectKey: string };
    }) => ({
      ref: managedRef({
        objectKey: input.metadata.objectKey,
        path: input.metadata.objectKey,
        metadata: { backendProviderId: id, contentType: input.mimeType },
      }),
      name: input.name,
      mimeType: input.mimeType,
    })),
    deleteObject: vi.fn(async () => undefined),
  };
}

describe("canvas assets API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KAVERO_STORAGE_PROVIDER;
    vi.stubGlobal("crypto", { randomUUID: () => "asset-fixed-id" });
    setDefaultMocks();
  });

  it("writes legacy Google Drive fields and provider-neutral storage metadata on upload", async () => {
    const admin = setDefaultMocks();

    const response = await POST(imageRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      asset: {
        id: "asset-fixed-id",
        public_url: "/api/canvas/assets/asset-fixed-id",
        drive_file_id: "drive-file-1",
        drive_status: "available",
      },
    });
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledWith(
      "drive-token",
      expect.objectContaining({
        name: "Product-Photo-asset-fi.png",
        mimeType: "image/png",
        folderId: "canvas-folder-1",
      }),
    );
    expect(admin.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "asset-fixed-id",
        user_id: "user-1",
        storage_provider: "google-drive",
        bucket: "google-drive",
        storage_path: "drive-file-1",
        original_name: "Product Photo.png",
        content_type: "image/png",
        size_bytes: 11,
        public_url: "/api/canvas/assets/asset-fixed-id",
        drive_file_id: "drive-file-1",
        drive_file_name: "Product-Photo-asset-fi.png",
        drive_web_view_link: "https://drive.example/drive-file-1",
        drive_status: "available",
        storage_kind: "connected",
        storage_status: "available",
        storage_external_id: "drive-file-1",
        storage_external_url: "https://drive.example/drive-file-1",
        storage_ref: {
          providerId: "google-drive",
          kind: "connected",
          purpose: "canvas-asset",
          objectKey: "drive-file-1",
          bucket: "google-drive",
          path: "drive-file-1",
          externalId: "drive-file-1",
          externalUrl: "https://drive.example/drive-file-1",
          metadata: expect.objectContaining({
            providerId: "google-drive",
            folderId: "canvas-folder-1",
            name: "Product-Photo-asset-fi.png",
            originalName: "Product Photo.png",
            contentType: "image/png",
            sizeBytes: 11,
          }),
          status: "available",
          version: 1,
        },
        storage_metadata: expect.objectContaining({
          providerId: "google-drive",
          folderId: "canvas-folder-1",
          driveFileName: "Product-Photo-asset-fi.png",
          originalName: "Product Photo.png",
          contentType: "image/png",
          sizeBytes: 11,
        }),
      }),
    );
  });

  it("uses Google Drive upload when KAVERO_STORAGE_PROVIDER is empty", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "   ";

    const response = await POST(imageRequest());

    expect(response.status).toBe(200);
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledTimes(1);
    expect(mocks.resolveRuntimeManagedStorageBackend).not.toHaveBeenCalled();
  });

  it("falls back to Google Drive upload for an invalid KAVERO_STORAGE_PROVIDER", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "typo-provider";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await POST(imageRequest());

    expect(response.status).toBe(200);
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledTimes(1);
    expect(mocks.resolveRuntimeManagedStorageBackend).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Ignoring invalid KAVERO_STORAGE_PROVIDER value"),
    );
  });

  it("uses Google Drive upload when KAVERO_STORAGE_PROVIDER is google-drive", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "google-drive";

    const response = await POST(imageRequest());

    expect(response.status).toBe(200);
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledTimes(1);
    expect(mocks.resolveRuntimeManagedStorageBackend).not.toHaveBeenCalled();
  });

  it("uploads canvas assets through managed storage when explicitly configured", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    const backend = managedBackend();
    const admin = setDefaultMocks(
      createCanvasAssetsAdmin({
        insertResult: {
          data: {
            id: "asset-fixed-id",
            original_name: "Product Photo.png",
            content_type: "image/png",
            size_bytes: 11,
            public_url: "/api/canvas/assets/asset-fixed-id",
            drive_file_id: null,
            drive_file_name: null,
            drive_web_view_link: null,
            drive_status: "available",
            last_used_at: null,
            created_at: "2026-05-26T00:00:00.000Z",
          },
          error: null,
        },
      }),
    );
    mocks.resolveRuntimeManagedStorageBackend.mockReturnValueOnce({ ok: true, backend });

    const response = await POST(imageRequest());

    expect(response.status).toBe(200);
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
    expect(backend.ensureReady).toHaveBeenCalledWith({ userId: "user-1", purpose: "canvas-asset" });
    expect(backend.uploadObject).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        purpose: "canvas-asset",
        name: "Product-Photo-asset-fi.png",
        mimeType: "image/png",
        metadata: expect.objectContaining({
          objectKey: "users/user-1/canvas-assets/asset-fixed-id/Product-Photo-asset-fi.png",
          originalName: "Product Photo.png",
          contentType: "image/png",
          sizeBytes: 11,
        }),
      }),
    );
    expect(admin.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "asset-fixed-id",
        user_id: "user-1",
        storage_provider: "kavero-managed",
        bucket: "kavero-canvas-assets",
        storage_path: "users/user-1/canvas-assets/asset-fixed-id/Product-Photo-asset-fi.png",
        public_url: "/api/canvas/assets/asset-fixed-id",
        drive_file_id: null,
        drive_file_name: null,
        drive_web_view_link: null,
        storage_kind: "managed",
        storage_status: "available",
        storage_ref: expect.objectContaining({
          providerId: "kavero-managed",
          bucket: "kavero-canvas-assets",
          metadata: expect.objectContaining({ backendProviderId: "supabase-storage" }),
        }),
        storage_metadata: expect.objectContaining({
          providerId: "kavero-managed",
          backendProviderId: "supabase-storage",
        }),
        storage_external_id: null,
        storage_external_url: null,
      }),
    );
  });

  it("keeps canvas asset refs logical when the managed backend is local filesystem", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    const backend = managedBackend("local-filesystem");
    const admin = setDefaultMocks();
    mocks.resolveRuntimeManagedStorageBackend.mockReturnValueOnce({ ok: true, backend });

    const response = await POST(imageRequest());

    expect(response.status).toBe(200);
    expect(admin.__mocks.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        storage_provider: "kavero-managed",
        bucket: "kavero-canvas-assets",
        storage_path: "users/user-1/canvas-assets/asset-fixed-id/Product-Photo-asset-fi.png",
        storage_ref: expect.objectContaining({
          providerId: "kavero-managed",
          kind: "managed",
          bucket: "kavero-canvas-assets",
          objectKey: "users/user-1/canvas-assets/asset-fixed-id/Product-Photo-asset-fi.png",
          path: "users/user-1/canvas-assets/asset-fixed-id/Product-Photo-asset-fi.png",
          metadata: expect.objectContaining({ backendProviderId: "local-filesystem" }),
        }),
        storage_metadata: expect.objectContaining({
          providerId: "kavero-managed",
          backendProviderId: "local-filesystem",
        }),
      }),
    );
    const insertedRows = admin.__mocks.insert.mock.calls as unknown as Array<[Record<string, unknown>]>;
    expect(JSON.stringify(insertedRows[0][0])).not.toContain("local-filesystem:");
  });

  it("returns a managed upload error when the managed backend is unavailable", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    mocks.resolveRuntimeManagedStorageBackend.mockReturnValueOnce({
      ok: false,
      reason: "backend-not-registered",
      backendId: "supabase-storage",
    });

    const response = await POST(imageRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Unable to upload image to managed storage." });
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
  });

  it("cleans up a managed upload when metadata insert fails", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    const backend = managedBackend();
    setDefaultMocks(
      createCanvasAssetsAdmin({
        insertResult: { data: null, error: new Error("insert failed") },
      }),
    );
    mocks.resolveRuntimeManagedStorageBackend.mockReturnValueOnce({ ok: true, backend });

    const response = await POST(imageRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Image uploaded, but asset metadata could not be saved.",
    });
    expect(backend.deleteObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: expect.objectContaining({ providerId: "kavero-managed" }),
    });
  });

  it("lists assets with provider-neutral storage metadata fields", async () => {
    const admin = setDefaultMocks(
      createCanvasAssetsAdmin({
        assetsResult: {
          data: [
            {
              id: "asset-1",
              original_name: "poster.png",
              content_type: "image/png",
              size_bytes: 2048,
              public_url: "/api/canvas/assets/asset-1",
              drive_file_id: "drive-file-1",
              drive_file_name: "poster.png",
              drive_web_view_link: "https://drive.example/drive-file-1",
              drive_status: "available",
              storage_ref: {
                providerId: "google-drive",
                kind: "connected",
                purpose: "canvas-asset",
                objectKey: "drive-file-1",
                externalId: "drive-file-1",
                status: "available",
                version: 1,
              },
              storage_kind: "connected",
              storage_status: "available",
              storage_metadata: {},
              storage_external_id: "drive-file-1",
              storage_external_url: "https://drive.example/drive-file-1",
              last_used_at: null,
              created_at: "2026-05-26T00:00:00.000Z",
            },
          ],
          error: null,
        },
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      assets: [
        {
          id: "asset-1",
          drive_file_id: "drive-file-1",
          drive_status: "available",
          storage_status: "available",
          storage_external_id: "drive-file-1",
        },
      ],
    });
    expect(admin.__mocks.select).toHaveBeenCalledWith(
      "id, original_name, content_type, size_bytes, public_url, drive_file_id, drive_file_name, drive_web_view_link, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url, last_used_at, created_at",
    );
  });

  it("returns the current missing-token response without uploading", async () => {
    mocks.getGoogleDriveAccessTokenForUser.mockResolvedValueOnce(null);

    const response = await POST(imageRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Google Drive is not connected." });
    expect(mocks.uploadGoogleDriveFile).not.toHaveBeenCalled();
  });

  it("returns the current reconnect response when Drive upload needs reconnect", async () => {
    const reconnectError = new Error("reconnect");
    mocks.uploadGoogleDriveFile.mockRejectedValueOnce(reconnectError);
    mocks.isGoogleDriveReconnectError.mockReturnValueOnce(true);

    const response = await POST(imageRequest());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "Google Drive needs to be reconnected." });
    expect(mocks.markGoogleDriveReconnectRequired).toHaveBeenCalledWith("user-1");
  });

  it("returns the current Drive upload failure response for non-reconnect errors", async () => {
    mocks.uploadGoogleDriveFile.mockRejectedValueOnce(new Error("Drive failed"));
    mocks.isGoogleDriveReconnectError.mockReturnValueOnce(false);

    const response = await POST(imageRequest());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Unable to upload image to Google Drive." });
  });

  it("returns the current metadata insert failure response after upload", async () => {
    setDefaultMocks(
      createCanvasAssetsAdmin({
        insertResult: { data: null, error: new Error("insert failed") },
      }),
    );

    const response = await POST(imageRequest());

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Image uploaded, but asset metadata could not be saved.",
    });
    expect(mocks.uploadGoogleDriveFile).toHaveBeenCalledTimes(1);
  });

  it("bulk deletes mixed storage-ref and legacy assets with deduped Drive ids", async () => {
    const admin = setDefaultMocks(
      createCanvasAssetsAdmin({
        assetsResult: {
          data: [
            {
              id: "asset-1",
              storage_provider: "google-drive",
              drive_file_id: "legacy-file-1",
              drive_status: "available",
              storage_ref: {
                providerId: "google-drive",
                kind: "connected",
                purpose: "canvas-asset",
                objectKey: "ref-file-1",
                externalId: "ref-file-1",
                status: "available",
                version: 1,
              },
            },
            {
              id: "asset-2",
              storage_provider: "google-drive",
              drive_file_id: "legacy-file-2",
              drive_status: "available",
              storage_ref: null,
            },
            {
              id: "asset-3",
              storage_provider: "google-drive",
              drive_file_id: "legacy-file-2",
              drive_status: "available",
              storage_ref: null,
            },
          ],
          error: null,
        },
      }),
    );

    const response = await DELETE(jsonRequest({ assetIds: ["asset-1", "asset-2", "asset-3"] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: 3 });
    expect(admin.__mocks.select).toHaveBeenCalledWith(
      "id, storage_provider, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    );
    expect(mocks.deleteGoogleDriveFile).toHaveBeenCalledTimes(2);
    expect(mocks.deleteGoogleDriveFile).toHaveBeenNthCalledWith(1, "drive-token", "ref-file-1");
    expect(mocks.deleteGoogleDriveFile).toHaveBeenNthCalledWith(2, "drive-token", "legacy-file-2");
    expect(admin.__mocks.deleteIn).toHaveBeenCalledWith("id", ["asset-1", "asset-2", "asset-3"]);
  });

  it("bulk delete skips unsupported provider refs and still deletes DB rows", async () => {
    const admin = setDefaultMocks(
      createCanvasAssetsAdmin({
        assetsResult: {
          data: [
            {
              id: "asset-1",
              storage_provider: "google-drive",
              drive_file_id: "legacy-file-1",
              drive_status: "available",
              storage_ref: {
                providerId: "s3-compatible",
                kind: "managed",
                purpose: "canvas-asset",
                objectKey: "asset-1.png",
                status: "available",
                version: 1,
              },
            },
          ],
          error: null,
        },
      }),
    );

    const response = await DELETE(jsonRequest({ assetIds: ["asset-1"] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: 1 });
    expect(mocks.getGoogleDriveAccessTokenForUser).not.toHaveBeenCalled();
    expect(mocks.deleteGoogleDriveFile).not.toHaveBeenCalled();
    expect(admin.__mocks.deleteIn).toHaveBeenCalledWith("id", ["asset-1"]);
  });

  it("bulk delete removes managed storage refs through dispatch and deletes DB rows", async () => {
    const admin = setDefaultMocks(
      createCanvasAssetsAdmin({
        assetsResult: {
          data: [
            {
              id: "asset-1",
              storage_provider: "kavero-managed",
              drive_file_id: null,
              drive_status: "available",
              storage_ref: managedRef({ objectKey: "managed-asset", path: "managed-asset" }),
            },
          ],
          error: null,
        },
      }),
    );

    const response = await DELETE(jsonRequest({ assetIds: ["asset-1"] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, deleted: 1 });
    expect(mocks.deleteStorageObjects).toHaveBeenCalledWith({
      userId: "user-1",
      refs: [expect.objectContaining({ providerId: "kavero-managed", objectKey: "managed-asset" })],
      dependencies: expect.any(Object),
    });
    expect(admin.__mocks.deleteIn).toHaveBeenCalledWith("id", ["asset-1"]);
    expect(mocks.deleteGoogleDriveFile).not.toHaveBeenCalled();
  });
});
