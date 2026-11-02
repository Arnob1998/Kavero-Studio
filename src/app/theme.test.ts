import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
function token(name: string) {
  const value = css.match(new RegExp(`--kavero-${name}:\\s*(#[a-fA-F0-9]{6})`))?.[1];
  if (!value) throw new Error(`Missing color token: ${name}`);
  return value;
}
function luminance(hex: string) {
  const rgb = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}

describe("Kavero theme foundation", () => {
  it("keeps primary and secondary text readable on each opaque surface", () => {
    for (const surface of ["background", "surface", "card", "hover"]) {
      for (const text of ["text-primary", "text-secondary"]) {
        const contrast = (luminance(token(text)) + 0.05) / (luminance(token(surface)) + 0.05);
        expect(contrast, `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("ships the variable font referenced by the stylesheet with its upstream notice", () => {
    const url = css.match(/src:\s*url\("([^"]+\.woff2)"\)/)?.[1];
    expect(url).toBeTruthy();
    const font = readFileSync(join(process.cwd(), "public", url!));
    expect(font.subarray(0, 4).toString()).toBe("wOF2");
    expect(readFileSync(join(process.cwd(), "public/fonts/inter/LICENSE.txt"), "utf8")).toContain("SIL OPEN FONT LICENSE");
  });
});
