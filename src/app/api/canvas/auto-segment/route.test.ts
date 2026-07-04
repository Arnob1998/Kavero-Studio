import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

const mocks = vi.hoisted(() => ({
  getCanvasUser: vi.fn(),
  requireCanvasAccess: vi.fn(),
  requireCanvasAdmin: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  getGoogleDriveAccessTokenForUser: vi.fn(),
  markGoogleDriveReconnectRequired: vi.fn(),
  getRuntimeManagedStorageDispatchDependencies: vi.fn(),
  readStorageObject: vi.fn(),
  generateContent: vi.fn(),
}));

vi.mock("@/lib/canvas/api", () => ({
  getCanvasUser: mocks.getCanvasUser,
  requireCanvasAccess: mocks.requireCanvasAccess,
  requireCanvasAdmin: mocks.requireCanvasAdmin,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
}));

vi.mock("@/lib/provider-keys", () => ({
  getUserProviderApiKey: mocks.getUserProviderApiKey,
}));

vi.mock("@/lib/google-drive", () => ({
  getGoogleDriveAccessTokenForUser: mocks.getGoogleDriveAccessTokenForUser,
  markGoogleDriveReconnectRequired: mocks.markGoogleDriveReconnectRequired,
}));

vi.mock("@/modules/storage/managed/runtime", () => ({
  getRuntimeManagedStorageDispatchDependencies: mocks.getRuntimeManagedStorageDispatchDependencies,
}));

vi.mock("@/modules/storage/dispatch/storage-object-dispatch", () => ({
  readStorageObject: mocks.readStorageObject,
}));

vi.mock("@google/genai", () => ({
  ThinkingLevel: { HIGH: "HIGH", MINIMAL: "MINIMAL" },
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: mocks.generateContent } };
  }),
}));

import { POST } from "./route";

function adminForAsset(asset: Record<string, unknown> | null) {
  const select = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn(async () => ({ data: asset, error: null }));

  return {
    from: vi.fn(() => ({ select, eq, maybeSingle })),
    __mocks: { select, eq, maybeSingle },
  };
}

