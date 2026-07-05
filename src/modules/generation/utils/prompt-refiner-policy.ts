import type { WorkspaceStatusResponse } from "../types";

const directGeminiKeyErrors = new Set([
  "Add your Gemini API key in Settings before refining prompts.",
  "Your Gemini API key was rejected. Check the key in Settings and try again.",
]);

export function shouldOpenPromptRefinerGeminiKeyGate(status: number, error?: string | null) {
  return status === 403 && typeof error === "string" && directGeminiKeyErrors.has(error);
}

export function shouldBlockImageGenerationForMissingGeminiKey(
  status: WorkspaceStatusResponse | null,
) {
  return !status?.hasGeminiKey;
}
