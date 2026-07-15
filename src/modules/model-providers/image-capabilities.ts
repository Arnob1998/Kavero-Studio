export type ImageGenerationFeature =
  | "standalone-generate"
  | "canvas-generation"
  | "auto-segment-isolation";

export type ImageSizePreset = {
  value: string;
  label: string;
  aspectRatio: string;
  width?: number;
  height?: number;
};

export type ImageSizeCapabilities =
  | {
      mode: "enumerated";
      presets: readonly ImageSizePreset[];
      aspectRatios: readonly string[];
      defaultSize: string;
      defaultAspectRatio: string;
    }
  | {
      mode: "aspect-ratio-presets";
      presets: readonly ImageSizePreset[];
      aspectRatios: readonly string[];
      defaultSize: string;
      defaultAspectRatio: string;
    }
  | {
      mode: "constrained-dimensions";
      presets: readonly ImageSizePreset[];
      aspectRatios: readonly string[];
      defaultSize: string;
      defaultAspectRatio: string;
      constraints: {
        maximumEdge: number;
        edgeMultiple: number;
        maximumAspectRatio: number;
        minimumPixels: number;
        maximumPixels: number;
      };
    }
  | {
      mode: "provider-managed";
      presets: readonly ImageSizePreset[];
      aspectRatios: readonly string[];
      defaultSize: "auto";
      defaultAspectRatio: "auto";
    };

export type ImageModelCapabilities = {
  modelAlias: string;
  provider: "gemini" | "openai";
  model: string;
  displayLabel: string;
  selectable: boolean;
  supportsTextToImage: boolean;
  supportsReferenceEditing: boolean;
  supportsMask: boolean;
  maximumReferenceImages: number;
  supportedReferenceMimeTypes: readonly string[];
  count: { minimum: number; maximum: number; presets: readonly number[]; default: number };
  size: ImageSizeCapabilities;
  quality: { values: readonly string[]; default: string | null };
  background: { values: readonly ("auto" | "opaque" | "transparent")[]; default: "auto" | "opaque" | "transparent" };
  reasoning: { values: readonly string[]; default: string | null };
  streaming: boolean;
  transport: { generation: "json"; editing: "json" | "multipart" | null };
  compatibility: Record<ImageGenerationFeature, boolean>;
};

export type ImageReference = {
  dataUrl: string;
  mimeType: string;
  name?: string;
};

export type ImageMask = ImageReference;

export type ImageGenerationIntent = {
  modelAlias: string;
  feature: ImageGenerationFeature;
  prompt: string;
  count: number;
  aspectRatio: string;
  outputSize: string;
  quality?: string;
  background: "auto" | "opaque" | "transparent";
  referenceImages: ImageReference[];
  mask?: ImageMask;
  reasoning?: string;
};

export type ImageIntentValidationIssue = {
  field: keyof ImageGenerationIntent | "referenceImages.mimeType";
  code:
    | "unknown-model"
    | "model-unavailable"
    | "feature-incompatible"
    | "unsupported-size"
    | "unsupported-aspect-ratio"
    | "unsupported-quality"
    | "unsupported-background"
    | "unsupported-reasoning"
    | "unsupported-references"
    | "too-many-references"
    | "unsupported-mime-type"
    | "unsupported-mask"
    | "mask-requires-reference"
    | "invalid-count";
  message: string;
};

export type ImageUiSettings = {
  modelAlias: string;
  count: number;
  aspectRatio: string;
  outputSize: string;
  quality?: string;
  background: "auto" | "opaque" | "transparent";
  reasoning?: string;
};

const GEMINI_ASPECT_RATIOS = [
  "auto", "1:1", "9:16", "16:9", "3:4", "4:3", "3:2", "2:3", "5:4", "4:5", "21:9", "4:1", "1:4", "8:1", "1:8",
] as const;

const GEMINI_SIZE_PRESETS = [
  { value: "1K", label: "1K", aspectRatio: "auto" },
  { value: "2K", label: "2K", aspectRatio: "auto" },
  { value: "4K", label: "4K", aspectRatio: "auto" },
] as const;

