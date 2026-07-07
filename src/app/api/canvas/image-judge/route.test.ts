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
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
}));

vi.mock("@/lib/provider-keys", () => ({
  getUserProviderApiKey: mocks.getUserProviderApiKey,
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    return { models: { generateContent: mocks.generateContent } };
  }),
}));

import { POST } from "./route";

const candidateDataUrl = "data:image/png;base64,CANDIDATEPAYLOAD";
const previewDataUrl = "data:image/png;base64,PREVIEWPAYLOAD";

describe("canvas image judge API", () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mocks.getCanvasUser.mockResolvedValue({ id: "user-1" });
    mocks.requireCanvasAccess.mockResolvedValue({ response: null });
    mocks.getUserProviderApiKey.mockResolvedValue("gemini-key");
    mocks.getCanvasAdmin.mockReturnValue(adminWithPreferences({}));
    mocks.generateContent.mockResolvedValue({
      text: JSON.stringify({ winnerId: "candidate-1", reason: "best fit" }),
    });
    vi.stubGlobal("fetch", vi.fn());
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    consoleInfoSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("uses the selected chat orchestration alias when the gateway is configured", async () => {
    configureGateway();
    mocks.getCanvasAdmin.mockReturnValue(
      adminWithPreferences({
        modelProviders: { chatOrchestrationModelAlias: "kavero-chat-openai-example" },
      }),
    );
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ winnerId: "candidate-1", reason: "best fit" })));

    const response = await POST(judgeRequest());
    const body = await response.json();
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));

    expect(response.status).toBe(200);
    expect(body).toEqual({ winnerId: "candidate-1", reason: "best fit" });
    expect(outboundBody).toMatchObject({
      model: "kavero-chat-openai-example",
      response_format: { type: "json_object" },
    });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("sends preview and candidate images only to LiteLLM without logging or responding with data URLs", async () => {
    configureGateway();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ winnerId: "candidate-1", reason: "best fit" })));

    const response = await POST(judgeRequest({ includePreview: true }));
    const body = await response.json();
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));
    const serializedLogsAndBody = JSON.stringify([consoleInfoSpy.mock.calls, consoleErrorSpy.mock.calls, body]);

    expect(response.status).toBe(200);
    expect(JSON.stringify(outboundBody)).toContain(candidateDataUrl);
    expect(JSON.stringify(outboundBody)).toContain(previewDataUrl);
    expect(serializedLogsAndBody).not.toContain("CANDIDATEPAYLOAD");
    expect(serializedLogsAndBody).not.toContain("PREVIEWPAYLOAD");
    expect(serializedLogsAndBody).not.toContain(candidateDataUrl);
    expect(serializedLogsAndBody).not.toContain(previewDataUrl);
  });

  it("falls back from a wrong-slot alias to the default chat orchestration alias", async () => {
    configureGateway();
    mocks.getCanvasAdmin.mockReturnValue(
      adminWithPreferences({
        modelProviders: { chatOrchestrationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS },
      }),
    );
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ winnerId: "candidate-1", reason: "best fit" })));

    const response = await POST(judgeRequest());
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));

    expect(response.status).toBe(200);
    expect(outboundBody.model).toBe("kavero-chat-orchestration-default");
  });

  it("returns a safe gateway configuration error without direct Gemini fallback", async () => {
    vi.stubEnv("KAVERO_MODEL_GATEWAY", "litellm");
    vi.stubEnv("KAVERO_LITELLM_API_KEY", "sk-secret");

    const response = await POST(judgeRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "Image Judge model gateway is not configured correctly.",
      details: { code: "model-gateway-configuration" },
    });
    expect(JSON.stringify(body)).not.toContain("KAVERO_LITELLM");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("preserves direct Gemini key behavior when the gateway is disabled", async () => {
    mocks.getUserProviderApiKey.mockResolvedValueOnce(null);

    const missingKeyResponse = await POST(judgeRequest());
    await expect(missingKeyResponse.json()).resolves.toEqual({
      error: "Add your Gemini API key in Settings before judging images.",
    });
    expect(missingKeyResponse.status).toBe(403);

    mocks.getUserProviderApiKey.mockResolvedValueOnce("gemini-key");
    const successResponse = await POST(judgeRequest());
    const successBody = await successResponse.json();

    expect(successResponse.status).toBe(200);
    expect(successBody).toEqual({ winnerId: "candidate-1", reason: JSON.stringify({ winnerId: "candidate-1", reason: "best fit" }) });
    expect(mocks.generateContent).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.1-pro-preview" }));
  });

  it("maps invalid LiteLLM judge JSON to a safe response", async () => {
    configureGateway();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ winnerId: "missing", reason: "bad" })));

    const response = await POST(judgeRequest());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({ error: "Image Judge returned an invalid response." });
    expect(JSON.stringify(body)).not.toContain("CANDIDATEPAYLOAD");
  });
});

function configureGateway() {
  vi.stubEnv("KAVERO_MODEL_GATEWAY", "litellm");
  vi.stubEnv("KAVERO_LITELLM_BASE_URL", "http://litellm:4000");
  vi.stubEnv("KAVERO_LITELLM_API_KEY", "sk-secret");
}

function judgeRequest(options: { includePreview?: boolean } = {}) {
  return new Request("http://localhost/api/canvas/image-judge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "Pick the best icon.",
      canvasPreview: options.includePreview
        ? { dataUrl: previewDataUrl, mimeType: "image/png" }
        : null,
      candidates: [
        {
          id: "candidate-1",
          dataUrl: candidateDataUrl,
          mimeType: "image/png",
        },
      ],
    }),
  });
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
