import type { ModelCatalogEntry, ModelCapabilitySlot } from "./types";
import {
  AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
  GEMINI_2_5_FLASH_IMAGE_MODEL_ALIAS,
  GEMINI_PRO_IMAGE_MODEL_ALIAS,
  OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
} from "./image-capabilities";

export const DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS = "kavero-chat-orchestration-default";
export const DEFAULT_IMAGE_GENERATION_MODEL_ALIAS = "kavero-image-generation-default";
export const AZURE_OPENAI_CHAT_MODEL_ALIAS = "kavero-chat-azure-openai";
export const OPENAI_GPT_5_6_MODEL_ALIASES = {
  alias: "kavero-chat-openai-gpt-5-6",
  sol: "kavero-chat-openai-gpt-5-6-sol",
  terra: "kavero-chat-openai-gpt-5-6-terra",
  luna: "kavero-chat-openai-gpt-5-6-luna",
} as const;

export const modelCatalog = [
  {
    provider: "gemini",
    model: "gemini/gemini-3.1-pro-preview",
    modelAlias: DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS,
    displayLabel: "Gemini 3.1 Pro Preview",
    capabilities: {
      slots: ["chatOrchestration"],
      supportsTools: true,
      supportsStructuredJson: true,
      supportsMultimodalImageInput: true,
      supportsImageOutput: false,
      supportsStreaming: true,
      requirements: ["provider-key"],
    },
  },
  {
    provider: "gemini",
    model: "gemini/gemini-3.1-flash-image-preview",
    modelAlias: DEFAULT_IMAGE_GENERATION_MODEL_ALIAS,
    displayLabel: "Nano Banana 2",
    capabilities: {
      slots: ["imageGeneration"],
      supportsTools: false,
      supportsStructuredJson: false,
      supportsMultimodalImageInput: true,
      supportsImageOutput: true,
      supportsStreaming: false,
      requirements: ["provider-key"],
    },
  },
  {
    provider: "gemini",
    model: "gemini/gemini-3-pro-image-preview",
    modelAlias: GEMINI_PRO_IMAGE_MODEL_ALIAS,
    displayLabel: "Nano Banana Pro",
    capabilities: {
      slots: ["imageGeneration"],
      supportsTools: false,
      supportsStructuredJson: false,
      supportsMultimodalImageInput: true,
      supportsImageOutput: true,
      supportsStreaming: false,
      requirements: ["provider-key"],
    },
  },
  {
    provider: "gemini",
    model: "gemini/gemini-2.5-flash-image",
    modelAlias: GEMINI_2_5_FLASH_IMAGE_MODEL_ALIAS,
    displayLabel: "Nano Banana",
    capabilities: {
      slots: ["imageGeneration"],
      supportsTools: false,
      supportsStructuredJson: false,
      supportsMultimodalImageInput: true,
      supportsImageOutput: true,
      supportsStreaming: false,
      requirements: ["provider-key"],
    },
  },
  ...([
    ["gpt-5.6", OPENAI_GPT_5_6_MODEL_ALIASES.alias, "GPT-5.6"],
    ["gpt-5.6-sol", OPENAI_GPT_5_6_MODEL_ALIASES.sol, "GPT-5.6 Sol"],
    ["gpt-5.6-terra", OPENAI_GPT_5_6_MODEL_ALIASES.terra, "GPT-5.6 Terra"],
    ["gpt-5.6-luna", OPENAI_GPT_5_6_MODEL_ALIASES.luna, "GPT-5.6 Luna"],
  ] as const).map(([model, modelAlias, displayLabel]) => ({
    provider: "openai" as const,
    model,
    modelAlias,
    displayLabel,
    capabilities: {
      slots: ["chatOrchestration"] as const,
      supportsTools: true,
      supportsStructuredJson: true,
      supportsMultimodalImageInput: true,
      supportsImageOutput: false,
      supportsStreaming: true,
      requirements: ["provider-key"] as const,
    },
  })),
  {
    provider: "groq",
    model: "groq/llama-3.1-8b-instant",
    modelAlias: "kavero-chat-groq-example",
    displayLabel: "Groq Llama 3.1 8B Instant",
    capabilities: {
      slots: ["chatOrchestration"],
      supportsTools: true,
      supportsStructuredJson: true,
      supportsMultimodalImageInput: false,
      supportsImageOutput: false,
      supportsStreaming: true,
      requirements: ["provider-key"],
    },
  },
  {
    provider: "openai",
    model: "gpt-image-2",
    modelAlias: OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
    displayLabel: "GPT Image 2",
    capabilities: {
      slots: ["imageGeneration"],
      supportsTools: false,
      supportsStructuredJson: false,
      supportsMultimodalImageInput: false,
      supportsImageOutput: true,
      supportsStreaming: true,
      requirements: ["provider-key"],
    },
  },
  {
    provider: "azure-openai",
    model: "gpt-image-2",
    modelAlias: AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
    displayLabel: "Azure GPT Image 2",
    capabilities: {
      slots: ["imageGeneration"],
      supportsTools: false,
      supportsStructuredJson: false,
      supportsMultimodalImageInput: false,
      supportsImageOutput: true,
      supportsStreaming: true,
      requirements: ["provider-key"],
    },
  },
  {
    provider: "azure-openai",
    model: "gpt-4o",
    modelAlias: AZURE_OPENAI_CHAT_MODEL_ALIAS,
    displayLabel: "Azure OpenAI deployment",
    capabilities: {
      slots: ["chatOrchestration"],
      supportsTools: true,
      supportsStructuredJson: true,
      supportsMultimodalImageInput: true,
      supportsImageOutput: false,
      supportsStreaming: true,
      requirements: ["provider-key"],
    },
  },
  {
    provider: "ollama",
    model: "ollama_chat/llama3.1",
    modelAlias: "kavero-chat-ollama-example",
    displayLabel: "Ollama Llama 3.1",
    capabilities: {
      slots: ["chatOrchestration"],
      supportsTools: false,
      supportsStructuredJson: true,
      supportsMultimodalImageInput: false,
      supportsImageOutput: false,
      supportsStreaming: true,
      requirements: ["local-runtime"],
    },
  },
] as const satisfies readonly ModelCatalogEntry[];

export type ModelAlias = (typeof modelCatalog)[number]["modelAlias"];

export function getModelCatalogEntry(modelAlias: string): ModelCatalogEntry | null {
  return modelCatalog.find((entry) => entry.modelAlias === modelAlias) ?? null;
}

export function getModelsForCapability(slot: ModelCapabilitySlot): readonly ModelCatalogEntry[] {
  return modelCatalog.filter((entry) =>
    (entry.capabilities.slots as readonly ModelCapabilitySlot[]).includes(slot),
  );
}

export function getDefaultModelAliasForSlot(slot: ModelCapabilitySlot): ModelAlias {
  return slot === "imageGeneration"
    ? DEFAULT_IMAGE_GENERATION_MODEL_ALIAS
    : DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS;
}
