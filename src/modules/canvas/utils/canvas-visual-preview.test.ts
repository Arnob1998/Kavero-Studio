import { describe, expect, it } from "vitest";
import { createCanvasVisualPreview, parseVisualDataUrl, type CanvasPreviewSource } from "./canvas-visual-preview";

function source(dataUrl: string): CanvasPreviewSource {
  return {
    getWidth: () => 800,
    getHeight: () => 600,
    toDataURL: () => dataUrl,
  };
}

describe("canvas visual preview", () => {
  it("generates a transient active page preview", () => {
    const preview = createCanvasVisualPreview(source("data:image/png;base64,AAAA"), "page-1");

    expect(preview).toMatchObject({
      status: "available",
      pageId: "page-1",
      mimeType: "image/png",
      width: 800,
      height: 600,
    });
    expect(preview.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(JSON.stringify({ canvas_json: "{}" })).not.toContain("data:image");
  });

  it("rejects unsupported preview formats", () => {
    expect(() => createCanvasVisualPreview(source("data:image/gif;base64,AAAA"), "page-1")).toThrow(
      "unsupported image format",
    );
  });

  it("parses supported preview byte size", () => {
    expect(parseVisualDataUrl("data:image/webp;base64,AAAA")).toEqual({
      mimeType: "image/webp",
      bytes: 3,
    });
  });
});
