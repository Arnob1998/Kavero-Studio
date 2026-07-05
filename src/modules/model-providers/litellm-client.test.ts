import { describe, expect, it, vi } from "vitest";
import { createLiteLlmClient, isModelGatewayError } from "./litellm-client";
import type { LiteLlmFetch, ModelGatewayConfig } from "./types";

const config: Extract<ModelGatewayConfig, { status: "configured" }> = {
  status: "configured",
  gateway: "litellm",
  baseUrl: "http://litellm:4000/",
  apiKey: "sk-test-secret",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "req-1",
      "x-litellm-call-id": "call-1",
      ...init.headers,
    },
  });
}

describe("LiteLLM client", () => {
  it("constructs chat completion requests with authorization", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      jsonResponse({
        id: "chatcmpl-1",
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    const client = createLiteLlmClient({ config, fetchImpl });

    const result = await client.chatCompletions(
      { model: "kavero-chat-orchestration-default", messages: [{ role: "user", content: "Hello" }] },
      { provider: "gemini", modelAlias: "kavero-chat-orchestration-default" },
    );

    expect(fetchImpl).toHaveBeenCalledWith("http://litellm:4000/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer sk-test-secret",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "kavero-chat-orchestration-default",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });
    expect(result).toMatchObject({
      requestId: "req-1",
      callId: "call-1",
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      },
    });
  });

  it("constructs image generation and model metadata requests", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () => jsonResponse({ data: [] }));
    const client = createLiteLlmClient({ config, fetchImpl });

    await client.generateImage({ model: "kavero-image-generation-default", prompt: "image" });
    await client.getModelInfo("kavero-chat-orchestration-default");
    await client.listModels();

    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([
      "http://litellm:4000/v1/images/generations",
      "http://litellm:4000/model/info?model=kavero-chat-orchestration-default",
      "http://litellm:4000/v1/models",
    ]);
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe("GET");
  });

  it("normalizes non-2xx errors without leaking response bodies or keys", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      new Response(JSON.stringify({ error: { message: "contains sk-provider-secret" } }), {
        status: 503,
        headers: { "x-litellm-call-id": "call-failed" },
      }),
    );
    const client = createLiteLlmClient({ config, fetchImpl });

    await expect(client.chatCompletions({ model: "x" })).rejects.toSatisfy((error: unknown) => {
      expect(isModelGatewayError(error)).toBe(true);
      expect(JSON.stringify(error)).not.toContain("sk-test-secret");
      expect(JSON.stringify(error)).not.toContain("sk-provider-secret");
      if (!isModelGatewayError(error)) return false;
      expect(error.details).toMatchObject({
        status: 503,
        errorCode: "provider_error",
        callId: "call-failed",
        retryable: true,
      });
      return true;
    });
  });
});
