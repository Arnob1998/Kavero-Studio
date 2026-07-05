import { modelCatalog } from "./catalog";
import type { ModelCatalogEntry, ModelCapabilitySlot, ModelProviderId } from "./types";

const providerDisplay: Record<ModelProviderId, { label: string; logoPath: string }> = {
  gemini: {
    label: "Google Gemini",
    logoPath: "/llm-providers/google-gemini-icon.png",
  },
  openai: {
    label: "OpenAI",
    logoPath: "/llm-providers/openai.png",
  },
  groq: {
    label: "Groq",
    logoPath: "/llm-providers/grok-icon.png",
  },
  ollama: {
    label: "Ollama",
    logoPath: "/llm-providers/ollama-icon.svg",
  },
};

export type BrowserModelCatalogEntry = {
  provider: ModelProviderId;
  providerLabel: string;
  providerLogoPath: string;
  modelAlias: string;
  displayLabel: string;
  capabilities: {
    slots: readonly ModelCapabilitySlot[];
    supportsTools: boolean;
    supportsStructuredJson: boolean;
    supportsMultimodalImageInput: boolean;
    supportsImageOutput: boolean;
    supportsStreaming: boolean;
    requirements: readonly string[];
  };
};

export function toBrowserModelCatalogEntry(entry: ModelCatalogEntry): BrowserModelCatalogEntry {
  const provider = providerDisplay[entry.provider];

  return {
    provider: entry.provider,
    providerLabel: provider.label,
    providerLogoPath: provider.logoPath,
    modelAlias: entry.modelAlias,
    displayLabel: entry.displayLabel,
    capabilities: {
      slots: entry.capabilities.slots,
      supportsTools: entry.capabilities.supportsTools,
      supportsStructuredJson: entry.capabilities.supportsStructuredJson,
      supportsMultimodalImageInput: entry.capabilities.supportsMultimodalImageInput,
      supportsImageOutput: entry.capabilities.supportsImageOutput,
      supportsStreaming: entry.capabilities.supportsStreaming,
      requirements: entry.capabilities.requirements,
    },
  };
}

export function getBrowserModelCatalog(): readonly BrowserModelCatalogEntry[] {
  return modelCatalog.map(toBrowserModelCatalogEntry);
}
