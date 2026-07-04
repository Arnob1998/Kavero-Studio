import { describe, expect, it, vi } from "vitest";
import { StorageError, type StoredObjectRef } from "@/modules/storage/storage-provider";
import type { ManagedStorageBackend } from "@/modules/storage/managed/kavero-managed-storage";
import { deleteStorageObjects, readStorageObject } from "./storage-object-dispatch";

function ref(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
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
    ...overrides,
  };
}

function backend(id: ManagedStorageBackend["id"] = "supabase-storage") {
  const readObject = vi.fn(async () => ({
    data: new Uint8Array([1, 2, 3]),
    mimeType: "image/png",
  }));
  const deleteObject = vi.fn(async () => undefined);
  const storageBackend: ManagedStorageBackend = {
    id,
    kind: "managed",
    async getStatus() {
      return { providerId: "kavero-managed", kind: "managed", ready: true, connected: true };
    },
    async ensureReady() {
      return { providerId: "kavero-managed", kind: "managed", ready: true, connected: true };
    },
    async uploadObject() {
      return {
        ref: ref(),
        name: "image.png",
        mimeType: "image/png",
      };
    },
    readObject,
    deleteObject,
    async ensureDeploymentReady() {
      return { providerId: "kavero-managed", kind: "managed", ready: true, connected: true };
    },
    serializeRef(inputRef) {
      return inputRef;
    },
    deserializeRef() {
      return ref();
    },
  };

  return { storageBackend, readObject, deleteObject };
}

describe("storage object dispatch", () => {
  it("reads a kavero-managed ref through an injected managed backend", async () => {
    const { storageBackend, readObject } = backend();
    const storageRef = ref();

    await expect(
      readStorageObject({
        userId: "user-1",
        ref: storageRef,
        dependencies: { managedBackends: { "supabase-storage": storageBackend } },
      }),
    ).resolves.toEqual({
      ok: true,
      object: { data: new Uint8Array([1, 2, 3]), mimeType: "image/png" },
    });
    expect(readObject).toHaveBeenCalledWith({ userId: "user-1", ref: storageRef });
  });

  it("reads a local filesystem ref through metadata backend dispatch", async () => {
    const { storageBackend, readObject } = backend("local-filesystem");
    const storageRef = ref({
      bucket: "kavero-generated-images",
      metadata: { backendProviderId: "local-filesystem", contentType: "image/png" },
    });

    await expect(
      readStorageObject({
        userId: "user-1",
        ref: storageRef,
        dependencies: { managedBackends: { "local-filesystem": storageBackend } },
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(readObject).toHaveBeenCalledWith({ userId: "user-1", ref: storageRef });
  });

  it("uses metadata backend id instead of current managed config for existing refs", async () => {
    const supabaseBackend = backend("supabase-storage");
    const localBackend = backend("local-filesystem");
    const storageRef = ref({
      metadata: { backendProviderId: "local-filesystem", contentType: "image/png" },
    });

    await expect(
      deleteStorageObjects({
        userId: "user-1",
        refs: [storageRef],
        dependencies: {
          managedConfig: {
            providerId: "kavero-managed",
            kind: "managed",
            backendId: "supabase-storage",
          },
          managedBackends: {
            "supabase-storage": supabaseBackend.storageBackend,
            "local-filesystem": localBackend.storageBackend,
          },
        },
      }),
    ).resolves.toEqual({ ok: true, deleted: 1, unsupportedRefs: [] });
    expect(localBackend.deleteObject).toHaveBeenCalledWith({ userId: "user-1", ref: storageRef });
    expect(supabaseBackend.deleteObject).not.toHaveBeenCalled();
  });

  it("reads a historical supabase-storage ref through an injected backend", async () => {
    const { storageBackend } = backend();

    await expect(
      readStorageObject({
        userId: "user-1",
        ref: ref({ providerId: "supabase-storage", metadata: { contentType: "image/png" } }),
        dependencies: { supabaseStorageBackend: storageBackend },
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("deletes managed refs through injected backends", async () => {
    const { storageBackend, deleteObject } = backend();
    const firstRef = ref({ objectKey: "first", path: "first" });
    const secondRef = ref({ objectKey: "second", path: "second" });

    await expect(
      deleteStorageObjects({
        userId: "user-1",
        refs: [firstRef, secondRef],
        dependencies: { managedBackends: { "supabase-storage": storageBackend } },
      }),
    ).resolves.toEqual({ ok: true, deleted: 2, unsupportedRefs: [] });
    expect(deleteObject).toHaveBeenCalledTimes(2);
  });

  it("returns unsupported provider results without throwing", async () => {
    await expect(
      readStorageObject({
        userId: "user-1",
        ref: ref({ providerId: "s3-compatible" }),
      }),
    ).resolves.toEqual({ ok: false, reason: "unsupported-provider", providerId: "s3-compatible" });

    await expect(
      deleteStorageObjects({
        userId: "user-1",
        refs: [ref({ providerId: "s3-compatible" })],
      }),
    ).resolves.toEqual({
      ok: true,
      deleted: 0,
      unsupportedRefs: [ref({ providerId: "s3-compatible" })],
    });
  });

  it("returns backend-not-registered when no backend is injected", async () => {
    await expect(
      readStorageObject({
        userId: "user-1",
        ref: ref(),
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "backend-not-registered",
      backendId: "supabase-storage",
    });
  });

  it("maps missing backend errors from reads", async () => {
    const { storageBackend } = backend();
    vi.mocked(storageBackend.readObject).mockRejectedValueOnce(
      new StorageError("Missing", { code: "missing", providerId: "kavero-managed" }),
    );

    await expect(
      readStorageObject({
        userId: "user-1",
        ref: ref(),
        dependencies: { managedBackends: { "supabase-storage": storageBackend } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "missing" });
  });
});
