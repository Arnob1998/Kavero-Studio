import { describe, expect, it } from "vitest";
import {
  deserializeProviderCredentials,
  getBrowserProviderKeyCatalog,
  parseProviderCredentials,
  providerKeyRegistry,
  serializeProviderCredentials,
  supportedProviderIds,
} from "@/lib/provider-key-registry";

describe("provider key registry", () => {
  it("registers the MP-9B providers and deliberately excludes Ollama BYOK", () => {
    expect(supportedProviderIds).toEqual([
      "google-gemini",
      "openai",
      "groq",
      "azure-openai",
      "openai-compatible",
    ]);
    expect(providerKeyRegistry).not.toHaveProperty("ollama");
  });

  it("describes single-key and multi-field providers", () => {
    expect(providerKeyRegistry["google-gemini"]).toMatchObject({ storageFormat: "raw-api-key", checkMode: "live" });
    expect(providerKeyRegistry["azure-openai"].credentialFields.map((field) => field.id)).toEqual([
      "apiKey",
      "apiBase",
      "apiVersion",
    ]);
    expect(providerKeyRegistry["openai-compatible"]).toMatchObject({
      storageFormat: "json",
      checkMode: "validation-only",
    });
  });

  it("projects a browser-safe provider catalog without storage or credential values", () => {
    const catalog = getBrowserProviderKeyCatalog();

    expect(catalog.map((provider) => provider.id)).toEqual(supportedProviderIds);
    expect(catalog.find((provider) => provider.id === "openai-compatible")).toMatchObject({
      checkMode: "validation-only",
      credentialFields: [
        { id: "apiKey", required: false, secret: true, inputType: "password" },
        { id: "apiBase", required: true, secret: false, inputType: "url" },
      ],
    });
    expect(JSON.stringify(catalog)).not.toContain("storageFormat");
    expect(JSON.stringify(catalog)).not.toContain("apiBase\":\"https://");
  });

  it("round-trips legacy Gemini strings and JSON multi-field credentials", () => {
    const gemini = { apiKey: "AIzaSy0123456789012345678901234" };
    expect(serializeProviderCredentials("google-gemini", gemini)).toBe(gemini.apiKey);
    expect(deserializeProviderCredentials("google-gemini", gemini.apiKey)).toEqual(gemini);

    const azure = {
      apiKey: "azure-key-012345678901234567890",
      apiBase: "https://kavero.openai.azure.com",
      apiVersion: "2025-04-01-preview",
    };
    expect(deserializeProviderCredentials("azure-openai", serializeProviderCredentials("azure-openai", azure))).toEqual(azure);
  });

  it.each([
    "http://models.example.com/v1",
    "https://localhost:11434/v1",
    "https://127.0.0.1/v1",
    "https://10.0.0.2/v1",
    "https://169.254.169.254/latest",
    "https://user:password@example.com/v1",
  ])("rejects unsafe OpenAI-compatible base URL %s", (apiBase) => {
    expect(parseProviderCredentials("openai-compatible", { apiBase })).toBeNull();
  });
});
