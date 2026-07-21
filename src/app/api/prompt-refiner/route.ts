import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";
import { z } from "zod";
import { getUserProviderApiKey } from "@/lib/provider-keys";
import { createClient } from "@/lib/supabase/server";
import {
  createLiteLlmClient,
  createModelGatewayEvent,
  getModelCatalogEntry,
  getModelGatewayConfig,
  getResolvedModelProviderPreferences,
  isModelGatewayError,
  logModelGatewayEvent,
  getChatCompletionParameterOverrides,
} from "@/modules/model-providers";
import {
  createSafeRuntimeCredentialFailureResponse,
  prepareLiteLlmRuntimeRequest,
  resolveChatOrchestrationRuntimeCredentials,
  getResolvedChatPolicyModel,
} from "@/modules/model-providers/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PROMPT_REFINER_MODEL = process.env.PROMPT_REFINER_MODEL ?? "gemini-3.1-pro-preview";
const MAX_REFINER_QUESTIONS = Number(process.env.PROMPT_REFINER_MAX_QUESTIONS ?? 3);

const PROMPT_REFINER_TASK_PROMPT = "Refine an image generation prompt for Kavero's /generate route.";
const PROMPT_REFINER_SYSTEM_PROMPT = `You are an agentic prompt refiner for an image generation UI that targets GPT Image (gpt-image-2) and Nano Banana / Gemini image models.
Return one JSON object only.

Workflow:
- Understand the user's intent from text and attached images.
- If the intent is clear enough for image generation or image editing, return status "refined".
- If one missing detail would materially change the image, return status "questions" with exactly one multiple-choice question.
- Ask the fewest questions possible. Do not ask a question when the prompt and images already contain enough information.
- questionsRemaining is a hard cap. If it is 0, return the best refined prompt without more questions.
- Every question must include one option with allowsCustom true for an "Other / expand" style answer.
- Make options concrete and easy to choose.

Refined prompt rules — critical:
- Write in natural language prose, NOT comma-separated keyword lists. These models read prompts like instructions, not tags.
- Do NOT use Midjourney-style token spam: no "8K", "masterpiece", "trending on artstation", "ultra-detailed", "hyperrealistic" padding.
- Keep generation prompts concise, usually 2–4 sentences. Longer is not automatically better.
- For generation tasks, include the subject, setting/context, composition/framing, lighting/atmosphere, visual style/medium, and specific constraints or text only when relevant.
- For editing tasks, use a two-part structure: "Change: [exactly what changes]. Preserve: [everything that must stay the same, such as identity, geometry, lighting, layout, brand elements, background, text, and colors]."
- For reference-image tasks, label each attached image by its role when the role is clear, such as "Image 1 is the base image" or "Image 2 is the style reference." If the role is unclear, ask one concise question before refining.
- Use photographic, design, or artistic terminology only when it helps the requested image. Do not force camera/lens terms for UI, logos, diagrams, posters, memes, simple edits, or brand graphics.
- If the user wants text rendered in the image, preserve the exact wording and specify font style, weight, color, position, and layout when relevant.
- Never over-rewrite a prompt that is already detailed and specific. Preserve the user's intent and voice.
- Do not randomly add people, objects, logos, brands, text, or visual elements the user did not request.
- Do not start image generation. Only refine the prompt or ask one clarification question.

JSON shapes:
{"status":"questions","intentSummary":"...","question":{"id":"...","text":"...","options":[{"id":"...","label":"...","value":"...","allowsCustom":false}]},"refinedPrompt":null,"refinementNote":null}
{"status":"refined","intentSummary":"...","question":null,"refinedPrompt":"...","refinementNote":"..."}

The refinementNote should briefly explain what was added or changed and why, in one sentence.`;

const referenceImageSchema = z.object({
  dataUrl: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]),
  name: z.string().optional(),
});

const answerSchema = z.object({
  question: z.string().trim().min(1).max(800),
  answer: z.string().trim().min(1).max(1200),
});

const refineRequestSchema = z
  .object({
    prompt: z.string().max(12000).default(""),
    referenceImages: z.array(referenceImageSchema).max(14).default([]),
    answers: z.array(answerSchema).max(MAX_REFINER_QUESTIONS).default([]),
  })
  .superRefine((input, context) => {
    if (!input.prompt.trim() && input.referenceImages.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["prompt"],
        message: "Add a prompt or reference image before refining.",
      });
    }
  });

const refinerChoiceSchema = z.object({
  id: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(500),
  allowsCustom: z.boolean().default(false),
});

const refinerResponseSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("questions"),
    intentSummary: z.string().trim().min(1).max(800),
    question: z.object({
      id: z.string().trim().min(1).max(40),
      text: z.string().trim().min(1).max(500),
      options: z.array(refinerChoiceSchema).min(2).max(5),
    }),
    refinedPrompt: z.null().optional(),
    refinementNote: z.null().optional(),
  }),
  z.object({
    status: z.literal("refined"),
    intentSummary: z.string().trim().min(1).max(800),
    question: z.null().optional(),
    refinedPrompt: z.string().trim().min(1).max(12000),
    refinementNote: z.string().trim().max(1200).nullable().optional().transform((value) => value ?? ""),
  }),
]);

// Keep one provider-neutral wire schema for LiteLLM and direct Gemini. All
// branch-specific fields are required but nullable because structured-output
// providers handle a single object shape more reliably than oneOf/discriminators.
const promptRefinerJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: { type: "string", enum: ["questions", "refined"] },
    intentSummary: { type: "string", minLength: 1, maxLength: 800 },
    question: {
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1, maxLength: 40 },
            text: { type: "string", minLength: 1, maxLength: 500 },
            options: {
              type: "array",
              minItems: 2,
              maxItems: 5,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  id: { type: "string", minLength: 1, maxLength: 40 },
                  label: { type: "string", minLength: 1, maxLength: 80 },
                  value: { type: "string", minLength: 1, maxLength: 500 },
                  allowsCustom: { type: "boolean" },
                },
                required: ["id", "label", "value", "allowsCustom"],
              },
            },
          },
          required: ["id", "text", "options"],
        },
        { type: "null" },
      ],
    },
    refinedPrompt: {
      anyOf: [
        { type: "string", minLength: 1, maxLength: 12000 },
        { type: "null" },
      ],
    },
    refinementNote: {
      anyOf: [
        { type: "string", maxLength: 1200 },
        { type: "null" },
      ],
    },
  },
  required: ["status", "intentSummary", "question", "refinedPrompt", "refinementNote"],
} as const;

function jsonError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
}

function safeValidationSummary(error: z.ZodError) {
  return {
    issueCount: error.issues.length,
    fieldErrors: Object.keys(error.flatten().fieldErrors),
    formErrorCount: error.flatten().formErrors.length,
  };
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;

  const status = "status" in error ? (error as { status?: unknown }).status : null;
  if (typeof status === "number") return status;

  const message = "message" in error ? (error as { message?: unknown }).message : null;
  if (typeof message !== "string") return null;

  try {
    const parsed = JSON.parse(message) as { error?: { code?: unknown; status?: unknown } };
    const code = parsed.error?.code;
    if (typeof code === "number") return code;
  } catch {
    return null;
  }

  return null;
}

function getRefinerFailureResponse(error: unknown) {
  const upstreamStatus = getErrorStatus(error);

  if (upstreamStatus === 429 || upstreamStatus === 503) {
    return jsonError(
      "The prompt refiner model is temporarily busy. Please wait a moment and try again.",
      503,
      { retryable: true, upstreamStatus },
    );
  }

  if (upstreamStatus === 401 || upstreamStatus === 403) {
    return jsonError("Your Gemini API key was rejected. Check the key in Settings and try again.", 403, {
      upstreamStatus,
    });
  }

  return jsonError("Prompt refinement failed. Please try again.", 502, { upstreamStatus });
}

function getGatewayFailureResponse(error: unknown) {
  if (!isModelGatewayError(error)) {
    return jsonError("Prompt refinement failed. Please try again.", 502);
  }

  const { errorCode, retryable, status } = error.details;

  if (errorCode === "authentication_error") {
    return jsonError("The prompt refiner gateway was rejected. Check provider setup and try again.", 403, {
      upstreamStatus: status,
    });
  }

  if (errorCode === "rate_limited") {
    return jsonError(
      "The prompt refiner model is temporarily busy. Please wait a moment and try again.",
      503,
      { retryable: true, upstreamStatus: status },
    );
  }

  if (errorCode === "invalid_response") {
    return jsonError("Prompt refinement returned an invalid response.", 502);
  }

  return jsonError("Prompt refinement failed. Please try again.", retryable ? 503 : 502, {
    retryable,
    upstreamStatus: status,
  });
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  return {
    mimeType: match[1],
    data: match[2],
  };
}

function collectText(response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>) {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n");
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

type RefineInput = z.infer<typeof refineRequestSchema>;
type ParsedReference = {
  source: z.infer<typeof referenceImageSchema>;
  parsed: ReturnType<typeof parseDataUrl>;
};

function getReferences(input: RefineInput): ParsedReference[] {
  return input.referenceImages.map((image) => ({
    source: image,
    parsed: parseDataUrl(image.dataUrl),
  }));
}

function validateReferences(references: ParsedReference[]) {
  const invalidReference = references.find(({ parsed }) => !parsed);
  if (invalidReference) {
    return jsonError(`${invalidReference.source.name ?? "Reference image"} must be a base64 data URL.`);
  }

  const mismatchedReference = references.find(({ source, parsed }) => parsed?.mimeType !== source.mimeType);
  if (mismatchedReference) {
    return jsonError(`${mismatchedReference.source.name ?? "Reference image"} mimeType does not match the data URL.`);
  }

  return null;
}

async function parseRequestInput(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { response: jsonError("Request body must be valid JSON.") };
  }

  const parsed = refineRequestSchema.safeParse(body);
  if (!parsed.success) {
    return { response: jsonError("Invalid refiner input.", 400, parsed.error.flatten()) };
  }

  const references = getReferences(parsed.data);
  const referenceError = validateReferences(references);
  if (referenceError) {
    return { response: referenceError };
  }

  return { input: parsed.data, references };
}

