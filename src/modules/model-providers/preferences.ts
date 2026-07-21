import { getDefaultModelAliasForSlot, getModelCatalogEntry } from "./catalog";
import type { ModelCapabilitySlot } from "./types";

export type ModelProviderPreferenceSelection = {
  chatOrchestrationModelAlias: string;
  imageGenerationModelAlias: string;
};

export type ModelProviderPreferenceInput = Partial<ModelProviderPreferenceSelection>;

export type ModelProviderPreferenceValidation =
  | { ok: true }
  | {
      ok: false;
      code: "unknown-alias" | "wrong-slot";
      message: string;
    };

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function slotForPreferenceKey(key: keyof ModelProviderPreferenceSelection): ModelCapabilitySlot {
  return key === "imageGenerationModelAlias" ? "imageGeneration" : "chatOrchestration";
}

export function validateModelAliasForSlot(
  modelAlias: string,
  slot: ModelCapabilitySlot,
): ModelProviderPreferenceValidation {
  const entry = getModelCatalogEntry(modelAlias);

  if (!entry) {
    return {
      ok: false,
      code: "unknown-alias",
      message: "Unknown model alias.",
    };
  }

  if (!(entry.capabilities.slots as readonly ModelCapabilitySlot[]).includes(slot)) {
    return {
      ok: false,
      code: "wrong-slot",
      message: "Model alias does not support the selected capability slot.",
    };
  }

  return { ok: true };
}

export function getResolvedModelProviderPreferences(
  preferences: unknown,
): ModelProviderPreferenceSelection {
  const modelProviders = isRecord(preferences) && isRecord(preferences.modelProviders)
    ? preferences.modelProviders
    : {};

  const chatAlias =
    stringValue(modelProviders.chatOrchestrationModelAlias) ??
    getDefaultModelAliasForSlot("chatOrchestration");
  const imageAlias =
    stringValue(modelProviders.imageGenerationModelAlias) ??
    getDefaultModelAliasForSlot("imageGeneration");

  return {
    chatOrchestrationModelAlias:
      validateModelAliasForSlot(chatAlias, "chatOrchestration").ok
        ? chatAlias
        : getDefaultModelAliasForSlot("chatOrchestration"),
    imageGenerationModelAlias:
      validateModelAliasForSlot(imageAlias, "imageGeneration").ok
        ? imageAlias
        : getDefaultModelAliasForSlot("imageGeneration"),
  };
}

export function mergeModelProviderPreferences(
  currentPreferences: unknown,
  input: ModelProviderPreferenceInput,
) {
  const current = isRecord(currentPreferences) ? currentPreferences : {};
  const currentModelProviders = isRecord(current.modelProviders) ? current.modelProviders : {};
  const resolved = getResolvedModelProviderPreferences(current);
  const nextSelection: ModelProviderPreferenceSelection = {
    chatOrchestrationModelAlias:
      input.chatOrchestrationModelAlias?.trim() || resolved.chatOrchestrationModelAlias,
    imageGenerationModelAlias:
      input.imageGenerationModelAlias?.trim() || resolved.imageGenerationModelAlias,
  };

  for (const key of Object.keys(nextSelection) as Array<keyof ModelProviderPreferenceSelection>) {
    const validation = validateModelAliasForSlot(nextSelection[key], slotForPreferenceKey(key));
    if (!validation.ok) return validation;
  }

  return {
    ok: true as const,
    selection: nextSelection,
    preferences: {
      ...current,
      modelProviders: {
        ...currentModelProviders,
        ...nextSelection,
      },
    },
  };
}
