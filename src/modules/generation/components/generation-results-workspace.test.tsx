import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  it("uses JPEG download names in both collage and focus and offers a batch ZIP", () => {
    const jpegRun = { ...run, images: run.images.map((image) => ({ ...image, mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,one" })) };
    render(<GenerationResultsWorkspace run={jpegRun} isGenerating={false} loadingPhrase="" error={null} onStartNewPrompt={vi.fn()} onEditImage={vi.fn()} />);
    expect(screen.getByRole("link", { name: "Download generated image 1" })).toHaveAttribute("download", "kavero-1.jpg");
    expect(screen.getByRole("button", { name: "Download all (2)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Focus generated image 1" }));
    expect(screen.getByRole("link", { name: "Download focused image" })).toHaveAttribute("download", "kavero-1.jpg");
  });
  it("makes the collage primary and keeps source content collapsed by default", () => {
    render(
      <GenerationResultsWorkspace
        run={run}
        isGenerating={false}
        loadingPhrase="Rendering image"
        error={null}
        onStartNewPrompt={vi.fn()}
        onEditImage={vi.fn()}
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
        onEditImage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Source/ }));
    expect(screen.getByRole("complementary", { name: "Source prompt and references" })).toBeInTheDocument();
    expect(screen.getByText(run.prompt)).toBeInTheDocument();
    expect(screen.getByAltText("forest.png")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Source prompt and references" })).not.toBeInTheDocument();
  });

  it("switches between collage and focused-image modes and gates the edit composer to focus mode", () => {
    render(
      <GenerationResultsWorkspace
        run={run}
        isGenerating={false}
        loadingPhrase="Rendering image"
        error={null}
        onStartNewPrompt={vi.fn()}
        onEditImage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus generated image 2" }));
    expect(screen.getByAltText("Generated variation 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Collage" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Describe the image edit" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Collage" }));
    expect(screen.getByRole("button", { name: "Focus generated image 1" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Describe the image edit" })).not.toBeInTheDocument();
  });

  it("submits exactly the focused image with a prompt through the edit callback", async () => {
    const onEditImage = vi.fn(async () => undefined);
    render(
      <GenerationResultsWorkspace
        run={run}
        isGenerating={false}
        loadingPhrase="Rendering image"
        error={null}
        onStartNewPrompt={vi.fn()}
        onEditImage={onEditImage}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus generated image 2" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Describe the image edit" }), {
      target: { value: "Make the windows glow warmly" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Edit image" }));

    await waitFor(() => expect(onEditImage).toHaveBeenCalledWith(run.images[1], "Make the windows glow warmly"));
  });

  it("keeps unverified GPT Image 2 editing unavailable", () => {
    render(
      <GenerationResultsWorkspace
        run={{ ...run, model: "kavero-image-openai-gpt-image-2", settings: { ...run.settings, model: "gpt-image-2" } }}
        isGenerating={false}
        loadingPhrase="Rendering image"
        error={null}
        onStartNewPrompt={vi.fn()}
        onEditImage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Focus generated image 1" }));
    expect(screen.queryByRole("textbox", { name: "Describe the image edit" })).not.toBeInTheDocument();
    expect(screen.getByText("Iterative editing is not available for GPT Image 2.")).toBeInTheDocument();
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
        onEditImage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /New prompt/ }));
    expect(onStartNewPrompt).toHaveBeenCalledOnce();
  });
});
