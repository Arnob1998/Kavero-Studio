import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManagedStorageBackend } from "./kavero-managed-storage";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createLocalFilesystemStorageBackend: vi.fn(),
  createSupabaseStorageBackend: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/modules/storage/backends/supabase-storage/supabase-storage-backend", () => ({
  createSupabaseStorageBackend: mocks.createSupabaseStorageBackend,
}));

vi.mock("@/modules/storage/backends/local-filesystem/local-filesystem-backend", () => ({
  createLocalFilesystemStorageBackend: mocks.createLocalFilesystemStorageBackend,
}));

import {
  getRuntimeManagedStorageDispatchDependencies,
  resolveRuntimeManagedStorageBackend,
} from "./runtime";

function backend(id: ManagedStorageBackend["id"] = "supabase-storage"): ManagedStorageBackend {
  return {
    id,
    kind: "managed",
    async getStatus() {
      return { providerId: "kavero-managed", kind: "managed", ready: true, connected: true };
    },
    async ensureReady() {
      return { providerId: "kavero-managed", kind: "managed", ready: true, connected: true };
    },
    async ensureDeploymentReady() {
      return { providerId: "kavero-managed", kind: "managed", ready: true, connected: true };
    },
    async uploadObject() {
      throw new Error("not used");
    },
    async readObject() {
      throw new Error("not used");
    },
    async deleteObject() {},
    serializeRef(ref) {
      return ref;
    },
    deserializeRef(value) {
      return value as never;
    },
  };
}

describe("runtime managed storage dependencies", () => {
  beforeEach(() => {
    mocks.createAdminClient.mockReset();
    mocks.createLocalFilesystemStorageBackend.mockReset();
    mocks.createSupabaseStorageBackend.mockReset();
  });

  it("creates Supabase Storage and local filesystem dispatch dependencies", () => {
    const admin = { storage: { from: vi.fn() } };
    const storageBackend = backend();
    const localBackend = backend("local-filesystem");
    mocks.createAdminClient.mockReturnValue(admin);
    mocks.createSupabaseStorageBackend.mockReturnValue(storageBackend);
    mocks.createLocalFilesystemStorageBackend.mockReturnValue(localBackend);

    const result = getRuntimeManagedStorageDispatchDependencies();

    expect(result).toEqual({
      ok: true,
      dependencies: {
        managedBackends: {
          "supabase-storage": storageBackend,
          "local-filesystem": localBackend,
        },
        supabaseStorageBackend: storageBackend,
      },
    });
    expect(mocks.createSupabaseStorageBackend).toHaveBeenCalledWith({ client: admin });
    expect(mocks.createLocalFilesystemStorageBackend).toHaveBeenCalledWith({ env: process.env });
  });

  it("returns not-configured when admin credentials are unavailable", () => {
    const error = new Error("Supabase admin credentials are not configured.");
    mocks.createAdminClient.mockImplementation(() => {
      throw error;
    });

    expect(getRuntimeManagedStorageDispatchDependencies()).toEqual({
      ok: false,
      reason: "not-configured",
      error,
    });
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
    expect(mocks.createLocalFilesystemStorageBackend).not.toHaveBeenCalled();
  });

  it("resolves an injected managed backend without constructing Supabase Storage", () => {
    const admin = { storage: { from: vi.fn() } };
    const storageBackend = backend();

    expect(
      resolveRuntimeManagedStorageBackend({
        admin,
        env: { KAVERO_MANAGED_STORAGE_BACKEND: "supabase-storage" },
        managedBackend: storageBackend,
      }),
    ).toEqual({
      ok: true,
      backend: storageBackend,
    });
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
    expect(mocks.createLocalFilesystemStorageBackend).not.toHaveBeenCalled();
  });

  it("fails closed for invalid managed backend config", () => {
    expect(
      resolveRuntimeManagedStorageBackend({
        admin: { storage: { from: vi.fn() } },
        env: { KAVERO_MANAGED_STORAGE_BACKEND: "not-a-backend" },
      }),
    ).toEqual({
      ok: false,
      reason: "invalid-backend",
      backendId: "not-a-backend",
    });
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
    expect(mocks.createLocalFilesystemStorageBackend).not.toHaveBeenCalled();
  });

  it("resolves a configured local filesystem backend", () => {
    const localBackend = backend("local-filesystem");
    mocks.createLocalFilesystemStorageBackend.mockReturnValue(localBackend);

    expect(
      resolveRuntimeManagedStorageBackend({
        admin: { storage: { from: vi.fn() } },
        env: { KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem" },
      }),
    ).toEqual({
      ok: true,
      backend: localBackend,
    });
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
    expect(mocks.createLocalFilesystemStorageBackend).toHaveBeenCalledWith({
      env: { KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem" },
    });
  });

  it("fails closed when a future backend is configured but not registered", () => {
    expect(
      resolveRuntimeManagedStorageBackend({
        admin: { storage: { from: vi.fn() } },
        env: { KAVERO_MANAGED_STORAGE_BACKEND: "s3-compatible" },
      }),
    ).toEqual({
      ok: false,
      reason: "backend-not-registered",
      backendId: "s3-compatible",
    });
    expect(mocks.createSupabaseStorageBackend).not.toHaveBeenCalled();
    expect(mocks.createLocalFilesystemStorageBackend).not.toHaveBeenCalled();
  });
});
