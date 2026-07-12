import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  getUserProviderCredentials: vi.fn(),
  getGoogleDriveAccessTokenForUser: vi.fn(),
  markGoogleDriveReconnectRequired: vi.fn(),
  getRuntimeManagedStorageDispatchDependencies: vi.fn(),
  readStorageObject: vi.fn(),
  generateContent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
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
  FunctionCallingConfigMode: { AUTO: "AUTO" },
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: mocks.generateContent } };
  }),
  ThinkingLevel: { HIGH: "HIGH", MINIMAL: "MINIMAL" },
}));

import { POST as assistantPost } from "./assistant/route";
import { POST as autoSegmentPost } from "./auto-segment/route";
import { POST as imageGeneratePost } from "./image-generate/route";
import { POST as imageJudgePost } from "./image-judge/route";

type Plan = "free" | "premium";
type DriveStatus = "active" | "reconnect_required" | null;

const user = { id: "user-1" };

describe("canvas AI Local-first access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();

    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
      },
    });
    mocks.createAdminClient.mockReturnValue(createCanvasAiAdmin({ plan: "free", driveStatus: null }));
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
    vi.stubGlobal("fetch", vi.fn(async () => new Response("drive-source", { headers: { "Content-Type": "image/png" } })));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("allows Local-first free users without Google Drive through Copilot", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    vi.stubEnv("CANVAS_ASSISTANT_PROVIDER", "mock");

    const response = await assistantPost(assistantRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      provider: "mock",
      context: { selectedObjectIds: ["obj-1"] },
    });
  });

  it("allows Local-first free users without Google Drive through canvas image generation", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mocks.generateContent.mockResolvedValue(okImageResponse("canvas-image"));

    const response = await imageGeneratePost(imageGenerateRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.images).toHaveLength(4);
    expect(mocks.generateContent).toHaveBeenCalledTimes(4);
    expect(mocks.getUserProviderApiKey).toHaveBeenCalledWith("user-1", "google-gemini");
  });

  it("allows Local-first free users without Google Drive through image judge", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mocks.generateContent.mockResolvedValue({ text: JSON.stringify({ winnerId: "candidate-1", reason: "best fit" }) });

    const response = await imageJudgePost(imageJudgeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ winnerId: "candidate-1" });
    expect(mocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.1-pro-preview",
      }),
    );
  });

  it("allows Local-first Auto Segment to read managed source bytes without Google Drive", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mocks.createAdminClient.mockReturnValue(
      createCanvasAiAdmin({
        plan: "free",
        driveStatus: null,
        assetRow: managedAssetRow(),
      }),
    );
    mockAutoSegmentModelResponses();

    const response = await autoSegmentPost(autoSegmentRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.categories[0].segments[0]).toMatchObject({ status: "ready" });
    expect(mocks.getGoogleDriveAccessTokenForUser).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.readStorageObject).toHaveBeenCalledWith({
      userId: "user-1",
      ref: managedStorageRef(),
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
  });

  it("keeps Cloud/default free users blocked by the premium canvas gate before model work", async () => {
    mocks.createAdminClient.mockReturnValue(createCanvasAiAdmin({ plan: "free", driveStatus: "active" }));

    const response = await imageGeneratePost(imageGenerateRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Canvas is available on the premium plan.",
    });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("keeps Cloud/default premium users without Drive blocked before model work", async () => {
    mocks.createAdminClient.mockReturnValue(createCanvasAiAdmin({ plan: "premium", driveStatus: null }));

    const response = await imageJudgePost(imageJudgeRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Connect Google Drive to use Canvas.",
    });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("defaults invalid deployment profiles to Cloud and does not infer Local-first from storage envs", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "LOCAL-FIRST");
    vi.stubEnv("KAVERO_AUTH_MODE", "password");
    vi.stubEnv("KAVERO_STORAGE_PROVIDER", "kavero-managed");
    vi.stubEnv("KAVERO_MANAGED_STORAGE_BACKEND", "local-filesystem");
    vi.stubEnv("KAVERO_LOCAL_STORAGE_ROOT", "C:\\kavero-storage");
    mocks.createAdminClient.mockReturnValue(createCanvasAiAdmin({ plan: "free", driveStatus: null }));

    const response = await imageGeneratePost(imageGenerateRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Canvas is available on the premium plan.",
    });
  });

  it("keeps Gemini provider-key gates for Local-first Canvas AI routes", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mocks.getUserProviderApiKey.mockResolvedValue(null);

    const imageResponse = await imageGeneratePost(imageGenerateRequest());
    expect(imageResponse.status).toBe(403);
    await expect(imageResponse.json()).resolves.toEqual({
      error: "Add your Gemini API key in Settings before generating.",
    });

    const judgeResponse = await imageJudgePost(imageJudgeRequest());
    expect(judgeResponse.status).toBe(403);
    await expect(judgeResponse.json()).resolves.toEqual({
      error: "Add your Gemini API key in Settings before judging images.",
    });

    const segmentResponse = await autoSegmentPost(autoSegmentRequest());
    expect(segmentResponse.status).toBe(403);
    await expect(segmentResponse.json()).resolves.toEqual({
      error: "Add your Gemini API key in Settings before using Auto Segment.",
    });

    vi.stubEnv("CANVAS_ASSISTANT_PROVIDER", "gemini");
    const assistantResponse = await assistantPost(assistantRequest());
    expect(assistantResponse.status).toBe(403);
    await expect(assistantResponse.json()).resolves.toEqual({
      error: "Add your Gemini API key in Settings before using Copilot.",
    });

    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("does not require the in-app Gemini key for Local-first Image Judge when the gateway is configured", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    configureGateway();
    mocks.getUserProviderApiKey.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ winnerId: "candidate-1", reason: "best fit" })));

    const response = await imageJudgePost(imageJudgeRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ winnerId: "candidate-1", reason: "best fit" });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("does not require the in-app Gemini key for Local-first canvas image generation when the gateway is configured", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    configureGateway();
    mocks.getUserProviderApiKey.mockResolvedValue(null);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmImageResponse("canvas-gateway-image")));

    const response = await imageGeneratePost(imageGenerateRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.images).toHaveLength(4);
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("does not require the in-app Gemini key for Local-first Auto Segment when the gateway is configured", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    configureGateway();
    mocks.getUserProviderApiKey.mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(litellmResponse(autoSegmentPlanPayload()))
        .mockResolvedValueOnce(litellmImageResponse("auto-segment-gateway-mask")),
    );

    const response = await autoSegmentPost(autoSegmentRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.categories[0].segments[0]).toMatchObject({ status: "ready" });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });
});

