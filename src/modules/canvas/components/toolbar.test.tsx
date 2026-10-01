import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Toolbar } from "./toolbar";

const mocks = vi.hoisted(() => ({ getPagePNG: vi.fn(), downloadImagesZip: vi.fn(), exportPNG: vi.fn(), showError: vi.fn() }));
vi.mock("@/lib/image-export", () => ({ downloadImagesZip: mocks.downloadImagesZip }));
vi.mock("@/modules/canvas/state/context", () => ({
  CANVAS_SIZES: [], CANVAS_SIZE_GROUPS: [],
  useEditor: () => ({ ...mocks, pages: [{ id: "a", title: "First" }, { id: "b", title: "Second" }], activeDesign: { name: "My design" }, canvasWidth: 1080, canvasHeight: 1080, zoom: 1, fitScale: 1 }),
}));
beforeEach(() => vi.resetAllMocks());

describe("canvas exports", () => {
  it("exports every live page in order with its title", async () => {
    mocks.getPagePNG.mockResolvedValueOnce("first-data").mockResolvedValueOnce("second-data");
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "All pages (2) · ZIP" }));
    await waitFor(() => expect(mocks.downloadImagesZip).toHaveBeenCalledWith([
      { dataUrl: "first-data", mimeType: "image/png", name: "First" },
      { dataUrl: "second-data", mimeType: "image/png", name: "Second" },
    ], "My design"));
    expect(mocks.getPagePNG.mock.calls).toEqual([["a"], ["b"]]);
  });

  it("keeps single-page export available", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "Current page · PNG" }));
    expect(mocks.exportPNG).toHaveBeenCalledOnce();
  });

  it("does not download a partial archive when any page fails validation", async () => {
    mocks.getPagePNG.mockResolvedValueOnce("first-data").mockResolvedValueOnce(undefined);
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    fireEvent.click(screen.getByRole("button", { name: "All pages (2) · ZIP" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Export" })).toBeEnabled());
    expect(mocks.downloadImagesZip).not.toHaveBeenCalled();
  });
});
