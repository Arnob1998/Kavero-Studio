import { describe, expect, it } from "vitest";
import { getAvailableBrowserModelCatalog } from "./model-availability";
import type { ModelGatewayConfig } from "../types";

const configuredGateway: ModelGatewayConfig = {
  status: "configured",
  gateway: "litellm",
  baseUrl: "http://litellm:4000",
  apiKey: "secret",
  routingSecret: "routing-secret",
};

describe("model availability", () => {
  it("uses active saved keys in user-required mode", () => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway: configuredGateway,
      credentialMode: "user-required",
      activeProviderKeyIds: new Set(["openai"]),
      env: {},
    });
    expect(catalog.find((model) => model.modelAlias === "kavero-chat-openai-gpt-5-6")?.availability).toMatchObject({ active: true, source: "saved-key" });
    expect(catalog.find((model) => model.modelAlias === "kavero-image-generation-default")?.availability).toMatchObject({ active: false, reason: "credentials-required" });
  });

  it.each(["env-or-user", "env-only"] as const)("uses safe administrator readiness in %s mode", (credentialMode) => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway: configuredGateway,
      credentialMode,
      activeProviderKeyIds: new Set(),
      env: { OPENAI_API_KEY: "configured-openai-key" },
    });
    expect(catalog.find((model) => model.modelAlias === "kavero-image-openai-gpt-image-2")?.availability).toEqual({ active: true, source: "admin-environment", reason: null, message: null });
    expect(JSON.stringify(catalog)).not.toContain("configured-openai-key");
  });

  it("ignores administrator credentials in user-required mode", () => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway: configuredGateway,
      credentialMode: "user-required",
      activeProviderKeyIds: new Set(),
      env: { OPENAI_API_KEY: "configured-openai-key" },
    });
    expect(catalog.find((model) => model.modelAlias === "kavero-chat-openai-gpt-5-6")?.availability)
      .toMatchObject({ active: false, reason: "credentials-required" });
  });

  it("ignores saved keys in env-only mode", () => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway: configuredGateway,
      credentialMode: "env-only",
      activeProviderKeyIds: new Set(["openai"]),
      env: {},
    });
    expect(catalog.find((model) => model.modelAlias === "kavero-image-openai-gpt-image-2")?.availability)
      .toMatchObject({ active: false, reason: "credentials-required" });
  });

  it("keeps direct Gemini available only with credentials when the gateway is disabled", () => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway: { status: "disabled", gateway: null, reason: "not-configured" },
      credentialMode: "env-or-user",
      activeProviderKeyIds: new Set(["google-gemini"]),
      env: {},
    });
    expect(catalog.find((model) => model.modelAlias === "kavero-image-gemini-3-pro")?.availability.active).toBe(true);
    expect(catalog.find((model) => model.modelAlias === "kavero-image-openai-gpt-image-2")?.availability.reason).toBe("gateway-unavailable");
  });

  it("requires an active local runtime for Ollama", () => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway: configuredGateway,
      credentialMode: "env-only",
      activeProviderKeyIds: new Set(),
      env: { OLLAMA_BASE_URL: "http://ollama:11434" },
    });
    expect(catalog.find((model) => model.provider === "ollama")?.availability).toMatchObject({ active: true, source: "local-runtime" });
  });

  it("keeps Azure chat and image environment configuration independent", () => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway: configuredGateway,
      credentialMode: "env-only",
      activeProviderKeyIds: new Set(),
      env: {
        AZURE_API_KEY: "azure-chat-key-012345678901234567890",
        AZURE_API_BASE: "https://kavero.openai.azure.com",
        AZURE_API_VERSION: "2025-04-01-preview",
        AZURE_DEPLOYMENT_NAME: "chat-deployment",
        AZURE_BASE_MODEL: "gpt-5.6-sol",
      },
    });
    expect(catalog.find((model) => model.modelAlias === "kavero-chat-azure-openai")?.availability)
      .toMatchObject({ active: true, source: "admin-environment" });
    expect(catalog.find((model) => model.modelAlias === "kavero-image-azure-gpt-image-2")?.availability)
      .toMatchObject({ active: false, reason: "credentials-required" });
  });

  it("exposes only safe Azure GPT-5.6 chat controls", () => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway: configuredGateway,
      credentialMode: "user-required",
      activeProviderKeyIds: new Set(["azure-openai"]),
      azureChatBaseModel: "gpt-5.6-sol",
      env: {},
    });
    const azure = catalog.find((model) => model.modelAlias === "kavero-chat-azure-openai");

    expect(azure?.capabilities.chatControls).toMatchObject({
      temperature: { supported: false },
      extendedThinking: { supported: false },
      toolReasoningEffort: null,
    });
    expect(JSON.stringify(azure)).not.toContain("deploymentName");
    expect(JSON.stringify(azure)).not.toContain("apiKey");
  });

  it.each([
    [{ status: "error", gateway: "litellm", issues: [{ code: "missing-api-key", message: "Invalid" }] } as ModelGatewayConfig],
    [{ status: "disabled", gateway: null, reason: "not-configured" } as ModelGatewayConfig],
  ])("keeps gateway-dependent models unavailable when the gateway is not configured", (gateway) => {
    const catalog = getAvailableBrowserModelCatalog({
      gateway,
      credentialMode: "env-or-user",
      activeProviderKeyIds: new Set(["openai"]),
      env: { OPENAI_API_KEY: "configured-openai-key" },
    });
    expect(catalog.find((model) => model.modelAlias === "kavero-image-openai-gpt-image-2")?.availability)
      .toMatchObject({ active: false, reason: "gateway-unavailable" });
  });
});
