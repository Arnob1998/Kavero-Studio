import { zip } from "fflate";

export type ImageExportSource = { dataUrl: string; mimeType: string; name: string };

function safeFileName(name: string) {
  return name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").trim().slice(0, 120) || "image";
}

export function imageDownloadName(name: string, mimeType: string) {
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" } as Record<string, string>)[mimeType.split(";")[0].toLowerCase()] ?? "bin";
  return `${safeFileName(name)}.${extension}`;
}

export async function createImagesZip(images: ImageExportSource[]) {
  if (!images.length) throw new Error("No images to export.");
  const files: Record<string, Uint8Array> = {};
  for (const [index, image] of images.entries()) {
    const response = await fetch(image.dataUrl);
    if (!response.ok) throw new Error(`Unable to export image ${index + 1}. Try again after checking storage access.`);
    const contentType = response.headers.get("content-type")?.split(";")[0];
    if (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream") {
      throw new Error(`Image ${index + 1} is unavailable. Check storage access and try again.`);
    }
    const mimeType = contentType?.startsWith("image/") ? contentType : image.mimeType;
    // Prefix positions keep ordering and prevent duplicate names overwriting files.
    files[imageDownloadName(`${String(index + 1).padStart(2, "0")}-${image.name}`, mimeType)] = new Uint8Array(await response.arrayBuffer());
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (error, result) => error ? reject(error) : resolve(result));
  });
  return new Blob([new Uint8Array(bytes)], { type: "application/zip" });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Keep the URL alive until the browser has consumed the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadImagesZip(images: ImageExportSource[], name: string) {
  downloadBlob(await createImagesZip(images), `${safeFileName(name)}.zip`);
}
