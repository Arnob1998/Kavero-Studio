import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Trash2,
  Copy,
  Upload,
  ChevronDown,
  BringToFront,
  SendToBack,
  BringToFront as BringForward,
  SendToBack as SendBackward,
  Plus,
  X,
  Layers,
  Sun,
  Droplets,
  RotateCw,
  Crop,
} from "lucide-react";
import * as fabric from "fabric";
import type { BackgroundImageFit } from "@/modules/canvas/state/context";
import { useEditor } from "@/modules/canvas/state/context";
import { gradientCss, defaultGradientConfig, type GradientConfig } from "@/modules/canvas/utils/gradient-utils";
import { uploadCanvasAsset } from "@/modules/assets/canvas-assets";
import { BLEND_MODES, type BlendMode } from "@/modules/canvas/actions/canvas-tool-registry";
import { normalizeRotationDegrees, roundSignedRotationDegrees } from "@/modules/canvas/utils/rotation";

const FONT_FAMILIES = [
  "Inter",
  "Playfair Display",
  "Montserrat",
  "Poppins",
  "Roboto",
  "Open Sans",
  "Lora",
  "Raleway",
  "Source Sans Pro",
  "Merriweather",
];

const colorInputClass =
  "appearance-none cursor-pointer bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0.5 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0";

const rangeInputClass =
  "kavero-range h-4 w-full cursor-pointer appearance-none bg-transparent accent-accent";

const panelClass =
  "w-[300px] shrink-0 border-l border-white/[0.08] bg-black/48 text-white shadow-[0_24px_90px_rgb(0_0_0_/_0.34),inset_1px_0_0_rgb(255_255_255_/_0.04)] backdrop-blur-2xl";

const inputClass =
  "w-full rounded-xl border border-white/[0.1] bg-white/[0.045] px-3 py-2 text-xs font-semibold text-white outline-none transition focus:border-accent/60";

const iconButtonClass =
  "grid h-8 w-8 place-items-center rounded-lg text-white/46 transition hover:bg-white/[0.08] hover:text-white";

const sectionClass = "border-b border-white/[0.08] last:border-b-0";


const BG_COLORS = [
  "#1a1a2e", "#0f172a", "#18181b", "#1e1b4b",
  "#ffffff", "#f8fafc", "#fafaf9", "#fef3c7",
  "#2563eb", "#7c3aed", "#dc2626", "#059669",
  "#0891b2", "#d97706", "#e11d48", "#2563EB",
];

const transparentBackground = "rgba(0,0,0,0)";

const GRADIENT_PRESETS: GradientConfig[] = [
  { type: "linear", angle: 135, colors: ["#667eea", "#764ba2"], stops: [0, 100], opacity: 1 },
  { type: "linear", angle: 135, colors: ["#f093fb", "#f5576c"], stops: [0, 100], opacity: 1 },
  { type: "linear", angle: 135, colors: ["#4facfe", "#00f2fe"], stops: [0, 100], opacity: 1 },
  { type: "linear", angle: 135, colors: ["#43e97b", "#38f9d7"], stops: [0, 100], opacity: 1 },
  { type: "linear", angle: 135, colors: ["#fa709a", "#fee140"], stops: [0, 100], opacity: 1 },
  { type: "linear", angle: 135, colors: ["#a18cd1", "#fbc2eb"], stops: [0, 100], opacity: 1 },
  { type: "linear", angle: 135, colors: ["#f7797d", "#FBD786", "#C6FFDD"], stops: [0, 50, 100], opacity: 1 },
  { type: "linear", angle: 225, colors: ["#0f0c29", "#302b63", "#24243e"], stops: [0, 50, 100], opacity: 1 },
  { type: "radial", angle: 0, colors: ["#a18cd1", "#fbc2eb"], stops: [0, 100], opacity: 1 },
];

const BACKGROUND_IMAGE_FITS: { value: BackgroundImageFit; label: string; hint: string }[] = [
  { value: "cover", label: "Fill", hint: "Crop edges" },
  { value: "contain", label: "Fit", hint: "No crop" },
  { value: "stretch", label: "Stretch", hint: "Force size" },
  { value: "overflow", label: "Overflow", hint: "Center crop" },
];

type CanvasFlipMode = "none" | "horizontal" | "vertical" | "both";
type PerspectivePreset = { label: string; hint: string; skewX: number; skewY: number };

const FLIP_MODES: { mode: CanvasFlipMode; label: string; hint: string }[] = [
  { mode: "none", label: "Normal", hint: "Original" },
  { mode: "horizontal", label: "Horizontal", hint: "Mirror X" },
  { mode: "vertical", label: "Vertical", hint: "Mirror Y" },
  { mode: "both", label: "Both", hint: "Mirror X/Y" },
];

function flipModeForObject(object: fabric.FabricObject): CanvasFlipMode {
  if (object.flipX && object.flipY) return "both";
  if (object.flipX) return "horizontal";
  if (object.flipY) return "vertical";
  return "none";
}

function flipStateForMode(mode: CanvasFlipMode) {
  return {
    flipX: mode === "horizontal" || mode === "both",
    flipY: mode === "vertical" || mode === "both",
  };
}

const PERSPECTIVE_PRESETS: PerspectivePreset[] = [
  { label: "Flat", hint: "No skew", skewX: 0, skewY: 0 },
  { label: "Right", hint: "Side depth", skewX: 16, skewY: 0 },
  { label: "Left", hint: "Side depth", skewX: -16, skewY: 0 },
  { label: "Top", hint: "Vertical tilt", skewX: 0, skewY: -14 },
  { label: "Bottom", hint: "Vertical tilt", skewX: 0, skewY: 14 },
  { label: "Poster", hint: "Angled face", skewX: 12, skewY: -8 },
];

function clampPerspectiveSkew(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(60, Math.max(-60, value));
}

