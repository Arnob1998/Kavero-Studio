import type { ImageGenerationIntent, ImageModelCapabilities, ImageReference } from "./image-capabilities";
import { getImageModelCapabilities } from "./image-capabilities";

export type ImageAdapterJsonRequest = {
  transport: "json";
  endpoint: "gemini-generate-content" | "openai-generations";
  body: Record<string, unknown>;
};

export type ImageAdapterMultipartPart = {
  name: string;
  value: string | Uint8Array;
  fileName?: string;
  contentType?: string;
};

export type ImageAdapterMultipartRequest = {
  transport: "multipart";
  endpoint: "openai-edits";
  fields: Record<string, string | number>;
  images: ImageReference[];
  mask?: ImageReference;
};

export type ImageAdapterRequest = ImageAdapterJsonRequest | ImageAdapterMultipartRequest;

export type ImageModelAdapter = {
  provider: ImageModelCapabilities["provider"];
  buildRequest(intent: ImageGenerationIntent): ImageAdapterRequest;
};

function parseDataUrl(value: string) {
  const match = value.match(/^data:([^;]+);base64,([A-Za-z0-9+/=_-]+)$/);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

function geminiImageConfig(capability: ImageModelCapabilities, intent: ImageGenerationIntent) {
  if (capability.model === "gemini-2.5-flash-image") {
    return intent.aspectRatio === "auto" ? undefined : { aspectRatio: intent.aspectRatio };
  }
  return {
    ...(intent.aspectRatio === "auto" ? {} : { aspectRatio: intent.aspectRatio }),
    imageSize: intent.outputSize,
  };
}

const geminiAdapter: ImageModelAdapter = {
  provider: "gemini",
  buildRequest(intent) {
    const capability = getImageModelCapabilities(intent.modelAlias);
    if (!capability || capability.provider !== "gemini") throw new Error("Unknown Gemini image model.");
    const parts: Array<Record<string, unknown>> = [{ text: intent.prompt }];
    for (const reference of intent.referenceImages) {
      const parsed = parseDataUrl(reference.dataUrl);
      if (!parsed) throw new Error("Invalid reference image data URL.");
      parts.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
    }
    const imageConfig = geminiImageConfig(capability, intent);
    const thinkingConfig = capability.reasoning.values.length
      ? { thinkingLevel: intent.reasoning === "deep" ? "HIGH" : "MINIMAL" }
      : undefined;
    return {
      transport: "json",
      endpoint: "gemini-generate-content",
      body: {
        contents: [{ role: "user", parts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          ...(imageConfig ? { imageConfig } : {}),
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      },
    };
  },
};

const openAiAdapter: ImageModelAdapter = {
  provider: "openai",
  buildRequest(intent) {
    const fields: Record<string, string | number> = {
      model: intent.modelAlias,
      prompt: intent.prompt,
      n: intent.count,
      size: intent.outputSize,
      quality: intent.quality ?? "auto",
      background: intent.background,
    };
    if (intent.referenceImages.length > 0 || intent.mask) {
      return {
        transport: "multipart",
        endpoint: "openai-edits",
        fields,
        images: intent.referenceImages,
        mask: intent.mask,
      };
    }
    return { transport: "json", endpoint: "openai-generations", body: fields };
  },
};

export const imageModelAdapterRegistry: Record<ImageModelCapabilities["provider"], ImageModelAdapter> = {
  gemini: geminiAdapter,
  openai: openAiAdapter,
};

export function getImageModelAdapter(modelAlias: string): ImageModelAdapter | null {
  const capability = getImageModelCapabilities(modelAlias);
  return capability ? imageModelAdapterRegistry[capability.provider] : null;
}
