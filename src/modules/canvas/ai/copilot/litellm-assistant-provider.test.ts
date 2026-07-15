import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isModelGatewayError, type ModelGatewayConfig } from "@/modules/model-providers";
import type { ResolvedModelCredentials } from "@/modules/model-providers/server";
import type { CanvasAssistantProviderInput } from "./assistant-orchestrator";
import { createLiteLlmCanvasAssistantProvider } from "./litellm-assistant-provider";

const config: Extract<ModelGatewayConfig, { status: "configured" }> = {
  status: "configured",
  gateway: "litellm",
  baseUrl: "http://litellm:4000",
  apiKey: "sk-test-secret",
  routingSecret: "routing-test-secret",
};

const dataUrl = "data:image/png;base64,VISUALPREVIEWPAYLOAD";

const providerInput: CanvasAssistantProviderInput = {
  messages: [{ role: "user", content: "Move the title down a little." }],
  phase: "propose",
  context: {
    designId: "design-1",
    pageId: "page-1",
    sceneSnapshot: { objects: [{ id: "title-1", type: "textbox" }] },
    relationMap: { nodes: [], edges: [] },
    selectedObjectIds: ["title-1"],
    visualPreview: {
      status: "available",
      pageId: "page-1",
      mimeType: "image/png",
      dataUrl,
      width: 900,
      height: 600,
      bytes: 20,
    },
    inspectedAssets: [
      {
        assetId: "asset-1",
        status: "available",
        mimeType: "image/png",
        bytes: 100,
        publicUrl: "/api/canvas/assets/asset-1",
      },
    ],
    imageGeneration: null,
  },
  tools: [
    {
      name: "transform_object",
      description: "Move or resize an object.",
      riskLevel: "medium",
      inputSchema: {
        type: "object",
        properties: { objectId: { type: "string" }, top: { type: "number" } },
        required: ["objectId"],
      },
    },
  ],
};

describe("LiteLLM canvas assistant provider", () => {
  let consoleInfoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.unstubAllGlobals();
    consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    consoleInfoSpy.mockRestore();
  });

  it("sends OpenAI-compatible messages, tools, request_feedback, and visual preview", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      litellmResponse({
        choices: [
          {
            message: {
              content: "Moved the title.",
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "transform_object",
                    arguments: JSON.stringify({ objectId: "title-1", top: 120 }),
                  },
                },
                {
                  id: "feedback-1",
                  type: "function",
                  function: {
                    name: "request_feedback",
                    arguments: "{}",
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLiteLlmCanvasAssistantProvider({
      config,
      modelAlias: "kavero-chat-openai-gpt-5-6",
      userId: "user-1",
      credentials: userByokCredentials("kavero-chat-openai-gpt-5-6", "sk-user-openai-1234567890"),
    });
    const result = await provider.generate(providerInput);
    const outboundBody = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    const userContent = outboundBody.messages[1].content;
    const textPart = userContent.find((part: { type: string }) => part.type === "text");
    const imagePart = userContent.find((part: { type: string }) => part.type === "image_url");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://litellm:4000/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(outboundBody).toMatchObject({
      model: "kavero-chat-openai-gpt-5-6",
      temperature: 0.2,
      tool_choice: "auto",
      api_key: "sk-user-openai-1234567890",
      messages: [{ role: "system", content: expect.stringContaining("Kavero") }, { role: "user" }],
    });
    expect(outboundBody.tools).toEqual(
      expect.arrayContaining([
        {
          type: "function",
          function: {
            name: "transform_object",
            description: "Move or resize an object. Risk: medium.",
            parameters: providerInput.tools[0].inputSchema,
          },
        },
        {
          type: "function",
          function: expect.objectContaining({ name: "request_feedback" }),
        },
      ]),
    );
    expect(textPart.text).toContain('"sceneSnapshot"');
    expect(textPart.text).not.toContain(dataUrl);
    expect(imagePart).toEqual({ type: "image_url", image_url: { url: dataUrl } });
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain(dataUrl);
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain("VISUALPREVIEWPAYLOAD");
    expect(loggedCredentialSources(consoleInfoSpy)).toContain("user-byok");
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain("sk-user-openai-1234567890");
    expect(result).toEqual({
      message: { role: "assistant", content: "Moved the title." },
      toolCalls: [
        { id: "call-1", name: "transform_object", input: { objectId: "title-1", top: 120 } },
        { id: "feedback-1", name: "request_feedback", input: {} },
      ],
    });
  });

  it("uses stable fallback IDs and returns malformed arguments for orchestrator rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        litellmResponse({
          choices: [
            {
              message: {
                content: [{ type: "text", text: "Malformed call." }],
                tool_calls: [
                  {
                    type: "function",
                    function: {
                      name: "transform_object",
                      arguments: "{not-json",
                    },
                  },
                ],
              },
            },
          ],
        }),
      ),
    );

    const provider = createLiteLlmCanvasAssistantProvider({
      config,
      modelAlias: "kavero-chat-openai-gpt-5-6",
      credentials: gatewayEnvCredentials("kavero-chat-openai-gpt-5-6"),
    });
    const result = await provider.generate(providerInput);

    expect(result.message.content).toBe("Malformed call.");
    expect(result.toolCalls).toEqual([{ id: "litellm-call-1", name: "transform_object", input: "{not-json" }]);
  });

  it("throws a sanitized invalid-response error for invalid response envelopes", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => litellmResponse({ choices: [] })));

    const provider = createLiteLlmCanvasAssistantProvider({
      config,
      modelAlias: "kavero-chat-openai-gpt-5-6",
      credentials: gatewayEnvCredentials("kavero-chat-openai-gpt-5-6"),
    });

    await expect(provider.generate(providerInput)).rejects.toSatisfy((error: unknown) => {
      expect(isModelGatewayError(error)).toBe(true);
      expect(JSON.stringify(error)).not.toContain(dataUrl);
      expect(JSON.stringify(error)).not.toContain("sk-test-secret");
      if (!isModelGatewayError(error)) return false;
      expect(error.details).toMatchObject({
        errorCode: "invalid_response",
        modelAlias: "kavero-chat-openai-gpt-5-6",
        requestId: "req-1",
        callId: "call-1",
      });
      return true;
    });
    expect(JSON.stringify(consoleInfoSpy.mock.calls)).not.toContain(dataUrl);
  });
});

function litellmResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "req-1",
      "x-litellm-call-id": "call-1",
    },
  });
}

function gatewayEnvCredentials(modelAlias: string): ResolvedModelCredentials {
  return {
    ok: true,
    status: "resolved",
    credentialSource: "gateway-env",
    credentials: null,
    modelAlias,
    slot: "chatOrchestration",
    provider: "openai",
    providerKeyId: "openai",
  };
}

function userByokCredentials(modelAlias: string, apiKey: string): ResolvedModelCredentials {
  return {
    ok: true,
    status: "resolved",
    credentialSource: "user-byok",
    credentials: { apiKey },
    modelAlias,
    slot: "chatOrchestration",
    provider: "openai",
    providerKeyId: "openai",
  };
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
