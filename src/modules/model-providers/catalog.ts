import type { ModelCatalogEntry, ModelCapabilitySlot } from "./types";

export const DEFAULT_CHAT_ORCHESTRATION_MODEL_ALIAS = "kavero-chat-orchestration-default";
export const DEFAULT_IMAGE_GENERATION_MODEL_ALIAS = "kavero-image-generation-default";
export const AZURE_OPENAI_CHAT_MODEL_ALIAS = "kavero-chat-azure-openai";

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
    provider: "openai",
    model: "gpt-4o-mini",
    modelAlias: "kavero-chat-openai-example",
    displayLabel: "OpenAI GPT-4o Mini",
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
