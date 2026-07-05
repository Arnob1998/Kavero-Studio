import { describe, expect, it } from "vitest";
import { createModelGatewayError, toLoggableModelGatewayError } from "./errors";
import { normalizeModelGatewayUsage } from "./usage";

describe("model gateway usage and errors", () => {
  it("normalizes OpenAI-compatible usage fields", () => {
    expect(
      normalizeModelGatewayUsage({
        usage: {
          prompt_tokens: 11,
          completion_tokens: 7,
          total_tokens: 18,
        },
        image_count: 2,
        response_cost: 0.012,
      }),
    ).toEqual({
      inputTokens: 11,
      outputTokens: 7,
      totalTokens: 18,
      imageCount: 2,
      estimatedCost: 0.012,
    });
  });

  it("derives totals when a provider omits total token count", () => {
    expect(
      normalizeModelGatewayUsage({
        input_tokens: 4,
        output_tokens: 9,
      }),
    ).toMatchObject({
      inputTokens: 4,
      outputTokens: 9,
      totalTokens: 13,
    });
  });

  it("creates sanitized gateway errors", () => {
    const error = createModelGatewayError("LiteLLM request failed with status 401.", {
      status: 401,
      provider: "gemini",
      model: "gemini/gemini-3.1-pro-preview",
      modelAlias: "kavero-chat-orchestration-default",
      requestId: "req-1",
      callId: "call-1",
    });

    expect(error.details).toMatchObject({
      errorCode: "authentication_error",
      retryable: false,
      requestId: "req-1",
      callId: "call-1",
    });
    expect(toLoggableModelGatewayError(error)).toEqual(error.details);
    expect(JSON.stringify(error.details)).not.toContain("sk-");
  });
});
