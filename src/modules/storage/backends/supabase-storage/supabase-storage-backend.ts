import type { ManagedStorageBackend } from "@/modules/storage/managed/kavero-managed-storage";
import {
  StorageError,
  isStorageObjectStatus,
  isStorageProviderKind,
  isStorageProviderId,
  isStoragePurpose,
  type StoragePurpose,
  type StoredObjectRef,
} from "@/modules/storage/storage-provider";

export type SupabaseStorageBucketConfig = Partial<Record<StoragePurpose, string>>;

export type SupabaseStorageBackendConfig = {
  client: SupabaseStorageClient;
  buckets?: SupabaseStorageBucketConfig;
};

export type SupabaseStorageClient = {
  storage: {
    from(bucket: string): SupabaseStorageBucketClient;
  };
};

export type SupabaseStorageBucketClient = {
  upload(
    path: string,
    data: unknown,
    options: { contentType: string; upsert: false },
  ): Promise<{ data: unknown | null; error: SupabaseStorageErrorLike | null }>;
  download(path: string): Promise<{ data: Blob | ArrayBuffer | Uint8Array | null; error: SupabaseStorageErrorLike | null }>;
  remove(paths: string[]): Promise<{ data: unknown | null; error: SupabaseStorageErrorLike | null }>;
};

type SupabaseStorageErrorLike = {
  message?: string;
  statusCode?: string | number;
  status?: string | number;
  name?: string;
};

export const defaultSupabaseStorageBuckets = {
  "generated-image": "kavero-generated-images",
  "generated-metadata": "kavero-generated-metadata",
  "canvas-asset": "kavero-canvas-assets",
  "canvas-export": "kavero-canvas-assets",
  "imported-file": "kavero-canvas-assets",
} as const satisfies Record<StoragePurpose, string>;

const backendProviderId = "supabase-storage";

export function createSupabaseStorageBackend({
  client,
  buckets,
}: SupabaseStorageBackendConfig): ManagedStorageBackend {
  const bucketConfig = { ...defaultSupabaseStorageBuckets, ...buckets };

  function getConfiguredBucket(purpose: StoragePurpose) {
    const bucket = bucketConfig[purpose]?.trim();
    return bucket || null;
  }

  function requireBucket(purpose: StoragePurpose) {
    const bucket = getConfiguredBucket(purpose);
    if (!bucket) {
      throw new StorageError(`Supabase Storage bucket is not configured for ${purpose}.`, {
        code: "not_configured",
        providerId: "kavero-managed",
      });
    }
    return bucket;
  }

  function validateRef(ref: StoredObjectRef) {
    const providerIsManagedBackend =
      ref.providerId === "kavero-managed" &&
      ref.kind === "managed" &&
      ref.metadata?.backendProviderId === backendProviderId;
    const providerIsHistoricalConcrete =
      ref.providerId === "supabase-storage" && ref.kind === "managed";

    if (!providerIsManagedBackend && !providerIsHistoricalConcrete) {
      throw new StorageError("Storage ref does not belong to the Supabase Storage backend.", {
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

    const path = ref.path ?? ref.objectKey;
    assertSafeObjectKey(path);

    return {
      bucket: ref.bucket,
      path,
    };
  }

  const backend: ManagedStorageBackend = {
    id: backendProviderId,
    kind: "managed",

    async getStatus({ purpose }) {
      if (purpose) {
        const bucket = getConfiguredBucket(purpose);
        return {
          providerId: "kavero-managed",
          kind: "managed",
          ready: Boolean(bucket),
          connected: Boolean(bucket),
          warning: bucket ? null : `Supabase Storage bucket is not configured for ${purpose}.`,
        };
      }

      const ready = Object.values(bucketConfig).every((bucket) => Boolean(bucket?.trim()));
      return {
        providerId: "kavero-managed",
        kind: "managed",
        ready,
        connected: ready,
        warning: ready ? null : "One or more Supabase Storage buckets are not configured.",
      };
    },

    async ensureReady({ purpose }) {
      const bucket = getConfiguredBucket(purpose);
      if (!bucket) {
        throw new StorageError(`Supabase Storage bucket is not configured for ${purpose}.`, {
          code: "not_configured",
          providerId: "kavero-managed",
        });
      }

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
        throw new StorageError(status.warning ?? "Supabase Storage is not configured.", {
          code: "not_configured",
          providerId: "kavero-managed",
        });
      }
      return status;
    },

    async uploadObject(input) {
      const bucket = requireBucket(input.purpose);
      const objectKey = resolveUploadObjectKey(input);
      const storage = client.storage.from(bucket);
      const result = await storage.upload(objectKey, input.data, {
        contentType: input.mimeType,
        upsert: false,
      });

      if (result.error) {
        throw storageErrorFromProvider(
          "Unable to upload object to Supabase Storage.",
          result.error,
          "provider_error",
        );
      }

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
          ...input.metadata,
          backendProviderId,
          name: input.name,
          contentType: input.mimeType,
        },
        status: "available",
        version: 1,
      };

      return {
        ref,
        name: input.name,
        mimeType: input.mimeType,
      };
    },

    async readObject({ ref }) {
      const { bucket, path } = validateRef(ref);
      const result = await client.storage.from(bucket).download(path);

      if (result.error || !result.data) {
        throw storageErrorFromProvider(
          "Object is missing in Supabase Storage.",
          result.error,
          isMissingError(result.error) ? "missing" : "provider_error",
        );
      }

      return {
        data: await toReadData(result.data),
        mimeType: getRefContentType(ref) ?? "application/octet-stream",
      };
    },

    async getReadUrl() {
      return null;
    },

    async deleteObject({ ref }) {
      const { bucket, path } = validateRef(ref);
      const result = await client.storage.from(bucket).remove([path]);

      if (result.error && !isMissingError(result.error)) {
        throw storageErrorFromProvider(
          "Unable to delete object from Supabase Storage.",
          result.error,
          "provider_error",
        );
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
        throw new StorageError("Invalid Supabase Storage object ref.", {
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

function resolveUploadObjectKey(input: {
  userId: string;
  purpose: StoragePurpose;
  name: string;
  metadata?: Record<string, unknown>;
}) {
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
    value.startsWith("/") ||
    value.includes("\\") ||
    value.includes("..") ||
    value.includes("//")
  ) {
    throw new StorageError("Supabase Storage object keys must be safe relative paths.", {
      code: "provider_error",
      providerId: "kavero-managed",
    });
  }
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

async function toReadData(data: Blob | ArrayBuffer | Uint8Array) {
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data;
  return data.arrayBuffer();
}

function getRefContentType(ref: StoredObjectRef) {
  const contentType = ref.metadata?.contentType;
  return typeof contentType === "string" && contentType ? contentType : null;
}

function storageErrorFromProvider(
  message: string,
  error: SupabaseStorageErrorLike | null,
  code: "missing" | "provider_error",
) {
  return new StorageError(error?.message ? `${message} ${error.message}` : message, {
    code,
    providerId: "kavero-managed",
    cause: error ?? undefined,
  });
}

function isMissingError(error: SupabaseStorageErrorLike | null) {
  if (!error) return false;
  const status = String(error.statusCode ?? error.status ?? "");
  const message = error.message?.toLowerCase() ?? "";
  const name = error.name?.toLowerCase() ?? "";
  return status === "404" || message.includes("not found") || name.includes("notfound");
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
