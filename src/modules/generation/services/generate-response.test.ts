import { describe, expect, it } from "vitest";
import { collectText, getParts } from "./generate-response";

describe("generate response helpers", () => {
  it("collects non-thought text and joins with blank lines", () => {
    const parts = [
      { text: " First " },
      { text: "   " },
      { text: "Second" },
      { thought: true, text: "Hidden thought" },
    ] as ReturnType<typeof getParts>;

    expect(collectText(parts)).toBe("First\n\nSecond");
  });

  it("keeps inline image parts discoverable through getParts", () => {
    const response = {
      candidates: [
        {
          content: {
            parts: [
              { text: "Caption" },
              { inlineData: { mimeType: "image/png", data: "AAAA" } },
            ],
          },
        },
      ],
    } as Parameters<typeof getParts>[0];

    expect(getParts(response)).toEqual([
      { text: "Caption" },
      { inlineData: { mimeType: "image/png", data: "AAAA" } },
    ]);
  });

  it("returns an empty part list for missing candidates", () => {
    expect(getParts({} as Parameters<typeof getParts>[0])).toEqual([]);
  });
});
