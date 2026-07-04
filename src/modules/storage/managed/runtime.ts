import { createAdminClient } from "@/lib/supabase/admin";
import { createLocalFilesystemStorageBackend } from "@/modules/storage/backends/local-filesystem/local-filesystem-backend";
import {
  createSupabaseStorageBackend,
  type SupabaseStorageClient,
} from "@/modules/storage/backends/supabase-storage/supabase-storage-backend";
import type { StorageObjectDispatchDependencies } from "@/modules/storage/dispatch/storage-object-dispatch";
import {
  getManagedStorageConfigFromEnv,
  type ManagedStorageBackendId,
  type ManagedStorageEnv,
} from "@/modules/storage/managed/config";
import {
  resolveManagedStorageBackend,
  type ManagedStorageBackend,
} from "@/modules/storage/managed/kavero-managed-storage";

export type RuntimeManagedStorageDispatchDependenciesResult =
  | { ok: true; dependencies: StorageObjectDispatchDependencies }
  | { ok: false; reason: "not-configured"; error: unknown };

export type ResolveRuntimeManagedStorageBackendInput = {
  admin: unknown;
  env?: ManagedStorageEnv;
  managedBackend?: ManagedStorageBackend;
};

export type ResolveRuntimeManagedStorageBackendResult =
  | { ok: true; backend: ManagedStorageBackend }
  | { ok: false; reason: "invalid-backend"; backendId: string }
  | { ok: false; reason: "backend-not-registered"; backendId: string }
  | { ok: false; reason: "not-configured"; error: unknown };

export function resolveRuntimeManagedStorageBackend({
  admin,
  env,
  managedBackend,
}: ResolveRuntimeManagedStorageBackendInput): ResolveRuntimeManagedStorageBackendResult {
  const configResult = getManagedStorageConfigFromEnv((env ?? process.env) as ManagedStorageEnv);
  if (!configResult.ok) {
    return {
      ok: false,
      reason: "invalid-backend",
      backendId: configResult.backendId,
    };
  }

  try {
    const backend = managedBackend ?? createRuntimeManagedStorageBackend(configResult.config.backendId, {
      admin,
      env: (env ?? process.env) as ManagedStorageEnv,
    });

    if (!backend) {
      return {
        ok: false,
        reason: "backend-not-registered",
        backendId: configResult.config.backendId,
      };
    }

    const resolved = resolveManagedStorageBackend({
      config: configResult.config,
      registry: { [backend.id]: backend },
    });

    if (!resolved.ok) {
      return {
        ok: false,
        reason: "backend-not-registered",
        backendId: resolved.backendId,
      };
    }

    return {
      ok: true,
      backend: resolved.backend,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "not-configured",
      error,
    };
  }
}

export function getRuntimeManagedStorageDispatchDependencies(): RuntimeManagedStorageDispatchDependenciesResult {
  try {
    const admin = createAdminClient();
    const supabaseStorageBackend = createSupabaseStorageBackend({ client: admin as SupabaseStorageClient });
    const localFilesystemBackend = createLocalFilesystemStorageBackend({
      env: process.env as ManagedStorageEnv,
    });

    return {
      ok: true,
      dependencies: {
        managedBackends: {
          "supabase-storage": supabaseStorageBackend,
          "local-filesystem": localFilesystemBackend,
        },
        supabaseStorageBackend,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "not-configured",
      error,
    };
  }
}

function createRuntimeManagedStorageBackend(
  backendId: ManagedStorageBackendId,
  input: { admin: unknown; env: ManagedStorageEnv },
): ManagedStorageBackend | null {
  if (backendId === "supabase-storage") {
    return createSupabaseStorageBackend({ client: input.admin as SupabaseStorageClient });
  }

  if (backendId === "local-filesystem") {
    return createLocalFilesystemStorageBackend({ env: input.env });
  }

  return null;
}
