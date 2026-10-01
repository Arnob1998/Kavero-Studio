import { describe, expect, it } from "vitest";
import { rasterDimensions, rejectEncryptedPdfBytes, selectedImportTotal, validatePdfFile, validatePdfPageCount } from "./import-policy";

describe("sequence import bounds", () => {
  const signature = new Uint8Array([37, 80, 68, 70, 45, 49]);
  it("rejects spoofed, empty, and oversized PDFs", () => {
    expect(() => validatePdfFile({ name: "a.pdf", type: "application/pdf", size: 10 }, signature)).not.toThrow();
    expect(() => validatePdfFile({ name: "a.pdf", type: "application/pdf", size: 10 }, new Uint8Array([1, 2]))).toThrow("valid PDF");
    expect(() => validatePdfFile({ name: "a.pdf", type: "application/pdf", size: 0 }, signature)).toThrow();
    expect(() => validatePdfFile({ name: "a.pdf", type: "application/pdf", size: 21 * 1024 * 1024 }, signature)).toThrow();
    expect(() => validatePdfFile({ name: "a.png", type: "image/png", size: 10 }, signature)).toThrow();
  });
  it("bounds pages, pixels, and aggregate payload", () => {
    expect(() => validatePdfPageCount(24)).not.toThrow();
    expect(() => validatePdfPageCount(25)).toThrow();
    expect(rasterDimensions(10000, 10000, 1600).width).toBeLessThanOrEqual(1600);
    expect(() => rasterDimensions(0, 100, 1600)).toThrow();
    expect(() => selectedImportTotal(0, [1024, 1024])).not.toThrow();
    expect(() => selectedImportTotal(31 * 1024 * 1024, [2 * 1024 * 1024])).toThrow();
    expect(() => selectedImportTotal(0, Array(9).fill(1024))).toThrow();
  });
  it("fails closed on an encryption dictionary marker", () => {
    expect(() => rejectEncryptedPdfBytes(new TextEncoder().encode("trailer << /Encrypt 2 0 R >>"))).toThrow("Encrypted");
    expect(() => rejectEncryptedPdfBytes(new TextEncoder().encode("trailer << /Root 2 0 R >>"))).not.toThrow();
  });
});
