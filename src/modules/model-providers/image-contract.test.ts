import { describe, expect, it } from "vitest";
import { createGeminiGenerateContentConfig, getImageModelAdapter } from "./image-adapters";
import {
  GEMINI_2_5_FLASH_IMAGE_MODEL_ALIAS,
  GEMINI_PRO_IMAGE_MODEL_ALIAS,
  OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
  getImageModelCapabilities,
  getImageModelCapabilitiesByLegacyModel,
  getSelectableImageModelCapabilities,
  validateImageGenerationIntent,
  validateLegacyImageRequest,
} from "./image-capabilities";
import {
  browserImageModels,
  getBrowserImageModels,
  normalizeBrowserImageUiSettings,
} from "./image-browser";

describe("image model configuration contract", () => {
  it("maps internal aliases and legacy public IDs without conflating them", () => {
    expect(getImageModelCapabilities(GEMINI_PRO_IMAGE_MODEL_ALIAS)?.legacyModelId).toBe("gemini-3-pro-image-preview");
    expect(getImageModelCapabilitiesByLegacyModel("gemini-3-pro-image-preview")?.modelAlias).toBe(GEMINI_PRO_IMAGE_MODEL_ALIAS);
    expect(getImageModelCapabilities(GEMINI_2_5_FLASH_IMAGE_MODEL_ALIAS)?.legacyModelId).toBe("gemini-2.5-flash-image");
    expect(getImageModelCapabilities(OPENAI_GPT_IMAGE_2_MODEL_ALIAS)?.legacyModelId).toBe("gpt-image-2");
  });

  it("projects GPT Image 2 as a text-to-image-only standalone and canvas model", () => {
    expect(getSelectableImageModelCapabilities().map((model) => model.legacyModelId)).toEqual([
      "gemini-3.1-flash-image-preview",
      "gemini-3-pro-image-preview",
      "gemini-2.5-flash-image",
      "gpt-image-2",
    ]);
    expect(getBrowserImageModels("standalone-generate").map((model) => model.displayLabel)).toEqual([
      "Nano Banana 2",
      "Nano Banana Pro",
      "Nano Banana",
      "GPT Image 2",
    ]);
    const gpt = browserImageModels.find((model) => model.legacyModelId === "gpt-image-2");
    expect(gpt).toMatchObject({
      provider: "openai",
      supportsReferenceEditing: false,
      supportsMask: false,
      maximumReferenceImages: 0,
      quality: { values: ["auto", "low", "medium", "high"], default: "auto" },
    });
    expect(getBrowserImageModels("auto-segment-isolation").some((model) => model.legacyModelId === "gpt-image-2")).toBe(false);
  });

  it("owns defaults, feature presets, reference limits, MIME types, and fixed-resolution warnings", () => {
    const flash = getImageModelCapabilitiesByLegacyModel("gemini-3.1-flash-image-preview")!;
    const fixed = getImageModelCapabilitiesByLegacyModel("gemini-2.5-flash-image")!;
    expect(flash.count.default).toBe(2);
    expect(flash.featureCountPresets["canvas-generation"]).toEqual([4, 8, 12, 16]);
    expect(flash.maximumReferenceImages).toBe(14);
    expect(flash.supportedReferenceMimeTypes).toEqual(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
    expect(fixed.maximumReferenceImages).toBe(3);
    expect(fixed.fixedResolutionWarning).toBe("Gemini 2.5 Flash Image ignores imageSize and generates at its fixed model resolution.");
  });

  it("accepts GPT text-to-image settings and rejects its references through shared validation", () => {
    expect(validateLegacyImageRequest({
      feature: "canvas-generation",
      model: "gpt-image-2",
      count: 4,
      thinking: undefined,
      aspectRatio: "auto",
      imageSize: "auto",
      referenceImages: [],
    })).toEqual([]);

    expect(validateLegacyImageRequest({
      feature: "standalone-generate",
      model: "gpt-image-2",
      count: 1,
      thinking: undefined,
      aspectRatio: "auto",
      imageSize: "auto",
      referenceImages: [{ mimeType: "image/png" }],
    }).map((issue) => issue.code)).toContain("unsupported-references");

    expect(validateLegacyImageRequest({
      feature: "canvas-generation",
      model: "gpt-image-2",
      count: 12,
      thinking: undefined,
      aspectRatio: "auto",
      imageSize: "auto",
      referenceImages: [],
    })).toContainEqual(expect.objectContaining({
      code: "invalid-count",
      message: "GPT Image 2 canvas batch size must be 4, 8.",
    }));
  });

  it("rejects unsupported model combinations through shared validation", () => {

    expect(validateLegacyImageRequest({
      feature: "standalone-generate",
      model: "gemini-2.5-flash-image",
      count: 1,
      thinking: "balanced",
      aspectRatio: "auto",
      imageSize: "1K",
      referenceImages: [
        { mimeType: "image/png" },
        { mimeType: "image/jpeg" },
        { mimeType: "image/webp" },
        { mimeType: "image/png" },
      ],
    }).map((issue) => issue.code)).toContain("too-many-references");

    expect(validateLegacyImageRequest({
      feature: "standalone-generate",
      model: "gemini-3.1-flash-image-preview",
      count: 1,
      thinking: "balanced",
      aspectRatio: "auto",
      imageSize: "1K",
      referenceImages: [{ mimeType: "image/gif" }],
    }).map((issue) => issue.code)).toContain("unsupported-mime-type");
  });

  it("fails closed for hidden GPT reference/mask and incompatible Auto Segment intents", () => {
    const issues = validateImageGenerationIntent({
      modelAlias: OPENAI_GPT_IMAGE_2_MODEL_ALIAS,
      feature: "auto-segment-isolation",
      prompt: "isolate",
      count: 1,
      aspectRatio: "auto",
      outputSize: "auto",
      quality: "auto",
      background: "auto",
      referenceImages: [{ dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png" }],
      mask: { dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png" },
    }, { requireSelectable: false });
    expect(issues.map((issue) => issue.code)).toContain("feature-incompatible");
  });

  it("builds each existing Gemini direct request configuration from the adapter owner", () => {
    expect(createGeminiGenerateContentConfig({ model: "gemini-3.1-flash-image-preview", aspectRatio: "auto", imageSize: "1K", thinking: "balanced" })).toMatchObject({
      responseModalities: ["Image"], imageConfig: { imageSize: "1K" }, thinkingConfig: { thinkingLevel: "MINIMAL" },
    });
    expect(createGeminiGenerateContentConfig({ model: "gemini-3-pro-image-preview", aspectRatio: "16:9", imageSize: "4K", thinking: "deep" })).toEqual({
      responseModalities: ["Image"], imageConfig: { aspectRatio: "16:9", imageSize: "4K" }, thinkingConfig: undefined,
    });
    expect(createGeminiGenerateContentConfig({ model: "gemini-2.5-flash-image", aspectRatio: "auto", imageSize: "4K", thinking: "fast" })).toEqual({
      responseModalities: ["Image"], imageConfig: undefined, thinkingConfig: undefined,
    });
    expect(createGeminiGenerateContentConfig({ model: "gemini-2.5-flash-image", aspectRatio: "1:1", imageSize: "4K", thinking: "fast" }).imageConfig).toEqual({ aspectRatio: "1:1" });
  });

  it("owns gateway request and response normalization", () => {
    const adapter = getImageModelAdapter("gemini-3-pro-image-preview")!;
    const request = adapter.buildRequest({
      modelAlias: GEMINI_PRO_IMAGE_MODEL_ALIAS,
      feature: "standalone-generate",
      prompt: "poster",
      count: 2,
      aspectRatio: "16:9",
      outputSize: "2K",
      background: "auto",
      referenceImages: [{ dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png", name: "Reference" }],
      reasoning: "balanced",
    });
    expect(request).toMatchObject({ transport: "json", endpoint: "litellm-chat" });
    expect(JSON.stringify(request)).toContain("Reference");
    expect(adapter.normalizeResponse({ choices: [{ message: { content: "done", images: [{ image_url: { url: "data:image/png;base64,QQ==" } }] } }] })).toEqual({
      text: "done", images: [{ dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png" }],
    });

    const openAi = getImageModelAdapter(OPENAI_GPT_IMAGE_2_MODEL_ALIAS)!;
    expect(openAi.normalizeResponse({ data: [{ b64_json: "QQ==", revised_prompt: "revised" }] })).toEqual({
      text: "revised", images: [{ dataUrl: "data:image/png;base64,QQ==", mimeType: "image/png" }],
    });
    expect(() => openAi.normalizeResponse({ data: [{ b64_json: "A" }] })).toThrow("invalid image response");
  });

  it("normalizes browser settings safely and exports no runtime owners or secret-shaped values", () => {
    expect(normalizeBrowserImageUiSettings({
      model: "missing",
      count: 99,
      aspectRatio: "missing",
      imageSize: "missing",
      reasoning: "missing",
    }, "gemini-3.1-flash-image-preview", "canvas-generation")).toEqual({
      model: "gemini-3.1-flash-image-preview",
      count: 4,
      aspectRatio: "auto",
      imageSize: "1K",
      reasoning: "balanced",
      quality: "auto",
      background: "auto",
    });
    expect(normalizeBrowserImageUiSettings({
      model: "gemini-3.1-flash-image-preview",
      count: 12,
      aspectRatio: "16:9",
      imageSize: "4K",
      reasoning: "deep",
    }, "gpt-image-2", "canvas-generation")).toMatchObject({
      model: "gpt-image-2",
      count: 4,
      aspectRatio: "auto",
      imageSize: "auto",
      reasoning: "provider-managed",
    });
    const serialized = JSON.stringify(browserImageModels);
    expect(serialized).not.toMatch(/runtime|adapter|normalizer|api[_-]?key|secret|credential/i);
  });
});
