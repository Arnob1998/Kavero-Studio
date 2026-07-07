import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getCanvasUser, jsonError, requireCanvasAccess } from "@/lib/canvas/api";
import { getUserProviderApiKey } from "@/lib/provider-keys";
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
  createLiteLlmClient,
  getModelGatewayConfig,
  isModelGatewayError,
} from "@/modules/model-providers";

const imageInputSchema = z.object({
  id: z.string().trim().min(1).max(160),
  dataUrl: z.string().min(1).max(8 * 1024 * 1024),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});

const canvasPreviewSchema = z.object({
  dataUrl: z.string().min(1).max(8 * 1024 * 1024),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
});

const judgeRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(4000),
  canvasPreview: canvasPreviewSchema.optional().nullable(),
  candidates: z.array(imageInputSchema).min(1).max(4),
});

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function extractWinnerId(text: string, candidateIds: string[]) {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as { winnerId?: unknown };
    if (typeof parsed.winnerId === "string" && candidateIds.includes(parsed.winnerId)) return parsed.winnerId;
  } catch {
    // Fall back to tolerant text matching below.
  }
  return candidateIds.find((id) => trimmed.includes(id)) ?? candidateIds[0];
}

export async function handleImageJudgeRequest(request: Request) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const gatewayConfig = getModelGatewayConfig();
  if (gatewayConfig.status === "error") {
    return createSafeGatewayConfigurationResponse("Image Judge");
  }

  const parsed = judgeRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid judge parameters.", details: parsed.error.flatten() }, { status: 400 });

  const input = parsed.data;
  const candidateIds = input.candidates.map((candidate) => candidate.id);
  if (gatewayConfig.status === "configured") {
    return handleGatewayImageJudge({ input, candidateIds, userId: user.id, config: gatewayConfig });
  }

  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(user.id, "google-gemini");
  } catch {
    return jsonError("Unable to load your Gemini API key.", 500);
  }
  if (!apiKey) return jsonError("Add your Gemini API key in Settings before judging images.", 403);

  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: JSON.stringify(buildJudgeTaskPayload(input.prompt, candidateIds), null, 2),
    },
  ];

  if (input.canvasPreview) {
    const preview = parseDataUrl(input.canvasPreview.dataUrl);
    if (preview && preview.mimeType === input.canvasPreview.mimeType) {
      parts.push({ text: "Current canvas preview:" });
      parts.push({ inlineData: { mimeType: preview.mimeType, data: preview.data } });
    }
  }

  for (const candidate of input.candidates) {
    const parsedCandidate = parseDataUrl(candidate.dataUrl);
    if (!parsedCandidate || parsedCandidate.mimeType !== candidate.mimeType) return jsonError(`Candidate ${candidate.id} is malformed.`);
    parts.push({ text: `Candidate ${candidate.id}:` });
    parts.push({ inlineData: { mimeType: parsedCandidate.mimeType, data: parsedCandidate.data } });
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: process.env.CANVAS_ASSISTANT_MODEL ?? "gemini-3.1-pro-preview",
    contents: [{ role: "user", parts }],
    config: {
      responseMimeType: "application/json",
      systemInstruction:
        "You are a strict visual judge. Return only compact JSON. Prefer the image that best satisfies the user's intent, fits the canvas context, has clean composition, and has usable edges for canvas placement.",
    },
  });

  const text = response.text ?? "";
  const winnerId = extractWinnerId(text, candidateIds);
  return Response.json({ winnerId, reason: text.slice(0, 1000) });
}

function buildJudgeTaskPayload(prompt: string, candidateIds: string[]) {
  return {
    task: "Pick the single best generated candidate for the active Kavero canvas.",
    userIntent: prompt,
    responseFormat: { winnerId: "candidate id", reason: "short reason" },
    candidateIds,
  };
}

function buildGatewayJudgeContent(input: z.infer<typeof judgeRequestSchema>, candidateIds: string[]) {
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: JSON.stringify(buildJudgeTaskPayload(input.prompt, candidateIds), null, 2) },
  ];

  if (input.canvasPreview) {
    content.push({ type: "text", text: "Current canvas preview:" });
    content.push({ type: "image_url", image_url: { url: input.canvasPreview.dataUrl } });
  }

  for (const candidate of input.candidates) {
    content.push({ type: "text", text: `Candidate ${candidate.id}:` });
    content.push({ type: "image_url", image_url: { url: candidate.dataUrl } });
  }

  return content;
}

async function handleGatewayImageJudge({
  input,
  candidateIds,
  userId,
  config,
}: {
  input: z.infer<typeof judgeRequestSchema>;
  candidateIds: string[];
  userId: string;
  config: ConfiguredGatewayConfig;
}) {
  for (const candidate of input.candidates) {
    const parsedCandidate = parseDataUrl(candidate.dataUrl);
    if (!parsedCandidate || parsedCandidate.mimeType !== candidate.mimeType) return jsonError(`Candidate ${candidate.id} is malformed.`);
  }
  if (input.canvasPreview) {
    const preview = parseDataUrl(input.canvasPreview.dataUrl);
    if (!preview || preview.mimeType !== input.canvasPreview.mimeType) return jsonError("Canvas preview is malformed.");
  }

  const resolved = await resolveCanvasAiChatModelSelection({
    userId,
    featureLabel: "Image Judge",
  });
  if (!resolved.ok) return resolved.response;

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
            role: "system",
            content:
              "You are a strict visual judge. Return only compact JSON. Prefer the image that best satisfies the user's intent, fits the canvas context, has clean composition, and has usable edges for canvas placement.",
          },
          { role: "user", content: buildGatewayJudgeContent(input, candidateIds) },
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
      feature: "image-judge",
      selection: resolved.selection,
      status: "success",
      startedAt,
      requestId: response.requestId,
      callId: response.callId,
      usage: response.usage,
    });

    const text = collectLiteLlmAssistantText(response.data);
    const parsed = jsonFromText(text) as { winnerId?: unknown; reason?: unknown } | null;
    if (!parsed || typeof parsed.winnerId !== "string" || !candidateIds.includes(parsed.winnerId)) {
      return jsonError("Image Judge returned an invalid response.", 502);
    }
    return Response.json({
      winnerId: parsed.winnerId,
      reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 1000) : text.slice(0, 1000),
    });
  } catch (error) {
    const details = isModelGatewayError(error) ? error.details : null;
    logCanvasAiGatewayEvent({
      userId,
      feature: "image-judge",
      selection: resolved.selection,
      status: "error",
      startedAt,
      requestId: details?.requestId ?? null,
      callId: details?.callId ?? null,
      errorCode: details?.errorCode ?? "provider_error",
    });
    return createSafeGatewayFailureResponse(error, "Image Judge");
  }
}
