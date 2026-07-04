import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getGoogleDriveAccessTokenForUser: vi.fn(),
  markGoogleDriveReconnectRequired: vi.fn(),
  getRuntimeManagedStorageDispatchDependencies: vi.fn(),
  readStorageObject: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/google-drive", () => ({
  getGoogleDriveAccessTokenForUser: mocks.getGoogleDriveAccessTokenForUser,
  markGoogleDriveReconnectRequired: mocks.markGoogleDriveReconnectRequired,
}));

vi.mock("@/modules/storage/dispatch/storage-object-dispatch", () => ({
  readStorageObject: mocks.readStorageObject,
}));

vi.mock("@/modules/storage/managed/runtime", () => ({
  getRuntimeManagedStorageDispatchDependencies: mocks.getRuntimeManagedStorageDispatchDependencies,
}));

import { GET } from "./route";

type ImageRow = {
  id: string;
  mime_type: string | null;
  storage_ref: unknown | null;
  storage_provider: string | null;
  storage_kind: string | null;
  storage_status: string | null;
  storage_external_id: string | null;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_web_view_link: string | null;
  drive_status: "available" | "missing" | "unknown";
};

function imageRow(overrides: Partial<ImageRow> = {}): ImageRow {
  return {
    id: "image-1",
    mime_type: "image/png",
    storage_ref: null,
    storage_provider: null,
    storage_kind: null,
    storage_status: null,
    storage_external_id: null,
    drive_file_id: "legacy-drive-file",
    drive_file_name: "legacy.png",
    drive_web_view_link: "https://drive.google.com/file/d/legacy-drive-file/view",
    drive_status: "available",
    ...overrides,
  };
}

function createSupabaseClient(options: {
  user?: { id: string } | null;
  userError?: Error | null;
  record?: ImageRow | null;
  recordError?: Error | null;
} = {}) {
  const user = options.user === undefined ? { id: "user-1" } : options.user;
  const userError = options.userError ?? null;
  const record = options.record === undefined ? imageRow() : options.record;
  const recordError = options.recordError ?? null;

  const updateEqUser = vi.fn(async () => ({ error: null }));
  const updateEqId = vi.fn(() => ({ eq: updateEqUser }));
  const update = vi.fn(() => ({ eq: updateEqId }));
  const maybeSingle = vi.fn(async () => ({ data: record, error: recordError }));
  const selectEqUser = vi.fn(() => ({ maybeSingle }));
  const selectEqId = vi.fn(() => ({ eq: selectEqUser }));
  const select = vi.fn(() => ({ eq: selectEqId }));
  const from = vi.fn(() => ({ select, update }));

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user },
        error: userError,
      })),
    },
    from,
    __mocks: {
      from,
      select,
      selectEqId,
      selectEqUser,
      maybeSingle,
      update,
      updateEqId,
      updateEqUser,
    },
  };
}

function request() {
  return new Request("http://localhost/api/gallery/images/image-1/content");
}

function context(imageId = "image-1") {
  return { params: Promise.resolve({ imageId }) };
}

