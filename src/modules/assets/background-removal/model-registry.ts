import type { BackgroundRemovalModel, BackgroundRemovalPreprocessing } from "./types";

export const DEFAULT_BACKGROUND_REMOVAL_MODEL_ID = "open-rmbg-int8";
export const MAX_IMPORTED_BACKGROUND_REMOVAL_MODEL_BYTES = 512_000_000;
export const BACKGROUND_REMOVAL_SELECTION_KEY = "kavero:background-removal:selected-model";

export const BUILTIN_BACKGROUND_REMOVAL_MODELS: readonly BackgroundRemovalModel[] = [
  {
    id: DEFAULT_BACKGROUND_REMOVAL_MODEL_ID,
    name: "Open RMBG Fast",
    description: "44 MB · Fast, balanced cutouts",
    source: "builtin",
    sizeBytes: 44_300_000,
    preprocessing: "zero-to-one",
    fallbackInputSize: 1024,
    modelUrl:
      "https://huggingface.co/onnx-community/ormbg-ONNX/resolve/034e2d884afbab897e10e78fc5bb566b29533fd6/onnx/model_uint8.onnx",
  },
  {
    id: "birefnet-lite-fp16",
    name: "BiRefNet Lite Quality",
    description: "115 MB · Better fine edges",
    source: "builtin",
    sizeBytes: 115_000_000,
    preprocessing: "imagenet",
    fallbackInputSize: 1024,
    modelUrl:
      "https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/de15b22ba131738a16dff04aab8bdf8dc32e3ac1/onnx/model_fp16.onnx",
  },
] as const;

export function formatModelSize(sizeBytes: number) {
  return `${Math.max(1, Math.round(sizeBytes / 1_000_000))} MB`;
}

export function validateImportedModelFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".onnx")) {
    throw new Error("Choose an ONNX model file ending in .onnx.");
  }
  if (file.size === 0) throw new Error("The selected ONNX model is empty.");
  if (file.size > MAX_IMPORTED_BACKGROUND_REMOVAL_MODEL_BYTES) {
    throw new Error("Imported background-removal models must be 512 MB or smaller.");
  }
}

export function createImportedModelMetadata({
  file,
  name,
  preprocessing,
  fallbackInputSize = 1024,
}: {
  file: File;
  name?: string;
  preprocessing: BackgroundRemovalPreprocessing;
  fallbackInputSize?: number;
}): BackgroundRemovalModel {
  validateImportedModelFile(file);
  if (!Number.isInteger(fallbackInputSize) || fallbackInputSize < 64 || fallbackInputSize > 2048) {
    throw new Error("The fallback input size must be a whole number from 64 to 2048 pixels.");
  }
  const cleanedName = name?.trim() || file.name.replace(/\.onnx$/i, "");
  return {
    id: `imported-${crypto.randomUUID()}`,
    name: cleanedName.slice(0, 80),
    description: `${formatModelSize(file.size)} · Imported ONNX`,
    source: "imported",
    sizeBytes: file.size,
    preprocessing,
    fallbackInputSize,
    fileName: file.name,
    createdAt: new Date().toISOString(),
  };
}

export function getSelectedBackgroundRemovalModelId() {
  if (typeof window === "undefined") return DEFAULT_BACKGROUND_REMOVAL_MODEL_ID;
  try {
    return window.localStorage.getItem(BACKGROUND_REMOVAL_SELECTION_KEY) || DEFAULT_BACKGROUND_REMOVAL_MODEL_ID;
  } catch {
    return DEFAULT_BACKGROUND_REMOVAL_MODEL_ID;
  }
}

export function setSelectedBackgroundRemovalModelId(modelId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BACKGROUND_REMOVAL_SELECTION_KEY, modelId);
  } catch {
    // Selection remains valid for this session even when storage is unavailable.
  }
}

export function resolveSelectedBackgroundRemovalModel(
  models: readonly BackgroundRemovalModel[],
  selectedId = getSelectedBackgroundRemovalModelId(),
) {
  return models.find((model) => model.id === selectedId) ?? models[0] ?? BUILTIN_BACKGROUND_REMOVAL_MODELS[0];
}
