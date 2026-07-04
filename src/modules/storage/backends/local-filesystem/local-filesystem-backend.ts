import { constants as fsConstants } from "node:fs";
import {
  access,
  link,
  lstat,
  mkdir,
  realpath,
  stat,
  unlink,
  writeFile,
  readFile,
} from "node:fs/promises";
import path from "node:path";
import type { ManagedStorageBackend } from "@/modules/storage/managed/kavero-managed-storage";
import {
  StorageError,
  isStorageObjectStatus,
  isStorageProviderKind,
  isStorageProviderId,
  isStoragePurpose,
  type StoragePurpose,
  type StoredObjectRef,
  type UploadObjectInput,
} from "@/modules/storage/storage-provider";

export type LocalFilesystemStorageEnv = {
  KAVERO_LOCAL_STORAGE_ROOT?: string | undefined;
};

export type LocalFilesystemBucketConfig = Partial<Record<StoragePurpose, string>>;

export type LocalFilesystemStorageBackendConfig = {
  root?: string | null;
  env?: LocalFilesystemStorageEnv;
  buckets?: LocalFilesystemBucketConfig;
};

export const defaultLocalFilesystemBuckets = {
  "generated-image": "kavero-generated-images",
  "generated-metadata": "kavero-generated-metadata",
  "canvas-asset": "kavero-canvas-assets",
  "canvas-export": "kavero-canvas-assets",
  "imported-file": "kavero-canvas-assets",
} as const satisfies Record<StoragePurpose, string>;

const backendProviderId = "local-filesystem";

type ResolvedRoot = {
  configuredRoot: string;
  resolvedRoot: string;
  realRoot: string;
};

