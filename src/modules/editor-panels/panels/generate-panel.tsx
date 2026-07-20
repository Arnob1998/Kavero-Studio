import { useRef, useState } from "react";
import { Check, ChevronDown, Image as ImageIcon, LoaderCircle, Sparkles } from "lucide-react";
import type {
  CanvasImageBatchSize,
  CanvasImageGenerationSettings,
  CanvasImageModel,
  CanvasImageQuality,
  CanvasImageProviderBackground,
  CanvasImageProviderQuality,
  GeneratedCanvasImage,
} from "../types";
import { getBrowserImageModels } from "@/modules/model-providers/image-browser";

const canvasImageModels = getBrowserImageModels("canvas-generation");
export const canvasImageModelOptions: Array<{ value: CanvasImageModel; label: string }> = canvasImageModels.map((model) => ({
  value: model.legacyModelId as CanvasImageModel,
  label: model.displayLabel,
}));

export const canvasImageBatchOptions = [...canvasImageModels[0].featureCountPresets["canvas-generation"]] as CanvasImageBatchSize[];
export const canvasImageThinkingOptions = [...canvasImageModels[0].reasoning.values] as Array<"balanced" | "fast" | "deep">;
export const canvasImageAspectOptions = canvasImageModels[0].featureAspectRatios["canvas-generation"];
export const canvasImageQualityOptions = canvasImageModels[0].size.presets.map((preset) => preset.value) as CanvasImageQuality[];

export function getCanvasImageControlOptions(modelId: CanvasImageModel) {
  const model = canvasImageModels.find((entry) => entry.legacyModelId === modelId) ?? canvasImageModels[0];
  return {
    batches: [...model.featureCountPresets["canvas-generation"]] as CanvasImageBatchSize[],
    thinking: [...(model.reasoning.values.length ? model.reasoning.values : ["provider-managed"])],
    aspects: [...model.featureAspectRatios["canvas-generation"]],
    sizes: model.size.presets.map((preset) => ({ value: preset.value, label: preset.label })),
    qualities: [...(model.quality.values.length ? model.quality.values : ["auto"])],
    backgrounds: [...model.background.values],
  };
}

