import { describe, expect, it, vi } from "vitest";
import {
  BUILTIN_BACKGROUND_REMOVAL_MODELS,
  createImportedModelMetadata,
  DEFAULT_BACKGROUND_REMOVAL_MODEL_ID,
  resolveSelectedBackgroundRemovalModel,
  validateImportedModelFile,
} from "./model-registry";

describe("background-removal model registry", () => {
  it("offers the fast and quality built-ins with pinned model URLs", () => {
    expect(BUILTIN_BACKGROUND_REMOVAL_MODELS.map((model) => model.id)).toEqual([
      "open-rmbg-int8",
      "birefnet-lite-fp16",
    ]);
    expect(BUILTIN_BACKGROUND_REMOVAL_MODELS.every((model) => model.modelUrl?.includes("/resolve/"))).toBe(true);
  });

  it("falls back to the fast built-in when a saved selection no longer exists", () => {
    expect(resolveSelectedBackgroundRemovalModel(BUILTIN_BACKGROUND_REMOVAL_MODELS, "deleted-model").id).toBe(
      DEFAULT_BACKGROUND_REMOVAL_MODEL_ID,
    );
  });

  it("accepts ONNX imports and records an explicit preprocessing contract", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "model-id" });
    const file = new File([new Uint8Array(1024)], "cutout.onnx", { type: "application/octet-stream" });
    const model = createImportedModelMetadata({
      file,
      name: "My Cutout",
      preprocessing: "imagenet",
      fallbackInputSize: 512,
    });
    expect(model).toMatchObject({
      id: "imported-model-id",
      name: "My Cutout",
      source: "imported",
      preprocessing: "imagenet",
      fallbackInputSize: 512,
      fileName: "cutout.onnx",
    });
    vi.unstubAllGlobals();
  });

  it("rejects empty, non-ONNX, and oversized imports", () => {
    expect(() => validateImportedModelFile(new File([], "empty.onnx"))).toThrow("empty");
    expect(() => validateImportedModelFile(new File(["model"], "model.bin"))).toThrow("ending in .onnx");
    expect(() =>
      validateImportedModelFile({ name: "huge.onnx", size: 513 * 1024 * 1024 } as File),
    ).toThrow("512 MB");
    expect(() =>
      createImportedModelMetadata({
        file: new File(["model"], "model.onnx"),
        preprocessing: "zero-to-one",
        fallbackInputSize: 4096,
      }),
    ).toThrow("64 to 2048");
  });
});
