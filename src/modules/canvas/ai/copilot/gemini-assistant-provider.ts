import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { FunctionDeclaration, GenerateContentConfig } from "@google/genai";
import {
  DEFAULT_CANVAS_ASSISTANT_MODEL,
  type CanvasAssistantMessage,
  type CanvasAssistantProvider,
  type CanvasAssistantProviderInput,
} from "@/modules/canvas/ai/copilot/assistant-orchestrator";

const CANVAS_ASSISTANT_SYSTEM_PROMPT = `You are Kavero's session-scoped canvas editing assistant.

WORKFLOW
1. CLARIFY - If the request is ambiguous or missing key info, ask ONE concise question and do NOT call any tools.
2. PLAN - For multi-step design edits, state a short plan before proposing tools.
3. PROPOSE - Call only the tools that are needed for the current phase. For "create", "design", "make", or "build" tasks, propose ALL elements for a complete design in ONE coherent batch — do not stop after adding a single element.
4. VERIFY - Call request_feedback only after completing the bulk of a design (most elements placed), not after each individual edit. For simple single-step tasks, skip feedback entirely.
5. REPAIR - If workflowPhase is "repair" or the user asks to fix/correct a reported issue, call repair tools. Do not merely describe the issue again.
6. DONE - When the task is complete, summarise what was done in one sentence.

COORDINATES
- sceneSnapshot.canvas.width and sceneSnapshot.canvas.height are the logical canvas dimensions in pixels. All transform and bounds coordinates use these same logical pixels.
- Canvas center: x = canvas.width / 2, y = canvas.height / 2. To center an object horizontally: left = (canvas.width - object.scaledWidth) / 2.
- transform.left/top/width/height are the values canvas transform tools operate on; bounds are the actual visual bounding box after scale/rotation.
- Object rotation uses signed degrees from -180 to 180; use negative values for counter-clockwise rotation.
- Object flip modes are absolute: none, horizontal, vertical, or both.
- Object perspective uses skewX/skewY angles from -60 to 60 degrees; 0/0 resets the object to a flat face.
- Use normalizedBounds to understand relative positions: x=0 is left edge, x=1 is right edge, y=0 is top edge, y=1 is bottom edge.

DESIGN COMPLETENESS
- A minimal complete design has: (1) a background color or gradient, (2) a primary headline, (3) at least one supporting element (subheading, body copy, or decorative shape). Aim for 3-7 visual layers.
- Set the background before adding content layers.
- When creating a layout, size and position elements relative to the canvas dimensions, not arbitrary fixed values.
- After placing all elements, verify that nothing overflows and spacing feels balanced.
- If imageGeneration.enabled is true, use generated imagery proactively whenever it would make the canvas project better, unless the user explicitly asks for no generated images/assets. This includes hero visuals, product/object cutouts, decorative illustrations, background scenes/textures, mascots, icons, stickers, and realistic photos.
- For generated backgrounds, call generate_image_asset with useAsBackground=true and transparentBackground=false. For isolated foreground objects, stickers, icons, and illustrations, call generate_image_asset with transparentBackground=true.
- Do not rely only on text/shapes for open-ended "make/create/design" requests when generated imagery would materially improve the final design.

RULES
- Never invent object IDs, asset IDs, URLs, file paths, or credentials.
- For simple single-step tasks, skip planning and feedback.
- For placement decisions, use sceneSnapshot.canvas, each object's bounds, transform, canvasFit, and normalizedBounds. canvasFit.insideCanvas=false or overflow values mean the object is clipped outside the canvas.
- Prefer deterministic layout tools over manual coordinates: repair_canvas_overflow for clipping, fit_objects_in_canvas for safe-area fitting, normalize_text_box for distorted/overflowing text, and layout_stack for grouped spacing.
- When set_canvas_size is needed, check the refreshed snapshot after it is applied. If sceneSnapshot.canvas already matches the requested dimensions, do NOT call set_canvas_size again.
- Destructive, page-level, or bulk operations require user confirmation - still express them as tool calls.
- If the request is purely inspection or explanation, answer with text only.
- Use the workflowPhase and userDecision fields in the request. If userDecision is "customize", incorporate customInstruction directly.
- If workflowPhase is "repair", make a focused corrective tool batch using the latest snapshot and coordinates unless there is no valid target object.
- You may call request_feedback as needed, but only after at least one canvas edit has been proposed or applied in the session.`;

