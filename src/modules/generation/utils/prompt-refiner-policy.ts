import type { WorkspaceStatusResponse } from "../types";

const directGeminiKeyErrors = new Set([
  "Add your Gemini API key in Settings before refining prompts.",
  "Your Gemini API key was rejected. Check the key in Settings and try again.",
]);

const directGeminiImageGenerationKeyErrors = new Set([
  "Add your Gemini API key in Settings before generating.",
]);

export function shouldOpenPromptRefinerGeminiKeyGate(status: number, error?: string | null) {
  return status === 403 && typeof error === "string" && directGeminiKeyErrors.has(error);
}

export function shouldOpenImageGenerationGeminiKeyGate(status: number, error?: string | null) {
  return status === 403 && typeof error === "string" && directGeminiImageGenerationKeyErrors.has(error);
}

export function shouldBlockImageGenerationForMissingGeminiKey(
  status: WorkspaceStatusResponse | null,
) {
  void status;
  return false;
}
