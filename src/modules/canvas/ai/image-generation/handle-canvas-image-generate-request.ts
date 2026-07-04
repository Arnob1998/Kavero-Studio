import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";
import { z } from "zod";
import { getCanvasUser, jsonError, requireCanvasAccess } from "@/lib/canvas/api";
import { getUserProviderApiKey } from "@/lib/provider-keys";

const imageModelIds = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
] as const;

const referenceImageLimits: Record<(typeof imageModelIds)[number], number> = {
  "gemini-3.1-flash-image-preview": 14,
  "gemini-3-pro-image-preview": 14,
  "gemini-2.5-flash-image": 3,
};

const aspectRatios = [
  "auto",
  "1:1",
  "9:16",
  "16:9",
  "3:4",
  "4:3",
  "3:2",
  "2:3",
  "5:4",
  "4:5",
  "21:9",
  "4:1",
  "1:4",
  "8:1",
  "1:8",
] as const;

type ModelId = (typeof imageModelIds)[number];

const modelLabels: Record<ModelId, string> = {
  "gemini-3.1-flash-image-preview": "Nano Banana 2",
  "gemini-3-pro-image-preview": "Nano Banana Pro",
  "gemini-2.5-flash-image": "Nano Banana",
};

const referenceImageSchema = z.object({
  dataUrl: z.string().min(1).max(8 * 1024 * 1024),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]),
  name: z.string().optional(),
});

const generateRequestSchema = z
  .object({
    prompt: z.string().trim().min(1).max(12000),
    model: z.enum(imageModelIds).default("gemini-3.1-flash-image-preview"),
    count: z.coerce.number().int().refine((value) => [4, 8, 12, 16].includes(value), "Batch size must be 4, 8, 12, or 16."),
    thinking: z.enum(["fast", "balanced", "deep"]).default("balanced"),
    aspectRatio: z.enum(aspectRatios).default("auto"),
    imageSize: z.enum(["1K", "2K", "4K"]).default("1K"),
    transparentBackground: z.boolean().default(false),
    backgroundPreference: z.enum(["auto", "white", "black"]).default("auto"),
    referenceImages: z.array(referenceImageSchema).nullish(),
  })
  .superRefine((input, context) => {
    const referenceImages = input.referenceImages ?? [];
    const limit = referenceImageLimits[input.model];

    if (referenceImages.length > limit) {
      context.addIssue({
        code: z.ZodIssueCode.too_big,
        type: "array",
        maximum: limit,
        inclusive: true,
        path: ["referenceImages"],
        message: `${modelLabels[input.model]} supports up to ${limit} reference images.`,
      });
    }
  });

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function thinkingLevel(value: "fast" | "balanced" | "deep") {
  return value === "deep" ? ThinkingLevel.HIGH : ThinkingLevel.MINIMAL;
}

function getParts(response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>) {
  return response.candidates?.[0]?.content?.parts ?? [];
}

function collectText(parts: ReturnType<typeof getParts>) {
  return parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n\n");
}

function promptForCanvasGeneration(prompt: string, transparent: boolean, backgroundPreference: "auto" | "white" | "black") {
  if (!transparent) return prompt;
  const background =
    backgroundPreference === "black"
      ? "pure black (#000000)"
      : backgroundPreference === "white"
        ? "pure white (#ffffff)"
        : "whichever pure white (#ffffff) or pure black (#000000) background gives the strongest edge contrast";
  return `${prompt}

Create the requested object or illustration isolated on a perfectly flat ${background} background. The background must be a single solid color with no shadows, texture, gradients, reflections, or horizon line. Keep the subject fully inside the frame with clean edges so the background can be removed programmatically.`;
}

export async function handleCanvasImageGenerateRequest(request: Request) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(user.id, "google-gemini");
  } catch {
    return jsonError("Unable to load your Gemini API key.", 500);
  }

  if (!apiKey) return jsonError("Add your Gemini API key in Settings before generating.", 403);

  const body = await request.json().catch(() => null);
  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Invalid generation parameters.", details: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;
  const ai = new GoogleGenAI({ apiKey });
  const warnings: string[] = [];
  if (input.model === "gemini-2.5-flash-image") {
    warnings.push("Gemini 2.5 Flash Image ignores imageSize and generates at its fixed model resolution.");
  }
  if (input.transparentBackground) {
    warnings.push("Transparent images are generated on a high-contrast solid background and cleaned in the canvas editor.");
  }

  const references = (input.referenceImages ?? []).map((image) => ({
    source: image,
    parsed: parseDataUrl(image.dataUrl),
  }));

  const invalidReference = references.find(({ parsed }) => !parsed);
  if (invalidReference) return jsonError(`${invalidReference.source.name ?? "Reference image"} must be a base64 data URL.`);

  const mismatchedReference = references.find(({ source, parsed }) => parsed?.mimeType !== source.mimeType);
  if (mismatchedReference) return jsonError(`${mismatchedReference.source.name ?? "Reference image"} mimeType does not match the data URL.`);

  async function generateOne(variant: number) {
    const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: promptForCanvasGeneration(input.prompt, input.transparentBackground, input.backgroundPreference) },
    ];

    for (const { parsed } of references) {
      if (!parsed) continue;
      contents.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
    }

    const imageConfig =
      input.aspectRatio === "auto"
        ? input.model === "gemini-2.5-flash-image"
          ? undefined
          : { imageSize: input.imageSize }
        : input.model === "gemini-2.5-flash-image"
          ? { aspectRatio: input.aspectRatio }
          : { aspectRatio: input.aspectRatio, imageSize: input.imageSize };

    const config: GenerateContentConfig = {
      responseModalities: ["Image"],
      imageConfig,
      thinkingConfig:
        input.model === "gemini-3.1-flash-image-preview"
          ? { thinkingLevel: thinkingLevel(input.thinking) }
          : undefined,
    };

    const response = await ai.models.generateContent({
      model: input.model,
      contents,
      config,
    });

    const parts = getParts(response);
    const text = collectText(parts);
    const images = parts
      .filter((part) => !part.thought && part.inlineData?.data)
      .map((part, imageIndex) => ({
        id: `${Date.now()}-${variant}-${imageIndex}`,
        variant: variant + 1,
        mimeType: part.inlineData?.mimeType || "image/png",
        dataUrl: `data:${part.inlineData?.mimeType || "image/png"};base64,${part.inlineData?.data}`,
        text,
      }));
    return { text, images };
  }

  const settled = await Promise.allSettled(Array.from({ length: input.count }, (_, index) => generateOne(index)));
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) {
    console.error("Canvas image generation failed", failures.map((result) => result.reason));
    warnings.push("One or more generations failed. Please try again.");
  }

  const successful = settled
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof generateOne>>> => result.status === "fulfilled")
    .map((result) => result.value);
  const images = successful.flatMap((result) => result.images);
  const text = successful.map((result) => result.text).filter(Boolean).join("\n\n");

  if (images.length === 0) {
    return Response.json({ error: text || "The model did not return an image.", details: { warnings } }, { status: failures.length ? 502 : 500 });
  }

  return Response.json({
    model: input.model,
    modelLabel: modelLabels[input.model],
    kind: "image",
    images,
    text,
    warnings,
    settings: {
      count: input.count,
      thinking: input.thinking,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      transparentBackground: input.transparentBackground,
      backgroundPreference: input.backgroundPreference,
    },
  });
}
