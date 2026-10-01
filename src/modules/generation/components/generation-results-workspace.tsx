"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Images, Loader2, PanelLeftOpen, Plus, Send, X } from "lucide-react";
import { brand } from "@/lib/brand";
import { imageDownloadName } from "@/lib/image-export";
import { DownloadImagesButton } from "./download-images-button";
import { getBrowserImageModelByAlias, getBrowserImageModelByLegacyId } from "@/modules/model-providers/image-browser";
import type { GeneratedImage, GenerationRun, ReferenceImage } from "../types";
import { formatBytes } from "../utils/client-helpers";

function SourceContent({ prompt, images }: { prompt: string; images: ReferenceImage[] }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto p-4 pt-5 [scrollbar-color:rgb(255_255_255_/_0.24)_transparent]">
      <div className="rounded-xl border border-white/[0.08] bg-black/30 p-4 text-left">
        <span className="text-[10px] font-black uppercase tracking-[0.08em] text-white/38">Prompt</span>
        <p className="mt-2 whitespace-pre-wrap text-[13px] font-semibold leading-6 text-white/74">
          {prompt || "Prompt will appear here."}
        </p>
      </div>

      {images.length > 0 ? (
        <div className="mt-4">
          <span className="text-[10px] font-black uppercase tracking-[0.08em] text-white/38">
            References · {images.length}
          </span>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {images.map((image, index) => (
              <div
                key={`${image.name}-${image.size}-${index}`}
                className="grid min-h-[132px] place-items-center overflow-hidden rounded-lg border border-white/[0.08] bg-black/28 p-1"
                title={`${image.name} (${formatBytes(image.size)})`}
              >
                {image.mimeType === "image/heic" || image.mimeType === "image/heif" ? (
                  <span className="px-3 text-center text-[11px] font-bold text-white/62">{image.name}</span>
                ) : (
                  <img className="max-h-[220px] w-full object-contain" src={image.dataUrl} alt={image.name} />
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ResultCollage({
  images,
  focusedImage,
  onFocus,
  onClearFocus,
  reserveComposerSpace,
}: {
  images: GeneratedImage[];
  focusedImage: GeneratedImage | null;
  onFocus: (image: GeneratedImage) => void;
  onClearFocus: () => void;
  reserveComposerSpace: boolean;
}) {
  if (focusedImage) {
    return (
      <div className={`grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] px-4 pt-14 sm:px-6 ${reserveComposerSpace ? "pb-40" : "pb-4 sm:pb-6"}`}>
        <div className="relative grid min-h-0 place-items-center">
          <button
            className="absolute left-0 top-0 z-10 inline-flex h-9 items-center gap-2 rounded-lg border border-white/[0.1] bg-black/58 px-3 text-[11px] font-bold text-white/70 backdrop-blur-xl transition hover:bg-white/[0.08] hover:text-white"
            type="button"
            onClick={onClearFocus}
          >
            <Images size={15} />
            Collage
          </button>
          <a
            className="absolute right-0 top-0 z-10 grid h-9 w-9 place-items-center rounded-lg border border-white/[0.1] bg-black/58 text-white/70 backdrop-blur-xl transition hover:bg-white/[0.08] hover:text-white"
            href={focusedImage.dataUrl}
            download={imageDownloadName(`${brand.slug}-${focusedImage.variant}`, focusedImage.mimeType)}
            aria-label="Download focused image"
          >
            <Download size={16} />
          </a>
          <img
            className="absolute inset-0 h-full w-full object-contain"
            src={focusedImage.dataUrl}
            alt={`Generated variation ${focusedImage.variant}`}
          />
        </div>

        {images.length > 1 ? (
          <div className="mx-auto mt-3 flex max-w-full gap-2 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/42 p-2 [scrollbar-color:rgb(255_255_255_/_0.24)_transparent]">
            {images.map((image) => (
              <button
                key={image.id}
                className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border transition ${
                  image.id === focusedImage.id
                    ? "border-white/72 opacity-100"
                    : "border-white/[0.08] opacity-58 hover:opacity-100"
                }`}
                type="button"
                aria-label={`Focus variation ${image.variant}`}
                aria-pressed={image.id === focusedImage.id}
                onClick={() => onFocus(image)}
              >
                <img className="h-full w-full object-cover" src={image.dataUrl} alt="" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const gridClass =
    images.length === 1
      ? "max-w-[980px] grid-cols-1"
      : images.length === 2
        ? "max-w-[1240px] grid-cols-1 sm:grid-cols-2"
        : images.length <= 6
          ? "max-w-[1480px] grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
          : "max-w-[1560px] grid-cols-2 sm:grid-cols-3 xl:grid-cols-4";

  return (
    <div className="h-full overflow-y-auto px-3 pb-5 pt-14 sm:px-5 [scrollbar-color:rgb(255_255_255_/_0.24)_transparent]">
      <div className={`mx-auto grid min-h-full w-full content-center gap-2 ${gridClass}`}>
        {images.map((image) => (
          <div key={image.id} className="group relative min-h-0 overflow-hidden rounded-lg bg-black/18">
            <button
              className="block h-full w-full cursor-zoom-in p-0 transition hover:bg-white/[0.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              type="button"
              aria-label={`Focus generated image ${image.variant}`}
              onClick={() => onFocus(image)}
            >
              <img
                className="block max-h-[min(52svh,520px)] w-full object-contain shadow-[0_18px_50px_rgb(0_0_0_/_0.45)]"
                src={image.dataUrl}
                alt={`Generated variation ${image.variant}`}
              />
            </button>
            <a
              className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-lg border border-white/[0.12] bg-black/64 text-white/72 opacity-100 backdrop-blur-xl transition hover:bg-white/[0.1] hover:text-white sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
              href={image.dataUrl}
              download={imageDownloadName(`${brand.slug}-${image.variant}`, image.mimeType)}
              aria-label={`Download generated image ${image.variant}`}
            >
              <Download size={16} />
            </a>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GenerationResultsWorkspace({
  run,
  isGenerating,
  loadingPhrase,
  error,
  onStartNewPrompt,
  onEditImage,
  iterationRuns = [],
  onSelectRun,
  requestedFocusedImageId = null,
}: {
  run: GenerationRun | null;
  isGenerating: boolean;
  loadingPhrase: string;
  error: string | null;
  onStartNewPrompt: () => void;
  onEditImage: (image: GeneratedImage, prompt: string) => Promise<void>;
  iterationRuns?: GenerationRun[];
  onSelectRun?: (run: GenerationRun) => void;
  requestedFocusedImageId?: string | null;
}) {
  const [focusedImageId, setFocusedImageId] = useState<string | null>(null);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [editPrompt, setEditPrompt] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const sourceButtonRef = useRef<HTMLButtonElement>(null);
  const focusedImage = run?.images.find((image) => image.id === focusedImageId) ?? null;
  const runModel = run
    ? getBrowserImageModelByAlias(run.model) ?? getBrowserImageModelByLegacyId(run.settings.model)
    : null;
  const canEditFocusedImage = Boolean(
    focusedImage && runModel?.provider === "gemini" && runModel.supportsReferenceEditing,
  );

  useEffect(() => {
    setFocusedImageId(
      requestedFocusedImageId && run?.images.some((image) => image.id === requestedFocusedImageId)
        ? requestedFocusedImageId
        : null,
    );
    setSourceOpen(false);
    setEditPrompt("");
    setEditError(null);
  }, [requestedFocusedImageId, run?.id, run?.images]);

  const submitEdit = async () => {
    const prompt = editPrompt.trim();
    if (!focusedImage || !canEditFocusedImage || !prompt || isEditing) return;
    setIsEditing(true);
    setEditError(null);
    try {
      await onEditImage(focusedImage, prompt);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Image editing failed.");
    } finally {
      setIsEditing(false);
    }
  };

  useEffect(() => {
    if (!sourceOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSourceOpen(false);
      window.requestAnimationFrame(() => sourceButtonRef.current?.focus());
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sourceOpen]);

  return (
    <div className="w-full max-w-[1680px] pb-24">
      <div className="relative h-[min(76svh,880px)] min-h-[460px] overflow-hidden rounded-xl border border-white/[0.1] bg-[#0b0b0b] shadow-[0_28px_110px_rgb(0_0_0_/_0.58),inset_0_1px_0_rgb(255_255_255_/_0.07)]">
        <div className="absolute left-4 top-4 z-20 rounded-md border border-white/[0.1] bg-black/62 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/68">
          {focusedImage ? `Variation ${focusedImage.variant}` : "Generated"}
        </div>
        <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-lg border border-white/[0.08] bg-black/54 p-1 backdrop-blur-xl">
          {!isGenerating && run && run.images.length > 1 ? (
            <DownloadImagesButton images={run.images.map((image) => ({ ...image, name: `${brand.slug}-${image.variant}` }))} name={`${brand.slug}-images`} />
          ) : null}
          <button
            ref={sourceButtonRef}
            className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[10px] font-black uppercase tracking-[0.06em] text-white/62 transition hover:bg-white/[0.08] hover:text-white"
            type="button"
            aria-expanded={sourceOpen}
            aria-controls="generation-source-panel"
            onClick={() => setSourceOpen(true)}
          >
            <PanelLeftOpen size={15} />
            <span className="hidden sm:inline">Source</span>
          </button>
          <button
            className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[10px] font-black uppercase tracking-[0.06em] text-white/62 transition hover:bg-white/[0.08] hover:text-white"
            type="button"
            disabled={isGenerating}
            onClick={onStartNewPrompt}
          >
            <Plus size={15} />
            <span className="hidden sm:inline">New prompt</span>
          </button>
        </div>

        {isGenerating ? (
          <div className="grid h-full place-items-center bg-black/72 text-center">
            <span>
              <span className="mx-auto block h-10 w-10 animate-spin rounded-full border-2 border-white/16 border-t-accent" />
              <span className="mt-3 block text-[13px] font-extrabold text-white">{loadingPhrase}</span>
            </span>
          </div>
        ) : error ? (
          <div className="grid h-full place-items-center p-8 text-center">
            <p className="max-w-[56ch] rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-[13px] font-semibold leading-5 text-red-100">{error}</p>
          </div>
        ) : run?.images.length ? (
          <ResultCollage
            images={run.images}
            focusedImage={focusedImage}
            onFocus={(image) => setFocusedImageId(image.id)}
            onClearFocus={() => setFocusedImageId(null)}
            reserveComposerSpace={Boolean(focusedImage)}
          />
        ) : (
          <div className="grid h-full place-items-center text-[13px] font-semibold text-white/46">Waiting for output</div>
        )}

        {focusedImage ? (
          <div className="absolute inset-x-3 bottom-3 z-30 mx-auto w-[min(760px,calc(100%-24px))]">
            {canEditFocusedImage ? (
              <form
                className="rounded-2xl border border-white/[0.1] bg-black/76 p-2 shadow-[0_20px_70px_rgb(0_0_0_/_0.62)] backdrop-blur-2xl"
                aria-label="Edit focused image"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitEdit();
                }}
              >
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1 text-left">
                    <span className="sr-only">Describe the image edit</span>
                    <textarea
                      className="block max-h-28 min-h-12 w-full resize-none bg-transparent px-3 py-2 text-[13px] font-semibold leading-5 text-white outline-none placeholder:text-white/42"
                      value={editPrompt}
                      placeholder="Describe what to change..."
                      disabled={isEditing}
                      onChange={(event) => setEditPrompt(event.target.value)}
                    />
                  </label>
                  <button
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                    type="submit"
                    aria-label={isEditing ? "Editing image" : "Edit image"}
                    disabled={isEditing || !editPrompt.trim()}
                  >
                    {isEditing ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
                  </button>
                </div>
                {editError ? <p className="px-3 pb-1 text-left text-[11px] font-semibold text-red-200">{editError}</p> : null}
              </form>
            ) : (
              <p className="rounded-xl border border-white/[0.08] bg-black/68 px-3 py-2 text-center text-[11px] font-semibold text-white/52 backdrop-blur-xl">
                Iterative editing is not available for {runModel?.displayLabel ?? "this model"}.
              </p>
            )}
            {iterationRuns.length > 1 ? (
              <div className="mt-2 flex justify-center gap-1.5 overflow-x-auto">
                {iterationRuns.map((iteration, index) => (
                  <button
                    key={iteration.id}
                    className={`h-7 shrink-0 rounded-lg border px-2 text-[10px] font-bold transition ${iteration.id === run?.id ? "border-accent/60 bg-accent/18 text-white" : "border-white/[0.08] bg-black/54 text-white/52 hover:text-white"}`}
                    type="button"
                    aria-label={`Open iteration ${index + 1}`}
                    aria-current={iteration.id === run?.id ? "step" : undefined}
                    onClick={() => onSelectRun?.(iteration)}
                  >
                    {index === 0 ? "Original" : `Edit ${index}`}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {sourceOpen ? (
          <>
            <button
              className="absolute inset-0 z-40 bg-black/56 backdrop-blur-[2px]"
              type="button"
              aria-label="Close source panel"
              onClick={() => setSourceOpen(false)}
            />
            <aside
              id="generation-source-panel"
              className="absolute inset-y-0 left-0 z-50 flex w-[min(92%,560px)] flex-col border-r border-white/[0.1] bg-[#101010]/96 shadow-[28px_0_90px_rgb(0_0_0_/_0.68)] backdrop-blur-2xl"
              aria-label="Source prompt and references"
            >
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.08] px-4">
                <span>
                  <span className="block text-[11px] font-black uppercase tracking-[0.08em] text-white/72">Source</span>
                  <span className="block text-[10px] font-semibold text-white/40">Prompt and reference images</span>
                </span>
                <button
                  className="grid h-9 w-9 place-items-center rounded-lg text-white/62 transition hover:bg-white/[0.08] hover:text-white"
                  type="button"
                  aria-label="Close source panel"
                  autoFocus
                  onClick={() => {
                    setSourceOpen(false);
                    window.requestAnimationFrame(() => sourceButtonRef.current?.focus());
                  }}
                >
                  <X size={16} />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <SourceContent prompt={run?.prompt ?? ""} images={run?.referenceImages ?? []} />
              </div>
            </aside>
          </>
        ) : null}
      </div>

      {run?.warnings.length ? (
        <p className="mt-3 text-left text-[11px] font-semibold leading-5 text-yellow-100/72">{run.warnings.join(" ")}</p>
      ) : null}
    </div>
  );
}
