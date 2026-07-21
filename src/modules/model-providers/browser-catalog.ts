import { modelCatalog } from "./catalog";
import { getProviderKeyIdForModelProvider } from "./provider-key-mapping";
import type { SupportedProviderId } from "@/lib/provider-key-registry";
import type { ModelCatalogEntry, ModelCapabilitySlot, ModelProviderId } from "./types";
import { AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS } from "./image-capabilities";
import type { ChatControlCapabilities } from "./chat-request-policy";

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
  "azure-openai": {
    label: "Azure OpenAI",
    logoPath: "/llm-providers/Microsoft_Azure.svg",
  },
};

export type BrowserModelCatalogEntry = {
  provider: ModelProviderId;
  providerLabel: string;
  providerLogoPath: string;
  providerKeyId: SupportedProviderId | null;
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
    chatControls?: ChatControlCapabilities;
  };
};

export function toBrowserModelCatalogEntry(entry: ModelCatalogEntry): BrowserModelCatalogEntry {
  const provider = providerDisplay[entry.provider];

  return {
    provider: entry.provider,
    providerLabel: provider.label,
    providerLogoPath: provider.logoPath,
    providerKeyId: entry.modelAlias === AZURE_OPENAI_GPT_IMAGE_2_MODEL_ALIAS
      ? "azure-openai-image"
      : getProviderKeyIdForModelProvider(entry.provider),
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
