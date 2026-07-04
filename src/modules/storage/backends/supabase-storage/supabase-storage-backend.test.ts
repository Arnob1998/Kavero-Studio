import { beforeEach, describe, expect, it, vi } from "vitest";
import { StorageError, type StoredObjectRef } from "@/modules/storage/storage-provider";
import {
  createSupabaseStorageBackend,
  type SupabaseStorageBucketClient,
  type SupabaseStorageClient,
} from "./supabase-storage-backend";

type StorageMocks = {
  client: SupabaseStorageClient;
  bucketClient: SupabaseStorageBucketClient;
  upload: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function createStorageMocks(): StorageMocks {
  const upload = vi.fn(async () => ({ data: { path: "stored-path" }, error: null }));
  const download = vi.fn(async () => ({
    data: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
    error: null,
  }));
  const remove = vi.fn(async () => ({ data: [], error: null }));
  const bucketClient = { upload, download, remove };
  const from = vi.fn(() => bucketClient);

  return {
    client: { storage: { from } },
    bucketClient,
    upload,
    download,
    remove,
    from,
  };
}

function backend(mocks = createStorageMocks()) {
  return createSupabaseStorageBackend({ client: mocks.client });
}

function ref(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "kavero-managed",
    kind: "managed",
    purpose: "canvas-asset",
    objectKey: "users/user-1/canvas-asset/asset.png",
    bucket: "kavero-canvas-assets",
    path: "users/user-1/canvas-asset/asset.png",
    externalId: null,
    externalUrl: null,
    metadata: {
      backendProviderId: "supabase-storage",
      contentType: "image/png",
    },
    status: "available",
    version: 1,
    ...overrides,
  };
}

