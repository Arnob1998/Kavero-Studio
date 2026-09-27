import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";
import {
  createLiteLlmClient,
  createModelGatewayEvent,
  getChatCompletionParameterOverrides,
  getModelCatalogEntry,
  getModelGatewayConfig,
  getResolvedModelProviderPreferences,
  isModelGatewayError,
  logModelGatewayEvent,
} from "@/modules/model-providers";
import {
  createSafeRuntimeCredentialFailureResponse,
  getResolvedChatPolicyModel,
  prepareLiteLlmRuntimeRequest,
  resolveChatOrchestrationRuntimeCredentials,
} from "@/modules/model-providers/server";
import { getUserProviderApiKey } from "@/lib/provider-keys";
import { createClient } from "@/lib/supabase/server";
import {
  sequencePlanJsonSchema,
  sequencePlanRequestSchema,
  validateAndNormalizeSequencePlan,
  validateSequenceCapabilities,
  type SequencePlanRequestInput,
  type SequencePlannerReferenceInput,
} from "@/modules/generation/sequence";

export const runtime = "nodejs";
export const maxDuration = 60;

const SEQUENCE_PLANNER_SYSTEM_PROMPT = `You create a reviewable image-sequence plan for Kavero Studio. Return exactly one JSON object matching the supplied schema.

Plan a bounded ordered set of images. Do not generate images and do not claim that consistency is guaranteed.
- Choose 2 to 12 frames and explain why that count fits the user's goal.
- Keep shared visual rules concise and concrete. Use null when a category is irrelevant.
- Give every frame a unique stable ID, a purpose, and a complete image-generation prompt.
- Use only reference IDs supplied by the application. Assign references only where they materially help.
- Dependencies may point only to earlier frame IDs. Add them only for real content or continuity dependencies.
- Put uncertainty in assumptions and practical consistency or model limitations in warnings.
- Preserve exact requested wording when text must appear in an image.`;

function jsonError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}

function parseJsonObject(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function collectChatMessageContent(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const choices = "choices" in data ? (data as { choices?: unknown }).choices : null;
  if (!Array.isArray(choices)) return "";
  const message = choices[0] && typeof choices[0] === "object" && "message" in choices[0]
    ? (choices[0] as { message?: unknown }).message
    : null;
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (!part || typeof part !== "object" || !("text" in part)) return "";
    return typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text.trim() : "";
  }).filter(Boolean).join("\n");
}

function collectGeminiText(response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>) {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n");
}

function parseDataUrl(value: string) {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value);
  if (!match) return null;
  try {
    return { mimeType: match[1].toLowerCase(), data: match[2], byteSize: Buffer.from(match[2], "base64").byteLength };
  } catch {
    return null;
  }
}

function validateReferences(references: readonly SequencePlannerReferenceInput[]) {
  for (const reference of references) {
    const parsed = parseDataUrl(reference.dataUrl);
    if (!parsed) return `${reference.label} must be a base64 data URL.`;
    if (parsed.mimeType !== reference.mimeType) return `${reference.label} MIME type does not match its data URL.`;
    if (parsed.byteSize !== reference.byteSize) return `${reference.label} byte size does not match its data URL.`;
  }
  return null;
}

function plannerTaskPayload(input: { goal: string; references: readonly SequencePlannerReferenceInput[] }) {
  return {
    task: "Create an ordered, consistency-assisted image sequence plan for user review.",
    goal: input.goal,
    references: input.references.map(({ id, label, role, mimeType }) => ({ id, label, role, mimeType })),
    constraints: {
      minimumFrames: 2,
      maximumFrames: 12,
      requireApprovalBeforeImageGeneration: true,
    },
  };
}

async function parseInput(request: Request): Promise<
  { ok: false; response: Response } | { ok: true; input: SequencePlanRequestInput }
> {
  const parsed = sequencePlanRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return { ok: false, response: jsonError("Invalid sequence planner input.", 400, parsed.error.flatten()) };
  const referenceError = validateReferences(parsed.data.references);
  if (referenceError) return { ok: false, response: jsonError(referenceError) };
  return { ok: true, input: parsed.data };
}

