import type { ModelGatewayUsage } from "./types";

export const emptyModelGatewayUsage: ModelGatewayUsage = {
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  imageCount: null,
  estimatedCost: null,
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function normalizeModelGatewayUsage(value: unknown): ModelGatewayUsage {
  const root = objectOrNull(value);
  if (!root) return { ...emptyModelGatewayUsage };

  const usage = objectOrNull(root.usage) ?? root;
  const inputTokens =
    numberOrNull(usage.prompt_tokens) ??
    numberOrNull(usage.input_tokens) ??
    numberOrNull(usage.inputTokens);
  const outputTokens =
    numberOrNull(usage.completion_tokens) ??
    numberOrNull(usage.output_tokens) ??
    numberOrNull(usage.outputTokens);
  const totalTokens =
    numberOrNull(usage.total_tokens) ??
    numberOrNull(usage.totalTokens) ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    imageCount:
      numberOrNull(root.image_count) ??
      numberOrNull(root.imageCount) ??
      numberOrNull(usage.image_count) ??
      null,
    estimatedCost:
      numberOrNull(root.estimated_cost) ??
      numberOrNull(root.response_cost) ??
      numberOrNull(root.estimatedCost) ??
      null,
  };
}