export function createLocalFilesystemStorageBackend({
  root,
  env,
  buckets,
}: LocalFilesystemStorageBackendConfig = {}): ManagedStorageBackend {
  const bucketConfig = { ...defaultLocalFilesystemBuckets, ...buckets };

  function getConfiguredRoot() {
    return root?.trim() || env?.KAVERO_LOCAL_STORAGE_ROOT?.trim() || process.env.KAVERO_LOCAL_STORAGE_ROOT?.trim() || null;
  }

  function getConfiguredBucket(purpose: StoragePurpose) {
    const bucket = bucketConfig[purpose]?.trim();
    return bucket || null;
  }

  async function requireRoot() {
    const configuredRoot = getConfiguredRoot();
    if (!configuredRoot) {
      throw new StorageError("Local filesystem storage root is not configured.", {
        code: "not_configured",
        providerId: "kavero-managed",
      });
    }

    if (!path.isAbsolute(configuredRoot)) {
      throw new StorageError("Local filesystem storage root must be an absolute path.", {
        code: "not_configured",
        providerId: "kavero-managed",
      });
    }

    const resolvedRoot = path.resolve(/* turbopackIgnore: true */ configuredRoot);
    let rootStats;
    try {
      rootStats = await stat(/* turbopackIgnore: true */ resolvedRoot);
    } catch (error) {
      throw new StorageError("Local filesystem storage root does not exist.", {
        code: "not_configured",
        providerId: "kavero-managed",
        cause: error,
      });
    }

    if (!rootStats.isDirectory()) {
      throw new StorageError("Local filesystem storage root must be a directory.", {
        code: "not_configured",
        providerId: "kavero-managed",
      });
    }

    try {
      await access(/* turbopackIgnore: true */ resolvedRoot, fsConstants.R_OK | fsConstants.W_OK);
    } catch (error) {
      throw new StorageError("Local filesystem storage root is not readable and writable.", {
        code: "not_configured",
        providerId: "kavero-managed",
        cause: error,
      });
    }

    return {
      configuredRoot,
      resolvedRoot,
      realRoot: await realpath(/* turbopackIgnore: true */ resolvedRoot),
    };
  }

  function requireBucket(purpose: StoragePurpose) {
    const bucket = getConfiguredBucket(purpose);
    if (!bucket) {
      throw new StorageError(`Local filesystem bucket is not configured for ${purpose}.`, {
        code: "not_configured",
        providerId: "kavero-managed",
      });
    }
    return bucket;
  }

  function validateRef(ref: StoredObjectRef) {
    if (
      ref.providerId !== "kavero-managed" ||
      ref.kind !== "managed" ||
      ref.metadata?.backendProviderId !== backendProviderId
    ) {
      throw new StorageError("Storage ref does not belong to the local filesystem backend.", {
        code: "provider_error",
        providerId: "kavero-managed",
      });
    }

    if (!ref.bucket) {
      throw new StorageError("Storage ref is missing a bucket.", {
        code: "provider_error",
        providerId: "kavero-managed",
      });
    }

    const objectKey = ref.path ?? ref.objectKey;
    assertSafeObjectKey(objectKey);
    return { bucket: ref.bucket, objectKey };
  }

  const backend: ManagedStorageBackend = {
    id: backendProviderId,
    kind: "managed",

    async getStatus({ purpose }) {
      try {
        await requireRoot();
        const ready = purpose ? Boolean(getConfiguredBucket(purpose)) : Object.values(bucketConfig).every((bucket) => Boolean(bucket?.trim()));
        return {
          providerId: "kavero-managed",
          kind: "managed",
          ready,
          connected: ready,
          warning: ready ? null : "One or more local filesystem bucket labels are not configured.",
        };
      } catch (error) {
        return {
          providerId: "kavero-managed",
          kind: "managed",
          ready: false,
          connected: false,
          missingRoot: true,
          warning: error instanceof Error ? error.message : "Local filesystem storage is not configured.",
        };
      }
    },

    async ensureReady({ purpose }) {
      await requireRoot();
      requireBucket(purpose);
      return {
        providerId: "kavero-managed",
        kind: "managed",
        ready: true,
        connected: true,
        warning: null,
      };
    },

    async ensureDeploymentReady() {
      const status = await backend.getStatus({ userId: "deployment" });
      if (!status.ready) {
        throw new StorageError(status.warning ?? "Local filesystem storage is not configured.", {
          code: "not_configured",
          providerId: "kavero-managed",
        });
      }
      return status;
    },

    async uploadObject(input) {
      const rootInfo = await requireRoot();
      const bucket = requireBucket(input.purpose);
      const objectKey = resolveUploadObjectKey(input);
      const targetPath = resolveObjectPath(rootInfo, objectKey);
      await ensureSafeWriteParent(rootInfo, objectKey);

      try {
        await lstat(/* turbopackIgnore: true */ targetPath);
        throw new StorageError("Local filesystem object already exists.", {
          code: "provider_error",
          providerId: "kavero-managed",
        });
      } catch (error) {
        if (!isMissingFilesystemError(error)) throw error;
      }

      const parentPath = path.dirname(targetPath);
      const tempPath = path.join(parentPath, `.${path.basename(targetPath)}.${crypto.randomUUID()}.tmp`);
      const data = await toBuffer(input.data);

      try {
        await writeFile(/* turbopackIgnore: true */ tempPath, data, { flag: "wx" });
        const tempRealPath = await realpath(/* turbopackIgnore: true */ tempPath);
        assertPathInsideRoot(rootInfo, tempRealPath);
        await link(/* turbopackIgnore: true */ tempPath, targetPath);
      } catch (error) {
        throw storageErrorFromFilesystem("Unable to upload object to local filesystem storage.", error);
      } finally {
        await unlink(/* turbopackIgnore: true */ tempPath).catch(() => undefined);
      }

      const targetStats = await stat(/* turbopackIgnore: true */ targetPath);
      const sizeBytes = targetStats.size;
      const ref: StoredObjectRef = {
        providerId: "kavero-managed",
        kind: "managed",
        purpose: input.purpose,
        objectKey,
        bucket,
        path: objectKey,
        externalId: null,
        externalUrl: null,
        metadata: {
          ...sanitizeMetadata(input.metadata),
          backendProviderId,
          name: input.name,
          contentType: input.mimeType,
          sizeBytes,
        },
        status: "available",
        version: 1,
      };

      return {
        ref,
        name: input.name,
        mimeType: input.mimeType,
        sizeBytes,
        webViewUrl: null,
      };
    },

    async readObject({ ref }) {
      const rootInfo = await requireRoot();
      const { objectKey } = validateRef(ref);
      const targetPath = resolveObjectPath(rootInfo, objectKey);
      const realTargetPath = await realpathSafe(targetPath);
      if (!realTargetPath) {
        throw new StorageError("Object is missing in local filesystem storage.", {
          code: "missing",
          providerId: "kavero-managed",
        });
      }
      assertPathInsideRoot(rootInfo, realTargetPath);

      try {
        const data = await readFile(/* turbopackIgnore: true */ realTargetPath);
        return {
          data,
          mimeType: getRefContentType(ref) ?? "application/octet-stream",
          sizeBytes: data.byteLength,
        };
      } catch (error) {
        if (isMissingFilesystemError(error)) {
          throw new StorageError("Object is missing in local filesystem storage.", {
            code: "missing",
            providerId: "kavero-managed",
            cause: error,
          });
        }
        throw storageErrorFromFilesystem("Unable to read object from local filesystem storage.", error);
      }
    },

    async getReadUrl() {
      return null;
    },

    async deleteObject({ ref }) {
      const rootInfo = await requireRoot();
      const { objectKey } = validateRef(ref);
      const targetPath = resolveObjectPath(rootInfo, objectKey);
      const realTargetPath = await realpathSafe(targetPath);
      if (!realTargetPath) return;
      assertPathInsideRoot(rootInfo, realTargetPath);

      try {
        await unlink(/* turbopackIgnore: true */ targetPath);
      } catch (error) {
        if (isMissingFilesystemError(error)) return;
        throw storageErrorFromFilesystem("Unable to delete object from local filesystem storage.", error);
      }
    },

    async markMissing({ ref }) {
      validateRef(ref);
    },

    serializeRef(ref) {
      return { ...ref };
    },

    deserializeRef(value) {
      if (!isStoredObjectRefLike(value)) {
        throw new StorageError("Invalid local filesystem object ref.", {
          code: "provider_error",
          providerId: "kavero-managed",
        });
      }

      const ref = value as StoredObjectRef;
      validateRef(ref);
      return ref;
    },
  };

  return backend;
}