function googleDriveRef(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "canvas-asset",
    objectKey: "ref-drive-file",
    bucket: "google-drive",
    path: "ref-drive-file",
    externalId: "ref-drive-file",
    externalUrl: "https://drive.example/ref-drive-file",
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: "asset-1",
    original_name: "photo.png",
    content_type: "image/png",
    drive_file_id: "drive-1",
    drive_status: "available",
    storage_ref: null,
    ...overrides,
  };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/canvas/auto-segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("canvas auto segment API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCanvasUser.mockResolvedValue({ id: "user-1" });
    mocks.requireCanvasAccess.mockResolvedValue({ response: null });
    mocks.getUserProviderApiKey.mockResolvedValue("gemini-key");
    mocks.getGoogleDriveAccessTokenForUser.mockResolvedValue("drive-token");
    mocks.getRuntimeManagedStorageDispatchDependencies.mockReturnValue({
      ok: true,
      dependencies: { managedBackends: { "local-filesystem": {} } },
    });
    mocks.readStorageObject.mockResolvedValue({
      ok: true,
      object: {
        data: new TextEncoder().encode("managed-source"),
        mimeType: "image/png",
      },
    });
    mocks.requireCanvasAdmin.mockReturnValue({
      admin: adminForAsset(asset()),
      response: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("source", { headers: { "Content-Type": "image/png" } })));
    mocks.generateContent
      .mockResolvedValueOnce({
        text: JSON.stringify({
          segments: [
            {
              id: "product",
              label: "Main product",
              category: "products",
              elementType: "product object",
              location: "center",
              visualIdentity: "central green product object",
              nearbyAnchors: ["below heading"],
              bounds: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
              description: "the central item",
              exclude: ["heading", "background"],
              isolationPrompt: "Keep only the central product object. Remove the heading and background. Put it on white or black.",
              confidence: 0.92,
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }],
      });
  });

  it("rejects unauthenticated users", async () => {
    mocks.getCanvasUser.mockResolvedValueOnce(null);

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Unauthorized" });
  });

  it("rejects missing or unowned source assets", async () => {
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin: adminForAsset(null), response: null });

    const response = await POST(request({ assetId: "missing" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: "Source image was not found." });
  });

  it("rejects unsupported source asset types", async () => {
    mocks.requireCanvasAdmin.mockReturnValueOnce({
      admin: adminForAsset({
        id: "asset-1",
        original_name: "clip.gif",
        content_type: "image/gif",
        drive_file_id: "drive-1",
        drive_status: "available",
      }),
      response: null,
    });

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "Auto Segment supports PNG, JPG, or WebP source images." });
  });

  it("returns grouped segment candidates from the model plan", async () => {
    const admin = adminForAsset(asset({ storage_ref: googleDriveRef() }));
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });

    const response = await POST(request({ assetId: "asset-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(admin.__mocks.select).toHaveBeenCalledWith(
      "id, original_name, content_type, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/ref-drive-file?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
    expect(body.categories[0]).toMatchObject({
      key: "products",
      label: "Products",
      segments: [
        {
          id: "product",
          label: "Main product",
          category: "products",
          status: "ready",
          image: { dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png" },
        },
      ],
    });
  });

  it("keeps successful segments when another isolation fails", async () => {
    mocks.generateContent
      .mockReset()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          segments: [
            {
              id: "product",
              label: "Main product",
              category: "products",
              location: "center",
              visualIdentity: "central product object",
              bounds: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
              description: "the central item",
              isolationPrompt: "Keep only the central product object. Remove everything else. Put it on white or black.",
            },
            {
              id: "logo",
              label: "Logo text",
              category: "text_graphics",
              location: "upper right",
              visualIdentity: "upper-right logo text",
              bounds: { x: 0.7, y: 0.05, width: 0.2, height: 0.1 },
              description: "the logo",
              isolationPrompt: "Keep only the upper-right logo text. Remove everything else. Put it on white or black.",
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }],
      })
      .mockRejectedValueOnce(new Error("model failed"));

    const response = await POST(request({ assetId: "asset-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.categories.flatMap((category: any) => category.segments).map((segment: any) => segment.status)).toEqual(["ready", "failed"]);
    expect(body.warnings[0]).toContain("Unable to isolate");
  });

  it("uses legacy Drive fallback when storage_ref is missing", async () => {
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin: adminForAsset(asset({ storage_ref: null })), response: null });

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/drive-1?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
  });

  it("falls back to legacy Drive fields when storage_ref is malformed", async () => {
    mocks.requireCanvasAdmin.mockReturnValueOnce({
      admin: adminForAsset(asset({ storage_ref: { providerId: "google-drive" } })),
      response: null,
    });

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      "https://www.googleapis.com/drive/v3/files/drive-1?alt=media",
      { headers: { Authorization: "Bearer drive-token" } },
    );
  });

  it("rejects unsupported provider source refs before Drive or Gemini calls", async () => {
    mocks.requireCanvasAdmin.mockReturnValueOnce({
      admin: adminForAsset(
        asset({
          drive_file_id: "drive-1",
          storage_ref: googleDriveRef({
            providerId: "s3-compatible",
            kind: "managed",
            objectKey: "asset-1.png",
            externalId: null,
          }),
        }),
      ),
      response: null,
    });

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "Storage provider is not supported for Auto Segment source reads yet.",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("reads kavero-managed source bytes through storage dispatch without Google Drive", async () => {
    const managedRef: StoredObjectRef = {
      providerId: "kavero-managed",
      kind: "managed",
      purpose: "canvas-asset",
      objectKey: "users/user-1/canvas-assets/asset.png",
      bucket: "kavero-canvas-assets",
      path: "users/user-1/canvas-assets/asset.png",
      externalId: null,
      externalUrl: null,
      metadata: { backendProviderId: "local-filesystem", contentType: "image/png" },
      status: "available",
      version: 1,
    };
    mocks.requireCanvasAdmin.mockReturnValueOnce({
      admin: adminForAsset(asset({ drive_file_id: null, storage_ref: managedRef })),
      response: null,
    });

    const response = await POST(request({ assetId: "asset-1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getGoogleDriveAccessTokenForUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.getRuntimeManagedStorageDispatchDependencies).toHaveBeenCalled();
    expect(mocks.readStorageObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: managedRef,
      dependencies: expect.any(Object),
    });
    expect(mocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        contents: expect.arrayContaining([
          expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                inlineData: { mimeType: "image/png", data: Buffer.from("managed-source").toString("base64") },
              }),
            ]),
          }),
        ]),
      }),
    );
    expect(body.categories[0].segments[0]).toMatchObject({ status: "ready" });
  });

  it("returns 404 when a managed source object is missing", async () => {
    mocks.requireCanvasAdmin.mockReturnValueOnce({
      admin: adminForAsset(
        asset({
          drive_file_id: null,
          storage_ref: googleDriveRef({
            providerId: "kavero-managed",
            kind: "managed",
            externalId: null,
            metadata: { backendProviderId: "local-filesystem" },
          }),
        }),
      ),
      response: null,
    });
    mocks.readStorageObject.mockResolvedValueOnce({
      ok: false,
      reason: "missing",
      error: new Error("missing"),
    });

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Source image is missing in storage." });
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("preserves missing source behavior for missing storage refs", async () => {
    mocks.requireCanvasAdmin.mockReturnValueOnce({
      admin: adminForAsset(asset({ storage_ref: googleDriveRef({ status: "missing" }) })),
      response: null,
    });

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Source image is missing in Google Drive." });
    expect(fetch).not.toHaveBeenCalled();
  });
});
