import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { FunctionDeclaration, GenerateContentConfig } from "@google/genai";
import {
  DEFAULT_CANVAS_ASSISTANT_MODEL,
  type CanvasAssistantProvider,
  type CanvasAssistantProviderInput,
} from "@/modules/canvas/ai/copilot/assistant-orchestrator";
import {
  buildCanvasAssistantTaskPayload,
  CANVAS_ASSISTANT_SYSTEM_PROMPT,
  REQUEST_FEEDBACK_TOOL,
  stripDataUrl,
} from "@/modules/canvas/ai/copilot/assistant-provider-prompt";

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
  name: REQUEST_FEEDBACK_TOOL.name,
  description: REQUEST_FEEDBACK_TOOL.description,
  parametersJsonSchema: REQUEST_FEEDBACK_TOOL.inputSchema,
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
      text: JSON.stringify(buildCanvasAssistantTaskPayload(input), null, 2),
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

function collectGeminiText(response: Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>) {
  return (response.candidates?.[0]?.content?.parts ?? [])
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n");
}