function resolveUploadObjectKey(input: Pick<UploadObjectInput, "userId" | "purpose" | "name" | "metadata">) {
  const providedObjectKey = input.metadata?.objectKey;
  if (typeof providedObjectKey === "string") {
    assertSafeObjectKey(providedObjectKey);
    return providedObjectKey;
  }

  const objectKey = `users/${safePathSegment(input.userId)}/${input.purpose}/${crypto.randomUUID()}-${safeFileName(input.name)}`;
  assertSafeObjectKey(objectKey);
  return objectKey;
}

function assertSafeObjectKey(value: string) {
  if (
    !value ||
    value.trim() !== value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("//") ||
    path.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    path.posix.isAbsolute(value)
  ) {
    throw new StorageError("Local filesystem object keys must be safe relative paths.", {
      code: "provider_error",
      providerId: "kavero-managed",
    });
  }

  const segments = value.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new StorageError("Local filesystem object keys must not contain empty or dot path segments.", {
      code: "provider_error",
      providerId: "kavero-managed",
    });
  }
}

function resolveObjectPath(rootInfo: ResolvedRoot, objectKey: string) {
  assertSafeObjectKey(objectKey);
  const resolvedPath = path.resolve(/* turbopackIgnore: true */ rootInfo.realRoot, ...objectKey.split("/"));
  assertPathInsideRoot(rootInfo, resolvedPath);
  return resolvedPath;
}

