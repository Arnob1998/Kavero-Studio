import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getCanvasAdmin, getCanvasUser, jsonError, requireCanvasAccess } from "@/lib/canvas/api";
import { getUserProviderApiKey } from "@/lib/provider-keys";
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
import { createGeminiGenerateContentConfig } from "@/modules/model-providers/image-adapters";
import { getBrowserImageModelByLegacyId } from "@/modules/model-providers/image-browser";
import { DEFAULT_IMAGE_MODEL_LEGACY_ID, getImageModelCapabilities, getImageModelCapabilitiesByLegacyModel, validateLegacyImageRequest, type ImageGenerationIntent, type SelectableLegacyImageModelId } from "@/modules/model-providers/image-capabilities";

type ModelId = SelectableLegacyImageModelId;

const referenceImageSchema = z.object({
  dataUrl: z.string().min(1).max(8 * 1024 * 1024),
  mimeType: z.string().min(1),
  name: z.string().optional(),
});

const generateRequestStructure = z
  .object({
    prompt: z.string().trim().min(1).max(12000),
    model: z.string().default(DEFAULT_IMAGE_MODEL_LEGACY_ID),
    count: z.coerce.number().int(),
    thinking: z.string().default("balanced"),
    aspectRatio: z.string().default("auto"),
    imageSize: z.string().default("1K"),
    quality: z.string().default("auto"),
    background: z.enum(["auto", "opaque", "transparent"]).default("auto"),
    transparentBackground: z.boolean().default(false),
    backgroundPreference: z.enum(["auto", "white", "black"]).default("auto"),
    referenceImages: z.array(referenceImageSchema).nullish(),
    mask: z.unknown().optional(),
  });

type GenerateRequestInput = Omit<z.infer<typeof generateRequestStructure>, "model" | "thinking" | "backgroundPreference"> & {
  model: ModelId;
  thinking: "fast" | "balanced" | "deep" | "provider-managed";
  backgroundPreference: "auto" | "white" | "black";
};

const generateRequestSchema = generateRequestStructure
  .superRefine((input, context) => {
    if (input.mask !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["mask"], message: "Mask-based image editing is not available." });
    }
    const referenceImages = input.referenceImages ?? [];
    const issues = validateLegacyImageRequest({
      feature: "canvas-generation",
      model: input.model,
      count: input.count,
      thinking: input.thinking,
      aspectRatio: input.aspectRatio,
      imageSize: input.imageSize,
      referenceImages,
    });
    for (const issue of issues) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: issue.field === "modelAlias" ? ["model"] : issue.field === "outputSize" ? ["imageSize"] : issue.field === "reasoning" ? ["thinking"] : issue.field === "referenceImages.mimeType" ? ["referenceImages"] : [issue.field],
        message: issue.message,
      });
    }
  })
  .transform((input) => input as GenerateRequestInput);
type ReferenceImage = NonNullable<GenerateRequestInput["referenceImages"]>[number];
type ParsedReference = {
  source: ReferenceImage;
  parsed: NonNullable<ReturnType<typeof parseDataUrl>>;
};
type ParsedCanvasGenerateInput =
  | { response: Response }
  | {
      input: GenerateRequestInput;
      references: ParsedReference[];
      inputReferenceImages: ReferenceImage[];
    };
type ImageModelSelection = {
  modelAlias: string;
  modelLabel: string;
  provider: ModelProviderId | null;
  model: string | null;
};

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
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

