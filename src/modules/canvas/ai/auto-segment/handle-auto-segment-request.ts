import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";
import { z } from "zod";
import { getGoogleDriveAccessTokenForUser, markGoogleDriveReconnectRequired } from "@/lib/google-drive";
import { getCanvasUser, jsonError, requireCanvasAccess, requireCanvasAdmin } from "@/lib/canvas/api";
import { getUserProviderApiKey } from "@/lib/provider-keys";
import { getCanvasAssetStorageRef } from "@/modules/assets/canvas-asset-storage-refs";
import { readStorageObject } from "@/modules/storage/dispatch/storage-object-dispatch";
import { getRuntimeManagedStorageDispatchDependencies } from "@/modules/storage/managed/runtime";
import {
  collectLiteLlmAssistantText,
  createSafeGatewayConfigurationResponse,
  createSafeGatewayFailureResponse,
  jsonFromText,
  logCanvasAiGatewayEvent,
  resolveCanvasAiChatModelSelection,
  type ConfiguredGatewayConfig,
} from "@/modules/canvas/ai/shared/chat-orchestration";
import {
  createModelGatewayEvent,
  generateLiteLlmImage,
  getModelCatalogEntry,
  createLiteLlmClient,
  getModelGatewayConfig,
  getResolvedModelProviderPreferences,
  isModelGatewayError,
  logModelGatewayEvent,
  toLoggableModelGatewayError,
  type ModelGatewayConfig,
  type ModelGatewayUsage,
  type ModelProviderId,
} from "@/modules/model-providers";

const categoryKeys = ["background", "people", "products", "objects", "text_graphics", "other"] as const;
const imageModelIds = [
  "gemini-3.1-flash-image-preview",
  "gemini-3-pro-image-preview",
  "gemini-2.5-flash-image",
] as const;

type CategoryKey = (typeof categoryKeys)[number];
type SegmentPlan = z.infer<typeof segmentPlanSchema>;
type PlannedSegment = SegmentPlan["segments"][number];
type GeneratedSegment =
  | (PlannedSegment & {
      status: "ready";
      image: {
        dataUrl: string;
        mimeType: "image/png" | "image/jpeg" | "image/webp";
      };
    })
  | (PlannedSegment & {
      status: "failed";
      error: string;
    });
type ImageModelSelection = {
  modelAlias: string;
  modelLabel: string;
  provider: ModelProviderId | null;
  model: string | null;
};

const categoryLabels: Record<CategoryKey, string> = {
  background: "Background",
  people: "People",
  products: "Products",
  objects: "Objects",
  text_graphics: "Text & Graphics",
  other: "Other",
};

const autoSegmentRequestSchema = z.object({
  assetId: z.string().trim().regex(/^[a-zA-Z0-9_-]+$/),
  sourceName: z.string().trim().max(160).optional(),
  model: z.enum(imageModelIds).default("gemini-3.1-flash-image-preview"),
  imageSize: z.enum(["1K", "2K", "4K"]).default("1K"),
});

const segmentPlanSchema = z.object({
  segments: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(80),
        label: z.string().trim().min(1).max(80),
        category: z.enum(categoryKeys),
        elementType: z.string().trim().min(1).max(80).optional(),
        location: z.string().trim().min(1).max(120),
        visualIdentity: z.string().trim().min(1).max(220),
        nearbyAnchors: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
        bounds: z
          .object({
            x: z.coerce.number().min(0).max(1),
            y: z.coerce.number().min(0).max(1),
            width: z.coerce.number().min(0).max(1),
            height: z.coerce.number().min(0).max(1),
          })
          .optional(),
        description: z.string().trim().min(1).max(500),
        exclude: z.array(z.string().trim().min(1).max(160)).max(8).optional(),
        isolationPrompt: z.string().trim().min(1).max(900),
        confidence: z.coerce.number().min(0).max(1).optional(),
      }),
    )
    .max(18),
});