const OPENAI_SIZE_PRESETS = [
  { value: "auto", label: "Auto", aspectRatio: "auto" },
  { value: "1024x1024", label: "1024×1024", aspectRatio: "1:1", width: 1024, height: 1024 },
  { value: "1536x1024", label: "1536×1024", aspectRatio: "3:2", width: 1536, height: 1024 },
  { value: "1024x1536", label: "1024×1536", aspectRatio: "2:3", width: 1024, height: 1536 },
  { value: "2048x2048", label: "2048×2048", aspectRatio: "1:1", width: 2048, height: 2048 },
  { value: "2048x1152", label: "2048×1152", aspectRatio: "16:9", width: 2048, height: 1152 },
  { value: "3840x2160", label: "3840×2160", aspectRatio: "16:9", width: 3840, height: 2160 },
  { value: "2160x3840", label: "2160×3840", aspectRatio: "9:16", width: 2160, height: 3840 },
] as const;

export const GEMINI_PRO_IMAGE_MODEL_ALIAS = "kavero-image-gemini-3-pro";
export const GEMINI_2_5_FLASH_IMAGE_MODEL_ALIAS = "kavero-image-gemini-2-5-flash";
export const OPENAI_GPT_IMAGE_2_MODEL_ALIAS = "kavero-image-openai-gpt-image-2";

export const imageModelCapabilities = [
  {
    modelAlias: "kavero-image-generation-default",
    provider: "gemini",
    model: "gemini-3.1-flash-image-preview",
    displayLabel: "Nano Banana 2",
    selectable: true,
    supportsTextToImage: true,
    supportsReferenceEditing: true,
    supportsMask: false,
    maximumReferenceImages: 14,
    supportedReferenceMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"],
    count: { minimum: 1, maximum: 16, presets: [1, 2, 3, 4, 6, 8, 10, 12, 16], default: 2 },
    size: { mode: "enumerated", presets: GEMINI_SIZE_PRESETS, aspectRatios: GEMINI_ASPECT_RATIOS, defaultSize: "1K", defaultAspectRatio: "auto" },
    quality: { values: [], default: null },
    background: { values: ["auto", "opaque", "transparent"], default: "auto" },
    reasoning: { values: ["balanced", "fast", "deep"], default: "balanced" },
    streaming: false,
    transport: { generation: "json", editing: "json" },
    compatibility: { "standalone-generate": true, "canvas-generation": true, "auto-segment-isolation": true },
  },
  {
    modelAlias: GEMINI_PRO_IMAGE_MODEL_ALIAS,
    provider: "gemini",
    model: "gemini-3-pro-image-preview",
    displayLabel: "Nano Banana Pro",
    selectable: false,
    supportsTextToImage: true,
    supportsReferenceEditing: true,
    supportsMask: false,
    maximumReferenceImages: 14,
    supportedReferenceMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"],
    count: { minimum: 1, maximum: 16, presets: [1, 2, 3, 4, 6, 8, 10, 12, 16], default: 2 },
    size: { mode: "enumerated", presets: GEMINI_SIZE_PRESETS, aspectRatios: GEMINI_ASPECT_RATIOS, defaultSize: "1K", defaultAspectRatio: "auto" },
    quality: { values: [], default: null },
    background: { values: ["auto", "opaque", "transparent"], default: "auto" },
    reasoning: { values: [], default: null },
    streaming: false,
    transport: { generation: "json", editing: "json" },
    compatibility: { "standalone-generate": true, "canvas-generation": true, "auto-segment-isolation": true },
  },
  {
    modelAlias: GEMINI_2_5_FLASH_IMAGE_MODEL_ALIAS,
    provider: "gemini",
    model: "gemini-2.5-flash-image",
    displayLabel: "Nano Banana",
    selectable: false,
    supportsTextToImage: true,
    supportsReferenceEditing: true,
    supportsMask: false,
    maximumReferenceImages: 3,
    supportedReferenceMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"],
    count: { minimum: 1, maximum: 16, presets: [1, 2, 3, 4, 6, 8, 10, 12, 16], default: 2 },
    size: { mode: "aspect-ratio-presets", presets: [{ value: "fixed", label: "Model default", aspectRatio: "auto" }], aspectRatios: GEMINI_ASPECT_RATIOS, defaultSize: "fixed", defaultAspectRatio: "auto" },
    quality: { values: [], default: null },
    background: { values: ["auto", "opaque", "transparent"], default: "auto" },
    reasoning: { values: [], default: null },
    streaming: false,
    transport: { generation: "json", editing: "json" },
    compatibility: { "standalone-generate": true, "canvas-generation": true, "auto-segment-isolation": true },
  },
  {
    modelAlias: OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
    provider: "openai",
    model: "gpt-image-2",
    displayLabel: "GPT Image 2",
    selectable: false,
    supportsTextToImage: true,
    supportsReferenceEditing: true,
    supportsMask: true,
    maximumReferenceImages: 16,
    supportedReferenceMimeTypes: ["image/png", "image/jpeg", "image/webp"],
    count: { minimum: 1, maximum: 10, presets: [1, 2, 3, 4, 6, 8, 10], default: 1 },
    size: {
      mode: "constrained-dimensions",
      presets: OPENAI_SIZE_PRESETS,
      aspectRatios: ["auto", "1:1", "3:2", "2:3", "16:9", "9:16"],
      defaultSize: "auto",
      defaultAspectRatio: "auto",
      constraints: { maximumEdge: 3840, edgeMultiple: 16, maximumAspectRatio: 3, minimumPixels: 655_360, maximumPixels: 8_294_400 },
    },
    quality: { values: ["auto", "low", "medium", "high"], default: "auto" },
    background: { values: ["auto", "opaque"], default: "auto" },
    reasoning: { values: [], default: null },
    streaming: true,
    transport: { generation: "json", editing: "multipart" },
    compatibility: { "standalone-generate": true, "canvas-generation": true, "auto-segment-isolation": false },
  },
] as const satisfies readonly ImageModelCapabilities[];

