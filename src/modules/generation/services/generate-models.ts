import { createGeminiGenerateContentConfig } from "@/modules/model-providers/image-adapters";
import { getBrowserImageModels } from "@/modules/model-providers/image-browser";
import type { SelectableLegacyImageModelId } from "@/modules/model-providers/image-capabilities";

const standaloneModels = getBrowserImageModels("standalone-generate");
export const imageModelIds = standaloneModels.map((entry) => entry.legacyModelId) as SelectableLegacyImageModelId[];
export type GenerateImageModelId = SelectableLegacyImageModelId;

export const referenceImageLimits = Object.fromEntries(
  standaloneModels.map((entry) => [entry.legacyModelId, entry.maximumReferenceImages]),
) as Record<GenerateImageModelId, number>;

export const aspectRatios = standaloneModels[0].size.aspectRatios;
export type GenerateAspectRatio = (typeof aspectRatios)[number];
export type GenerateThinking = "fast" | "balanced" | "deep";
export type GenerateImageSize = "1K" | "2K" | "4K";

export const modelLabels = Object.fromEntries(
  standaloneModels.map((entry) => [entry.legacyModelId, entry.displayLabel]),
) as Record<GenerateImageModelId, string>;

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
}) {
  return createGeminiGenerateContentConfig({ model, aspectRatio, imageSize, thinking });
}

export function getModelFixedResolutionWarning(model: GenerateImageModelId) {
  return standaloneModels.find((entry) => entry.legacyModelId === model)?.fixedResolutionWarning ?? null;
}
