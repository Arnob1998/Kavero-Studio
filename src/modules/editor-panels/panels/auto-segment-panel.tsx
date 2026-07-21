import type { DragEvent } from "react";
import { Image as ImageIcon, Layers, LoaderCircle, ScanSearch, Upload } from "lucide-react";
import type { AutoSegmentAsset, AutoSegmentGroup, AutoSegmentSource, AutoSegmentStatus } from "../types";

export function AutoSegmentPanel({
  source,
  selectedImageSource,
  selectedObject,
  status,
  groups,
  error,
  warnings,
  uploadProgress,
  addingAll,
  fileInputRef,
  onUpload,
  onUseSelected,
  onRun,
  onAddSegment,
  onAddAll,
  modelAvailable = true,
  modelUnavailableMessage,
}: {
  source: AutoSegmentSource | null;
  selectedImageSource: AutoSegmentSource | null;
  selectedObject: unknown;
  status: AutoSegmentStatus;
  groups: AutoSegmentGroup[];
  error: string | null;
  warnings: string[];
  uploadProgress: number;
  addingAll: boolean;
  fileInputRef: { current: HTMLInputElement | null };
  onUpload: (files: FileList | null) => void;
  onUseSelected: () => void;
  onRun: () => void;
  onAddSegment: (segment: AutoSegmentAsset) => void;
  onAddAll: () => void;
  modelAvailable?: boolean;
  modelUnavailableMessage?: string;
}) {
  const busy = status === "analyzing" || status === "isolating" || status === "uploading";
  const unsupportedSelection = selectedObject && !selectedImageSource;
  const statusLabel =
    status === "analyzing"
      ? "Analyzing image"
      : status === "isolating"
        ? "Isolating parts"
        : status === "uploading"
          ? "Uploading cutouts"
          : status === "ready"
            ? "Segments ready"
            : status === "error"
              ? "Needs attention"
              : "Ready";

  return (
    <div className="grid w-full min-w-0 max-w-full gap-4">
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] p-3">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_88px] items-start gap-2">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-black uppercase tracking-[0.08em] text-white/42">Source</p>
            <p className="m-0 mt-1 truncate text-[12px] font-bold text-white/68">{source?.name ?? "Select or upload an image"}</p>
          </div>
          <span className="w-[88px] rounded-md border border-white/[0.08] bg-black/24 px-1.5 py-1 text-center text-[10px] font-bold leading-3 text-white/42">
            {statusLabel}
          </span>
        </div>
        {source ? (
          <div className="mt-3 w-full min-w-0 overflow-hidden rounded-lg border border-white/[0.08] bg-black/30">
            <img className="h-36 w-full object-contain" src={source.assetUrl} alt="" />
          </div>
        ) : (
          <div className="mt-3 grid min-h-32 w-full min-w-0 place-items-center rounded-lg border border-dashed border-white/[0.14] bg-black/20 px-4 text-center">
            <span>
              <ScanSearch size={24} className="mx-auto mb-2 text-white/36" />
              <span className="block text-[11px] font-semibold text-white/42">Auto Segment works with uploaded image objects</span>
            </span>
          </div>
        )}
        {unsupportedSelection ? (
          <div className="mt-3 rounded-lg border border-amber-300/16 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-50/70">
            Select an uploaded image object. Shapes, text, groups, and missing images cannot be segmented.
          </div>
        ) : null}
        {!modelAvailable ? (
          <div className="mt-3 rounded-lg border border-amber-300/16 bg-amber-500/10 px-3 py-2 text-[11px] font-semibold text-amber-50/70">
            {modelUnavailableMessage ?? "The selected image model does not support Auto Segment. Choose a compatible image model in Settings."}
          </div>
        ) : null}
        <div className="mt-3 grid w-full min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
          <button
            className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.045] px-2 text-[11px] font-black text-white/58 transition hover:border-accent/45 hover:bg-accent/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!selectedImageSource || busy}
            onClick={onUseSelected}
          >
            <ImageIcon size={13} className="shrink-0" />
            <span className="truncate">Use selected</span>
          </button>
          <button
            className="inline-flex h-9 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-white/[0.045] px-2 text-[11px] font-black text-white/58 transition hover:border-accent/45 hover:bg-accent/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={13} className="shrink-0" />
            <span className="truncate">Upload</span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => onUpload((event.target as HTMLInputElement).files)}
        />
        {status === "uploading" && uploadProgress > 0 ? (
          <div className="mt-3 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-1.5 rounded-full bg-accent transition-[width]" style={{ width: `${uploadProgress}%` }} />
          </div>
        ) : null}
        <button
          className="mt-3 inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-[11px] font-black text-white shadow-[0_12px_26px_rgb(59_130_246_/_0.24)] transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!source || busy || !modelAvailable}
          onClick={onRun}
        >
          {busy ? <LoaderCircle size={13} className="shrink-0 animate-spin" /> : <ScanSearch size={13} className="shrink-0" />}
          <span className="truncate">{busy ? statusLabel : "Auto Segment"}</span>
        </button>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-300/18 bg-red-500/10 px-3 py-2.5 text-[11px] font-semibold leading-4 text-red-100/72">
          {error}
        </div>
      ) : null}
      {warnings.length > 0 ? (
        <div className="rounded-xl border border-amber-300/16 bg-amber-500/10 px-3 py-2 text-[10px] font-semibold leading-4 text-amber-50/62">
          {warnings.join(" ")}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="grid min-h-[170px] w-full min-w-0 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-center">
          <span>
            <Layers size={22} className="mx-auto mb-2 text-white/34" />
            <span className="block text-[11px] font-semibold text-white/42">Separated parts will appear by category</span>
          </span>
        </div>
      ) : (
        <div className="grid w-full min-w-0 gap-4">
          <button
            className="inline-flex h-9 w-full min-w-0 items-center justify-center gap-1.5 rounded-xl border border-accent/35 bg-accent/12 px-3 text-[11px] font-black text-accent transition hover:bg-accent/18 disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy || addingAll}
            onClick={onAddAll}
          >
            {addingAll ? <LoaderCircle size={13} className="shrink-0 animate-spin" /> : <Layers size={13} className="shrink-0" />}
            <span className="truncate">{addingAll ? "Adding segments" : "Add all as layers"}</span>
          </button>
          {groups.map((group) => (
            <section key={group.key} className="grid min-w-0 gap-2">
              <PanelHeading label={group.label} count={group.segments.length} />
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                {group.segments.map((segment) => (
                  <button
                    key={segment.id}
                    className="group overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.04] text-left transition hover:border-accent/45 hover:bg-accent/10"
                    draggable
                    onClick={() => onAddSegment(segment)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "copy";
                      event.dataTransfer.setData("text/plain", segment.dataUrl);
                      setCanvasAssetDragPreview(event, segment.dataUrl);
                    }}
                    title={segment.label}
                  >
                    <span className="relative grid aspect-square place-items-center overflow-hidden" style={{ background: segment.previewBackground }}>
                      <img
                        className="relative h-[92%] w-[92%] object-contain opacity-100 transition group-hover:scale-[1.03]"
                        src={segment.dataUrl}
                        alt=""
                        draggable={false}
                        style={{ filter: "drop-shadow(0 1px 2px rgb(0 0 0 / 0.28))" }}
                      />
                    </span>
                    <span className="flex items-center justify-between gap-2 border-t border-white/[0.08] px-2 py-1.5">
                      <span className="truncate text-[10px] font-semibold text-white/52">{segment.label}</span>
                      {typeof segment.confidence === "number" ? (
                        <span className="font-mono text-[9px] font-bold text-white/34">{Math.round(segment.confidence * 100)}%</span>
                      ) : null}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function PanelHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="truncate text-[11px] font-black uppercase tracking-[0.08em] text-white/42">{label}</span>
      <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-white/42">
        {count}
      </span>
    </div>
  );
}

function setCanvasAssetDragPreview(event: DragEvent<HTMLElement>, assetUrl: string) {
  const dragPreview = document.createElement("div");
  dragPreview.className =
    "pointer-events-none fixed left-[-9999px] top-[-9999px] grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-white/20 bg-black shadow-[0_18px_44px_rgb(0_0_0_/_0.38)]";
  const image = document.createElement("img");
  image.src = assetUrl;
  image.alt = "";
  image.className = "h-full w-full object-contain";
  dragPreview.appendChild(image);
  document.body.appendChild(dragPreview);
  event.dataTransfer.setDragImage(dragPreview, 40, 40);
  window.setTimeout(() => dragPreview.remove(), 0);
}
