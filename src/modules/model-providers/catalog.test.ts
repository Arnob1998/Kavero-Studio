import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
  getDefaultModelAliasForSlot,
  getModelCatalogEntry,
  getModelsForCapability,
  modelCatalog,
} from "./catalog";

describe("model provider catalog", () => {
  it("keeps separate defaults for orchestration/chat and image generation", () => {
    expect(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS).toBe("kavero-chat-orchestration-default");
    expect(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS).toBe("kavero-image-generation-default");
    expect(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS).not.toBe(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS);
    expect(getDefaultModelAliasForSlot("chatOrchestration")).toBe(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS);
    expect(getDefaultModelAliasForSlot("imageGeneration")).toBe(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS);
  });

  it("maps the baseline aliases to the current Gemini defaults", () => {
    expect(getModelCatalogEntry(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS)).toMatchObject({
      provider: "gemini",
      model: "gemini/gemini-3.1-pro-preview",
      modelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
      capabilities: expect.objectContaining({
        slots: ["chatOrchestration"],
        supportsTools: true,
        supportsStructuredJson: true,
        supportsImageOutput: false,
      }),
    });

    expect(getModelCatalogEntry(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS)).toMatchObject({
      provider: "gemini",
      model: "gemini/gemini-3.1-flash-image-preview",
      modelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      displayLabel: "Nano Banana 2",
      capabilities: expect.objectContaining({
        slots: ["imageGeneration"],
        supportsTools: false,
        supportsImageOutput: true,
      }),
    });
  });

  it("does not infer every provider can serve every slot", () => {
    const chatModels = getModelsForCapability("chatOrchestration").map((entry) => entry.modelAlias);
    const imageModels = getModelsForCapability("imageGeneration").map((entry) => entry.modelAlias);

    expect(chatModels).toContain(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS);
    expect(chatModels).not.toContain(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS);
    expect(imageModels).toEqual([DEFAULT_IMAGE_GENERATION_MODEL_ALIAS]);
    expect(modelCatalog.find((entry) => entry.provider === "groq")?.capabilities.supportsImageOutput).toBe(false);
    expect(modelCatalog.find((entry) => entry.provider === "ollama")?.capabilities.requirements).toContain("local-runtime");
  });
});
