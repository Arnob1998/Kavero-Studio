import { describe, expect, it } from "vitest";
import { getChatCompletionParameterOverrides, getChatControlCapabilities } from "./chat-request-policy";

describe("chat request capability policy", () => {
  it.each(["gpt-5.6", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])(
    "omits sampling and forces tool-compatible reasoning for %s",
    (model) => {
      expect(getChatCompletionParameterOverrides({ model, temperature: 0.35, usesTools: true })).toEqual({
        reasoning_effort: "none",
      });
      expect(getChatCompletionParameterOverrides({ model, temperature: 0.35 })).toEqual({});
    },
  );

  it("omits both sampling and reasoning fields for Azure GPT-5.6 tool calls", () => {
    expect(getChatCompletionParameterOverrides({
      model: "gpt-5.6-sol",
      provider: "azure-openai",
      temperature: 0.2,
      usesTools: true,
    })).toEqual({});
  });

  it.each(["gemini/gemini-3.1-pro-preview", "gpt-4o", "gpt-4.1", "groq/llama-3.1-8b-instant", "ollama_chat/llama3.1"])(
    "preserves sampling for %s",
    (model) => {
      expect(getChatCompletionParameterOverrides({ model, temperature: 0.35, usesTools: true })).toEqual({ temperature: 0.35 });
    },
  );

  it("exposes extended thinking only for the implemented direct Gemini transport", () => {
    expect(getChatControlCapabilities({ model: "gemini/gemini-3.1-pro-preview", transport: "direct-gemini" }).extendedThinking.supported).toBe(true);
    expect(getChatControlCapabilities({ model: "gemini/gemini-3.1-pro-preview", transport: "chat-completions" }).extendedThinking.supported).toBe(false);
  });
});
