import { createMaskImageData, imageDataToNchw, normalizeForegroundMask } from "./image-processing";
import { getBackgroundRemovalModelBlob } from "./model-storage";
import type { BackgroundRemovalModel, BackgroundRemovalProgress, BackgroundRemovalResult } from "./types";

type WorkerResponse =
  | { id: number; ok: true; result: any }
  | { id: number; ok: false; error: string };

let worker: Worker | null = null;
let requestId = 0;
let loadedModel: { id: string; width: number; height: number; runtime: "webgpu" | "wasm" } | null = null;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./background-removal.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    if (response.ok) request.resolve(response.result);
    else request.reject(new Error(response.error));
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "The background-removal worker stopped unexpectedly.");
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
    loadedModel = null;
  };
  return worker;
}

function sendWorkerRequest<T>(message: Record<string, unknown>, transfer: Transferable[] = []) {
  const id = ++requestId;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...message, id }, transfer);
  });
}

async function readResponseWithProgress(
  response: Response,
  onProgress?: (progress: number) => void,
) {
  if (!response.body) return response.arrayBuffer();
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) onProgress?.(Math.min(1, received / total));
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

async function loadModelBytes(model: BackgroundRemovalModel, onProgress?: (progress: number) => void) {
  if (model.source === "imported") return (await getBackgroundRemovalModelBlob(model.id)).arrayBuffer();
  if (!model.modelUrl) throw new Error("The selected built-in model has no download URL.");
  const response = await fetch(model.modelUrl);
  if (!response.ok) throw new Error(`Unable to download ${model.name} (${response.status}).`);
  return readResponseWithProgress(response, onProgress);
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Unable to create the transparent PNG."))), "image/png");
  });
}

export async function removeImageBackground({
  imageUrl,
  model,
  onProgress,
}: {
  imageUrl: string;
  model: BackgroundRemovalModel;
  onProgress?: (progress: BackgroundRemovalProgress) => void;
}): Promise<BackgroundRemovalResult> {
  let loaded = loadedModel?.id === model.id ? loadedModel : null;
  if (!loaded) {
    onProgress?.({ stage: "loading-model", progress: 2, label: `Loading ${model.name}` });
    const modelBytes = await loadModelBytes(model, (value) => {
      onProgress?.({ stage: "loading-model", progress: 2 + Math.round(value * 38), label: `Loading ${model.name}` });
    });
    const session = await sendWorkerRequest<{ width: number; height: number; runtime: "webgpu" | "wasm" }>(
      { type: "load", modelId: model.id, modelBytes, fallbackInputSize: model.fallbackInputSize },
      [modelBytes],
    );
    loaded = { id: model.id, ...session };
    loadedModel = loaded;
  }

  onProgress?.({ stage: "preparing-image", progress: 45, label: "Preparing image locally" });
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`Unable to load the selected image (${imageResponse.status}).`);
  const bitmap = await createImageBitmap(await imageResponse.blob());
  const sourceWidth = bitmap.width;
  const sourceHeight = bitmap.height;
  const inputCanvas = document.createElement("canvas");
  inputCanvas.width = loaded.width;
  inputCanvas.height = loaded.height;
  const inputContext = inputCanvas.getContext("2d", { willReadFrequently: true });
  if (!inputContext) throw new Error("Unable to prepare the selected image.");
  inputContext.drawImage(bitmap, 0, 0, loaded.width, loaded.height);
  const tensorData = imageDataToNchw(inputContext.getImageData(0, 0, loaded.width, loaded.height), model.preprocessing);

  onProgress?.({ stage: "running-model", progress: 55, label: `Removing background with ${model.name}` });
  const inference = await sendWorkerRequest<{
    values: Float32Array;
    width: number;
    height: number;
    runtime: "webgpu" | "wasm";
  }>(
    { type: "infer", modelId: model.id, data: tensorData, width: loaded.width, height: loaded.height },
    [tensorData.buffer],
  );

  onProgress?.({ stage: "compositing", progress: 90, label: "Creating transparent PNG" });
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = inference.width;
  maskCanvas.height = inference.height;
  const maskContext = maskCanvas.getContext("2d");
  if (!maskContext) throw new Error("Unable to compose the model mask.");
  maskContext.putImageData(
    createMaskImageData(normalizeForegroundMask(inference.values), inference.width, inference.height),
    0,
    0,
  );

  const outputCanvas = document.createElement("canvas");
  outputCanvas.width = sourceWidth;
  outputCanvas.height = sourceHeight;
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) throw new Error("Unable to compose the transparent image.");
  outputContext.drawImage(bitmap, 0, 0, sourceWidth, sourceHeight);
  outputContext.globalCompositeOperation = "destination-in";
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.drawImage(maskCanvas, 0, 0, sourceWidth, sourceHeight);
  bitmap.close();
  const blob = await canvasToBlob(outputCanvas);
  onProgress?.({ stage: "compositing", progress: 100, label: "Background removed" });
  return { blob, width: sourceWidth, height: sourceHeight, runtime: inference.runtime };
}
