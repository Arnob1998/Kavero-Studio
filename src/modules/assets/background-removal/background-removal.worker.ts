/// <reference lib="webworker" />

import * as ort from "onnxruntime-web/webgpu";

type WorkerRequest =
  | { id: number; type: "load"; modelId: string; modelBytes: ArrayBuffer; fallbackInputSize: number }
  | { id: number; type: "infer"; modelId: string; data: Float32Array; width: number; height: number };

let activeModelId: string | null = null;
let activeSession: ort.InferenceSession | null = null;
let activeRuntime: "webgpu" | "wasm" = "wasm";

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

async function loadSession(message: Extract<WorkerRequest, { type: "load" }>) {
  if (activeSession && activeModelId !== message.modelId) {
    await activeSession.release();
    activeSession = null;
    activeModelId = null;
  }

  if (!activeSession) {
    try {
      activeSession = await ort.InferenceSession.create(message.modelBytes, {
        executionProviders: ["webgpu"],
        graphOptimizationLevel: "all",
      });
      activeRuntime = "webgpu";
    } catch {
      activeSession = await ort.InferenceSession.create(message.modelBytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      activeRuntime = "wasm";
    }
    activeModelId = message.modelId;
  }

  const metadata = activeSession.inputMetadata[0];
  try {
    if (!metadata?.isTensor || metadata.shape.length !== 4) {
      throw new Error("This model must expose a four-dimensional NCHW image input.");
    }
    if (metadata.type !== "float32") {
      throw new Error("This model must expose a float32 image input.");
    }
    const channels = metadata.shape[1];
    if (typeof channels === "number" && channels !== 3) {
      throw new Error("This model must accept three RGB input channels.");
    }
  } catch (error) {
    await activeSession.release();
    activeSession = null;
    activeModelId = null;
    throw error;
  }
  const height = typeof metadata.shape[2] === "number" && metadata.shape[2] > 0 ? metadata.shape[2] : message.fallbackInputSize;
  const width = typeof metadata.shape[3] === "number" && metadata.shape[3] > 0 ? metadata.shape[3] : message.fallbackInputSize;
  return { width, height, runtime: activeRuntime };
}

async function runInference(message: Extract<WorkerRequest, { type: "infer" }>) {
  if (!activeSession || activeModelId !== message.modelId) throw new Error("The selected model is not loaded.");
  const inputName = activeSession.inputNames[0];
  const outputs = await activeSession.run({
    [inputName]: new ort.Tensor("float32", message.data, [1, 3, message.height, message.width]),
  });
  const output = outputs[activeSession.outputNames[0]];
  if (!output || !(output.data instanceof Float32Array) || output.dims.length < 2) {
    throw new Error("This model must expose a float foreground-mask output.");
  }
  const maskHeight = Number(output.dims[output.dims.length - 2]);
  const maskWidth = Number(output.dims[output.dims.length - 1]);
  if (
    !Number.isInteger(maskWidth) ||
    !Number.isInteger(maskHeight) ||
    maskWidth <= 0 ||
    maskHeight <= 0 ||
    output.data.length !== maskWidth * maskHeight
  ) {
    throw new Error("This model must expose one float foreground mask per image.");
  }
  const values = new Float32Array(output.data);
  return { values, width: maskWidth, height: maskHeight, runtime: activeRuntime };
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  try {
    if (message.type === "load") {
      self.postMessage({ id: message.id, ok: true, result: await loadSession(message) });
      return;
    }
    const result = await runInference(message);
    self.postMessage({ id: message.id, ok: true, result }, [result.values.buffer]);
  } catch (error) {
    self.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : "Background-removal inference failed.",
    });
  }
};

export {};
