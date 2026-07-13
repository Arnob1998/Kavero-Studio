import { afterEach, describe, expect, it, vi } from "vitest";
import { isModelGatewayError } from "./litellm-client";
import { generateLiteLlmImage } from "./litellm-image-generation";
import type { LiteLlmFetch, ModelGatewayConfig } from "./types";

const config: Extract<ModelGatewayConfig, { status: "configured" }> = {
  status: "configured",
  gateway: "litellm",
  baseUrl: "http://litellm:4000",
  apiKey: "sk-test-secret",
  routingSecret: "routing-test-secret",
};

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": "req-image-1",
      "x-litellm-call-id": "call-image-1",
      ...init.headers,
    },
  });
}

async function callGenerate() {
  return generateLiteLlmImage({
    config,
    modelAlias: "kavero-image-generation-default",
    provider: "gemini",
    model: "gemini/gemini-3.1-flash-image-preview",
    prompt: "Create a clean product image.",
    settings: {
      legacyModel: "gemini-3.1-flash-image-preview",
      count: 1,
      thinking: "balanced",
      aspectRatio: "16:9",
      imageSize: "1K",
      schema: "none",
    },
    referenceImages: [
      {
        dataUrl: "data:image/png;base64,AAAA",
        mimeType: "image/png",
        name: "reference.png",
      },
    ],
  });
}

describe("generateLiteLlmImage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a chat-completion image generation request with multimodal references", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: "Generated text",
              images: [
                {
                  image_url: {
                    url: "data:image/png;base64,BBBB",
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const result = await callGenerate();
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)) as {
      model: string;
      modalities: string[];
      messages: Array<{ content: Array<{ type: string; text?: string; image_url?: { url: string } }> }>;
    };

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://litellm:4000/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-secret",
          "Content-Type": "application/json",
        }),
      }),
    );
    expect(requestBody.model).toBe("kavero-image-generation-default");
    expect(requestBody.modalities).toEqual(["image", "text"]);
    expect(requestBody.messages[0]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "text",
          text: expect.stringContaining("Create a clean product image."),
        }),
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,AAAA" },
        },
      ]),
    );
    expect(result).toMatchObject({
      text: "Generated text",
      images: [{ dataUrl: "data:image/png;base64,BBBB", mimeType: "image/png" }],
      requestId: "req-image-1",
      callId: "call-image-1",
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        totalTokens: 16,
      },
    });
  });

  it("extracts text from array content and image URLs from message images", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: [{ type: "text", text: "Caption text" }],
              images: [{ image_url: { url: "data:image/webp;base64,CCCC" } }],
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(callGenerate()).resolves.toMatchObject({
      text: "Caption text",
      images: [{ dataUrl: "data:image/webp;base64,CCCC", mimeType: "image/webp" }],
    });
  });

  it("fails safely for empty image responses without exposing data URLs or keys", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      jsonResponse({
        choices: [{ message: { content: "No image", images: [] } }],
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(callGenerate()).rejects.toSatisfy((error: unknown) => {
      expect(isModelGatewayError(error)).toBe(true);
      expect(JSON.stringify(error)).not.toContain("sk-test-secret");
      expect(JSON.stringify(error)).not.toContain("data:image/png;base64,AAAA");
      if (!isModelGatewayError(error)) return false;
      expect(error.details).toMatchObject({
        errorCode: "invalid_response",
        requestId: "req-image-1",
        callId: "call-image-1",
      });
      return true;
    });
  });

  it("fails safely for invalid generated image data URLs", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              images: [{ image_url: { url: "https://provider.example/image.png?token=secret" } }],
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(callGenerate()).rejects.toSatisfy((error: unknown) => {
      expect(isModelGatewayError(error)).toBe(true);
      expect(JSON.stringify(error)).not.toContain("provider.example");
      if (!isModelGatewayError(error)) return false;
      expect(error.details.errorCode).toBe("invalid_response");
      return true;
    });
  });
});
