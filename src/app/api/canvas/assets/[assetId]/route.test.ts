import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

const mocks = vi.hoisted(() => ({
  getCanvasUser: vi.fn(),
  requireCanvasAccess: vi.fn(),
  requireCanvasAdmin: vi.fn(),
  deleteGoogleDriveFile: vi.fn(),
  getGoogleDriveAccessTokenForUser: vi.fn(),
  isGoogleDriveReconnectError: vi.fn(),
  markGoogleDriveReconnectRequired: vi.fn(),
  readStorageObject: vi.fn(),
  deleteStorageObjects: vi.fn(),
  getRuntimeManagedStorageDispatchDependencies: vi.fn(),
}));

vi.mock("@/lib/canvas/api", () => ({
  getCanvasUser: mocks.getCanvasUser,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  requireCanvasAccess: mocks.requireCanvasAccess,
  requireCanvasAdmin: mocks.requireCanvasAdmin,
}));

vi.mock("@/lib/google-drive", () => ({
  deleteGoogleDriveFile: mocks.deleteGoogleDriveFile,
  getGoogleDriveAccessTokenForUser: mocks.getGoogleDriveAccessTokenForUser,
  isGoogleDriveReconnectError: mocks.isGoogleDriveReconnectError,
  markGoogleDriveReconnectRequired: mocks.markGoogleDriveReconnectRequired,
}));

vi.mock("@/modules/storage/dispatch/storage-object-dispatch", () => ({
  readStorageObject: mocks.readStorageObject,
  deleteStorageObjects: mocks.deleteStorageObjects,
}));

vi.mock("@/modules/storage/managed/runtime", () => ({
  getRuntimeManagedStorageDispatchDependencies: mocks.getRuntimeManagedStorageDispatchDependencies,
}));

import { DELETE, GET } from "./route";

type AssetRow = {
  id: string;
  storage_provider: string;
  public_url: string;
  content_type: string | null;
  drive_file_id: string | null;
  drive_status: "available" | "missing" | "unknown";
  storage_ref?: unknown;
};

function googleDriveRef(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "canvas-asset",
    objectKey: "ref-drive-file",
    bucket: "google-drive",
    path: "ref-drive-file",
    externalId: "ref-drive-file",
    externalUrl: "https://drive.example/ref-drive-file",
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

function asset(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: "asset-1",
    storage_provider: "google-drive",
    public_url: "/api/canvas/assets/asset-1",
    content_type: "image/png",
    drive_file_id: "legacy-drive-file",
    drive_status: "available",
    storage_ref: null,
    ...overrides,
  };
}

function createAdmin(row: AssetRow | null, options: { loadError?: unknown } = {}) {
  const maybeSingle = vi.fn(async () => ({ data: row, error: options.loadError ?? null }));
  const secondEq = vi.fn(() => ({ maybeSingle }));
  const firstEq = vi.fn(() => ({ eq: secondEq }));
  const select = vi.fn(() => ({ eq: firstEq }));

  const updateSecondEq = vi.fn(async () => ({ error: null }));
  const updateFirstEq = vi.fn(() => ({ eq: updateSecondEq }));
  const update = vi.fn(() => ({ eq: updateFirstEq }));
  const deleteSecondEq = vi.fn(async () => ({ error: null }));
  const deleteFirstEq = vi.fn(() => ({ eq: deleteSecondEq }));
  const deleteRow = vi.fn(() => ({ eq: deleteFirstEq }));

  const from = vi.fn(() => ({
    select,
    update,
    delete: deleteRow,
  }));

  return {
    from,
    __mocks: {
      maybeSingle,
      select,
      update,
      updateFirstEq,
      updateSecondEq,
      deleteRow,
      deleteFirstEq,
      deleteSecondEq,
    },
  };
}

function context(assetId = "asset-1") {
  return { params: Promise.resolve({ assetId }) };
}

