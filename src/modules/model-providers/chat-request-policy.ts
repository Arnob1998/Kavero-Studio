export type ChatRequestTransport = "chat-completions" | "direct-gemini";

export type ChatControlCapabilities = {
  temperature: {
    supported: boolean;
    minimum: number;
    maximum: number;
    step: number;
    default: number;
  };
  extendedThinking: {
    supported: boolean;
    default: boolean;
  };
  toolReasoningEffort: "none" | null;
};

export function isGpt56Model(model: string | null | undefined) {
  return typeof model === "string" && /^gpt-5\.6(?:$|-)/.test(model.replace(/^azure\/(?:gpt5_series\/)?/, ""));
}

export function getChatControlCapabilities({
  model,
  provider = null,
  transport = "chat-completions",
  usesTools = false,
}: {
  model: string | null | undefined;
  provider?: string | null;
  transport?: ChatRequestTransport;
  usesTools?: boolean;
}): ChatControlCapabilities {
  const gpt56 = isGpt56Model(model);
  return {
    temperature: {
      supported: !gpt56,
      minimum: 0,
      maximum: 1,
      step: 0.1,
      default: 0.2,
    },
    extendedThinking: {
      supported: transport === "direct-gemini" && Boolean(model?.includes("gemini")),
      default: true,
    },
    // Pinned LiteLLM currently redirects Azure GPT-5.6 to /openai/responses
    // when reasoning_effort is present. Azure Chat Completions tool calls pass
    // when the field is omitted, while direct OpenAI requires explicit none.
    toolReasoningEffort: gpt56 && usesTools && provider !== "azure-openai" ? "none" : null,
  };
}

export function getChatCompletionParameterOverrides({
  model,
  provider = null,
  temperature,
  usesTools = false,
}: {
  model: string | null | undefined;
  provider?: string | null;
  temperature: number;
  usesTools?: boolean;
}): Record<string, unknown> {
  const controls = getChatControlCapabilities({ model, provider, usesTools });
  return {
    ...(controls.temperature.supported ? { temperature } : {}),
    ...(controls.toolReasoningEffort ? { reasoning_effort: controls.toolReasoningEffort } : {}),
  };
}
