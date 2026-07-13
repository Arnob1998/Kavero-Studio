import type { GatewayConfigIssue, ModelGatewayConfig } from "./types";

export type ModelGatewayEnv = {
  KAVERO_MODEL_GATEWAY?: string | undefined;
  KAVERO_LITELLM_BASE_URL?: string | undefined;
  KAVERO_LITELLM_API_KEY?: string | undefined;
  KAVERO_LITELLM_ROUTING_SECRET?: string | undefined;
  [key: string]: string | undefined;
};

const publicEnvToken = "NEXT_" + "PUBLIC";
const liteLlmEnvToken = "LITE" + "LLM";

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function hasPublicLiteLlmExposure(key: string) {
  const upperKey = key.toUpperCase();
  return upperKey.includes(publicEnvToken) && upperKey.includes(liteLlmEnvToken);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidRoutingSecret(value: string) {
  return value.length >= 43 && /^[A-Za-z0-9_-]+$/.test(value);
}

function issue(code: GatewayConfigIssue["code"], message: string, key?: string): GatewayConfigIssue {
  return key ? { code, key, message } : { code, message };
}

export function getModelGatewayConfig(
  env: ModelGatewayEnv = process.env as ModelGatewayEnv,
): ModelGatewayConfig {
  const publicExposureKeys = Object.keys(env).filter(hasPublicLiteLlmExposure);
  if (publicExposureKeys.length > 0) {
    return {
      status: "error",
      gateway: null,
      issues: publicExposureKeys.map((key) =>
        issue("public-env-exposure", "LiteLLM gateway values must stay server-only.", key),
      ),
    };
  }

  const rawGateway = env.KAVERO_MODEL_GATEWAY?.trim();
  if (!rawGateway) {
    return {
      status: "disabled",
      gateway: null,
      reason: "not-configured",
    };
  }

  if (rawGateway !== "litellm") {
    return {
      status: "error",
      gateway: null,
      issues: [
        issue("unsupported-gateway", "Unsupported model gateway.", "KAVERO_MODEL_GATEWAY"),
      ],
    };
  }

  const issues: GatewayConfigIssue[] = [];
  const baseUrl = env.KAVERO_LITELLM_BASE_URL?.trim();
  const apiKey = env.KAVERO_LITELLM_API_KEY?.trim();
  const routingSecret = env.KAVERO_LITELLM_ROUTING_SECRET?.trim();

  if (!hasValue(baseUrl)) {
    issues.push(issue("missing-base-url", "LiteLLM base URL is required.", "KAVERO_LITELLM_BASE_URL"));
  } else if (!isHttpUrl(baseUrl)) {
    issues.push(issue("invalid-base-url", "LiteLLM base URL must be an http(s) URL.", "KAVERO_LITELLM_BASE_URL"));
  }

  if (!hasValue(apiKey)) {
    issues.push(issue("missing-api-key", "LiteLLM API key is required.", "KAVERO_LITELLM_API_KEY"));
  }

  if (!hasValue(routingSecret)) {
    issues.push(
      issue(
        "missing-routing-secret",
        "LiteLLM routing secret is required.",
        "KAVERO_LITELLM_ROUTING_SECRET",
      ),
    );
  } else if (!isValidRoutingSecret(routingSecret)) {
    issues.push(
      issue(
        "invalid-routing-secret",
        "LiteLLM routing secret must be a base64url secret of at least 43 characters.",
        "KAVERO_LITELLM_ROUTING_SECRET",
      ),
    );
  }

  if (issues.length > 0) {
    return {
      status: "error",
      gateway: "litellm",
      issues,
    };
  }

  const configuredBaseUrl = baseUrl as string;
  const configuredApiKey = apiKey as string;
  const configuredRoutingSecret = routingSecret as string;

  return {
    status: "configured",
    gateway: "litellm",
    baseUrl: configuredBaseUrl,
    apiKey: configuredApiKey,
    routingSecret: configuredRoutingSecret,
  };
}

export function getLoggableGatewayConfigResult(result: ModelGatewayConfig) {
  if (result.status !== "configured") return result;
  return {
    status: result.status,
    gateway: result.gateway,
    baseUrl: result.baseUrl,
    apiKey: "[redacted]",
    routingSecret: "[redacted]",
  } as const;
}