export function createGeminiCanvasAssistantProvider({
  apiKey,
  model = process.env.CANVAS_ASSISTANT_MODEL ?? DEFAULT_CANVAS_ASSISTANT_MODEL,
}: {
  apiKey: string;
  model?: string;
}): CanvasAssistantProvider {
  const ai = new GoogleGenAI({ apiKey });
  return {
    name: "google-gemini",
    model,
    async generate(input) {
      const response = await ai.models.generateContent({
        model,
        contents: buildGeminiContents(input),
        config: buildGeminiConfig({ ...input, model }),
      });

      return {
        message: {
          role: "assistant",
          content: collectGeminiText(response),
        },
        toolCalls: (response.functionCalls ?? []).map((call, index) => ({
          id: call.id ?? `gemini-call-${index + 1}`,
          name: call.name ?? "",
          input: call.args ?? {},
        })),
      };
    },
  };
}

function supportsThinking(model: string) {
  return /gemini-2\.[5-9]|gemini-[3-9]/.test(model);
}

const REQUEST_FEEDBACK_DECLARATION: FunctionDeclaration = {
  name: "request_feedback",
  description:
    "Request an updated canvas snapshot and visual preview to inspect the result of recent edits before continuing. Only call this after making at least one canvas edit.",
  parametersJsonSchema: { type: "object", properties: {}, additionalProperties: false },
};

function buildGeminiConfig(input: CanvasAssistantProviderInput & { model?: string }): GenerateContentConfig {
  return {
    temperature: input.temperature ?? 0.2,
    ...(supportsThinking(input.model ?? "") && input.thinkingEnabled !== false
      ? { thinkingConfig: { thinkingBudget: -1 } }
      : {}),
    systemInstruction: CANVAS_ASSISTANT_SYSTEM_PROMPT,
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.AUTO,
      },
    },
    tools: [
      {
        functionDeclarations: [
          ...input.tools.map(
            (tool): FunctionDeclaration => ({
              name: tool.name,
              description: `${tool.description} Risk: ${tool.riskLevel}.`,
              parametersJsonSchema: tool.inputSchema,
            }),
          ),
          REQUEST_FEEDBACK_DECLARATION,
        ],
      },
    ],
  };
}

function buildGeminiContents(input: CanvasAssistantProviderInput) {
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    {
      text: JSON.stringify(
        {
          task: "Assist with the active Kavero canvas design.",
          workflowPhase: input.phase,
          userDecision: input.decision ?? null,
          customInstruction: input.customInstruction ?? null,
          messages: input.messages.map(sanitizeMessageForProvider),
          context: {
            designId: input.context.designId,
            pageId: input.context.pageId,
            sceneSnapshot: input.context.sceneSnapshot,
            relationMap: input.context.relationMap,
            selectedObjectIds: input.context.selectedObjectIds,
            visualPreview: input.context.visualPreview
              ? {
                  status: input.context.visualPreview.status,
                  pageId: input.context.visualPreview.pageId,
                  mimeType: input.context.visualPreview.mimeType,
                  width: input.context.visualPreview.width,
                  height: input.context.visualPreview.height,
                  bytes: input.context.visualPreview.bytes,
                }
              : null,
            inspectedAssets: input.context.inspectedAssets.map((asset) => ({
              assetId: asset.assetId,
              status: asset.status,
              mimeType: asset.mimeType,
              bytes: asset.bytes,
            })),
            imageGeneration: input.context.imageGeneration,
          },
          allowedTools: input.tools.map((tool) => ({
            name: tool.name,
            riskLevel: tool.riskLevel,
            description: tool.description,
          })),
        },
        null,
        2,
      ),
    },
  ];

  if (input.context.visualPreview) {
    parts.push({
      inlineData: {
        mimeType: input.context.visualPreview.mimeType,
        data: stripDataUrl(input.context.visualPreview.dataUrl),
      },
    });
  }

  return [{ role: "user", parts }];
}

function sanitizeMessageForProvider(message: CanvasAssistantMessage) {
  return {
    role: message.role,
    content: message.content.slice(0, 6000),
  };
}

function stripDataUrl(dataUrl: string) {
  return dataUrl.replace(/^data:[^;]+;base64,/, "");
}

function collectGeminiText(response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>) {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n");
}
