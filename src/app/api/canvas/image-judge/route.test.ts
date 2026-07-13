import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_GENERATION_MODEL_ALIAS } from "@/modules/model-providers";

const mocks = vi.hoisted(() => ({
  getCanvasUser: vi.fn(),
  getCanvasAdmin: vi.fn(),
  requireCanvasAccess: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  getUserProviderCredentials: vi.fn(),
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
  getUserProviderCredentials: mocks.getUserProviderCredentials,
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
    mocks.getUserProviderCredentials.mockResolvedValue(null);
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
    mocks.getUserProviderCredentials.mockResolvedValueOnce({ apiKey: "sk-user-openai-1234567890" });
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
      api_key: "sk-user-openai-1234567890",
    });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(loggedCredentialSources(consoleInfoSpy)).toContain("user-byok");
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain("sk-user-openai-1234567890");
  });

  it("uses gateway-env when env-or-user has no saved Image Judge key", async () => {
    configureGateway();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ winnerId: "candidate-1", reason: "best fit" })));

    const response = await POST(judgeRequest());
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));

    expect(response.status).toBe(200);
    expect(outboundBody).not.toHaveProperty("api_key");
    expect(loggedCredentialSources(consoleInfoSpy)).toContain("gateway-env");
  });

  it("routes multimodal Image Judge through a curated Azure family", async () => {
    configureGateway();
    mocks.getUserProviderCredentials.mockResolvedValueOnce({
      apiKey: "azure-key-012345678901234567890",
      apiBase: "https://kavero.openai.azure.com",
      apiVersion: "2025-04-01-preview",
      deploymentName: "judge-private-deployment",
      baseModel: "gpt-4o",
    });
    mocks.getCanvasAdmin.mockReturnValue(adminWithPreferences({
      modelProviders: { chatOrchestrationModelAlias: "kavero-chat-azure-openai" },
    }));
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ winnerId: "candidate-1", reason: "best fit" })));

    const response = await POST(judgeRequest());
    const outbound = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));

    expect(response.status).toBe(200);
    expect(outbound).toMatchObject({
      model: "kavero-chat-azure-openai",
      user_config: { model_list: [{ litellm_params: { model: "azure/judge-private-deployment" } }] },
    });
    expect(JSON.stringify(outbound.messages)).toContain("data:image/png;base64");
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).toContain("gpt-4o");
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain("judge-private-deployment");
  });

  it("rejects missing Image Judge credentials in user-required mode", async () => {
    configureGateway();
    vi.stubEnv("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE", "user-required");

    const response = await POST(judgeRequest());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      details: { code: "provider-credentials-required" },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("ignores saved Image Judge credentials in env-only mode", async () => {
    configureGateway();
    vi.stubEnv("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE", "env-only");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ winnerId: "candidate-1", reason: "best fit" })));

    const response = await POST(judgeRequest());
    const outboundBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]!.body));

    expect(response.status).toBe(200);
    expect(outboundBody).not.toHaveProperty("api_key");
    expect(mocks.getUserProviderCredentials).not.toHaveBeenCalled();
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
    vi.stubEnv("KAVERO_LITELLM_ROUTING_SECRET", "routingSecret_0123456789012345678901234567890123456789");

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
  vi.stubEnv("KAVERO_LITELLM_ROUTING_SECRET", "routingSecret_0123456789012345678901234567890123456789");
  vi.stubEnv("KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE", "env-or-user");
}

function loggedCredentialSources(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.flatMap(([value]: unknown[]) => {
    try {
      const parsed = JSON.parse(String(value)) as { credentialSource?: unknown };
      return typeof parsed.credentialSource === "string" ? [parsed.credentialSource] : [];
    } catch {
      return [];
    }
  });
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
