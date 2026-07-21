import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
  DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
} from "./catalog";
import {
  getResolvedModelProviderPreferences,
  mergeModelProviderPreferences,
  validateModelAliasForSlot,
} from "./preferences";
import { AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS, OPENAI_GPT_IMAGE_2_MODEL_ALIAS } from "./image-capabilities";

describe("model provider preferences", () => {
  it("returns safe defaults when preferences are missing or invalid", () => {
    expect(getResolvedModelProviderPreferences(null)).toEqual({
      chatOrchestrationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
      imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
    });

    expect(
      getResolvedModelProviderPreferences({
        modelProviders: {
          chatOrchestrationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
          imageGenerationModelAlias: "missing",
        },
      }),
    ).toEqual({
      chatOrchestrationModelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
      imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
    });
  });

  it("preserves other preferences while saving resolved aliases", () => {
    const result = mergeModelProviderPreferences(
      {
        theme: "dark",
        modelProviders: {
          collapsed: true,
          chatOrchestrationModelAlias: "kavero-chat-openai-gpt-5-6",
        },
      },
      {
        imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      selection: {
        chatOrchestrationModelAlias: "kavero-chat-openai-gpt-5-6",
        imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      },
      preferences: {
        theme: "dark",
        modelProviders: {
          collapsed: true,
          chatOrchestrationModelAlias: "kavero-chat-openai-gpt-5-6",
          imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
        },
      },
    });
  });

  it.each([
    "kavero-chat-orchestration-default",
    "kavero-chat-openai-gpt-5-6",
    "kavero-chat-azure-openai",
  ])("changes the image slot to GPT Image 2 without rewriting the %s orchestration slot", (chatAlias) => {
    const result = mergeModelProviderPreferences(
      { modelProviders: { chatOrchestrationModelAlias: chatAlias } },
      { imageGenerationModelAlias: OPENAI_GPT_IMAGE_2_MODEL_ALIAS },
    );

    expect(result).toMatchObject({
      ok: true,
      selection: {
        chatOrchestrationModelAlias: chatAlias,
        imageGenerationModelAlias: OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
      },
    });
  });

  it("changes orchestration without rewriting a Gemini image selection", () => {
    const result = mergeModelProviderPreferences(
      { modelProviders: { imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS } },
      { chatOrchestrationModelAlias: "kavero-chat-azure-openai" },
    );

    expect(result).toMatchObject({
      ok: true,
      selection: {
        chatOrchestrationModelAlias: "kavero-chat-azure-openai",
        imageGenerationModelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
      },
    });
  });

  it.each([
    "kavero-chat-orchestration-default",
    "kavero-chat-openai-gpt-5-6",
    "kavero-chat-azure-openai",
  ])("selects Azure image generation without rewriting the %s orchestration slot", (chatAlias) => {
    const result = mergeModelProviderPreferences(
      { modelProviders: { chatOrchestrationModelAlias: chatAlias } },
      { imageGenerationModelAlias: AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS },
    );
    expect(result).toMatchObject({
      ok: true,
      selection: {
        chatOrchestrationModelAlias: chatAlias,
        imageGenerationModelAlias: AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
      },
    });
  });

  it("changes orchestration while preserving Azure image generation", () => {
    const result = mergeModelProviderPreferences(
      { modelProviders: { imageGenerationModelAlias: AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS } },
      { chatOrchestrationModelAlias: "kavero-chat-openai-gpt-5-6" },
    );
    expect(result).toMatchObject({
      ok: true,
      selection: {
        chatOrchestrationModelAlias: "kavero-chat-openai-gpt-5-6",
        imageGenerationModelAlias: AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
      },
    });
  });

  it("rejects unknown aliases and aliases assigned to the wrong slot", () => {
    expect(validateModelAliasForSlot("missing", "chatOrchestration")).toMatchObject({
      ok: false,
      code: "unknown-alias",
    });
    expect(
      validateModelAliasForSlot(DEFAULT_IMAGE_GENERATION_MODEL_ALIAS, "chatOrchestration"),
    ).toMatchObject({
      ok: false,
      code: "wrong-slot",
    });
    expect(
      validateModelAliasForSlot(DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS, "imageGeneration"),
    ).toMatchObject({
      ok: false,
      code: "wrong-slot",
    });
  });
});
