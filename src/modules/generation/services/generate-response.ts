import type { GoogleGenAI } from "@google/genai";

export type GenerateContentResponse = Awaited<ReturnType<GoogleGenAI["models"]["generateContent"]>>;

export function getParts(response: GenerateContentResponse) {
  return response.candidates?.[0]?.content?.parts ?? [];
}

export function collectText(parts: ReturnType<typeof getParts>) {
  return parts
    .filter((part) => !part.thought && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean)
    .join("\n\n");
}
