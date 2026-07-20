import { describe, expect, it } from "vitest";
import { getCanvasImageControlOptions } from "./generate-panel";

describe("canvas Generate panel image controls", () => {
  it("derives GPT Image 2 controls from the shared browser contract", () => {
    const controls = getCanvasImageControlOptions("gpt-image-2");

    expect(controls).toMatchObject({
      batches: [4, 8],
      thinking: ["provider-managed"],
      aspects: ["auto", "1:1", "3:2", "2:3"],
      qualities: ["auto", "low", "medium", "high"],
      backgrounds: ["auto", "opaque", "transparent"],
    });
    expect(controls.sizes.map((option) => option.value)).toEqual([
      "auto",
      "1024x1024",
      "1536x1024",
      "1024x1536",
    ]);
  });

  it("preserves Gemini canvas controls", () => {
    const controls = getCanvasImageControlOptions("gemini-3.1-flash-image-preview");

    expect(controls.batches).toEqual([4, 8, 12, 16]);
    expect(controls.sizes.map((option) => option.value)).toEqual(["1K", "2K", "4K"]);
    expect(controls.thinking).toEqual(["balanced", "fast", "deep"]);
  });
});
