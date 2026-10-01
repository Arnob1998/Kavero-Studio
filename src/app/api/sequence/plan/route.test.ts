import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateContent, getUserProviderApiKey, getUser, maybeSingle, getModelGatewayConfig, chatCompletions, prepareLiteLlmRuntimeRequest, resolveChatOrchestrationRuntimeCredentials, logModelGatewayEvent } = vi.hoisted(() => ({
  generateContent: vi.fn(),
  getUserProviderApiKey: vi.fn(),
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
  getModelGatewayConfig: vi.fn(),
  chatCompletions: vi.fn(),
  prepareLiteLlmRuntimeRequest: vi.fn(),
  resolveChatOrchestrationRuntimeCredentials: vi.fn(),
  logModelGatewayEvent: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent };
  },
  ThinkingLevel: { HIGH: "HIGH" },
}));

vi.mock("@/lib/provider-keys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/provider-keys")>()),
  getUserProviderApiKey,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({ maybeSingle })),
      })),
    })),
  })),
}));

vi.mock("@/modules/model-providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/model-providers")>()),
  getModelGatewayConfig,
  createLiteLlmClient: vi.fn(() => ({ chatCompletions })),
  logModelGatewayEvent,
}));

vi.mock("@/modules/model-providers/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/model-providers/server")>()),
  getResolvedChatPolicyModel: vi.fn(() => "gpt-5.6-sol"),
  prepareLiteLlmRuntimeRequest,
  resolveChatOrchestrationRuntimeCredentials,
}));

import { POST } from "./route";

function request(overrides: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/sequence/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      goal: "Create a two-frame product launch story",
      imageModelAlias: "kavero-image-generation-default",
      plannerCallNumber: 1,
      references: [{ id: "ref-1", label: "Product", role: "product", dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png", byteSize: 1 }],
      ...overrides,
    }),
  });
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    title: "Launch story",
    sequenceType: "carousel",
    countRationale: "Two frames introduce and demonstrate the product.",
    sharedRules: { style: "Editorial", subject: null, character: null, product: "Same product", palette: null, typography: null, composition: null },
    frames: [
      { id: "frame-1", purpose: "Introduce", prompt: "Product hero", referenceIds: ["ref-1"], dependencies: [] },
      { id: "frame-2", purpose: "Demonstrate", prompt: "Product in use", referenceIds: ["ref-1"], dependencies: ["frame-1"] },
    ],
    warnings: ["Consistency is assisted."],
    assumptions: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  maybeSingle.mockResolvedValue({ data: { preferences: {} }, error: null });
  getModelGatewayConfig.mockReturnValue({ status: "disabled", gateway: null, reason: "not-configured" });
  getUserProviderApiKey.mockResolvedValue("gemini-key");
  resolveChatOrchestrationRuntimeCredentials.mockResolvedValue({ ok: true, credentialSource: "user-byok" });
  prepareLiteLlmRuntimeRequest.mockImplementation((body) => ({
    ok: true,
    body,
    credentialSource: "user-byok",
    monitoringModel: "gpt-5.6-sol",
  }));
  generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan()) }] } }] });
  chatCompletions.mockResolvedValue({
    data: { choices: [{ message: { content: JSON.stringify(plan()) } }] },
    requestId: "request-1",
    callId: "call-1",
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30, imageCount: null, estimatedCost: null },
  });
});

describe("POST /api/sequence/plan", () => {
  it("requires authentication before parsing or provider traffic", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("rejects invalid input before provider traffic", async () => {
    const response = await POST(request({ plannerCallNumber: 4 }));
    expect(response.status).toBe(400);
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("fails unsupported reference execution closed before provider traffic", async () => {
    const response = await POST(request({ imageModelAlias: "kavero-image-openai-gpt-image-2" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ details: { code: "sequence-capability" } });
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("returns a schema-validated review plan without image generation traffic", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      modelAlias: "kavero-chat-orchestration-default",
      plannerCallNumber: 1,
      plan: { title: "Launch story", frames: [{ id: "frame-1" }, { id: "frame-2" }] },
    });
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0][0].config.responseJsonSchema).toMatchObject({ type: "object" });
  });

  it("rejects malformed or ungrounded model output without retrying", async () => {
    generateContent.mockResolvedValue({ candidates: [{ content: { parts: [{ text: JSON.stringify(plan({ frames: [
      { id: "frame-1", purpose: "Introduce", prompt: "Product hero", referenceIds: ["not-supplied"], dependencies: [] },
      { id: "frame-2", purpose: "Demonstrate", prompt: "Product in use", referenceIds: [], dependencies: ["frame-1"] },
    ] })) }] } }] });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ details: { code: "invalid-plan", reason: "unknown-reference" } });
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it("uses the selected eligible gateway planner with strict schema and secret-free monitoring", async () => {
    getModelGatewayConfig.mockReturnValue({ status: "configured", gateway: "litellm", baseUrl: "http://litellm:4000", apiKey: "gateway-key", routingSecret: "routing-secret" });
    maybeSingle.mockResolvedValue({ data: { preferences: { modelProviders: {
      chatOrchestrationModelAlias: "kavero-chat-azure-openai",
      imageGenerationModelAlias: "kavero-image-generation-default",
    } } }, error: null });

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(generateContent).not.toHaveBeenCalled();
    expect(chatCompletions).toHaveBeenCalledTimes(1);
    expect(prepareLiteLlmRuntimeRequest.mock.calls[0][0]).toMatchObject({
      model: "kavero-chat-azure-openai",
      response_format: { type: "json_schema", json_schema: { strict: true } },
    });
    expect(logModelGatewayEvent).toHaveBeenCalledWith(expect.objectContaining({
      feature: "sequence-planner",
      status: "success",
    }));
    expect(JSON.stringify(logModelGatewayEvent.mock.calls)).not.toContain("gateway-key");
    expect(JSON.stringify(logModelGatewayEvent.mock.calls)).not.toContain("data:image");
  });
});
