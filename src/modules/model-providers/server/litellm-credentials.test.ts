import { describe, expect, it } from "vitest";
import {
  buildLiteLlmCredentialParams,
  injectServerLiteLlmCredentials,
  sanitizeLiteLlmRequestBody,
} from "./litellm-credentials";

describe("LiteLLM credential params", () => {
  it.each(["google-gemini", "openai", "groq"] as const)(
    "allows only api_key for %s",
    (providerId) => {
      const result = buildLiteLlmCredentialParams(providerId, {
        apiKey: `${providerId}-key-012345678901234567890`,
        ignored: "must-not-pass",
      });

      expect(result.ok).toBe(false);

      const valid = buildLiteLlmCredentialParams(providerId, {
        apiKey: `${providerId}-key-012345678901234567890`,
      });
      expect(valid).toEqual({
        ok: true,
        params: { api_key: `${providerId}-key-012345678901234567890` },
      });
    },
  );

  it("allows only validated Azure fields", () => {
    const result = buildLiteLlmCredentialParams("azure-openai", {
      apiKey: "azure-key-012345678901234567890",
      apiBase: "https://kavero.openai.azure.com",
      apiVersion: "2025-04-01-preview",
      deploymentName: "deployment-one",
      baseModel: "gpt-4.1",
    });

    expect(result).toEqual({
      ok: true,
      params: {
        api_key: "azure-key-012345678901234567890",
        api_base: "https://kavero.openai.azure.com",
        api_version: "2025-04-01-preview",
      },
    });

    expect(
      buildLiteLlmCredentialParams("azure-openai", {
        apiKey: "azure-key-012345678901234567890",
        apiBase: "http://127.0.0.1:4000",
        apiVersion: "2025-04-01-preview",
        deploymentName: "deployment-one",
        baseModel: "gpt-4.1",
      }).ok,
    ).toBe(false);
  });

  it("uses api_base for validated OpenAI-compatible credentials", () => {
    expect(
      buildLiteLlmCredentialParams("openai-compatible", {
        apiBase: "https://models.example.com/v1",
      }),
    ).toEqual({
      ok: true,
      params: { api_base: "https://models.example.com/v1" },
    });

    expect(
      buildLiteLlmCredentialParams("openai-compatible", {
        apiKey: "compatible-key-012345678901234567890",
        apiBase: "https://models.example.com/v1",
      }),
    ).toEqual({
      ok: true,
      params: {
        api_key: "compatible-key-012345678901234567890",
        api_base: "https://models.example.com/v1",
      },
    });
  });

  it("strips browser-provided credential fields before server injection", () => {
    const result = injectServerLiteLlmCredentials(
      {
        model: "kavero-chat-openai-example",
        messages: [],
        api_key: "browser-secret",
        api_base: "https://browser.example.com",
        base_url: "https://browser.example.com",
        api_version: "browser-version",
        user_config: { api_key: "nested-browser-secret" },
      },
      "openai",
      { apiKey: "server-key-012345678901234567890" },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toEqual({
      model: "kavero-chat-openai-example",
      messages: [],
      api_key: "server-key-012345678901234567890",
    });
    expect(JSON.stringify(result.body)).not.toContain("browser-secret");
  });

  it("returns secret-free validation errors", () => {
    const secret = "short-secret";
    const result = buildLiteLlmCredentialParams("openai", { apiKey: secret });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid-provider-credentials", providerId: "openai" },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("strips reserved credential fields for gateway-env requests", () => {
    const body = sanitizeLiteLlmRequestBody({
      model: "kavero-chat-orchestration-default",
      messages: [],
      api_key: "browser-secret",
      api_base: "https://browser.example.com",
      base_url: "https://browser.example.com",
      api_version: "browser-version",
      user_config: { api_key: "nested-browser-secret" },
    });

    expect(body).toEqual({
      model: "kavero-chat-orchestration-default",
      messages: [],
    });
  });
});