export function RightSidebar() {
  const {
    selectedObject,
    updateSelectedObject,
    deleteSelected,
    canvas,
    setBackground,
    canvasWidth,
    canvasHeight,
    setCanvasSize,
    arrangeSelected,
    getSelectedLayerInfo,
    backgroundImageFit,
    setBackgroundImageFit,
    executeCanvasTool,
    setImageBorderRadius,
    resetImageCrop,
    getImageCropInfo,
    startImageCropMode,
  } =
    useEditor();
  const [draftCanvasWidth, setDraftCanvasWidth] = useState(String(canvasWidth));
  const [draftCanvasHeight, setDraftCanvasHeight] = useState(String(canvasHeight));
  const [textFillMode, setTextFillMode] = useState<"solid" | "gradient">("solid");
  const [shapeFillMode, setShapeFillMode] = useState<"solid" | "gradient">("solid");
  const [textGradient, setTextGradient] = useState<GradientConfig>(defaultGradientConfig());
  const [shapeGradient, setShapeGradient] = useState<GradientConfig>(defaultGradientConfig());
  const [backgroundFillMode, setBackgroundFillMode] = useState<"solid" | "gradient">("solid");
  const [backgroundGradient, setBackgroundGradient] = useState<GradientConfig>(defaultGradientConfig());
  const [uploadingBackground, setUploadingBackground] = useState(false);
  const [canvasLocked, setCanvasLocked] = useState(false);

  const isText = selectedObject instanceof fabric.Textbox || selectedObject instanceof fabric.IText;
  const isImage = selectedObject instanceof fabric.FabricImage;
  const isShape = selectedObject && !isText && !isImage;
  const selectedObjectId = selectedObject ? String((selectedObject as any).kaveroId ?? "") : "";
  const imageCropInfo = isImage && selectedObjectId ? getImageCropInfo(selectedObjectId) : null;
  const layerInfo = selectedObject ? getSelectedLayerInfo() : null;
  const panelKind = !selectedObject ? "canvas" : isText ? "text" : isImage ? "image" : "shape";
  const [sectionsExpanded, setSectionsExpanded] = useState<Record<string, boolean>>({
    canvas: true,
    text: true,
    image: true,
    shape: true,
  });
  const sectionExpanded = sectionsExpanded[panelKind] ?? true;
  const toggleAllSections = () => {
    setSectionsExpanded((current) => ({ ...current, [panelKind]: !sectionExpanded }));
  };
  const canvasBackground =
    typeof canvas?.backgroundColor === "string" && canvas.backgroundColor.trim()
      ? canvas.backgroundColor
      : "#000000";
  const isTransparentBackground =
    canvasBackground === "transparent" ||
    canvasBackground === transparentBackground ||
    canvasBackground === "rgba(0, 0, 0, 0)";
  const canvasBackgroundColor = /^#[0-9a-f]{6}$/i.test(canvasBackground)
    ? canvasBackground
    : "#000000";
  const hasBackgroundImage = Boolean(
    canvas
      ?.getObjects()
      .some(
        (object) =>
          (object as any)._isBgImage ||
          (object as any).kaveroKind === "background-image" ||
          Boolean((object as any).kaveroBgSrc),
      ),
  );
  const rotationAngle = selectedObject ? roundSignedRotationDegrees(selectedObject.angle) : 0;
  const flipMode = selectedObject ? flipModeForObject(selectedObject) : "none";
  const perspectiveX = selectedObject ? Math.round(selectedObject.skewX ?? 0) : 0;
  const perspectiveY = selectedObject ? Math.round(selectedObject.skewY ?? 0) : 0;

  useEffect(() => {
    setDraftCanvasWidth(String(canvasWidth));
    setDraftCanvasHeight(String(canvasHeight));
  }, [canvasWidth, canvasHeight]);

  useEffect(() => {
    const handleLock = (event: Event) => {
      setCanvasLocked(Boolean((event as CustomEvent<{ locked?: boolean }>).detail?.locked));
    };
    window.addEventListener("kavero:canvas-lock", handleLock);
    return () => window.removeEventListener("kavero:canvas-lock", handleLock);
  }, []);

  const applyCanvasSize = () => {
    const width = Number.parseInt(draftCanvasWidth, 10);
    const height = Number.parseInt(draftCanvasHeight, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const safeWidth = Math.min(Math.max(width, 100), 8000);
    const safeHeight = Math.min(Math.max(height, 100), 8000);
    setCanvasSize(safeWidth, safeHeight);
  };

  const handleBackgroundUpload = async (files: FileList | null) => {
    if (!files?.[0]) return;
    setUploadingBackground(true);
    try {
      const asset = await uploadCanvasAsset(files[0]);
      window.dispatchEvent(new CustomEvent("kavero:canvas-asset-uploaded", { detail: asset }));
      setBackground("image", asset.public_url, { fit: backgroundImageFit });
    } catch (error) {
      console.error("Background upload failed:", error);
    } finally {
      setUploadingBackground(false);
    }
  };

  if (!selectedObject) {
    return (
      <aside className={`${panelClass} relative flex min-h-0 flex-col`}>
        {canvasLocked ? <SidebarLockOverlay /> : null}
        <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
          <h2 className="text-xs font-black uppercase tracking-[0.08em] text-white/56">Canvas</h2>
          <button
            className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white/38 transition hover:bg-white/[0.08] hover:text-white/68"
            onClick={toggleAllSections}
          >
            {sectionExpanded ? "Collapse" : "Expand"}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgb(255_255_255_/_0.28)_transparent]">
          <PropertySection title="Size" expanded={sectionExpanded}>
            <div className="grid gap-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-white/42">Dimensions</span>
                <span className="font-mono text-[11px] text-white/56">{canvasWidth} x {canvasHeight}</span>
              </div>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={draftCanvasWidth}
                  onChange={(event) => setDraftCanvasWidth(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyCanvasSize();
                  }}
                  aria-label="Canvas width"
                />
                <span className="text-[11px] font-bold text-white/32">x</span>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  value={draftCanvasHeight}
                  onChange={(event) => setDraftCanvasHeight(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyCanvasSize();
                  }}
                  aria-label="Canvas height"
                />
              </div>
              <button
                className="h-9 rounded-xl bg-accent px-3 text-[11px] font-bold text-white transition hover:bg-accent-hover"
                onClick={applyCanvasSize}
              >
                Apply size
              </button>
            </div>
          </PropertySection>

          <PropertySection title="Background" expanded={sectionExpanded}>
            <div className="grid gap-3">
              <FillControls
                label="Background"
                mode={backgroundFillMode}
                setMode={setBackgroundFillMode}
                solidValue={canvasBackgroundColor}
                gradient={backgroundGradient}
                setGradient={setBackgroundGradient}
                onSolidChange={(value) => setBackground("color", value)}
                onGradientChange={(value) => setBackground("gradient", JSON.stringify(value))}
              />
              <button
                className={`grid h-10 grid-cols-[40px_minmax(0,1fr)] items-center gap-2 rounded-xl border px-2 text-left transition ${
                  isTransparentBackground
                    ? "border-accent/60 bg-accent/14"
                    : "border-white/[0.08] bg-white/[0.035] hover:border-white/[0.16] hover:bg-white/[0.06]"
                }`}
                onClick={() => {
                  setBackgroundFillMode("solid");
                  setBackground("color", transparentBackground);
                }}
              >
                <span className="h-6 rounded-md border border-white/[0.14] bg-[linear-gradient(45deg,rgb(255_255_255_/_0.18)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.18)_75%),linear-gradient(45deg,rgb(255_255_255_/_0.18)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.18)_75%)] bg-[length:10px_10px] bg-[position:0_0,5px_5px]" />
                <span className="text-[12px] font-semibold text-white/64">Transparent</span>
              </button>
              {backgroundFillMode === "solid" ? (
                <div className="grid grid-cols-4 gap-1.5">
                  {BG_COLORS.map((color) => (
                    <button
                      key={color}
                      className="aspect-square rounded-lg border border-white/[0.14] transition hover:scale-105 hover:border-accent"
                      style={{ background: color }}
                      onClick={() => setBackground("color", color)}
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {GRADIENT_PRESETS.map((preset, index) => (
                    <button
                      key={index}
                      className="aspect-square rounded-lg border border-white/[0.14] transition hover:scale-105 hover:border-accent"
                      style={{ background: gradientCss(preset) }}
                      onClick={() => {
                        setBackgroundGradient(preset);
                        setBackground("gradient", JSON.stringify(preset));
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </PropertySection>

          <PropertySection title="Background Image" expanded={sectionExpanded}>
            <div className="grid gap-3">
              <label className="grid gap-2">
                <span className="relative">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="absolute inset-0 cursor-pointer opacity-0"
                    onChange={(event) => void handleBackgroundUpload((event.target as HTMLInputElement).files)}
                  />
                  <span className="flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.045] text-xs font-semibold text-white/52 transition hover:border-accent/45 hover:bg-accent/10 hover:text-white">
                    <Upload size={14} />
                    {uploadingBackground ? "Uploading..." : hasBackgroundImage ? "Replace image" : "Upload image"}
                  </span>
                </span>
              </label>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-white/42">Image fit</span>
                  <span className="text-[10px] font-semibold text-white/28">
                    {hasBackgroundImage ? "Active" : "Upload first"}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {BACKGROUND_IMAGE_FITS.map((option) => (
                    <button
                      key={option.value}
                      className={`rounded-xl border p-2 text-left transition disabled:pointer-events-none disabled:opacity-40 ${
                        backgroundImageFit === option.value
                          ? "border-accent/65 bg-accent/16 text-white"
                          : "border-white/[0.08] bg-white/[0.035] text-white/56 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white"
                      }`}
                      disabled={!hasBackgroundImage}
                      onClick={() => setBackgroundImageFit(option.value)}
                    >
                      <span className="block text-[11px] font-bold">{option.label}</span>
                      <span className="mt-0.5 block text-[10px] font-semibold text-white/34">{option.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
              <button
                className="flex h-9 items-center justify-center gap-2 rounded-xl border border-red-300/12 bg-red-500/10 text-xs font-bold text-red-50/70 transition hover:border-red-200/24 hover:bg-red-500/16 hover:text-red-50 disabled:pointer-events-none disabled:opacity-35"
                disabled={!hasBackgroundImage}
                onClick={() => {
                  void executeCanvasTool("remove_background_image", { mode: "delete" });
                }}
              >
                <Trash2 size={14} />
                Remove image
              </button>
            </div>
          </PropertySection>
        </div>
      </aside>
    );
  }

  return (
    <aside className={`${panelClass} relative flex min-h-0 flex-col`}>
      {canvasLocked ? <SidebarLockOverlay /> : null}
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
        <h2 className="text-xs font-black uppercase tracking-[0.08em] text-white/56">
          {isText ? "Text" : isImage ? "Image" : "Shape"}
        </h2>
        <div className="flex gap-1">
          <button
            className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-white/38 transition hover:bg-white/[0.08] hover:text-white/68"
            onClick={toggleAllSections}
          >
            {sectionExpanded ? "Collapse" : "Expand"}
          </button>
          <button
            className={iconButtonClass}
            onClick={async () => {
              if (!canvas || !selectedObject) return;
              const clone = await selectedObject.clone();
              clone.set({ left: (selectedObject.left || 0) + 20, top: (selectedObject.top || 0) + 20 });
              canvas.add(clone);
              canvas.setActiveObject(clone);
              canvas.requestRenderAll();
            }}
            title="Duplicate"
          >
            <Copy size={14} />
          </button>
          <button
            className="grid h-8 w-8 place-items-center rounded-lg text-white/46 transition hover:bg-red-500/16 hover:text-red-100"
            onClick={deleteSelected}
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:rgb(255_255_255_/_0.28)_transparent]">
        {/* ── Text properties ───────────────────────────────────────── */}
        {isText && (
          <>
            <PropertySection title="Typography" expanded={sectionExpanded}>
              <div className="grid gap-4">
            {/* Font family */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/42">Font family</label>
              <select
                className={`${inputClass} cursor-pointer`}
                value={(selectedObject as any).fontFamily || "Inter"}
                onChange={(e) =>
                  updateSelectedObject({ fontFamily: (e.target as HTMLSelectElement).value })
                }
              >
                {FONT_FAMILIES.map((f) => (
                  <option key={f} value={f} style={{ fontFamily: f }}>
                    {f}
                  </option>
                ))}
              </select>
            </div>

            {/* Font size */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/42">Font size</label>
              <input
                type="number"
                className={inputClass}
                value={(selectedObject as any).fontSize || 18}
                onInput={(e) =>
                  updateSelectedObject({
                    fontSize: parseInt((e.target as HTMLInputElement).value) || 18,
                  })
                }
              />
            </div>

            {/* Bold / Italic / Underline */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/42">Style</label>
              <div className="flex gap-1">
                <button
                  className={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).fontWeight === "700" || (selectedObject as any).fontWeight === "bold"
                      ? "border-accent/60 bg-accent/20 text-accent"
                      : "border-white/[0.1] bg-white/[0.035] text-white/50 hover:text-white"
                  }`}
                  onClick={() =>
                    updateSelectedObject({
                      fontWeight:
                        (selectedObject as any).fontWeight === "700" || (selectedObject as any).fontWeight === "bold"
                          ? "400"
                          : "700",
                    })
                  }
                >
                  <Bold size={14} />
                </button>
                <button
                  className={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).fontStyle === "italic"
                      ? "border-accent/60 bg-accent/20 text-accent"
                      : "border-white/[0.1] bg-white/[0.035] text-white/50 hover:text-white"
                  }`}
                  onClick={() =>
                    updateSelectedObject({
                      fontStyle: (selectedObject as any).fontStyle === "italic" ? "normal" : "italic",
                    })
                  }
                >
                  <Italic size={14} />
                </button>
                <button
                  className={`p-1.5 rounded-md border cursor-pointer transition-all ${
                    (selectedObject as any).underline
                      ? "border-accent/60 bg-accent/20 text-accent"
                      : "border-white/[0.1] bg-white/[0.035] text-white/50 hover:text-white"
                  }`}
                  onClick={() =>
                    updateSelectedObject({ underline: !(selectedObject as any).underline })
                  }
                >
                  <Underline size={14} />
                </button>
              </div>
            </div>

            {/* Text alignment */}
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/42">Alignment</label>
              <div className="flex gap-1">
                {[
                  { align: "left", icon: AlignLeft },
                  { align: "center", icon: AlignCenter },
                  { align: "right", icon: AlignRight },
                ].map(({ align, icon: Icon }) => (
                  <button
                    key={align}
                    className={`p-1.5 rounded-md border cursor-pointer transition-all ${
                      (selectedObject as any).textAlign === align
                        ? "border-accent/60 bg-accent/20 text-accent"
                        : "border-white/[0.1] bg-white/[0.035] text-white/50 hover:text-white"
                    }`}
                    onClick={() => updateSelectedObject({ textAlign: align })}
                  >
                    <Icon size={14} />
                  </button>
                ))}
              </div>
            </div>
              </div>
            </PropertySection>

            {/* Text color */}
            <PropertySection title="Fill" expanded={sectionExpanded}>
            <FillControls
              label="Fill"
              mode={textFillMode}
              setMode={setTextFillMode}
              solidValue={typeof (selectedObject as any).fill === "string" ? ((selectedObject as any).fill as string) : "#ffffff"}
              gradient={textGradient}
              setGradient={setTextGradient}
              onSolidChange={(value) => updateSelectedObject({ fill: value })}
              onGradientChange={(value) => updateSelectedObject({ fill: JSON.stringify(value) })}
            />
            </PropertySection>

            {/* Line height */}
            <PropertySection title="Spacing" expanded={sectionExpanded}>
              <div className="grid gap-4">
            <div>
              <label className="mb-1 flex justify-between text-[11px] font-semibold text-white/42">
                Line height
                <span className="font-mono text-white/56">{((selectedObject as any).lineHeight || 1.2).toFixed(1)}</span>
              </label>
              <input
                type="range"
                min="0.8"
                max="3"
                step="0.1"
                className={rangeInputClass}
                value={(selectedObject as any).lineHeight || 1.2}
                onInput={(e) =>
                  updateSelectedObject({
                    lineHeight: parseFloat((e.target as HTMLInputElement).value),
                  })
                }
              />
            </div>

            {/* Letter spacing */}
            <div>
              <label className="mb-1 flex justify-between text-[11px] font-semibold text-white/42">
                Letter spacing
                <span className="font-mono text-white/56">{(selectedObject as any).charSpacing || 0}</span>
              </label>
              <input
                type="range"
                min="-200"
                max="800"
                step="10"
                className={rangeInputClass}
                value={(selectedObject as any).charSpacing || 0}
                onInput={(e) =>
                  updateSelectedObject({
                    charSpacing: parseInt((e.target as HTMLInputElement).value),
                  })
                }
              />
            </div>
              </div>
            </PropertySection>
          </>
        )}

        {/* ── Shape properties ──────────────────────────────────────── */}
        {isShape && (
          <>
            {/* Fill color */}
            <PropertySection title="Fill" expanded={sectionExpanded}>
            <FillControls
              label="Fill"
              mode={shapeFillMode}
              setMode={setShapeFillMode}
              solidValue={typeof selectedObject.fill === "string" ? selectedObject.fill : "#3B82F6"}
              gradient={shapeGradient}
              setGradient={setShapeGradient}
              onSolidChange={(value) => updateSelectedObject({ fill: value })}
              onGradientChange={(value) => updateSelectedObject({ fill: JSON.stringify(value) })}
            />
            </PropertySection>

            {/* Stroke */}
            <PropertySection title="Stroke" expanded={sectionExpanded}>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-white/42">Stroke color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className={`${colorInputClass} h-9 w-9 shrink-0 rounded-xl border border-white/[0.1] bg-white/[0.045]`}
                  value={(selectedObject.stroke as string) || "#000000"}
                  onInput={(e) =>
                    updateSelectedObject({ stroke: (e.target as HTMLInputElement).value })
                  }
                />
                <input
                  type="number"
                  className="w-16 rounded-xl border border-white/[0.1] bg-white/[0.045] px-2 py-2 text-xs font-semibold text-white outline-none transition focus:border-accent/60"
                  value={selectedObject.strokeWidth || 0}
                  min={0}
                  placeholder="Width"
                  onInput={(e) =>
                    updateSelectedObject({
                      strokeWidth: parseInt((e.target as HTMLInputElement).value) || 0,
                    })
                  }
                />
              </div>
            </div>
            </PropertySection>

            {/* Border radius (for rect) */}
            {selectedObject instanceof fabric.Rect && (
              <PropertySection title="Corners" expanded={sectionExpanded}>
              <div>
                <label className="mb-1 flex justify-between text-[11px] font-semibold text-white/42">
                  Border radius
                  <span className="font-mono text-white/56">{(selectedObject as any).rx || 0}px</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  className={rangeInputClass}
                  value={(selectedObject as any).rx || 0}
                  onInput={(e) => {
                    const val = parseInt((e.target as HTMLInputElement).value);
                    updateSelectedObject({ rx: val, ry: val });
                  }}
                />
              </div>
              </PropertySection>
            )}
          </>
        )}

        {/* ── Image properties ──────────────────────────────────────── */}
        {/* ── Common: Opacity ───────────────────────────────────────── */}
        <PropertySection title="Transform" expanded={sectionExpanded}>
          <div className="grid gap-3">
            <label className="flex items-center justify-between text-[11px] font-semibold text-white/42">
              <span className="flex items-center gap-1.5">
                <RotateCw size={13} className="text-white/38" />
                Rotation
              </span>
              <span className="font-mono text-white/56">{rotationAngle}&deg;</span>
            </label>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              className={rangeInputClass}
              value={rotationAngle}
              onInput={(event) => updateSelectedObject({ angle: normalizeRotationDegrees(Number((event.target as HTMLInputElement).value)) })}
            />
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                type="number"
                min="-180"
                max="180"
                className={inputClass}
                value={rotationAngle}
                onInput={(event) => {
                  const value = Number((event.target as HTMLInputElement).value);
                  if (Number.isFinite(value)) updateSelectedObject({ angle: normalizeRotationDegrees(value) });
                }}
                aria-label="Rotation degrees"
              />
              <button
                className="h-9 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[11px] font-bold text-white/52 transition hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white"
                onClick={() => updateSelectedObject({ angle: 0 })}
              >
                Reset
              </button>
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/42">
                <span>Flip</span>
                <span className="capitalize text-white/56">{flipMode}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {FLIP_MODES.map((option) => (
                  <FlipModeButton
                    key={option.mode}
                    mode={option.mode}
                    label={option.label}
                    hint={option.hint}
                    active={flipMode === option.mode}
                    onClick={() => updateSelectedObject(flipStateForMode(option.mode))}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-3">
              <div className="flex items-center justify-between text-[11px] font-semibold text-white/42">
                <span>Perspective</span>
                <span className="font-mono text-white/56">X {perspectiveX}&deg; / Y {perspectiveY}&deg;</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {PERSPECTIVE_PRESETS.map((preset) => (
                  <PerspectivePresetButton
                    key={`${preset.label}-${preset.skewX}-${preset.skewY}`}
                    preset={preset}
                    active={perspectiveX === preset.skewX && perspectiveY === preset.skewY}
                    onClick={() => updateSelectedObject({ skewX: preset.skewX, skewY: preset.skewY })}
                  />
                ))}
              </div>
              {([
                ["skewX", "X", perspectiveX],
                ["skewY", "Y", perspectiveY],
              ] as const).map(([key, label, value]) => (
                <div key={key} className="grid grid-cols-[18px_1fr_58px] items-center gap-2">
                  <span className="text-[10px] font-bold text-white/38">{label}</span>
                  <input
                    type="range"
                    min="-60"
                    max="60"
                    step="1"
                    className={rangeInputClass}
                    value={value}
                    onInput={(event) => updateSelectedObject({ [key]: clampPerspectiveSkew(Number((event.target as HTMLInputElement).value)) })}
                  />
                  <input
                    type="number"
                    min="-60"
                    max="60"
                    className={`${inputClass} px-2 py-1 text-[10px]`}
                    value={value}
                    onInput={(event) => updateSelectedObject({ [key]: clampPerspectiveSkew(Number((event.target as HTMLInputElement).value)) })}
                    aria-label={`Perspective ${label}`}
                  />
                </div>
              ))}
            </div>
          </div>
        </PropertySection>

        {isImage && imageCropInfo ? (
          <PropertySection title="Crop" expanded={sectionExpanded}>
            <div className="grid gap-3">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[12px] font-bold text-white/72 transition hover:border-accent/45 hover:bg-accent/12 hover:text-white"
                onClick={startImageCropMode}
                title="Open crop editor"
              >
                <Crop size={14} />
                Open crop editor
              </button>
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2">
                <div className="flex items-center justify-between text-[11px] font-semibold text-white/42">
                  <span>Source crop</span>
                  <span className="font-mono text-white/56">
                    {imageCropInfo.currentCrop.width} x {imageCropInfo.currentCrop.height}
                  </span>
                </div>
                <div className="mt-1 font-mono text-[10px] font-semibold text-white/34">
                  x {imageCropInfo.currentCrop.x}, y {imageCropInfo.currentCrop.y}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="h-9 rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 text-[11px] font-bold text-white/52 transition hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white"
                  onClick={() => resetImageCrop(selectedObjectId)}
                >
                  Reset crop
                </button>
              </div>
              <div className="text-[10px] font-semibold leading-4 text-white/34">
                Double-click an image to open crop. Ctrl/Cmd+drag edges crops directly.
              </div>
            </div>
          </PropertySection>
        ) : null}

        {layerInfo ? (
          <PropertySection title="Layer" expanded={sectionExpanded}>
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.035] px-3 py-2">
                <span className="text-[11px] font-semibold text-white/42">Level</span>
                <span className="font-mono text-[12px] font-bold text-white/68">
                  {layerInfo.level} / {layerInfo.max}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <LayerButton
                  icon={BringToFront}
                  label="To front"
                  disabled={layerInfo.level >= layerInfo.max}
                  onClick={() => arrangeSelected("front")}
                />
                <LayerButton
                  icon={BringForward}
                  label="Forward"
                  disabled={layerInfo.level >= layerInfo.max}
                  onClick={() => arrangeSelected("forward")}
                />
                <LayerButton
                  icon={SendBackward}
                  label="Backward"
                  disabled={layerInfo.level <= layerInfo.min}
                  onClick={() => arrangeSelected("backward")}
                />
                <LayerButton
                  icon={SendToBack}
                  label="To back"
                  disabled={layerInfo.level <= layerInfo.min}
                  onClick={() => arrangeSelected("back")}
                />
              </div>
            </div>
          </PropertySection>
        ) : null}

        <PropertySection title="Appearance" expanded={sectionExpanded}>
          <div className="grid gap-4">
            {isImage ? (
              <div>
                <label className="mb-1 flex justify-between text-[11px] font-semibold text-white/42">
                  Border radius
                  <span className="font-mono text-white/56">{Math.round(Number((selectedObject as any).kaveroBorderRadius ?? 0))}px</span>
                </label>
                <div className="grid grid-cols-[1fr_72px] items-center gap-2">
                  <input
                    type="range"
                    min="0"
                    max={Math.max(0, Math.round(Math.min(Number(selectedObject.width ?? 1), Number(selectedObject.height ?? 1)) / 2))}
                    step="1"
                    className={rangeInputClass}
                    value={Number((selectedObject as any).kaveroBorderRadius ?? 0)}
                    onInput={(event) => {
                      if (selectedObjectId) setImageBorderRadius(selectedObjectId, Number((event.target as HTMLInputElement).value));
                    }}
                  />
                  <input
                    type="number"
                    min="0"
                    max={Math.max(0, Math.round(Math.min(Number(selectedObject.width ?? 1), Number(selectedObject.height ?? 1)) / 2))}
                    step="1"
                    className="h-8 rounded-lg border border-white/10 bg-white/[0.05] px-2 text-right text-xs font-semibold text-white outline-none focus:border-blue-400/60"
                    value={Math.round(Number((selectedObject as any).kaveroBorderRadius ?? 0))}
                    onChange={(event) => {
                      if (selectedObjectId) setImageBorderRadius(selectedObjectId, Number((event.target as HTMLInputElement).value));
                    }}
                  />
                </div>
              </div>
            ) : null}
            <div>
            <label className="mb-1 flex justify-between text-[11px] font-semibold text-white/42">
              Opacity
              <span className="font-mono text-white/56">{Math.round((selectedObject.opacity ?? 1) * 100)}%</span>
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              className={rangeInputClass}
              value={selectedObject.opacity ?? 1}
              onInput={(e) =>
                updateSelectedObject({ opacity: parseFloat((e.target as HTMLInputElement).value) })
              }
            />
            </div>
          </div>
        </PropertySection>

        <PropertySection title="Effects" expanded={sectionExpanded}>
          <EffectsControls
            selectedObject={selectedObject}
            onShadowChange={(shadow) => {
              const id = String((selectedObject as any).kaveroId ?? "");
              if (id) void executeCanvasTool("set_object_shadow", { objectId: id, shadow });
            }}
            onBlurChange={(blur) => {
              const id = String((selectedObject as any).kaveroId ?? "");
              if (id) void executeCanvasTool("set_object_blur", { objectId: id, blur });
            }}
            onBlendModeChange={(blendMode) => {
              const id = String((selectedObject as any).kaveroId ?? "");
              if (id) void executeCanvasTool("set_object_blend_mode", { objectId: id, blendMode });
            }}
          />
        </PropertySection>
      </div>
    </aside>
  );
}

function FlipModeButton({
  mode,
  label,
  hint,
  active,
  onClick,
}: {
  mode: CanvasFlipMode;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  const transform =
    mode === "horizontal" ? "scaleX(-1)" :
    mode === "vertical" ? "scaleY(-1)" :
    mode === "both" ? "scale(-1, -1)" :
    "none";

  return (
    <button
      aria-pressed={active}
      className={`grid min-h-[78px] grid-cols-[42px_minmax(0,1fr)] items-center gap-2 rounded-xl border p-2 text-left transition ${
        active
          ? "border-accent/70 bg-accent/14 text-white shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.08)]"
          : "border-white/[0.08] bg-white/[0.035] text-white/58 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white"
      }`}
      onClick={onClick}
    >
      <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-lg border border-white/[0.1] bg-zinc-950">
        <span className="absolute left-1/2 top-1 h-8 border-l border-dashed border-white/16" />
        <span className="absolute left-1 top-1/2 w-8 border-t border-dashed border-white/16" />
        <span
          className="relative grid h-7 w-7 place-items-center rounded-md bg-white/[0.09] text-[15px] font-black leading-none text-accent"
          style={{ transform }}
        >
          F
        </span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-bold leading-tight">
          {label}
        </span>
        <span className="mt-1 block truncate text-[10px] font-semibold leading-tight text-white/36">
          {hint}
        </span>
      </span>
    </button>
  );
}

function PerspectivePresetButton({
  preset,
  active,
  onClick,
}: {
  preset: PerspectivePreset;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-pressed={active}
      className={`grid min-h-[78px] grid-cols-[42px_minmax(0,1fr)] items-center gap-2 rounded-xl border p-2 text-left transition ${
        active
          ? "border-accent/70 bg-accent/14 text-white shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.08)]"
          : "border-white/[0.08] bg-white/[0.035] text-white/58 hover:border-white/[0.16] hover:bg-white/[0.06] hover:text-white"
      }`}
      onClick={onClick}
    >
      <span className="relative grid h-10 w-10 place-items-center overflow-hidden rounded-lg border border-white/[0.1] bg-zinc-950">
        <span className="absolute inset-x-2 top-2 border-t border-white/12" />
        <span className="absolute inset-x-2 bottom-2 border-t border-white/12" />
        <span className="absolute inset-y-2 left-2 border-l border-white/12" />
        <span className="absolute inset-y-2 right-2 border-l border-white/12" />
        <span
          className="relative h-7 w-7 rounded-md border border-accent/50 bg-accent/20 shadow-[inset_0_0_0_1px_rgb(255_255_255_/_0.08)]"
          style={{ transform: `skew(${preset.skewX}deg, ${preset.skewY}deg)` }}
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-bold leading-tight">{preset.label}</span>
        <span className="mt-1 block truncate text-[10px] font-semibold leading-tight text-white/36">{preset.hint}</span>
      </span>
    </button>
  );
}

function PropertySection({
  title,
  children,
  expanded,
}: {
  title: string;
  children: ReactNode;
  expanded: boolean;
}) {
  const [open, setOpen] = useState(expanded);

  useEffect(() => {
    setOpen(expanded);
  }, [expanded]);

  return (
    <section className={sectionClass}>
      <button
        className="flex h-11 w-full items-center justify-between px-4 text-left text-[11px] font-black uppercase tracking-[0.08em] text-white/42 transition hover:bg-white/[0.035] hover:text-white/64"
        onClick={() => setOpen((current) => !current)}
      >
        {title}
        <ChevronDown
          size={14}
          className={`transition-transform ${open ? "rotate-0" : "-rotate-90"}`}
        />
      </button>
      {open ? <div className="px-4 pb-4">{children}</div> : null}
    </section>
  );
}

function SidebarLockOverlay() {
  return (
    <div
      className="pointer-events-auto absolute inset-0 z-30 grid place-items-center bg-black/44 p-4 backdrop-blur-[1px]"
      onPointerDown={(event) => event.preventDefault()}
      onClick={(event) => event.preventDefault()}
      onDrop={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
    >
      <div className="rounded-2xl border border-amber-200/16 bg-black/76 px-3 py-2 text-center text-xs font-bold text-amber-50/76 shadow-[0_18px_60px_rgb(0_0_0_/_0.38)]">
        Copilot is editing. Properties are locked.
      </div>
    </div>
  );
}

function LayerButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: typeof BringToFront;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.035] px-2 text-[11px] font-bold text-white/58 transition hover:border-accent/45 hover:bg-accent/10 hover:text-white disabled:pointer-events-none disabled:opacity-35"
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}

function FillControls({
  label,
  mode,
  setMode,
  solidValue,
  gradient,
  setGradient,
  onSolidChange,
  onGradientChange,
}: {
  label: string;
  mode: "solid" | "gradient";
  setMode: (mode: "solid" | "gradient") => void;
  solidValue: string;
  gradient: GradientConfig;
  setGradient: (gradient: GradientConfig) => void;
  onSolidChange: (value: string) => void;
  onGradientChange: (value: GradientConfig) => void;
}) {
  const updateGradient = (next: Partial<GradientConfig>) => {
    const merged = { ...gradient, ...next };
    setGradient(merged);
    onGradientChange(merged);
  };

  return (
    <div className="grid gap-3">
      <label className="block text-[11px] font-semibold text-white/42">{label}</label>
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] p-1">
        {(["solid", "gradient"] as const).map((nextMode) => (
          <button
            key={nextMode}
            className={`h-8 rounded-lg text-[11px] font-bold capitalize transition ${
              mode === nextMode
                ? "bg-accent text-white"
                : "text-white/46 hover:bg-white/[0.06] hover:text-white"
            }`}
            onClick={() => {
              setMode(nextMode);
              if (nextMode === "solid") onSolidChange(solidValue);
              if (nextMode === "gradient") onGradientChange(gradient);
            }}
          >
            {nextMode}
          </button>
        ))}
      </div>

      {mode === "solid" ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            className={`${colorInputClass} h-9 w-9 shrink-0 rounded-xl border border-white/[0.1] bg-white/[0.045]`}
            value={/^#[0-9a-f]{6}$/i.test(solidValue) ? solidValue : "#ffffff"}
            onInput={(event) => onSolidChange((event.target as HTMLInputElement).value)}
          />
          <input
            type="text"
            className={`${inputClass} flex-1 font-mono`}
            value={solidValue}
            onInput={(event) => onSolidChange((event.target as HTMLInputElement).value)}
          />
        </div>
      ) : (
        <div className="grid gap-3">
          <div
            className="h-16 rounded-xl border border-white/[0.1]"
            style={{ background: gradientCss(gradient), opacity: gradient.opacity }}
          />
          <div className="grid grid-cols-2 gap-2">
            {(["linear", "radial"] as const).map((type) => (
              <button
                key={type}
                className={`h-9 rounded-xl border text-[11px] font-bold capitalize transition ${
                  gradient.type === type
                    ? "border-accent/60 bg-accent/20 text-white"
                    : "border-white/[0.08] bg-white/[0.035] text-white/48 hover:text-white"
                }`}
                onClick={() => updateGradient({ type })}
              >
                {type}
              </button>
            ))}
          </div>
          {gradient.type === "linear" ? (
            <label className="grid gap-1">
              <span className="flex justify-between text-[11px] font-semibold text-white/42">
                Angle
                <span className="font-mono text-white/56">{gradient.angle}deg</span>
              </span>
              <input
                className="kavero-range"
                type="range"
                min="0"
                max="360"
                value={gradient.angle}
                onChange={(event) => updateGradient({ angle: Number((event.target as HTMLInputElement).value) })}
              />
            </label>
          ) : null}
          <div className="grid gap-2">
            {gradient.colors.map((color, index) => (
              <div key={index} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                <div className="grid grid-cols-[36px_1fr] items-center gap-2">
                  <input
                    type="color"
                    className="h-8 w-full rounded-lg border border-white/[0.12] bg-white/[0.045]"
                    value={color}
                    onChange={(event) => {
                      const colors = [...gradient.colors];
                      colors[index] = (event.target as HTMLInputElement).value;
                      updateGradient({ colors });
                    }}
                  />
                  <div className="grid gap-0.5">
                    <span className="text-[10px] font-semibold text-white/38">Stop {index + 1}</span>
                    <input
                      className="kavero-range"
                      type="range"
                      min="0"
                      max="100"
                      value={gradient.stops[index] ?? 0}
                      onChange={(event) => {
                        const stops = [...gradient.stops];
                        stops[index] = Number((event.target as HTMLInputElement).value);
                        const sorted = stops
                          .map((s, i) => ({ s, i }))
                          .sort((a, b) => a.s - b.s);
                        updateGradient({
                          stops: sorted.map((x) => x.s),
                          colors: sorted.map((x) => gradient.colors[x.i]),
                        });
                      }}
                    />
                  </div>
                </div>
                <span className="font-mono text-[10px] text-white/38 w-7 text-right">{gradient.stops[index] ?? 0}%</span>
                {gradient.colors.length > 2 ? (
                  <button
                    className="grid h-6 w-6 place-items-center rounded-md text-white/30 transition hover:bg-red-500/16 hover:text-red-300"
                    onClick={() => {
                      const colors = gradient.colors.filter((_, i) => i !== index);
                      const stops = gradient.stops.filter((_, i) => i !== index);
                      updateGradient({ colors, stops });
                    }}
                    title="Remove stop"
                  >
                    <X size={11} />
                  </button>
                ) : (
                  <span className="w-6" />
                )}
              </div>
            ))}
            {gradient.colors.length < 5 && (
              <button
                className="flex h-8 items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.14] text-[11px] font-semibold text-white/38 transition hover:border-accent/45 hover:text-accent"
                onClick={() => {
                  const lastStop = gradient.stops[gradient.stops.length - 1] ?? 100;
                  const prevStop = gradient.stops[gradient.stops.length - 2] ?? 0;
                  const newStop = Math.min(100, Math.round((lastStop + prevStop) / 2 + (lastStop - prevStop) / 2));
                  updateGradient({
                    colors: [...gradient.colors, "#ffffff"],
                    stops: [...gradient.stops, Math.min(100, newStop + 10)],
                  });
                }}
              >
                <Plus size={12} />
                Add color stop
              </button>
            )}
          </div>
          <label className="grid gap-1">
            <span className="flex justify-between text-[11px] font-semibold text-white/42">
              Opacity
              <span className="font-mono text-white/56">{Math.round(gradient.opacity * 100)}%</span>
            </span>
            <input
              className="kavero-range"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={gradient.opacity}
              onChange={(event) => updateGradient({ opacity: Number((event.target as HTMLInputElement).value) })}
            />
          </label>
        </div>
      )}
    </div>
  );
}

// ── Effects ──────────────────────────────────────────────────────────────────

interface ShadowValue {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

const SHADOW_PRESETS: { label: string; desc: string; css: string; previewCss: string; value: ShadowValue | null }[] = [
  { label: "None",     desc: "No shadow",           css: "none",                              previewCss: "none",                                    value: null },
  { label: "Subtle",   desc: "Barely lifted",        css: "0 2px 6px rgba(0,0,0,0.18)",       previewCss: "0 2px 5px rgba(0,0,0,0.35)",              value: { color: "rgba(0,0,0,0.18)",      blur: 6,  offsetX: 0, offsetY: 2  } },
  { label: "Drop",     desc: "Offset drop shadow",   css: "4px 8px 14px rgba(0,0,0,0.28)",    previewCss: "3px 4px 7px rgba(0,0,0,0.50)",            value: { color: "rgba(0,0,0,0.28)",      blur: 14, offsetX: 4, offsetY: 8  } },
  { label: "Elevated", desc: "Floating card feel",   css: "0 12px 28px rgba(0,0,0,0.38)",     previewCss: "0 6px 10px rgba(0,0,0,0.45)",             value: { color: "rgba(0,0,0,0.38)",      blur: 28, offsetX: 0, offsetY: 12 } },
  { label: "Dramatic", desc: "Strong depth",         css: "0 22px 50px rgba(0,0,0,0.60)",     previewCss: "0 8px 14px rgba(0,0,0,0.70)",             value: { color: "rgba(0,0,0,0.60)",      blur: 50, offsetX: 0, offsetY: 22 } },
  { label: "Glow",     desc: "Blue light bloom",     css: "0 0 22px rgba(59,130,246,0.70)",   previewCss: "0 0 10px 2px rgba(59,130,246,0.80)", value: { color: "rgba(59,130,246,0.70)", blur: 22, offsetX: 0, offsetY: 0  } },
];

const BLEND_MODE_META: Record<BlendMode, { label: string; hint: string }> = {
  "source-over": { label: "Normal",      hint: "Sits on top, no mixing"                    },
  multiply:      { label: "Multiply",    hint: "Multiplies colors — always darker"          },
  darken:        { label: "Darken",      hint: "Keeps the darkest pixel from both layers"   },
  "color-burn":  { label: "Color Burn",  hint: "Darkens base to reflect the blend layer"    },
  screen:        { label: "Screen",      hint: "Inverse of Multiply — always lighter"       },
  lighten:       { label: "Lighten",     hint: "Keeps the lightest pixel from both layers"  },
  "color-dodge": { label: "Color Dodge", hint: "Brightens base to reflect the blend layer"  },
  overlay:       { label: "Overlay",     hint: "Multiply where dark, Screen where light"    },
  "soft-light":  { label: "Soft Light",  hint: "Gentle contrast boost, like diffused light" },
  "hard-light":  { label: "Hard Light",  hint: "Strong contrast boost, like a spotlight"    },
  difference:    { label: "Difference",  hint: "Subtracts colors — similar colors → black"  },
  exclusion:     { label: "Exclusion",   hint: "Like Difference but lower contrast"         },
  hue:           { label: "Hue",         hint: "Keeps hue of blend, luma+sat of base"       },
  saturation:    { label: "Saturation",  hint: "Keeps saturation of blend, rest from base"  },
  color:         { label: "Color",       hint: "Keeps hue+sat of blend, luma of base"       },
  luminosity:    { label: "Luminosity",  hint: "Keeps brightness of blend, color of base"   },
};

const BLEND_MODE_GROUPS: { label: string; modes: BlendMode[] }[] = [
  { label: "Normal",     modes: ["source-over"] },
  { label: "Darken",     modes: ["multiply", "darken", "color-burn"] },
  { label: "Lighten",    modes: ["screen", "lighten", "color-dodge"] },
  { label: "Contrast",   modes: ["overlay", "soft-light", "hard-light"] },
  { label: "Inversion",  modes: ["difference", "exclusion"] },
  { label: "Component",  modes: ["hue", "saturation", "color", "luminosity"] },
];

function BlendPreview({ mode, size }: { mode: BlendMode; size: "sm" | "md" }) {
  const dim = size === "md" ? "h-8 w-10" : "h-6 w-8";
  return (
    <span className={`relative ${dim} shrink-0 overflow-hidden rounded-md`}>
      {/* Warm base layer — fixed, no blend mode */}
      <span className="absolute inset-0 bg-gradient-to-br from-amber-300 to-rose-500" />
      {/* Blend layer on top — this is what demonstrates the mode */}
      <span
        className="absolute inset-0 bg-blue-500"
        style={{ mixBlendMode: mode as any }}
      />
    </span>
  );
}

function EffectsControls({
  selectedObject,
  onShadowChange,
  onBlurChange,
  onBlendModeChange,
}: {
  selectedObject: fabric.FabricObject;
  onShadowChange: (shadow: ShadowValue | null) => void;
  onBlurChange: (blur: number) => void;
  onBlendModeChange: (blendMode: BlendMode) => void;
}) {
  const rawShadow = (selectedObject as any).shadow;
  const hasShadow = rawShadow != null && typeof rawShadow === "object";
  const currentShadow: ShadowValue | null = hasShadow
    ? {
        color:   typeof rawShadow.color   === "string" ? rawShadow.color   : "rgba(0,0,0,0.3)",
        blur:    typeof rawShadow.blur    === "number" ? rawShadow.blur    : 10,
        offsetX: typeof rawShadow.offsetX === "number" ? rawShadow.offsetX : 5,
        offsetY: typeof rawShadow.offsetY === "number" ? rawShadow.offsetY : 5,
      }
    : null;

  const rawFilters = (selectedObject as any).filters;
  const blurFilter = Array.isArray(rawFilters)
    ? rawFilters.find((f: any) => f?.type === "Blur" || f?.constructor?.name === "Blur")
    : null;
  const currentBlur: number = blurFilter
    ? (typeof blurFilter.blur === "number" ? blurFilter.blur : 0)
    : 0;

  const currentBlendMode: BlendMode =
    typeof (selectedObject as any).globalCompositeOperation === "string"
      ? ((selectedObject as any).globalCompositeOperation as BlendMode)
      : "source-over";

  const [customShadow, setCustomShadow] = useState<ShadowValue>(
    currentShadow ?? { color: "rgba(0,0,0,0.3)", blur: 10, offsetX: 5, offsetY: 5 },
  );

  const applyCustomShadow = (patch: Partial<ShadowValue>) => {
    const next = { ...customShadow, ...patch };
    setCustomShadow(next);
    onShadowChange(next);
  };

  return (
    <div className="grid gap-5">

      {/* ── Shadow ── */}
      <div className="grid gap-3">
        <span className="text-[11px] font-black uppercase tracking-[0.07em] text-white/46">Shadow</span>

        <div className="grid grid-cols-2 gap-1.5">
          {SHADOW_PRESETS.map((preset) => {
            const active = preset.value === null
              ? !hasShadow
              : hasShadow &&
                Math.round(currentShadow?.blur ?? 0)    === preset.value.blur &&
                Math.round(currentShadow?.offsetX ?? 0) === preset.value.offsetX &&
                Math.round(currentShadow?.offsetY ?? 0) === preset.value.offsetY;
            return (
              <button
                key={preset.label}
                className={`flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition ${
                  active
                    ? "border-accent/65 bg-accent/16"
                    : "border-white/[0.08] bg-white/[0.035] hover:border-white/[0.18] hover:bg-white/[0.06]"
                }`}
                onClick={() => {
                  if (preset.value) setCustomShadow(preset.value);
                  onShadowChange(preset.value);
                }}
              >
                {/* Overflow visible so shadow bleeds outside the white bg */}
                <span className="flex h-11 w-11 shrink-0 items-end justify-center rounded-lg bg-white pb-2" style={{ overflow: "visible" }}>
                  <span
                    className="h-5 w-5 rounded-md bg-violet-400"
                    style={{ boxShadow: preset.previewCss }}
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold text-white/70 leading-tight">{preset.label}</span>
                  <span className="block text-[10px] font-semibold text-white/36 leading-tight mt-0.5">{preset.desc}</span>
                </span>
              </button>
            );
          })}
        </div>

        {hasShadow && (
          <div className="grid gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.025] p-3">
            {/* Color + opacity */}
            <div className="grid grid-cols-[52px_1fr_auto] items-center gap-2">
              <span className="text-[10px] font-semibold text-white/38">Color</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className={`${colorInputClass} h-7 w-7 shrink-0 rounded-lg border border-white/[0.1] bg-white/[0.045]`}
                  value={rgbaToHex(customShadow.color)}
                  onChange={(e) => {
                    const hex = (e.target as HTMLInputElement).value;
                    applyCustomShadow({ color: hexToRgbaStr(hex, rgbaAlpha(customShadow.color)) });
                  }}
                />
                <input
                  type="range" min="0" max="1" step="0.01"
                  className={rangeInputClass}
                  value={rgbaAlpha(customShadow.color)}
                  onChange={(e) =>
                    applyCustomShadow({ color: hexToRgbaStr(rgbaToHex(customShadow.color), parseFloat((e.target as HTMLInputElement).value)) })
                  }
                />
              </div>
              <span className="font-mono text-[10px] text-white/38 w-7 text-right">
                {Math.round(rgbaAlpha(customShadow.color) * 100)}%
              </span>
            </div>

            {([ ["blur", "Blur", 0, 100], ["offsetX", "X", -100, 100], ["offsetY", "Y", -100, 100] ] as [keyof ShadowValue, string, number, number][]).map(
              ([key, label, min, max]) => (
                <div key={key} className="grid grid-cols-[52px_1fr_auto] items-center gap-2">
                  <span className="text-[10px] font-semibold text-white/38">{label}</span>
                  <input
                    type="range" min={min} max={max}
                    className={rangeInputClass}
                    value={customShadow[key] as number}
                    onChange={(e) => applyCustomShadow({ [key]: Number((e.target as HTMLInputElement).value) })}
                  />
                  <span className="font-mono text-[10px] text-white/38 w-10 text-right">
                    {customShadow[key]}px
                  </span>
                </div>
              )
            )}
          </div>
        )}
      </div>

      {/* ── Blur ── */}
      <div className="grid gap-3">
        <span className="text-[11px] font-black uppercase tracking-[0.07em] text-white/46">Blur</span>

        <div className="grid grid-cols-5 gap-1.5">
          {([0, 0.15, 0.3, 0.55, 0.8] as const).map((level) => {
            const active = Math.abs(currentBlur - level) < 0.08;
            return (
              <button
                key={level}
                className={`flex flex-col items-center gap-1.5 rounded-xl border p-2 transition ${
                  active
                    ? "border-accent/65 bg-accent/16"
                    : "border-white/[0.08] bg-white/[0.035] hover:border-white/[0.18]"
                }`}
                onClick={() => onBlurChange(level)}
                title={level === 0 ? "No blur" : `${Math.round(level * 100)}%`}
              >
                <span
                  className="h-5 w-5 rounded-full bg-white/80"
                  style={{ filter: level > 0 ? `blur(${level * 6}px)` : "none" }}
                />
                <span className="text-[9px] font-bold text-white/40">
                  {level === 0 ? "Off" : `${Math.round(level * 100)}%`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-[1fr_auto] items-center gap-3">
          <input
            type="range" min="0" max="1" step="0.01"
            className={rangeInputClass}
            value={currentBlur}
            onChange={(e) => onBlurChange(parseFloat((e.target as HTMLInputElement).value))}
          />
          <span className="font-mono text-[10px] text-white/38 w-9 text-right">
            {Math.round(currentBlur * 100)}%
          </span>
        </div>
      </div>

      {/* ── Blend mode ── */}
      <div className="grid gap-3">
        <span className="text-[11px] font-black uppercase tracking-[0.07em] text-white/46">Blend Mode</span>

        {/* Current mode summary */}
        <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.025] px-2.5 py-2">
          <BlendPreview mode={currentBlendMode} size="md" />
          <span className="min-w-0">
            <span className="block text-[11px] font-bold text-white/72">
              {BLEND_MODE_META[currentBlendMode]?.label ?? currentBlendMode}
            </span>
            <span className="block text-[10px] font-semibold text-white/38 leading-tight">
              {BLEND_MODE_META[currentBlendMode]?.hint ?? ""}
            </span>
          </span>
        </div>

        {/* Grouped mode list */}
        <div className="grid gap-1 max-h-64 overflow-y-auto pr-0.5 [scrollbar-width:thin]">
          {BLEND_MODE_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="px-1 pb-1 pt-2 text-[9px] font-black uppercase tracking-[0.12em] text-white/28 first:pt-0">
                {group.label}
              </div>
              {group.modes.map((mode) => {
                const { label, hint } = BLEND_MODE_META[mode];
                const active = currentBlendMode === mode;
                return (
                  <button
                    key={mode}
                    className={`mb-1 flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition ${
                      active
                        ? "border-accent/65 bg-accent/16"
                        : "border-white/[0.08] bg-white/[0.025] hover:border-white/[0.18] hover:bg-white/[0.055]"
                    }`}
                    onClick={() => onBlendModeChange(mode)}
                  >
                    <BlendPreview mode={mode} size="sm" />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold text-white/68">{label}</span>
                      <span className="block truncate text-[10px] font-semibold text-white/34">{hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

function rgbaAlpha(color: string): number {
  const m = color.match(/rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+))?\s*\)/);
  return m ? parseFloat(m[1] ?? "1") : 1;
}

function rgbaToHex(color: string): string {
  const m = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!m) return "#000000";
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(Number(m[1]))}${h(Number(m[2]))}${h(Number(m[3]))}`;
}

function hexToRgbaStr(hex: string, alpha: number): string {
  const n = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(n)) return `rgba(0,0,0,${alpha.toFixed(2)})`;
  return `rgba(${parseInt(n.slice(0,2),16)},${parseInt(n.slice(2,4),16)},${parseInt(n.slice(4,6),16)},${alpha.toFixed(2)})`;
}