async function parseCanvasGenerateInput(request: Request): Promise<ParsedCanvasGenerateInput> {
  const body = await request.json().catch(() => null);
  const parsed = generateRequestSchema.safeParse(body);
  if (!parsed.success) {
    return {
      response: Response.json(
        { error: "Invalid generation parameters.", details: parsed.error.flatten() },
        { status: 400 },
      ),
    };
  }

  const input = parsed.data;
  const references = (input.referenceImages ?? []).map((image) => ({
    source: image,
    parsed: parseDataUrl(image.dataUrl),
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
    inputReferenceImages: input.referenceImages ?? [],
    references: references.map(({ source, parsed }) => ({
      source,
      parsed: parsed as NonNullable<typeof parsed>,
    })),
  };
}

function createWarnings(input: GenerateRequestInput) {
  const warnings: string[] = [];
  const fixedResolutionWarning = getBrowserImageModelByLegacyId(input.model)?.fixedResolutionWarning;
  if (fixedResolutionWarning) warnings.push(fixedResolutionWarning);
  if (input.transparentBackground) {
    warnings.push("Transparent images are generated on a high-contrast solid background and cleaned in the canvas editor.");
  }
  return warnings;
}

function responseSettings(input: GenerateRequestInput) {
  return {
    count: input.count,
    thinking: input.thinking,
    aspectRatio: input.aspectRatio,
    imageSize: input.imageSize,
    quality: input.quality,
    background: input.background,
    transparentBackground: input.transparentBackground,
    backgroundPreference: input.backgroundPreference,
  };
}

function safeGatewayConfigurationResponse() {
  return Response.json(
    {
      error: "Canvas image generation model gateway is not configured correctly.",
      details: { code: "model-gateway-configuration" },
    },
    { status: 503 },
  );
}

function gatewayJsonError(message: string, status: number, details: Record<string, unknown>) {
  return Response.json({ error: message, details }, { status });
}

async function loadImageModelSelection(userId: string): Promise<{ ok: true; selection: ImageModelSelection } | { ok: false; response: Response }> {
  const admin = getCanvasAdmin();
  if (!admin) return { ok: false, response: jsonError("Unable to load image generation model settings.", 500) };

  const { data, error } = await admin
    .from("user_metadata")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle<{ preferences: unknown }>();

  if (error) {
    console.error("Unable to load canvas image generation model preferences");
    return { ok: false, response: jsonError("Unable to load image generation model settings.", 500) };
  }

  const modelAlias = getResolvedModelProviderPreferences(data?.preferences ?? {}).imageGenerationModelAlias;
  const catalogEntry = getModelCatalogEntry(modelAlias);
  return {
    ok: true,
    selection: {
      modelAlias,
      modelLabel: catalogEntry?.displayLabel ?? modelAlias,
      provider: catalogEntry?.provider ?? null,
      model: catalogEntry?.model ?? null,
    },
  };
}

function getGatewayFailureResponse(error: unknown, warnings: string[] = []) {
  if (!isModelGatewayError(error)) {
    return gatewayJsonError("Canvas image generation failed. Please try again.", 502, { warnings });
  }

  const { errorCode, retryable, status } = error.details;
  if (status === 413) {
    return gatewayJsonError(
      "Canvas image generation request is too large. Remove reference images or shorten the prompt and try again.",
      413,
      { warnings, upstreamStatus: status },
    );
  }
  if (errorCode === "authentication_error") {
    return gatewayJsonError("Canvas image generation gateway was rejected. Check provider setup and try again.", 403, {
      warnings,
      upstreamStatus: status,
    });
  }
  if (status === 404) {
    return gatewayJsonError("Configured canvas image generation model is unavailable. Check provider setup and try again.", 502, {
      warnings,
      upstreamStatus: status,
    });
  }
  if (errorCode === "rate_limited") {
    return gatewayJsonError(
      "The canvas image generation model is temporarily busy. Please wait a moment and try again.",
      503,
      { warnings, retryable: true, upstreamStatus: status },
    );
  }
  if (errorCode === "invalid_response") {
    return gatewayJsonError("Canvas image generation returned an invalid response.", 502, { warnings });
  }
  return gatewayJsonError("Canvas image generation failed. Please try again.", retryable ? 503 : 502, {
    warnings,
    retryable,
    upstreamStatus: status,
  });
}

function logCanvasImageGatewayEvent(input: {
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
      feature: "canvas-image-generation",
      slot: "imageGeneration",
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

function logGatewayFailures(failures: unknown[]) {
  console.error(
    "Canvas image generation gateway failed",
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

async function handleDirectGeminiCanvasGeneration(request: Request, userId: string) {
  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(userId, "google-gemini");
  } catch {
    return jsonError("Unable to load your Gemini API key.", 500);
  }

  if (!apiKey) return jsonError("Add your Gemini API key in Settings before generating.", 403);

  const parsed = await parseCanvasGenerateInput(request);
  if ("response" in parsed) return parsed.response;

  const { input, references } = parsed;
  if (getImageModelCapabilitiesByLegacyModel(input.model)?.provider !== "gemini") {
    return jsonError("The selected image model requires the configured model gateway.", 503);
  }
  const ai = new GoogleGenAI({ apiKey });
  const warnings = createWarnings(input);

  async function generateOne(variant: number) {
    const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
      { text: promptForCanvasGeneration(input.prompt, input.transparentBackground, input.backgroundPreference) },
    ];

    for (const { parsed } of references) {
      if (!parsed) continue;
      contents.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
    }

    const config = createGeminiGenerateContentConfig({
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
    modelLabel: getBrowserImageModelByLegacyId(input.model)?.displayLabel ?? input.model,
    kind: "image",
    images,
    text,
    warnings,
    settings: responseSettings(input),
  });
}

async function handleGatewayCanvasGeneration({
  request,
  userId,
  config,
}: {
  request: Request;
  userId: string;
  config: Extract<ModelGatewayConfig, { status: "configured" }>;
}) {
  const parsed = await parseCanvasGenerateInput(request);
  if ("response" in parsed) return parsed.response;

  const { input, inputReferenceImages } = parsed;
  const selectionResult = await loadImageModelSelection(userId);
  if (!selectionResult.ok) return selectionResult.response;

  const selection = selectionResult.selection;
  const requestCapability = getImageModelCapabilitiesByLegacyModel(input.model);
  const selectedCapability = getImageModelCapabilities(selection.modelAlias);
  if (!requestCapability || !selectedCapability || requestCapability.provider !== selectedCapability.provider) {
    return jsonError("The requested image model does not match the image provider selected in Settings.", 400);
  }
  const runtimeCapability = selectedCapability;
  const credentials = await resolveImageGenerationRuntimeCredentials({
    userId,
    modelAlias: selection.modelAlias,
  });
  if (!credentials.ok) {
    return createSafeRuntimeCredentialFailureResponse("Canvas image generation", credentials);
  }
  const prepared = prepareLiteLlmImageRuntimeRequest(credentials);
  if (!("transformRequestBody" in prepared)) {
    return createSafeRuntimeCredentialFailureResponse("Canvas image generation", prepared);
  }
  const { transformRequestBody, credentialSource } = prepared;
  const warnings = createWarnings(input);
  const prompt = promptForCanvasGeneration(input.prompt, input.transparentBackground, input.backgroundPreference);

  async function generateOne(variant: number) {
    const startedAt = Date.now();
    try {
      const intent: ImageGenerationIntent = {
        modelAlias: selection.modelAlias,
        feature: "canvas-generation",
        prompt,
        count: 1,
        aspectRatio: input.aspectRatio,
        outputSize: input.imageSize,
        quality: runtimeCapability.quality.values.length > 0 ? input.quality : undefined,
        background: input.background,
        referenceImages: inputReferenceImages.map((image) => ({ dataUrl: image.dataUrl, mimeType: image.mimeType, name: image.name })),
        reasoning: runtimeCapability.reasoning.values.length > 0 ? input.thinking : undefined,
      };
      const result = await generateLiteLlmImage({
        config,
        modelAlias: selection.modelAlias,
        provider: selection.provider,
        model: selection.model,
        prompt,
        intent,
        settings: {
          legacyModel: input.model,
          count: input.count,
          thinking: input.thinking,
          aspectRatio: input.aspectRatio,
          imageSize: input.imageSize,
          schema: "canvas",
        },
        referenceImages: inputReferenceImages.map((image) => ({
          dataUrl: image.dataUrl,
          mimeType: image.mimeType,
          name: image.name,
        })),
        taskLabel: "canvas-image-generation",
        transformRequestBody,
      });

      logCanvasImageGatewayEvent({
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
      logCanvasImageGatewayEvent({
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

  const settled = await Promise.allSettled(Array.from({ length: input.count }, (_, index) => generateOne(index)));
  const failures = settled
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    logGatewayFailures(failures);
    warnings.push("One or more generations failed. Please try again.");
  }

  const successful = settled
    .filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof generateOne>>> => result.status === "fulfilled")
    .map((result) => result.value);
  const images = successful.flatMap((result) => result.images);
  const text = successful.map((result) => result.text).filter(Boolean).join("\n\n");

  if (images.length === 0) {
    return failures.length > 0
      ? getGatewayFailureResponse(failures[0], warnings)
      : Response.json({ error: text || "The model did not return an image.", details: { warnings } }, { status: 500 });
  }

  return Response.json({
    model: selection.modelAlias,
    modelLabel: selection.modelLabel,
    kind: "image",
    images,
    text,
    warnings,
    settings: responseSettings(input),
  });
}

export async function handleCanvasImageGenerateRequest(request: Request) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const gatewayConfig = getModelGatewayConfig();
  if (gatewayConfig.status === "disabled") {
    return handleDirectGeminiCanvasGeneration(request, user.id);
  }
  if (gatewayConfig.status === "error") {
    return safeGatewayConfigurationResponse();
  }

  return handleGatewayCanvasGeneration({
    request,
    userId: user.id,
    config: gatewayConfig,
  });
}
