import { GoogleGenAI } from "@google/genai";
import { getUserProviderApiKey } from "@/lib/provider-keys";
import { createClient } from "@/lib/supabase/server";
import { persistGeneratedImages } from "@/modules/generation/persistence/persist-generated-images";
import {
  createGenerateImageConfig,
  getModelFixedResolutionWarning,
  modelLabels,
} from "@/modules/generation/services/generate-models";
import type { GenerateImageModelId } from "@/modules/generation/services/generate-models";
import { generateRequestSchema } from "@/modules/generation/services/generate-request";
import { collectText, getParts } from "@/modules/generation/services/generate-response";
import { parseBase64DataUrl } from "@/modules/generation/utils/data-url";

export const runtime = "nodejs";
export const maxDuration = 120;

function jsonError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError("Sign in to generate images.", 401);
  }

  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(user.id, "google-gemini");
  } catch {
    return jsonError("Unable to load your Gemini API key.", 500);
  }

  if (!apiKey) {
    return jsonError("Add your Gemini API key in Settings before generating.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid generation parameters.", 400, parsed.error.flatten());
  }

  const input = parsed.data;
  const ai = new GoogleGenAI({ apiKey });

  const warnings: string[] = [];
  const fixedResolutionWarning = getModelFixedResolutionWarning(input.model);
  if (fixedResolutionWarning) {
    warnings.push(fixedResolutionWarning);
  }

  const inputReferenceImages = input.referenceImages ?? (input.referenceImage ? [input.referenceImage] : []);
  const references = inputReferenceImages.map((image) => ({
    source: image,
    parsed: parseBase64DataUrl(image.dataUrl),
  }));

  const invalidReference = references.find(({ parsed }) => !parsed);
  if (invalidReference) {
    return jsonError(`${invalidReference.source.name ?? "Reference image"} must be a base64 data URL.`);
  }

  const mismatchedReference = references.find(({ source, parsed }) => parsed?.mimeType !== source.mimeType);
  if (mismatchedReference) {
    return jsonError(`${mismatchedReference.source.name ?? "Reference image"} mimeType does not match the data URL.`);
  }

  const runCount = input.count;

  async function generateOne(variant: number) {
    const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: input.prompt },
    ];

    for (const { parsed } of references) {
      if (!parsed) continue;
      contents.push({
        inlineData: {
          mimeType: parsed.mimeType,
          data: parsed.data,
        },
      });
    }

    const config = createGenerateImageConfig({
      model: input.model,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      thinking: input.thinking,
    });

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

  const settled = await Promise.allSettled(
    Array.from({ length: runCount }, (_, index) => generateOne(index)),
  );

  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);

  if (failures.length > 0) {
    console.error("Image generation failed", failures);
  }

  const successful = settled
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof generateOne>>> => {
      return result.status === "fulfilled";
    })
    .map((result) => result.value);

  const images = successful.flatMap((result) => result.images);
  const text = successful
    .map((result) => result.text)
    .filter(Boolean)
    .join("\n\n");

  if (failures.length > 0) {
    warnings.push("One or more generations failed. Please try again.");
  }

  if (images.length === 0) {
    return jsonError(text || "The model did not return an image.", failures.length ? 502 : 500, {
      warnings,
    });
  }

  try {
    const persistResult = await persistGeneratedImages({
      userId: user.id,
      prompt: input.prompt,
      model: input.model,
      modelLabel: modelLabels[input.model],
      images,
      text,
      referenceImages: inputReferenceImages,
      settings: {
        count: runCount,
        thinking: input.thinking,
        aspectRatio: input.aspectRatio,
        imageSize: input.imageSize,
        schema: input.schema,
      },
    });

    if (persistResult.warning) {
      warnings.push(persistResult.warning);
    } else if (persistResult.saved > 0) {
      warnings.push(
        `Saved ${persistResult.saved} image${persistResult.saved === 1 ? "" : "s"} to ${persistResult.storageLabel}.`,
      );
    }
  } catch (persistError) {
    console.error("Unable to persist generated images", persistError);
    warnings.push("Generated images are ready, but Kavero could not save them to Google Drive.");
  }

  return Response.json({
    model: input.model,
    modelLabel: modelLabels[input.model],
    kind: "image",
    images,
    text,
    warnings,
    settings: {
      count: runCount,
      thinking: input.thinking,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      schema: input.schema,
    },
  });
}
