import { useState } from "react";
import {
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Download,
  Save,
  ChevronDown,
  Home,
  Search,
  ArrowLeft,
  Heart,
  Monitor,
  Presentation,
  Video,
  FileText,
  Magnet,
} from "lucide-react";
import type { ComponentType } from "react";
import { useEditor, CANVAS_SIZE_GROUPS, CANVAS_SIZES } from "@/modules/canvas/state/context";
import type { CanvasSize } from "@/modules/canvas/state/context";

type SizeCategory = CanvasSize["category"];

const CATEGORY_LABELS: Record<SizeCategory, string> = {
  social: "Social media",
  video: "Videos",
  presentation: "Presentations",
  web: "Website",
  print: "Documents",
};

const CATEGORY_ICONS: Record<SizeCategory, ComponentType<{ size?: number; className?: string }>> = {
  social: Heart,
  video: Video,
  presentation: Presentation,
  web: Monitor,
  print: FileText,
};

const SUGGESTED_SIZE_KEYS = new Set([
  "Instagram-Portrait Post",
  "Instagram-Story / Reel",
  "YouTube-Thumbnail",
  "Facebook-Post",
  "Presentation-Widescreen",
  "Website-Desktop Hero",
]);

export function Toolbar() {
  const {
    canvasWidth,
    canvasHeight,
    setCanvasSize,
    undo,
    redo,
    canUndo,
    canRedo,
    zoom,
    fitScale,
    zoomToFit,
    zoomIn,
    zoomOut,
    exportPNG,
    saveDesign,
    saving,
    activeDesign,
    renameDesign,
    navigate,
    snapEnabled,
    setSnapEnabled,
  } = useEditor();

  const [showSizeDropdown, setShowSizeDropdown] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState("");
  const [customWidth, setCustomWidth] = useState(String(canvasWidth));
  const [customHeight, setCustomHeight] = useState(String(canvasHeight));
  const [sizeSearch, setSizeSearch] = useState("");
  const [activeSizeCategory, setActiveSizeCategory] = useState<SizeCategory | "custom" | null>(null);

  const currentSize = CANVAS_SIZES.find(
    (s) => s.width === canvasWidth && s.height === canvasHeight
  );
  const sizeLabel = currentSize
    ? `${currentSize.platform} ${currentSize.label}`
    : `${canvasWidth} x ${canvasHeight}`;

  const applyCustomSize = () => {
    const width = Number.parseInt(customWidth, 10);
    const height = Number.parseInt(customHeight, 10);
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    const safeWidth = Math.min(Math.max(width, 100), 8000);
    const safeHeight = Math.min(Math.max(height, 100), 8000);
    setCanvasSize(safeWidth, safeHeight);
    setCustomWidth(String(safeWidth));
    setCustomHeight(String(safeHeight));
    setShowSizeDropdown(false);
  };

  const selectSize = (size: CanvasSize) => {
    setCanvasSize(size.width, size.height);
    setCustomWidth(String(size.width));
    setCustomHeight(String(size.height));
    setShowSizeDropdown(false);
  };

  const searchedSizes = CANVAS_SIZES.filter((size) => {
    const query = sizeSearch.trim().toLowerCase();
    if (!query) return true;
    return `${size.platform} ${size.label} ${size.width} ${size.height}`.toLowerCase().includes(query);
  });

  const suggestedSizes = CANVAS_SIZES.filter((size) => SUGGESTED_SIZE_KEYS.has(`${size.platform}-${size.label}`));
  const categoryGroups = Object.entries(CATEGORY_LABELS) as [SizeCategory, string][];

  const startRename = () => {
    if (!activeDesign) return;
    setNameValue(activeDesign.name);
    setEditingName(true);
  };

  const finishRename = () => {
    if (activeDesign && nameValue.trim()) {
      renameDesign(activeDesign.id, nameValue.trim());
    }
    setEditingName(false);
  };

  return (
    <div className="relative z-20 flex shrink-0 items-center justify-between border-b border-white/[0.08] bg-black/48 px-4 py-2 shadow-[0_18px_70px_rgb(0_0_0_/_0.34),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-2xl">
      {/* Left: Home + Design name + Canvas size */}
      <div className="flex items-center gap-3">
        <button
          className="grid h-9 w-9 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.04] text-white/58 transition hover:bg-white/[0.08] hover:text-white"
          onClick={() => navigate("/")}
          title="Back to designs"
        >
          <Home size={16} />
        </button>
        {activeDesign && (
          editingName ? (
            <input
              className="h-9 w-44 rounded-xl border border-accent/60 bg-white/[0.045] px-3 text-xs font-semibold text-white outline-none"
              value={nameValue}
              onInput={(e) => setNameValue((e.target as HTMLInputElement).value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") finishRename();
                if (e.key === "Escape") setEditingName(false);
              }}
              autoFocus
            />
          ) : (
            <span
              className="cursor-pointer text-[13px] font-semibold text-white/78 transition-colors hover:text-white"
              onDoubleClick={startRename}
            >
              {activeDesign.name}
            </span>
          )
        )}

        <div className="relative">
          <button
            className="inline-flex h-9 items-center gap-1 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[11px] font-bold text-white/58 transition hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-white"
            onClick={() => {
              setCustomWidth(String(canvasWidth));
              setCustomHeight(String(canvasHeight));
              setActiveSizeCategory(null);
              setSizeSearch("");
              setShowSizeDropdown(!showSizeDropdown);
            }}
          >
            {sizeLabel}
            <ChevronDown size={12} />
          </button>
          {showSizeDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowSizeDropdown(false)} />
              <div className="absolute left-0 top-full z-20 mt-2 max-h-[min(720px,calc(100vh-80px))] w-[440px] overflow-hidden rounded-2xl border border-white/[0.16] bg-[#060607] shadow-[0_28px_110px_rgb(0_0_0_/_0.72),inset_0_1px_0_rgb(255_255_255_/_0.08)] backdrop-blur-3xl">
                <div className="border-b border-white/[0.08] bg-[#0c0c0f] p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/42" size={17} />
                    <input
                      className="h-11 w-full rounded-xl border border-accent/55 bg-[#050506] pl-10 pr-3 text-[13px] font-semibold text-white outline-none placeholder:text-white/34"
                      placeholder="Search resize options"
                      value={sizeSearch}
                      onChange={(event) => {
                        setSizeSearch(event.target.value);
                        setActiveSizeCategory(null);
                      }}
                    />
                  </div>
                </div>

                <div className="max-h-[calc(min(720px,100vh-80px)-70px)] overflow-y-auto p-3 [scrollbar-color:rgb(255_255_255_/_0.28)_transparent]">
                  {sizeSearch ? (
                    <SizeList sizes={searchedSizes} canvasWidth={canvasWidth} canvasHeight={canvasHeight} onSelect={selectSize} />
                  ) : activeSizeCategory === "custom" ? (
                    <div>
                      <button
                        className="mb-3 inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] font-bold text-white/56 transition hover:bg-white/[0.08] hover:text-white"
                        onClick={() => setActiveSizeCategory(null)}
                      >
                        <ArrowLeft size={14} />
                        Back
                      </button>
                      <CustomSizeForm
                        customWidth={customWidth}
                        customHeight={customHeight}
                        setCustomWidth={setCustomWidth}
                        setCustomHeight={setCustomHeight}
                        applyCustomSize={applyCustomSize}
                      />
                    </div>
                  ) : activeSizeCategory ? (
                    <div>
                      <button
                        className="mb-3 inline-flex h-8 items-center gap-2 rounded-lg px-2 text-[12px] font-bold text-white/56 transition hover:bg-white/[0.08] hover:text-white"
                        onClick={() => setActiveSizeCategory(null)}
                      >
                        <ArrowLeft size={14} />
                        Back
                      </button>
                      <SizeList
                        sizes={CANVAS_SIZES.filter((size) => size.category === activeSizeCategory)}
                        canvasWidth={canvasWidth}
                        canvasHeight={canvasHeight}
                        onSelect={selectSize}
                      />
                    </div>
                  ) : (
                    <div className="grid gap-5">
                      <section>
                        <div className="mb-2 flex items-center justify-between">
                          <h3 className="m-0 text-[12px] font-black uppercase tracking-[0.08em] text-white/42">Suggested</h3>
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          {suggestedSizes.slice(0, 6).map((size) => (
                            <SizeCard key={`${size.platform}-${size.label}`} size={size} onSelect={() => selectSize(size)} />
                          ))}
                        </div>
                      </section>
                      <section>
                        <h3 className="mb-2 mt-0 text-[12px] font-black uppercase tracking-[0.08em] text-white/42">Browse by category</h3>
                        <div className="grid gap-1">
                          <CategoryButton
                            icon={Monitor}
                            label="Custom size"
                            onClick={() => setActiveSizeCategory("custom")}
                          />
                          {categoryGroups.map(([category, label]) => (
                            <CategoryButton
                              key={category}
                              icon={CATEGORY_ICONS[category]}
                              label={label}
                              onClick={() => setActiveSizeCategory(category)}
                            />
                          ))}
                        </div>
                      </section>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Center: Undo / Redo */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-2xl border border-white/[0.08] bg-black/42 px-2 py-1 shadow-[0_14px_50px_rgb(0_0_0_/_0.34),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl">
        <button
          className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[11px] font-bold transition ${
            snapEnabled
              ? "bg-accent/20 text-accent"
              : "text-white/42 hover:bg-white/[0.08] hover:text-white"
          }`}
          onClick={() => setSnapEnabled(!snapEnabled)}
          title="Toggle smart guides. Hold Ctrl/Cmd while dragging to temporarily disable snapping."
        >
          <Magnet size={14} />
          Snap
        </button>
        <button
          className="grid h-8 w-8 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.08] hover:text-white"
          onClick={() => window.dispatchEvent(new Event("kavero:open-command-palette"))}
          title="Command palette (Ctrl+K)"
        >
          <Search size={15} />
        </button>
        <div className="mx-1 h-5 w-px bg-white/[0.08]" />
        <button
          className="grid h-8 w-8 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Cmd+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          className="grid h-8 w-8 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Cmd+Shift+Z)"
        >
          <Redo2 size={16} />
        </button>
      </div>

      {/* Right: Zoom + Export + Save */}
      <div className="flex items-center gap-1.5">
        <button
          className="grid h-8 w-8 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.08] hover:text-white"
          onClick={zoomOut}
          title="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <span className="w-11 text-center font-mono text-[11px] font-semibold text-white/58">
          {Math.round((zoom / (fitScale || 1)) * 100)}%
        </span>
        <button
          className="grid h-8 w-8 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.08] hover:text-white"
          onClick={zoomIn}
          title="Zoom in"
        >
          <ZoomIn size={15} />
        </button>
        <button
          className="grid h-8 w-8 place-items-center rounded-lg text-white/52 transition hover:bg-white/[0.08] hover:text-white"
          onClick={zoomToFit}
          title="Fit to screen"
        >
          <Maximize size={15} />
        </button>

        <div className="mx-1 h-5 w-px bg-white/[0.1]" />

        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[11px] font-bold text-white/62 transition hover:bg-white/[0.08] hover:text-white"
          onClick={exportPNG}
          title="Export as PNG"
        >
          <Download size={13} />
          Export
        </button>
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-[11px] font-bold text-white shadow-[0_12px_32px_rgb(59_130_246_/_0.24)] transition hover:bg-accent-hover disabled:opacity-50"
          onClick={saveDesign}
          disabled={saving || !activeDesign}
        >
          {saving ? (
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <Save size={13} />
          )}
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

function SizePreview({ width, height }: { width: number; height: number }) {
  const isTall = height > width * 1.25;
  const isWide = width > height * 1.35;
  const frameClass = isTall
    ? "h-16 w-9"
    : isWide
      ? "h-10 w-20"
      : "h-14 w-14";

  return (
    <span className="grid h-[86px] place-items-center rounded-xl bg-white/[0.055]">
      <span className={`${frameClass} relative rounded-md border border-white/[0.18] bg-gradient-to-br from-accent/85 via-fuchsia-500/70 to-cyan-300/80 shadow-[0_14px_30px_rgb(0_0_0_/_0.24)]`}>
        <span className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-white/78" />
        <span className="absolute bottom-2 left-1.5 right-1.5 h-1 rounded-full bg-white/45" />
        <span className="absolute bottom-4 left-1.5 right-3 h-1 rounded-full bg-white/34" />
      </span>
    </span>
  );
}

function SizeCard({ size, onSelect }: { size: CanvasSize; onSelect: () => void }) {
  return (
    <button
      className="group min-w-0 rounded-xl border border-white/[0.08] bg-white/[0.035] p-0 text-left transition hover:border-accent/45 hover:bg-accent/10"
      onClick={onSelect}
    >
      <SizePreview width={size.width} height={size.height} />
      <span className="block truncate px-1 pt-2 text-[12px] font-semibold text-white/76">
        {size.platform} {size.label}
      </span>
      <span className="block px-1 pb-1.5 pt-0.5 font-mono text-[11px] font-semibold text-white/38">
        {size.width} x {size.height}
      </span>
    </button>
  );
}

function SizeList({
  sizes,
  canvasWidth,
  canvasHeight,
  onSelect,
}: {
  sizes: CanvasSize[];
  canvasWidth: number;
  canvasHeight: number;
  onSelect: (size: CanvasSize) => void;
}) {
  if (sizes.length === 0) {
    return (
      <div className="grid min-h-[180px] place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-[12px] font-semibold text-white/42">
        No matching sizes
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      {CANVAS_SIZE_GROUPS.map((group) => {
        const groupSizes = sizes.filter((size) => size.platform === group.platform);
        if (groupSizes.length === 0) return null;
        return (
          <div key={group.platform}>
            <div className="px-1 py-1 text-[10px] font-black uppercase tracking-[0.08em] text-white/32">
              {group.platform}
            </div>
            <div className="grid gap-1">
              {groupSizes.map((size) => {
                const isActive = size.width === canvasWidth && size.height === canvasHeight;
                return (
                  <button
                    key={`${size.platform}-${size.label}-${size.width}-${size.height}`}
                    className={`grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-xl border p-2 text-left transition ${
                      isActive
                        ? "border-accent/60 bg-accent/14"
                        : "border-white/[0.08] bg-white/[0.035] hover:border-white/[0.16] hover:bg-white/[0.06]"
                    }`}
                    onClick={() => onSelect(size)}
                  >
                    <span className="grid h-12 place-items-center rounded-lg bg-white/[0.055]">
                      <span
                        className="rounded border border-white/[0.18] bg-gradient-to-br from-accent/80 to-fuchsia-500/70"
                        style={{
                          width: `${Math.max(18, Math.min(44, (size.width / Math.max(size.width, size.height)) * 44))}px`,
                          height: `${Math.max(18, Math.min(44, (size.height / Math.max(size.width, size.height)) * 44))}px`,
                        }}
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-white/76">{size.label}</span>
                      <span className="font-mono text-[11px] font-semibold text-white/38">
                        {size.width} x {size.height} px
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CategoryButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex h-12 items-center justify-between rounded-xl border border-transparent px-2 text-left transition hover:border-white/[0.1] hover:bg-white/[0.055]"
      onClick={onClick}
    >
      <span className="inline-flex min-w-0 items-center gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/[0.06] text-accent">
          <Icon size={17} />
        </span>
        <span className="truncate text-[14px] font-semibold text-white/72">{label}</span>
      </span>
      <ChevronDown className="-rotate-90 text-white/42" size={16} />
    </button>
  );
}

function CustomSizeForm({
  customWidth,
  customHeight,
  setCustomWidth,
  setCustomHeight,
  applyCustomSize,
}: {
  customWidth: string;
  customHeight: string;
  setCustomWidth: (value: string) => void;
  setCustomHeight: (value: string) => void;
  applyCustomSize: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.08] bg-[#0c0c0f] p-3">
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-white/32">
        Custom size
      </div>
      <div className="mb-4 grid place-items-center rounded-xl bg-white/[0.055] py-4">
        <SizePreview
          width={Number.parseInt(customWidth, 10) || 100}
          height={Number.parseInt(customHeight, 10) || 100}
        />
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <input
          className="h-10 rounded-lg border border-white/[0.1] bg-[#050506] px-3 text-xs font-semibold text-white outline-none focus:border-accent/60"
          inputMode="numeric"
          value={customWidth}
          onChange={(event) => setCustomWidth(event.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(event) => {
            if (event.key === "Enter") applyCustomSize();
          }}
          aria-label="Custom width"
        />
        <span className="text-[11px] font-bold text-white/32">x</span>
        <input
          className="h-10 rounded-lg border border-white/[0.1] bg-[#050506] px-3 text-xs font-semibold text-white outline-none focus:border-accent/60"
          inputMode="numeric"
          value={customHeight}
          onChange={(event) => setCustomHeight(event.target.value.replace(/\D/g, "").slice(0, 4))}
          onKeyDown={(event) => {
            if (event.key === "Enter") applyCustomSize();
          }}
          aria-label="Custom height"
        />
      </div>
      <button
        className="mt-3 h-10 w-full rounded-lg bg-accent px-3 text-[12px] font-bold text-white transition hover:bg-accent-hover"
        onClick={applyCustomSize}
      >
        Apply custom size
      </button>
    </div>
  );
}
