import { afterEach, describe, expect, it, vi } from "vitest";
import { isModelGatewayError } from "./litellm-client";
import {
  generateLiteLlmImage,
  OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
} from "./litellm-image-generation";
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

async function callOpenAiGenerate(overrides: { referenceImages?: Array<{ dataUrl: string; mimeType: string }> } = {}) {
  return generateLiteLlmImage({
    config,
    modelAlias: OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
    provider: "openai",
    model: "gpt-image-2",
    prompt: "Create a clean product image.",
    settings: {
      legacyModel: "gemini-3.1-flash-image-preview",
      count: 1,
      thinking: "deep",
      aspectRatio: "16:9",
      imageSize: "2K",
      schema: "none",
    },
    referenceImages: overrides.referenceImages ?? [],
    transformRequestBody: (body) => ({ ...body, api_key: "sk-openai-byok-secret" }),
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

  it("uses the signed image-generation endpoint and normalizes GPT Image 2 base64 output", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      jsonResponse({
        data: [{ b64_json: "R0lGODlhAQABAIAAAAUEBA==", revised_prompt: "A revised prompt" }],
        usage: { prompt_tokens: 7, completion_tokens: 11, total_tokens: 18 },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    const result = await callOpenAiGenerate();
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://litellm:4000/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-kavero-routing-signature": expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      }),
    );
    expect(requestBody).toEqual({
      model: OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
      prompt: "Create a clean product image.",
      n: 1,
      size: "auto",
      quality: "auto",
      api_key: "sk-openai-byok-secret",
    });
    expect(result).toMatchObject({
      text: "A revised prompt",
      images: [{
        dataUrl: "data:image/png;base64,R0lGODlhAQABAIAAAAUEBA==",
        mimeType: "image/png",
      }],
      warnings: expect.arrayContaining([
        expect.stringContaining("thinking level"),
        expect.stringContaining("aspect ratio"),
        expect.stringContaining("image size"),
      ]),
      usage: { inputTokens: 7, outputTokens: 11, totalTokens: 18 },
    });
  });

  it("rejects malformed or empty GPT Image 2 responses without leaking provider data", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      jsonResponse({ data: [{ b64_json: "not valid base64!" }] }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(callOpenAiGenerate()).rejects.toSatisfy((error: unknown) => {
      expect(isModelGatewayError(error)).toBe(true);
      expect(JSON.stringify(error)).not.toContain("sk-openai-byok-secret");
      if (!isModelGatewayError(error)) return false;
      return error.details.errorCode === "invalid_response";
    });
  });

  it("fails closed before upstream traffic for GPT Image 2 reference requests", async () => {
    const fetchImpl = vi.fn<LiteLlmFetch>(async () =>
      jsonResponse({ data: [{ b64_json: "R0lGODlhAQABAIAAAAUEBA==" }] }),
    );
    vi.stubGlobal("fetch", fetchImpl);

    await expect(callOpenAiGenerate({
      referenceImages: [{ dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png" }],
    })).rejects.toSatisfy((error: unknown) => {
      expect(isModelGatewayError(error)).toBe(true);
      if (!isModelGatewayError(error)) return false;
      expect(error.message).toBe("GPT Image 2 reference editing is not available.");
      return error.details.errorCode === "provider_error";
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
