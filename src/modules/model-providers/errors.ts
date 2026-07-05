import type { ModelProviderId } from "./types";
import { ModelGatewayError, type ModelGatewayErrorCode, type ModelGatewayErrorDetails } from "./types";

type ErrorContext = {
  status?: number | null;
  provider?: ModelProviderId | null;
  model?: string | null;
  modelAlias?: string | null;
  requestId?: string | null;
  callId?: string | null;
};

function codeForStatus(status: number | null): ModelGatewayErrorCode {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 429) return "rate_limited";
  if (status && status >= 500) return "provider_error";
  return "invalid_response";
}

export function createModelGatewayError(
  message: string,
  context: ErrorContext = {},
  code?: ModelGatewayErrorCode,
): ModelGatewayError {
  const status = context.status ?? null;
  const errorCode = code ?? codeForStatus(status);
  const retryable = errorCode === "network_error" || errorCode === "rate_limited" || (status ?? 0) >= 500;
  const details: ModelGatewayErrorDetails = {
    status,
    errorCode,
    message,
    provider: context.provider ?? null,
    model: context.model ?? null,
    modelAlias: context.modelAlias ?? null,
    gateway: "litellm",
    requestId: context.requestId ?? null,
    callId: context.callId ?? null,
    retryable,
  };

  return new ModelGatewayError(details);
}

export function createNetworkModelGatewayError(error: unknown, context: ErrorContext = {}) {
  const message = error instanceof Error ? error.message : "Model gateway request failed.";
  return createModelGatewayError(message, context, "network_error");
}

export async function createHttpModelGatewayError(response: Response, context: ErrorContext = {}) {
  return createModelGatewayError(
    `LiteLLM request failed with status ${response.status}.`,
    { ...context, status: response.status },
  );
}

export function toLoggableModelGatewayError(error: unknown): ModelGatewayErrorDetails {
  if (error instanceof ModelGatewayError) return error.details;

  return {
    status: null,
    errorCode: "provider_error",
    message: error instanceof Error ? error.message : "Unknown model gateway error.",
    provider: null,
    model: null,
    modelAlias: null,
    gateway: "litellm",
    requestId: null,
    callId: null,
    retryable: false,
  };
}
