import type { ManagedStorageProvider } from "@/modules/storage/storage-provider";
import type { ManagedStorageBackendId, ManagedStorageConfig } from "./config";

export type ManagedStorageBackend = Omit<ManagedStorageProvider, "id"> & {
  id: ManagedStorageBackendId;
};

export type ManagedStorageBackendRegistry = Partial<
  Record<ManagedStorageBackendId, ManagedStorageBackend>
>;

export type ResolveManagedStorageBackendInput = {
  config: ManagedStorageConfig;
  registry: ManagedStorageBackendRegistry;
};

export type ResolveManagedStorageBackendResult =
  | { ok: true; backend: ManagedStorageBackend }
  | {
      ok: false;
      reason: "backend-not-registered";
      backendId: ManagedStorageBackendId;
    };

export function resolveManagedStorageBackend({
  config,
  registry,
}: ResolveManagedStorageBackendInput): ResolveManagedStorageBackendResult {
  const backend = registry[config.backendId];
  if (!backend) {
    return {
      ok: false,
      reason: "backend-not-registered",
      backendId: config.backendId,
    };
  }

  return { ok: true, backend };
}
