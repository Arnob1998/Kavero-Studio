import {
  createModelGatewayError,
} from "./errors";
import { createLiteLlmClient } from "./litellm-client";
import { getImageModelAdapter } from "./image-adapters";
import type { ImageGenerationIntent } from "./image-capabilities";
export { OPENAI_GPT_IMAGE_2_MODEL_ALIAS } from "./image-capabilities";
import type {
  ModelGatewayConfig,
  ModelGatewayUsage,
  ModelProviderId,
} from "./types";

export type LiteLlmImageReference = {
  dataUrl: string;
  mimeType: string;
  name?: string;
};

export type LiteLlmImageGenerationSettings = {
  legacyModel: string;
  count: number;
  thinking: string;
  aspectRatio: string;
  imageSize: string;
  schema: string;
};

export type LiteLlmGeneratedImage = {
  dataUrl: string;
  mimeType: string;
};

export type LiteLlmImageGenerationResult = {
  text: string;
  images: LiteLlmGeneratedImage[];
  warnings: string[];
  requestId: string | null;
  callId: string | null;
  usage: ModelGatewayUsage;
};

type GenerateLiteLlmImageInput = {
  config: Extract<ModelGatewayConfig, { status: "configured" }>;
  modelAlias: string;
  provider: ModelProviderId | null;
  model: string | null;
  prompt: string;
  intent?: ImageGenerationIntent;
  settings: LiteLlmImageGenerationSettings;
  referenceImages: LiteLlmImageReference[];
  taskLabel?: string;
  transformRequestBody?: (body: Record<string, unknown>) => Record<string, unknown>;
};

