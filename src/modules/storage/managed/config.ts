export const managedStorageBackendIds = [
  "supabase-storage",
  "local-filesystem",
  "s3-compatible",
] as const;

export type ManagedStorageBackendId = (typeof managedStorageBackendIds)[number];

export type ManagedStorageProviderId = "kavero-managed";

export type ManagedStorageConfig = {
  providerId: ManagedStorageProviderId;
  kind: "managed";
  backendId: ManagedStorageBackendId;
};

export type ManagedStorageEnv = {
  KAVERO_MANAGED_STORAGE_BACKEND?: string | undefined;
  KAVERO_LOCAL_STORAGE_ROOT?: string | undefined;
};

export type ManagedStorageConfigResult =
  | { ok: true; config: ManagedStorageConfig }
  | { ok: false; reason: "invalid-backend"; backendId: string };

export const defaultManagedStorageBackendId: ManagedStorageBackendId = "supabase-storage";

export function isManagedStorageBackendId(value: unknown): value is ManagedStorageBackendId {
  return (
    typeof value === "string" &&
    managedStorageBackendIds.includes(value as ManagedStorageBackendId)
  );
}

export function getManagedStorageConfigFromEnv(
  env: ManagedStorageEnv,
): ManagedStorageConfigResult {
  const rawBackendId = env.KAVERO_MANAGED_STORAGE_BACKEND?.trim();
  const backendId = rawBackendId || defaultManagedStorageBackendId;

  if (!isManagedStorageBackendId(backendId)) {
    return {
      ok: false,
      reason: "invalid-backend",
      backendId,
    };
  }

  return {
    ok: true,
    config: {
      providerId: "kavero-managed",
      kind: "managed",
      backendId,
    },
  };
}
