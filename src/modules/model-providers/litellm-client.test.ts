import { describe, expect, it, vi } from "vitest";
import { createLiteLlmClient, isModelGatewayError } from "./litellm-client";
import type { LiteLlmFetch, ModelGatewayConfig } from "./types";

const config: Extract<ModelGatewayConfig, { status: "configured" }> = {
  status: "configured",
  gateway: "litellm",
  baseUrl: "http://litellm:4000/",
  apiKey: "sk-test-secret",
  routingSecret: "routing-test-secret",
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
    const client = createLiteLlmClient({ config, fetchImpl, now: () => 1_750_000_000_000 });

    const result = await client.chatCompletions(
      { model: "kavero-chat-orchestration-default", messages: [{ role: "user", content: "Hello" }] },
      { provider: "gemini", modelAlias: "kavero-chat-orchestration-default" },
    );

    expect(fetchImpl).toHaveBeenCalledWith("http://litellm:4000/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer sk-test-secret",
        "Content-Type": "application/json",
        "x-kavero-routing-signature": expect.stringMatching(/^[a-f0-9]{64}$/),
        "x-kavero-routing-timestamp": "1750000000",
        "x-kavero-routing-version": "v1",
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
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({
      "x-kavero-routing-version": "v1",
      "x-kavero-routing-timestamp": expect.stringMatching(/^\d{10}$/),
      "x-kavero-routing-signature": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(fetchImpl.mock.calls[1]?.[1]?.method).toBe("GET");
    expect(fetchImpl.mock.calls[2]?.[1]?.method).toBe("GET");
    expect(fetchImpl.mock.calls[1]?.[1]?.headers).not.toHaveProperty("x-kavero-routing-signature");
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).not.toHaveProperty("x-kavero-routing-signature");
  });

  it("signs the exact multipart bytes for image edits", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () => jsonResponse({ data: [] }));
    const client = createLiteLlmClient({ config, fetchImpl, now: () => 1_750_000_000_000 });
    const bytes = new TextEncoder().encode("--boundary\r\nexact multipart bytes\r\n--boundary--\r\n");

    await client.editImage(bytes, "multipart/form-data; boundary=boundary");

    expect(fetchImpl).toHaveBeenCalledWith("http://litellm:4000/v1/images/edits", {
      method: "POST",
      headers: expect.objectContaining({
        "Content-Type": "multipart/form-data; boundary=boundary",
        "x-kavero-routing-signature": expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      body: bytes,
    });
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

  it("classifies upstream request rejections as provider errors, not invalid responses", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () => jsonResponse(
      { error: { message: "unsupported parameter", secret: "must-not-leak" } },
      { status: 400 },
    ));
    const client = createLiteLlmClient({ config, fetchImpl });

    await expect(client.chatCompletions({ model: "x" })).rejects.toSatisfy((error: unknown) => {
      if (!isModelGatewayError(error)) return false;
      expect(error.details).toMatchObject({ status: 400, errorCode: "provider_error", retryable: false });
      expect(JSON.stringify(error)).not.toContain("unsupported parameter");
      expect(JSON.stringify(error)).not.toContain("must-not-leak");
      return true;
    });
  });
});
