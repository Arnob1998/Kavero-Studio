import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
} from "@/modules/model-providers";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  generateContent: vi.fn(),
  googleGenAI: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  ThinkingLevel: { HIGH: "HIGH" },
  GoogleGenAI: mocks.googleGenAI,
}));

vi.mock("@/lib/provider-keys", () => ({
  getUserProviderApiKey: mocks.getUserProviderApiKey,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { POST } from "./route";

const envKeys = [
  "KAVERO_MODEL_GATEWAY",
  "KAVERO_LITELLM_BASE_URL",
  "KAVERO_LITELLM_API_KEY",
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

  it("uses the selected chat orchestration alias when the gateway is configured", async () => {
    configureGateway();
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
    const outboundBody = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));

    expect(response.status).toBe(200);
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
    });
    expect(outboundBody.messages[0]).toMatchObject({ role: "system" });
    expect(mocks.getUserProviderApiKey).not.toHaveBeenCalled();
    expect(mocks.generateContent).not.toHaveBeenCalled();
  });

  it("sends reference image data URLs only to LiteLLM and does not expose them in logs or responses", async () => {
    configureGateway();
    const fetchMock = vi.fn<typeof fetch>(async () => litellmResponse(refinedPayload()));
    vi.stubGlobal("fetch", fetchMock);

    const response = (await POST(jsonRequest(validBody({ referenceImages: [referenceImage()] }))))!;
    const body = await response.json();
    const outboundBody = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    const serializedLogs = JSON.stringify([
      consoleInfoSpy.mock.calls,
      consoleErrorSpy.mock.calls,
      body,
    ]);

    expect(response.status).toBe(200);
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
    const outboundBody = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));

    expect(response.status).toBe(200);
    expect(outboundBody.model).toBe(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS);
    expect(body.model).toBe(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS);
  });

  it("returns a safe gateway configuration error without direct Gemini fallback", async () => {
    process.env.KAVERO_MODEL_GATEWAY = "litellm";
    process.env.KAVERO_LITELLM_API_KEY = "sk-secret";

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
