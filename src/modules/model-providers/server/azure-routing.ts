import {
  parseProviderCredentials,
  type AzureOpenAiBaseModel,
  type ProviderCredentialsMap,
} from "@/lib/provider-key-registry";
import { AZURE_OPENAI_CHAT_MODEL_ALIAS } from "../catalog";
import { sanitizeLiteLlmRequestBody } from "./litellm-credentials";

export type AzureOpenAiEnv = {
  AZURE_API_KEY?: string;
  AZURE_API_BASE?: string;
  AZURE_API_VERSION?: string;
  AZURE_DEPLOYMENT_NAME?: string;
  AZURE_BASE_MODEL?: string;
};

export function getAzureOpenAiEnvCredentials(
  env: AzureOpenAiEnv = process.env as AzureOpenAiEnv,
): ProviderCredentialsMap["azure-openai"] | null {
  return parseProviderCredentials("azure-openai", {
    apiKey: env.AZURE_API_KEY,
    apiBase: env.AZURE_API_BASE,
    apiVersion: env.AZURE_API_VERSION,
    deploymentName: env.AZURE_DEPLOYMENT_NAME,
    baseModel: env.AZURE_BASE_MODEL,
  });
}

export function getAzureOpenAiRoute(
  baseModel: AzureOpenAiBaseModel,
  deploymentName: string,
) {
  return baseModel === "gpt-5"
    ? `azure/gpt5_series/${deploymentName}`
    : `azure/${deploymentName}`;
}

export function buildAzureOpenAiLiteLlmRequest(
  body: Record<string, unknown>,
  credentials: unknown,
) {
  const parsed = parseProviderCredentials("azure-openai", credentials);
  if (!parsed) return null;

  return {
    body: {
      ...sanitizeLiteLlmRequestBody(body),
      model: AZURE_OPENAI_CHAT_MODEL_ALIAS,
      user_config: {
        model_list: [
          {
            model_name: AZURE_OPENAI_CHAT_MODEL_ALIAS,
            litellm_params: {
              model: getAzureOpenAiRoute(parsed.baseModel, parsed.deploymentName),
              api_key: parsed.apiKey,
              api_base: parsed.apiBase,
              api_version: parsed.apiVersion,
            },
          },
        ],
      },
    },
    monitoringModel: parsed.baseModel,
  };
}
