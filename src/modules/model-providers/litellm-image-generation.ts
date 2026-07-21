import { createModelGatewayError } from "./errors";
import { getImageModelAdapter } from "./image-adapters";
import {
  resolveImageModelCapabilities,
  validateImageGenerationIntent,
  type ImageGenerationIntent,
} from "./image-capabilities";
import { createLiteLlmClient } from "./litellm-client";
export { OPENAI_GPT_IMAGE_2_MODEL_ALIAS } from "./image-capabilities";
import type { ModelGatewayConfig, ModelGatewayUsage, ModelProviderId } from "./types";

export type LiteLlmImageReference = { dataUrl: string; mimeType: string; name?: string };

export type LiteLlmImageGenerationSettings = {
  legacyModel: string;
  count: number;
  thinking: string;
  aspectRatio: string;
  imageSize: string;
  schema: string;
};

export type LiteLlmGeneratedImage = { dataUrl: string; mimeType: string };

export type LiteLlmImageGenerationResult = {
  text: string;
  images: LiteLlmGeneratedImage[];
  warnings: string[];
  requestId: string | null;
  callId: string | null;
  usage: ModelGatewayUsage;
};

type GenerateLiteLlmImageInput = {
  config: Extract<ModelGatewayConfig, { status: "configured" }>;
  modelAlias: string;
  provider: ModelProviderId | null;
  model: string | null;
  prompt: string;
  intent?: ImageGenerationIntent;
  settings: LiteLlmImageGenerationSettings;
  referenceImages: LiteLlmImageReference[];
  taskLabel?: string;
  transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown>;
};

function getOpenAiImageWarnings(settings: LiteLlmImageGenerationSettings) {
  const warnings: string[] = [];
  if (settings.thinking !== "balanced") warnings.push("GPT Image 2 uses provider-managed image reasoning; the selected thinking level was not sent.");
  if (settings.aspectRatio !== "auto") warnings.push("GPT Image 2 used automatic output dimensions; the selected aspect ratio was not sent.");
  if (settings.imageSize !== "1K" && settings.imageSize !== "source-aligned") warnings.push("GPT Image 2 used automatic output dimensions; the selected image size was not sent.");
  return warnings;
}

function createIntent(input: GenerateLiteLlmImageInput, provider: "gemini" | "openai" | "azure-openai"): ImageGenerationIntent {
  if (input.intent) return input.intent;
  return {
    modelAlias: input.modelAlias,
    feature: input.taskLabel === "auto-segment-isolation" ? "auto-segment-isolation" : input.taskLabel === "canvas-image-generation" ? "canvas-generation" : "standalone-generate",
    prompt: input.prompt,
    count: provider !== "gemini" ? 1 : input.settings.count,
    aspectRatio: provider !== "gemini" ? "auto" : input.settings.aspectRatio,
    outputSize: provider !== "gemini" ? "auto" : input.settings.imageSize,
    quality: provider !== "gemini" ? "auto" : undefined,
    background: "auto",
    referenceImages: input.referenceImages,
    reasoning: provider !== "gemini" ? undefined : input.settings.thinking,
  };
}

export async function generateLiteLlmImage(input: GenerateLiteLlmImageInput): Promise<LiteLlmImageGenerationResult> {
  const capability =
    resolveImageModelCapabilities(input.intent?.modelAlias ?? "") ??
    resolveImageModelCapabilities(input.model ?? "") ??
    resolveImageModelCapabilities(input.settings.legacyModel) ??
    resolveImageModelCapabilities(input.modelAlias);
  const context = { provider: input.provider, model: input.model, modelAlias: input.modelAlias };
  if (!capability) throw createModelGatewayError("Unknown image model adapter.", context, "provider_error");
  const adapter = getImageModelAdapter(capability.modelAlias);
  if (!adapter) throw createModelGatewayError("Unknown image model adapter.", context, "provider_error");

  const intent = createIntent(input, capability.provider);
  const validationIssues = input.intent ? validateImageGenerationIntent(intent) : [];
  if (validationIssues.length > 0) {
    throw createModelGatewayError(validationIssues[0]!.message, context, "provider_error");
  }
  const request = adapter.buildRequest(intent, { taskLabel: input.taskLabel, legacySettings: input.settings });
  if (request.transport === "multipart") {
    throw createModelGatewayError(
      capability.model === "gpt-image-2" ? "GPT Image 2 reference editing is not available." : "Image reference and mask editing is not available.",
      context,
      "provider_error",
    );
  }

  const client = createLiteLlmClient({ config: input.config });
  const body = input.transformRequestBody ? input.transformRequestBody(request.body) : request.body;
  const response = request.endpoint === "openai-generations"
    ? await client.generateImage(body, context)
    : await client.chatCompletions(body, context);
  const responseContext = { ...context, requestId: response.requestId, callId: response.callId };

  let normalized;
  try {
    normalized = adapter.normalizeResponse(response.data);
  } catch (error) {
    throw createModelGatewayError(
      error instanceof Error ? error.message : "LiteLLM returned an invalid image response.",
      responseContext,
      "invalid_response",
    );
  }

  return {
    ...normalized,
    warnings: capability.provider !== "gemini" && !input.intent ? getOpenAiImageWarnings(input.settings) : [],
    requestId: response.requestId,
    callId: response.callId,
    usage: response.usage,
  };
}
