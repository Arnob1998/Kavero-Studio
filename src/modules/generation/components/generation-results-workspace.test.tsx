import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GenerationRun } from "../types";
import { GenerationResultsWorkspace } from "./generation-results-workspace";

const run: GenerationRun = {
  id: "run-1",
  prompt: "A quiet glass house in a pine forest",
  model: "gemini-3-pro-image-preview",
  modelLabel: "Nano Banana Pro",
  kind: "image",
  images: [
    { id: "image-1", dataUrl: "data:image/png;base64,one", mimeType: "image/png", variant: 1 },
    { id: "image-2", dataUrl: "data:image/png;base64,two", mimeType: "image/png", variant: 2 },
  ],
  text: "",
  referenceImages: [
    { dataUrl: "data:image/png;base64,ref", mimeType: "image/png", name: "forest.png", size: 1200 },
  ],
  createdAt: "2026-09-12T00:00:00.000Z",
  settings: {
    model: "gemini-3-pro-image-preview",
    count: "2",
    thinking: "balanced",
    aspect: "1:1",
    quality: "1K",
    providerQuality: "auto",
    background: "auto",
  },
  warnings: [],
};

describe("GenerationResultsWorkspace", () => {
  it("makes the collage primary and keeps source content collapsed by default", () => {
    render(
      <GenerationResultsWorkspace
        run={run}
        isGenerating={false}
        loadingPhrase="Rendering image"
        error={null}
        onStartNewPrompt={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Focus generated image 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Focus generated image 2" })).toBeInTheDocument();
    expect(screen.queryByText(run.prompt)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Source/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes the source drawer without discarding prompt or references", () => {
    render(
      <GenerationResultsWorkspace
        run={run}
        isGenerating={false}
        loadingPhrase="Rendering image"
        error={null}
        onStartNewPrompt={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Source/ }));
    expect(screen.getByRole("complementary", { name: "Source prompt and references" })).toBeInTheDocument();
    expect(screen.getByText(run.prompt)).toBeInTheDocument();
    expect(screen.getByAltText("forest.png")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Source prompt and references" })).not.toBeInTheDocument();
  });

  it("switches between collage and focused-image modes and exposes no edit composer", () => {
    render(
      <GenerationResultsWorkspace
        run={run}
        isGenerating={false}
        loadingPhrase="Rendering image"
        error={null}
        onStartNewPrompt={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus generated image 2" }));
    expect(screen.getByAltText("Generated variation 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collage" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collage" }));
    expect(screen.getByRole("button", { name: "Focus generated image 1" })).toBeInTheDocument();
  });

  it("offers an explicit new-prompt action", () => {
    const onStartNewPrompt = vi.fn();
    render(
      <GenerationResultsWorkspace
        run={run}
        isGenerating={false}
        loadingPhrase="Rendering image"
        error={null}
        onStartNewPrompt={onStartNewPrompt}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /New prompt/ }));
    expect(onStartNewPrompt).toHaveBeenCalledOnce();
  });
});
