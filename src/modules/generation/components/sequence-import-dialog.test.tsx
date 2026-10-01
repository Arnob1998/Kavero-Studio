import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SequenceImportDialog } from "./sequence-import-dialog";
import type { ReferenceImage } from "../types";

describe("SequenceImportDialog", () => {
  const createUrl = vi.fn((file: File) => `blob:${file.name}`);
  const revokeUrl = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revokeUrl }));
    vi.stubGlobal("crypto", { randomUUID: vi.fn().mockReturnValueOnce("ref-1").mockReturnValueOnce("ref-2") });
  });
  afterEach(() => { vi.unstubAllGlobals(); createUrl.mockClear(); revokeUrl.mockClear(); });

  it("reviews, reorders, relabels, removes and imports only selected images", async () => {
    const onImport = vi.fn((_images: ReferenceImage[]) => true);
    const view = render(<SequenceImportDialog availableSlots={2} existingBytes={0} onImport={onImport} onClose={vi.fn()} />);
    const input = screen.getByLabelText("PDF or images") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["a"], "first.png", { type: "image/png" }), new File(["b"], "second.png", { type: "image/png" })] } });
    await screen.findByLabelText("Move item 2 up");
    fireEvent.click(screen.getByLabelText("Move item 2 up"));
    fireEvent.change(screen.getByLabelText("Label for item 1"), { target: { value: "Opening card" } });
    fireEvent.click(screen.getByLabelText("Select first.png"));
    fireEvent.click(screen.getByText("Add selected references"));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0][0]).toMatchObject([{ name: "Opening card", mimeType: "image/png", size: 1 }]);
    view.unmount();
    expect(revokeUrl).toHaveBeenCalledWith("blob:first.png");
    expect(revokeUrl).toHaveBeenCalledWith("blob:second.png");
  });

  it("rejects mixed PDF/image selections before parsing", async () => {
    render(<SequenceImportDialog availableSlots={2} existingBytes={0} onImport={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("PDF or images"), { target: { files: [new File(["%PDF-"], "test.pdf", { type: "application/pdf" }), new File(["x"], "image.png", { type: "image/png" })] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose PNG, JPEG, WebP, HEIC, or HEIF images, or one PDF.");
  });

  it("rejects a spoofed PDF before loading the parser", async () => {
    render(<SequenceImportDialog availableSlots={2} existingBytes={0} onImport={vi.fn()} onClose={vi.fn()} />);
    const fakePdf = {
      name: "fake.pdf", type: "application/pdf", size: 8,
      slice: () => ({ arrayBuffer: async () => new Uint8Array([78, 79, 84, 80, 68]).buffer }),
    };
    fireEvent.change(screen.getByLabelText("PDF or images"), { target: { files: [fakePdf] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("not a valid PDF");
  });
});
