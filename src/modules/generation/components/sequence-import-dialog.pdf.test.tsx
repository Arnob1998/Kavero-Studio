import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pdf = vi.hoisted(() => {
  const destroy = vi.fn(async () => undefined);
  const renderPage = vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() }));
  const cleanup = vi.fn();
  const getPage = vi.fn(async (_page: number) => ({ getViewport: ({ scale }: { scale: number }) => ({ width: 800 * scale, height: 1000 * scale }), render: renderPage, cleanup }));
  const getDocument = vi.fn(() => ({ promise: Promise.resolve({ numPages: 2, getPage, destroy }), destroy, onPassword: undefined }));
  return { destroy, renderPage, cleanup, getPage, getDocument };
});
vi.mock("pdfjs-dist", () => ({ GlobalWorkerOptions: { workerSrc: "" }, getDocument: pdf.getDocument }));

import { SequenceImportDialog } from "./sequence-import-dialog";
import type { ReferenceImage } from "../types";

describe("PDF sequence import", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("page-a").mockReturnValueOnce("page-b") });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ fillStyle: "", fillRect: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["jpeg"], { type: "image/jpeg" })));
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); pdf.destroy.mockClear(); pdf.getPage.mockClear(); pdf.getDocument.mockClear(); });

  it("renders bounded previews then imports selected raster pages in review order", async () => {
    const onImport = vi.fn((_images: ReferenceImage[]) => true);
    const view = render(<SequenceImportDialog availableSlots={2} existingBytes={0} onImport={onImport} onClose={vi.fn()} />);
    const bytes = new TextEncoder().encode("%PDF-1.7");
    const file = { name: "slides.pdf", type: "application/pdf", size: bytes.length, slice: () => ({ arrayBuffer: async () => bytes.slice(0, 5).buffer }), arrayBuffer: async () => bytes.buffer };
    fireEvent.change(screen.getByLabelText("PDF or images"), { target: { files: [file] } });
    await screen.findByLabelText("Move item 2 up");
    fireEvent.click(screen.getByLabelText("Move item 2 up"));
    fireEvent.change(screen.getByLabelText("Label for item 1"), { target: { value: "Final slide" } });
    fireEvent.click(screen.getByText("Add selected references"));
    await waitFor(() => expect(onImport).toHaveBeenCalledOnce());
    expect(onImport.mock.calls[0][0]).toMatchObject([
      { name: "Final slide", mimeType: "image/jpeg", size: 4 },
      { name: "slides.pdf · page 1", mimeType: "image/jpeg", size: 4 },
    ]);
    expect(onImport.mock.calls[0][0].every((image: { dataUrl: string }) => image.dataUrl.startsWith("data:image/jpeg"))).toBe(true);
    expect(pdf.getPage.mock.calls.map(([page]) => page)).toEqual([1, 2, 2, 1]);
    view.unmount();
    expect(pdf.destroy).toHaveBeenCalled();
  });
});
