export type BackgroundRemovalPreprocessing = "zero-to-one" | "imagenet";

export interface BackgroundRemovalModel {
  id: string;
  name: string;
  description: string;
  source: "builtin" | "imported";
  sizeBytes: number;
  preprocessing: BackgroundRemovalPreprocessing;
  fallbackInputSize: number;
  modelUrl?: string;
  fileName?: string;
  createdAt?: string;
}

export interface StoredBackgroundRemovalModel extends BackgroundRemovalModel {
  source: "imported";
  modelBlob: Blob;
}

export interface BackgroundRemovalProgress {
  stage: "loading-model" | "preparing-image" | "running-model" | "compositing";
  progress: number;
  label: string;
}

export interface BackgroundRemovalResult {
  blob: Blob;
  width: number;
  height: number;
  runtime: "webgpu" | "wasm";
}
