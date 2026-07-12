import { getCanvasAdmin, jsonError } from "@/lib/canvas/api";
import {
  createModelGatewayEvent,
  getModelCatalogEntry,
  getResolvedModelProviderPreferences,
  isModelGatewayError,
  logModelGatewayEvent,
  type ModelGatewayConfig,
  type ModelGatewayCredentialSource,
  type ModelGatewayUsage,
  type ModelProviderId,
} from "@/modules/model-providers";

type CanvasAdmin = NonNullable<ReturnType<typeof getCanvasAdmin>>;

export type CanvasAiChatModelSelection = {
  modelAlias: string;
  provider: ModelProviderId | null;
  model: string | null;
};

export async function resolveCanvasAiChatModelSelection({
  userId,
  admin,
  featureLabel,
}: {
  userId: string;
  admin?: CanvasAdmin | null;
  featureLabel: string;
}): Promise<{ ok: true; selection: CanvasAiChatModelSelection } | { ok: false; response: Response }> {
  const client = admin ?? getCanvasAdmin();
  if (!client) return { ok: false, response: jsonError(`Unable to load ${featureLabel} model settings.`, 500) };

  const { data, error } = await client
    .from("user_metadata")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle<{ preferences: unknown }>();

  if (error) {
    console.error(`Unable to load ${featureLabel} model preferences`);
    return { ok: false, response: jsonError(`Unable to load ${featureLabel} model settings.`, 500) };
  }

  const modelAlias = getResolvedModelProviderPreferences(data?.preferences ?? {}).chatOrchestrationModelAlias;
  const catalogEntry = getModelCatalogEntry(modelAlias);
  return {
    ok: true,
    selection: {
      modelAlias,
      provider: catalogEntry?.provider ?? null,
      model: catalogEntry?.model ?? null,
    },
  };
}

export function collectLiteLlmAssistantText(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const choices = "choices" in data ? (data as { choices?: unknown }).choices : null;
  if (!Array.isArray(choices)) return "";

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return "";
  const message = "message" in firstChoice ? (firstChoice as { message?: unknown }).message : null;
  if (!message || typeof message !== "object") return "";
  const content = "content" in message ? (message as { content?: unknown }).content : null;

  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = "text" in part ? (part as { text?: unknown }).text : null;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

export function jsonFromText(value: string) {
  const trimmed = value.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export function createSafeGatewayConfigurationResponse(featureLabel: string) {
  return Response.json(
    {
      error: `${featureLabel} model gateway is not configured correctly.`,
      details: { code: "model-gateway-configuration" },
    },
    { status: 503 },
  );
}

export function createSafeGatewayFailureResponse(error: unknown, featureLabel: string) {
  if (!isModelGatewayError(error)) {
    return jsonError(`${featureLabel} failed. Please try again.`, 502);
  }

  const { errorCode, retryable, status } = error.details;
  if (errorCode === "authentication_error") {
    return jsonError(`${featureLabel} gateway was rejected. Check provider setup and try again.`, 403);
  }
  if (errorCode === "rate_limited") {
    return Response.json(
      {
        error: `${featureLabel} model is temporarily busy. Please wait a moment and try again.`,
        details: { retryable: true, upstreamStatus: status },
      },
      { status: 503 },
    );
  }
  if (errorCode === "invalid_response") {
    return jsonError(`${featureLabel} returned an invalid response.`, 502);
  }
  return Response.json(
    {
      error: `${featureLabel} failed. Please try again.`,
      details: { retryable, upstreamStatus: status },
    },
    { status: retryable ? 503 : 502 },
  );
}

export function logCanvasAiGatewayEvent(input: {
  userId: string;
  feature: string;
  selection: CanvasAiChatModelSelection;
  status: "success" | "error";
  startedAt: number;
  requestId?: string | null;
  callId?: string | null;
  usage?: Partial<ModelGatewayUsage> | null;
  errorCode?: string | null;
  credentialSource: ModelGatewayCredentialSource;
}) {
  logModelGatewayEvent(
    createModelGatewayEvent({
      userId: input.userId,
      feature: input.feature,
      provider: input.selection.provider,
      model: input.selection.model,
      modelAlias: input.selection.modelAlias,
      requestId: input.requestId ?? null,
      callId: input.callId ?? null,
      status: input.status,
      latencyMs: Date.now() - input.startedAt,
      usage: input.usage,
      errorCode: input.errorCode ?? null,
      credentialSource: input.credentialSource,
    }),
  );
}

export type ConfiguredGatewayConfig = Extract<ModelGatewayConfig, { status: "configured" }>;
