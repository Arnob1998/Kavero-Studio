"use client";

import Link from "next/link";
import type { ChangeEvent, ComponentType, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  BadgePlus,
  BrainCircuit,
  Check,
  ChevronDown,
  Columns2,
  CornerDownLeft,
  Download,
  Edit3,
  Eye,
  FileText,
  HardDrive,
  Images,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  LogIn,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  RectangleHorizontal,
  RotateCcw,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";
import { DynamicIcon } from "lucide-react/dynamic";
import type { IconName } from "lucide-react/dynamic";
import { PromptComposer } from "@/components/headless/prompt-composer";
import { SiteNav } from "@/components/site-nav";
import { FloatingTooltip } from "@/components/unlumen-ui/floating-tooltip";
import { brand } from "@/lib/brand";
import { getBrowserImageModelByAlias, getBrowserImageModelByLegacyId, getBrowserImageModels, normalizeBrowserImageUiSettings, type BrowserImageModel } from "@/modules/model-providers/image-browser";
import { useModelProviderSettings } from "@/modules/model-providers/browser-settings";
import type {
  DrivePreflightResponse,
  GateDialog,
  GenerateApiError,
  GenerateApiResponse,
  GeneratedImage,
  GeneratedPanelMode,
  GenerationRun,
  ModelId,
  PresetReferenceImage,
  PromptPreset,
  PromptRefinerAnswer,
  PromptRefinerApiResponse,
  PromptRefinerState,
  PromptTemplateRecord,
  PromptThumbnailIcon,
  ReferenceImage,
  SettingKey,
  UploadStatus,
  WorkspaceStatusResponse,
} from "../types";
import {
  DEFAULT_PROMPT_ICON,
  PROMPT_ICON_COLORS,
  formatBytes,
  getPresetReferenceSource,
  isPromptIconName,
  isSupportedImageMimeType,
  maxReferenceImageBytes,
  normalizePromptIcon,
  promptIconLabel,
  promptIconNames,
  promptTemplateToPreset,
  readFileAsDataUrl,
} from "../utils/client-helpers";
import { ensureGenerateStorageReady } from "../utils/generate-storage-policy";
import {
  shouldBlockImageGenerationForMissingGeminiKey,
  shouldOpenImageGenerationGeminiKeyGate,
  shouldOpenPromptRefinerGeminiKeyGate,
} from "../utils/prompt-refiner-policy";
import { ModelQuickPicker } from "./model-quick-picker";

// TEMP: Hide the prompt chatbox/hover only on the generation workspace. Set this to false to restore it there.
const hidePromptComposerDuringGeneration = true;

const llmProviderReferenceImages: PresetReferenceImage[] = [
  {
    name: "Claude AI",
    src: "/llm-providers/claude-ai-icon.png",
    mimeType: "image/png",
    size: 17416,
  },
  {
    name: "Google Gemini",
    src: "/llm-providers/google-gemini-icon.png",
    mimeType: "image/png",
    size: 59220,
  },
  {
    name: "Grok",
    src: "/llm-providers/grok-icon.png",
    mimeType: "image/png",
    size: 22238,
  },
  {
    name: "Hugging Face",
    src: "/llm-providers/huggingface-icon.png",
    mimeType: "image/png",
    size: 39529,
  },
  {
    name: "OpenAI",
    src: "/llm-providers/openai.png",
    mimeType: "image/png",
    size: 237007,
  },
];

const initialPromptPresets: PromptPreset[] = [];

const hiddenPromptPresetExamples: PromptPreset[] = [
  {
    id: "llm-provider-references",
    name: "LLM Providers",
    thumbnailIcon: { name: "bot", color: "#22c55e", version: 1 },
    referenceImages: llmProviderReferenceImages,
    prompt: `Use the attached AI LLM provider images as reference assets for the next prompt.

Place them only where they make sense for the requested composition, such as app icons, provider cards, model selectors, comparison grids, workflow nodes, integration diagrams, partner rows, or subtle interface references.

Treat the provider images as optional visual references, not mandatory decorations. Preserve brand recognizability, clean edges, and readable spacing. Do not invent new provider logos or force every attached provider into the result.

Follow the user's next guide first. Integrate whichever provider references improve the image, keep the layout balanced, and make the final result modern, polished, universal, and production-ready.`,
  },
  {
    id: "magier-universal",
    name: "Magier Universal",
    thumbnailIcon: { name: "shield-check", color: "#6965fd", version: 1 },
    prompt: `Edit the attached image into a Magier AI-branded version.

ABOUT MAGIER AI:
Magier AI is an AI security and privacy company that helps businesses use AI safely by protecting sensitive data, enforcing governance, and enabling secure AI adoption. The brand should feel modern, premium, intelligent, secure, and enterprise-ready.

VISUAL STYLE:
Use a LIGHT THEME whenever possible.
Create a bright, clean, premium look with soft backgrounds and subtle contrast.
Favor watered-down / softened versions of the Magier AI palette instead of overly saturated colors.

PRIMARY COLOR DIRECTION:
- #D2D5FE (soft base tone)
- #6965FD (accent, softened when needed)
- #FED046 (small highlight moments only)
- #FFFFFF (main background / spacing)

COLOR RULES:
- Do not force exact recoloring
- Do not force visual effects that are not present in the original image
- Preserve the original image's natural lighting, shading, shadows, gradients, reflections, textures, and realism
- If the original image is flat/minimal, keep it flat/minimal
- If the original image has premium effects, preserve and adapt them subtly
- Use softer tints of the palette for backgrounds, cards, surfaces, UI areas, and accents
- Supporting neutrals such as light gray, silver, subtle charcoal, or muted tones are allowed when they improve realism

LOGO RULE:
- Remove all existing logos, trademarks, watermarks, and branding
- If the original image has a logo placement area, keep that space clean and empty
- Do NOT generate or invent a Magier AI logo
- Leave clear space for a logo to be manually added later

COPY / TEXT RULES:
- Replace all text with original Magier AI-aligned copy
- Be creative with the copy based on the image layout, subject, mood, and marketing style
- Themes can include AI security, privacy, governance, trust, compliance, enterprise control, safe AI adoption, sensitive data protection
- Keep copy concise, premium, bold, and ad-ready
- Use APA-style title case:
capitalize first word, last word, and words with 5 or more letters

LAYOUT RULES:
- Preserve the original composition unless refinement improves balance
- Clean cluttered areas, improve spacing, hierarchy, and readability
- Keep the result polished, modern, and campaign-ready

OUTPUT GOAL:
Create a clean light-theme Magier AI campaign image with soft branded colors, natural styling based on the original image, creative copy, no fake logo, and an empty clean space where the logo can be manually added later.`,
  },
];

function PromptThumbnail({
  icon,
  size = "md",
}: {
  icon: PromptThumbnailIcon;
  size?: "sm" | "lg" | "md";
}) {
  const iconName: IconName = isPromptIconName(icon.name) ? icon.name : "file-text";
  const dim = "h-full w-full";
  const iconSize = size === "lg" ? 56 : size === "sm" ? 18 : 28;

  return (
    <span className={`${dim} relative grid place-items-center overflow-hidden bg-white/[0.055]`}>
      <span className="absolute inset-0 bg-black/28" />
      <DynamicIcon name={iconName} size={iconSize} color={icon.color} strokeWidth={2.1} className="relative z-10" />
    </span>
  );
}

const glassPanelClass =
  "border border-white/[0.085] bg-white/[0.045] shadow-[0_26px_90px_rgb(0_0_0_/_0.58),inset_0_1px_0_rgb(255_255_255_/_0.06)] backdrop-blur-xl";

const standaloneImageModels = getBrowserImageModels("standalone-generate");
const imageCountDescriptions: Record<number, string> = {
  1: "One image",
  2: "Two images",
  3: "Three images",
  4: "Four images",
  6: "Six images",
  8: "Eight images",
  10: "Ten images",
  12: "Twelve images",
  16: "Sixteen images",
};
const aspectDescriptions: Record<string, string> = {
  auto: "Match the input image, or use the model default.",
  "1:1": "Square social and product layout.",
  "9:16": "Vertical mobile story format.",
  "16:9": "Wide cinematic or presentation frame.",
  "3:4": "Portrait editorial frame.",
  "4:3": "Classic landscape frame.",
  "3:2": "Landscape photo frame.",
  "2:3": "Portrait print and editorial layout.",
  "5:4": "Compact landscape frame.",
  "4:5": "Compact portrait frame.",
  "21:9": "Ultra-wide cinematic composition.",
  "4:1": "Wide banner frame.",
  "1:4": "Tall banner frame.",
  "8:1": "Panoramic strip frame.",
  "1:8": "Vertical strip frame.",
};

interface SettingOption {
  label: string;
  value: string;
  description: string;
  preview?: string;
}

interface SettingDefinition {
  key: SettingKey;
  label: string;
  tooltip: string;
  description: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  options: SettingOption[];
}

function createSettingDefinitions(activeModelId: string, models: readonly BrowserImageModel[] = standaloneImageModels): SettingDefinition[] {
  const selectableModels = models;
  const activeModel = selectableModels.find((model) => model.legacyModelId === activeModelId)
    ?? standaloneImageModels.find((model) => model.legacyModelId === activeModelId)
    ?? standaloneImageModels[0];
  return [
  {
    key: "model",
    label: "Model",
    tooltip: "Generation model",
    description: "Choose the image generation model for this run.",
    icon: Sparkles,
    options: selectableModels.length
      ? selectableModels.map((model) => ({
          label: model.displayLabel,
          value: model.legacyModelId,
          description: model.description,
        }))
      : [{ label: "No active image models", value: "", description: "Add or enable provider credentials in Settings." }],
  },
  {
    key: "count",
    label: "Images",
    tooltip: "Images per run",
    description: `How many variations ${brand.name} should generate from one prompt.`,
    icon: Images,
    options: activeModel.featureCountPresets["standalone-generate"].map((count) => ({
      label: `${count}x`,
      value: String(count),
      description: imageCountDescriptions[count] ?? `${count} images`,
    })),
  },
  {
    key: "thinking",
    label: "Thinking",
    tooltip: "Image reasoning mode",
    description: "Controls how much reasoning the model uses before generating.",
    icon: BrainCircuit,
    options: (activeModel.reasoning.values.length ? activeModel.reasoning.values : ["provider-managed"]).map((value) => ({
      label: value.slice(0, 1).toUpperCase() + value.slice(1),
      value,
      description: value === "balanced" ? "Good default for quality and speed." : value === "fast" ? "Lower latency for quick drafts." : "More planning for complex brand directions.",
    })),
  },
  {
    key: "aspect",
    label: "Aspect",
    tooltip: "Canvas aspect ratio",
    description: "Choose the frame shape for generated images.",
    icon: RectangleHorizontal,
    options: activeModel.featureAspectRatios["standalone-generate"].map((value) => ({
      label: value === "auto" ? "Auto" : value,
      value,
      description: aspectDescriptions[value] ?? `Generate with a ${value} frame.`,
      preview: value === "auto" ? "1 / 1" : value.replace(":", " / "),
    })),
  },
  {
    key: "quality",
    label: "Size",
    tooltip: "Output size",
    description: "Choose a model-supported output size.",
    icon: SlidersHorizontal,
    options: activeModel.size.presets.map((preset) => ({
      label: preset.value === "1K" ? "Standard" : preset.value === "2K" ? "High" : preset.value === "4K" ? "Ultra" : preset.label,
      value: preset.value,
      description: preset.value === "1K" ? "Balanced everyday generation size." : preset.value === "2K" ? "Sharper output for design handoff." : "Highest detail target where supported.",
    })),
  },
  {
    key: "providerQuality",
    label: "Quality",
    tooltip: "Provider quality",
    description: "Choose a quality level supported by the selected model.",
    icon: SlidersHorizontal,
    options: (activeModel.quality.values.length ? activeModel.quality.values : ["auto"]).map((value) => ({
      label: value.slice(0, 1).toUpperCase() + value.slice(1),
      value,
      description: value === "auto" ? "Let the provider choose the quality level." : `${value} provider quality.`,
    })),
  },
  {
    key: "background",
    label: "Background",
    tooltip: "Image background",
    description: "Choose a background mode supported by the selected model.",
    icon: ImageIcon,
    options: activeModel.background.values.map((value) => ({
      label: value.slice(0, 1).toUpperCase() + value.slice(1),
      value,
      description: value === "auto" ? "Let the model choose." : `Request a ${value} background.`,
    })),
  },
  ];
}

const defaultSettings: Record<SettingKey, string> = {
  model: standaloneImageModels[0].legacyModelId,
  count: String(standaloneImageModels[0].count.default),
  thinking: standaloneImageModels[0].reasoning.default ?? "balanced",
  aspect: standaloneImageModels[0].size.defaultAspectRatio,
  quality: standaloneImageModels[0].size.defaultSize,
  providerQuality: standaloneImageModels[0].quality.default ?? "auto",
  background: standaloneImageModels[0].background.default,
};

const settingBadges: Record<SettingKey, Record<string, string>> = {
  model: Object.fromEntries(standaloneImageModels.map((model) => [model.legacyModelId, model.badge])),
  count: {
    "1": "1x",
    "2": "2x",
    "3": "3x",
    "4": "4x",
    "6": "6x",
    "8": "8x",
    "10": "10x",
    "12": "12x",
    "16": "16x",
  },
  thinking: {
    balanced: "B",
    fast: "F",
    deep: "D",
    "provider-managed": "Auto",
  },
  aspect: {
    auto: "Auto",
    "1:1": "1:1",
    "9:16": "9:16",
    "16:9": "16:9",
    "3:4": "3:4",
    "4:3": "4:3",
    "3:2": "3:2",
    "2:3": "2:3",
    "5:4": "5:4",
    "4:5": "4:5",
    "21:9": "21:9",
    "4:1": "4:1",
    "1:4": "1:4",
    "8:1": "8:1",
    "1:8": "1:8",
  },
  quality: {
    "1K": "1K",
    "2K": "2K",
    "4K": "4K",
  },
  providerQuality: { auto: "Auto", low: "Low", medium: "Med", high: "High" },
  background: { auto: "Auto", opaque: "Solid", transparent: "Alpha" },
};

const railButtonClass =
  "relative grid h-11 w-11 place-items-center rounded-xl text-white transition hover:bg-white/[0.08]";

const generationTransition = {
  duration: 0.62,
  ease: [0.22, 1, 0.36, 1],
} as const;

const loadingPhrases = [
  "Reading prompt",
  "Removing backdrop",
  "Composing variation",
  "Rendering image",
];

function GenerationLoading({ phrase }: { phrase: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center overflow-hidden bg-black/72">
      <motion.div
        className="absolute inset-y-0 w-1/3 bg-[linear-gradient(90deg,transparent,rgb(255_255_255_/_0.16),transparent)] blur-xl"
        animate={{ x: ["-150%", "350%"] }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      />
      <div className="relative z-10 grid justify-items-center gap-3 text-center">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
          className="grid h-11 w-11 place-items-center rounded-xl border border-white/[0.12] bg-white/[0.06] text-accent"
        >
          <Loader2 size={21} />
        </motion.span>
        <motion.span
          key={phrase}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[13px] font-extrabold text-white"
        >
          {phrase}
        </motion.span>
      </div>
    </div>
  );
}

function GeneratedImageCollage({
  images,
  focusedImage,
  onFocusImage,
  onClearFocus,
}: {
  images: GeneratedImage[];
  focusedImage: GeneratedImage | null;
  onFocusImage: (image: GeneratedImage) => void;
  onClearFocus: () => void;
}) {
  if (focusedImage) {
    return (
      <div className="relative grid h-full min-h-[360px] grid-rows-[1fr_auto] overflow-hidden px-4 pb-4 pt-12">
        <button
          className="absolute left-4 top-14 z-20 grid h-10 w-10 place-items-center rounded-lg border border-white/[0.1] bg-black/58 text-white/70 backdrop-blur-xl transition hover:bg-white/[0.08] hover:text-white"
          type="button"
          aria-label="Return to generated image collage"
          onClick={onClearFocus}
        >
          <Images size={17} />
        </button>
        <a
          className="absolute right-4 top-14 z-20 grid h-9 w-9 place-items-center rounded-lg border border-white/[0.1] bg-black/58 text-white/70 backdrop-blur-xl transition hover:bg-white/[0.08] hover:text-white"
          href={focusedImage.dataUrl}
          download={`${brand.slug}-${focusedImage.variant}.png`}
          aria-label="Download focused image"
        >
          <Download size={16} />
        </a>

        <motion.button
          key={focusedImage.id}
          className="grid min-h-0 place-items-center"
          type="button"
          initial={{ opacity: 0, scale: 0.94, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }}
          transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
          onClick={onClearFocus}
          aria-label="Return to generated collage"
        >
          <img
            className="max-h-[calc(min(68svh,760px)-128px)] max-w-full object-contain shadow-[0_30px_120px_rgb(0_0_0_/_0.72)]"
            src={focusedImage.dataUrl}
            alt=""
          />
        </motion.button>

        {images.length > 1 && (
          <div className="mx-auto mt-3 flex max-w-full gap-2 overflow-x-auto rounded-xl border border-white/[0.08] bg-black/42 p-2 backdrop-blur-xl [scrollbar-color:rgb(255_255_255_/_0.24)_transparent]">
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
                onClick={() => onFocusImage(image)}
              >
                <img className="h-full w-full object-cover" src={image.dataUrl} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const gridFrameClass =
    images.length === 1
      ? "max-w-[min(94%,920px)] grid-cols-1"
      : images.length === 2
        ? "max-w-[min(94%,1080px)] grid-cols-1 sm:grid-cols-2"
        : images.length === 3
          ? "max-w-[min(94%,1180px)] grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
          : images.length <= 6
            ? "max-w-[min(94%,1240px)] grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
            : "max-w-[min(94%,1320px)] grid-cols-2 sm:grid-cols-3 xl:grid-cols-4";

  return (
    <div className="grid h-full min-h-[360px] overflow-y-auto px-5 pb-5 pt-14 [scrollbar-color:rgb(255_255_255_/_0.24)_transparent]">
      <div className={`m-auto grid w-full ${gridFrameClass} gap-2`}>
        {images.map((image, index) => (
          <motion.div
            key={image.id}
            className="group relative min-h-0 bg-transparent p-0 transition"
            initial={{ opacity: 0, scale: 0.86, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            transition={{ duration: 0.34, delay: index * 0.035, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ scale: 1.018, zIndex: 30 }}
          >
            <button
              className="block h-full w-full cursor-zoom-in bg-black/16 p-0 transition group-hover:bg-white/[0.03] group-focus-within:bg-white/[0.03]"
              type="button"
              aria-label={`Focus generated image ${image.variant}`}
              onClick={() => onFocusImage(image)}
            >
              <img
                className="block max-h-[min(34svh,300px)] w-full object-contain shadow-[0_18px_50px_rgb(0_0_0_/_0.45)]"
                src={image.dataUrl}
                alt=""
              />
            </button>
            <a
              className="absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-lg border border-white/[0.12] bg-black/64 text-white/72 opacity-0 backdrop-blur-xl transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-white/[0.1] hover:text-white"
              href={image.dataUrl}
              download={`${brand.slug}-${image.variant}.png`}
              aria-label={`Download generated image ${image.variant}`}
              onClick={(event) => event.stopPropagation()}
            >
              <Download size={16} />
            </a>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function getNextGeneratedPanelMode(mode: GeneratedPanelMode): GeneratedPanelMode {
  if (mode === "split") return "generated-focus";
  if (mode === "generated-focus") return "source-focus";
  return "split";
}

function SourcePanelContent({ prompt, images }: { prompt: string; images: ReferenceImage[] }) {
  const hasPrompt = prompt.trim().length > 0;
  const sourceGridClass =
    images.length <= 1
      ? "grid-cols-1"
      : images.length <= 4
        ? "grid-cols-1 min-[520px]:grid-cols-2"
        : "grid-cols-1 min-[520px]:grid-cols-2 min-[1180px]:grid-cols-3";

  if (images.length === 0) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-8">
        <p className="max-h-[420px] overflow-y-auto whitespace-pre-wrap text-left text-[15px] font-semibold leading-7 text-white/78 [scrollbar-color:rgb(255_255_255_/_0.24)_transparent]">
          {prompt || "Prompt will appear here."}
        </p>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 pb-4 pt-14 [scrollbar-color:rgb(255_255_255_/_0.24)_transparent]">
      {hasPrompt && (
        <div className="mb-3 border border-white/[0.08] bg-black/30 p-3 text-left text-[12px] font-semibold leading-5 text-white/64">
          <p className="whitespace-pre-wrap">{prompt}</p>
        </div>
      )}

      <div className={`grid ${sourceGridClass} m-auto w-full max-w-[980px] gap-2`}>
        {images.map((image, index) => (
          <div
            key={`${image.name}-${image.size}-${index}`}
            className="grid min-h-[132px] place-items-center bg-black/24 p-1"
            title={`${image.name} (${formatBytes(image.size)})`}
          >
            {image.mimeType === "image/heic" || image.mimeType === "image/heif" ? (
              <span className="px-4 text-center text-[12px] font-bold text-white/62">
                {image.name}
              </span>
            ) : (
              <img
                className="max-h-[min(26svh,240px)] w-full object-contain"
                src={image.dataUrl}
                alt={image.name}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function GenerationWorkspace({
  run,
  isGenerating,
  loadingPhrase,
  error,
  panelMode,
  onPanelModeChange,
}: {
  run: GenerationRun | null;
  isGenerating: boolean;
  loadingPhrase: string;
  error: string | null;
  panelMode: GeneratedPanelMode;
  onPanelModeChange: (mode: GeneratedPanelMode) => void;
}) {
  const [focusedGeneratedImageId, setFocusedGeneratedImageId] = useState<string | null>(null);
  const primaryImage = run?.images[0] ?? null;
  const sourceImages = run?.referenceImages ?? [];
  const focusedGeneratedImage =
    run?.images.find((image) => image.id === focusedGeneratedImageId) ?? null;
  const nextPanelMode = getNextGeneratedPanelMode(panelMode);
  const NextPanelModeIcon =
    nextPanelMode === "generated-focus"
      ? PanelRightOpen
      : nextPanelMode === "source-focus"
        ? PanelLeftOpen
        : Columns2;
  const workspaceGridClass =
    panelMode === "generated-focus"
      ? "lg:grid-cols-[minmax(220px,0.42fr)_minmax(0,1fr)]"
      : panelMode === "source-focus"
        ? "lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.42fr)]"
        : "lg:grid-cols-[minmax(280px,1fr)_minmax(0,1fr)]";
  const nextPanelModeLabel =
    nextPanelMode === "generated-focus"
      ? "Focus generated"
      : nextPanelMode === "source-focus"
        ? "Focus source"
        : "Equal split";

  useEffect(() => {
    if (!focusedGeneratedImageId) return;
    if (run?.images.some((image) => image.id === focusedGeneratedImageId)) return;
    setFocusedGeneratedImageId(null);
  }, [focusedGeneratedImageId, run?.images]);

  return (
    <motion.div className="w-full max-w-[1560px] pb-28" layout>
      <motion.div
        layout
        transition={{ layout: { duration: 0.48, ease: [0.22, 1, 0.36, 1] } }}
        className={`grid h-[min(68svh,760px)] min-h-[420px] overflow-hidden rounded-xl border border-white/[0.1] bg-black/46 shadow-[0_28px_110px_rgb(0_0_0_/_0.58),inset_0_1px_0_rgb(255_255_255_/_0.07)] backdrop-blur-2xl ${workspaceGridClass}`}
      >
        <motion.section
          key="source-panel"
          layout
          animate={{
            scale: panelMode === "source-focus" ? 1.012 : panelMode === "generated-focus" ? 0.975 : 1,
            opacity: panelMode === "generated-focus" ? 0.9 : 1,
            filter: panelMode === "generated-focus" ? "saturate(0.82)" : "saturate(1)",
          }}
          transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
          className="relative min-h-0 border-b border-white/[0.08] bg-white/[0.035] lg:border-b-0 lg:border-r"
        >
          <div className="absolute left-4 top-4 z-10 rounded-md border border-white/[0.1] bg-black/62 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/68">
            Source
          </div>
          <SourcePanelContent prompt={run?.prompt ?? ""} images={sourceImages} />
        </motion.section>

        <motion.section
          layout
          animate={{
            scale: panelMode === "generated-focus" ? 1.012 : panelMode === "source-focus" ? 0.975 : 1,
            opacity: panelMode === "source-focus" ? 0.9 : 1,
            filter: panelMode === "source-focus" ? "saturate(0.82)" : "saturate(1)",
          }}
          transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
          className="relative min-h-0 overflow-hidden bg-[#0b0b0b]"
        >
          <div className="absolute left-4 top-4 z-20 rounded-md border border-white/[0.1] bg-black/62 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/68">
            Generated
          </div>
          <div className="absolute right-3 top-3 z-30 rounded-lg border border-white/[0.08] bg-black/54 p-1 backdrop-blur-xl">
            <button
              className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[10px] font-black uppercase tracking-[0.06em] text-white/62 transition hover:bg-white/[0.08] hover:text-white"
              type="button"
              aria-label={`Switch layout: ${nextPanelModeLabel}`}
              title={nextPanelModeLabel}
              onClick={() => onPanelModeChange(nextPanelMode)}
            >
              <NextPanelModeIcon size={15} />
              <span className="hidden sm:inline">{nextPanelModeLabel}</span>
            </button>
          </div>

          <AnimatePresence mode="wait">
            {isGenerating && (
              <motion.div
                key="loading"
                className="absolute inset-0"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.04 }}
                transition={{ duration: 0.28, ease: "easeOut" }}
              >
                <GenerationLoading phrase={loadingPhrase} />
              </motion.div>
            )}
          </AnimatePresence>

          {!isGenerating && error && (
            <div className="grid h-full min-h-[360px] place-items-center p-8 text-center">
              <p className="max-w-[56ch] rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-[13px] font-semibold leading-5 text-red-100">
                {error}
              </p>
            </div>
          )}

          {!isGenerating && !error && run?.images.length ? (
            <GeneratedImageCollage
              images={run.images}
              focusedImage={focusedGeneratedImage}
              onFocusImage={(image) => setFocusedGeneratedImageId(image.id)}
              onClearFocus={() => setFocusedGeneratedImageId(null)}
            />
          ) : null}

          {!isGenerating && !error && !primaryImage && (
            <div className="grid h-full min-h-[360px] place-items-center text-[13px] font-semibold text-white/46">
              Waiting for output
            </div>
          )}
        </motion.section>
      </motion.div>

      {run?.warnings.length ? (
        <p className="mt-3 text-left text-[11px] font-semibold leading-5 text-yellow-100/72">
          {run.warnings.join(" ")}
        </p>
      ) : null}
    </motion.div>
  );
}

function GateDialogModal({
  dialog,
  onCancel,
  onConfirm,
}: {
  dialog: GateDialog;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const Icon =
    dialog.icon === "signin"
      ? LogIn
      : dialog.icon === "model"
        ? KeyRound
        : dialog.icon === "drive"
          ? HardDrive
          : dialog.icon === "warning"
            ? TriangleAlert
            : Sparkles;
  const isWarning = dialog.variant === "warning";

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-hidden bg-black/58 px-4 backdrop-blur-xl">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_12%,rgb(255_255_255_/_0.07),transparent_30%),radial-gradient(circle_at_54%_0%,rgb(59_130_246_/_0.09),transparent_25%)]"
        aria-hidden="true"
      />
      <motion.section
        className="relative w-[min(560px,calc(100vw-28px))] overflow-hidden rounded-2xl border border-white/[0.11] bg-black/42 text-white shadow-[0_34px_150px_rgb(0_0_0_/_0.72),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-2xl"
        initial={{ opacity: 0, y: 18, scale: 0.96, filter: "blur(8px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: 10, scale: 0.98, filter: "blur(8px)" }}
        transition={{ duration: 0.22, ease: "easeOut" }}
      >
        <button
          className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-xl text-white/42 transition hover:bg-white/[0.08] hover:text-white"
          type="button"
          onClick={onCancel}
          aria-label="Close dialog"
        >
          <X size={18} />
        </button>
        <div className="p-6 pb-7">
          <div
            className={`mb-7 grid h-14 w-14 place-items-center rounded-2xl border shadow-[inset_0_1px_0_rgb(255_255_255_/_0.12)] ${
              isWarning
                ? "border-yellow-200/20 bg-yellow-300/12 text-yellow-100"
                : "border-accent/28 bg-accent/14 text-blue-100"
            }`}
          >
            <Icon size={22} />
          </div>
          <h2 className="m-0 max-w-[440px] text-[clamp(34px,4.8vw,56px)] font-light leading-none tracking-normal text-white">
            {dialog.title}
          </h2>
          <p className="m-0 mt-4 max-w-[48ch] text-[15px] font-normal leading-6 text-white/52">
            {dialog.description}
          </p>
        </div>
        <div className="grid gap-3 border-t border-white/[0.08] bg-black/20 p-4 sm:grid-cols-2">
          {dialog.allowCancel !== false ? (
            <button
              className="h-12 rounded-xl border border-white/[0.1] bg-white/[0.045] px-4 text-[14px] font-semibold text-white/66 transition hover:bg-white/[0.08] hover:text-white"
              type="button"
              onClick={onCancel}
            >
              {dialog.cancelLabel ?? "Cancel"}
            </button>
          ) : null}
          {dialog.href ? (
            <Link
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-[14px] font-semibold text-white shadow-[0_16px_44px_rgb(59_130_246_/_0.22)] transition hover:bg-accent-hover"
              href={dialog.href}
              onClick={onCancel}
            >
              {dialog.confirmLabel}
            </Link>
          ) : (
            <button
              className="h-12 rounded-xl bg-accent px-4 text-[14px] font-semibold text-white shadow-[0_16px_44px_rgb(59_130_246_/_0.22)] transition hover:bg-accent-hover"
              type="button"
              onClick={onConfirm}
            >
              {dialog.confirmLabel}
            </button>
          )}
        </div>
      </motion.section>
    </div>
  );
}

function SubmitGlyph({ isGenerating }: { isGenerating: boolean }) {
  return (
    <motion.span
      className="grid h-5 w-5 place-items-center"
      initial={false}
      animate={isGenerating ? { scale: [1, 0.88, 1], opacity: [1, 0.72, 1] } : { scale: 1, opacity: 1 }}
      transition={isGenerating ? { duration: 0.9, repeat: Infinity, ease: "easeInOut" } : generationTransition}
    >
      {isGenerating ? (
        <span className="grid h-4 w-4 place-items-center rounded-[4px] border-2 border-white/86 bg-white/10 shadow-[0_0_18px_rgb(255_255_255_/_0.22)]" />
      ) : (
        <Send size={15} />
      )}
    </motion.span>
  );
}

function PromptLibrarySkeleton() {
  return (
    <div className="grid gap-1.5 p-1" aria-label="Loading saved prompts">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="grid grid-cols-[44px_minmax(0,1fr)] gap-2 rounded-xl border border-white/[0.06] bg-white/[0.035] p-1.5"
        >
          <span className="relative h-11 w-11 overflow-hidden rounded-lg bg-white/[0.055] before:block before:h-full before:w-1/2 before:animate-[provider-shimmer_1.35s_ease-in-out_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.12] before:to-transparent" />
          <span className="grid content-center gap-2">
            <span className="relative h-3 w-3/4 overflow-hidden rounded-full bg-white/[0.055] before:block before:h-full before:w-1/2 before:animate-[provider-shimmer_1.35s_ease-in-out_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.12] before:to-transparent" />
            <span className="relative h-2.5 w-full overflow-hidden rounded-full bg-white/[0.04] before:block before:h-full before:w-1/2 before:animate-[provider-shimmer_1.35s_ease-in-out_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.1] before:to-transparent" />
          </span>
        </div>
      ))}
    </div>
  );
}

export function GeneratePage() {
  const modelProvider = useModelProviderSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeSetting, setActiveSetting] = useState<SettingKey>("aspect");
  const [settings, setSettings] = useState<Record<SettingKey, string>>(defaultSettings);
  const [promptText, setPromptText] = useState("");
  const [promptBeforeRefineReplacement, setPromptBeforeRefineReplacement] = useState<string | null>(null);
  const [promptRefiner, setPromptRefiner] = useState<PromptRefinerState>({ status: "idle", answers: [] });
  const [referenceImages, setReferenceImages] = useState<ReferenceImage[]>([]);
  const [isDraggingReference, setIsDraggingReference] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadMessage, setUploadMessage] = useState("");
  const [activeRun, setActiveRun] = useState<GenerationRun | null>(null);
  const [generationHistory, setGenerationHistory] = useState<GenerationRun[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedPanelMode, setGeneratedPanelMode] = useState<GeneratedPanelMode>("split");
  const [isComposerRaised, setIsComposerRaised] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [promptSearch, setPromptSearch] = useState("");
  const [promptIconSearch, setPromptIconSearch] = useState("");
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>(initialPromptPresets);
  const [promptLibraryStatus, setPromptLibraryStatus] = useState<"idle" | "loading" | "saving" | "error">("idle");
  const [promptLibraryMessage, setPromptLibraryMessage] = useState("");
  const [promptDialogMode, setPromptDialogMode] = useState<"create" | "edit" | "preview" | null>(null);
  const [previewReference, setPreviewReference] = useState<ReferenceImage | null>(null);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [promptIconPanelOpen, setPromptIconPanelOpen] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState<PromptPreset>({
    id: "",
    name: "",
    thumbnailIcon: DEFAULT_PROMPT_ICON,
    prompt: "",
    referenceImages: [],
  });
  const [workspaceStatus, setWorkspaceStatus] = useState<WorkspaceStatusResponse | null>(null);
  const [gateDialog, setGateDialog] = useState<GateDialog | null>(null);
  const gateDialogResolverRef = useRef<((value: boolean) => void) | null>(null);
  const referenceFileInputRef = useRef<HTMLInputElement>(null);

  const activeImageModels = modelProvider.activeModels("imageGeneration")
    .map((model) => getBrowserImageModelByAlias(model.modelAlias))
    .filter((model): model is BrowserImageModel => Boolean(model));
  const activeChatModels = modelProvider.activeModels("chatOrchestration");
  const settingDefinitions = createSettingDefinitions(settings.model, activeImageModels);
  const railSettingDefinitions = settingDefinitions.filter((definition) => definition.key !== "model");
  const currentDefinition =
    settingDefinitions.find((definition) => definition.key === activeSetting) ?? settingDefinitions[0];
  const CurrentSettingIcon = currentDefinition.icon;

  const getSelectedOption = (definition: SettingDefinition) =>
    definition.options.find((option) => option.value === settings[definition.key]) ?? definition.options[0];

  const filteredPrompts = promptPresets.filter((preset) => {
    const query = promptSearch.trim().toLowerCase();
    if (!query) return true;
    return (
      preset.name.toLowerCase().includes(query) ||
      preset.prompt.toLowerCase().includes(query)
    );
  });

  const activePrompt = promptPresets.find((preset) => preset.id === activePromptId) ?? null;
  const filteredPromptIcons = promptIconNames
    .filter((name) => {
      const query = promptIconSearch.trim().toLowerCase();
      if (!query) return true;
      return name.includes(query);
    })
    .slice(0, 80);
  const activeModelOption =
    settingDefinitions[0].options.find((option) => option.value === settings.model) ??
    settingDefinitions[0].options[0];
  const loadingPhrase = loadingPhrases[loadingStep % loadingPhrases.length];
  const generationActive = Boolean(activeRun || isGenerating || generationError);
  const activeModel = settings.model as ModelId;
  const activeModelMetadata = getBrowserImageModelByLegacyId(activeModel);
  const referenceImageLimit = activeModelMetadata?.maximumReferenceImages ?? 0;
  const supportsReferenceImages = activeModelMetadata?.supportsReferenceEditing ?? false;
  const hasReferencePanel = referenceImages.length > 0 || Boolean(uploadMessage);
  const hasPromptRefinerPanel = promptRefiner.status !== "idle";
  const hasComposerTopPanel = hasReferencePanel || hasPromptRefinerPanel;
  const composerHasDraft = promptText.trim().length > 0 || referenceImages.length > 0;
  const isPromptComposerCollapsed = generationActive && !isComposerRaised && !composerHasDraft;

  async function loadWorkspaceStatus() {
    try {
      const response = await fetch("/api/workspace/status");
      if (!response.ok) return null;
      const payload = (await response.json()) as WorkspaceStatusResponse;
      setWorkspaceStatus(payload);
      return payload;
    } catch {
      return null;
    }
  }

  function openGateDialog(dialog: GateDialog) {
    setGateDialog(dialog);
    return new Promise<boolean>((resolve) => {
      gateDialogResolverRef.current = resolve;
    });
  }

  function resolveGateDialog(value: boolean) {
    gateDialogResolverRef.current?.(value);
    gateDialogResolverRef.current = null;
    setGateDialog(null);
  }

  async function requireSignedIn(status = workspaceStatus) {
    if (status?.authenticated) return true;

    return openGateDialog({
      title: "Sign in required",
      description: "Sign in to generate images, save prompt templates, and keep your Gallery history.",
      confirmLabel: "Sign in",
      href: "/auth/login?next=/generate",
      cancelLabel: "Stay here",
      icon: "signin",
    });
  }

  async function requireGeminiKey(status = workspaceStatus) {
    if (!shouldBlockImageGenerationForMissingGeminiKey(status)) return true;

    await openImageModelKeyDialog();

    return false;
  }

  function openImageModelKeyDialog() {
    return openGateDialog({
      title: "Connect image model",
      description: "Add your image generation model API key before generating images.",
      confirmLabel: "Add API key",
      href: "/settings/api-keys",
      cancelLabel: "Cancel",
      icon: "model",
    });
  }

  const handlePromptTextChange = (value: string) => {
    setPromptText(value);
    setPromptBeforeRefineReplacement(null);
    if (generationActive && value.trim()) {
      setIsComposerRaised(true);
    }
  };

  useEffect(() => {
    if (!isGenerating) {
      setLoadingStep(0);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingStep((current) => current + 1);
    }, 1400);

    return () => window.clearInterval(interval);
  }, [isGenerating]);

  useEffect(() => {
    void loadWorkspaceStatus();
  }, []);

  useEffect(() => {
    const alias = modelProvider.settings?.selected?.imageGenerationModelAlias;
    const selected = alias ? getBrowserImageModelByAlias(alias) : null;
    if (!selected || selected.legacyModelId === settings.model) return;
    setSettings((current) => {
      const normalized = normalizeBrowserImageUiSettings({
        model: current.model,
        count: Number(current.count),
        aspectRatio: current.aspect,
        imageSize: current.quality,
        reasoning: current.thinking,
        quality: current.providerQuality,
        background: current.background as "auto" | "opaque" | "transparent",
      }, selected.legacyModelId, "standalone-generate");
      return { ...current, model: normalized.model, count: String(normalized.count), aspect: normalized.aspectRatio, quality: normalized.imageSize, thinking: normalized.reasoning, providerQuality: normalized.quality ?? "auto", background: normalized.background ?? "auto" };
    });
  }, [modelProvider.settings?.selected?.imageGenerationModelAlias, settings.model]);

  useEffect(() => {
    let isMounted = true;

    async function loadPromptTemplates() {
      setPromptLibraryStatus("loading");

      try {
        const response = await fetch("/api/prompt-templates");

        if (response.status === 401) {
          if (!isMounted) return;
          setPromptPresets(initialPromptPresets);
          setPromptLibraryStatus("idle");
          setPromptLibraryMessage("");
          return;
        }

        if (!response.ok) {
          throw new Error("Unable to load saved prompts.");
        }

        const payload = (await response.json()) as {
          promptTemplates?: PromptTemplateRecord[];
        };
        const savedPrompts = (payload.promptTemplates ?? []).map(promptTemplateToPreset);

        if (!isMounted) return;

        setPromptPresets([...savedPrompts, ...initialPromptPresets]);
        setPromptLibraryStatus("idle");
        setPromptLibraryMessage("");
      } catch (error) {
        if (!isMounted) return;

        setPromptLibraryStatus("error");
        setPromptLibraryMessage(error instanceof Error ? error.message : "Unable to load saved prompts.");
      }
    }

    void loadPromptTemplates();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (referenceImages.length <= referenceImageLimit) return;

    setReferenceImages((current) => current.slice(0, referenceImageLimit));
    setUploadStatus("error");
    setUploadMessage(`${activeModelOption.label} allows ${referenceImageLimit} reference images; extra images were removed.`);
  }, [activeModelOption.label, referenceImageLimit, referenceImages.length]);

  useEffect(() => {
    if (supportsReferenceImages || (referenceImages.length === 0 && !uploadMessage)) return;
    setReferenceImages([]);
    setPreviewReference(null);
    setUploadStatus("error");
    setUploadMessage(`${activeModelOption.label} is text-to-image only and does not accept reference images.`);
  }, [activeModelOption.label, referenceImages.length, supportsReferenceImages, uploadMessage]);

  const openCreatePrompt = () => {
    if (!workspaceStatus?.authenticated) {
      void requireSignedIn();
      return;
    }

    setDraftPrompt({
      id: "",
      name: "",
      thumbnailIcon: DEFAULT_PROMPT_ICON,
      prompt: "",
      referenceImages: [],
    });
    setPromptIconSearch("");
    setPromptIconPanelOpen(false);
    setActivePromptId(null);
    setPromptDialogMode("create");
  };

  const openEditPrompt = (preset: PromptPreset) => {
    if (preset.persisted && !workspaceStatus?.authenticated) {
      void requireSignedIn();
      return;
    }

    setDraftPrompt({
      ...preset,
      thumbnailIcon: normalizePromptIcon(preset.thumbnailIcon),
      referenceImages: preset.referenceImages ?? [],
    });
    setPromptIconSearch("");
    setPromptIconPanelOpen(false);
    setActivePromptId(preset.id);
    setPromptDialogMode("edit");
  };

  const openPreviewPrompt = (preset: PromptPreset) => {
    setActivePromptId(preset.id);
    setPromptDialogMode("preview");
  };

  const resolvePresetReferenceImage = async (image: PresetReferenceImage): Promise<ReferenceImage> => {
    if (image.dataUrl) {
      return {
        dataUrl: image.dataUrl,
        mimeType: image.mimeType,
        name: image.name,
        size: image.size,
      };
    }

    if (!image.src) {
      throw new Error(`${image.name} is missing an image source.`);
    }

    const response = await fetch(image.src);
    if (!response.ok) {
      throw new Error(`Failed to attach ${image.name}.`);
    }

    const blob = await response.blob();
    return {
      dataUrl: await readFileAsDataUrl(blob),
      mimeType: image.mimeType,
      name: image.name,
      size: blob.size || image.size,
    };
  };

  const usePrompt = async (preset: PromptPreset) => {
    const presetPrompt = preset.prompt.trim();
    setPromptText((current) => {
      const currentPrompt = current.trim();
      if (!currentPrompt) return presetPrompt;
      if (!presetPrompt) return currentPrompt;
      return `${currentPrompt}\n\n${presetPrompt}`;
    });
    setPromptDialogMode(null);

    const presetReferenceImages = preset.referenceImages ?? [];
    if (presetReferenceImages.length === 0) return;

    const remainingSlots = Math.max(0, referenceImageLimit - referenceImages.length);
    if (remainingSlots === 0) {
      setUploadStatus("error");
      setUploadMessage(`${activeModelOption.label} already has ${referenceImageLimit} reference images attached.`);
      return;
    }

    const acceptedReferences = presetReferenceImages.slice(0, remainingSlots);
    const skippedCount = presetReferenceImages.length - acceptedReferences.length;

    setUploadStatus("uploading");
    setUploadMessage(`Attaching ${acceptedReferences.length} prompt reference image${acceptedReferences.length === 1 ? "" : "s"}...`);

    try {
      const nextImages = await Promise.all(acceptedReferences.map(resolvePresetReferenceImage));
      setReferenceImages((current) => [...current, ...nextImages].slice(0, referenceImageLimit));
      setGenerationError(null);
      setUploadStatus("success");
      setUploadMessage(
        skippedCount > 0
          ? `Attached ${nextImages.length}; skipped ${skippedCount} over the ${referenceImageLimit}-image limit.`
          : `Attached ${nextImages.length} prompt reference image${nextImages.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setUploadStatus("error");
      setUploadMessage(error instanceof Error ? error.message : "Failed to attach prompt references.");
    }
  };

  const savePrompt = async () => {
    if (!(await requireSignedIn())) return;

    const name = draftPrompt.name.trim();
    const prompt = draftPrompt.prompt.trim();
    if (!name || !prompt) return;

    const body = JSON.stringify({
      name,
      prompt,
      thumbnailIcon: normalizePromptIcon(draftPrompt.thumbnailIcon),
      referenceImages: draftPrompt.referenceImages ?? [],
    });

    setPromptLibraryStatus("saving");
    setPromptLibraryMessage("");

    try {
      const response = await fetch(
        draftPrompt.persisted ? `/api/prompt-templates/${draftPrompt.id}` : "/api/prompt-templates",
        {
          method: draftPrompt.persisted ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );

      if (response.status === 401) {
        await requireSignedIn();
        throw new Error("Sign in to save prompts.");
      }

      if (!response.ok) {
        throw new Error(response.status === 409 ? "You can save up to 3 prompts for now." : "Unable to save prompt.");
      }

      const payload = (await response.json()) as {
        promptTemplate?: PromptTemplateRecord;
      };
      if (!payload.promptTemplate) {
        throw new Error("Unable to save prompt.");
      }

      const nextPrompt = promptTemplateToPreset(payload.promptTemplate);

      setPromptPresets((current) => {
        const withoutExisting = current.filter((preset) => preset.id !== draftPrompt.id && preset.id !== nextPrompt.id);
        return [nextPrompt, ...withoutExisting];
      });
      setPromptLibraryStatus("idle");
      setPromptLibraryMessage("");
      setDraftPrompt(nextPrompt);
      setActivePromptId(nextPrompt.id);
      setPromptDialogMode("preview");
    } catch (error) {
      setPromptLibraryStatus("error");
      setPromptLibraryMessage(error instanceof Error ? error.message : "Unable to save prompt.");
    }
  };

  const deletePrompt = async () => {
    if (!(await requireSignedIn())) return;
    if (!draftPrompt.id) return;

    setPromptLibraryStatus("saving");
    setPromptLibraryMessage("");

    try {
      if (draftPrompt.persisted) {
        const response = await fetch(`/api/prompt-templates/${draftPrompt.id}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error("Unable to delete prompt.");
        }
      }

      setPromptPresets((current) => current.filter((preset) => preset.id !== draftPrompt.id));
      setPromptLibraryStatus("idle");
      setPromptLibraryMessage("");
      setActivePromptId(null);
      setPromptDialogMode(null);
    } catch (error) {
      setPromptLibraryStatus("error");
      setPromptLibraryMessage(error instanceof Error ? error.message : "Unable to delete prompt.");
    }
  };

  const clearUploadFeedbackIfEmpty = (nextLength: number) => {
    if (nextLength > 0) return;
    setUploadStatus("idle");
    setUploadMessage("");
  };

  const removeReferenceImage = (index: number) => {
    setReferenceImages((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      clearUploadFeedbackIfEmpty(next.length);
      return next;
    });
  };

  const clearReferenceImages = () => {
    setReferenceImages([]);
    setUploadStatus("idle");
    setUploadMessage("");
  };

  const convertFilesToReferenceImages = async (files: File[], limit: number) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) {
      throw new Error("Choose PNG, JPEG, WebP, HEIC, or HEIF images.");
    }

    const rejected = imageFiles.find((file) => !isSupportedImageMimeType(file.type));
    if (rejected) {
      throw new Error(`${rejected.name} is not a supported image type.`);
    }

    const oversized = imageFiles.find((file) => file.size > maxReferenceImageBytes);
    if (oversized) {
      throw new Error(`${oversized.name} is ${formatBytes(oversized.size)}. Max is 7 MB.`);
    }

    const acceptedFiles = imageFiles.slice(0, limit);
    const skippedCount = imageFiles.length - acceptedFiles.length;
    const images = await Promise.all(
      acceptedFiles.map(async (file) => ({
        dataUrl: await readFileAsDataUrl(file),
        mimeType: file.type as ReferenceImage["mimeType"],
        name: file.name,
        size: file.size,
      })),
    );

    return { images, skippedCount };
  };

  const addDraftReferenceImages = async (files: File[]) => {
    const currentCount = draftPrompt.referenceImages?.length ?? 0;
    const remainingSlots = Math.max(0, 14 - currentCount);
    if (remainingSlots === 0) return;

    try {
      const { images } = await convertFilesToReferenceImages(files, remainingSlots);
      setDraftPrompt((current) => ({
        ...current,
        referenceImages: [...(current.referenceImages ?? []), ...images],
      }));
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Failed to add prompt references.");
    }
  };

  const removeDraftReferenceImage = (index: number) => {
    setDraftPrompt((current) => ({
      ...current,
      referenceImages: (current.referenceImages ?? []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const handleDraftReferenceChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await addDraftReferenceImages(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const addReferenceImages = async (files: File[]) => {
    const remainingSlots = Math.max(0, referenceImageLimit - referenceImages.length);
    if (remainingSlots === 0) {
      setUploadStatus("error");
      setUploadMessage(`${activeModelOption.label} supports ${referenceImageLimit} reference images.`);
      return;
    }

    setUploadStatus("uploading");
    setUploadMessage("Uploading reference images...");

    try {
      const { images: nextImages, skippedCount } = await convertFilesToReferenceImages(files, remainingSlots);

      setReferenceImages((current) => [...current, ...nextImages]);
      setGenerationError(null);
      setUploadStatus("success");
      setUploadMessage(
        skippedCount > 0
          ? `Added ${nextImages.length}; skipped ${skippedCount} over the ${referenceImageLimit}-image limit.`
          : `Added ${nextImages.length} reference image${nextImages.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setUploadStatus("error");
      setUploadMessage(error instanceof Error ? error.message : "Failed to upload image.");
    }
  };

  const handleReferenceDragEnter = (event: DragEvent<HTMLFormElement>) => {
    if (!supportsReferenceImages) return;
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }
    event.preventDefault();
    setIsDraggingReference(true);
  };

  const handleReferenceDragOver = (event: DragEvent<HTMLFormElement>) => {
    if (!supportsReferenceImages) return;
    if (!Array.from(event.dataTransfer.types).includes("Files")) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDraggingReference(true);
  };

  const handleReferenceDragLeave = (event: DragEvent<HTMLFormElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDraggingReference(false);
  };

  const handleReferenceDrop = async (event: DragEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsDraggingReference(false);
    if (!supportsReferenceImages) {
      setUploadStatus("error");
      setUploadMessage(`${activeModelOption.label} is text-to-image only and does not accept reference images.`);
      return;
    }
    await addReferenceImages(Array.from(event.dataTransfer.files));
  };

  const handleReferenceInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    await addReferenceImages(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const requestPromptRefinement = async (answers: PromptRefinerAnswer[] = []) => {
    if (isGenerating || promptRefiner.status === "loading") return;

    const prompt = promptText.trim();
    if (!prompt && referenceImages.length === 0) {
      setPromptRefiner({
        status: "error",
        answers,
        message: "Add a prompt or reference image before refining.",
      });
      return;
    }

    setIsComposerRaised(true);
    setPromptRefiner({
      status: "loading",
      answers,
      message: answers.length > 0 ? "Using your answer..." : "Reading prompt and references...",
    });

    try {
      const response = await fetch("/api/prompt-refiner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          referenceImages,
          answers,
        }),
      });
      const payload = (await response.json()) as Partial<PromptRefinerApiResponse> & GenerateApiError;

      if (response.status === 401) {
        await requireSignedIn();
        throw new Error("Sign in to refine prompts.");
      }

      if (shouldOpenPromptRefinerGeminiKeyGate(response.status, payload.error)) {
        await requireGeminiKey();
        throw new Error("Add your Gemini API key before refining prompts.");
      }

      if (!response.ok) {
        throw new Error(payload.error || "Prompt refinement failed.");
      }

      if (payload.status === "questions" && payload.question) {
        setPromptRefiner({
          status: "question",
          answers,
          intentSummary: payload.intentSummary ?? "Kavero needs one more detail.",
          question: payload.question,
          maxQuestions: payload.maxQuestions ?? 3,
          customAnswer: "",
        });
        return;
      }

      if (payload.status === "refined" && payload.refinedPrompt) {
        setPromptRefiner({
          status: "refined",
          answers,
          intentSummary: payload.intentSummary ?? "Prompt refined.",
          refinedPrompt: payload.refinedPrompt,
          refinementNote: payload.refinementNote ?? "",
          originalPrompt: promptText,
        });
        return;
      }

      throw new Error("Prompt refinement returned an incomplete response.");
    } catch (error) {
      setPromptRefiner({
        status: "error",
        answers,
        message: error instanceof Error ? error.message : "Prompt refinement failed.",
      });
    }
  };

  const answerPromptRefinerQuestion = (answer: string) => {
    if (promptRefiner.status !== "question") return;
    const nextAnswers = [
      ...promptRefiner.answers,
      {
        question: promptRefiner.question.text,
        answer,
      },
    ];
    void requestPromptRefinement(nextAnswers);
  };

  const replacePromptWithRefinement = () => {
    if (promptRefiner.status !== "refined") return;
    setPromptBeforeRefineReplacement(promptRefiner.originalPrompt);
    setPromptText(promptRefiner.refinedPrompt);
  };

  const undoPromptRefinementReplacement = () => {
    if (promptBeforeRefineReplacement === null) return;
    setPromptText(promptBeforeRefineReplacement);
    setPromptBeforeRefineReplacement(null);
  };

  const handleGenerate = async (value: string) => {
    const prompt = value.trim();
    if (!prompt || isGenerating) return;
    const selectedImageAlias = modelProvider.settings?.selected?.imageGenerationModelAlias;
    if (!selectedImageAlias || !activeImageModels.some((model) => model.modelAlias === selectedImageAlias)) {
      setGenerationError("No active image model is selected. Add provider credentials or choose an active model in Settings.");
      return;
    }

    const status = await loadWorkspaceStatus();
    if (!(await requireSignedIn(status))) return;
    if (activeModelMetadata?.provider === "gemini" && !(await requireGeminiKey(status))) return;
    const storageReady = await ensureGenerateStorageReady({
      workspaceStatus: status,
      loadDrivePreflight,
      openGateDialog,
    });
    if (!storageReady) return;

    const runId = `${Date.now()}`;
    const model = settings.model as ModelId;
    const submittedReferenceImages = referenceImages;
    const draftRun: GenerationRun = {
      id: runId,
      prompt,
      model,
      modelLabel: activeModelOption.label,
      kind: "image",
      images: [],
      text: "",
      referenceImages: submittedReferenceImages,
      createdAt: new Date().toISOString(),
      settings: { ...settings },
      warnings: [],
    };

    setPromptText("");
    setReferenceImages([]);
    setUploadStatus("idle");
    setUploadMessage("");
    setPreviewReference(null);
    setActiveRun(draftRun);
    setGenerationError(null);
    setSettingsOpen(false);
    setGeneratedPanelMode("split");
    setIsComposerRaised(false);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          modelAlias: selectedImageAlias,
          model,
          count: Number(settings.count),
          thinking: settings.thinking,
          aspectRatio: settings.aspect,
          imageSize: settings.quality,
          quality: settings.providerQuality,
          background: settings.background,
          schema: "none",
          referenceImages: submittedReferenceImages,
        }),
      });

      const payload = (await response.json()) as Partial<GenerateApiResponse> & GenerateApiError;

      if (!response.ok) {
        if (response.status === 409 && (payload.details as { code?: string } | undefined)?.code === "model-selection-stale") {
          setActiveRun(null);
          setPromptText(prompt);
          setReferenceImages(submittedReferenceImages);
          await modelProvider.refresh();
          throw new Error(payload.error || "Your default image model changed. Review it and try again.");
        }
        if (shouldOpenImageGenerationGeminiKeyGate(response.status, payload.error)) {
          setActiveRun(null);
          setPromptText(prompt);
          setReferenceImages(submittedReferenceImages);
          await openImageModelKeyDialog();
          return;
        }

        const fieldErrors = payload.details?.fieldErrors
          ? Object.entries(payload.details.fieldErrors)
              .filter(([, messages]) => messages.length > 0)
              .map(([field, messages]) => `${field}: ${messages.join(", ")}`)
              .join(" ")
          : "";

        throw new Error([payload.error, fieldErrors].filter(Boolean).join(" ") || "Generation failed.");
      }

      const nextRun: GenerationRun = {
        ...draftRun,
        model: payload.model ?? model,
        modelLabel: payload.modelLabel ?? activeModelOption.label,
        kind: payload.kind ?? draftRun.kind,
        images: payload.images ?? [],
        text: payload.text ?? "",
        warnings: payload.warnings ?? [],
      };

      setActiveRun(nextRun);
      setGenerationHistory((current) => [nextRun, ...current.filter((item) => item.id !== nextRun.id)].slice(0, 10));
    } catch (error) {
      setGenerationError(error instanceof Error ? error.message : "Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  async function loadDrivePreflight() {
    const preflightResponse = await fetch("/api/google-drive/preflight");
    if (!preflightResponse.ok) return null;
    return (await preflightResponse.json()) as DrivePreflightResponse;
  }

  const promptRefinerPanel = hasPromptRefinerPanel ? (
    <div className="grid gap-2 rounded-xl border border-white/[0.08] bg-black/20 p-2.5 text-left">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-accent/90">
            {promptRefiner.status === "loading" ? (
              <Loader2 className="animate-spin" size={13} />
            ) : (
              <Sparkles size={13} />
            )}
            Prompt refiner
          </span>
          <span className="mt-1 block text-[11px] font-semibold leading-4 text-white/54">
            {promptRefiner.status === "loading"
              ? promptRefiner.message
              : promptRefiner.status === "question"
                ? promptRefiner.intentSummary
                : promptRefiner.status === "refined"
                  ? promptRefiner.refinementNote || promptRefiner.intentSummary
                  : promptRefiner.status === "error"
                    ? promptRefiner.message
                    : ""}
          </span>
        </span>
        <button
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/50 transition hover:bg-white/[0.08] hover:text-white"
          type="button"
          aria-label="Dismiss prompt refiner"
          onClick={() => setPromptRefiner({ status: "idle", answers: [] })}
        >
          <X size={14} />
        </button>
      </div>

      {promptRefiner.status === "question" ? (
        <div className="grid gap-2">
          <p className="text-[13px] font-extrabold leading-5 text-white/88">
            {promptRefiner.question.text}
          </p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {promptRefiner.question.options
              .filter((option) => !option.allowsCustom)
              .map((option) => (
                <button
                  key={option.id}
                  className="min-h-9 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 py-2 text-left text-[12px] font-bold leading-4 text-white/72 transition hover:border-accent/50 hover:bg-accent/14 hover:text-white"
                  type="button"
                  onClick={() => answerPromptRefinerQuestion(option.value)}
                >
                  {option.label}
                </button>
              ))}
          </div>
          <div className="grid gap-1.5 sm:grid-cols-[minmax(0,1fr)_auto]">
            <input
              className="h-9 min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.045] px-3 text-[12px] font-semibold text-white outline-none transition placeholder:text-white/34 focus:border-accent/55 focus:ring-2 focus:ring-accent/18"
              placeholder={
                promptRefiner.question.options.find((option) => option.allowsCustom)?.label ?? "Other / expand"
              }
              value={promptRefiner.customAnswer}
              onChange={(event) =>
                setPromptRefiner((current) =>
                  current.status === "question" ? { ...current, customAnswer: event.target.value } : current,
                )
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                const answer = promptRefiner.customAnswer.trim();
                if (!answer) return;
                answerPromptRefinerQuestion(answer);
              }}
            />
            <button
              className="h-9 rounded-lg bg-white/[0.1] px-3 text-[12px] font-extrabold text-white/76 transition hover:bg-white/[0.16] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              type="button"
              disabled={!promptRefiner.customAnswer.trim()}
              onClick={() => answerPromptRefinerQuestion(promptRefiner.customAnswer.trim())}
            >
              Answer
            </button>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/32">
            {promptRefiner.answers.length} / {promptRefiner.maxQuestions} questions used
          </span>
        </div>
      ) : null}

      {promptRefiner.status === "refined" ? (
        <div className="grid gap-2">
          <div className="max-h-32 overflow-y-auto rounded-lg border border-white/[0.08] bg-white/[0.04] p-3 text-[12px] font-semibold leading-5 text-white/76 [scrollbar-color:rgb(255_255_255_/_0.28)_transparent]">
            {promptBeforeRefineReplacement !== null ? promptBeforeRefineReplacement : promptRefiner.refinedPrompt}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/36">
              {promptBeforeRefineReplacement !== null ? "Original prompt" : "Refined prompt"}
            </span>
            <button
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3 text-[12px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
              type="button"
              disabled={promptBeforeRefineReplacement === null && promptText === promptRefiner.refinedPrompt}
              onClick={
                promptBeforeRefineReplacement !== null
                  ? undoPromptRefinementReplacement
                  : replacePromptWithRefinement
              }
            >
              {promptBeforeRefineReplacement !== null ? <RotateCcw size={14} /> : <Check size={14} />}
              {promptBeforeRefineReplacement !== null ? "Undo replacement" : "Replace prompt"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <FloatingTooltip.Provider className="bg-black/72 text-white">
      <main className="relative min-h-svh w-full overflow-hidden bg-black font-sans text-white [isolation:isolate]">
      <div
        className="pointer-events-none fixed left-1/2 top-[25px] z-20 hidden h-px w-[min(880px,76vw)] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgb(255_255_255_/_0.16),transparent)] blur-[0.5px] md:block"
        aria-hidden="true"
      />

      <SiteNav activeLabel="Generate" ariaLabel="Generate navigation" />

      <motion.aside
        className="fixed left-0 top-1/2 z-30 hidden h-[min(58svh,560px)] min-h-[360px] w-[224px] flex-col gap-2 p-1.5 text-white min-[920px]:flex xl:w-[248px]"
        initial={false}
        animate={{
          x: generationActive ? -288 : 0,
          y: "-50%",
          opacity: generationActive ? 0 : 1,
          pointerEvents: generationActive ? "none" : "auto",
        }}
        transition={generationTransition}
        aria-label="Prompt library"
      >
        <div className={`${glassPanelClass} flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl`}>
          <button
            className="m-1.5 grid min-h-[54px] grid-cols-[40px_minmax(0,1fr)] items-center gap-2 rounded-xl bg-white/[0.08] px-2 text-left text-white transition hover:bg-white/[0.12] disabled:cursor-wait disabled:opacity-55"
            type="button"
            onClick={openCreatePrompt}
            disabled={promptLibraryStatus === "loading"}
          >
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent/20 text-accent">
              <Plus size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-[12px] font-extrabold">Add prompt</span>
              <span className="block truncate text-[10px] font-semibold text-white/44">
                Save a reusable generation prompt
              </span>
            </span>
          </button>

          {promptLibraryMessage && (
            <div className="mx-1.5 mb-1 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[10px] font-semibold leading-4 text-white/46">
              {promptLibraryMessage}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
            {promptLibraryStatus === "loading" ? (
              <PromptLibrarySkeleton />
            ) : filteredPrompts.length > 0 ? (
              filteredPrompts.map((preset) => (
                <article
                  key={preset.id}
                  className="group mb-1 rounded-xl border border-transparent p-1 transition hover:border-white/[0.08] hover:bg-white/[0.055]"
                >
                  <button
                    className="grid w-full grid-cols-[44px_minmax(0,1fr)] gap-2 text-left"
                    type="button"
                    onClick={() => openPreviewPrompt(preset)}
                  >
                    <span className="relative grid h-11 w-11 place-items-center overflow-hidden rounded-lg bg-white/[0.055] text-white/68">
                      <PromptThumbnail icon={preset.thumbnailIcon} size="sm" />
                      {preset.referenceImages?.length ? (
                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/74 px-1 text-[9px] font-black text-white">
                          {preset.referenceImages.length}
                        </span>
                      ) : null}
                    </span>
                    <span className="min-w-0 py-0.5">
                      <strong className="block truncate text-[12px] font-extrabold text-white/92">
                        {preset.name}
                      </strong>
                      <span className="mt-0.5 block truncate text-[10px] font-semibold leading-4 text-white/42">
                        {preset.prompt}
                      </span>
                    </span>
                  </button>
                  <div className="mt-1 grid grid-cols-3 gap-1 opacity-70 transition group-hover:opacity-100">
                    <button
                      className="grid h-7 place-items-center rounded-lg text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                      type="button"
                      aria-label={`Use ${preset.name}`}
                      onClick={() => void usePrompt(preset)}
                    >
                      <CornerDownLeft size={14} />
                    </button>
                    <button
                      className="grid h-7 place-items-center rounded-lg text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                      type="button"
                      aria-label={`Preview ${preset.name}`}
                      onClick={() => openPreviewPrompt(preset)}
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      className="grid h-7 place-items-center rounded-lg text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                      type="button"
                      aria-label={`Edit ${preset.name}`}
                      onClick={() => openEditPrompt(preset)}
                    >
                      <Edit3 size={14} />
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="grid h-full min-h-[220px] place-items-center px-5 text-center">
                <span>
                  <span className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-xl bg-white/[0.055] text-white/48">
                    <FileText size={17} />
                  </span>
                  <span className="block text-[12px] font-bold text-white/72">No prompts found</span>
                  <span className="mt-1 block text-[10px] font-medium leading-4 text-white/42">
                    Add one or adjust your search.
                  </span>
                </span>
              </div>
            )}
          </div>
        </div>

        <label
          className={`${glassPanelClass} grid h-[54px] grid-cols-[1fr_22px] items-center rounded-xl px-3.5`}
        >
          <span className="sr-only">Search prompts</span>
          <input
            className="min-w-0 bg-transparent text-[12px] font-semibold text-white outline-none placeholder:text-white/46"
            placeholder="Search prompts..."
            value={promptSearch}
            onChange={(event) => setPromptSearch(event.target.value)}
          />
          <Search aria-hidden="true" className="text-white/82" size={17} />
        </label>
      </motion.aside>

      <motion.div
        className="fixed bottom-5 left-1.5 z-30 hidden w-[172px] grid-cols-1 gap-1.5 rounded-xl px-1.5 py-1.5 text-white min-[920px]:grid min-[920px]:bottom-8 xl:w-[248px]"
        initial={false}
        animate={{
          x: generationActive ? -280 : 0,
          y: generationActive ? 24 : 0,
          opacity: generationActive ? 0 : 1,
          pointerEvents: generationActive ? "none" : "auto",
        }}
        transition={generationTransition}
      >
        <ModelQuickPicker
          label="Image model"
          icon={Images}
          value={modelProvider.settings?.selected?.imageGenerationModelAlias ?? ""}
          options={activeImageModels.map((model) => ({ value: model.modelAlias, label: model.displayLabel, description: model.description }))}
          emptyLabel="No active models"
          onSelect={(imageGenerationModelAlias) => void modelProvider.saveSelection({ imageGenerationModelAlias })}
        />
        <ModelQuickPicker
          label="Prompt model"
          icon={BrainCircuit}
          value={modelProvider.settings?.selected?.chatOrchestrationModelAlias ?? ""}
          options={activeChatModels.map((model) => ({ value: model.modelAlias, label: model.displayLabel, description: model.providerLabel }))}
          emptyLabel="No active models"
          onSelect={(chatOrchestrationModelAlias) => void modelProvider.saveSelection({ chatOrchestrationModelAlias })}
        />
      </motion.div>

      <motion.aside
        className={`${glassPanelClass} fixed right-0 top-1/2 z-30 hidden w-16 flex-col items-center gap-2 rounded-l-2xl bg-black/35 px-2 py-3 min-[760px]:flex`}
        initial={false}
        animate={{
          x: generationActive ? 96 : 0,
          y: "-50%",
          opacity: generationActive ? 0 : 1,
          pointerEvents: generationActive ? "none" : "auto",
        }}
        transition={generationTransition}
        aria-label="Generation controls"
      >
        <FloatingTooltip.Trigger
          content="Search"
          description="Find generated images, prompts, and reusable references."
        >
          <button className={railButtonClass} type="button" aria-label="Search">
            <Search size={18} />
          </button>
        </FloatingTooltip.Trigger>
        <div className="my-1 h-px w-8 bg-white/[0.08]" />
        {railSettingDefinitions.map((definition) => {
          const Icon = definition.icon;
          const selected = getSelectedOption(definition);
          const active = settingsOpen && activeSetting === definition.key;
          const badge = settingBadges[definition.key][settings[definition.key]] ?? selected.label;
          return (
            <FloatingTooltip.Trigger
              key={definition.key}
              content={definition.tooltip}
              description={`${definition.description} Current: ${selected.label}.`}
            >
              <button
                className={`${railButtonClass} ${
                  active
                    ? "bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]"
                    : "text-white/82"
                }`}
                type="button"
                aria-label={definition.tooltip}
                aria-expanded={active}
                onClick={() => {
                  setActiveSetting(definition.key);
                  setSettingsOpen((open) => (activeSetting === definition.key ? !open : true));
                }}
              >
                <Icon size={18} />
                <span
                  className={`absolute bottom-0 right-0 max-w-[30px] truncate rounded-full border px-1.5 py-[1px] text-[9px] font-black leading-3 shadow-[0_6px_18px_rgb(0_0_0_/_0.35)] ${
                    active
                      ? "border-accent/45 bg-accent text-white"
                      : "border-white/[0.08] bg-black/72 text-white/72"
                  }`}
                >
                  {badge}
                </span>
              </button>
            </FloatingTooltip.Trigger>
          );
        })}
      </motion.aside>

      {settingsOpen && (
        <section
          className="fixed right-[76px] top-1/2 z-40 hidden max-h-[min(78svh,720px)] w-[min(360px,calc(100vw-104px))] -translate-y-1/2 overflow-hidden rounded-2xl border border-white/[0.1] bg-black/45 text-white shadow-[0_28px_100px_rgb(0_0_0_/_0.58),inset_0_1px_0_rgb(255_255_255_/_0.08)] backdrop-blur-2xl min-[760px]:flex min-[760px]:flex-col"
          aria-label={`${currentDefinition.label} options`}
        >
          <div className="border-b border-white/[0.08] bg-white/[0.045] px-4 py-3">
            <div className="flex items-center gap-2">
              <CurrentSettingIcon size={16} className="text-accent" />
              <h2 className="text-[13px] font-extrabold">{currentDefinition.label}</h2>
            </div>
            <p className="mt-1 text-[11px] font-medium leading-4 text-white/48">
              {currentDefinition.description}
            </p>
          </div>

          <div className="min-h-0 overflow-y-auto p-3 [scrollbar-color:rgb(255_255_255_/_0.28)_transparent]">
              {currentDefinition.key === "count" ? (
                <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.05)]">
                  {currentDefinition.options.map((option) => {
                    const selected = settings.count === option.value;
                    return (
                      <button
                        key={option.value}
                        className={`grid h-14 place-items-center rounded-xl border text-[15px] font-black transition ${
                          selected
                            ? "border-white/75 bg-white/[0.14] text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]"
                            : "border-white/[0.1] bg-white/[0.035] text-white/60 hover:border-white/36 hover:bg-white/[0.07] hover:text-white"
                        }`}
                        type="button"
                        onClick={() => setSettings((current) => ({ ...current, count: option.value }))}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              ) : currentDefinition.key === "aspect" ? (
                <div className="rounded-2xl border border-white/[0.08] bg-white/[0.045] p-3 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.05)]">
                  <div className="grid gap-3 sm:grid-cols-[1fr_128px]">
                    <div className="grid grid-cols-3 gap-2">
                      {currentDefinition.options.map((option) => {
                        const selected = settings.aspect === option.value;
                        return (
                          <button
                            key={option.value}
                            className={`grid h-[46px] place-items-center rounded-md border text-[10px] font-extrabold transition sm:text-[11px] ${
                              selected
                                ? "border-white/80 bg-white/[0.14] text-white"
                                : "border-white/[0.16] bg-white/[0.045] text-white/62 hover:border-white/42 hover:text-white"
                            }`}
                            type="button"
                            onClick={() => setSettings((current) => ({ ...current, aspect: option.value }))}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="relative grid min-h-[118px] place-items-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#1b2632]/80">
                      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgb(255_255_255_/_0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgb(255_255_255_/_0.12)_1px,transparent_1px)] bg-[size:38px_38px]" />
                      <div
                        className="relative rounded border-2 border-white/78 bg-white/[0.08] shadow-[0_0_0_1px_rgb(0_0_0_/_0.25)]"
                        style={{ aspectRatio: getSelectedOption(currentDefinition).preview ?? "1 / 1", width: "74px" }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="grid gap-2">
                  {currentDefinition.options.map((option) => {
                    const selected = settings[currentDefinition.key] === option.value;
                    return (
                      <button
                        key={option.value}
                        className={`grid grid-cols-[1fr_20px] items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition ${
                          selected
                            ? "border-white/18 bg-white/[0.11] text-white"
                            : "border-white/[0.07] bg-white/[0.035] text-white/64 hover:bg-white/[0.07] hover:text-white"
                        }`}
                        type="button"
                        onClick={() => setSettings((current) => {
                          if (currentDefinition.key !== "model") return { ...current, [currentDefinition.key]: option.value };
                          const selectedModel = getBrowserImageModelByLegacyId(option.value);
                          if (selectedModel) void modelProvider.saveSelection({ imageGenerationModelAlias: selectedModel.modelAlias });
                          const normalized = normalizeBrowserImageUiSettings({
                            model: current.model,
                            count: Number(current.count),
                            aspectRatio: current.aspect,
                            imageSize: current.quality,
                            reasoning: current.thinking,
                            quality: current.providerQuality,
                            background: current.background as "auto" | "opaque" | "transparent",
                          }, option.value, "standalone-generate");
                          return {
                            ...current,
                            model: normalized.model,
                            count: String(normalized.count),
                            aspect: normalized.aspectRatio,
                            quality: normalized.imageSize,
                            thinking: normalized.reasoning,
                            providerQuality: normalized.quality ?? "auto",
                            background: normalized.background ?? "auto",
                          };
                        })}
                      >
                        <span>
                          <span className="block text-[12px] font-extrabold">{option.label}</span>
                          <span className="block text-[11px] font-medium leading-4 text-white/45">
                            {option.description}
                          </span>
                        </span>
                        {selected && <Check size={15} className="text-accent" />}
                      </button>
                    );
                  })}
                </div>
              )}
          </div>
        </section>
      )}

      {promptDialogMode && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/34 px-4 backdrop-blur-sm">
          <section
            className="flex h-[min(680px,calc(100svh-28px))] w-[min(960px,calc(100vw-28px))] flex-col overflow-hidden rounded-2xl border border-white/[0.11] bg-black/58 text-white shadow-[0_28px_120px_rgb(0_0_0_/_0.62),inset_0_1px_0_rgb(255_255_255_/_0.08)] backdrop-blur-2xl"
            aria-label="Prompt editor"
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/[0.08] bg-white/[0.045] px-4 py-3">
              <span>
                <span className="block text-[13px] font-extrabold">
                  {promptDialogMode === "create"
                    ? "Add prompt"
                    : promptDialogMode === "edit"
                      ? "Edit prompt"
                      : activePrompt?.name ?? "Prompt preview"}
                </span>
                <span className="mt-1 block text-[11px] font-medium leading-4 text-white/48">
                  {promptDialogMode === "preview"
                    ? "Preview, edit, or insert this prompt into the composer."
                    : "Save a reusable prompt with a name, thumbnail, reference images, and prompt body."}
                </span>
              </span>
              <button
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/58 transition hover:bg-white/[0.08] hover:text-white"
                type="button"
                aria-label="Close prompt dialog"
                onClick={() => setPromptDialogMode(null)}
              >
                <X size={16} />
              </button>
            </div>

            {promptDialogMode === "preview" && activePrompt ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
                  <div className="grid aspect-square place-items-center overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.045]">
                    <PromptThumbnail icon={activePrompt.thumbnailIcon} size="lg" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate text-[18px] font-extrabold">{activePrompt.name}</h3>
                    <p className="mt-3 max-h-[220px] overflow-y-auto whitespace-pre-wrap rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3 text-[12px] font-medium leading-5 text-white/68">
                      {activePrompt.prompt}
                    </p>
                  </div>
                </div>
                {activePrompt.referenceImages?.length ? (
                  <div className="mt-4 rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white/46">
                        Attached Images
                      </span>
                      <span className="text-[10px] font-black text-white/40">
                        {activePrompt.referenceImages.length} refs
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {activePrompt.referenceImages.map((image, index) => {
                        const source = getPresetReferenceSource(image);
                        return (
                          <span
                            key={`${image.name}-${index}`}
                            className="grid aspect-square place-items-center overflow-hidden rounded-lg border border-white/[0.08] bg-black/28"
                            title={image.name}
                          >
                            {source ? (
                              <img className="h-full w-full object-contain p-1.5" src={source} alt="" />
                            ) : (
                              <ImageIcon size={16} className="text-white/46" />
                            )}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.045] px-4 text-[12px] font-extrabold text-white/76 transition hover:bg-white/[0.08] hover:text-white"
                    type="button"
                    onClick={() => openEditPrompt(activePrompt)}
                  >
                    <Edit3 size={15} />
                    Edit
                  </button>
                  <button
                    className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[12px] font-extrabold text-white transition hover:bg-accent-hover"
                    type="button"
                    onClick={() => void usePrompt(activePrompt)}
                  >
                    <CornerDownLeft size={15} />
                    Use prompt
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-5 sm:grid-cols-[minmax(0,1fr)_320px]">
                <label className="grid gap-1.5 sm:col-span-2">
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white/42">
                    Headline
                  </span>
                  <input
                    className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.045] px-3 text-[13px] font-semibold text-white outline-none transition placeholder:text-white/34 focus:border-accent/60 focus:ring-2 focus:ring-accent/20"
                    placeholder="Prompt name"
                    value={draftPrompt.name}
                    onChange={(event) =>
                      setDraftPrompt((current) => ({ ...current, name: event.target.value }))
                    }
                  />
                </label>

                <div className="grid content-start overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] sm:col-start-1 sm:row-start-2">
                  <button
                    className="grid h-[58px] grid-cols-[34px_minmax(0,1fr)_20px] items-center gap-2 px-3 text-left transition hover:bg-white/[0.06]"
                    type="button"
                    aria-expanded={promptIconPanelOpen}
                    onClick={() => setPromptIconPanelOpen((open) => !open)}
                  >
                    <span className="grid h-8 w-8 place-items-center overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.045]">
                      <PromptThumbnail icon={draftPrompt.thumbnailIcon} size="sm" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[10px] font-extrabold uppercase tracking-[0.08em] text-white/42">
                        Icon
                      </span>
                      <span className="block truncate text-[12px] font-extrabold text-white/84">
                        {promptIconLabel(draftPrompt.thumbnailIcon.name)}
                      </span>
                    </span>
                    <ChevronDown
                      size={16}
                      className={`text-white/46 transition ${promptIconPanelOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {promptIconPanelOpen ? (
                      <motion.div
                        key="prompt-icon-picker"
                        className="grid gap-2 overflow-hidden border-t border-white/[0.08] p-2.5"
                        initial={{ height: 0, opacity: 0, y: -4 }}
                        animate={{ height: "auto", opacity: 1, y: 0 }}
                        exit={{ height: 0, opacity: 0, y: -4 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                      >
                        <div className="grid grid-cols-[1fr_38px] gap-2">
                          <label className="grid h-8 grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-lg border border-white/[0.08] bg-black/20 px-2">
                            <Search size={14} className="text-white/42" />
                            <input
                              className="min-w-0 bg-transparent text-[12px] font-semibold text-white outline-none placeholder:text-white/36"
                              placeholder="Search icons"
                              value={promptIconSearch}
                              onChange={(event) => setPromptIconSearch(event.target.value)}
                            />
                          </label>
                          <input
                            className="h-8 w-[38px] cursor-pointer rounded-lg border border-white/[0.1] bg-white/[0.045] p-1"
                            type="color"
                            aria-label="Icon color"
                            value={draftPrompt.thumbnailIcon.color}
                            onChange={(event) =>
                              setDraftPrompt((current) => ({
                                ...current,
                                thumbnailIcon: {
                                  ...current.thumbnailIcon,
                                  color: event.target.value,
                                  version: 1,
                                },
                              }))
                            }
                          />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {PROMPT_ICON_COLORS.map((color) => (
                            <button
                              key={color}
                              className={`h-6 w-6 rounded-md border transition ${
                                draftPrompt.thumbnailIcon.color.toLowerCase() === color
                                  ? "border-white/82 ring-2 ring-white/18"
                                  : "border-white/[0.1] hover:border-white/42"
                              }`}
                              type="button"
                              aria-label={`Use ${color}`}
                              style={{ backgroundColor: color }}
                              onClick={() =>
                                setDraftPrompt((current) => ({
                                  ...current,
                                  thumbnailIcon: { ...current.thumbnailIcon, color, version: 1 },
                                }))
                              }
                            />
                          ))}
                        </div>
                        <div className="grid max-h-[112px] grid-cols-8 gap-1.5 overflow-y-auto pr-1 [scrollbar-color:rgb(255_255_255_/_0.28)_transparent] sm:grid-cols-7">
                          {filteredPromptIcons.map((name) => {
                            const selected = draftPrompt.thumbnailIcon.name === name;
                            return (
                              <button
                                key={name}
                                className={`grid h-9 place-items-center rounded-lg border transition ${
                                  selected
                                    ? "border-accent/70 bg-accent/18 text-white"
                                    : "border-white/[0.08] bg-white/[0.035] text-white/54 hover:border-white/32 hover:bg-white/[0.07] hover:text-white"
                                }`}
                                type="button"
                                title={promptIconLabel(name)}
                                aria-label={`Use ${promptIconLabel(name)}`}
                                onClick={() =>
                                  setDraftPrompt((current) => ({
                                    ...current,
                                    thumbnailIcon: { ...current.thumbnailIcon, name, version: 1 },
                                  }))
                                }
                              >
                                <DynamicIcon name={name as IconName} size={17} />
                              </button>
                            );
                          })}
                          {filteredPromptIcons.length === 0 ? (
                            <span className="col-span-6 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-[11px] font-semibold text-white/44">
                              No icons found.
                            </span>
                          ) : null}
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>

                <div className="grid content-start gap-1.5 sm:col-start-2 sm:row-span-2 sm:row-start-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white/42">
                      Reference Images
                    </span>
                    <span className="text-[10px] font-black text-white/38">
                      {draftPrompt.referenceImages?.length ?? 0} / 14
                    </span>
                  </div>
                  <label className="grid min-h-[50px] cursor-pointer grid-cols-[34px_minmax(0,1fr)] items-center gap-2 rounded-xl border border-dashed border-white/[0.13] bg-white/[0.035] px-3 transition hover:border-accent/55 hover:bg-accent/10">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.055] text-white/58">
                      <Images size={17} />
                    </span>
                    <span className="min-w-0 text-left">
                      <span className="block text-[12px] font-extrabold text-white/78">
                        Upload prompt references
                      </span>
                      <span className="block truncate text-[10px] font-semibold text-white/42">
                        These attach automatically when the prompt is used.
                      </span>
                    </span>
                    <input
                      className="sr-only"
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
                      multiple
                      onChange={(event) => void handleDraftReferenceChange(event)}
                    />
                  </label>

                  {draftPrompt.referenceImages?.length ? (
                    <div className="grid grid-cols-7 gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-1.5 sm:grid-cols-5">
                      {draftPrompt.referenceImages.map((image, index) => {
                        const source = getPresetReferenceSource(image);
                        return (
                          <span
                            key={`${image.name}-${index}`}
                            className="group relative grid aspect-square place-items-center overflow-hidden rounded-lg bg-black/30"
                            title={`${image.name} (${formatBytes(image.size)})`}
                          >
                            {source ? (
                              <img className="h-full w-full object-contain p-1.5" src={source} alt="" />
                            ) : (
                              <ImageIcon size={16} className="text-white/46" />
                            )}
                            <button
                              className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-md border border-white/20 bg-black/78 text-white shadow-[0_4px_14px_rgb(0_0_0_/_0.38)] transition hover:bg-red-500"
                              type="button"
                              aria-label={`Remove ${image.name}`}
                              onClick={() => removeDraftReferenceImage(index)}
                            >
                              <X size={12} />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ) : null}
                </div>

                <label className="grid min-h-0 gap-1.5 sm:col-start-1 sm:row-start-3">
                  <span className="text-[11px] font-extrabold uppercase tracking-[0.08em] text-white/42">
                    Prompt
                  </span>
                  <textarea
                    className={`resize-none rounded-xl border border-white/[0.08] bg-white/[0.045] p-3 text-[13px] font-medium leading-5 text-white outline-none transition-[height,border-color,box-shadow] duration-200 ease-out placeholder:text-white/34 focus:border-accent/60 focus:ring-2 focus:ring-accent/20 ${
                      promptIconPanelOpen ? "h-[188px]" : "h-[330px] sm:h-[312px]"
                    }`}
                    placeholder="Describe the reusable prompt..."
                    value={draftPrompt.prompt}
                    onChange={(event) =>
                      setDraftPrompt((current) => ({ ...current, prompt: event.target.value }))
                    }
                  />
                </label>

                <div className="mt-1 flex items-center justify-between gap-2 sm:col-span-2">
                  {promptDialogMode === "edit" ? (
                    <button
                      className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-[12px] font-extrabold text-white/58 transition hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white"
                      type="button"
                      onClick={() => void deletePrompt()}
                      disabled={promptLibraryStatus === "saving"}
                    >
                      <Trash2 size={15} />
                      Delete
                    </button>
                  ) : (
                    <span />
                  )}
                  <span className="flex justify-end gap-2">
                    <button
                      className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.045] px-4 text-[12px] font-extrabold text-white/68 transition hover:bg-white/[0.08] hover:text-white"
                      type="button"
                      onClick={() => setPromptDialogMode(null)}
                    >
                      Cancel
                    </button>
                    <button
                      className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent px-4 text-[12px] font-extrabold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-45"
                      type="button"
                      disabled={
                        !draftPrompt.name.trim() ||
                        !draftPrompt.prompt.trim() ||
                        promptLibraryStatus === "saving"
                      }
                      onClick={() => void savePrompt()}
                    >
                      <Check size={15} />
                      {promptLibraryStatus === "saving" ? "Saving..." : "Save prompt"}
                    </button>
                  </span>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      <section
        className="relative z-10 flex min-h-svh flex-col items-center justify-center px-5 pb-36 pt-24 text-center sm:pb-40 md:px-16"
        aria-label="Generate image prompt"
      >
        <AnimatePresence mode="wait">
          {generationActive ? (
            <motion.div
              key="generation-workspace"
              className="w-full"
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.99 }}
              transition={{ duration: 0.42, ease: "easeOut" }}
            >
              <GenerationWorkspace
                run={activeRun}
                isGenerating={isGenerating}
                loadingPhrase={loadingPhrase}
                error={generationError}
                panelMode={generatedPanelMode}
                onPanelModeChange={setGeneratedPanelMode}
              />
            </motion.div>
          ) : (
            <motion.div
              key="generate-hero"
              initial={{ opacity: 0, y: 10, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -16, scale: 0.965, filter: "blur(8px)" }}
              transition={generationTransition}
            >
              <h1 className="m-0 text-[clamp(76px,11vw,176px)] font-light leading-none tracking-normal text-white drop-shadow-[0_24px_80px_rgb(0_0_0_/_0.45)]">
                {brand.name}
              </h1>
              <p className="mt-4 text-[clamp(17px,1.35vw,24px)] font-semibold tracking-normal text-white/88 sm:mt-5">
                Start by describing your picture
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {previewReference && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/72 px-4 backdrop-blur-xl">
          <section
            className="relative grid max-h-[min(88svh,860px)] w-[min(980px,calc(100vw-28px))] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-white/[0.12] bg-black/72 text-white shadow-[0_30px_140px_rgb(0_0_0_/_0.78),inset_0_1px_0_rgb(255_255_255_/_0.08)]"
            aria-label="Reference image preview"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.08] bg-white/[0.045] px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-extrabold">
                  {previewReference.name}
                </span>
                <span className="mt-0.5 block text-[11px] font-semibold text-white/44">
                  {previewReference.mimeType} · {formatBytes(previewReference.size)}
                </span>
              </span>
              <button
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.045] text-white/70 transition hover:bg-white/[0.1] hover:text-white"
                type="button"
                aria-label="Close reference image preview"
                onClick={() => setPreviewReference(null)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid min-h-[320px] place-items-center bg-black/36 p-3">
              {previewReference.mimeType === "image/heic" || previewReference.mimeType === "image/heif" ? (
                <div className="grid justify-items-center gap-3 text-center">
                  <ImageIcon size={34} className="text-white/58" />
                  <p className="max-w-[42ch] text-[13px] font-semibold leading-5 text-white/62">
                    This browser may not preview HEIC or HEIF files, but the reference can still be sent to Gemini.
                  </p>
                </div>
              ) : (
                <img
                  className="max-h-[calc(min(88svh,860px)-88px)] max-w-full object-contain"
                  src={previewReference.dataUrl}
                  alt={previewReference.name}
                />
              )}
            </div>
          </section>
        </div>
      )}

      <AnimatePresence>
        {isDraggingReference && (
          <motion.div
            className={`${glassPanelClass} pointer-events-none fixed bottom-5 left-1/2 z-50 grid w-[min(calc(100vw-28px),860px)] min-h-[112px] -translate-x-1/2 place-items-center rounded-2xl border-accent/45 bg-black/72 text-center backdrop-blur-2xl min-[920px]:bottom-8 min-[920px]:w-[min(calc(100vw-360px),960px)] xl:w-[min(calc(100vw-520px),1080px)]`}
            initial={{ opacity: 0, scale: 0.96, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <motion.span
              className="absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_center,rgb(105_101_253_/_0.24),transparent_68%)]"
              animate={{ opacity: [0.45, 0.8, 0.45] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
            />
            <span className="relative z-10 grid justify-items-center gap-2 px-5">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/20 text-accent">
                <ImageIcon size={19} />
              </span>
              <span className="text-[14px] font-extrabold text-white">
                Drop images to attach
              </span>
              <span className="text-[11px] font-semibold text-white/56">
                {referenceImages.length} / {referenceImageLimit} used for {activeModelOption.label}
              </span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {(!hidePromptComposerDuringGeneration || !generationActive) && (
        <>
          <input
            ref={referenceFileInputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/heic,image/heif"
            multiple
            disabled={!supportsReferenceImages}
            tabIndex={-1}
            onChange={(event) => void handleReferenceInputChange(event)}
          />

          <AnimatePresence>
            {isPromptComposerCollapsed && (
              <motion.button
                className={`${glassPanelClass} fixed bottom-8 left-1/2 z-50 inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.08em] text-white/76 shadow-[0_16px_56px_rgb(0_0_0_/_0.5)] transition hover:border-accent/35 hover:bg-white/[0.075] hover:text-white`}
                type="button"
                aria-label="Show prompt composer"
                initial={{ opacity: 0, y: 18, scale: 0.92, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: 14, scale: 0.94, filter: "blur(8px)" }}
                transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                onMouseEnter={() => setIsComposerRaised(true)}
                onFocus={() => setIsComposerRaised(true)}
                onClick={() => setIsComposerRaised(true)}
              >
                <span className="relative grid h-5 w-5 place-items-center rounded-full bg-accent/24 text-accent">
                  <motion.span
                    className="absolute inset-0 rounded-full bg-accent/20"
                    animate={{ scale: [1, 1.35, 1], opacity: [0.42, 0.12, 0.42] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <ChevronDown className="rotate-180" size={13} />
                </span>
                Prompt
              </motion.button>
            )}
          </AnimatePresence>

          <PromptComposer
            aria-label="Generate image prompt composer"
            ariaLabel="Prompt"
            value={promptText}
            onValueChange={handlePromptTextChange}
            onSubmit={handleGenerate}
            isLoading={isGenerating}
            onDragEnter={handleReferenceDragEnter}
            onDragOver={handleReferenceDragOver}
            onDragLeave={handleReferenceDragLeave}
            onDrop={handleReferenceDrop}
            onMouseEnter={() => setIsComposerRaised(true)}
            onMouseLeave={(event) => {
              if (
                generationActive &&
                !composerHasDraft &&
                !event.currentTarget.contains(document.activeElement)
              ) {
                setIsComposerRaised(false);
              }
            }}
            onFocus={() => setIsComposerRaised(true)}
            onBlur={(event) => {
              if (!composerHasDraft && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setIsComposerRaised(false);
              }
            }}
            placeholder="Describe a picture..."
            maxHeight={hasPromptRefinerPanel ? 120 : 240}
            attachmentsSlot={
              hasComposerTopPanel ? (
                <div className="grid min-w-0 gap-2">
                  {promptRefinerPanel}
                  {hasReferencePanel ? (
                    <div className="flex min-w-0 items-center gap-3 text-left">
                      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-color:rgb(255_255_255_/_0.24)_transparent]">
                        {referenceImages.map((image, index) => (
                          <button
                            key={`${image.name}-${image.size}-${index}`}
                            className="group relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white/[0.06] transition hover:ring-2 hover:ring-white/45"
                            title={`${image.name} (${formatBytes(image.size)})`}
                            type="button"
                            aria-label={`Preview ${image.name}`}
                            onClick={() => setPreviewReference(image)}
                          >
                            {image.mimeType === "image/heic" || image.mimeType === "image/heif" ? (
                              <ImageIcon size={17} className="text-white/62" />
                            ) : (
                              <img className="h-full w-full object-cover" src={image.dataUrl} alt="" />
                            )}
                            <span
                              className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-md border border-white/20 bg-black/78 text-white shadow-[0_4px_14px_rgb(0_0_0_/_0.38)] backdrop-blur transition group-hover:bg-red-500"
                              role="button"
                              aria-label={`Remove ${image.name}`}
                              tabIndex={0}
                              onClick={(event) => {
                                event.stopPropagation();
                                removeReferenceImage(index);
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return;
                                event.preventDefault();
                                event.stopPropagation();
                                removeReferenceImage(index);
                              }}
                            >
                              <X size={12} />
                            </span>
                          </button>
                        ))}
                        <span className="min-w-[180px] flex-1">
                          <span className="block truncate text-[12px] font-extrabold text-white/82">
                            {referenceImages.length} / {referenceImageLimit} references
                          </span>
                          <span
                            className={`block truncate text-[10px] font-bold uppercase tracking-[0.08em] ${
                              uploadStatus === "error"
                                ? "text-red-200/80"
                                : uploadStatus === "success"
                                  ? "text-emerald-200/78"
                                  : uploadStatus === "uploading"
                                    ? "text-accent/90"
                                    : "text-white/38"
                            }`}
                          >
                            {uploadMessage || `${activeModelOption.label} limit`}
                          </span>
                        </span>
                      </div>
                      {referenceImages.length > 0 && (
                        <button
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/56 transition hover:bg-white/[0.08] hover:text-white"
                          type="button"
                          aria-label="Remove all reference images"
                          onClick={clearReferenceImages}
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : undefined
            }
            classNames={{
              root: `${glassPanelClass} fixed bottom-5 left-1/2 z-40 grid w-[min(calc(100vw-28px),860px)] -translate-x-1/2 grid-cols-[44px_minmax(0,1fr)_auto] overflow-hidden rounded-2xl bg-[linear-gradient(90deg,rgb(70_70_70_/_0.34),rgb(12_12_12_/_0.34))] shadow-[0_28px_100px_rgb(0_0_0_/_0.62),inset_0_1px_0_rgb(255_255_255_/_0.065)] backdrop-blur-2xl transition-[transform,opacity,filter] duration-500 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] min-[920px]:bottom-8 min-[920px]:w-[min(calc(100vw-360px),960px)] sm:grid-cols-[48px_minmax(0,1fr)_auto] xl:w-[min(calc(100vw-520px),1080px)] ${
                generationActive
                  ? isPromptComposerCollapsed
                    ? "pointer-events-none translate-y-[132px] scale-[0.94] opacity-0 blur-sm"
                    : "translate-y-0 opacity-100 saturate-100"
                  : "translate-y-0"
              } ${
                hasComposerTopPanel
                  ? "[grid-template-rows:auto_minmax(0,1fr)_auto]"
                  : "[grid-template-rows:minmax(0,1fr)_auto]"
              }`,
              leadingSlot: `${hasComposerTopPanel ? "row-start-3" : "row-start-2"} col-start-1 flex items-center justify-center pb-2 pl-2`,
              leadingButton:
                "grid h-8 w-8 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.06] hover:text-white",
              textarea:
                `${hasComposerTopPanel ? "row-start-2 border-t border-white/[0.08]" : "row-start-1"} col-span-3 col-start-1 h-16 min-h-16 w-full resize-none overflow-y-auto bg-transparent px-5 pb-0 pr-16 pt-4 text-left text-[14px] font-semibold leading-6 text-white outline-none placeholder:text-white/44 [scrollbar-color:rgb(255_255_255_/_0.34)_transparent] sm:px-6 sm:pr-16 sm:text-[15px]`,
              attachmentsSlot:
                "col-span-3 col-start-1 row-start-1 bg-white/[0.045] px-4 py-2",
              actionsSlot: `${hasComposerTopPanel ? "row-start-3" : "row-start-2"} pointer-events-none col-span-2 col-start-2 flex items-center justify-end gap-1.5 p-2 pl-0`,
              actionButton:
                `pointer-events-auto absolute right-2 grid h-10 w-10 place-items-center rounded-xl bg-transparent text-accent transition hover:bg-accent/10 hover:text-blue-50 disabled:cursor-not-allowed disabled:opacity-45 ${
                  hasReferencePanel ? "top-[74px]" : "top-3"
                }`,
              submitButton: `inline-flex h-10 w-10 items-center justify-center rounded-xl bg-accent/60 px-0 text-blue-50 shadow-[0_10px_26px_rgb(105_101_253_/_0.24),inset_0_1px_0_rgb(255_255_255_/_0.18)] transition hover:bg-accent disabled:cursor-wait disabled:opacity-80 ${
                isGenerating ? "bg-accent ring-2 ring-accent/24" : ""
              } pointer-events-auto`,
              submitLabel: "sr-only",
              desktopSubmitIcon: "grid",
              mobileSubmitIcon: "sm:hidden",
            }}
            leadingAction={{
              label: supportsReferenceImages ? "Upload reference images" : `${activeModelOption.label} is text-to-image only`,
              icon: <ImageIcon size={17} />,
              onClick: () => supportsReferenceImages
                ? referenceFileInputRef.current?.click()
                : setUploadMessage(`${activeModelOption.label} is text-to-image only and does not accept reference images.`),
            }}
            actions={
              hasPromptRefinerPanel
                ? []
                : [
                    {
                      label: "Refine prompt",
                      icon: <WandSparkles size={21} />,
                      onClick: () => void requestPromptRefinement([]),
                    },
                  ]
            }
            submitLabel={isGenerating ? "Generating" : "Generate"}
            submitIcon={<SubmitGlyph isGenerating={isGenerating} />}
          />
        </>
      )}
      <AnimatePresence>
        {gateDialog ? (
          <GateDialogModal
            dialog={gateDialog}
            onCancel={() => resolveGateDialog(false)}
            onConfirm={() => resolveGateDialog(true)}
          />
        ) : null}
      </AnimatePresence>
      </main>
    </FloatingTooltip.Provider>
  );
}
