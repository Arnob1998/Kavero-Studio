import { GoogleGenAI } from "@google/genai";
import { getUserProviderApiKey } from "@/lib/provider-keys";
import { createClient } from "@/lib/supabase/server";
import { persistGeneratedImages } from "@/modules/generation/persistence/persist-generated-images";
import {
  createGenerateImageConfig,
  getModelFixedResolutionWarning,
  modelLabels,
} from "@/modules/generation/services/generate-models";
import { generateRequestSchema, type GenerateRequestInput } from "@/modules/generation/services/generate-request";
import { collectText, getParts } from "@/modules/generation/services/generate-response";
import { parseBase64DataUrl } from "@/modules/generation/utils/data-url";
import {
  createModelGatewayEvent,
  generateLiteLlmImage,
  getModelCatalogEntry,
  getModelGatewayConfig,
  getResolvedModelProviderPreferences,
  isModelGatewayError,
  logModelGatewayEvent,
  toLoggableModelGatewayError,
  type ModelGatewayConfig,
  type ModelGatewayUsage,
  type ModelProviderId,
} from "@/modules/model-providers";
import {
  createSafeRuntimeCredentialFailureResponse,
  prepareLiteLlmImageRuntimeRequest,
  resolveImageGenerationRuntimeCredentials,
} from "@/modules/model-providers/server";

export const runtime = "nodejs";
export const maxDuration = 120;

function jsonError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}

type ImageModelSelection = {
  modelAlias: string;
  modelLabel: string;
  provider: ModelProviderId | null;
  model: string | null;
};

type GenerateReferenceImage = NonNullable<GenerateRequestInput["referenceImages"]>[number];
type ValidParsedReference = {
  source: GenerateReferenceImage;
  parsed: NonNullable<ReturnType<typeof parseBase64DataUrl>>;
};
type ParsedGenerateInput =
  | { response: Response }
  | {
      input: GenerateRequestInput;
      inputReferenceImages: GenerateReferenceImage[];
      references: ValidParsedReference[];
    };

async function parseGenerateInput(request: Request): Promise<ParsedGenerateInput> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: jsonError("Request body must be valid JSON.") };
  }

  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { response: jsonError("Invalid generation parameters.", 400, parsed.error.flatten()) };
  }

  const input = parsed.data;
  const inputReferenceImages = input.referenceImages ?? (input.referenceImage ? [input.referenceImage] : []);
  const references = inputReferenceImages.map((image) => ({
    source: image,
    parsed: parseBase64DataUrl(image.dataUrl),
  }));

  const invalidReference = references.find(({ parsed }) => !parsed);
  if (invalidReference) {
    return {
      response: jsonError(`${invalidReference.source.name ?? "Reference image"} must be a base64 data URL.`),
    };
  }

  const mismatchedReference = references.find(({ source, parsed }) => parsed?.mimeType !== source.mimeType);
  if (mismatchedReference) {
    return {
      response: jsonError(`${mismatchedReference.source.name ?? "Reference image"} mimeType does not match the data URL.`),
    };
  }

  return {
    input,
    inputReferenceImages,
    references: references.map(({ source, parsed }) => ({
      source,
      parsed: parsed as NonNullable<typeof parsed>,
    })),
  };
}

async function loadImageModelSelection({
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}): Promise<ImageModelSelection | null> {
  const { data, error } = await supabase
    .from("user_metadata")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle<{ preferences: unknown }>();

  if (error) {
    console.error("Unable to load image-generation model preferences");
    return null;
  }

  const modelAlias = getResolvedModelProviderPreferences(data?.preferences ?? {}).imageGenerationModelAlias;
  const catalogEntry = getModelCatalogEntry(modelAlias);
  return {
    modelAlias,
    modelLabel: catalogEntry?.displayLabel ?? modelAlias,
    provider: catalogEntry?.provider ?? null,
    model: catalogEntry?.model ?? null,
  };
}

function getGatewayFailureResponse(error: unknown, warnings: string[] = []) {
  if (!isModelGatewayError(error)) {
    return jsonError("Image generation failed. Please try again.", 502, { warnings });
  }

  const { errorCode, retryable, status } = error.details;

  if (status === 413) {
    return jsonError(
      "Image generation request is too large. Remove reference images or shorten the prompt and try again.",
      413,
      { warnings, upstreamStatus: status },
    );
  }

  if (errorCode === "authentication_error") {
    return jsonError("Image generation gateway was rejected. Check provider setup and try again.", 403, {
      warnings,
      upstreamStatus: status,
    });
  }

  if (status === 404) {
    return jsonError("Configured image generation model is unavailable. Check provider setup and try again.", 502, {
      warnings,
      upstreamStatus: status,
    });
  }

  if (errorCode === "rate_limited") {
    return jsonError(
      "The image generation model is temporarily busy. Please wait a moment and try again.",
      503,
      { warnings, retryable: true, upstreamStatus: status },
    );
  }

  if (errorCode === "invalid_response") {
    return jsonError("Image generation returned an invalid response.", 502, { warnings });
  }

  return jsonError("Image generation failed. Please try again.", retryable ? 503 : 502, {
    warnings,
    retryable,
    upstreamStatus: status,
  });
}

