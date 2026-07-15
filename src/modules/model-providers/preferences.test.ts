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
