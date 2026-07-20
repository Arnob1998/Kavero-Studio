import { describe, expect, it } from "vitest";
import {
  aspectRatios,
  createGenerateImageConfig,
  getModelFixedResolutionWarning,
  imageModelIds,
  modelLabels,
  referenceImageLimits,
} from "./generate-models";

describe("generate model helpers", () => {
  it("preserves current model IDs, labels, and reference image limits", () => {
    expect(imageModelIds).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview",
      "gemini-2.5-flash-image",
      "gpt-image-2",
    ]);
    expect(modelLabels).toEqual({
      "gemini-3.1-flash-image-preview": "Nano Banana 2",
      "gemini-3-pro-image-preview": "Nano Banana Pro",
      "gemini-2.5-flash-image": "Nano Banana",
      "gpt-image-2": "GPT Image 2",
    });
    expect(referenceImageLimits).toEqual({
      "gemini-3.1-flash-image-preview": 14,
      "gemini-3-pro-image-preview": 14,
      "gemini-2.5-flash-image": 3,
      "gpt-image-2": 0,
    });
    expect(aspectRatios).toContain("auto");
    expect(aspectRatios).toContain("16:9");
  });

  it("omits imageConfig for gemini-2.5-flash-image with auto aspect", () => {
    expect(
      createGenerateImageConfig({
        model: "gemini-2.5-flash-image",
        aspectRatio: "auto",
        imageSize: "4K",
        thinking: "deep",
      }),
    ).toMatchObject({
      responseModalities: ["Image"],
      imageConfig: undefined,
      thinkingConfig: undefined,
    });
  });

  it("includes only aspectRatio for gemini-2.5-flash-image with non-auto aspect", () => {
    expect(
      createGenerateImageConfig({
        model: "gemini-2.5-flash-image",
        aspectRatio: "16:9",
        imageSize: "4K",
        thinking: "balanced",
      }),
    ).toMatchObject({
      imageConfig: { aspectRatio: "16:9" },
      thinkingConfig: undefined,
    });
  });

  it("includes aspectRatio and imageSize for Gemini 3 image models", () => {
    expect(
      createGenerateImageConfig({
        model: "gemini-3-pro-image-preview",
        aspectRatio: "16:9",
        imageSize: "2K",
        thinking: "balanced",
      }),
    ).toMatchObject({
      imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
      thinkingConfig: undefined,
    });
  });

  it("emits thinking config only for gemini-3.1-flash-image-preview", () => {
    expect(
      createGenerateImageConfig({
        model: "gemini-3.1-flash-image-preview",
        aspectRatio: "auto",
        imageSize: "1K",
        thinking: "deep",
      }).thinkingConfig,
    ).toEqual({ thinkingLevel: "HIGH" });

    expect(
      createGenerateImageConfig({
        model: "gemini-3-pro-image-preview",
        aspectRatio: "auto",
        imageSize: "1K",
        thinking: "deep",
      }).thinkingConfig,
    ).toBeUndefined();
  });

  it("returns the fixed-resolution warning only for gemini-2.5-flash-image", () => {
    expect(getModelFixedResolutionWarning("gemini-2.5-flash-image")).toBe(
      "Gemini 2.5 Flash Image ignores imageSize and generates at its fixed model resolution.",
    );
    expect(getModelFixedResolutionWarning("gemini-3.1-flash-image-preview")).toBeNull();
  });
});
