import { describe, expect, it } from "vitest";
import {
  AZURE_OPENAI_CHAT_MODEL_ALIAS,
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
  OPENAI_GPT_5_6_MODEL_ALIASES,
  getDefaultModelAliasForSlot,
  getModelCatalogEntry,
  getModelsForCapability,
  modelCatalog,
} from "./catalog";
import { AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS, GEMINI_2_5_FLASH_IMAGE_MODEL_ALIAS, GEMINI_PRO_IMAGE_MODEL_ALIAS, OPENAI_GPT_IMAGE_2_MODEL_ALIAS } from "./image-capabilities";

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
    expect(chatModels).toContain(AZURE_OPENAI_CHAT_MODEL_ALIAS);
    expect(chatModels).not.toContain(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS);
    expect(imageModels).toEqual([
      DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      GEMINI_PRO_IMAGE_MODEL_ALIAS,
      GEMINI_2_5_FLASH_IMAGE_MODEL_ALIAS,
      OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
      AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
    ]);
    expect(imageModels).not.toContain(AZURE_OPENAI_CHAT_MODEL_ALIAS);
    expect(modelCatalog.find((entry) => entry.provider === "groq")?.capabilities.supportsImageOutput).toBe(false);
    expect(modelCatalog.find((entry) => entry.provider === "ollama")?.capabilities.requirements).toContain("local-runtime");
  });

  it("exposes the current OpenAI GPT-5.6 family without changing defaults", () => {
    expect(Object.values(OPENAI_GPT_5_6_MODEL_ALIASES)).toEqual([
      "kavero-chat-openai-gpt-5-6",
      "kavero-chat-openai-gpt-5-6-sol",
      "kavero-chat-openai-gpt-5-6-terra",
      "kavero-chat-openai-gpt-5-6-luna",
    ]);
    expect(Object.entries(OPENAI_GPT_5_6_MODEL_ALIASES).map(([, modelAlias]) =>
      getModelCatalogEntry(modelAlias),
    )).toEqual([
      expect.objectContaining({ provider: "openai", model: "gpt-5.6" }),
      expect.objectContaining({ provider: "openai", model: "gpt-5.6-sol" }),
      expect.objectContaining({ provider: "openai", model: "gpt-5.6-terra" }),
      expect.objectContaining({ provider: "openai", model: "gpt-5.6-luna" }),
    ]);
    for (const modelAlias of Object.values(OPENAI_GPT_5_6_MODEL_ALIASES)) {
      expect(getModelCatalogEntry(modelAlias)?.capabilities).toMatchObject({
        slots: ["chatOrchestration"],
        supportsTools: true,
        supportsStructuredJson: true,
        supportsMultimodalImageInput: true,
        supportsImageOutput: false,
      });
    }
  });
});
