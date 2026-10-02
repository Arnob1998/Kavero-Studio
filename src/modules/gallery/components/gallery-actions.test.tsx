import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GalleryImageActions } from "./gallery-image-actions";
import { GalleryGenerationActions } from "./gallery-generation-actions";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
describe("Gallery storage actions", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true })); });
  afterEach(() => { vi.unstubAllGlobals(); });
  it.each(["image", "generation"])("keeps files on record-only removal for %s", async (kind) => {
    render(kind === "image" ? <GalleryImageActions imageId="image-1" /> : <GalleryGenerationActions generationId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Remove from Gallery/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(kind === "image" ? "/api/gallery/image-1" : "/api/gallery/generations/run-1", { method: "DELETE" }));
  });
  it.each(["image", "generation"])("requests stored-file deletion only for permanent deletion of %s", async (kind) => {
    render(kind === "image" ? <GalleryImageActions imageId="image-1" /> : <GalleryGenerationActions generationId="run-1" />);
    fireEvent.click(screen.getByRole("button", { name: /Delete permanently/ }));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(kind === "image" ? "/api/gallery/image-1?files=delete" : "/api/gallery/generations/run-1?files=delete", { method: "DELETE" }));
  });
});