export function getImageModelCapabilities(modelAlias: string): ImageModelCapabilities | null {
  return imageModelCapabilities.find((entry) => entry.modelAlias === modelAlias) ?? null;
}

export function getImageModelCapabilitiesByLegacyModel(model: string): ImageModelCapabilities | null {
  return imageModelCapabilities.find((entry) => entry.model === model) ?? null;
}

export function getSelectableImageModelCapabilities() {
  return imageModelCapabilities.filter((entry) => entry.selectable);
}

export function validateImageGenerationIntent(
  intent: ImageGenerationIntent,
  options: { requireSelectable?: boolean } = {},
): ImageIntentValidationIssue[] {
  const capability = getImageModelCapabilities(intent.modelAlias);
  if (!capability) return [{ field: "modelAlias", code: "unknown-model", message: "Unknown image model." }];
  if (options.requireSelectable !== false && !capability.selectable) {
    return [{ field: "modelAlias", code: "model-unavailable", message: `${capability.displayLabel} is not available.` }];
  }

  const issues: ImageIntentValidationIssue[] = [];
  if (!capability.compatibility[intent.feature]) issues.push({ field: "feature", code: "feature-incompatible", message: `${capability.displayLabel} is not compatible with this feature.` });
  if (!Number.isInteger(intent.count) || intent.count < capability.count.minimum || intent.count > capability.count.maximum) issues.push({ field: "count", code: "invalid-count", message: `${capability.displayLabel} supports ${capability.count.minimum}-${capability.count.maximum} images per request.` });
  if (!capability.size.presets.some((preset) => preset.value === intent.outputSize)) issues.push({ field: "outputSize", code: "unsupported-size", message: `${capability.displayLabel} does not support the selected size.` });
  if (!capability.size.aspectRatios.includes(intent.aspectRatio)) issues.push({ field: "aspectRatio", code: "unsupported-aspect-ratio", message: `${capability.displayLabel} does not support the selected aspect ratio.` });
  if (intent.quality && !capability.quality.values.includes(intent.quality)) issues.push({ field: "quality", code: "unsupported-quality", message: `${capability.displayLabel} does not support the selected quality.` });
  if (!capability.background.values.includes(intent.background)) issues.push({ field: "background", code: "unsupported-background", message: `${capability.displayLabel} does not support ${intent.background} backgrounds.` });
  if (intent.reasoning && !capability.reasoning.values.includes(intent.reasoning)) issues.push({ field: "reasoning", code: "unsupported-reasoning", message: `${capability.displayLabel} does not support the selected reasoning control.` });
  if (intent.referenceImages.length && !capability.supportsReferenceEditing) issues.push({ field: "referenceImages", code: "unsupported-references", message: `${capability.displayLabel} does not support reference images.` });
  if (intent.referenceImages.length > capability.maximumReferenceImages) issues.push({ field: "referenceImages", code: "too-many-references", message: `${capability.displayLabel} supports up to ${capability.maximumReferenceImages} reference images.` });
  for (const reference of intent.referenceImages) {
    if (!capability.supportedReferenceMimeTypes.includes(reference.mimeType)) issues.push({ field: "referenceImages.mimeType", code: "unsupported-mime-type", message: `${capability.displayLabel} does not support ${reference.mimeType} reference images.` });
  }
  if (intent.mask && !capability.supportsMask) issues.push({ field: "mask", code: "unsupported-mask", message: `${capability.displayLabel} does not support masks.` });
  if (intent.mask && intent.referenceImages.length === 0) issues.push({ field: "mask", code: "mask-requires-reference", message: "A mask requires at least one reference image." });
  if (intent.mask && !capability.supportedReferenceMimeTypes.includes(intent.mask.mimeType)) issues.push({ field: "mask", code: "unsupported-mime-type", message: `${capability.displayLabel} does not support ${intent.mask.mimeType} masks.` });
  return issues;
}

