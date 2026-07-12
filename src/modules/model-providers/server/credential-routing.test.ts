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
  });

  it.each([
    ["kavero-chat-orchestration-default", "google-gemini"],
    ["kavero-image-generation-default", "google-gemini"],
    ["kavero-chat-openai-example", "openai"],
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
          modelAlias: "kavero-chat-openai-example",
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
        modelAlias: "kavero-chat-openai-example",
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