function logStandaloneGenerateGatewayEvent(input: {
  userId: string;
  selection: ImageModelSelection;
  status: "success" | "error";
  startedAt: number;
  requestId?: string | null;
  callId?: string | null;
  usage?: Partial<ModelGatewayUsage> | null;
  imageCount?: number | null;
  errorCode?: string | null;
  credentialSource: "user-byok" | "gateway-env";
}) {
  logModelGatewayEvent(
    createModelGatewayEvent({
      userId: input.userId,
      feature: "standalone-generate",
      provider: input.selection.provider,
      model: input.selection.model,
      modelAlias: input.selection.modelAlias,
      requestId: input.requestId ?? null,
      callId: input.callId ?? null,
      status: input.status,
      latencyMs: Date.now() - input.startedAt,
      usage: {
        ...(input.usage ?? {}),
        imageCount: input.imageCount ?? input.usage?.imageCount ?? null,
      },
      errorCode: input.errorCode ?? null,
      credentialSource: input.credentialSource,
    }),
  );
}

function logGenerationFailures(message: string, failures: unknown[]) {
  console.error(
    message,
    failures.map((failure) => {
      const details = toLoggableModelGatewayError(failure);
      return {
        status: details.status,
        errorCode: details.errorCode,
        provider: details.provider,
        model: details.model,
        modelAlias: details.modelAlias,
        gateway: details.gateway,
        requestId: details.requestId,
        callId: details.callId,
        retryable: details.retryable,
      };
    }),
  );
}

async function handleDirectGeminiGeneration(request: Request, userId: string): Promise<Response> {
  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(userId, "google-gemini");
  } catch {
    return jsonError("Unable to load your Gemini API key.", 500);
  }

  if (!apiKey) {
    return jsonError("Add your Gemini API key in Settings before generating.", 403);
  }

  const parsed = await parseGenerateInput(request);
  if ("response" in parsed) return parsed.response;

  const { input, inputReferenceImages, references } = parsed;
  const ai = new GoogleGenAI({ apiKey });

  const warnings: string[] = [];
  const fixedResolutionWarning = getModelFixedResolutionWarning(input.model);
  if (fixedResolutionWarning) {
    warnings.push(fixedResolutionWarning);
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
      userId,
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

async function handleGatewayGeneration({
  request,
  supabase,
  userId,
  config,
}: {
  request: Request;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  config: Extract<ModelGatewayConfig, { status: "configured" }>;
}): Promise<Response> {
  const parsed = await parseGenerateInput(request);
  if ("response" in parsed) return parsed.response;

  const { input, inputReferenceImages } = parsed;
  const loadedSelection = await loadImageModelSelection({ supabase, userId });
  if (!loadedSelection) {
    return jsonError("Unable to load image generation model settings.", 500);
  }
  const selection: ImageModelSelection = loadedSelection;

  const credentials = await resolveImageGenerationRuntimeCredentials({
    userId,
    modelAlias: selection.modelAlias,
  });
  if (!credentials.ok) {
    return createSafeRuntimeCredentialFailureResponse("Image generation", credentials);
  }
  const prepared = prepareLiteLlmImageRuntimeRequest(credentials);
  if (!("transformRequestBody" in prepared)) {
    return createSafeRuntimeCredentialFailureResponse("Image generation", prepared);
  }
  const { transformRequestBody, credentialSource } = prepared;

  const warnings: string[] = [];
  const runCount = input.count;

  async function generateOne(variant: number) {
    const startedAt = Date.now();
    try {
      const result = await generateLiteLlmImage({
        config,
        modelAlias: selection.modelAlias,
        provider: selection.provider,
        model: selection.model,
        prompt: input.prompt,
        settings: {
          legacyModel: input.model,
          count: runCount,
          thinking: input.thinking,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
          schema: input.schema,
        },
        referenceImages: inputReferenceImages.map((image) => ({
          dataUrl: image.dataUrl,
          mimeType: image.mimeType,
          name: image.name,
        })),
        transformRequestBody,
      });

      logStandaloneGenerateGatewayEvent({
        userId,
        selection,
        status: "success",
        startedAt,
        requestId: result.requestId,
        callId: result.callId,
        usage: result.usage,
        imageCount: result.images.length,
        credentialSource,
      });

      return {
        text: result.text,
        images: result.images.map((image, imageIndex) => ({
          id: `${Date.now()}-${variant}-${imageIndex}`,
          variant: variant + 1,
          mimeType: image.mimeType,
          dataUrl: image.dataUrl,
          text: result.text,
        })),
      };
    } catch (error) {
      const details = isModelGatewayError(error) ? error.details : null;
      logStandaloneGenerateGatewayEvent({
        userId,
        selection,
        status: "error",
        startedAt,
        requestId: details?.requestId ?? null,
        callId: details?.callId ?? null,
        errorCode: details?.errorCode ?? "provider_error",
        credentialSource,
      });
      throw error;
    }
  }

  const settled = await Promise.allSettled(
    Array.from({ length: runCount }, (_, index) => generateOne(index)),
  );

  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);

  if (failures.length > 0) {
    logGenerationFailures("Image generation gateway failed", failures);
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
    return failures.length > 0
      ? getGatewayFailureResponse(failures[0], warnings)
      : jsonError(text || "The model did not return an image.", 500, { warnings });
  }

  try {
    const persistResult = await persistGeneratedImages({
      userId,
      prompt: input.prompt,
      model: selection.modelAlias,
      modelLabel: selection.modelLabel,
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
    model: selection.modelAlias,
    modelLabel: selection.modelLabel,
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

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError("Sign in to generate images.", 401);
  }

  const gatewayConfig = getModelGatewayConfig();
  if (gatewayConfig.status === "disabled") {
    return handleDirectGeminiGeneration(request, user.id);
  }

  if (gatewayConfig.status === "error") {
    return jsonError("Image generation model gateway is not configured correctly.", 503, {
      code: "model-gateway-configuration",
    });
  }

  return handleGatewayGeneration({
    request,
    supabase,
    userId: user.id,
    config: gatewayConfig,
  });
}
