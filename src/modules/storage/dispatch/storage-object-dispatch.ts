import {
  defaultManagedStorageBackendId,
  isManagedStorageBackendId,
  type ManagedStorageConfig,
} from "@/modules/storage/managed/config";
import {
  resolveManagedStorageBackend,
  type ManagedStorageBackend,
  type ManagedStorageBackendRegistry,
} from "@/modules/storage/managed/kavero-managed-storage";
import {
  StorageError,
  type ReadObjectResult,
  type StoredObjectRef,
  type StorageProviderId,
} from "@/modules/storage/storage-provider";

export type StorageObjectReadResult = ReadObjectResult;

export type StorageObjectReadDispatchResult =
  | { ok: true; object: StorageObjectReadResult }
  | { ok: false; reason: "unsupported-provider"; providerId: StorageProviderId }
  | { ok: false; reason: "backend-not-registered"; backendId: string }
  | { ok: false; reason: "missing"; error: StorageError }
  | { ok: false; reason: "provider-error"; error: unknown };

export type StorageObjectDeleteDispatchResult =
  | {
      ok: true;
      deleted: number;
      unsupportedRefs: StoredObjectRef[];
    }
  | {
      ok: false;
      reason: "backend-not-registered";
      backendId: string;
      deleted: number;
      unsupportedRefs: StoredObjectRef[];
    }
  | {
      ok: false;
      reason: "provider-error";
      error: unknown;
      deleted: number;
      unsupportedRefs: StoredObjectRef[];
    };

export type StorageObjectDispatchDependencies = {
  managedConfig?: ManagedStorageConfig;
  managedBackends?: ManagedStorageBackendRegistry;
  supabaseStorageBackend?: ManagedStorageBackend;
};

export async function readStorageObject(input: {
  userId: string;
  ref: StoredObjectRef;
  dependencies?: StorageObjectDispatchDependencies;
}): Promise<StorageObjectReadDispatchResult> {
  const backendResult = resolveBackendForRef(input.ref, input.dependencies);
  if (!backendResult.ok) return backendResult;

  try {
    return {
      ok: true,
      object: await backendResult.backend.readObject({
        userId: input.userId,
        ref: input.ref,
      }),
    };
  } catch (error) {
    return mapStorageError(error);
  }
}

export async function deleteStorageObjects(input: {
  userId: string;
  refs: StoredObjectRef[];
  dependencies?: StorageObjectDispatchDependencies;
}): Promise<StorageObjectDeleteDispatchResult> {
  let deleted = 0;
  const unsupportedRefs: StoredObjectRef[] = [];

  for (const ref of input.refs) {
    const backendResult = resolveBackendForRef(ref, input.dependencies);
    if (!backendResult.ok) {
      if (backendResult.reason === "unsupported-provider") {
        unsupportedRefs.push(ref);
        continue;
      }

      return {
        ok: false,
        reason: "backend-not-registered",
        backendId: backendResult.backendId,
        deleted,
        unsupportedRefs,
      };
    }

    try {
      await backendResult.backend.deleteObject({ userId: input.userId, ref });
      deleted += 1;
    } catch (error) {
      return {
        ok: false,
        reason: "provider-error",
        error,
        deleted,
        unsupportedRefs,
      };
    }
  }

  return {
    ok: true,
    deleted,
    unsupportedRefs,
  };
}

function resolveBackendForRef(
  ref: StoredObjectRef,
  dependencies: StorageObjectDispatchDependencies = {},
):
  | { ok: true; backend: ManagedStorageBackend }
  | { ok: false; reason: "unsupported-provider"; providerId: StorageProviderId }
  | { ok: false; reason: "backend-not-registered"; backendId: string } {
  if (ref.providerId === "google-drive") {
    return { ok: false, reason: "unsupported-provider", providerId: ref.providerId };
  }

  if (ref.providerId === "supabase-storage") {
    const backend = dependencies.supabaseStorageBackend ?? dependencies.managedBackends?.["supabase-storage"];
    if (!backend) {
      return { ok: false, reason: "backend-not-registered", backendId: "supabase-storage" };
    }
    return { ok: true, backend };
  }

  if (ref.providerId !== "kavero-managed") {
    return { ok: false, reason: "unsupported-provider", providerId: ref.providerId };
  }

  const metadataBackendId = ref.metadata?.backendProviderId;
  const backendId =
    typeof metadataBackendId === "string" && isManagedStorageBackendId(metadataBackendId)
      ? metadataBackendId
      : defaultManagedStorageBackendId;
  const config = {
    ...dependencies.managedConfig,
    providerId: "kavero-managed",
    kind: "managed",
    backendId,
  } satisfies ManagedStorageConfig;
  const registry = dependencies.managedBackends ?? {};
  const resolved = resolveManagedStorageBackend({ config, registry });

  if (!resolved.ok) {
    return {
      ok: false,
      reason: "backend-not-registered",
      backendId: resolved.backendId,
    };
  }

  return resolved;
}

function mapStorageError(error: unknown): StorageObjectReadDispatchResult {
  if (error instanceof StorageError && error.code === "missing") {
    return { ok: false, reason: "missing", error };
  }

  return {
    ok: false,
    reason: "provider-error",
    error,
  };
}