function normalizeSegmentIdentity(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|main|primary|single|isolated|segment|part|object|item|block|badge)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeSegments(segments: z.infer<typeof segmentPlanSchema>["segments"]) {
  const seen = new Set<string>();
  const deduped: typeof segments = [];
  for (const segment of segments) {
    const identity = normalizeSegmentIdentity(
      `${segment.category} ${segment.elementType ?? ""} ${segment.location} ${segment.visualIdentity} ${(segment.nearbyAnchors ?? []).join(" ")} ${segment.label}`,
    );
    const key = identity || segment.id;
    if (seen.has(key)) continue;
    if (deduped.some((existing) => isLikelyDuplicateSegment(existing, segment))) continue;
    seen.add(key);
    deduped.push(segment);
  }
  return deduped;
}

function isLikelyDuplicateSegment(
  a: z.infer<typeof segmentPlanSchema>["segments"][number],
  b: z.infer<typeof segmentPlanSchema>["segments"][number],
) {
  if (!a.bounds || !b.bounds) return false;
  const sameType = normalizeSegmentIdentity(`${a.category} ${a.elementType ?? ""}`) === normalizeSegmentIdentity(`${b.category} ${b.elementType ?? ""}`);
  if (!sameType) return false;
  return boundsIoU(a.bounds, b.bounds) > 0.62;
}

function boundsIoU(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a.y, b.y));
  const intersection = ix * iy;
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
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

function safeJson(text: string) {
  return jsonFromText(text);
}

async function mapConcurrent<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
  const results: R[] = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function responseResult(value: unknown): value is { response: Response } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "response" in value &&
      (value as { response?: unknown }).response instanceof Response,
  );
}

