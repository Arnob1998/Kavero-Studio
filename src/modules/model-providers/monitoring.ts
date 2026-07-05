import type { ModelGatewayEvent, ModelGatewayUsage, ModelProviderId } from "./types";
import { emptyModelGatewayUsage } from "./usage";

export type ModelGatewayEventInput = {
  userId?: string | null;
  feature: string;
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
};

export function createModelGatewayEvent(input: ModelGatewayEventInput): ModelGatewayEvent {
  const usage = { ...emptyModelGatewayUsage, ...(input.usage ?? {}) };

  return {
    userId: input.userId ?? null,
    feature: input.feature,
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
    gateway: input.gateway ?? "litellm",
  };
}

export function toLoggableModelGatewayEvent(event: ModelGatewayEvent): Record<string, unknown> {
  return {
    type: "model_gateway_event",
    userId: event.userId,
    feature: event.feature,
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
  };
}

export function logModelGatewayEvent(
  event: ModelGatewayEvent,
  logger: Pick<Console, "info"> = console,
) {
  logger.info(JSON.stringify(toLoggableModelGatewayEvent(event)));
}