function refinerTaskPayload(input: RefineInput) {
  const questionsRemaining = Math.max(0, MAX_REFINER_QUESTIONS - input.answers.length);

  return {
    task: PROMPT_REFINER_TASK_PROMPT,
    userPrompt: input.prompt.trim(),
    referenceImages: input.referenceImages.map((image, index) => ({
      index: index + 1,
      name: image.name ?? `Reference ${index + 1}`,
      mimeType: image.mimeType,
    })),
    previousAnswers: input.answers,
    questionsRemaining,
  };
}

function responseWithRefinedPayload(refined: z.infer<typeof refinerResponseSchema>, model: string, questionsRemaining: number) {
  if (refined.status === "questions" && questionsRemaining <= 0) {
    return jsonError("Prompt refiner exceeded the question limit.", 502);
  }

  if (refined.status === "questions") {
    return Response.json({
      status: refined.status,
      intentSummary: refined.intentSummary,
      question: refined.question,
      model,
      maxQuestions: MAX_REFINER_QUESTIONS,
    });
  }

  return Response.json({
    status: refined.status,
    intentSummary: refined.intentSummary,
    refinedPrompt: refined.refinedPrompt,
    refinementNote: refined.refinementNote,
    model,
    maxQuestions: MAX_REFINER_QUESTIONS,
  });
}

async function loadModelProviderPreferences(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("user_metadata")
    .select("preferences")
    .eq("user_id", userId)
    .maybeSingle<{ preferences: unknown }>();

  if (error) {
    console.error("Unable to load prompt-refiner model preferences");
    throw new Error("Unable to load model-provider preferences.");
  }

  return data?.preferences ?? {};
}

