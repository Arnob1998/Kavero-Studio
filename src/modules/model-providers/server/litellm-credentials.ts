import {
  parseProviderCredentials,
  type ProviderCredentialsMap,
  type SupportedProviderId,
} from "@/lib/provider-key-registry";

const reservedCredentialParams = new Set([
  "api_key",
  "api_base",
  "base_url",
  "api_version",
  "user_config",
]);

export type LiteLlmCredentialParams = {
  api_key?: string;
  api_base?: string;
  api_version?: string;
};

export type LiteLlmCredentialParamsResult =
  | { ok: true; params: LiteLlmCredentialParams }
  | {
      ok: false;
      error: {
        code: "invalid-provider-credentials";
        providerId: SupportedProviderId;
        message: string;
      };
    };

export type LiteLlmCredentialInjectionResult =
  | { ok: true; params: LiteLlmCredentialParams; body: Record<string, unknown> }
  | Extract<LiteLlmCredentialParamsResult, { ok: false }>;

export function buildLiteLlmCredentialParams<T extends SupportedProviderId>(
  providerId: T,
  credentials: unknown,
): LiteLlmCredentialParamsResult {
  const validated = parseProviderCredentials(providerId, credentials);
  if (!validated) {
    return {
      ok: false,
      error: {
        code: "invalid-provider-credentials",
        providerId,
        message: "Provider credentials are invalid.",
      },
    };
  }

  return { ok: true, params: paramsForProvider(providerId, validated) };
}

export function injectServerLiteLlmCredentials<T extends SupportedProviderId>(
  body: Record<string, unknown>,
  providerId: T,
  credentials: unknown,
): LiteLlmCredentialInjectionResult {
  const result = buildLiteLlmCredentialParams(providerId, credentials);
  if (!result.ok) return result;

  return {
    ...result,
    body: {
      ...sanitizeLiteLlmRequestBody(body),
      ...result.params,
    },
  };
}

export function sanitizeLiteLlmRequestBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(body).filter(([key]) => !reservedCredentialParams.has(key)),
  );
}

function paramsForProvider<T extends SupportedProviderId>(
  providerId: T,
  credentials: ProviderCredentialsMap[T],
): LiteLlmCredentialParams {
  switch (providerId) {
    case "google-gemini":
    case "openai":
    case "groq":
      return { api_key: (credentials as { apiKey: string }).apiKey };
    case "azure-openai":
    case "azure-openai-image": {
      const azure = credentials as ProviderCredentialsMap["azure-openai"] | ProviderCredentialsMap["azure-openai-image"];
      return {
        api_key: azure.apiKey,
        api_base: azure.apiBase,
        api_version: azure.apiVersion,
      };
    }
    case "openai-compatible": {
      const compatible = credentials as ProviderCredentialsMap["openai-compatible"];
      return {
        ...(compatible.apiKey ? { api_key: compatible.apiKey } : {}),
        api_base: compatible.apiBase,
      };
    }
  }
}
