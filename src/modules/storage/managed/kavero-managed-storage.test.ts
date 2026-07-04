import { describe, expect, it } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import type { ManagedStorageBackend } from "./kavero-managed-storage";
import * as managedStorage from "./kavero-managed-storage";
import { resolveManagedStorageBackend } from "./kavero-managed-storage";

const storedRef: StoredObjectRef = {
  providerId: "kavero-managed",
  kind: "managed",
  purpose: "canvas-asset",
  objectKey: "users/user-1/canvas-assets/asset-1/image.png",
  bucket: "kavero-canvas-assets",
  path: "users/user-1/canvas-assets/asset-1/image.png",
  externalId: null,
  externalUrl: null,
  metadata: { backendProviderId: "supabase-storage" },
  status: "available",
  version: 1,
};

function backend(id: ManagedStorageBackend["id"]): ManagedStorageBackend {
  return {
    id,
    kind: "managed",
    async getStatus() {
      return { providerId: id, kind: "managed", ready: true, connected: true };
    },
    async ensureReady() {
      return { providerId: id, kind: "managed", ready: true, connected: true };
    },
    async uploadObject() {
      return {
        ref: storedRef,
        name: "image.png",
        mimeType: "image/png",
      };
    },
    async readObject() {
      return {
        data: new Uint8Array([1, 2, 3]),
        mimeType: "image/png",
      };
    },
    async deleteObject() {},
    async ensureDeploymentReady() {
      return { providerId: id, kind: "managed", ready: true, connected: true };
    },
    serializeRef(ref) {
      return ref;
    },
    deserializeRef() {
      return storedRef;
    },
  };
}

describe("kavero-managed storage resolver", () => {
  it("resolves a registered backend from the injected registry", () => {
    const registeredBackend = backend("supabase-storage");

    expect(
      resolveManagedStorageBackend({
        config: {
          providerId: "kavero-managed",
          kind: "managed",
          backendId: "supabase-storage",
        },
        registry: {
          "supabase-storage": registeredBackend,
        },
      }),
    ).toEqual({ ok: true, backend: registeredBackend });
  });

  it.each(["supabase-storage", "local-filesystem", "s3-compatible"] as const)(
    "returns backend-not-registered for unregistered %s",
    (backendId) => {
      expect(
        resolveManagedStorageBackend({
          config: {
            providerId: "kavero-managed",
            kind: "managed",
            backendId,
          },
          registry: {},
        }),
      ).toEqual({
        ok: false,
        reason: "backend-not-registered",
        backendId,
      });
    },
  );

  it("keeps backend id separate from the logical kavero-managed provider", () => {
    const registeredBackend = backend("local-filesystem");
    const result = resolveManagedStorageBackend({
      config: {
        providerId: "kavero-managed",
        kind: "managed",
        backendId: "local-filesystem",
      },
      registry: {
        "local-filesystem": registeredBackend,
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.backend.id).toBe("local-filesystem");
      expect(result.backend.kind).toBe("managed");
    }
  });

  it("does not export production fake providers", () => {
    expect(Object.keys(managedStorage).some((key) => key.toLowerCase().includes("fake"))).toBe(
      false,
    );
  });
});
