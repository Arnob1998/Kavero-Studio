import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
} from "@/modules/model-providers";

const mocks = vi.hoisted(() => ({
  getCanvasUser: vi.fn(),
  requireCanvasAccess: vi.fn(),
  requireCanvasAdmin: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  getUserProviderCredentials: vi.fn(),
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
  getUserProviderCredentials: mocks.getUserProviderCredentials,
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

function adminForAsset(asset: Record<string, unknown> | null, preferences: unknown = {}) {
  const select = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  const maybeSingle = vi.fn(async () => ({ data: asset, error: null }));

  return {
    from: vi.fn((table: string) => ({
      select,
      eq,
      maybeSingle: table === "user_metadata"
        ? vi.fn(async () => ({ data: { preferences }, error: null }))
        : maybeSingle,
    })),
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
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mocks.getCanvasUser.mockResolvedValue({ id: "user-1" });
    mocks.requireCanvasAccess.mockResolvedValue({ response: null });
    mocks.getUserProviderApiKey.mockResolvedValue("gemini-key");
    mocks.getUserProviderCredentials.mockResolvedValue(null);
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
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
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

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
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
    expect(mocks.getUserProviderCredentials).not.toHaveBeenCalled();
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

  it("uses the selected chat alias for gateway planning and image alias for isolation", async () => {
    configureGateway();
    mocks.getUserProviderCredentials.mockImplementation(async (_userId, providerId) =>
      providerId === "openai" ? { apiKey: "sk-user-openai-1234567890" } : null,
    );
    const admin = adminForAsset(
      asset({ storage_ref: googleDriveRef() }),
      {
        modelProviders: {
          chatOrchestrationModelAlias: "kavero-chat-openai-gpt-5-6",
          imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
        },
      },
    );
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });
    mocks.generateContent.mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("source", { headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(litellmResponse(segmentPlanPayload()))
      .mockResolvedValueOnce(litellmImageResponse("MASK"));

    const response = await POST(request({ assetId: "asset-1" }));
    const body = await response.json();
    const planningBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body));
    const isolationBody = JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]!.body));

    expect(response.status).toBe(200);
    expect(planningBody).toMatchObject({
      model: "kavero-chat-openai-gpt-5-6",
      response_format: { type: "json_object" },
      api_key: "sk-user-openai-1234567890",
    });
    expect(JSON.stringify(planningBody.messages)).toContain("data:image/png;base64");
    expect(isolationBody).toMatchObject({
      model: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      modalities: ["image", "text"],
    });
    expect(isolationBody).not.toHaveProperty("api_key");
    expect(JSON.stringify(isolationBody.messages)).toContain("auto-segment-isolation");
    expect(JSON.stringify(isolationBody.messages)).toContain("White target mask on black background only.");
    expect(JSON.stringify(isolationBody.messages)).toContain("data:image/png;base64");
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    const isolationEvent = consoleInfoSpy.mock.calls
      .map((call: unknown[]) => JSON.parse(String(call[0])) as { feature?: string; credentialSource?: string })
      .find((event: { feature?: string }) => event.feature === "auto-segment-isolation");
    expect(isolationEvent?.credentialSource).toBe("gateway-env");
    expect(body.categories[0].segments[0]).toMatchObject({
      status: "ready",
      image: { dataUrl: "data:image/png;base64,MASK" },
    });
  });

  it("injects trusted image credentials into isolation and strips reserved caller fields", async () => {
    configureGateway();
    mocks.getUserProviderCredentials.mockResolvedValue({ apiKey: "image-user-key-0123456789" });
    mocks.generateContent.mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("source", { headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(litellmResponse(segmentPlanPayload()))
      .mockResolvedValueOnce(litellmImageResponse("MASK"));

    const response = await POST(request({
      assetId: "asset-1",
      api_key: "browser-key",
      api_base: "https://browser.invalid",
      base_url: "https://browser.invalid",
      api_version: "browser-version",
      user_config: { api_key: "nested-browser-key" },
    }));
    const isolationBody = JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]!.body));

    expect(response.status).toBe(200);
    expect(isolationBody.api_key).toBe("image-user-key-0123456789");
    expect(isolationBody).not.toHaveProperty("api_base");
    expect(isolationBody).not.toHaveProperty("base_url");
    expect(isolationBody).not.toHaveProperty("api_version");
    expect(isolationBody).not.toHaveProperty("user_config");
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).toContain('\\"feature\\":\\"auto-segment-isolation\\"');
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).toContain('\\"credentialSource\\":\\"user-byok\\"');
  });

  it("uses Azure only for Auto Segment planning and preserves image isolation", async () => {
    configureGateway();
    mocks.getUserProviderCredentials.mockImplementation(async (_userId, providerId) =>
      providerId === "azure-openai"
        ? {
            apiKey: "azure-key-012345678901234567890",
            apiBase: "https://kavero.openai.azure.com",
            apiVersion: "2025-04-01-preview",
            deploymentName: "segment-private-deployment",
            baseModel: "gpt-4o",
          }
        : null,
    );
    const admin = adminForAsset(asset({ storage_ref: googleDriveRef() }), {
      modelProviders: {
        chatOrchestrationModelAlias: "kavero-chat-azure-openai",
        imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      },
    });
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });
    mocks.generateContent.mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("source", { headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(litellmResponse(segmentPlanPayload()))
      .mockResolvedValueOnce(litellmImageResponse("MASK"));

    const response = await POST(request({ assetId: "asset-1" }));
    const planning = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body));
    const isolation = JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]!.body));

    expect(response.status).toBe(200);
    expect(planning).toMatchObject({
      model: "kavero-chat-azure-openai",
      user_config: { model_list: [{ litellm_params: { model: "azure/segment-private-deployment" } }] },
    });
    expect(isolation.model).toBe(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS);
    expect(isolation).not.toHaveProperty("user_config");
  });

  it("rejects missing image credentials in user-required mode before planning or isolation", async () => {
    configureGateway();
    vi.stubEnv("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE", "user-required");
    const admin = adminForAsset(asset({ storage_ref: googleDriveRef() }));
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });
    mocks.generateContent.mockReset();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("source", { headers: { "Content-Type": "image/png" } }),
    );

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      details: { code: "provider-credentials-required" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("fails safely before planning when the image credential store is unavailable", async () => {
    configureGateway();
    mocks.getUserProviderCredentials.mockRejectedValueOnce(new Error("vault secret payload"));
    mocks.generateContent.mockReset();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("source", { headers: { "Content-Type": "image/png" } }),
    );

    const response = await POST(request({ assetId: "asset-1" }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ details: { code: "provider-credentials-unavailable" } });
    expect(JSON.stringify(body)).not.toContain("vault secret payload");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("uses gateway-env planning and ignores saved keys in env-only mode", async () => {
    configureGateway();
    vi.stubEnv("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE", "env-only");
    const admin = adminForAsset(asset({ storage_ref: googleDriveRef() }));
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });
    mocks.generateContent.mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("source", { headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(litellmResponse(segmentPlanPayload()))
      .mockResolvedValueOnce(litellmImageResponse("MASK"));

    const response = await POST(request({ assetId: "asset-1" }));
    const planningBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body));
    const isolationBody = JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]!.body));

    expect(response.status).toBe(200);
    expect(planningBody).not.toHaveProperty("api_key");
    expect(isolationBody).not.toHaveProperty("api_key");
    expect(mocks.getUserProviderCredentials).not.toHaveBeenCalled();
  });

  it("falls back to the default chat alias when gateway planning stores a wrong-slot alias", async () => {
    configureGateway();
    const admin = adminForAsset(
      asset({ storage_ref: googleDriveRef() }),
      {
        modelProviders: { chatOrchestrationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS },
      },
    );
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });
    mocks.generateContent.mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("source", { headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(litellmResponse(segmentPlanPayload()))
      .mockResolvedValueOnce(litellmImageResponse("MASK"));

    const response = await POST(request({ assetId: "asset-1" }));
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]!.body));

    expect(response.status).toBe(200);
    expect(outboundBody.model).toBe(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS);
  });

  it.each([
    ["missing", {}],
    ["unknown", { modelProviders: { imageGenerationModelAlias: "unknown-image-alias" } }],
    ["wrong-slot", { modelProviders: { imageGenerationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS } }],
  ])("falls back to the default image alias when the stored image preference is %s", async (_label, preferences) => {
    configureGateway();
    const admin = adminForAsset(asset({ storage_ref: googleDriveRef() }), preferences);
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });
    mocks.generateContent.mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("source", { headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(litellmResponse(segmentPlanPayload()))
      .mockResolvedValueOnce(litellmImageResponse("MASK"));

    const response = await POST(request({ assetId: "asset-1" }));
    const isolationBody = JSON.parse(String(vi.mocked(fetch).mock.calls[2]![1]!.body));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(isolationBody.model).toBe(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS);
    expect(body.categories[0].segments[0]).toMatchObject({
      status: "ready",
      image: { dataUrl: "data:image/png;base64,MASK" },
    });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("rejects GPT Image 2 as Auto Segment incompatible before upstream traffic", async () => {
    configureGateway();
    const admin = adminForAsset(asset({ storage_ref: googleDriveRef() }), {
      modelProviders: { imageGenerationModelAlias: "kavero-image-openai-gpt-image-2" },
    });
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "GPT Image 2 is not compatible with Auto Segment.",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("rejects Azure GPT Image 2 before reading source bytes or contacting providers", async () => {
    configureGateway();
    const admin = adminForAsset(asset({ storage_ref: googleDriveRef() }), {
      modelProviders: { imageGenerationModelAlias: "kavero-image-azure-gpt-image-2" },
    });
    mocks.requireCanvasAdmin.mockReturnValueOnce({ admin, response: null });

    const response = await POST(request({ assetId: "asset-1" }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Azure GPT Image 2 is not compatible with Auto Segment.",
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.getUserProviderCredentials).not.toHaveBeenCalled();
  });

  it("returns a safe gateway configuration error without model fallback", async () => {
    vi.stubEnv("KAVERO_MODEL_GATEWAY", "litellm");
    vi.stubEnv("KAVERO_LITELLM_API_KEY", "sk-secret");
    vi.stubEnv("KAVERO_LITELLM_ROUTING_SECRET", "routingSecret_0123456789012345678901234567890123456789");

    const response = await POST(request({ assetId: "asset-1" }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "Auto Segment model gateway is not configured correctly.",
      details: { code: "model-gateway-configuration" },
    });
    expect(JSON.stringify(body)).not.toContain("KAVERO_LITELLM");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
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

  it("keeps successful gateway segments when another gateway isolation fails with safe warnings", async () => {
    configureGateway();
    mocks.generateContent.mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("source", { headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(litellmResponse(twoSegmentPlanPayload()))
      .mockResolvedValueOnce(litellmImageResponse("READY"))
      .mockRejectedValueOnce(new Error("raw provider failure with SECRETPAYLOAD"));

    const response = await POST(request({ assetId: "asset-1" }));
    const body = await response.json();
    const segments = body.categories.flatMap((category: any) => category.segments);
    const serializedLogsAndBody = JSON.stringify([consoleErrorSpy.mock.calls, body]);

    expect(response.status).toBe(200);
    expect(segments.map((segment: any) => segment.status)).toEqual(["ready", "failed"]);
    expect(segments[0]).toMatchObject({
      label: "Main product",
      image: { dataUrl: "data:image/png;base64,READY" },
    });
    expect(segments[1]).toMatchObject({
      label: "Logo text",
      error: "Isolation failed.",
    });
    expect(body.warnings).toEqual(["Unable to isolate Logo text."]);
    expect(serializedLogsAndBody).not.toContain("raw provider failure");
    expect(serializedLogsAndBody).not.toContain("SECRETPAYLOAD");
    expect(serializedLogsAndBody).not.toContain("sk-secret");
    expect(serializedLogsAndBody).not.toContain("litellm:4000");
  });

  it("turns invalid gateway image responses into safe failed segments", async () => {
    configureGateway();
    mocks.generateContent.mockReset();
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("source", { headers: { "Content-Type": "image/png" } }))
      .mockResolvedValueOnce(litellmResponse(segmentPlanPayload()))
      .mockResolvedValueOnce(litellmImageResponseWithoutImages());

    const response = await POST(request({ assetId: "asset-1" }));
    const body = await response.json();
    const segment = body.categories[0].segments[0];
    const serializedLogsAndBody = JSON.stringify([consoleErrorSpy.mock.calls, body]);

    expect(response.status).toBe(200);
    expect(segment).toMatchObject({
      label: "Main product",
      status: "failed",
      error: "Isolation failed.",
    });
    expect(body.warnings).toEqual(["Unable to isolate Main product."]);
    expect(serializedLogsAndBody).not.toContain("No image");
    expect(serializedLogsAndBody).not.toContain("sk-secret");
    expect(serializedLogsAndBody).not.toContain("litellm:4000");
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

function configureGateway() {
  vi.stubEnv("KAVERO_MODEL_GATEWAY", "litellm");
  vi.stubEnv("KAVERO_LITELLM_BASE_URL", "http://litellm:4000");
  vi.stubEnv("KAVERO_LITELLM_API_KEY", "sk-secret");
  vi.stubEnv("KAVERO_LITELLM_ROUTING_SECRET", "routingSecret_0123456789012345678901234567890123456789");
  vi.stubEnv("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE", "env-or-user");
}

function litellmResponse(payload: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(payload) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-1",
        "x-litellm-call-id": "call-1",
      },
    },
  );
}

function litellmImageResponse(data: string) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: "Mask image",
            images: [{ image_url: { url: `data:image/png;base64,${data}` } }],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-image-1",
        "x-litellm-call-id": "call-image-1",
      },
    },
  );
}

function litellmImageResponseWithoutImages() {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "No image", images: [] } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": "req-image-empty",
        "x-litellm-call-id": "call-image-empty",
      },
    },
  );
}

function segmentPlanPayload() {
  return {
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
  };
}

function twoSegmentPlanPayload() {
  return {
    segments: [
      ...segmentPlanPayload().segments,
      {
        id: "logo",
        label: "Logo text",
        category: "text_graphics",
        elementType: "logo",
        location: "upper right",
        visualIdentity: "upper-right logo text",
        nearbyAnchors: ["above heading"],
        bounds: { x: 0.7, y: 0.05, width: 0.2, height: 0.1 },
        description: "the logo",
        exclude: ["heading", "background"],
        isolationPrompt: "Keep only the upper-right logo text. Remove everything else. Put it on white or black.",
        confidence: 0.9,
      },
    ],
  };
}
