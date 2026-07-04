import { ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";

export const imageModelIds = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
] as const;

export type GenerateImageModelId = (typeof imageModelIds)[number];

export const referenceImageLimits: Record<GenerateImageModelId, number> = {
  "gemini-3.1-flash-image-preview": 14,
  "gemini-3-pro-image-preview": 14,
  "gemini-2.5-flash-image": 3,
};

export const aspectRatios = [
  "auto",
  "1:1",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "4:1",
  "1:4",
  "8:1",
  "1:8",
] as const;

export type GenerateAspectRatio = (typeof aspectRatios)[number];
export type GenerateThinking = "fast" | "balanced" | "deep";
export type GenerateImageSize = "1K" | "2K" | "4K";

export const modelLabels: Record<GenerateImageModelId, string> = {
  "gemini-3.1-flash-image-preview": "Nano Banana 2",
  "gemini-3-pro-image-preview": "Nano Banana Pro",
  "gemini-2.5-flash-image": "Nano Banana",
};

export function getThinkingLevel(value: GenerateThinking) {
  return value === "deep" ? ThinkingLevel.HIGH : ThinkingLevel.MINIMAL;
}

export function createGenerateImageConfig({
  model,
  aspectRatio,
  imageSize,
  thinking,
}: {
  model: GenerateImageModelId;
  aspectRatio: GenerateAspectRatio;
  imageSize: GenerateImageSize;
  thinking: GenerateThinking;
}): GenerateContentConfig {
  const imageConfig =
    aspectRatio === "auto"
      ? model === "gemini-2.5-flash-image"
        ? undefined
        : { imageSize }
      : model === "gemini-2.5-flash-image"
        ? { aspectRatio }
        : { aspectRatio, imageSize };

  return {
    responseModalities: ["Image"],
    imageConfig,
    thinkingConfig:
      model === "gemini-3.1-flash-image-preview"
        ? { thinkingLevel: getThinkingLevel(thinking) }
        : undefined,
  };
}

export function getModelFixedResolutionWarning(model: GenerateImageModelId) {
  if (model !== "gemini-2.5-flash-image") return null;
  return "Gemini 2.5 Flash Image ignores imageSize and generates at its fixed model resolution.";
}
