import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
} from "@/modules/model-providers";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  getUserProviderCredentials: vi.fn(),
  generateContent: vi.fn(),
  googleGenAI: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  ThinkingLevel: { HIGH: "HIGH" },
  GoogleGenAI: mocks.googleGenAI,
}));

vi.mock("@/lib/provider-keys", () => ({
  getUserProviderApiKey: mocks.getUserProviderApiKey,
  getUserProviderCredentials: mocks.getUserProviderCredentials,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { POST } from "./route";

const envKeys = [
  "KAVERO_MODEL_GATEWAY",
  "KAVERO_LITELLM_BASE_URL",
  "KAVERO_LITELLM_API_KEY",
  "KAVERO_LITELLM_ROUTING_SECRET",
  "KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

const dataUrl = "data:image/png;base64,REFIMAGEPAYLOAD";

describe("/api/prompt-refiner", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    for (const key of envKeys) delete process.env[key];
    mocks.createClient.mockResolvedValue(createSupabaseClient());
    mocks.getUserProviderApiKey.mockResolvedValue("gemini-key");
    mocks.getUserProviderCredentials.mockResolvedValue(null);
    mocks.generateContent.mockResolvedValue(geminiResponse(refinedPayload()));
    mocks.googleGenAI.mockImplementation(function GoogleGenAI() {
      return { models: { generateContent: mocks.generateContent } };
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("injects selected-provider BYOK credentials in env-or-user mode", async () => {
    configureGateway();
    mocks.getUserProviderCredentials.mockResolvedValueOnce({ apiKey: "sk-user-openai-1234567890" });
    mocks.createClient.mockResolvedValue(
      createSupabaseClient({
        preferences: {
          modelProviders: {
            chatOrchestrationModelAlias: "kavero-chat-openai-example",
          },
        },
      }),
    );
    const fetchMock = vi.fn<typeof fetch>(async () => litellmResponse(refinedPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    const outboundBody = outboundJson(fetchMock);

    expect(body).toMatchObject({
      status: "refined",
      refinedPrompt: "A refined product prompt.",
      model: "kavero-chat-openai-example",
      maxQuestions: 3,
    });
    expect(outboundBody).toMatchObject({
      model: "kavero-chat-openai-example",
      temperature: 0.35,
      response_format: { type: "json_object" },
      api_key: "sk-user-openai-1234567890",
    });
    expect(outboundBody.messages[0]).toMatchObject({ role: "system" });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
    expect(mocks.getUserProviderCredentials).toHaveBeenCalledWith("user-1", "openai");
    expect(loggedCredentialSources(consoleInfoSpy)).toContain("user-byok");
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain("sk-user-openai-1234567890");
  });

  it("uses gateway-env without injected credentials when env-or-user has no saved key", async () => {
    configureGateway();
    const fetchMock = vi.fn<typeof fetch>(async () => litellmResponse(refinedPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody())))!;
    const outboundBody = outboundJson(fetchMock);

    expect(response.status).toBe(200);
    expect(outboundBody).not.toHaveProperty("api_key");
    expect(loggedCredentialSources(consoleInfoSpy)).toContain("gateway-env");
  });

  it("routes Azure Prompt Refiner through signed trusted user_config", async () => {
    configureGateway();
    mocks.getUserProviderCredentials.mockResolvedValueOnce({
      apiKey: "azure-key-012345678901234567890",
      apiBase: "https://kavero.openai.azure.com",
      apiVersion: "2025-04-01-preview",
      deploymentName: "private-deployment-one",
      baseModel: "gpt-4.1",
    });
    mocks.createClient.mockResolvedValue(createSupabaseClient({
      preferences: { modelProviders: { chatOrchestrationModelAlias: "kavero-chat-azure-openai" } },
    }));
    const fetchMock = vi.fn<typeof fetch>(async () => litellmResponse(refinedPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();
    const outbound = outboundJson(fetchMock);

    expect(response.status).toBe(200);
    expect(body.model).toBe("kavero-chat-azure-openai");
    expect(outbound).toMatchObject({
      model: "kavero-chat-azure-openai",
      user_config: { model_list: [{ litellm_params: { model: "azure/private-deployment-one" } }] },
    });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-kavero-routing-version": "v1",
      "x-kavero-routing-signature": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).toContain("gpt-4.1");
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain("private-deployment-one");
  });

  it("rejects missing credentials in user-required mode without calling LiteLLM", async () => {
    configureGateway();
    process.env.KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE = "user-required";
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toEqual({
      error: "Prompt refinement requires provider credentials for the selected model. Add them in Settings and try again.",
      details: { code: "provider-credentials-required" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("returns a safe credential-store error without env or direct fallback", async () => {
    configureGateway();
    mocks.getUserProviderCredentials.mockRejectedValueOnce(
      new Error("vault failed with sk-provider-secret and http://internal.example"),
    );
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();
    const serialized = JSON.stringify([body, consoleErrorSpy.mock.calls, consoleInfoSpy.mock.calls]);

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Unable to load Prompt refinement provider credentials.",
      details: { code: "provider-credentials-unavailable" },
    });
    expect(serialized).not.toContain("sk-provider-secret");
    expect(serialized).not.toContain("internal.example");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("ignores saved credentials in env-only mode and strips reserved credential fields", async () => {
    configureGateway();
    process.env.KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE = "env-only";
    const fetchMock = vi.fn<typeof fetch>(async () => litellmResponse(refinedPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody({
      api_key: "browser-key",
      api_base: "https://browser.invalid",
      base_url: "https://browser.invalid",
      api_version: "browser-version",
      user_config: { api_key: "nested-browser-key" },
    }))))!;
    const outboundBody = outboundJson(fetchMock);

    expect(response.status).toBe(200);
    expect(outboundBody).not.toHaveProperty("api_key");
    expect(outboundBody).not.toHaveProperty("api_base");
    expect(outboundBody).not.toHaveProperty("base_url");
    expect(outboundBody).not.toHaveProperty("api_version");
    expect(outboundBody).not.toHaveProperty("user_config");
    expect(mocks.getUserProviderCredentials).not.toHaveBeenCalled();
  });

  it("sends reference image data URLs only to LiteLLM and does not expose them in logs or responses", async () => {
    configureGateway();
    const fetchMock = vi.fn<typeof fetch>(async () => litellmResponse(refinedPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody({ referenceImages: [referenceImage()] }))))!;
    const body = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    const outboundBody = outboundJson(fetchMock);
    const serializedLogs = JSON.stringify([
      consoleInfoSpy.mock.calls,
      consoleErrorSpy.mock.calls,
      body,
    ]);

    expect(JSON.stringify(outboundBody)).toContain(dataUrl);
    expect(serializedLogs).not.toContain(dataUrl);
    expect(serializedLogs).not.toContain("REFIMAGEPAYLOAD");
  });

  it("normalizes wrong-slot stored aliases to the default chat orchestration alias", async () => {
    configureGateway();
    mocks.createClient.mockResolvedValue(
      createSupabaseClient({
        preferences: {
          modelProviders: {
            chatOrchestrationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
          },
        },
      }),
    );
    const fetchMock = vi.fn<typeof fetch>(async () => litellmResponse(refinedPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();
    const outboundBody = outboundJson(fetchMock);

    expect(response.status).toBe(200);
    expect(outboundBody.model).toBe(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS);
    expect(body.model).toBe(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS);
  });

  it("returns a safe gateway configuration error without direct Gemini fallback", async () => {
    process.env.KAVERO_MODEL_GATEWAY = "litellm";
    process.env.KAVERO_LITELLM_API_KEY = "sk-secret";
    process.env.KAVERO_LITELLM_ROUTING_SECRET = "routingSecret_0123456789012345678901234567890123456789";

    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({
      error: "Prompt refinement model gateway is not configured correctly.",
      details: { code: "model-gateway-configuration" },
    });
    expect(JSON.stringify(body)).not.toContain("KAVERO_LITELLM");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("preserves direct Gemini missing-key behavior when the gateway is disabled", async () => {
    mocks.getUserProviderApiKey.mockResolvedValueOnce(null);

    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body).toMatchObject({
      error: "Add your Gemini API key in Settings before refining prompts.",
    });
    expect(mocks.getUserProviderApiKey).toHaveBeenCalledWith("user-1", "google-gemini");
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("preserves direct Gemini success and model metadata when the gateway is disabled", async () => {
    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "refined",
      model: "gemini-3.1-pro-preview",
      maxQuestions: 3,
    });
    expect(mocks.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-3.1-pro-preview",
        config: expect.objectContaining({
          responseMimeType: "application/json",
          systemInstruction: expect.any(String),
        }),
      }),
    );
  });

  it("preserves direct Gemini invalid JSON request behavior after loading the provider key", async () => {
    const response = (await POST(rawRequest("{")))!;
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "Request body must be valid JSON." });
    expect(mocks.getUserProviderApiKey).toHaveBeenCalledWith("user-1", "google-gemini");
  });

  it("maps LiteLLM invalid JSON to a safe invalid-response error", async () => {
    configureGateway();
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ not: "valid" })));

    const response = (await POST(jsonRequest(validBody())))!;
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toMatchObject({ error: "Prompt refinement returned an invalid response." });
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toContain("A product photo");
  });

  it("maps LiteLLM authentication and rate limit errors to safe responses", async () => {
    configureGateway();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "sk-provider-secret" } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "too many" } }), { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);

    const authResponse = (await POST(jsonRequest(validBody())))!;
    const authBody = await authResponse.json();
    const rateResponse = (await POST(jsonRequest(validBody())))!;
    const rateBody = await rateResponse.json();

    expect(authResponse.status).toBe(403);
    expect(authBody).toMatchObject({ error: "The prompt refiner gateway was rejected. Check provider setup and try again." });
    expect(JSON.stringify(authBody)).not.toContain("sk-provider-secret");
    expect(rateResponse.status).toBe(503);
    expect(rateBody).toMatchObject({
      error: "The prompt refiner model is temporarily busy. Please wait a moment and try again.",
      details: { retryable: true },
    });
  });
});

function configureGateway() {
  process.env.KAVERO_MODEL_GATEWAY = "litellm";
  process.env.KAVERO_LITELLM_BASE_URL = "http://litellm:4000";
  process.env.KAVERO_LITELLM_API_KEY = "sk-secret";
  process.env.KAVERO_LITELLM_ROUTING_SECRET = "routingSecret_0123456789012345678901234567890123456789";
  process.env.KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE = "env-or-user";
}

function outboundJson(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  const call = fetchMock.mock.calls.find(([, init]) => typeof init?.body === "string");
  if (!call?.[1] || typeof call[1].body !== "string") throw new Error("Missing LiteLLM request body.");
  return JSON.parse(call[1].body);
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

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/prompt-refiner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rawRequest(body: string) {
  return new Request("http://localhost/api/prompt-refiner", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    prompt: "A product photo",
    referenceImages: [],
    answers: [],
    ...overrides,
  };
}

function referenceImage() {
  return {
    dataUrl,
    mimeType: "image/png",
    name: "reference.png",
  };
}

function refinedPayload() {
  return {
    status: "refined",
    intentSummary: "Product image",
    refinedPrompt: "A refined product prompt.",
    refinementNote: "Added lighting and composition.",
  };
}

function litellmResponse(payload: unknown) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(payload),
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

function geminiResponse(payload: unknown) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  };
}

function createSupabaseClient(options: {
  user?: { id: string } | null;
  preferences?: unknown;
} = {}) {
  const user = options.user === undefined ? { id: "user-1" } : options.user;

  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: null })),
    },
    from: vi.fn((table: string) => {
      if (table !== "user_metadata") throw new Error(`Unexpected table: ${table}`);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: { preferences: options.preferences ?? {} },
          error: null,
        })),
      };
      return query;
    }),
  };
}
