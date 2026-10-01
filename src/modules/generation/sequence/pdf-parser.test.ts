import { describe, expect, it } from "vitest";
import { validatePdfPageCount } from "./import-policy";

function onePagePdf() {
  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  const object = (body: string) => {
    offsets.push(chunks.join("").length);
    chunks.push(`${offsets.length - 1} 0 obj\n${body}\nendobj\n`);
  };
  object("<< /Type /Catalog /Pages 2 0 R >>");
  object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  object("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>");
  object("<< /Length 0 >>\nstream\n\nendstream");
  const xref = chunks.join("").length;
  chunks.push(`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new TextEncoder().encode(chunks.join(""));
}

describe("PDF.js parser integration", () => {
  it("opens a valid PDF and rejects malformed bytes", async () => {
    const { getDocument } = await import("pdfjs-dist");
    const valid = await getDocument({ data: onePagePdf(), isEvalSupported: false }).promise;
    expect(valid.numPages).toBe(1);
    expect(() => validatePdfPageCount(valid.numPages)).not.toThrow();
    await valid.destroy();
    await expect(getDocument({ data: new Uint8Array([37, 80, 68, 70, 45, 0, 1]), isEvalSupported: false }).promise).rejects.toThrow();
  });
});
