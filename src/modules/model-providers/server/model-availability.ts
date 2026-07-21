import type { SupportedProviderId } from "@/lib/provider-key-registry";
import { getBrowserModelCatalog, type BrowserModelCatalogEntry } from "../browser-catalog";
import type { ModelGatewayConfig } from "../types";
import type { ModelGatewayCredentialMode } from "./credential-mode";
import { getAzureOpenAiEnvCredentials, getAzureOpenAiImageEnvCredentials, type AzureOpenAiEnv } from "./azure-routing";

export type ModelAvailabilitySource = "saved-key" | "admin-environment" | "local-runtime" | null;
export type ModelUnavailableReason = "gateway-unavailable" | "credentials-required" | "runtime-unavailable" | null;

export type AvailableBrowserModelCatalogEntry = BrowserModelCatalogEntry & {
  availability: {
    active: boolean;
    source: ModelAvailabilitySource;
    reason: ModelUnavailableReason;
    message: string | null;
  };
};

type AvailabilityEnv = AzureOpenAiEnv & {
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GROQ_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
};

export function getAvailableBrowserModelCatalog(input: {
  gateway: ModelGatewayConfig;
  credentialMode: ModelGatewayCredentialMode;
  activeProviderKeyIds: ReadonlySet<SupportedProviderId>;
  env?: AvailabilityEnv;
}): AvailableBrowserModelCatalogEntry[] {
  const env = input.env ?? (process.env as AvailabilityEnv);
  return getBrowserModelCatalog().map((model) => ({
    ...model,
    availability: getModelAvailability(model, { ...input, env }),
  }));
}

function getModelAvailability(
  model: BrowserModelCatalogEntry,
  input: {
    gateway: ModelGatewayConfig;
    credentialMode: ModelGatewayCredentialMode;
    activeProviderKeyIds: ReadonlySet<SupportedProviderId>;
    env: AvailabilityEnv;
  },
): AvailableBrowserModelCatalogEntry["availability"] {
  const directGemini = input.gateway.status === "disabled" && model.provider === "gemini";
  if (input.gateway.status !== "configured" && !directGemini) {
    return unavailable("gateway-unavailable", "Configure the model gateway to use this model.");
  }

  if (model.capabilities.requirements.includes("local-runtime")) {
    return hasValue(input.env.OLLAMA_BASE_URL)
      ? active("local-runtime")
      : unavailable("runtime-unavailable", "Start and configure the local model runtime.");
  }

  const saved = Boolean(model.providerKeyId && input.activeProviderKeyIds.has(model.providerKeyId));
  // The disabled-gateway fallback calls Gemini directly with the user's saved key;
  // administrator gateway credentials are not part of that runtime path.
  if (directGemini) {
    return saved
      ? active("saved-key")
      : unavailable("credentials-required", "Add an active Google Gemini key to use this model.");
  }
  if (input.credentialMode !== "env-only" && saved) return active("saved-key");

  const environmentReady = hasEnvironmentCredentials(model, input.env);
  if (input.credentialMode !== "user-required" && environmentReady) return active("admin-environment");

  const providerName = model.providerLabel;
  return unavailable(
    "credentials-required",
    input.credentialMode === "env-only"
      ? `${providerName} administrator credentials are not configured.`
      : `Add an active ${providerName} key to use this model.`,
  );
}

function hasEnvironmentCredentials(model: BrowserModelCatalogEntry, env: AvailabilityEnv) {
  if (model.providerKeyId === "azure-openai") return Boolean(getAzureOpenAiEnvCredentials(env));
  if (model.providerKeyId === "azure-openai-image") return Boolean(getAzureOpenAiImageEnvCredentials(env));
  if (model.provider === "gemini") return hasValue(env.GEMINI_API_KEY);
  if (model.provider === "openai") return hasValue(env.OPENAI_API_KEY);
  if (model.provider === "groq") return hasValue(env.GROQ_API_KEY);
  return false;
}

function hasValue(value: string | undefined) {
  return typeof value === "string" && value.trim().length > 0;
}

function active(source: Exclude<ModelAvailabilitySource, null>) {
  return { active: true, source, reason: null, message: null } as const;
}

function unavailable(reason: Exclude<ModelUnavailableReason, null>, message: string) {
  return { active: false, source: null, reason, message } as const;
}
