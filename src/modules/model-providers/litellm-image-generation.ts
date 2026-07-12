import {
  createModelGatewayError,
} from "./errors";
import { createLiteLlmClient } from "./litellm-client";
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

export async function generateLiteLlmImage(
  input: GenerateLiteLlmImageInput,
): Promise<LiteLlmImageGenerationResult> {
  const client = createLiteLlmClient({ config: input.config });
  const context = {
    provider: input.provider,
    model: input.model,
    modelAlias: input.modelAlias,
  };
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
    requestId: response.requestId,
    callId: response.callId,
    usage: response.usage,
  };
}