function configureGateway() {
  vi.stubEnv("KAVERO_MODEL_GATEWAY", "litellm");
  vi.stubEnv("KAVERO_LITELLM_BASE_URL", "http://litellm:4000");
  vi.stubEnv("KAVERO_LITELLM_API_KEY", "sk-secret");
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
            content: "Canvas gateway image",
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
        "x-request-id": "req-1",
        "x-litellm-call-id": "call-1",
      },
    },
  );
}

function assistantRequest() {
  return jsonRequest("http://localhost/api/canvas/assistant", {
    designId: "design-1",
    pageId: "page-1",
    messages: [{ role: "user", content: "add a heading" }],
    selectedObjectIds: ["obj-1"],
  });
}

function imageGenerateRequest() {
  return jsonRequest("http://localhost/api/canvas/image-generate", {
    prompt: "Create a clean app icon.",
    count: 4,
    thinking: "fast",
    model: "gemini-3.1-flash-image-preview",
  });
}

function imageJudgeRequest() {
  return jsonRequest("http://localhost/api/canvas/image-judge", {
    prompt: "Pick the best icon.",
    candidates: [
      {
        id: "candidate-1",
        dataUrl: "data:image/png;base64,AAAA",
        mimeType: "image/png",
      },
    ],
  });
}

function autoSegmentRequest() {
  return jsonRequest("http://localhost/api/canvas/auto-segment", {
    assetId: "asset-1",
    sourceName: "Product photo",
  });
}

function jsonRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function okImageResponse(data = "AAAA") {
  return {
    candidates: [
      {
        content: {
          parts: [{ inlineData: { mimeType: "image/png", data } }],
        },
      },
    ],
  };
}

function mockAutoSegmentModelResponses() {
  mocks.generateContent
    .mockResolvedValueOnce({
      text: JSON.stringify(autoSegmentPlanPayload()),
    })
    .mockResolvedValueOnce(okImageResponse("AAAA"));
}

function autoSegmentPlanPayload() {
  return {
    segments: [
      {
        id: "product",
        label: "Main product",
        category: "products",
        elementType: "product object",
        location: "center",
        visualIdentity: "central product object",
        bounds: { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
        description: "the central item",
        isolationPrompt: "Keep only the central product object. Remove everything else. Put it on white.",
        confidence: 0.92,
      },
    ],
  };
}

function managedStorageRef(): StoredObjectRef {
  return {
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
}

function managedAssetRow() {
  return {
    id: "asset-1",
    original_name: "product.png",
    public_url: "/api/canvas/assets/asset-1",
    content_type: "image/png",
    size_bytes: 1024,
    drive_file_id: null,
    drive_status: "available",
    storage_ref: managedStorageRef(),
    storage_kind: "managed",
    storage_status: "available",
    storage_metadata: { providerId: "kavero-managed", backendProviderId: "local-filesystem" },
    storage_external_id: null,
    storage_external_url: null,
  };
}

function createCanvasAiAdmin({
  plan,
  driveStatus,
  assetRow = managedAssetRow(),
}: {
  plan: Plan;
  driveStatus: DriveStatus;
  assetRow?: Record<string, unknown> | null;
}) {
  return {
    from(table: string) {
      return createQuery(table, { plan, driveStatus, assetRow });
    },
  };
}

function createQuery(
  table: string,
  options: {
    plan: Plan;
    driveStatus: DriveStatus;
    assetRow: Record<string, unknown> | null;
  },
) {
  const filters = new Map<string, unknown>();
  const state = { select: "" };
  const query: Record<string, unknown> & {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn((value: string) => {
      state.select = value;
      return query;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      filters.set(column, value);
      return query;
    }),
    maybeSingle: vi.fn(async () => maybeSingle(table, state.select, filters, options)),
  };
  return query;
}

function maybeSingle(
  table: string,
  select: string,
  filters: Map<string, unknown>,
  options: {
    plan: Plan;
    driveStatus: DriveStatus;
    assetRow: Record<string, unknown> | null;
  },
) {
  if (table === "user_metadata") return { data: { plan: options.plan }, error: null };
  if (table === "user_drive_connections") {
    return { data: options.driveStatus ? { status: options.driveStatus } : null, error: null };
  }
  if (table === "canvas_pages") {
    return { data: { id: String(filters.get("id") ?? "page-1"), design_id: String(filters.get("design_id") ?? "design-1") }, error: null };
  }
  if (table === "canvas_assets") {
    if (!options.assetRow) return { data: null, error: null };
    if (select === "id") return { data: { id: options.assetRow.id }, error: null };
    return { data: options.assetRow, error: null };
  }
  return { data: null, error: null };
}
