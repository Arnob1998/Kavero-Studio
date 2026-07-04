import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StorageError, type StoredObjectRef } from "@/modules/storage/storage-provider";
import { createLocalFilesystemStorageBackend } from "./local-filesystem-backend";

const cleanupPaths: string[] = [];

async function tempDir(prefix = "kavero-local-storage-") {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  cleanupPaths.push(directory);
  return directory;
}

function backend(root: string | null | undefined) {
  return createLocalFilesystemStorageBackend({ root });
}

function ref(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "kavero-managed",
    kind: "managed",
    purpose: "canvas-asset",
    objectKey: "users/user-1/canvas-assets/asset.png",
    bucket: "kavero-canvas-assets",
    path: "users/user-1/canvas-assets/asset.png",
    externalId: null,
    externalUrl: null,
    metadata: {
      backendProviderId: "local-filesystem",
      contentType: "image/png",
    },
    status: "available",
    version: 1,
    ...overrides,
  };
}

describe("local filesystem storage backend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    while (cleanupPaths.length > 0) {
      const target = cleanupPaths.pop();
      if (target) await rm(target, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("uploads, reads, and deletes objects under a configured root", async () => {
    const root = await tempDir();
    const storage = backend(root);

    const uploaded = await storage.uploadObject({
      userId: "user-1",
      purpose: "canvas-asset",
      name: "Asset.png",
      mimeType: "image/png",
      data: new TextEncoder().encode("image-bytes"),
      metadata: {
        objectKey: "users/user-1/canvas-assets/asset.png",
        originalName: "Asset.png",
      },
    });

    expect(uploaded).toMatchObject({
      name: "Asset.png",
      mimeType: "image/png",
      sizeBytes: 11,
      webViewUrl: null,
      ref: {
        providerId: "kavero-managed",
        kind: "managed",
        purpose: "canvas-asset",
        bucket: "kavero-canvas-assets",
        objectKey: "users/user-1/canvas-assets/asset.png",
        path: "users/user-1/canvas-assets/asset.png",
        externalId: null,
        externalUrl: null,
        status: "available",
        version: 1,
      },
    });
    expect(uploaded.ref.metadata).toMatchObject({
      backendProviderId: "local-filesystem",
      name: "Asset.png",
      contentType: "image/png",
      originalName: "Asset.png",
      sizeBytes: 11,
    });
    expect(uploaded.ref.metadata).not.toHaveProperty("objectKey");
    expect(JSON.stringify(uploaded.ref).replace(/\\\\/g, "/")).not.toContain(root.replace(/\\/g, "/"));

    await expect(readFile(path.join(root, "users/user-1/canvas-assets/asset.png"), "utf8")).resolves.toBe("image-bytes");

    const read = await storage.readObject({ userId: "user-1", ref: uploaded.ref });
    expect(read.mimeType).toBe("image/png");
    expect(Buffer.from(read.data as Uint8Array).toString("utf8")).toBe("image-bytes");
    expect(read.sizeBytes).toBe(11);

    await expect(storage.getReadUrl?.({ userId: "user-1", ref: uploaded.ref })).resolves.toBeNull();
    await expect(storage.deleteObject({ userId: "user-1", ref: uploaded.ref })).resolves.toBeUndefined();
    await expect(storage.readObject({ userId: "user-1", ref: uploaded.ref })).rejects.toMatchObject({
      name: "StorageError",
      code: "missing",
      providerId: "kavero-managed",
    });
  });

  it("uses generated relative keys when callers do not provide an object key", async () => {
    const root = await tempDir();
    const storage = backend(root);
    vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000001");

    const uploaded = await storage.uploadObject({
      userId: "user/unsafe",
      purpose: "generated-image",
      name: "Generated Image!.png",
      mimeType: "image/png",
      data: "image",
    });

    expect(uploaded.ref.objectKey).toBe(
      "users/user-unsafe/generated-image/00000000-0000-4000-8000-000000000001-Generated-Image-.png",
    );
    expect(uploaded.ref.bucket).toBe("kavero-generated-images");
    expect(path.isAbsolute(uploaded.ref.objectKey)).toBe(false);
  });

  it("supports concurrent uploads that share a generated image parent directory", async () => {
    const root = await tempDir();
    const storage = backend(root);
    const parentKey = "users/user-1/generated-images/generation-1";

    const uploads = await Promise.all(
      Array.from({ length: 16 }, async (_, index) => {
        const imageNumber = index + 1;
        return storage.uploadObject({
          userId: "user-1",
          purpose: "generated-image",
          name: `image-${imageNumber}.png`,
          mimeType: "image/png",
          data: `image-${imageNumber}`,
          metadata: {
            objectKey: `${parentKey}/image-${imageNumber}.png`,
          },
        });
      }),
    );

    expect(uploads).toHaveLength(16);
    for (const [index, upload] of uploads.entries()) {
      const imageNumber = index + 1;
      expect(upload.ref).toMatchObject({
        providerId: "kavero-managed",
        kind: "managed",
        purpose: "generated-image",
        bucket: "kavero-generated-images",
        objectKey: `${parentKey}/image-${imageNumber}.png`,
        path: `${parentKey}/image-${imageNumber}.png`,
      });
      expect(upload.ref.metadata).toMatchObject({
        backendProviderId: "local-filesystem",
        contentType: "image/png",
        name: `image-${imageNumber}.png`,
      });
      expect(JSON.stringify(upload.ref).replace(/\\\\/g, "/")).not.toContain(root.replace(/\\/g, "/"));
      await expect(readFile(path.join(root, parentKey, `image-${imageNumber}.png`), "utf8")).resolves.toBe(
        `image-${imageNumber}`,
      );
    }
  });

  it("reports ready status for an absolute writable directory", async () => {
    const root = await tempDir();
    const storage = backend(root);

    await expect(storage.getStatus({ userId: "user-1", purpose: "canvas-asset" })).resolves.toEqual({
      providerId: "kavero-managed",
      kind: "managed",
      ready: true,
      connected: true,
      warning: null,
    });
    await expect(storage.ensureReady({ userId: "user-1", purpose: "canvas-asset" })).resolves.toMatchObject({
      ready: true,
      connected: true,
    });
    await expect(storage.ensureDeploymentReady()).resolves.toMatchObject({
      ready: true,
      connected: true,
    });
  });

  it("fails closed when the root is missing, relative, or not a directory", async () => {
    const root = await tempDir();
    const fileRoot = path.join(root, "not-a-directory.txt");
    await writeFile(fileRoot, "not a directory");

    await expect(backend(undefined).ensureReady({ userId: "user-1", purpose: "canvas-asset" })).rejects.toMatchObject({
      name: "StorageError",
      code: "not_configured",
    });
    await expect(backend("relative/storage").ensureReady({ userId: "user-1", purpose: "canvas-asset" })).rejects.toMatchObject({
      name: "StorageError",
      code: "not_configured",
    });
    await expect(backend(fileRoot).ensureReady({ userId: "user-1", purpose: "canvas-asset" })).rejects.toMatchObject({
      name: "StorageError",
      code: "not_configured",
    });
    await expect(backend(path.join(root, "missing")).getStatus({ userId: "user-1" })).resolves.toMatchObject({
      ready: false,
      connected: false,
      missingRoot: true,
    });
  });

  it("fails closed when the root is not writable where the platform supports chmod enforcement", async () => {
    if (process.platform === "win32") return;
    const root = await tempDir();
    await chmod(root, 0o555);

    try {
      await expect(backend(root).ensureReady({ userId: "user-1", purpose: "canvas-asset" })).rejects.toMatchObject({
        name: "StorageError",
        code: "not_configured",
      });
    } finally {
      await chmod(root, 0o755);
    }
  });

  it.each([
    "",
    " users/user-1/asset.png",
    "/absolute/path.png",
    "C:/absolute/path.png",
    "C:\\absolute\\path.png",
    "users\\user-1\\asset.png",
    "users/user-1/../asset.png",
    "users//user-1/asset.png",
    "users/user-1/asset.png/",
    "users/./asset.png",
  ])("rejects unsafe object key %s", async (objectKey) => {
    const root = await tempDir();

    await expect(
      backend(root).uploadObject({
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
  });

  it("rejects symlink escape attempts before writing outside the root", async () => {
    const root = await tempDir();
    const outside = await tempDir("kavero-local-storage-outside-");
    const linkPath = path.join(root, "escape");
    try {
      await symlink(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
    } catch {
      return;
    }

    await expect(
      backend(root).uploadObject({
        userId: "user-1",
        purpose: "canvas-asset",
        name: "asset.png",
        mimeType: "image/png",
        data: "image",
        metadata: { objectKey: "escape/asset.png" },
      }),
    ).rejects.toMatchObject({
      name: "StorageError",
      code: "provider_error",
      providerId: "kavero-managed",
    });
    await expect(readFile(path.join(outside, "asset.png"))).rejects.toBeTruthy();
  });

  it("maps missing reads to StorageError and missing deletes to success", async () => {
    const root = await tempDir();
    const storage = backend(root);
    const missingRef = ref();

    await expect(storage.readObject({ userId: "user-1", ref: missingRef })).rejects.toMatchObject({
      name: "StorageError",
      code: "missing",
      providerId: "kavero-managed",
    });
    await expect(storage.deleteObject({ userId: "user-1", ref: missingRef })).resolves.toBeUndefined();
  });

  it("serializes, deserializes, and validates local filesystem refs", () => {
    const storage = backend("C:\\tmp\\kavero-storage");
    const localRef = ref();

    expect(storage.serializeRef(localRef)).toEqual(localRef);
    expect(storage.deserializeRef(localRef)).toEqual(localRef);
    expect(() =>
      storage.deserializeRef(ref({ providerId: "local-filesystem", metadata: { backendProviderId: "local-filesystem" } })),
    ).toThrow(StorageError);
    expect(() => storage.deserializeRef(ref({ metadata: { backendProviderId: "supabase-storage" } }))).toThrow(StorageError);
  });

  it("validates refs for markMissing without persisting status", async () => {
    await expect(backend("C:\\tmp\\kavero-storage").markMissing?.({ userId: "user-1", ref: ref() })).resolves.toBeUndefined();
  });

  it("does not overwrite an existing object", async () => {
    const root = await tempDir();
    const storage = backend(root);
    const input = {
      userId: "user-1",
      purpose: "canvas-asset" as const,
      name: "asset.png",
      mimeType: "image/png",
      data: "first",
      metadata: { objectKey: "users/user-1/canvas-assets/asset.png" },
    };

    await storage.uploadObject(input);
    await expect(storage.uploadObject({ ...input, data: "second" })).rejects.toMatchObject({
      name: "StorageError",
      code: "provider_error",
    });
    await expect(readFile(path.join(root, "users/user-1/canvas-assets/asset.png"), "utf8")).resolves.toBe("first");
  });
});