async function loadPreferences(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data, error } = await supabase.from("user_metadata").select("preferences").eq("user_id", userId)
    .maybeSingle<{ preferences: unknown }>();
  if (error) throw new Error("Unable to load sequence planner settings.");
  return data?.preferences ?? {};
}

function validateSelection(input: SequencePlanRequestInput, preferences: unknown) {
  const selection = getResolvedModelProviderPreferences(preferences);
  if (selection.imageGenerationModelAlias !== input.imageModelAlias) {
    return {
      selection,
      issues: [{ code: "image-model-selection-stale", message: "The selected image model changed. Refresh and review the plan settings." }],
    };
  }
  const issues = validateSequenceCapabilities({
    plannerModelAlias: selection.chatOrchestrationModelAlias,
    imageModelAlias: input.imageModelAlias,
    plannerImages: input.references.map((reference) => ({ mimeType: reference.mimeType, byteSize: reference.byteSize })),
    executionUsesReferences: input.references.length > 0,
  });
  return { selection, issues };
}

function normalizeResponse(text: string, references: readonly SequencePlannerReferenceInput[], modelAlias: string, plannerCallNumber: number) {
  const normalized = validateAndNormalizeSequencePlan(parseJsonObject(text), new Set(references.map((reference) => reference.id)));
  if (!normalized.success) {
    return jsonError("Sequence planning returned an invalid response.", 502, { code: "invalid-plan", reason: normalized.reason });
  }
  return Response.json({ plan: normalized.plan, modelAlias, plannerCallNumber });
}

async function handleGateway(input: SequencePlanRequestInput, userId: string, preferences: unknown, config: Extract<ReturnType<typeof getModelGatewayConfig>, { status: "configured" }>) {
  const { selection, issues } = validateSelection(input, preferences);
  if (issues.length) return jsonError("The selected models cannot create this sequence plan.", 409, { code: "sequence-capability", issues });
  const modelAlias = selection.chatOrchestrationModelAlias;
  const catalogEntry = getModelCatalogEntry(modelAlias);
  const credentials = await resolveChatOrchestrationRuntimeCredentials({ userId, modelAlias });
  if (!credentials.ok) return createSafeRuntimeCredentialFailureResponse("Sequence planning", credentials);
  const policyModel = getResolvedChatPolicyModel(credentials, catalogEntry?.model);
  const content: Array<Record<string, unknown>> = [
    { type: "text", text: JSON.stringify(plannerTaskPayload(input), null, 2) },
    ...input.references.map((reference) => ({ type: "image_url", image_url: { url: reference.dataUrl } })),
  ];
  const prepared = prepareLiteLlmRuntimeRequest({
    model: modelAlias,
    ...getChatCompletionParameterOverrides({ model: policyModel, provider: catalogEntry?.provider, temperature: 0.25 }),
    response_format: { type: "json_schema", json_schema: { name: "kavero_sequence_plan", strict: true, schema: sequencePlanJsonSchema } },
    messages: [
      { role: "system", content: SEQUENCE_PLANNER_SYSTEM_PROMPT },
      { role: "user", content },
    ],
  }, credentials);
  if (!prepared.ok) return createSafeRuntimeCredentialFailureResponse("Sequence planning", prepared);

  const client = createLiteLlmClient({ config });
  const startedAt = Date.now();
  const monitoringModel = prepared.monitoringModel ?? catalogEntry?.model ?? null;
  try {
    const response = await client.chatCompletions(prepared.body, {
      provider: catalogEntry?.provider ?? null,
      model: monitoringModel,
      modelAlias,
    });
    const result = normalizeResponse(collectChatMessageContent(response.data), input.references, modelAlias, input.plannerCallNumber);
    logModelGatewayEvent(createModelGatewayEvent({
      userId,
      feature: "sequence-planner",
      provider: catalogEntry?.provider ?? null,
      model: monitoringModel,
      modelAlias,
      requestId: response.requestId,
      callId: response.callId,
      status: result.ok ? "success" : "error",
      latencyMs: Date.now() - startedAt,
      usage: response.usage,
      errorCode: result.ok ? undefined : "invalid_response",
      credentialSource: prepared.credentialSource,
    }));
    return result;
  } catch (error) {
    const details = isModelGatewayError(error) ? error.details : null;
    logModelGatewayEvent(createModelGatewayEvent({
      userId,
      feature: "sequence-planner",
      provider: catalogEntry?.provider ?? null,
      model: monitoringModel,
      modelAlias,
      requestId: details?.requestId ?? null,
      callId: details?.callId ?? null,
      status: "error",
      latencyMs: Date.now() - startedAt,
      errorCode: details?.errorCode ?? "provider_error",
      credentialSource: prepared.credentialSource,
    }));
    const status = details?.status === 429 ? 429 : details?.status === 401 || details?.status === 403 ? 403 : 502;
    return jsonError(status === 429 ? "Sequence planner is temporarily busy." : "Sequence planning failed safely.", status);
  }
}