function parseBase64DataUrl(value: string) {
  const match = value.match(/^data:([^;]+);base64,([A-Za-z0-9+/=_-]+)$/);
  if (!match) return null;
  return {
    mimeType: match[1],
    data: match[2],
  };
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function collectAssistantText(message: Record<string, unknown>) {
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      const partRecord = objectOrNull(part);
      if (!partRecord) return "";
      return typeof partRecord.text === "string" ? partRecord.text.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

function imageUrlFromMessageImage(value: unknown) {
  const image = objectOrNull(value);
  if (!image) return null;

  const imageUrl = image.image_url;
  if (typeof imageUrl === "string") return imageUrl;

  const imageUrlRecord = objectOrNull(imageUrl);
  const url = imageUrlRecord?.url;
  return typeof url === "string" ? url : null;
}

function getFirstAssistantMessage(data: unknown) {
  const root = objectOrNull(data);
  const choices = Array.isArray(root?.choices) ? root.choices : [];
  const firstChoice = objectOrNull(choices[0]);
  return objectOrNull(firstChoice?.message);
}

function getOpenAiImageWarnings(settings: LiteLlmImageGenerationSettings) {
  const warnings: string[] = [];
  if (settings.thinking !== "balanced") {
    warnings.push("GPT Image 2 uses provider-managed image reasoning; the selected thinking level was not sent.");
  }
  if (settings.aspectRatio !== "auto") {
    warnings.push("GPT Image 2 used automatic output dimensions; the selected aspect ratio was not sent.");
  }
  if (settings.imageSize !== "1K" && settings.imageSize !== "source-aligned") {
    warnings.push("GPT Image 2 used automatic output dimensions; the selected image size was not sent.");
  }
  return warnings;
}

function normalizeOpenAiImageData(data: unknown, context: Record<string, unknown>) {
  const root = objectOrNull(data);
  const entries = Array.isArray(root?.data) ? root.data : [];
  const images: LiteLlmGeneratedImage[] = [];
  const revisedPrompts: string[] = [];

  for (const entry of entries) {
    const record = objectOrNull(entry);
    const base64 = typeof record?.b64_json === "string" ? record.b64_json : null;
    if (!base64 || !/^[A-Za-z0-9+/=_-]+$/.test(base64)) {
      throw createModelGatewayError(
        "LiteLLM returned an invalid image response.",
        context,
        "invalid_response",
      );
    }
    images.push({ dataUrl: `data:image/png;base64,${base64}`, mimeType: "image/png" });
    if (typeof record?.revised_prompt === "string" && record.revised_prompt.trim()) {
      revisedPrompts.push(record.revised_prompt.trim());
    }
  }

  if (images.length === 0) {
    throw createModelGatewayError(
      "LiteLLM returned no generated images.",
      context,
      "invalid_response",
    );
  }

  return { images, text: revisedPrompts.join("\n\n") };
}

export async function generateLiteLlmImage(
  input: GenerateLiteLlmImageInput,
): Promise<LiteLlmImageGenerationResult> {
  const client = createLiteLlmClient({ config: input.config });
  const context = {
    provider: input.provider,
    model: input.model,
    modelAlias: input.modelAlias,
  };

  if (input.intent) {
    const adapter = getImageModelAdapter(input.intent.modelAlias);
    if (!adapter) throw createModelGatewayError("Unknown image model adapter.", context, "provider_error");
    const request = adapter.buildRequest(input.intent);
    if (request.transport === "json" && request.endpoint === "openai-generations") {
      const body = input.transformRequestBody ? input.transformRequestBody(request.body) : request.body;
      const response = await client.generateImage(body, context);
      const normalized = normalizeOpenAiImageData(response.data, { ...context, requestId: response.requestId, callId: response.callId });
      return { ...normalized, warnings: [], requestId: response.requestId, callId: response.callId, usage: response.usage };
    }
    throw createModelGatewayError(
      request.transport === "multipart"
        ? "Image reference and mask editing is not available."
        : "This image adapter is not enabled for product requests.",
      context,
      "provider_error",
    );
  }

  if (input.provider === "openai" && input.model === "gpt-image-2") {
    if (input.referenceImages.length > 0) {
      throw createModelGatewayError(
        "GPT Image 2 reference editing is not available.",
        context,
        "provider_error",
      );
    }
    const body = {
      model: input.modelAlias,
      prompt: input.prompt,
      n: 1,
      size: "auto",
      quality: "auto",
    };
    const transformedBody = input.transformRequestBody ? input.transformRequestBody(body) : body;
    const response = await client.generateImage(transformedBody, context);
    const responseContext = {
      ...context,
      requestId: response.requestId,
      callId: response.callId,
    };
    const normalized = normalizeOpenAiImageData(response.data, responseContext);
    return {
      ...normalized,
      warnings: getOpenAiImageWarnings(input.settings),
      requestId: response.requestId,
      callId: response.callId,
      usage: response.usage,
    };
  }
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: JSON.stringify(
        {
          task: "Generate an image for Kavero.",
          taskLabel: input.taskLabel ?? "standalone-generate",
          prompt: input.prompt,
          settings: input.settings,
          referenceImages: input.referenceImages.map((image, index) => ({
            index: index + 1,
            name: image.name ?? `Reference ${index + 1}`,
            mimeType: image.mimeType,
          })),
        },
        null,
        2,
      ),
    },
  ];

  for (const image of input.referenceImages) {
    content.push({
      type: "image_url",
      image_url: {
        url: image.dataUrl,
      },
    });
  }

  const body = {
      model: input.modelAlias,
      modalities: ["image", "text"],
      messages: [{ role: "user", content }],
    };
  const response = await client.chatCompletions(
    input.transformRequestBody ? input.transformRequestBody(body) : body,
    context,
  );

  const message = getFirstAssistantMessage(response.data);
  const text = message ? collectAssistantText(message) : "";
  const rawImages = Array.isArray(message?.images) ? message.images : [];
  const images = rawImages.map((rawImage) => {
    const dataUrl = imageUrlFromMessageImage(rawImage);
    const parsed = dataUrl ? parseBase64DataUrl(dataUrl) : null;
    if (!dataUrl || !parsed) {
      throw createModelGatewayError(
        "LiteLLM returned an invalid image response.",
        {
          ...context,
          requestId: response.requestId,
          callId: response.callId,
        },
        "invalid_response",
      );
    }

    return {
      dataUrl,
      mimeType: parsed.mimeType,
    };
  });

  if (images.length === 0) {
    throw createModelGatewayError(
      "LiteLLM returned no generated images.",
      {
        ...context,
        requestId: response.requestId,
        callId: response.callId,
      },
      "invalid_response",
    );
  }

  return {
    text,
    images,
    warnings: [],
    requestId: response.requestId,
    callId: response.callId,
    usage: response.usage,
  };
}
