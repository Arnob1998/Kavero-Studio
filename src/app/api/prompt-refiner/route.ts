import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { GenerateContentConfig } from "@google/genai";
import { z } from "zod";
import { getUserProviderApiKey } from "@/lib/provider-keys";
import { createClient } from "@/lib/supabase/server";

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
{"status":"questions","intentSummary":"...","question":{"id":"...","text":"...","options":[{"id":"...","label":"...","value":"...","allowsCustom":false}]}}
{"status":"refined","intentSummary":"...","refinedPrompt":"...","refinementNote":"..."}

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
  }),
  z.object({
    status: z.literal("refined"),
    intentSummary: z.string().trim().min(1).max(800),
    refinedPrompt: z.string().trim().min(1).max(12000),
    refinementNote: z.string().trim().max(1200).optional().default(""),
  }),
]);

function jsonError(message: string, status = 400, details?: unknown) {
  return Response.json({ error: message, details }, { status });
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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return jsonError("Sign in to refine prompts.", 401);
  }

  let apiKey: string | null;
  try {
    apiKey = await getUserProviderApiKey(user.id, "google-gemini");
  } catch {
    return jsonError("Unable to load your Gemini API key.", 500);
  }

  if (!apiKey) {
    return jsonError("Add your Gemini API key in Settings before refining prompts.", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Request body must be valid JSON.");
  }

  const parsed = refineRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid refiner input.", 400, parsed.error.flatten());
  }

  const input = parsed.data;
  const references = input.referenceImages.map((image) => ({
    source: image,
    parsed: parseDataUrl(image.dataUrl),
  }));

  const invalidReference = references.find(({ parsed }) => !parsed);
  if (invalidReference) {
    return jsonError(`${invalidReference.source.name ?? "Reference image"} must be a base64 data URL.`);
  }

  const mismatchedReference = references.find(({ source, parsed }) => parsed?.mimeType !== source.mimeType);
  if (mismatchedReference) {
    return jsonError(`${mismatchedReference.source.name ?? "Reference image"} mimeType does not match the data URL.`);
  }

  const questionsRemaining = Math.max(0, MAX_REFINER_QUESTIONS - input.answers.length);
  const ai = new GoogleGenAI({ apiKey });
  const contents: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: JSON.stringify(
        {
          task: PROMPT_REFINER_TASK_PROMPT,
          userPrompt: input.prompt.trim(),
          referenceImages: input.referenceImages.map((image, index) => ({
            index: index + 1,
            name: image.name ?? `Reference ${index + 1}`,
            mimeType: image.mimeType,
          })),
          previousAnswers: input.answers,
          questionsRemaining,
        },
        null,
        2,
      ),
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
    console.error("Prompt refinement failed", error);
    return getRefinerFailureResponse(error);
  }

  const text = collectText(modelResponse);
  const modelJson = parseJsonObject(text);
  const refined = refinerResponseSchema.safeParse(modelJson);
  if (!refined.success) {
    console.error("Prompt refiner returned invalid JSON", { text, issues: refined.error.flatten() });
    return jsonError("Prompt refinement returned an invalid response.", 502);
  }

  if (refined.data.status === "questions" && questionsRemaining <= 0) {
    return jsonError("Prompt refiner exceeded the question limit.", 502);
  }

  return Response.json({
    ...refined.data,
    model: PROMPT_REFINER_MODEL,
    maxQuestions: MAX_REFINER_QUESTIONS,
  });
}