describe("Supabase Storage backend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uploads to the configured bucket and returns a kavero-managed ref", async () => {
    const mocks = createStorageMocks();
    const storage = backend(mocks);
    const data = new Uint8Array([1, 2, 3]);

    const uploaded = await storage.uploadObject({
      userId: "user-1",
      purpose: "canvas-asset",
      name: "asset.png",
      mimeType: "image/png",
      data,
      metadata: {
        objectKey: "users/user-1/canvas-assets/asset.png",
        custom: "value",
      },
    });

    expect(mocks.from).toHaveBeenCalledWith("kavero-canvas-assets");
    expect(mocks.upload).toHaveBeenCalledWith("users/user-1/canvas-assets/asset.png", data, {
      contentType: "image/png",
      upsert: false,
    });
    expect(uploaded).toMatchObject({
      name: "asset.png",
      mimeType: "image/png",
      ref: {
        providerId: "kavero-managed",
        kind: "managed",
        purpose: "canvas-asset",
        bucket: "kavero-canvas-assets",
        path: "users/user-1/canvas-assets/asset.png",
        objectKey: "users/user-1/canvas-assets/asset.png",
        externalId: null,
        externalUrl: null,
        status: "available",
        version: 1,
      },
    });
    expect(uploaded.ref.metadata).toMatchObject({
      backendProviderId: "supabase-storage",
      name: "asset.png",
      contentType: "image/png",
      custom: "value",
    });
  });

  it("generates user and purpose scoped relative object keys", async () => {
    const mocks = createStorageMocks();
    const storage = backend(mocks);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");

    const uploaded = await storage.uploadObject({
      userId: "user/with unsafe",
      purpose: "generated-image",
      name: "Generated Image!.png",
      mimeType: "image/png",
      data: "image",
    });

    expect(uploaded.ref.objectKey).toBe(
      "users/user-with-unsafe/generated-image/00000000-0000-4000-8000-000000000001-Generated-Image-.png",
    );
    expect(uploaded.ref.bucket).toBe("kavero-generated-images");
  });

  it("uses constructor bucket overrides for generated images, metadata, and canvas assets", async () => {
    const mocks = createStorageMocks();
    const storage = createSupabaseStorageBackend({
      client: mocks.client,
      buckets: {
        "generated-image": "custom-generated-images",
        "generated-metadata": "custom-generated-metadata",
        "canvas-asset": "custom-canvas-assets",
      },
    });

    await storage.uploadObject({
      userId: "user-1",
      purpose: "generated-image",
      name: "image.png",
      mimeType: "image/png",
      data: "image",
    });
    await storage.uploadObject({
      userId: "user-1",
      purpose: "generated-metadata",
      name: "image.json",
      mimeType: "application/json",
      data: "{}",
    });
    await storage.uploadObject({
      userId: "user-1",
      purpose: "canvas-asset",
      name: "asset.png",
      mimeType: "image/png",
      data: "asset",
    });

    expect(mocks.from).toHaveBeenCalledWith("custom-generated-images");
    expect(mocks.from).toHaveBeenCalledWith("custom-generated-metadata");
    expect(mocks.from).toHaveBeenCalledWith("custom-canvas-assets");
  });

  it.each(["", "/absolute/path.png", "users\\user\\asset.png", "users/user/../asset.png", "users//asset.png"])(
    "rejects unsafe object key %s",
    async (objectKey) => {
      await expect(
        backend().uploadObject({
          userId: "user-1",
          purpose: "canvas-asset",
          name: "asset.png",
          mimeType: "image/png",
          data: "image",
          metadata: { objectKey },
        }),
      ).rejects.toMatchObject({
        name: "StorageError",
        code: "provider_error",
        providerId: "kavero-managed",
      });
    },
  );

  it("maps upload failures to StorageError", async () => {
    const mocks = createStorageMocks();
    mocks.upload.mockResolvedValueOnce({
      data: null,
      error: { message: "upload failed", statusCode: 500 },
    });

    await expect(
      backend(mocks).uploadObject({
        userId: "user-1",
        purpose: "canvas-asset",
        name: "asset.png",
        mimeType: "image/png",
        data: "image",
      }),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "provider_error",
      providerId: "kavero-managed",
    });
  });

  it("downloads object data by bucket and path", async () => {
    const mocks = createStorageMocks();
    const result = await backend(mocks).readObject({ userId: "user-1", ref: ref() });

    expect(mocks.from).toHaveBeenCalledWith("kavero-canvas-assets");
    expect(mocks.download).toHaveBeenCalledWith("users/user-1/canvas-asset/asset.png");
    expect(result.mimeType).toBe("image/png");
    expect(result.data).toBeInstanceOf(ArrayBuffer);
  });

  it("maps read not found to missing StorageError", async () => {
    const mocks = createStorageMocks();
    mocks.download.mockResolvedValueOnce({
      data: null,
      error: { message: "Object not found", statusCode: 404 },
    });

    await expect(backend(mocks).readObject({ userId: "user-1", ref: ref() })).rejects.toMatchObject({
      name: "StorageError",
      code: "missing",
      providerId: "kavero-managed",
    });
  });

  it("deletes objects by bucket and path", async () => {
    const mocks = createStorageMocks();

    await backend(mocks).deleteObject({ userId: "user-1", ref: ref() });

    expect(mocks.from).toHaveBeenCalledWith("kavero-canvas-assets");
    expect(mocks.remove).toHaveBeenCalledWith(["users/user-1/canvas-asset/asset.png"]);
  });

  it("treats missing deletes as safe and idempotent", async () => {
    const mocks = createStorageMocks();
    mocks.remove.mockResolvedValueOnce({
      data: null,
      error: { message: "Object not found", statusCode: 404 },
    });

    await expect(backend(mocks).deleteObject({ userId: "user-1", ref: ref() })).resolves.toBeUndefined();
  });

  it("returns ready status for configured buckets and null read URLs", async () => {
    const storage = backend();

    await expect(storage.getStatus({ userId: "user-1", purpose: "canvas-asset" })).resolves.toEqual({
      providerId: "kavero-managed",
      kind: "managed",
      ready: true,
      connected: true,
      warning: null,
    });
    await expect(storage.ensureReady({ userId: "user-1", purpose: "canvas-asset" })).resolves.toEqual({
      providerId: "kavero-managed",
      kind: "managed",
      ready: true,
      connected: true,
      warning: null,
    });
    await expect(storage.getReadUrl?.({ userId: "user-1", ref: ref() })).resolves.toBeNull();
  });

  it("reports not configured for a missing bucket config", async () => {
    const storage = createSupabaseStorageBackend({
      client: createStorageMocks().client,
      buckets: { "canvas-asset": "" },
    });

    await expect(storage.getStatus({ userId: "user-1", purpose: "canvas-asset" })).resolves.toMatchObject({
      providerId: "kavero-managed",
      kind: "managed",
      ready: false,
      connected: false,
    });
    await expect(storage.ensureReady({ userId: "user-1", purpose: "canvas-asset" })).rejects.toMatchObject({
      name: "StorageError",
      code: "not_configured",
      providerId: "kavero-managed",
    });
  });

  it("serializes, deserializes, and validates Supabase Storage refs", () => {
    const storage = backend();
    const managedRef = ref();
    const historicalRef = ref({
      providerId: "supabase-storage",
      metadata: { contentType: "image/png" },
    });

    expect(storage.serializeRef(managedRef)).toEqual(managedRef);
    expect(storage.deserializeRef(managedRef)).toEqual(managedRef);
    expect(storage.deserializeRef(historicalRef)).toEqual(historicalRef);
  });

  it("validates refs for markMissing without persisting status", async () => {
    await expect(backend().markMissing?.({ userId: "user-1", ref: ref() })).resolves.toBeUndefined();
  });

  it("does not require real Supabase network access", async () => {
    const mocks = createStorageMocks();

    await backend(mocks).uploadObject({
      userId: "user-1",
      purpose: "canvas-asset",
      name: "asset.png",
      mimeType: "image/png",
      data: "image",
    });

    expect(mocks.from).toHaveBeenCalled();
  });
});
