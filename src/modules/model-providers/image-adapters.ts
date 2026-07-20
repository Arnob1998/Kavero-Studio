import { ThinkingLevel, type GenerateContentConfig } from "@google/genai";
import type { ImageGenerationIntent, ImageModelCapabilities, ImageReference } from "./image-capabilities";
import { resolveImageModelCapabilities } from "./image-capabilities";

export type ImageAdapterJsonRequest = {
  transport: "json";
  endpoint: "litellm-chat" | "openai-generations";
  body: Record<string, unknown>;
};

export type ImageAdapterMultipartRequest = {
  transport: "multipart";
  endpoint: "openai-edits";
  fields: Record<string, string | number>;
  images: ImageReference[];
  mask?: ImageReference;
};

export type ImageAdapterRequest = ImageAdapterJsonRequest | ImageAdapterMultipartRequest;

export type NormalizedImageAdapterResponse = {
  text: string;
  images: Array<{ dataUrl: string; mimeType: string }>;
};

export type ImageModelAdapter = {
  provider: ImageModelCapabilities["provider"];
  buildRequest(intent: ImageGenerationIntent, options?: { taskLabel?: string; legacySettings?: Record<string, unknown> }): ImageAdapterRequest;
  normalizeResponse(data: unknown): NormalizedImageAdapterResponse;
};

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;]+);base64,([A-Za-z0-9+/=_-]+)$/);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

function isCanonicalBase64(value: string) {
  return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
}

export function createGeminiGenerateContentConfig({
  model,
  aspectRatio,
  imageSize,
  thinking,
}: {
  model: string;
  aspectRatio: string;
  imageSize: string;
  thinking: string;
}): GenerateContentConfig {
  const capability = resolveImageModelCapabilities(model);
  if (!capability || capability.provider !== "gemini") throw new Error("Unknown Gemini image model.");
  const fixedResolution = capability.model === "gemini-2.5-flash-image";
  const imageConfig =
    aspectRatio === "auto"
      ? fixedResolution
        ? undefined
        : { imageSize }
      : fixedResolution
        ? { aspectRatio }
        : { aspectRatio, imageSize };

  return {
    responseModalities: ["Image"],
    imageConfig,
    thinkingConfig:
      capability.model === "gemini-3.1-flash-image-preview"
        ? { thinkingLevel: thinking === "deep" ? ThinkingLevel.HIGH : ThinkingLevel.MINIMAL }
        : undefined,
  };
}

function normalizeGeminiChatResponse(data: unknown): NormalizedImageAdapterResponse {
  const root = objectOrNull(data);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const message = objectOrNull(objectOrNull(choices[0])?.message);
  const content = message?.content;
  const text = typeof content === "string"
    ? content.trim()
    : Array.isArray(content)
      ? content.map((part) => objectOrNull(part)?.text).filter((part): part is string => typeof part === "string").map((part) => part.trim()).filter(Boolean).join("\n")
      : "";
  const rawImages = Array.isArray(message?.images) ? message.images : [];
  const images = rawImages.map((value) => {
    const image = objectOrNull(value);
    const imageUrl = image?.image_url;
    const dataUrl = typeof imageUrl === "string" ? imageUrl : objectOrNull(imageUrl)?.url;
    const parsed = typeof dataUrl === "string" ? parseDataUrl(dataUrl) : null;
    if (!parsed) throw new Error("LiteLLM returned an invalid image response.");
    return { dataUrl: dataUrl as string, mimeType: parsed.mimeType };
  });
  if (images.length === 0) throw new Error("LiteLLM returned no generated images.");
  return { text, images };
}

function normalizeOpenAiImageResponse(data: unknown): NormalizedImageAdapterResponse {
  const root = objectOrNull(data);
  const entries = Array.isArray(root?.data) ? root.data : [];
  const images: NormalizedImageAdapterResponse["images"] = [];
  const revisedPrompts: string[] = [];
  for (const entry of entries) {
    const record = objectOrNull(entry);
    const base64 = typeof record?.b64_json === "string" ? record.b64_json : null;
    if (!base64 || !isCanonicalBase64(base64)) throw new Error("LiteLLM returned an invalid image response.");
    images.push({ dataUrl: `data:image/png;base64,${base64}`, mimeType: "image/png" });
    if (typeof record?.revised_prompt === "string" && record.revised_prompt.trim()) revisedPrompts.push(record.revised_prompt.trim());
  }
  if (images.length === 0) throw new Error("LiteLLM returned no generated images.");
  return { images, text: revisedPrompts.join("\n\n") };
}

const geminiAdapter: ImageModelAdapter = {
  provider: "gemini",
  buildRequest(intent, options) {
    return {
      transport: "json",
      endpoint: "litellm-chat",
      body: {
        model: intent.modelAlias,
        modalities: ["image", "text"],
        messages: [{
          role: "user",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                task: "Generate an image for Kavero.",
                taskLabel: options?.taskLabel ?? intent.feature,
                prompt: intent.prompt,
                settings: options?.legacySettings ?? {
                  legacyModel: resolveImageModelCapabilities(intent.modelAlias)?.legacyModelId,
                  count: intent.count,
                  thinking: intent.reasoning,
                  aspectRatio: intent.aspectRatio,
                  imageSize: intent.outputSize,
                },
                referenceImages: intent.referenceImages.map((image, index) => ({
                  index: index + 1,
                  name: image.name ?? `Reference ${index + 1}`,
                  mimeType: image.mimeType,
                })),
              }, null, 2),
            },
            ...intent.referenceImages.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl } })),
          ],
        }],
      },
    };
  },
  normalizeResponse: normalizeGeminiChatResponse,
};

const openAiAdapter: ImageModelAdapter = {
  provider: "openai",
  buildRequest(intent) {
    const fields: Record<string, string | number> = {
      model: intent.modelAlias,
      prompt: intent.prompt,
      n: intent.count,
      size: intent.outputSize,
      quality: intent.quality ?? "auto",
    };
    if (intent.background !== "auto") fields.background = intent.background;
    if (intent.referenceImages.length > 0 || intent.mask) {
      return { transport: "multipart", endpoint: "openai-edits", fields, images: intent.referenceImages, mask: intent.mask };
    }
    return { transport: "json", endpoint: "openai-generations", body: fields };
  },
  normalizeResponse: normalizeOpenAiImageResponse,
};

export const imageModelAdapterRegistry: Record<ImageModelCapabilities["provider"], ImageModelAdapter> = {
  gemini: geminiAdapter,
  openai: openAiAdapter,
};

export function getImageModelAdapter(modelOrAlias: string): ImageModelAdapter | null {
  const capability = resolveImageModelCapabilities(modelOrAlias);
  return capability ? imageModelAdapterRegistry[capability.provider] : null;
}