async function handleDirectGemini(input: SequencePlanRequestInput, userId: string, preferences: unknown) {
  const { selection, issues } = validateSelection(input, preferences);
  if (issues.length) return jsonError("The selected models cannot create this sequence plan.", 409, { code: "sequence-capability", issues });
  const entry = getModelCatalogEntry(selection.chatOrchestrationModelAlias);
  if (entry?.provider !== "gemini") return jsonError("The selected sequence planner requires the model gateway.", 409);
  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(userId, "google-gemini");
  } catch {
    return jsonError("Unable to load sequence planner provider credentials.", 500);
  }
  if (!apiKey) return jsonError("Add your Gemini API key in Settings before planning a sequence.", 403);

  const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: JSON.stringify(plannerTaskPayload(input), null, 2) },
  ];
  for (const reference of input.references) {
    const parsed = parseDataUrl(reference.dataUrl);
    if (parsed) contents.push({ inlineData: { mimeType: parsed.mimeType, data: parsed.data } });
  }
  const config: GenerateContentConfig = {
    temperature: 0.25,
    responseMimeType: "application/json",
    responseJsonSchema: sequencePlanJsonSchema,
    thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    systemInstruction: SEQUENCE_PLANNER_SYSTEM_PROMPT,
  };
  const startedAt = Date.now();
  try {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model: entry.model.replace(/^gemini\//, ""),
      contents,
      config,
    });
    const result = normalizeResponse(collectGeminiText(response), input.references, entry.modelAlias, input.plannerCallNumber);
    const usage = response.usageMetadata;
    logModelGatewayEvent(createModelGatewayEvent({
      userId,
      feature: "sequence-planner",
      provider: "gemini",
      model: entry.model,
      modelAlias: entry.modelAlias,
      status: result.ok ? "success" : "error",
      latencyMs: Date.now() - startedAt,
      usage: {
        inputTokens: usage?.promptTokenCount ?? null,
        outputTokens: usage?.candidatesTokenCount ?? null,
        totalTokens: usage?.totalTokenCount ?? null,
      },
      errorCode: result.ok ? undefined : "invalid_response",
      gateway: "direct-gemini",
      credentialSource: "direct-gemini",
    }));
    return result;
  } catch {
    logModelGatewayEvent(createModelGatewayEvent({
      userId,
      feature: "sequence-planner",
      provider: "gemini",
      model: entry.model,
      modelAlias: entry.modelAlias,
      status: "error",
      latencyMs: Date.now() - startedAt,
      errorCode: "provider_error",
      gateway: "direct-gemini",
      credentialSource: "direct-gemini",
    }));
    return jsonError("Sequence planning failed safely.", 502);
  }
}

export async function POST(request: Request): Promise<Response> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return jsonError("Sign in to plan a sequence.", 401);
  const parsed = await parseInput(request);
  if (!parsed.ok) return parsed.response;

  let preferences: unknown;
  try {
    preferences = await loadPreferences(supabase, user.id);
  } catch {
    return jsonError("Unable to load sequence planner settings.", 500);
  }

  const gateway = getModelGatewayConfig();
  if (gateway.status === "error") return jsonError("Sequence planner gateway is not configured correctly.", 503);
  return gateway.status === "disabled"
    ? handleDirectGemini(parsed.input, user.id, preferences)
    : handleGateway(parsed.input, user.id, preferences, gateway);
}
