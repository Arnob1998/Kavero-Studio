import type { SupportedProviderId } from "@/lib/provider-key-registry";
import type { ModelProviderId } from "./types";

const providerKeyIdByModelProvider = {
  gemini: "google-gemini",
  openai: "openai",
  groq: "groq",
  "azure-openai": "azure-openai",
} as const satisfies Partial<Record<ModelProviderId, SupportedProviderId>>;

export function getProviderKeyIdForModelProvider(
  provider: ModelProviderId,
): SupportedProviderId | null {
  return providerKeyIdByModelProvider[provider as keyof typeof providerKeyIdByModelProvider] ?? null;
}