describe("generated image content route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.createClient.mockReturnValue(createSupabaseClient());
    mocks.getGoogleDriveAccessTokenForUser.mockResolvedValue("drive-token");
    mocks.readStorageObject.mockResolvedValue({
      ok: false,
      reason: "backend-not-registered",
      backendId: "supabase-storage",
    });
    mocks.getRuntimeManagedStorageDispatchDependencies.mockReturnValue({
      ok: true,
      dependencies: {},
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("image-bytes", { headers: { "Content-Type": "image/webp" } })),
    );
  });

  it("rejects unauthenticated users", async () => {
    mocks.createClient.mockReturnValueOnce(createSupabaseClient({ user: null }));

    const response = await GET(request(), context());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
  });

  it("returns 404 for missing or non-owned images", async () => {
    mocks.createClient.mockReturnValueOnce(createSupabaseClient({ record: null }));

    const response = await GET(request(), context("missing-image"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
  });

  it("streams a Google Drive image from a valid storage_ref", async () => {
    mocks.createClient.mockReturnValueOnce(
      createSupabaseClient({
        record: imageRow({
          storage_ref: {
            providerId: "google-drive",
            kind: "connected",
            purpose: "generated-image",
            objectKey: "object-key-file",
            externalId: "storage-ref-file",
            externalUrl: "https://drive.google.com/file/d/storage-ref-file/view",
            status: "available",
            version: 1,
          },
          drive_file_id: "legacy-drive-file",
        }),
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=300");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/storage-ref-file?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
    await expect(response.text()).resolves.toBe("image-bytes");
  });

  it("streams a kavero-managed image through storage dispatch", async () => {
    mocks.createClient.mockReturnValueOnce(
      createSupabaseClient({
        record: imageRow({
          storage_ref: {
            providerId: "kavero-managed",
            kind: "managed",
            purpose: "generated-image",
            objectKey: "users/user-1/generated-image/image.png",
            bucket: "kavero-generated-images",
            path: "users/user-1/generated-image/image.png",
            externalId: null,
            externalUrl: null,
            metadata: { backendProviderId: "supabase-storage", contentType: "image/png" },
            status: "available",
            version: 1,
          },
          drive_file_id: "legacy-drive-file",
        }),
      }),
    );
    mocks.readStorageObject.mockResolvedValueOnce({
      ok: true,
      object: {
        data: new TextEncoder().encode("managed-image"),
        mimeType: "image/png",
      },
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    await expect(response.text()).resolves.toBe("managed-image");
    expect(mocks.readStorageObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: expect.objectContaining({
        providerId: "kavero-managed",
        objectKey: "users/user-1/generated-image/image.png",
      }),
      dependencies: {},
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("streams a historical supabase-storage image through runtime storage dispatch", async () => {
    mocks.createClient.mockReturnValueOnce(
      createSupabaseClient({
        record: imageRow({
          storage_ref: {
            providerId: "supabase-storage",
            kind: "managed",
            purpose: "generated-image",
            objectKey: "users/user-1/generated-image/image.png",
            bucket: "kavero-generated-images",
            path: "users/user-1/generated-image/image.png",
            externalId: null,
            externalUrl: null,
            metadata: { contentType: "image/webp" },
            status: "available",
            version: 1,
          },
          drive_file_id: null,
        }),
      }),
    );
    mocks.readStorageObject.mockResolvedValueOnce({
      ok: true,
      object: {
        data: new TextEncoder().encode("historical-managed-image"),
        mimeType: "image/webp",
      },
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    await expect(response.text()).resolves.toBe("historical-managed-image");
    expect(mocks.readStorageObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: expect.objectContaining({
        providerId: "supabase-storage",
        objectKey: "users/user-1/generated-image/image.png",
      }),
      dependencies: {},
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("streams through legacy Drive fallback when storage_ref is missing", async () => {
    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/legacy-drive-file?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
  });

  it("falls back to legacy Drive fields when storage_ref is malformed", async () => {
    mocks.createClient.mockReturnValueOnce(
      createSupabaseClient({
        record: imageRow({
          storage_ref: { providerId: "not-supported", objectKey: "bad" },
        }),
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/legacy-drive-file?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
  });

  it("returns 501 when a managed ref has no registered backend", async () => {
    mocks.createClient.mockReturnValueOnce(
      createSupabaseClient({
        record: imageRow({
          storage_ref: {
            providerId: "kavero-managed",
            kind: "managed",
            purpose: "generated-image",
            objectKey: "managed-object",
            status: "available",
            version: 1,
          },
          drive_file_id: "legacy-drive-file",
        }),
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "Storage provider is not supported for image streaming yet.",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns a clear managed storage error when runtime dependencies are unavailable", async () => {
    mocks.createClient.mockReturnValueOnce(
      createSupabaseClient({
        record: imageRow({
          storage_ref: {
            providerId: "kavero-managed",
            kind: "managed",
            purpose: "generated-image",
            objectKey: "managed-object",
            bucket: "kavero-generated-images",
            path: "managed-object",
            metadata: { backendProviderId: "supabase-storage" },
            status: "available",
            version: 1,
          },
          drive_file_id: null,
        }),
      }),
    );
    mocks.getRuntimeManagedStorageDispatchDependencies.mockReturnValueOnce({
      ok: false,
      reason: "not-configured",
      error: new Error("missing admin env"),
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Managed storage is not configured.",
    });
    expect(mocks.readStorageObject).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("returns 404 when a managed image object is missing", async () => {
    mocks.createClient.mockReturnValueOnce(
      createSupabaseClient({
        record: imageRow({
          storage_ref: {
            providerId: "kavero-managed",
            kind: "managed",
            purpose: "generated-image",
            objectKey: "managed-object",
            bucket: "kavero-generated-images",
            path: "managed-object",
            metadata: { backendProviderId: "supabase-storage" },
            status: "available",
            version: 1,
          },
          drive_file_id: null,
        }),
      }),
    );
    mocks.readStorageObject.mockResolvedValueOnce({
      ok: false,
      reason: "missing",
      error: new Error("missing"),
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Image is missing in storage." });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not use KAVERO_STORAGE_PROVIDER to decide how existing images are read", async () => {
    vi.stubEnv("KAVERO_STORAGE_PROVIDER", "google-drive");
    mocks.createClient.mockReturnValueOnce(
      createSupabaseClient({
        record: imageRow({
          storage_ref: {
            providerId: "kavero-managed",
            kind: "managed",
            purpose: "generated-image",
            objectKey: "managed-object",
            bucket: "kavero-generated-images",
            path: "managed-object",
            metadata: { backendProviderId: "supabase-storage" },
            status: "available",
            version: 1,
          },
          drive_file_id: "legacy-drive-file",
        }),
      }),
    );
    mocks.readStorageObject.mockResolvedValueOnce({
      ok: true,
      object: {
        data: new TextEncoder().encode("managed-image"),
        mimeType: "image/png",
      },
    });

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("managed-image");
    expect(mocks.readStorageObject).toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("marks the generated image missing when Google Drive returns 404", async () => {
    const supabase = createSupabaseClient();
    mocks.createClient.mockReturnValueOnce(supabase);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Image is missing in Google Drive." });
    expect(supabase.__mocks.update).toHaveBeenCalledWith({ drive_status: "missing" });
    expect(supabase.__mocks.updateEqId).toHaveBeenCalledWith("id", "image-1");
    expect(supabase.__mocks.updateEqUser).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("marks Google Drive reconnect required when Drive returns 401 or 403", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));

    const response = await GET(request(), context());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "Google Drive needs to be reconnected.",
    });
    expect(mocks.markGoogleDriveReconnectRequired).toHaveBeenCalledWith("user-1");
  });
});
