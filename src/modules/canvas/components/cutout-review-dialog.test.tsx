import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CutoutReviewDialog } from "./cutout-review-dialog";

const cutout = new Blob(["cutout"], { type: "image/png" });
const drawImage = vi.fn();
const clearRect = vi.fn();
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("original")));
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1024, height: 1024, close: vi.fn() }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage, clearRect } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(cutout));
  drawImage.mockClear(); clearRect.mockClear();
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("cutout review", () => {
  it("allows local reset and cancellation without applying or saving", async () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(<CutoutReviewDialog sourceUrl="/original" cutout={cutout} busy={false} onApply={onApply} onCancel={onCancel} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply cutout" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(clearRect).toHaveBeenCalledWith(0, 0, 1024, 1024);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("saves only after explicitly applying the reviewed PNG", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<CutoutReviewDialog sourceUrl="/original" cutout={cutout} busy={false} onApply={onApply} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply cutout" })).toBeEnabled());
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Apply cutout" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(cutout));
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
  });

  it("keeps the review retryable when storage/apply fails", async () => {
    render(<CutoutReviewDialog sourceUrl="/original" cutout={cutout} busy={false} onApply={vi.fn().mockRejectedValue(new Error("Storage unavailable"))} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply cutout" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Apply cutout" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Storage unavailable");
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply cutout" })).toBeEnabled());
  });

  it("blocks applying if the original cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing", { status: 404 })));
    render(<CutoutReviewDialog sourceUrl="/original" cutout={cutout} busy={false} onApply={vi.fn()} onCancel={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load the original");
    expect(screen.getByRole("button", { name: "Apply cutout" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