export function normalizeImageUiSettings(
  current: ImageUiSettings,
  nextModelAlias: string,
): { settings: ImageUiSettings; notices: string[] } {
  const capability = getImageModelCapabilities(nextModelAlias);
  if (!capability) return { settings: current, notices: ["The selected image model is unavailable."] };
  const notices: string[] = [];
  const next: ImageUiSettings = { ...current, modelAlias: nextModelAlias };

  if (!capability.count.presets.includes(next.count)) {
    next.count = capability.count.default;
    notices.push(`Image count changed to ${next.count} because ${capability.displayLabel} does not support the previous selection.`);
  }
  if (!capability.size.aspectRatios.includes(next.aspectRatio)) {
    next.aspectRatio = capability.size.defaultAspectRatio;
    notices.push(`Aspect ratio changed to ${next.aspectRatio} because ${capability.displayLabel} does not support the previous selection.`);
  }
  const validSizes = capability.size.presets.filter((preset) => preset.aspectRatio === "auto" || next.aspectRatio === "auto" || preset.aspectRatio === next.aspectRatio);
  if (!validSizes.some((preset) => preset.value === next.outputSize)) {
    next.outputSize = validSizes.find((preset) => preset.value === capability.size.defaultSize)?.value ?? validSizes[0]?.value ?? capability.size.defaultSize;
    notices.push(`Size changed to ${validSizes.find((preset) => preset.value === next.outputSize)?.label ?? next.outputSize} because ${capability.displayLabel} does not support the previous selection.`);
  }
  if (!next.quality || !capability.quality.values.includes(next.quality)) next.quality = capability.quality.default ?? undefined;
  if (!capability.background.values.includes(next.background)) {
    next.background = capability.background.default;
    notices.push(`Background changed to ${next.background} because ${capability.displayLabel} does not support the previous selection.`);
  }
  if (!next.reasoning || !capability.reasoning.values.includes(next.reasoning)) next.reasoning = capability.reasoning.default ?? undefined;
  return { settings: next, notices };
}

export function getSizePresetsForAspectRatio(capability: ImageModelCapabilities, aspectRatio: string) {
  return capability.size.presets.filter((preset) => preset.aspectRatio === "auto" || aspectRatio === "auto" || preset.aspectRatio === aspectRatio);
}