async function ensureSafeWriteParent(rootInfo: ResolvedRoot, objectKey: string) {
  const segments = objectKey.split("/");
  let currentPath = rootInfo.realRoot;

  for (const segment of segments.slice(0, -1)) {
    currentPath = path.join(currentPath, segment);
    try {
      const segmentStats = await lstat(/* turbopackIgnore: true */ currentPath);
      if (segmentStats.isSymbolicLink()) {
        throw new StorageError("Local filesystem storage paths must not traverse symlink directories.", {
          code: "provider_error",
          providerId: "kavero-managed",
        });
      }
      if (!segmentStats.isDirectory()) {
        throw new StorageError("Local filesystem storage path parent is not a directory.", {
          code: "provider_error",
          providerId: "kavero-managed",
        });
      }
    } catch (error) {
      if (!isMissingFilesystemError(error)) throw error;
      try {
        await mkdir(/* turbopackIgnore: true */ currentPath);
      } catch (mkdirError) {
        if (!isExistingFilesystemError(mkdirError)) throw mkdirError;
        await assertExistingSafeDirectory(currentPath);
      }
    }
  }

  const parentRealPath = await realpath(/* turbopackIgnore: true */ path.dirname(resolveObjectPath(rootInfo, objectKey)));
  assertPathInsideRoot(rootInfo, parentRealPath);
}

async function assertExistingSafeDirectory(directoryPath: string) {
  const segmentStats = await lstat(/* turbopackIgnore: true */ directoryPath);
  if (segmentStats.isSymbolicLink()) {
    throw new StorageError("Local filesystem storage paths must not traverse symlink directories.", {
      code: "provider_error",
      providerId: "kavero-managed",
    });
  }
  if (!segmentStats.isDirectory()) {
    throw new StorageError("Local filesystem storage path parent is not a directory.", {
      code: "provider_error",
      providerId: "kavero-managed",
    });
  }
}

function assertPathInsideRoot(rootInfo: ResolvedRoot, candidatePath: string) {
  const relative = path.relative(rootInfo.realRoot, candidatePath);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;

  throw new StorageError("Local filesystem storage path escapes the configured root.", {
    code: "provider_error",
    providerId: "kavero-managed",
  });
}

async function realpathSafe(targetPath: string) {
  try {
    return await realpath(/* turbopackIgnore: true */ targetPath);
  } catch (error) {
    if (isMissingFilesystemError(error)) return null;
    throw storageErrorFromFilesystem("Unable to resolve local filesystem object path.", error);
  }
}

async function toBuffer(data: UploadObjectInput["data"]): Promise<Buffer> {
  if (typeof data === "string") return Buffer.from(data);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (data instanceof Uint8Array) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  if (data instanceof Blob) return Buffer.from(await data.arrayBuffer());
  if (data instanceof ReadableStream) {
    const reader = data.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
    }
    return Buffer.concat(chunks);
  }
  return Buffer.from([]);
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined) {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata ?? {})) {
    if (key === "objectKey") continue;
    sanitized[key] = value;
  }
  return sanitized;
}

function safePathSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "user"
  );
}

function safeFileName(value: string) {
  return (
    value
      .replace(/[/\\]+/g, "-")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "object"
  );
}

function getRefContentType(ref: StoredObjectRef) {
  const contentType = ref.metadata?.contentType;
  return typeof contentType === "string" && contentType ? contentType : null;
}

function storageErrorFromFilesystem(message: string, error: unknown) {
  return new StorageError(message, {
    code: "provider_error",
    providerId: "kavero-managed",
    cause: error,
  });
}

function isMissingFilesystemError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT");
}

function isExistingFilesystemError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "EEXIST");
}

function isStoredObjectRefLike(value: unknown): value is StoredObjectRef {
  if (!value || typeof value !== "object") return false;
  const ref = value as Partial<StoredObjectRef>;
  return (
    isStorageProviderId(ref.providerId) &&
    isStorageProviderKind(ref.kind) &&
    isStoragePurpose(ref.purpose) &&
    typeof ref.objectKey === "string" &&
    isStorageObjectStatus(ref.status) &&
    ref.version === 1
  );
}
