import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_GENERATION_MODEL_ALIAS } from "@/modules/model-providers";

const mocks = vi.hoisted(() => ({
  getCanvasUser: vi.fn(),
  getCanvasAdmin: vi.fn(),
  requireCanvasAccess: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  generateContent: vi.fn(),
}));

vi.mock("@/lib/canvas/api", () => ({
  getCanvasUser: mocks.getCanvasUser,
  getCanvasAdmin: mocks.getCanvasAdmin,
  requireCanvasAccess: mocks.requireCanvasAccess,
  jsonError: (message: string, status = 400, details?: unknown) =>
    Response.json(details === undefined ? { error: message } : { error: message, details }, { status }),
}));

vi.mock("@/lib/provider-keys", () => ({
  getUserProviderApiKey: mocks.getUserProviderApiKey,
}));

vi.mock("@google/genai", () => ({
  ThinkingLevel: { HIGH: "HIGH", MINIMAL: "MINIMAL" },
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: mocks.generateContent } };
  }),
}));

import { POST } from "./route";

type FetchMock = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

describe("canvas image generation API", () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mocks.getCanvasUser.mockResolvedValue({ id: "user-1" });
    mocks.requireCanvasAccess.mockResolvedValue({ response: null });
    mocks.getCanvasAdmin.mockReturnValue(adminWithPreferences({}));
    mocks.getUserProviderApiKey.mockResolvedValue("gemini-key");
    mocks.generateContent.mockResolvedValue(geminiImageResponse("DIRECT"));
    vi.stubGlobal("fetch", vi.fn<FetchMock>());
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    consoleInfoSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("uses the selected image-generation alias through LiteLLM when the gateway is configured", async () => {
    configureGateway();
    vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => gatewayResponse("GATEWAY")));

    const response = await POST(request(validBody({ count: 4 })));
    const body = await response.json();
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));

    expect(response.status).toBe(200);
    expect(outboundBody).toMatchObject({
      model: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      modalities: ["image", "text"],
    });
    expect(JSON.stringify(outboundBody.messages)).toContain("canvas-image-generation");
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      model: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      modelLabel: "Nano Banana 2",
      kind: "image",
      settings: {
        count: 4,
        thinking: "balanced",
        aspectRatio: "auto",
        imageSize: "1K",
        transparentBackground: false,
        backgroundPreference: "auto",
      },
    });
    expect(body.text).toContain("Gateway text");
    expect(body.images).toHaveLength(4);
    expect(body.warnings).toEqual([]);
  });

  it.each([
    ["missing", {}],
    ["unknown", { modelProviders: { imageGenerationModelAlias: "unknown-image-alias" } }],
    ["wrong-slot", { modelProviders: { imageGenerationModelAlias: "kavero-chat-orchestration-default" } }],
  ])("falls back to the default image alias when the stored preference is %s", async (_label, preferences) => {
    configureGateway();
    mocks.getCanvasAdmin.mockReturnValue(adminWithPreferences(preferences));
    vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => gatewayResponse("FALLBACK")));

    const response = await POST(request(validBody()));
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(outboundBody.model).toBe(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS);
    expect(body.model).toBe(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS);
  });

  it("preserves direct Gemini behavior and metadata when the gateway is disabled", async () => {
    const response = await POST(request(validBody({ model: "gemini-2.5-flash-image", count: 4 })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getUserProviderApiKey).toHaveBeenCalledWith("user-1", "google-gemini");
    expect(mocks.generateContent).toHaveBeenCalledTimes(4);
    expect(mocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-2.5-flash-image",
      }),
    );
    expect(body).toMatchObject({
      model: "gemini-2.5-flash-image",
      modelLabel: "Nano Banana",
      kind: "image",
    });
    expect(body.warnings).toEqual([
      "Gemini 2.5 Flash Image ignores imageSize and generates at its fixed model resolution.",
    ]);
  });

  it("preserves direct Gemini missing-key and load-error messages when the gateway is disabled", async () => {
    mocks.getUserProviderApiKey.mockResolvedValueOnce(null);
    const missingKeyResponse = await POST(request(validBody()));
    expect(missingKeyResponse.status).toBe(403);
    await expect(missingKeyResponse.json()).resolves.toEqual({
      error: "Add your Gemini API key in Settings before generating.",
    });

    mocks.getUserProviderApiKey.mockRejectedValueOnce(new Error("vault unavailable"));
    const loadErrorResponse = await POST(request(validBody()));
    expect(loadErrorResponse.status).toBe(500);
    await expect(loadErrorResponse.json()).resolves.toEqual({
      error: "Unable to load your Gemini API key.",
    });

    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns a safe gateway configuration error without direct Gemini fallback", async () => {
    vi.stubEnv("KAVERO_MODEL_GATEWAY", "litellm");
    vi.stubEnv("KAVERO_LITELLM_API_KEY", "sk-secret");

    const response = await POST(request(validBody()));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "Canvas image generation model gateway is not configured correctly.",
      details: { code: "model-gateway-configuration" },
    });
    expect(JSON.stringify(body)).not.toContain("KAVERO_LITELLM");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves transparent-background prompt shaping and warning in gateway mode", async () => {
    configureGateway();
    vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => gatewayResponse("TRANSPARENT")));

    const response = await POST(
      request(
        validBody({
          transparentBackground: true,
          backgroundPreference: "black",
        }),
      ),
    );
    const body = await response.json();
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
    const serializedOutbound = JSON.stringify(outboundBody);

    expect(response.status).toBe(200);
    expect(serializedOutbound).toContain("pure black (#000000)");
    expect(serializedOutbound).toContain("clean edges");
    expect(body.warnings).toEqual([
      "Transparent images are generated on a high-contrast solid background and cleaned in the canvas editor.",
    ]);
  });

  it("preserves reference image data URL and MIME validation", async () => {
    configureGateway();

    const invalidDataUrlResponse = await POST(
      request(
        validBody({
          referenceImages: [{ dataUrl: "not-a-data-url", mimeType: "image/png", name: "bad.png" }],
        }),
      ),
    );
    expect(invalidDataUrlResponse.status).toBe(400);
    await expect(invalidDataUrlResponse.json()).resolves.toEqual({
      error: "bad.png must be a base64 data URL.",
    });

    const mismatchResponse = await POST(
      request(
        validBody({
          referenceImages: [{ dataUrl: "data:image/jpeg;base64,AAAA", mimeType: "image/png", name: "mismatch.png" }],
        }),
      ),
    );
    expect(mismatchResponse.status).toBe(400);
    await expect(mismatchResponse.json()).resolves.toEqual({
      error: "mismatch.png mimeType does not match the data URL.",
    });

    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns successful gateway images plus a warning when some generations fail", async () => {
    configureGateway();
    const fetchImpl = vi
      .fn<FetchMock>()
      .mockResolvedValueOnce(gatewayResponse("A"))
      .mockResolvedValueOnce(gatewayResponse("B"))
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(gatewayResponse("C"));
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST(request(validBody({ count: 4 })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.images).toHaveLength(3);
    expect(body.warnings).toEqual(["One or more generations failed. Please try again."]);
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("network down");
  });

  it("maps invalid gateway image responses safely without exposing payloads or secrets", async () => {
    configureGateway();
    vi.stubGlobal("fetch", vi.fn<FetchMock>(async () => gatewayResponseWithoutImages()));

    const response = await POST(
      request(
        validBody({
          referenceImages: [{ dataUrl: "data:image/png;base64,REFERENCEPAYLOAD", mimeType: "image/png", name: "reference.png" }],
        }),
      ),
    );
    const body = await response.json();
    const serializedLogsAndBody = JSON.stringify([consoleErrorSpy.mock.calls, body]);

    expect(response.status).toBe(502);
    expect(body).toMatchObject({
      error: "Canvas image generation returned an invalid response.",
      details: { warnings: ["One or more generations failed. Please try again."] },
    });
    expect(serializedLogsAndBody).not.toContain("REFERENCEPAYLOAD");
    expect(serializedLogsAndBody).not.toContain("sk-secret");
    expect(serializedLogsAndBody).not.toContain("litellm:4000");
  });

  it("keeps auth and canvas access gates before provider work", async () => {
    mocks.getCanvasUser.mockResolvedValueOnce(null);
    const authResponse = await POST(request(validBody()));
    expect(authResponse.status).toBe(401);
    await expect(authResponse.json()).resolves.toEqual({ error: "Unauthorized" });

    mocks.getCanvasUser.mockResolvedValueOnce({ id: "user-1" });
    mocks.requireCanvasAccess.mockResolvedValueOnce({
      response: Response.json({ error: "Connect Google Drive to use Canvas." }, { status: 403 }),
    });
    const accessResponse = await POST(request(validBody()));
    expect(accessResponse.status).toBe(403);
    await expect(accessResponse.json()).resolves.toEqual({ error: "Connect Google Drive to use Canvas." });

    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

function configureGateway() {
  vi.stubEnv("KAVERO_MODEL_GATEWAY", "litellm");
  vi.stubEnv("KAVERO_LITELLM_BASE_URL", "http://litellm:4000");
  vi.stubEnv("KAVERO_LITELLM_API_KEY", "sk-secret");
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "Create a clean app icon.",
    model: "gemini-3.1-flash-image-preview",
    count: 4,
    thinking: "balanced",
    aspectRatio: "auto",
    imageSize: "1K",
    transparentBackground: false,
    backgroundPreference: "auto",
    referenceImages: [],
    ...overrides,
  };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/canvas/image-generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function geminiImageResponse(data: string) {
  return {
    candidates: [
      {
        content: {
          parts: [
            { text: "Direct text" },
            { inlineData: { mimeType: "image/png", data } },
          ],
        },
      },
    ],
  };
}

function gatewayResponse(data: string) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: "Gateway text",
            images: [{ image_url: { url: `data:image/png;base64,${data}` } }],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
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

function gatewayResponseWithoutImages() {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: "No image", images: [] } }],
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

function adminWithPreferences(preferences: unknown) {
  return {
    from(table: string) {
      if (table !== "user_metadata") throw new Error(`Unexpected table: ${table}`);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({ data: { preferences }, error: null })),
      };
      return query;
    },
  };
}
