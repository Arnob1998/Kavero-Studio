import type { GatewayConfigIssue, ModelGatewayConfig, ModelGatewayErrorCode } from "./types";

export type SafeGatewayIssue = {
  code: string;
  message: string;
};

export type SafeGatewayStatus =
  | {
      status: "disabled";
      gateway: null;
      configured: false;
      issues: readonly SafeGatewayIssue[];
    }
  | {
      status: "configured";
      gateway: "litellm";
      configured: true;
      issues: readonly SafeGatewayIssue[];
    }
  | {
      status: "error";
      gateway: "litellm" | null;
      configured: false;
      issues: readonly SafeGatewayIssue[];
    };

export type ModelProviderConnectivityResult = {
  status: "disabled" | "configured" | "error";
  gateway: "litellm" | null;
  configured: boolean;
  checkedAt: string;
  checkedBy: "configuration" | "model-info" | "model-list";
  issues: readonly SafeGatewayIssue[];
};

const configIssueMessages: Record<GatewayConfigIssue["code"], string> = {
  "unsupported-gateway": "Unsupported model gateway.",
  "missing-base-url": "Model gateway URL is missing.",
  "invalid-base-url": "Model gateway URL is invalid.",
  "missing-api-key": "Model gateway credential is missing.",
  "public-env-exposure": "Model gateway values must stay server-only.",
};

const connectivityIssueMessages: Record<ModelGatewayErrorCode, string> = {
  authentication_error: "Model gateway authentication failed.",
  configuration_error: "Model gateway configuration failed.",
  invalid_response: "Model gateway returned an invalid response.",
  network_error: "Model gateway could not be reached.",
  provider_error: "Model gateway check failed.",
  rate_limited: "Model gateway check was rate limited.",
};

function safeConfigIssues(issues: readonly GatewayConfigIssue[]): readonly SafeGatewayIssue[] {
  return issues.map((issue) => ({
    code: issue.code,
    message: configIssueMessages[issue.code],
  }));
}

export function getSafeGatewayStatus(config: ModelGatewayConfig): SafeGatewayStatus {
  if (config.status === "disabled") {
    return {
      status: "disabled",
      gateway: null,
      configured: false,
      issues: [{ code: config.reason, message: "Model gateway is not configured." }],
    };
  }

  if (config.status === "error") {
    return {
      status: "error",
      gateway: config.gateway,
      configured: false,
      issues: safeConfigIssues(config.issues),
    };
  }

  return {
    status: "configured",
    gateway: "litellm",
    configured: true,
    issues: [],
  };
}

export function getConfigurationConnectivityResult(
  config: ModelGatewayConfig,
  checkedAt = new Date().toISOString(),
): ModelProviderConnectivityResult | null {
  const safeStatus = getSafeGatewayStatus(config);
  if (safeStatus.status === "configured") return null;

  return {
    ...safeStatus,
    checkedAt,
    checkedBy: "configuration",
  };
}

export function getSuccessfulConnectivityResult(
  checkedBy: "model-info" | "model-list",
  checkedAt = new Date().toISOString(),
): ModelProviderConnectivityResult {
  return {
    status: "configured",
    gateway: "litellm",
    configured: true,
    checkedAt,
    checkedBy,
    issues: [],
  };
}

export function getFailedConnectivityResult(
  errorCode: ModelGatewayErrorCode,
  checkedAt = new Date().toISOString(),
): ModelProviderConnectivityResult {
  return {
    status: "error",
    gateway: "litellm",
    configured: true,
    checkedAt,
    checkedBy: "configuration",
    issues: [
      {
        code: errorCode,
        message: connectivityIssueMessages[errorCode],
      },
    ],
  };
}
