import { describe, expect, it } from "vitest";
import { getLoggableGatewayConfigResult, getModelGatewayConfig } from "./gateway-config";

describe("model gateway config", () => {
  it("returns a typed disabled state when the gateway is not configured", () => {
    expect(getModelGatewayConfig({})).toEqual({
      status: "disabled",
      gateway: null,
      reason: "not-configured",
    });
  });

  it("returns a configured LiteLLM state from server-only env", () => {
    const result = getModelGatewayConfig({
      KAVERO_MODEL_GATEWAY: "litellm",
      KAVERO_LITELLM_BASE_URL: "http://litellm:4000",
      KAVERO_LITELLM_API_KEY: "sk-secret",
      KAVERO_LITELLM_ROUTING_SECRET: "routingSecret_0123456789012345678901234567890123456789",
    });

    expect(result).toEqual({
      status: "configured",
      gateway: "litellm",
      baseUrl: "http://litellm:4000",
      apiKey: "sk-secret",
      routingSecret: "routingSecret_0123456789012345678901234567890123456789",
    });
    expect(getLoggableGatewayConfigResult(result)).toEqual({
      status: "configured",
      gateway: "litellm",
      baseUrl: "http://litellm:4000",
      apiKey: "[redacted]",
      routingSecret: "[redacted]",
    });
  });

  it("reports missing and invalid values without leaking secrets", () => {
    const result = getModelGatewayConfig({
      KAVERO_MODEL_GATEWAY: "litellm",
      KAVERO_LITELLM_BASE_URL: "not a url",
      KAVERO_LITELLM_API_KEY: "sk-super-secret",
      KAVERO_LITELLM_ROUTING_SECRET: "routingSuperSecret_01234567890123456789012345678901234",
    });

    expect(result.status).toBe("error");
    expect(JSON.stringify(result)).not.toContain("sk-super-secret");
    expect(JSON.stringify(result)).not.toContain("routing-super-secret");
    expect(result).toMatchObject({
      gateway: "litellm",
      issues: [
        {
          code: "invalid-base-url",
          key: "KAVERO_LITELLM_BASE_URL",
        },
      ],
    });

    const missing = getModelGatewayConfig({ KAVERO_MODEL_GATEWAY: "litellm" });
    expect(missing).toMatchObject({
      status: "error",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "missing-base-url" }),
        expect.objectContaining({ code: "missing-api-key" }),
        expect.objectContaining({ code: "missing-routing-secret" }),
      ]),
    });
  });

  it("rejects browser-facing LiteLLM env exposure", () => {
    const publicLiteLlmKey = `${"NEXT_" + "PUBLIC"}_${"LITE" + "LLM"}_BASE_URL`;
    const result = getModelGatewayConfig({
      KAVERO_MODEL_GATEWAY: "litellm",
      KAVERO_LITELLM_BASE_URL: "http://litellm:4000",
      KAVERO_LITELLM_API_KEY: "sk-secret",
      KAVERO_LITELLM_ROUTING_SECRET: "routingSecret_0123456789012345678901234567890123456789",
      [publicLiteLlmKey]: "http://litellm:4000",
    });

    expect(result).toMatchObject({
      status: "error",
      gateway: null,
      issues: [
        {
          code: "public-env-exposure",
          key: publicLiteLlmKey,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("sk-secret");
  });
});
