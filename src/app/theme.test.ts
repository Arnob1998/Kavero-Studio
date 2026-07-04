import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Kavero theme tokens", () => {
  it("defines monochrome light/dark tokens and Electric Blue accent", () => {
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

    for (const token of [
      "#FFFFFF",
      "#F8F8F8",
      "#111111",
      "#666666",
      "#E5E5E5",
      "#F2F2F2",
      "#0A0A0A",
      "#171717",
      "#A3A3A3",
      "#262626",
      "#1F1F1F",
      "#3B82F6",
    ]) {
      expect(css).toContain(token);
    }

    expect(css).toContain("@media (prefers-color-scheme: dark)");
  });
});
