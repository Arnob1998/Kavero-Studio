import { describe, expect, it } from "vitest";
import {
  defaultManagedStorageBackendId,
  getManagedStorageConfigFromEnv,
  isManagedStorageBackendId,
  managedStorageBackendIds,
} from "./config";

describe("managed storage config", () => {
  it("recognizes known managed backend ids", () => {
    expect(managedStorageBackendIds).toEqual([
      "supabase-storage",
      "local-filesystem",
      "s3-compatible",
    ]);
    expect(isManagedStorageBackendId("supabase-storage")).toBe(true);
    expect(isManagedStorageBackendId("local-filesystem")).toBe(true);
    expect(isManagedStorageBackendId("s3-compatible")).toBe(true);
    expect(isManagedStorageBackendId("google-drive")).toBe(false);
    expect(isManagedStorageBackendId("kavero-managed")).toBe(false);
  });

  it("fails closed for an invalid backend id", () => {
    expect(
      getManagedStorageConfigFromEnv({
        KAVERO_MANAGED_STORAGE_BACKEND: "dropbox",
      }),
    ).toEqual({
      ok: false,
      reason: "invalid-backend",
      backendId: "dropbox",
    });
  });

  it("preserves kavero-managed as the logical provider", () => {
    expect(
      getManagedStorageConfigFromEnv({
        KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem",
      }),
    ).toEqual({
      ok: true,
      config: {
        providerId: "kavero-managed",
        kind: "managed",
        backendId: "local-filesystem",
      },
    });
  });

  it("uses only the injected env-like object", () => {
    expect(
      getManagedStorageConfigFromEnv({
        KAVERO_MANAGED_STORAGE_BACKEND: "s3-compatible",
      }),
    ).toEqual({
      ok: true,
      config: {
        providerId: "kavero-managed",
        kind: "managed",
        backendId: "s3-compatible",
      },
    });
  });

  it("defaults to supabase-storage inside the isolated helper", () => {
    expect(defaultManagedStorageBackendId).toBe("supabase-storage");
    expect(getManagedStorageConfigFromEnv({})).toEqual({
      ok: true,
      config: {
        providerId: "kavero-managed",
        kind: "managed",
        backendId: "supabase-storage",
      },
    });
  });
});
