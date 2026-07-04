import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROMPT_ICON,
  formatBytes,
  getPresetReferenceSource,
  isSupportedImageMimeType,
  normalizePromptIcon,
  promptIconLabel,
  promptTemplateToPreset,
  stableScramble,
} from "./client-helpers";

describe("generation client helpers", () => {
  it("formats bytes with the existing KB and MB display rules", () => {
    expect(formatBytes(1)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("2 KB");
    expect(formatBytes(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });

  it("detects supported reference image mime types", () => {
    expect(isSupportedImageMimeType("image/png")).toBe(true);
    expect(isSupportedImageMimeType("image/jpeg")).toBe(true);
    expect(isSupportedImageMimeType("image/webp")).toBe(true);
    expect(isSupportedImageMimeType("image/heic")).toBe(true);
    expect(isSupportedImageMimeType("image/heif")).toBe(true);
    expect(isSupportedImageMimeType("image/gif")).toBe(false);
  });

  it("normalizes prompt icons without changing fallback behavior", () => {
    expect(normalizePromptIcon(null)).toEqual(DEFAULT_PROMPT_ICON);
    expect(normalizePromptIcon({ name: "file-text", color: "not-a-color", version: 1 })).toEqual(
      DEFAULT_PROMPT_ICON,
    );
    expect(normalizePromptIcon({ name: "file-text", color: "#abcdef", version: 1 })).toEqual({
      name: "file-text",
      color: "#abcdef",
      version: 1,
    });
  });

  it("maps prompt template records to prompt presets", () => {
    expect(
      promptTemplateToPreset({
        id: "template-1",
        name: "Hero",
        prompt: "Make a hero image",
        thumbnail_icon: null,
        reference_images: null,
        sort_order: 0,
        created_at: "2026-05-26T00:00:00.000Z",
        updated_at: "2026-05-26T00:00:00.000Z",
      }),
    ).toEqual({
      id: "template-1",
      name: "Hero",
      prompt: "Make a hero image",
      thumbnailIcon: DEFAULT_PROMPT_ICON,
      referenceImages: [],
      persisted: true,
    });
  });

  it("keeps stableScramble deterministic", () => {
    expect(stableScramble(["a", "b", "c", "d", "e"])).toEqual(["d", "a", "c", "e", "b"]);
  });

  it("formats prompt icon labels and resolves preset image sources", () => {
    expect(promptIconLabel("shield-check")).toBe("Shield Check");
    expect(getPresetReferenceSource({ dataUrl: "data:image/png;base64,a", src: "/fallback.png", mimeType: "image/png", name: "A", size: 1 })).toBe("data:image/png;base64,a");
    expect(getPresetReferenceSource({ src: "/image.png", mimeType: "image/png", name: "A", size: 1 })).toBe("/image.png");
    expect(getPresetReferenceSource({ mimeType: "image/png", name: "A", size: 1 })).toBe("");
  });
});
