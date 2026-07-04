export interface CanvasVisualPreview {
  status: "available";
  pageId: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

export interface CanvasPreviewSource {
  getWidth: () => number;
  getHeight: () => number;
  toDataURL: (options: { format: "png"; multiplier: number; quality: number }) => string;
}

const MAX_PREVIEW_BYTES = 4 * 1024 * 1024;

export function createCanvasVisualPreview(canvas: CanvasPreviewSource, pageId: string): CanvasVisualPreview {
  const dataUrl = canvas.toDataURL({
    format: "png",
    multiplier: 1,
    quality: 0.92,
  });
  const parsed = parseVisualDataUrl(dataUrl);
  if (!parsed) throw new Error("Canvas preview generation returned an unsupported image format.");
  if (parsed.bytes > MAX_PREVIEW_BYTES) throw new Error("Canvas preview is too large for assistant context.");

  return {
    status: "available",
    pageId,
    mimeType: parsed.mimeType,
    dataUrl,
    width: canvas.getWidth(),
    height: canvas.getHeight(),
    bytes: parsed.bytes,
  };
}

export function parseVisualDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) return null;
  return {
    mimeType: match[1] as CanvasVisualPreview["mimeType"],
    bytes: estimateBase64Bytes(match[2]),
  };
}

function estimateBase64Bytes(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}