export function GeneratePanel({
  prompt,
  images,
  generating,
  addingImageId,
  error,
  warnings,
  settings,
  transparentBackground,
  onPromptChange,
  onGenerate,
  onAddImage,
  onTransparentChange,
  onSettingsChange,
}: {
  prompt: string;
  images: GeneratedCanvasImage[];
  generating: boolean;
  addingImageId: string | null;
  error: string | null;
  warnings: string[];
  settings: CanvasImageGenerationSettings;
  transparentBackground: boolean;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onAddImage: (image: GeneratedCanvasImage) => void;
  onTransparentChange: (value: boolean) => void;
  onSettingsChange: (settings: CanvasImageGenerationSettings) => void;
}) {
  const controls = getCanvasImageControlOptions(settings.model);
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[linear-gradient(180deg,rgb(255_255_255_/_0.035),transparent_30%)]">
      <div className="shrink-0 border-b border-white/[0.07] px-4 pb-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onGenerate();
          }}
          className="rounded-2xl border border-white/[0.1] bg-white/[0.055] p-2 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.07)] focus-within:border-accent/55"
        >
          <textarea
            className="min-h-[90px] w-full resize-none bg-transparent px-1.5 py-1 text-[13px] font-medium leading-5 text-white/84 outline-none placeholder:text-white/28"
            value={prompt}
            onChange={(event) => onPromptChange((event.target as HTMLTextAreaElement).value)}
            placeholder="Describe the image to generate..."
            disabled={generating}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onGenerate();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/[0.07] pt-2">
            <button
              type="button"
              className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-black transition ${
                transparentBackground
                  ? "border-accent/35 bg-accent/14 text-accent"
                  : "border-white/[0.08] bg-white/[0.04] text-white/46 hover:bg-white/[0.075] hover:text-white/70"
              }`}
              onClick={() => onTransparentChange(!transparentBackground)}
              disabled={generating}
            >
              <Sparkles size={12} />
              Alpha
            </button>
            <button
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3 text-[11px] font-black text-white shadow-[0_12px_26px_rgb(59_130_246_/_0.24)] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
              disabled={generating || !prompt.trim()}
              type="submit"
            >
              {generating ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}
              {generating ? "Generating" : "Generate"}
            </button>
          </div>
        </form>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-color:rgb(255_255_255_/_0.25)_transparent]">
        {error ? (
          <div className="mb-3 rounded-2xl border border-red-300/18 bg-red-500/10 px-3 py-2.5 text-[11px] font-semibold leading-4 text-red-100/72">
            {error}
          </div>
        ) : null}
        {warnings.length > 0 ? (
          <div className="mb-3 rounded-2xl border border-amber-300/16 bg-amber-500/10 px-3 py-2 text-[10px] font-semibold leading-4 text-amber-50/62">
            {warnings.join(" ")}
          </div>
        ) : null}
        {images.length === 0 ? (
          <div className="grid min-h-[260px] place-items-center rounded-2xl border border-white/[0.08] bg-white/[0.035] px-6 text-center">
            <span>
              <ImageIcon size={24} className="mx-auto mb-2 text-white/34" />
              <span className="block text-[12px] font-bold text-white/48">Generated images appear here</span>
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {images.map((image) => (
              <button
                key={image.id}
                className="group overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.04] text-left transition hover:border-accent/45 hover:bg-accent/10 disabled:opacity-60"
                disabled={Boolean(addingImageId)}
                onClick={() => onAddImage(image)}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "copy";
                  event.dataTransfer.setData("text/plain", image.dataUrl);
                }}
                title="Add generated image to canvas"
              >
                <span className="relative grid aspect-square place-items-center overflow-hidden bg-[linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%),linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%)] bg-[length:14px_14px] bg-[position:0_0,7px_7px]">
                  <img
                    className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.03] group-hover:opacity-100"
                    src={image.dataUrl}
                    alt=""
                    draggable={false}
                  />
                  {addingImageId === image.id ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/58">
                      <LoaderCircle size={18} className="animate-spin text-white/74" />
                    </span>
                  ) : null}
                </span>
                <span className="flex items-center justify-between gap-2 border-t border-white/[0.08] px-2 py-1.5">
                  <span className="truncate text-[10px] font-semibold text-white/52">Variation {image.variant}</span>
                  {image.transparentBackground ? <span className="text-[9px] font-black uppercase text-accent/80">Alpha</span> : null}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-white/[0.07] bg-black/24 p-4">
        <div className="grid grid-cols-2 gap-2">
          <SettingsSelect
            label="Batch"
            value={String(settings.batchSize)}
            options={controls.batches.map((value) => ({ value: String(value), label: `${value}x` }))}
            onChange={(batchSize) => onSettingsChange({ ...settings, batchSize: Number(batchSize) as CanvasImageBatchSize })}
          />
          <SettingsSelect
            label="Model"
            value={settings.model}
            options={canvasImageModelOptions.map((option) => ({ value: option.value, label: option.label }))}
            onChange={(model) => onSettingsChange({ ...settings, model: model as CanvasImageModel })}
          />
          <SettingsSelect
            label="Aspect"
            value={settings.aspectRatio}
            options={controls.aspects.map((value) => ({ value, label: value }))}
            onChange={(aspectRatio) => onSettingsChange({ ...settings, aspectRatio })}
          />
          <SettingsSelect
            label="Size"
            value={settings.imageSize}
            options={controls.sizes}
            onChange={(imageSize) => onSettingsChange({ ...settings, imageSize: imageSize as CanvasImageQuality })}
          />
          <SettingsSelect
            label="Quality"
            value={settings.quality}
            options={controls.qualities.map((value) => ({ value, label: value }))}
            onChange={(quality) => onSettingsChange({ ...settings, quality: quality as CanvasImageProviderQuality })}
          />
          <SettingsSelect
            label="Background"
            value={settings.background}
            options={controls.backgrounds.map((value) => ({ value, label: value }))}
            onChange={(background) => onSettingsChange({ ...settings, background: background as CanvasImageProviderBackground })}
          />
        </div>
      </div>
    </div>
  );
}

export function SettingsSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const menuPlacementClass = placement === "top" ? "bottom-full mb-1 max-h-64" : "top-full mt-1 max-h-56";

  const toggleOpen = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setPlacement(spaceBelow < 190 && spaceAbove > spaceBelow ? "top" : "bottom");
    }
    setOpen((current) => !current);
  };

  return (
    <div className="grid gap-1">
      <span className="text-[10px] font-black uppercase tracking-[0.08em] text-white/30">{label}</span>
      <div className="relative">
        <button
          ref={buttonRef}
          className={`flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-xl border px-2.5 text-left text-[11px] font-bold outline-none transition ${
            open
              ? "border-accent/55 bg-accent/12 text-white shadow-[0_10px_28px_rgb(59_130_246_/_0.16)]"
              : "border-white/[0.09] bg-white/[0.055] text-white/72 hover:border-white/[0.16] hover:bg-white/[0.075]"
          }`}
          type="button"
          onClick={toggleOpen}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="truncate">{selected?.label ?? value}</span>
          <ChevronDown size={13} className={`shrink-0 text-white/36 transition ${open ? "rotate-180 text-accent/90" : ""}`} />
        </button>
        {open ? (
          <div
            className={`absolute left-0 right-0 z-50 overflow-y-auto rounded-xl border border-white/[0.1] bg-[#101013] p-1 shadow-[0_20px_60px_rgb(0_0_0_/_0.55),inset_0_1px_0_rgb(255_255_255_/_0.05)] [scrollbar-color:rgb(255_255_255_/_0.22)_transparent] ${menuPlacementClass}`}
            role="listbox"
          >
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  className={`flex h-8 w-full items-center justify-between rounded-lg px-2 text-left text-[11px] font-bold transition ${
                    active
                      ? "bg-accent text-white shadow-[0_8px_22px_rgb(59_130_246_/_0.24)]"
                      : "text-white/64 hover:bg-white/[0.07] hover:text-white"
                  }`}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                  {active ? <Check size={12} className="shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function labelize(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
