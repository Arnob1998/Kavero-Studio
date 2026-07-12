import { describe, expect, it, vi } from "vitest";
import {
  createModelGatewayEvent,
  logModelGatewayEvent,
  toLoggableModelGatewayEvent,
} from "./monitoring";

describe("model gateway monitoring", () => {
  it("creates a normalized event and loggable payload without content fields", () => {
    const event = createModelGatewayEvent({
      userId: "user-1",
      feature: "prompt-refiner",
      provider: "gemini",
      model: "gemini/gemini-3.1-pro-preview",
      modelAlias: "kavero-chat-orchestration-default",
      requestId: "req-1",
      callId: "call-1",
      status: "success",
      latencyMs: 123,
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        totalTokens: 20,
      },
    });

    expect(event).toMatchObject({
      gateway: "litellm",
      credentialSource: "gateway-env",
      status: "success",
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20,
      imageCount: null,
      estimatedCost: null,
    });

    const payload = toLoggableModelGatewayEvent(event);
    expect(payload).toEqual({
      type: "model_gateway_event",
      ...event,
    });
    expect(payload).not.toHaveProperty("apiKey");
    expect(payload).not.toHaveProperty("messages");
    expect(payload).not.toHaveProperty("images");
    expect(payload).not.toHaveProperty("prompt");
  });

  it("normalizes explicit and non-LiteLLM credential sources", () => {
    expect(
      createModelGatewayEvent({
        feature: "copilot",
        modelAlias: "mock",
        status: "success",
        latencyMs: 1,
        gateway: "mock",
      }).credentialSource,
    ).toBe("mock");

    expect(
      createModelGatewayEvent({
        feature: "image-generation",
        modelAlias: "kavero-image-generation-default",
        status: "success",
        latencyMs: 1,
        gateway: "direct-gemini",
      }).credentialSource,
    ).toBe("direct-gemini");

    expect(
      createModelGatewayEvent({
        feature: "prompt-refiner",
        modelAlias: "kavero-chat-orchestration-default",
        status: "success",
        latencyMs: 1,
        credentialSource: "user-byok",
      }).credentialSource,
    ).toBe("user-byok");
  });

  it("logs structured JSON through the provided logger", () => {
    const logger = { info: vi.fn() };
    const event = createModelGatewayEvent({
      feature: "image-generation",
      modelAlias: "kavero-image-generation-default",
      status: "error",
      latencyMs: 50,
      errorCode: "provider_error",
    });

    logModelGatewayEvent(event, logger);

    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(JSON.parse(logger.info.mock.calls[0]?.[0] as string)).toMatchObject({
      type: "model_gateway_event",
      modelAlias: "kavero-image-generation-default",
      status: "error",
      errorCode: "provider_error",
    });
  });
});
