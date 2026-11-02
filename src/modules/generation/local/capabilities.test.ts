import { describe, it, expect } from "vitest";
import { localSourceBlockReason, localPromptError } from "./capabilities";
import { localJobIntentSchema } from "./contracts";
const base = { references: 0, activeResult: false, generating: false, sequence: false };
describe("Local source capability boundary", () => {
  it("blocks references, editing/results, active inference and sequences without changing their state", () => {
    for (const state of [{ ...base, references: 1 }, { ...base, activeResult: true }, { ...base, generating: true }, { ...base, sequence: true }]) {
      const original = { ...state }; expect(localSourceBlockReason(state)).toBeTruthy(); expect(state).toEqual(original);
    }
    expect(localSourceBlockReason(base)).toBeNull();
  });
  it("shares exact prompt/dimension/count limits between UI and server", () => {
    const intent = { profile: "qwen-image-2.1-q4-evaluation", width: 512, height: 512, count: 1, prompt: "x".repeat(1000) };
    expect(localJobIntentSchema.safeParse(intent).success).toBe(true); expect(localPromptError(intent.prompt)).toBeNull();
    for (const prompt of ["", "  ", "x".repeat(1001)]) { expect(localPromptError(prompt)).toBeTruthy(); expect(localJobIntentSchema.safeParse({ ...intent, prompt }).success).toBe(false); }
    for (const unsupported of [{ width: 1024 }, { count: 2 }, { references: [] }, { quality: "high" }, { reasoning: "high" }]) expect(localJobIntentSchema.safeParse({ ...intent, ...unsupported }).success).toBe(false);
  });
});
