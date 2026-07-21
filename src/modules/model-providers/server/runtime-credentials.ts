import type { ModelGatewayCredentialSource } from "../types";
import {
  resolveModelCredentials,
  type FailedCredentialResolution,
  type ModelCredentialResolution,
} from "./credential-routing";
import {
  injectServerLiteLlmCredentials,
  sanitizeLiteLlmRequestBody,
} from "./litellm-credentials";
import { buildAzureOpenAiImageLiteLlmRequest, buildAzureOpenAiLiteLlmRequest } from "./azure-routing";

export type ResolvedModelCredentials = Extract<ModelCredentialResolution, { ok: true }>;

export function getResolvedChatPolicyModel(
  resolution: ResolvedModelCredentials,
  fallbackModel: string | null | undefined,
) {
  if (resolution.providerKeyId === "azure-openai" && resolution.credentials && "baseModel" in resolution.credentials) {
    return resolution.credentials.baseModel;
  }
  return fallbackModel ?? resolution.modelAlias;
}

export type RuntimeCredentialFailure =
  | FailedCredentialResolution
  | {
      ok: false;
      status: "error";
      code: "invalid-provider-credentials";
    };

export async function resolveChatOrchestrationRuntimeCredentials({
  userId,
  modelAlias,
}: {
  userId: string;
  modelAlias: string;
}): Promise<ModelCredentialResolution> {
  return resolveModelCredentials({
    userId,
    modelAlias,
    slot: "chatOrchestration",
  });
}

export async function resolveImageGenerationRuntimeCredentials({
  userId,
  modelAlias,
}: {
  userId: string;
  modelAlias: string;
}): Promise<ModelCredentialResolution> {
  return resolveModelCredentials({
    userId,
    modelAlias,
    slot: "imageGeneration",
  });
}

export function prepareLiteLlmRuntimeRequest(
  body: Record<string, unknown>,
  resolution: ResolvedModelCredentials,
):
  | {
      ok: true;
      body: Record<string, unknown>;
      credentialSource: Extract<ModelGatewayCredentialSource, "user-byok" | "gateway-env">;
      monitoringModel: string | null;
    }
  | RuntimeCredentialFailure {
  if (resolution.providerKeyId === "azure-openai") {
    const azure = buildAzureOpenAiLiteLlmRequest(body, resolution.credentials);
    if (!azure) {
      return { ok: false, status: "error", code: "invalid-provider-credentials" };
    }

    return {
      ok: true,
      body: azure.body,
      credentialSource: resolution.credentialSource,
      monitoringModel: azure.monitoringModel,
    };
  }

  if (resolution.providerKeyId === "azure-openai-image") {
    const azure = buildAzureOpenAiImageLiteLlmRequest(body, resolution.credentials);
    if (!azure) {
      return { ok: false, status: "error", code: "invalid-provider-credentials" };
    }

    return {
      ok: true,
      body: azure.body,
      credentialSource: resolution.credentialSource,
      monitoringModel: azure.monitoringModel,
    };
  }

  if (resolution.credentialSource === "gateway-env") {
    return {
      ok: true,
      body: sanitizeLiteLlmRequestBody(body),
      credentialSource: resolution.credentialSource,
      monitoringModel: null,
    };
  }

  if (!resolution.providerKeyId) {
    return { ok: false, status: "error", code: "invalid-provider-credentials" };
  }

  const injected = injectServerLiteLlmCredentials(
    body,
    resolution.providerKeyId,
    resolution.credentials,
  );
  if (!injected.ok) {
    return { ok: false, status: "error", code: "invalid-provider-credentials" };
  }

  return {
    ok: true,
    body: injected.body,
    credentialSource: resolution.credentialSource,
    monitoringModel: null,
  };
}

export function prepareLiteLlmImageRuntimeRequest(
  resolution: ResolvedModelCredentials,
):
  | {
      ok: true;
      credentialSource: Extract<ModelGatewayCredentialSource, "user-byok" | "gateway-env">;
      transformRequestBody: (body: Record<string, unknown>) => Record<string, unknown>;
      monitoringModel: string | null;
    }
  | RuntimeCredentialFailure {
  const prepared = prepareLiteLlmRuntimeRequest({}, resolution);
  if (prepared.ok === false) return prepared;

  const trustedCredentialParams = prepared.body;
  return {
    ok: true,
    credentialSource: prepared.credentialSource,
    monitoringModel: prepared.monitoringModel,
    transformRequestBody: (body) => ({
      ...sanitizeLiteLlmRequestBody(body),
      ...trustedCredentialParams,
    }),
  };
}

export function createSafeRuntimeCredentialFailureResponse(
  featureLabel: string,
  failure: RuntimeCredentialFailure,
): Response {
  if (failure.code === "credential-load-failed") {
    return Response.json(
      {
        error: `Unable to load ${featureLabel} provider credentials.`,
        details: { code: "provider-credentials-unavailable" },
      },
      { status: 500 },
    );
  }

  if (failure.code === "unknown-alias" || failure.code === "wrong-slot") {
    return Response.json(
      {
        error: `${featureLabel} model gateway is not configured correctly.`,
        details: { code: "model-gateway-configuration" },
      },
      { status: 503 },
    );
  }

  return Response.json(
    {
      error: `${featureLabel} requires provider credentials for the selected model. Add them in Settings and try again.`,
      details: { code: "provider-credentials-required" },
    },
    { status: 403 },
  );
}
