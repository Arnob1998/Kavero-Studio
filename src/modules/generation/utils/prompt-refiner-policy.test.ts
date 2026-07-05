import { describe, expect, it } from "vitest";
import {
  shouldBlockImageGenerationForMissingGeminiKey,
  shouldOpenPromptRefinerGeminiKeyGate,
} from "./prompt-refiner-policy";
import type { WorkspaceStatusResponse } from "../types";

describe("prompt refiner policy", () => {
  it("opens the Gemini key gate only for direct Gemini prompt-refiner key errors", () => {
    expect(
      shouldOpenPromptRefinerGeminiKeyGate(
        403,
        "Add your Gemini API key in Settings before refining prompts.",
      ),
    ).toBe(true);
    expect(
      shouldOpenPromptRefinerGeminiKeyGate(
        403,
        "Your Gemini API key was rejected. Check the key in Settings and try again.",
      ),
    ).toBe(true);
    expect(
      shouldOpenPromptRefinerGeminiKeyGate(
        403,
        "The prompt refiner gateway was rejected. Check provider setup and try again.",
      ),
    ).toBe(false);
  });

  it("keeps actual image generation blocked on the existing Gemini key readiness", () => {
    expect(shouldBlockImageGenerationForMissingGeminiKey(workspaceStatus({ hasGeminiKey: false }))).toBe(true);
    expect(shouldBlockImageGenerationForMissingGeminiKey(workspaceStatus({ hasGeminiKey: true }))).toBe(false);
  });
});

function workspaceStatus({
  hasGeminiKey,
}: {
  hasGeminiKey: boolean;
}): WorkspaceStatusResponse {
  return {
    authenticated: true,
    hasGeminiKey,
    drive: {
      connected: true,
      reconnectRequired: false,
      quotaFull: false,
      usage: { used: 0, limit: 20 },
    },
  };
}
