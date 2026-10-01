import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
} from "./catalog";
import { getBrowserModelCatalog } from "./browser-catalog";

describe("browser model catalog", () => {
  it("returns curated browser-safe catalog entries without gateway details", () => {
    const catalog = getBrowserModelCatalog();

    expect(catalog.map((entry) => entry.modelAlias)).toEqual(
      expect.arrayContaining([
        DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
        DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      ]),
    );
    expect(catalog[0]).toMatchObject({
      providerLabel: expect.any(String),
      providerLogoPath: expect.stringMatching(/^\/llm-providers\//),
      providerKeyId: "google-gemini",
      modelAlias: expect.any(String),
      displayLabel: expect.any(String),
      capabilities: {
        slots: expect.any(Array),
      },
    });
    expect(JSON.stringify(catalog)).not.toContain("sk-");
    expect(JSON.stringify(catalog)).not.toContain("KAVERO_LITELLM");
    expect(JSON.stringify(catalog)).not.toContain("http://litellm");
    expect(catalog.find((entry) => entry.provider === "openai")?.providerKeyId).toBe("openai");
    expect(catalog.find((entry) => entry.provider === "groq")?.providerKeyId).toBe("groq");
    expect(catalog.find((entry) => entry.provider === "ollama")?.providerKeyId).toBeNull();
  });

  it("exposes bounded sequence-planner metadata and fails unverified models closed", () => {
    const catalog = getBrowserModelCatalog();
    const gemini = catalog.find((entry) => entry.modelAlias === DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS);
    const openai = catalog.find((entry) => entry.modelAlias === "kavero-chat-openai-gpt-5-6");

    expect(gemini?.capabilities.sequencePlanner).toMatchObject({
      eligible: true,
      eligibility: "verified",
      supportsSchemaConstrainedOutput: true,
      imageInput: {
        eligible: true,
        maximumImages: { source: "application-cap", value: 8 },
        maximumBytesPerImage: { source: "application-cap", value: 10 * 1024 * 1024 },
        maximumTotalBytes: { source: "application-cap", value: 32 * 1024 * 1024 },
      },
    });
    expect(openai?.capabilities.sequencePlanner).toMatchObject({
      eligible: false,
      eligibility: "not-verified",
      imageInput: { maximumImages: { source: "unknown", value: null } },
    });
  });
});
