import type {
  ModelGatewayCredentialSource,
  ModelGatewayEvent,
  ModelGatewayUsage,
  ModelProviderId,
} from "./types";
import { emptyModelGatewayUsage } from "./usage";

export type ModelGatewayEventInput = {
  userId?: string | null;
  feature: string;
  slot?: import("./types").ModelCapabilitySlot | null;
  provider?: ModelProviderId | null;
  model?: string | null;
  modelAlias: string;
  requestId?: string | null;
  callId?: string | null;
  status: ModelGatewayEvent["status"];
  latencyMs: number;
  usage?: Partial<ModelGatewayUsage> | null;
  errorCode?: string | null;
  gateway?: ModelGatewayEvent["gateway"];
  credentialSource?: ModelGatewayCredentialSource;
};

export function createModelGatewayEvent(input: ModelGatewayEventInput): ModelGatewayEvent {
  const usage = { ...emptyModelGatewayUsage, ...(input.usage ?? {}) };
  const gateway = input.gateway ?? "litellm";

  return {
    userId: input.userId ?? null,
    feature: input.feature,
    slot: input.slot ?? null,
    provider: input.provider ?? null,
    model: input.model ?? null,
    modelAlias: input.modelAlias,
    requestId: input.requestId ?? null,
    callId: input.callId ?? null,
    status: input.status,
    latencyMs: input.latencyMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    imageCount: usage.imageCount,
    estimatedCost: usage.estimatedCost,
    errorCode: input.errorCode ?? null,
    gateway,
    credentialSource: input.credentialSource ?? defaultCredentialSource(gateway),
  };
}

export function toLoggableModelGatewayEvent(event: ModelGatewayEvent): Record<string, unknown> {
  return {
    type: "model_gateway_event",
    userId: event.userId,
    feature: event.feature,
    slot: event.slot,
    provider: event.provider,
    model: event.model,
    modelAlias: event.modelAlias,
    requestId: event.requestId,
    callId: event.callId,
    status: event.status,
    latencyMs: event.latencyMs,
    inputTokens: event.inputTokens,
    outputTokens: event.outputTokens,
    totalTokens: event.totalTokens,
    imageCount: event.imageCount,
    estimatedCost: event.estimatedCost,
    errorCode: event.errorCode,
    gateway: event.gateway,
    credentialSource: event.credentialSource,
  };
}

function defaultCredentialSource(
  gateway: ModelGatewayEvent["gateway"],
): ModelGatewayCredentialSource {
  if (gateway === "direct-gemini") return "direct-gemini";
  if (gateway === "mock") return "mock";
  return "gateway-env";
}

export function logModelGatewayEvent(
  event: ModelGatewayEvent,
  logger: Pick<Console, "info"> = console,
) {
  logger.info(JSON.stringify(toLoggableModelGatewayEvent(event)));
}
