import {
  type CanvasAssistantProvider,
  type CanvasAssistantProviderInput,
  type CanvasAssistantProviderResult,
} from "@/modules/canvas/ai/copilot/assistant-orchestrator";
import {
  buildCanvasAssistantTaskPayload,
  CANVAS_ASSISTANT_SYSTEM_PROMPT,
  REQUEST_FEEDBACK_TOOL,
} from "@/modules/canvas/ai/copilot/assistant-provider-prompt";
import {
  createLiteLlmClient,
  createModelGatewayError,
  createModelGatewayEvent,
  getModelCatalogEntry,
  isModelGatewayError,
  logModelGatewayEvent,
  type ModelGatewayConfig,
} from "@/modules/model-providers";

type ConfiguredGatewayConfig = Extract<ModelGatewayConfig, { status: "configured" }>;

type OpenAiToolCall = {
  id?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
};

type OpenAiMessage = {
  content?: unknown;
  tool_calls?: unknown;
};

type OpenAiChatCompletionResponse = {
  choices?: unknown;
};

export function createLiteLlmCanvasAssistantProvider({
  config,
  modelAlias,
  userId = null,
}: {
  config: ConfiguredGatewayConfig;
  modelAlias: string;
  userId?: string | null;
}): CanvasAssistantProvider {
  const client = createLiteLlmClient({ config });
  const catalogEntry = getModelCatalogEntry(modelAlias);

  return {
    name: "litellm",
    model: modelAlias,
    async generate(input) {
      const startedAt = Date.now();

      try {
        const response = await client.chatCompletions<OpenAiChatCompletionResponse>(
          {
            model: modelAlias,
            temperature: input.temperature ?? 0.2,
            messages: [
              { role: "system", content: CANVAS_ASSISTANT_SYSTEM_PROMPT },
              { role: "user", content: buildLiteLlmUserContent(input) },
            ],
            tools: buildLiteLlmTools(input),
            tool_choice: "auto",
          },
          {
            provider: catalogEntry?.provider ?? null,
            model: catalogEntry?.model ?? null,
            modelAlias,
          },
        );

        const result = parseAssistantResponse(response.data, {
          provider: catalogEntry?.provider ?? null,
          model: catalogEntry?.model ?? null,
          modelAlias,
          requestId: response.requestId,
          callId: response.callId,
        });

        logModelGatewayEvent(
          createModelGatewayEvent({
            userId,
            feature: "canvas-copilot",
            provider: catalogEntry?.provider ?? null,
            model: catalogEntry?.model ?? null,
            modelAlias,
            requestId: response.requestId,
            callId: response.callId,
            status: "success",
            latencyMs: Date.now() - startedAt,
            usage: response.usage,
          }),
        );

        return result;
      } catch (error) {
        const details = isModelGatewayError(error) ? error.details : null;
        logModelGatewayEvent(
          createModelGatewayEvent({
            userId,
            feature: "canvas-copilot",
            provider: catalogEntry?.provider ?? null,
            model: catalogEntry?.model ?? null,
            modelAlias,
            requestId: details?.requestId ?? null,
            callId: details?.callId ?? null,
            status: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: details?.errorCode ?? "provider_error",
          }),
        );
        throw error;
      }
    },
  };
}

function buildLiteLlmUserContent(input: CanvasAssistantProviderInput) {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: JSON.stringify(buildCanvasAssistantTaskPayload(input), null, 2),
    },
  ];

  if (input.context.visualPreview) {
    content.push({
      type: "image_url",
      image_url: {
        url: input.context.visualPreview.dataUrl,
      },
    });
  }

  return content;
}

function buildLiteLlmTools(input: CanvasAssistantProviderInput) {
  return [
    ...input.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: `${tool.description} Risk: ${tool.riskLevel}.`,
        parameters: tool.inputSchema,
      },
    })),
    {
      type: "function",
      function: {
        name: REQUEST_FEEDBACK_TOOL.name,
        description: REQUEST_FEEDBACK_TOOL.description,
        parameters: REQUEST_FEEDBACK_TOOL.inputSchema,
      },
    },
  ];
}

function parseAssistantResponse(
  data: OpenAiChatCompletionResponse,
  context: Parameters<typeof createModelGatewayError>[1],
): CanvasAssistantProviderResult {
  const choice = getFirstChoice(data);
  const message = getMessage(choice);
  if (!message) {
    throw createModelGatewayError("LiteLLM returned an invalid canvas assistant response.", context, "invalid_response");
  }

  return {
    message: {
      role: "assistant",
      content: collectMessageContent(message.content),
    },
    toolCalls: parseToolCalls(message.tool_calls),
  };
}

function getFirstChoice(data: OpenAiChatCompletionResponse) {
  if (!data || typeof data !== "object" || !Array.isArray(data.choices)) return null;
  const firstChoice = data.choices[0];
  return firstChoice && typeof firstChoice === "object" ? firstChoice : null;
}

function getMessage(choice: object | null): OpenAiMessage | null {
  if (!choice || !("message" in choice)) return null;
  const message = (choice as { message?: unknown }).message;
  return message && typeof message === "object" ? (message as OpenAiMessage) : null;
}

function collectMessageContent(content: unknown) {
  if (typeof content === "string") return content;
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

function parseToolCalls(toolCalls: unknown) {
  if (!Array.isArray(toolCalls)) return [];

  return toolCalls.map((call, index) => {
    const toolCall = call && typeof call === "object" ? (call as OpenAiToolCall) : {};
    const functionCall = toolCall.function;
    return {
      id: typeof toolCall.id === "string" && toolCall.id.trim() ? toolCall.id : `litellm-call-${index + 1}`,
      name: typeof functionCall?.name === "string" ? functionCall.name : "",
      input: parseToolArguments(functionCall?.arguments),
    };
  });
}

function parseToolArguments(value: unknown) {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") return value;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
