export const SEQUENCE_IMPORT_LIMITS = Object.freeze({
  maximumPdfBytes: 20 * 1024 * 1024,
  maximumPdfPages: 24,
  maximumSelectedPages: 8,
  thumbnailEdge: 240,
  rasterEdge: 1600,
  maximumRasterPixels: 3_000_000,
  maximumRasterBytes: 7 * 1024 * 1024,
});

export function validatePdfFile(file: Pick<File, "name" | "type" | "size">, header: Uint8Array) {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    throw new Error("Choose a PDF document.");
  }
  if (file.size === 0 || file.size > SEQUENCE_IMPORT_LIMITS.maximumPdfBytes) {
    throw new Error("PDF must be non-empty and at most 20 MiB.");
  }
  const signature = [37, 80, 68, 70, 45]; // %PDF-
  if (signature.some((value, index) => header[index] !== value)) {
    throw new Error("This file is not a valid PDF.");
  }
}

export function rejectEncryptedPdfBytes(bytes: Uint8Array) {
  const marker = [47, 69, 110, 99, 114, 121, 112, 116]; // /Encrypt
  outer: for (let offset = 0; offset <= bytes.length - marker.length; offset += 1) {
    for (let index = 0; index < marker.length; index += 1) {
      if (bytes[offset + index] !== marker[index]) continue outer;
    }
    throw new Error("Encrypted PDFs are not supported.");
  }
}

export function validatePdfPageCount(count: number) {
  if (!Number.isInteger(count) || count < 1 || count > SEQUENCE_IMPORT_LIMITS.maximumPdfPages) {
    throw new Error("PDF must contain 1–24 pages.");
  }
}

export function rasterDimensions(width: number, height: number, edge: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("PDF page dimensions are invalid.");
  }
  const scale = Math.min(1, edge / Math.max(width, height), Math.sqrt(SEQUENCE_IMPORT_LIMITS.maximumRasterPixels / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

export function selectedImportTotal(existingBytes: number, selectedBytes: number[]) {
  if (selectedBytes.length < 1 || selectedBytes.length > SEQUENCE_IMPORT_LIMITS.maximumSelectedPages) {
    throw new Error("Select 1–8 pages or images.");
  }
  if (selectedBytes.some((size) => size <= 0 || size > SEQUENCE_IMPORT_LIMITS.maximumRasterBytes)) {
    throw new Error("An imported image exceeds the 7 MiB reference limit.");
  }
  if (existingBytes + selectedBytes.reduce((sum, size) => sum + size, 0) > 32 * 1024 * 1024) {
    throw new Error("Combined Sequence references exceed 32 MiB.");
  }
}
