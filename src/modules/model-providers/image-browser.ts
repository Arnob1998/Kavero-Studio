import {
  getSelectableImageModelCapabilitiesForFeature,
  imageModelCapabilities,
  type ImageGenerationFeature,
  type ImageModelCapabilities,
} from "./image-capabilities";

export type BrowserImageModel = {
  modelAlias: string;
  legacyModelId: string;
  provider: ImageModelCapabilities["provider"];
  displayLabel: string;
  description: string;
  badge: string;
  compatibility: Readonly<Record<ImageGenerationFeature, boolean>>;
  count: ImageModelCapabilities["count"];
  featureCountPresets: Readonly<Record<ImageGenerationFeature, readonly number[]>>;
  featureAspectRatios: Readonly<Record<ImageGenerationFeature, readonly string[]>>;
  size: ImageModelCapabilities["size"];
  reasoning: ImageModelCapabilities["reasoning"];
  quality: ImageModelCapabilities["quality"];
  background: ImageModelCapabilities["background"];
  supportsReferenceEditing: boolean;
  maximumReferenceImages: number;
  supportedReferenceMimeTypes: readonly string[];
  supportsMask: boolean;
  fixedResolutionWarning: string | null;
};

export function toBrowserImageModel(capability: ImageModelCapabilities): BrowserImageModel {
  return {
    modelAlias: capability.modelAlias,
    legacyModelId: capability.legacyModelId,
    provider: capability.provider,
    displayLabel: capability.displayLabel,
    description: capability.description,
    badge: capability.badge,
    compatibility: capability.compatibility,
    count: capability.count,
    featureCountPresets: capability.featureCountPresets,
    featureAspectRatios: capability.featureAspectRatios,
    size: capability.size,
    reasoning: capability.reasoning,
    quality: capability.quality,
    background: capability.background,
    supportsReferenceEditing: capability.supportsReferenceEditing,
    maximumReferenceImages: capability.maximumReferenceImages,
    supportedReferenceMimeTypes: capability.supportedReferenceMimeTypes,
    supportsMask: capability.supportsMask,
    fixedResolutionWarning: capability.fixedResolutionWarning,
  };
}

export const browserImageModels = imageModelCapabilities
  .filter((capability) => capability.selectable)
  .map(toBrowserImageModel);

export function getBrowserImageModels(feature: ImageGenerationFeature): readonly BrowserImageModel[] {
  return getSelectableImageModelCapabilitiesForFeature(feature).map(toBrowserImageModel);
}

export function getBrowserImageModelByLegacyId(model: string): BrowserImageModel | null {
  return browserImageModels.find((entry) => entry.legacyModelId === model) ?? null;
}

export type BrowserImageUiSettings = {
  model: string;
  count: number;
  aspectRatio: string;
  imageSize: string;
  reasoning: string;
  quality?: string;
  background?: "auto" | "opaque" | "transparent";
};

export function normalizeBrowserImageUiSettings(
  current: BrowserImageUiSettings,
  nextModel: string,
  feature: ImageGenerationFeature,
): BrowserImageUiSettings {
  const capability = getBrowserImageModels(feature).find((entry) => entry.legacyModelId === nextModel);
  if (!capability) return current;
  const counts = capability.featureCountPresets[feature];
  return {
    model: capability.legacyModelId,
    count: counts.includes(current.count) ? current.count : counts[0] ?? capability.count.default,
    aspectRatio: capability.featureAspectRatios[feature].includes(current.aspectRatio) ? current.aspectRatio : capability.size.defaultAspectRatio,
    imageSize: capability.size.presets.some((preset) => preset.value === current.imageSize) ? current.imageSize : capability.size.defaultSize,
    reasoning: capability.reasoning.values.includes(current.reasoning) ? current.reasoning : capability.reasoning.default ?? "provider-managed",
    quality: current.quality && capability.quality.values.includes(current.quality) ? current.quality : capability.quality.default ?? "auto",
    background: current.background && capability.background.values.includes(current.background) ? current.background : capability.background.default,
  };
}