export async function handleAutoSegmentRequest(request: Request): Promise<Response> {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const parsed = autoSegmentRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid Auto Segment parameters.", details: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;
  const { data: asset, error } = await admin
    .from("canvas_assets")
    .select(
      "id, original_name, content_type, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    )
    .eq("id", input.assetId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return jsonError("Unable to load source asset.", 500);
  if (!asset) return jsonError("Source image was not found.", 404);
  if (!["image/png", "image/jpeg", "image/webp"].includes(asset.content_type)) {
    return jsonError("Auto Segment supports PNG, JPG, or WebP source images.", 400);
  }
  const storageRef = getCanvasAssetStorageRef(asset);
  if (!storageRef) return jsonError("Source image is missing in Google Drive.", 404);
  if (storageRef.status === "missing") {
    return jsonError(
      storageRef.providerId === "google-drive"
        ? "Source image is missing in Google Drive."
        : "Source image is missing in storage.",
      404,
    );
  }
  if (
    storageRef.providerId !== "google-drive" &&
    storageRef.providerId !== "kavero-managed" &&
    storageRef.providerId !== "supabase-storage"
  ) {
    return jsonError("Storage provider is not supported for Auto Segment source reads yet.", 501);
  }

  const gatewayConfig = getModelGatewayConfig();
  if (gatewayConfig.status === "error") {
    return createSafeGatewayConfigurationResponse("Auto Segment");
  }

  if (gatewayConfig.status === "disabled") {
    return handleDirectGeminiAutoSegment({
      userId: user.id,
      asset,
      sourceName: input.sourceName || asset.original_name || "source image",
      storageRef,
      input,
    });
  }

  const sourceRead = await readSourceImageBytes({ userId: user.id, storageRef });
  if ("response" in sourceRead) return sourceRead.response;

  const sourceBase64 = sourceRead.sourceBase64;
  const sourceName = input.sourceName || asset.original_name || "source image";

  const planPayload = await getGatewaySegmentPlanPayload({
    config: gatewayConfig,
    userId: user.id,
    admin,
    sourceName,
    mimeType: asset.content_type,
    sourceBase64,
  });
  if (responseResult(planPayload)) return planPayload.response;

  const selectionResult = await loadImageModelSelection({ userId: user.id, admin });
  if (!selectionResult.ok) return selectionResult.response;

  return createAutoSegmentResponse({
    planPayload,
    sourceAsset: {
      id: asset.id,
      name: sourceName,
      contentType: asset.content_type,
    },
    isolateSegment: (segment, warnings) =>
      isolateSegmentWithGateway({
        config: gatewayConfig,
        userId: user.id,
        selection: selectionResult.selection,
        segment,
        sourceBase64,
        mimeType: asset.content_type,
        warnings,
      }),
  });
}

async function handleDirectGeminiAutoSegment({
  userId,
  asset,
  sourceName,
  storageRef,
  input,
}: {
  userId: string;
  asset: {
    id: string;
    original_name: string | null;
    content_type: string;
  };
  sourceName: string;
  storageRef: NonNullable<ReturnType<typeof getCanvasAssetStorageRef>>;
  input: z.infer<typeof autoSegmentRequestSchema>;
}): Promise<Response> {
  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(userId, "google-gemini");
  } catch {
    return jsonError("Unable to load your Gemini API key.", 500);
  }
  if (!apiKey) return jsonError("Add your Gemini API key in Settings before using Auto Segment.", 403);

  const sourceRead = await readSourceImageBytes({ userId, storageRef });
  if ("response" in sourceRead) return sourceRead.response;

  const sourceBase64 = sourceRead.sourceBase64;
  const ai = new GoogleGenAI({ apiKey });
  const planPayload = await getDirectGeminiSegmentPlanPayload({ ai, sourceName, mimeType: asset.content_type, sourceBase64 });

  return createAutoSegmentResponse({
    planPayload,
    sourceAsset: {
      id: asset.id,
      name: sourceName,
      contentType: asset.content_type,
    },
    isolateSegment: (segment, warnings) =>
      isolateSegmentWithDirectGemini({
        ai,
        segment,
        input,
        sourceBase64,
        mimeType: asset.content_type,
        warnings,
      }),
  });
}

async function createAutoSegmentResponse({
  planPayload,
  sourceAsset,
  isolateSegment,
}: {
  planPayload: unknown;
  sourceAsset: {
    id: string;
    name: string;
    contentType: string;
  };
  isolateSegment: (segment: PlannedSegment, warnings: string[]) => Promise<GeneratedSegment>;
}): Promise<Response> {
  const plan = segmentPlanSchema.safeParse(planPayload);
  if (!plan.success || plan.data.segments.length === 0) {
    return Response.json({ error: "The image model could not identify usable segments." }, { status: 502 });
  }

  const segmentsToIsolate = dedupeSegments(plan.data.segments);

  const warnings: string[] = [];
  if (segmentsToIsolate.length < plan.data.segments.length) {
    warnings.push("Duplicate segment suggestions were removed.");
  }

  const generated = await mapConcurrent(segmentsToIsolate, 4, (segment) => isolateSegment(segment, warnings));

  const categories = categoryKeys
    .map((key) => ({
      key,
      label: categoryLabels[key],
      segments: generated.filter((segment) => segment.category === key),
    }))
    .filter((category) => category.segments.length > 0);

  return Response.json({
    sessionId: crypto.randomUUID(),
    sourceAsset: {
      id: sourceAsset.id,
      name: sourceAsset.name,
      contentType: sourceAsset.contentType,
      publicUrl: `/api/canvas/assets/${sourceAsset.id}`,
    },
    categories,
    warnings,
  });
}

async function isolateSegmentWithDirectGemini({
  ai,
  segment,
  input,
  sourceBase64,
  mimeType,
  warnings,
}: {
  ai: GoogleGenAI;
  segment: PlannedSegment;
  input: z.infer<typeof autoSegmentRequestSchema>;
  sourceBase64: string;
  mimeType: string;
  warnings: string[];
}): Promise<GeneratedSegment> {
  const imageConfig: GenerateContentConfig["imageConfig"] =
    input.model === "gemini-2.5-flash-image" ? undefined : { imageSize: input.imageSize };
  try {
    const isolateResponse = await ai.models.generateContent({
      model: input.model,
      contents: [
        {
          role: "user",
          parts: [
            { text: buildMaskPrompt(segment) },
            { inlineData: { mimeType, data: sourceBase64 } },
          ],
        },
      ],
      config: {
        responseModalities: ["Image"],
        imageConfig,
        thinkingConfig: input.model === "gemini-3.1-flash-image-preview" ? { thinkingLevel: ThinkingLevel.MINIMAL } : undefined,
      },
    });
    const imagePart = getParts(isolateResponse).find((part) => !part.thought && part.inlineData?.data);
    if (!imagePart?.inlineData?.data) throw new Error(collectText(getParts(isolateResponse)) || "No image returned.");
    return {
      ...segment,
      status: "ready",
      image: {
        dataUrl: `data:${imagePart.inlineData.mimeType || "image/png"};base64,${imagePart.inlineData.data}`,
        mimeType: (imagePart.inlineData.mimeType || "image/png") as "image/png" | "image/jpeg" | "image/webp",
      },
    };
  } catch (segmentError) {
    warnings.push(`Unable to isolate ${segment.label}.`);
    return {
      ...segment,
      status: "failed",
      error: segmentError instanceof Error ? segmentError.message : "Isolation failed.",
    };
  }
}

function buildMaskPrompt(segment: PlannedSegment) {
  return `Create a segmentation mask for exactly one existing visual element from the source image.

${segment.isolationPrompt}

Segmentation target: ${segment.label}
Location: ${segment.location}
Target description: ${segment.description}
Specific identity: ${segment.visualIdentity}
Nearby anchors: ${(segment.nearbyAnchors ?? ["none"]).join("; ")}
Do not include: ${(segment.exclude ?? ["all other text, icons, cards, background, and nearby UI elements"]).join("; ")}

This is a mask task, not an image generation task. Do not reproduce the original colors, text, logo, icon, object, lighting, shadows, or design.

Output only a clean binary mask: pure white (#ffffff) where the target element exists, pure black (#000000) everywhere else. Keep the mask aligned to the full source image canvas, not cropped. For text targets, white must cover only the actual glyph/letter pixels and their anti-aliased edges, not the rectangular text box, background, or spaces between letters/lines. Do not include multiple planned segments. Do not include gray previews, colored pixels, labels, outlines, UI, or the original artwork. White target mask on black background only.`;
}

function buildSegmentPlanningPayload(sourceName: string) {
  return {
    task: "Analyze this image and create an atomic segmentation plan for a design editor.",
    sourceName,
    categories: categoryLabels,
    rules: [
      "Use only universal categories.",
      "First identify the actual distinct visible elements: text blocks by location, logos, icons, badges, product/device/card objects, lines, callouts, and meaningful standalone graphics.",
      "Do a complete visual inventory before returning segments. Include all meaningful standalone editable elements unless they are tiny/incidental.",
      "Decide whether each visible element should be a segment. Do not force every category to exist.",
      "Do not include a background segment when the image has a flat solid background, transparent/no meaningful background, or a background that is not useful as an editable layer.",
      "Do not include decorative, tiny, repeated, or incidental details unless they are meaningful standalone editable elements.",
      "Break the image into atomic editable parts. One segment must be one visible element, not a composite region or screenshot crop.",
      "Text must be segmented as logical text blocks by location, for example upper-left heading, upper-left subheading, bottom caption, upper-right logo text. Do not create one segment containing all text unless the text is one block.",
      "Objects must be segmented as the specific object only, for example left device card, right email card, warning badge, logo mark, vertical divider line.",
      "Never make a segment that includes unrelated surrounding text, headings, icons, cards, shadows, or nearby UI elements.",
      "Do not duplicate the same visual part under multiple labels or categories.",
      "If multiple similar or repeated elements exist, create separate segments only when they are distinct visible elements, and make each one uniquely identifiable.",
      "For every segment, include visualIdentity: the most specific visible traits that distinguish it, such as exact text, icon symbol, color, shape, orientation, order, label, state, or content.",
      "For every segment, include nearbyAnchors: nearby text, icons, objects, or relative order that distinguishes it from similar elements.",
      "For every segment, include bounds as approximate normalized coordinates {x,y,width,height} around only that element, where 0..1 is relative to the full image.",
      "Labels must be specific, not generic. Use names like 'upper-left headline text Catch Risky Sharing', 'right tilted email destination card', 'red Threat detected badge', or 'bottom privacy policy bullet row'.",
      "For each segment, include exclude: a short list of nearby elements that must not appear in that segment.",
      "For each segment, write isolationPrompt as a direct prompt for an image model. It must say exactly what to keep, where it is located, how to distinguish it from similar elements, what to remove, and to use a flat pure white or pure black background chosen for strongest edge contrast.",
      "If you cannot uniquely locate a segment, do not include it.",
      "Prefer complete meaningful parts over tiny fragments, but do not group unrelated objects together.",
      "Return at most 18 segments. If there are more than 18 meaningful elements, prioritize large and reusable elements first.",
    ],
    responseFormat: {
      segments: [
        {
          id: "stable-kebab-id",
          label: "short label",
          category: "objects",
          elementType: "logo | heading text | subheading text | icon | badge | card | line | product object",
          location: "upper right / upper left / center / bottom left / etc.",
          visualIdentity: "specific visible text, color, icon, shape, orientation, order, and other traits that distinguish this exact element",
          nearbyAnchors: ["nearby heading", "left of specific card", "second bullet row"],
          bounds: { x: 0.72, y: 0.05, width: 0.18, height: 0.08 },
          description: "the single exact visible element to isolate",
          exclude: ["nearby heading", "other card", "background"],
          isolationPrompt:
            "Keep only the upper-right Magier logo mark and Magier text, distinguished by the yellow rounded-square icon and black wordmark. Remove the headline, subheading, product cards, badges, icons, divider lines, and background. Put the unchanged logo on a perfectly flat pure white or pure black background, whichever gives the strongest edge contrast.",
          confidence: 0.9,
        },
      ],
    },
  };
}

async function getDirectGeminiSegmentPlanPayload({
  ai,
  sourceName,
  mimeType,
  sourceBase64,
}: {
  ai: GoogleGenAI;
  sourceName: string;
  mimeType: string;
  sourceBase64: string;
}) {
  const planResponse = await ai.models.generateContent({
    model: process.env.CANVAS_ASSISTANT_MODEL ?? "gemini-3.1-pro-preview",
    contents: [
      {
        role: "user",
        parts: [
          { text: JSON.stringify(buildSegmentPlanningPayload(sourceName), null, 2) },
          { inlineData: { mimeType, data: sourceBase64 } },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    },
  });

  return safeJson(planResponse.text ?? collectText(getParts(planResponse)));
}

async function getGatewaySegmentPlanPayload({
  config,
  userId,
  admin,
  sourceName,
  mimeType,
  sourceBase64,
}: {
  config: ConfiguredGatewayConfig;
  userId: string;
  admin: NonNullable<ReturnType<typeof requireCanvasAdmin>["admin"]>;
  sourceName: string;
  mimeType: string;
  sourceBase64: string;
}): Promise<unknown | { response: Response }> {
  const resolved = await resolveCanvasAiChatModelSelection({
    userId,
    admin,
    featureLabel: "Auto Segment",
  });
  if (!resolved.ok) return { response: resolved.response };

  const client = createLiteLlmClient({ config });
  const startedAt = Date.now();
  try {
    const response = await client.chatCompletions(
      {
        model: resolved.selection.modelAlias,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: JSON.stringify(buildSegmentPlanningPayload(sourceName), null, 2) },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${sourceBase64}` } },
            ],
          },
        ],
      },
      {
        provider: resolved.selection.provider,
        model: resolved.selection.model,
        modelAlias: resolved.selection.modelAlias,
      },
    );
    logCanvasAiGatewayEvent({
      userId,
      feature: "auto-segment-planning",
      selection: resolved.selection,
      status: "success",
      startedAt,
      requestId: response.requestId,
      callId: response.callId,
      usage: response.usage,
    });
    return jsonFromText(collectLiteLlmAssistantText(response.data));
  } catch (error) {
    const details = isModelGatewayError(error) ? error.details : null;
    logCanvasAiGatewayEvent({
      userId,
      feature: "auto-segment-planning",
      selection: resolved.selection,
      status: "error",
      startedAt,
      requestId: details?.requestId ?? null,
      callId: details?.callId ?? null,
      errorCode: details?.errorCode ?? "provider_error",
    });
    return { response: createSafeGatewayFailureResponse(error, "Auto Segment") };
  }
}

async function loadImageModelSelection({
  userId,
  admin,
}: {
  userId: string;
  admin: NonNullable<ReturnType<typeof requireCanvasAdmin>["admin"]>;
}): Promise<{ ok: true; selection: ImageModelSelection } | { ok: false; response: Response }> {
  const { data, error } = await admin
    .from("user_metadata")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle<{ preferences: unknown }>();

  if (error) {
    console.error("Unable to load Auto Segment image generation model preferences");
    return { ok: false, response: jsonError("Unable to load Auto Segment model settings.", 500) };
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

async function isolateSegmentWithGateway({
  config,
  userId,
  selection,
  segment,
  sourceBase64,
  mimeType,
  warnings,
}: {
  config: Extract<ModelGatewayConfig, { status: "configured" }>;
  userId: string;
  selection: ImageModelSelection;
  segment: PlannedSegment;
  sourceBase64: string;
  mimeType: string;
  warnings: string[];
}): Promise<GeneratedSegment> {
  const startedAt = Date.now();
  try {
    const result = await generateLiteLlmImage({
      config,
      modelAlias: selection.modelAlias,
      provider: selection.provider,
      model: selection.model,
      prompt: buildMaskPrompt(segment),
      settings: {
        legacyModel: "auto-segment-mask",
        count: 1,
        thinking: "balanced",
        aspectRatio: "auto",
        imageSize: "source-aligned",
        schema: "auto-segment-mask",
      },
      referenceImages: [
        {
          dataUrl: `data:${mimeType};base64,${sourceBase64}`,
          mimeType,
          name: "auto-segment-source",
        },
      ],
      taskLabel: "auto-segment-isolation",
    });

    logAutoSegmentImageGatewayEvent({
      userId,
      selection,
      status: "success",
      startedAt,
      requestId: result.requestId,
      callId: result.callId,
      usage: result.usage,
      imageCount: result.images.length,
    });

    const image = result.images[0];
    return {
      ...segment,
      status: "ready",
      image: {
        dataUrl: image.dataUrl,
        mimeType: image.mimeType as "image/png" | "image/jpeg" | "image/webp",
      },
    };
  } catch (error) {
    const details = isModelGatewayError(error) ? error.details : null;
    logAutoSegmentImageGatewayEvent({
      userId,
      selection,
      status: "error",
      startedAt,
      requestId: details?.requestId ?? null,
      callId: details?.callId ?? null,
      errorCode: details?.errorCode ?? "provider_error",
    });
    logAutoSegmentGatewayIsolationFailure(error);
    warnings.push(`Unable to isolate ${segment.label}.`);
    return {
      ...segment,
      status: "failed",
      error: "Isolation failed.",
    };
  }
}

function logAutoSegmentImageGatewayEvent(input: {
  userId: string;
  selection: ImageModelSelection;
  status: "success" | "error";
  startedAt: number;
  requestId?: string | null;
  callId?: string | null;
  usage?: Partial<ModelGatewayUsage> | null;
  imageCount?: number | null;
  errorCode?: string | null;
}) {
  logModelGatewayEvent(
    createModelGatewayEvent({
      userId: input.userId,
      feature: "auto-segment-isolation",
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
    }),
  );
}

function logAutoSegmentGatewayIsolationFailure(error: unknown) {
  const details = toLoggableModelGatewayError(error);
  console.error("Auto Segment gateway isolation failed", {
    status: details.status,
    errorCode: details.errorCode,
    provider: details.provider,
    model: details.model,
    modelAlias: details.modelAlias,
    gateway: details.gateway,
    requestId: details.requestId,
    callId: details.callId,
    retryable: details.retryable,
  });
}

async function readSourceImageBytes({
  userId,
  storageRef,
}: {
  userId: string;
  storageRef: NonNullable<ReturnType<typeof getCanvasAssetStorageRef>>;
}): Promise<{ sourceBase64: string } | { response: Response }> {
  if (storageRef.providerId === "google-drive") {
    const driveFileId = storageRef.externalId ?? storageRef.objectKey;
    let accessToken: string | null;
    try {
      accessToken = await getGoogleDriveAccessTokenForUser(userId);
    } catch {
      return { response: jsonError("Google Drive needs to be reconnected.", 409) };
    }
    if (!accessToken) return { response: jsonError("Google Drive is not connected.", 409) };

    const driveResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!driveResponse.ok) {
      if (driveResponse.status === 401 || driveResponse.status === 403) {
        await markGoogleDriveReconnectRequired(userId);
        return { response: jsonError("Google Drive needs to be reconnected.", 409) };
      }
      return { response: jsonError("Unable to load source image from Google Drive.", 502) };
    }

    return { sourceBase64: Buffer.from(await driveResponse.arrayBuffer()).toString("base64") };
  }

  const dependenciesResult = getRuntimeManagedStorageDispatchDependencies();
  if (!dependenciesResult.ok) {
    console.error("Managed Auto Segment source storage is not configured", dependenciesResult.error);
    return { response: jsonError("Managed storage is not configured.", 502) };
  }

  const readResult = await readStorageObject({
    userId,
    ref: storageRef,
    dependencies: dependenciesResult.dependencies,
  });
  if (!readResult.ok) {
    if (readResult.reason === "missing") {
      return { response: jsonError("Source image is missing in storage.", 404) };
    }
    console.error("Unable to load Auto Segment source image from managed storage", readResult);
    return { response: jsonError("Unable to load source image from managed storage.", 502) };
  }

  try {
    return {
      sourceBase64: Buffer.from(await readDataToUint8Array(readResult.object.data)).toString("base64"),
    };
  } catch (error) {
    console.error("Unable to normalize Auto Segment source image bytes", error);
    return { response: jsonError("Unable to load source image from managed storage.", 502) };
  }
}

async function readDataToUint8Array(data: unknown) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (isBlobLike(data)) return new Uint8Array(await data.arrayBuffer());

  if (isWebReadableStreamLike(data)) {
    const reader = data.getReader();
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        chunks.push(toUint8ArrayChunk(result.value));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks);
  }

  if (isAsyncIterable(data)) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of data) {
      chunks.push(toUint8ArrayChunk(chunk));
    }
    return Buffer.concat(chunks);
  }

  if (isIterable(data)) {
    const chunks: Uint8Array[] = [];
    for (const chunk of data) {
      chunks.push(toUint8ArrayChunk(chunk));
    }
    return Buffer.concat(chunks);
  }

  throw new Error("Unsupported managed storage read data shape.");
}

function toUint8ArrayChunk(chunk: unknown) {
  if (chunk instanceof Uint8Array) return chunk;
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength);
  if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
  if (typeof chunk === "string") return new TextEncoder().encode(chunk);
  throw new Error("Unsupported managed storage read chunk shape.");
}

function isBlobLike(value: unknown): value is { arrayBuffer: () => Promise<ArrayBuffer> } {
  return Boolean(
    value &&
      typeof value === "object" &&
      "arrayBuffer" in value &&
      typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function",
  );
}

function isWebReadableStreamLike(value: unknown): value is {
  getReader: () => {
    read: () => Promise<ReadableStreamReadResult<unknown>>;
    releaseLock?: () => void;
  };
} {
  return Boolean(
    value &&
      typeof value === "object" &&
      "getReader" in value &&
      typeof (value as { getReader?: unknown }).getReader === "function",
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.asyncIterator in value &&
      typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function",
  );
}

function isIterable(value: unknown): value is Iterable<unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      Symbol.iterator in value &&
      typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === "function",
  );
}