function setDefaultMocks(admin = createAdmin(asset())) {
  mocks.getCanvasUser.mockResolvedValue({ id: "user-1" });
  mocks.requireCanvasAccess.mockResolvedValue({ response: null });
  mocks.requireCanvasAdmin.mockReturnValue({ admin, response: null });
    mocks.getGoogleDriveAccessTokenForUser.mockResolvedValue("drive-token");
    mocks.getRuntimeManagedStorageDispatchDependencies.mockReturnValue({
      ok: true,
      dependencies: { managedBackends: { "supabase-storage": {} } },
    });
    mocks.readStorageObject.mockResolvedValue({
      ok: false,
      reason: "backend-not-registered",
      backendId: "supabase-storage",
    });
    mocks.deleteStorageObjects.mockResolvedValue({ ok: true, deleted: 1, unsupportedRefs: [] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("image-bytes", { headers: { "Content-Type": "image/png" } })),
  );

  return admin;
}

describe("canvas asset content API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KAVERO_STORAGE_PROVIDER;
    setDefaultMocks();
  });

  it("rejects unauthenticated users", async () => {
    mocks.getCanvasUser.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("streams a Google Drive asset through a valid storage_ref", async () => {
    const admin = setDefaultMocks(createAdmin(asset({ storage_ref: googleDriveRef() })));

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("image-bytes");
    expect(admin.__mocks.select).toHaveBeenCalledWith(
      "id, storage_provider, public_url, content_type, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/ref-drive-file?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
  });

  it("streams a kavero-managed asset through storage dispatch", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "google-drive";
    setDefaultMocks(
      createAdmin(
        asset({
          storage_provider: "kavero-managed",
          storage_ref: googleDriveRef({
            providerId: "kavero-managed",
            kind: "managed",
            purpose: "canvas-asset",
            objectKey: "users/user-1/canvas-assets/asset.png",
            bucket: "kavero-canvas-assets",
            path: "users/user-1/canvas-assets/asset.png",
            externalId: null,
            externalUrl: null,
            metadata: { backendProviderId: "supabase-storage", contentType: "image/png" },
          }),
        }),
      ),
    );
    mocks.readStorageObject.mockResolvedValueOnce({
      ok: true,
      object: {
        data: new TextEncoder().encode("managed-asset"),
        mimeType: "image/png",
      },
    });

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("managed-asset");
    expect(mocks.readStorageObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: expect.objectContaining({
        providerId: "kavero-managed",
        objectKey: "users/user-1/canvas-assets/asset.png",
      }),
      dependencies: expect.any(Object),
    });
    expect(mocks.getRuntimeManagedStorageDispatchDependencies).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns a managed storage configuration error when managed read dependencies are unavailable", async () => {
    setDefaultMocks(
      createAdmin(
        asset({
          storage_provider: "kavero-managed",
          storage_ref: googleDriveRef({
            providerId: "kavero-managed",
            kind: "managed",
            purpose: "canvas-asset",
            objectKey: "users/user-1/canvas-assets/asset.png",
            bucket: "kavero-canvas-assets",
            path: "users/user-1/canvas-assets/asset.png",
            externalId: null,
            externalUrl: null,
            metadata: { backendProviderId: "supabase-storage", contentType: "image/png" },
          }),
        }),
      ),
    );
    mocks.getRuntimeManagedStorageDispatchDependencies.mockReturnValueOnce({
      ok: false,
      reason: "not-configured",
      error: new Error("not configured"),
    });

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({ error: "Managed storage is not configured." });
    expect(mocks.readStorageObject).not.toHaveBeenCalled();
  });

  it("streams through legacy Drive fields when storage_ref is missing", async () => {
    setDefaultMocks(createAdmin(asset({ storage_ref: null, drive_file_id: "legacy-drive-file" })));

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/legacy-drive-file?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
  });

  it("falls back to legacy Drive fields when storage_ref is malformed", async () => {
    setDefaultMocks(createAdmin(asset({ storage_ref: { providerId: "google-drive" } })));

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/legacy-drive-file?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
  });

  it("preserves existing non-Drive public_url redirect behavior", async () => {
    setDefaultMocks(
      createAdmin(
        asset({
          storage_provider: "supabase-storage",
          public_url: "https://storage.example/canvas-assets/asset-1.png",
          drive_file_id: null,
        }),
      ),
    );

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://storage.example/canvas-assets/asset-1.png");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns unsupported-provider response for supported-shape non-Drive refs without legacy fallback", async () => {
    setDefaultMocks(
      createAdmin(
        asset({
          drive_file_id: null,
          storage_ref: googleDriveRef({
            providerId: "s3-compatible",
            kind: "managed",
            bucket: "assets",
            path: "asset-1.png",
            objectKey: "asset-1.png",
            externalId: null,
            externalUrl: null,
          }),
        }),
      ),
    );

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "Storage provider is not supported for asset streaming yet.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks a Drive asset missing when Google Drive returns 404", async () => {
    const admin = setDefaultMocks(createAdmin(asset({ storage_ref: googleDriveRef() })));
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));

    const response = await GET(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Asset is missing in Google Drive." });
    expect(admin.__mocks.update).toHaveBeenCalledWith({ drive_status: "missing" });
  });

  it("deletes a single asset using a valid Google Drive storage_ref", async () => {
    const admin = setDefaultMocks(createAdmin(asset({ storage_ref: googleDriveRef() })));

    const response = await DELETE(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(admin.__mocks.select).toHaveBeenCalledWith(
      "id, storage_provider, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    );
    expect(mocks.deleteGoogleDriveFile).toHaveBeenCalledWith("drive-token", "ref-drive-file");
    expect(admin.__mocks.deleteRow).toHaveBeenCalled();
  });

  it("deletes a single asset using legacy Drive fallback", async () => {
    setDefaultMocks(createAdmin(asset({ storage_ref: null, drive_file_id: "legacy-drive-file" })));

    const response = await DELETE(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    expect(mocks.deleteGoogleDriveFile).toHaveBeenCalledWith("drive-token", "legacy-drive-file");
  });

  it("deletes a single asset using legacy Drive fallback when storage_ref is malformed", async () => {
    setDefaultMocks(createAdmin(asset({ storage_ref: { providerId: "google-drive" } })));

    const response = await DELETE(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    expect(mocks.deleteGoogleDriveFile).toHaveBeenCalledWith("drive-token", "legacy-drive-file");
  });

  it("skips unsupported provider storage refs and still deletes the DB row", async () => {
    const admin = setDefaultMocks(
      createAdmin(
        asset({
          drive_file_id: "legacy-drive-file",
          storage_ref: googleDriveRef({
            providerId: "s3-compatible",
            kind: "managed",
            objectKey: "asset-1.png",
            externalId: null,
          }),
        }),
      ),
    );

    const response = await DELETE(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.getGoogleDriveAccessTokenForUser).not.toHaveBeenCalled();
    expect(mocks.deleteGoogleDriveFile).not.toHaveBeenCalled();
    expect(admin.__mocks.deleteRow).toHaveBeenCalled();
  });

  it("deletes a managed asset through storage dispatch and deletes the DB row", async () => {
    process.env.KAVERO_STORAGE_PROVIDER = "google-drive";
    const admin = setDefaultMocks(
      createAdmin(
        asset({
          storage_provider: "kavero-managed",
          drive_file_id: null,
          storage_ref: googleDriveRef({
            providerId: "kavero-managed",
            kind: "managed",
            purpose: "canvas-asset",
            objectKey: "users/user-1/canvas-assets/asset.png",
            bucket: "kavero-canvas-assets",
            path: "users/user-1/canvas-assets/asset.png",
            externalId: null,
            externalUrl: null,
            metadata: { backendProviderId: "supabase-storage", contentType: "image/png" },
          }),
        }),
      ),
    );

    const response = await DELETE(new Request("http://localhost/api/canvas/assets/asset-1"), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.deleteStorageObjects).toHaveBeenCalledWith({
      userId: "user-1",
      refs: [expect.objectContaining({ providerId: "kavero-managed" })],
      dependencies: expect.any(Object),
    });
    expect(mocks.deleteGoogleDriveFile).not.toHaveBeenCalled();
    expect(admin.__mocks.deleteRow).toHaveBeenCalled();
  });
});
