import { describe, expect, it } from "vitest";
import {
  createSafeRuntimeCredentialFailureResponse,
  prepareLiteLlmImageRuntimeRequest,
  prepareLiteLlmRuntimeRequest,
  type ResolvedModelCredentials,
} from "./runtime-credentials";

describe("runtime model credentials", () => {
  it("prepares gateway-env and user BYOK bodies without leaking caller credentials", () => {
    const callerBody = {
      model: "kavero-chat-openai-gpt-5-6",
      messages: [],
      api_key: "browser-secret",
      user_config: { api_key: "nested-browser-secret" },
    };

    const gatewayEnv = prepareLiteLlmRuntimeRequest(
      callerBody,
      resolution("gateway-env", null),
    );
    expect(gatewayEnv).toEqual({
      ok: true,
      body: { model: "kavero-chat-openai-gpt-5-6", messages: [] },
      credentialSource: "gateway-env",
      monitoringModel: null,
    });

    const userByok = prepareLiteLlmRuntimeRequest(
      callerBody,
      resolution("user-byok", { apiKey: "server-key-012345678901234567890" }),
    );
    expect(userByok).toEqual({
      ok: true,
      body: {
        model: "kavero-chat-openai-gpt-5-6",
        messages: [],
        api_key: "server-key-012345678901234567890",
      },
      credentialSource: "user-byok",
      monitoringModel: null,
    });
  });

  it("transforms internally constructed image bodies with only trusted credentials", () => {
    const prepared = prepareLiteLlmImageRuntimeRequest(
      resolution("user-byok", { apiKey: "server-image-key-012345678901234" }),
    );
    expect(prepared.ok).toBe(true);
    if (!("transformRequestBody" in prepared)) return;

    expect(prepared.transformRequestBody({
      model: "kavero-image-generation-default",
      modalities: ["image", "text"],
      api_key: "caller-key",
      api_base: "https://caller.invalid",
      base_url: "https://caller.invalid",
      api_version: "caller-version",
      user_config: { api_key: "nested-caller-key" },
    })).toEqual({
      model: "kavero-image-generation-default",
      modalities: ["image", "text"],
      api_key: "server-image-key-012345678901234",
    });
    expect(prepared.credentialSource).toBe("user-byok");
    expect(prepared.monitoringModel).toBeNull();
  });

  it("constructs Azure user_config only from trusted resolved credentials", () => {
    const prepared = prepareLiteLlmRuntimeRequest(
      {
        model: "caller-model",
        messages: [],
        user_config: { browser: true },
      },
      {
        ok: true,
        status: "resolved",
        credentialSource: "gateway-env",
        credentials: {
          apiKey: "azure-key-012345678901234567890",
          apiBase: "https://kavero.openai.azure.com",
          apiVersion: "2025-04-01-preview",
          deploymentName: "deployment-five",
          baseModel: "gpt-5",
        },
        modelAlias: "kavero-chat-azure-openai",
        slot: "chatOrchestration",
        provider: "azure-openai",
        providerKeyId: "azure-openai",
      },
    );

    expect(prepared).toMatchObject({
      ok: true,
      credentialSource: "gateway-env",
      monitoringModel: "gpt-5",
      body: {
        model: "kavero-chat-azure-openai",
        user_config: {
          model_list: [{ litellm_params: { model: "azure/gpt5_series/deployment-five" } }],
        },
      },
    });
    expect(JSON.stringify(prepared)).not.toContain("caller-model");
    expect(JSON.stringify(prepared)).not.toContain("browser");
  });

  it("returns fixed safe runtime credential errors", async () => {
    const required = createSafeRuntimeCredentialFailureResponse("Image Judge", {
      ok: false,
      status: "error",
      code: "invalid-provider-credentials",
    });
    expect(required.status).toBe(403);
    await expect(required.json()).resolves.toEqual({
      error: "Image Judge requires provider credentials for the selected model. Add them in Settings and try again.",
      details: { code: "provider-credentials-required" },
    });

    const unavailable = createSafeRuntimeCredentialFailureResponse("Image Judge", {
      ok: false,
      status: "error",
      credentialSource: null,
      code: "credential-load-failed",
      message: "secret store details",
      modelAlias: "kavero-chat-openai-gpt-5-6",
      slot: "chatOrchestration",
      provider: "openai",
      providerKeyId: "openai",
    });
    const body = await unavailable.json();
    expect(unavailable.status).toBe(500);
    expect(body).toEqual({
      error: "Unable to load Image Judge provider credentials.",
      details: { code: "provider-credentials-unavailable" },
    });
    expect(JSON.stringify(body)).not.toContain("secret store details");
  });
});

function resolution(
  credentialSource: "gateway-env" | "user-byok",
  credentials: ResolvedModelCredentials["credentials"],
): ResolvedModelCredentials {
  return {
    ok: true,
    status: "resolved",
    credentialSource,
    credentials,
    modelAlias: "kavero-chat-openai-gpt-5-6",
    slot: "chatOrchestration",
    provider: "openai",
    providerKeyId: "openai",
  } as ResolvedModelCredentials;
}
