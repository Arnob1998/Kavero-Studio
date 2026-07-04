import { describe, expect, it } from "vitest";
import {
  StorageError,
  isStorageErrorCode,
  isStorageObjectStatus,
  isStorageProviderId,
  isStorageProviderKind,
  isStoragePurpose,
  storageProviderKindById,
} from "./storage-provider";

describe("storage provider core types", () => {
  it("recognizes known provider ids", () => {
    expect(isStorageProviderId("kavero-managed")).toBe(true);
    expect(isStorageProviderId("google-drive")).toBe(true);
    expect(isStorageProviderId("local-filesystem")).toBe(true);
    expect(isStorageProviderId("supabase-storage")).toBe(true);
    expect(isStorageProviderId("s3-compatible")).toBe(true);
    expect(isStorageProviderId("dropbox")).toBe(false);
  });

  it("recognizes known storage purposes", () => {
    expect(isStoragePurpose("generated-image")).toBe(true);
    expect(isStoragePurpose("generated-metadata")).toBe(true);
    expect(isStoragePurpose("canvas-asset")).toBe(true);
    expect(isStoragePurpose("canvas-export")).toBe(true);
    expect(isStoragePurpose("imported-file")).toBe(true);
    expect(isStoragePurpose("provider-key")).toBe(false);
  });

  it("recognizes provider kinds, object statuses, and error codes", () => {
    expect(isStorageProviderKind("managed")).toBe(true);
    expect(isStorageProviderKind("connected")).toBe(true);
    expect(isStorageProviderKind("oauth")).toBe(false);

    expect(isStorageObjectStatus("available")).toBe(true);
    expect(isStorageObjectStatus("reconnect_required")).toBe(true);
    expect(isStorageObjectStatus("deleted")).toBe(false);

    expect(isStorageErrorCode("not_connected")).toBe(true);
    expect(isStorageErrorCode("provider_error")).toBe(true);
    expect(isStorageErrorCode("drive_error")).toBe(false);
  });

  it("maps provider ids to their storage provider kind", () => {
    expect(storageProviderKindById["kavero-managed"]).toBe("managed");
    expect(storageProviderKindById["google-drive"]).toBe("connected");
    expect(storageProviderKindById["supabase-storage"]).toBe("managed");
  });

  it("stores structured StorageError fields", () => {
    const cause = new Error("provider failed");
    const error = new StorageError("Storage provider is unavailable.", {
      code: "provider_error",
      providerId: "google-drive",
      retryable: true,
      cause,
    });

    expect(error.name).toBe("StorageError");
    expect(error.message).toBe("Storage provider is unavailable.");
    expect(error.code).toBe("provider_error");
    expect(error.providerId).toBe("google-drive");
    expect(error.retryable).toBe(true);
    expect(error.cause).toBe(cause);
  });
});
