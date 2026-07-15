import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getProviderKeyIdForModelProvider,
  resolveModelCredentials,
  toSafeModelCredentialResolution,
} from "./credential-routing";

const getCredentials = vi.fn();
const dependencies = { getUserProviderCredentials: getCredentials };

describe("model credential routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps catalog providers to provider-key IDs", () => {
    expect(getProviderKeyIdForModelProvider("gemini")).toBe("google-gemini");
    expect(getProviderKeyIdForModelProvider("openai")).toBe("openai");
    expect(getProviderKeyIdForModelProvider("groq")).toBe("groq");
    expect(getProviderKeyIdForModelProvider("ollama")).toBeNull();
    expect(getProviderKeyIdForModelProvider("azure-openai")).toBe("azure-openai");
  });

  it.each([
    ["kavero-chat-orchestration-default", "google-gemini"],
    ["kavero-image-generation-default", "google-gemini"],
    ["kavero-chat-openai-gpt-5-6", "openai"],
    ["kavero-chat-groq-example", "groq"],
  ] as const)("resolves user credentials for %s", async (modelAlias, providerKeyId) => {
    const credentials = { apiKey: `${providerKeyId}-012345678901234567890` };
    getCredentials.mockResolvedValue(credentials);

    const result = await resolveModelCredentials(
      {
        userId: "user-1",
        modelAlias,
        slot: modelAlias === "kavero-image-generation-default" ? "imageGeneration" : "chatOrchestration",
        credentialMode: "env-or-user",
      },
      dependencies,
    );

    expect(getCredentials).toHaveBeenCalledWith("user-1", providerKeyId);
    expect(result).toMatchObject({
      ok: true,
      credentialSource: "user-byok",
      providerKeyId,
      credentials,
    });
  });

  it("falls back to gateway env when env-or-user has no saved credentials", async () => {
    getCredentials.mockResolvedValue(null);

    await expect(
      resolveModelCredentials(
        {
          userId: "user-1",
          modelAlias: "kavero-chat-openai-gpt-5-6",
          slot: "chatOrchestration",
          credentialMode: "env-or-user",
        },
        dependencies,
      ),
    ).resolves.toMatchObject({
      ok: true,
      credentialSource: "gateway-env",
      credentials: null,
    });
  });

  it("returns a safe missing-credentials result in user-required mode", async () => {
    getCredentials.mockResolvedValue(null);

    const result = await resolveModelCredentials(
      {
        userId: "user-1",
        modelAlias: "kavero-chat-groq-example",
        slot: "chatOrchestration",
        credentialMode: "user-required",
      },
      dependencies,
    );

    expect(result).toMatchObject({ ok: false, code: "missing-credentials" });
    expect(JSON.stringify(result)).not.toContain("apiKey");
  });

  it("does not load user credentials in env-only mode", async () => {
    const result = await resolveModelCredentials(
      {
        userId: "user-1",
        modelAlias: "kavero-chat-orchestration-default",
        slot: "chatOrchestration",
        credentialMode: "env-only",
      },
      dependencies,
    );

    expect(getCredentials).not.toHaveBeenCalled();
    expect(result).toMatchObject({ ok: true, credentialSource: "gateway-env" });
  });

  it("enforces all Azure credential modes with complete credentials only", async () => {
    const saved = {
      apiKey: "saved-azure-key-012345678901234",
      apiBase: "https://saved.openai.azure.com",
      apiVersion: "2025-04-01-preview",
      deploymentName: "saved-deployment",
      baseModel: "gpt-4.1",
    };
    const env = {
      AZURE_API_KEY: "env-azure-key-01234567890123456",
      AZURE_API_BASE: "https://env.openai.azure.com",
      AZURE_API_VERSION: "2025-04-01-preview",
      AZURE_DEPLOYMENT_NAME: "env-deployment",
      AZURE_BASE_MODEL: "gpt-5",
    };
    const input = {
      userId: "user-1",
      modelAlias: "kavero-chat-azure-openai",
      slot: "chatOrchestration" as const,
    };

    getCredentials.mockResolvedValue(saved);
    await expect(resolveModelCredentials(
      { ...input, credentialMode: "env-or-user" },
      { ...dependencies, env },
    )).resolves.toMatchObject({ credentialSource: "user-byok", credentials: saved });

    getCredentials.mockResolvedValue(null);
    await expect(resolveModelCredentials(
      { ...input, credentialMode: "env-or-user" },
      { ...dependencies, env },
    )).resolves.toMatchObject({
      credentialSource: "gateway-env",
      credentials: { deploymentName: "env-deployment", baseModel: "gpt-5" },
    });

    await expect(resolveModelCredentials(
      { ...input, credentialMode: "user-required" },
      { ...dependencies, env },
    )).resolves.toMatchObject({ ok: false, code: "missing-credentials" });

    await expect(resolveModelCredentials(
      { ...input, credentialMode: "env-only" },
      { ...dependencies, env },
    )).resolves.toMatchObject({ credentialSource: "gateway-env", credentials: { baseModel: "gpt-5" } });

    await expect(resolveModelCredentials(
      { ...input, credentialMode: "env-only" },
      { ...dependencies, env: { AZURE_API_KEY: env.AZURE_API_KEY } },
    )).resolves.toMatchObject({ ok: false, code: "missing-credentials" });
  });

  it("handles unknown aliases and wrong slots before credential loading", async () => {
    await expect(
      resolveModelCredentials(
        {
          userId: "user-1",
          modelAlias: "unknown-alias",
          slot: "chatOrchestration",
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ ok: false, code: "unknown-alias" });

    await expect(
      resolveModelCredentials(
        {
          userId: "user-1",
          modelAlias: "kavero-image-generation-default",
          slot: "chatOrchestration",
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ ok: false, code: "wrong-slot" });

    expect(getCredentials).not.toHaveBeenCalled();
  });

  it("uses env config for unmapped local providers unless user credentials are required", async () => {
    await expect(
      resolveModelCredentials(
        {
          userId: "user-1",
          modelAlias: "kavero-chat-ollama-example",
          slot: "chatOrchestration",
          credentialMode: "env-or-user",
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ ok: true, credentialSource: "gateway-env" });

    await expect(
      resolveModelCredentials(
        {
          userId: "user-1",
          modelAlias: "kavero-chat-ollama-example",
          slot: "chatOrchestration",
          credentialMode: "user-required",
        },
        dependencies,
      ),
    ).resolves.toMatchObject({ ok: false, code: "unsupported-provider" });
  });

  it("does not silently fall back when credential loading fails", async () => {
    getCredentials.mockRejectedValue(new Error("database details should not escape"));

    const result = await resolveModelCredentials(
      {
        userId: "user-1",
        modelAlias: "kavero-chat-orchestration-default",
        slot: "chatOrchestration",
        credentialMode: "env-or-user",
      },
      dependencies,
    );

    expect(result).toMatchObject({ ok: false, code: "credential-load-failed" });
    expect(JSON.stringify(result)).not.toContain("database details");
  });

  it("removes secrets from the safe resolution projection", async () => {
    const secret = "sk-secret-012345678901234567890";
    getCredentials.mockResolvedValue({ apiKey: secret });
    const result = await resolveModelCredentials(
      {
        userId: "user-1",
        modelAlias: "kavero-chat-openai-gpt-5-6",
        slot: "chatOrchestration",
        credentialMode: "env-or-user",
      },
      dependencies,
    );

    const safe = toSafeModelCredentialResolution(result);
    expect(safe).toMatchObject({ hasCredentials: true, credentialSource: "user-byok" });
    expect(JSON.stringify(safe)).not.toContain(secret);
  });
});