function collectChatMessageContent(data: unknown) {
  if (!data || typeof data !== "object") return "";
  const choices = "choices" in data ? (data as { choices?: unknown }).choices : null;
  if (!Array.isArray(choices)) return "";

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object") return "";
  const message = "message" in firstChoice ? (firstChoice as { message?: unknown }).message : null;
  if (!message || typeof message !== "object") return "";
  const content = "content" in message ? (message as { content?: unknown }).content : null;

  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const text = "text" in part ? (part as { text?: unknown }).text : null;
      return typeof text === "string" ? text.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function handleGatewayRefinement({
  request,
  supabase,
  userId,
  config,
}: {
  request: Request;
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  config: Extract<ReturnType<typeof getModelGatewayConfig>, { status: "configured" }>;
}) {
  const parsed = await parseRequestInput(request);
  if ("response" in parsed) return parsed.response;

  let preferences: unknown;
  try {
    preferences = await loadModelProviderPreferences(supabase, userId);
  } catch {
    return jsonError("Unable to load prompt-refiner model settings.", 500);
  }

  const selection = getResolvedModelProviderPreferences(preferences);
  const modelAlias = selection.chatOrchestrationModelAlias;
  const catalogEntry = getModelCatalogEntry(modelAlias);
  const credentials = await resolveChatOrchestrationRuntimeCredentials({ userId, modelAlias });
  if (!credentials.ok) {
    return createSafeRuntimeCredentialFailureResponse("Prompt refinement", credentials);
  }
  const questionsRemaining = Math.max(0, MAX_REFINER_QUESTIONS - parsed.input.answers.length);
  const policyModel = getResolvedChatPolicyModel(credentials, catalogEntry?.model);
  const client = createLiteLlmClient({ config });
  const startedAt = Date.now();

  const textPayload = JSON.stringify(refinerTaskPayload(parsed.input), null, 2);
  const content: Array<Record<string, unknown>> = [{ type: "text", text: textPayload }];
  for (const { source } of parsed.references) {
    content.push({
      type: "image_url",
      image_url: {
        url: source.dataUrl,
      },
    });
  }

  const prepared = prepareLiteLlmRuntimeRequest(
    {
      model: modelAlias,
      ...getChatCompletionParameterOverrides({ model: policyModel, provider: catalogEntry?.provider, temperature: 0.35 }),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "kavero_prompt_refiner",
          strict: true,
          schema: promptRefinerJsonSchema,
        },
      },
      messages: [
        { role: "system", content: PROMPT_REFINER_SYSTEM_PROMPT },
        { role: "user", content },
      ],
    },
    credentials,
  );
  if (!prepared.ok) {
    return createSafeRuntimeCredentialFailureResponse("Prompt refinement", prepared);
  }
  const monitoringModel = prepared.monitoringModel ?? catalogEntry?.model ?? null;

  try {
    const response = await client.chatCompletions(
      prepared.body,
      {
        provider: catalogEntry?.provider ?? null,
        model: monitoringModel,
        modelAlias,
      },
    );

    const text = collectChatMessageContent(response.data);
    const modelJson = parseJsonObject(text);
    const refined = refinerResponseSchema.safeParse(modelJson);
    if (!refined.success) {
      console.error("Prompt refiner returned invalid gateway JSON", safeValidationSummary(refined.error));
      logModelGatewayEvent(
        createModelGatewayEvent({
          userId,
          feature: "prompt-refiner",
          provider: catalogEntry?.provider ?? null,
          model: monitoringModel,
          modelAlias,
          requestId: response.requestId,
          callId: response.callId,
          status: "error",
          latencyMs: Date.now() - startedAt,
          usage: response.usage,
          errorCode: "invalid_response",
          credentialSource: prepared.credentialSource,
        }),
      );
      return jsonError("Prompt refinement returned an invalid response.", 502);
    }

    logModelGatewayEvent(
      createModelGatewayEvent({
        userId,
        feature: "prompt-refiner",
        provider: catalogEntry?.provider ?? null,
        model: monitoringModel,
        modelAlias,
        requestId: response.requestId,
        callId: response.callId,
        status: "success",
        latencyMs: Date.now() - startedAt,
        usage: response.usage,
        credentialSource: prepared.credentialSource,
      }),
    );

    return responseWithRefinedPayload(refined.data, modelAlias, questionsRemaining);
  } catch (error) {
    const details = isModelGatewayError(error) ? error.details : null;
    logModelGatewayEvent(
      createModelGatewayEvent({
        userId,
        feature: "prompt-refiner",
        provider: catalogEntry?.provider ?? null,
        model: monitoringModel,
        modelAlias,
        requestId: details?.requestId ?? null,
        callId: details?.callId ?? null,
        status: "error",
        latencyMs: Date.now() - startedAt,
        errorCode: details?.errorCode ?? "provider_error",
        credentialSource: prepared.credentialSource,
      }),
    );
    return getGatewayFailureResponse(error);
  }
}

async function handleDirectGeminiRefinement(request: Request, userId: string) {
  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(userId, "google-gemini");
  } catch {
    return jsonError("Unable to load your Gemini API key.", 500);
  }

  if (!apiKey) {
    return jsonError("Add your Gemini API key in Settings before refining prompts.", 403);
  }

  const parsed = await parseRequestInput(request);
  if ("response" in parsed) return parsed.response;

  const input = parsed.input;
  const references = parsed.references;
  const questionsRemaining = Math.max(0, MAX_REFINER_QUESTIONS - input.answers.length);
  const ai = new GoogleGenAI({ apiKey });
  const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: JSON.stringify(refinerTaskPayload(input), null, 2),
    },
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

  const config: GenerateContentConfig = {
    temperature: 0.35,
    responseMimeType: "application/json",
    responseJsonSchema: promptRefinerJsonSchema,
    thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
    systemInstruction: PROMPT_REFINER_SYSTEM_PROMPT,
  };

  let modelResponse: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>;
  try {
    modelResponse = await ai.models.generateContent({
      model: PROMPT_REFINER_MODEL,
      contents,
      config,
    });
  } catch (error) {
    console.error("Prompt refinement failed", { upstreamStatus: getErrorStatus(error) });
    return getRefinerFailureResponse(error);
  }

  const text = collectText(modelResponse);
  const modelJson = parseJsonObject(text);
  const refined = refinerResponseSchema.safeParse(modelJson);
  if (!refined.success) {
    console.error("Prompt refiner returned invalid JSON", safeValidationSummary(refined.error));
    return jsonError("Prompt refinement returned an invalid response.", 502);
  }

  return responseWithRefinedPayload(refined.data, PROMPT_REFINER_MODEL, questionsRemaining);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError("Sign in to refine prompts.", 401);
  }

  const gatewayConfig = getModelGatewayConfig();
  if (gatewayConfig.status === "disabled") {
    return handleDirectGeminiRefinement(request, user.id);
  }

  if (gatewayConfig.status === "error") {
    return jsonError("Prompt refinement model gateway is not configured correctly.", 503, {
      code: "model-gateway-configuration",
    });
  }

  return handleGatewayRefinement({
    request,
    supabase,
    userId: user.id,
    config: gatewayConfig,
  });
}
