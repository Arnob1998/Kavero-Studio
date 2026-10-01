"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Eraser, Paintbrush, RotateCcw, X } from "lucide-react";

type Point = { x: number; y: number };

export function CutoutReviewDialog({ sourceUrl, cutout, busy, onCancel, onApply }: {
  sourceUrl: string;
  cutout: Blob;
  busy: boolean;
  onCancel: () => void;
  onApply: (blob: Blob) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<ImageBitmap | null>(null);
  const initialRef = useRef<ImageBitmap | null>(null);
  const previousRef = useRef<Point | null>(null);
  const [mode, setMode] = useState<"restore" | "erase">("restore");
  const [size, setSize] = useState(64);
  const [ready, setReady] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const isBusy = busy || encoding;
  const [aspectRatio, setAspectRatio] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let source: ImageBitmap | null = null;
    let initial: ImageBitmap | null = null;
    void (async () => {
      try {
        const response = await fetch(sourceUrl);
        if (!response.ok) throw new Error("Unable to load the original image for restoring details.");
        source = await createImageBitmap(await response.blob());
        initial = await createImageBitmap(cutout);
        if (disposed) return;
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) throw new Error("Unable to open the cutout editor.");
        canvas.width = initial.width;
        canvas.height = initial.height;
        context.drawImage(initial, 0, 0);
        sourceRef.current = source;
        initialRef.current = initial;
        setAspectRatio(initial.width / initial.height);
        setReady(true);
      } catch (error) {
        if (!disposed) setError(error instanceof Error ? error.message : "Unable to open the cutout editor.");
      } finally {
        if (disposed) { source?.close(); initial?.close(); }
      }
    })();
    return () => {
      disposed = true;
      sourceRef.current = null;
      initialRef.current = null;
      source?.close();
      initial?.close();
    };
  }, [sourceUrl, cutout]);

  const paint = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const source = sourceRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !source || !context || !ready || isBusy) return;
    const bounds = canvas.getBoundingClientRect();
    const point = { x: (event.clientX - bounds.left) * canvas.width / bounds.width, y: (event.clientY - bounds.top) * canvas.height / bounds.height };
    const previous = previousRef.current ?? point;
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.y - previous.y) / Math.max(1, size / 4)));
    for (let step = 1; step <= steps; step++) {
      const x = previous.x + (point.x - previous.x) * step / steps;
      const y = previous.y + (point.y - previous.y) * step / steps;
      context.save();
      context.beginPath();
      context.arc(x, y, size / 2, 0, Math.PI * 2);
      if (mode === "restore") {
        context.clip();
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.globalCompositeOperation = "source-over";
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
      } else {
        context.globalCompositeOperation = "destination-out";
        context.fill();
      }
      context.restore();
    }
    previousRef.current = point;
  };

  const reset = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !initialRef.current) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(initialRef.current, 0, 0);
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/75 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="Review cutout" onKeyDown={(event) => { if (event.key === "Escape" && !isBusy) onCancel(); }}>
      <div className="flex max-h-[95svh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-white/[0.12] bg-[#101010] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] p-4">
          <span><span className="block text-sm font-bold text-white">Review cutout</span><span className="mt-1 block text-xs text-white/55">Restore missing details or erase leftover background before applying.</span></span>
          <button type="button" disabled={isBusy} aria-label="Close cutout review" className="p-2 text-white/60" onClick={onCancel}><X size={18} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-3 p-3 text-xs text-white/75">
          <button type="button" autoFocus disabled={isBusy} aria-pressed={mode === "restore"} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${mode === "restore" ? "border-accent bg-accent/20" : "border-white/15"}`} onClick={() => setMode("restore")}><Paintbrush size={14} />Restore</button>
          <button type="button" disabled={isBusy} aria-pressed={mode === "erase"} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${mode === "erase" ? "border-accent bg-accent/20" : "border-white/15"}`} onClick={() => setMode("erase")}><Eraser size={14} />Erase</button>
          <label className="flex items-center gap-2">Brush size <input type="range" min="4" max="300" value={size} disabled={isBusy} aria-label="Cutout brush size" onChange={(event) => setSize(Number(event.target.value))} /><span className="w-12">{size}px</span></label>
          <button type="button" disabled={!ready || isBusy} className="ml-auto inline-flex items-center gap-2" onClick={reset}><RotateCcw size={14} />Reset</button>
        </div>
        <div className="min-h-0 overflow-auto px-4 pb-4">
          <div className="grid place-items-center rounded-lg bg-[#334155] p-2">
            <canvas ref={canvasRef} aria-label="Cutout brush canvas" className="block touch-none cursor-crosshair" style={{ width: `min(100%, ${55 * aspectRatio}svh)`, height: "auto" }} onPointerDown={(event) => {
              if (!ready || isBusy || event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              previousRef.current = null;
              paint(event);
            }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) paint(event); }} onPointerUp={(event) => {
              previousRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
            }} onPointerCancel={() => { previousRef.current = null; }} />
          </div>
          {!ready && !error ? <p className="mt-2 text-xs text-white/55">Preparing preview…</p> : null}
          {error ? <p role="alert" className="mt-2 text-xs text-red-200">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-3 border-t border-white/[0.08] p-3 text-xs font-bold">
          <button type="button" disabled={isBusy} className="rounded-lg border border-white/15 px-4 py-2 text-white/70" onClick={onCancel}>Cancel</button>
          <button type="button" disabled={!ready || isBusy} className="rounded-lg bg-accent px-4 py-2 text-white disabled:opacity-40" onClick={() => {
            setError(null);
            setEncoding(true);
            canvasRef.current?.toBlob((blob) => {
              if (!blob) { setError("Unable to save the cutout."); setEncoding(false); return; }
              void onApply(blob).catch((error) => setError(error instanceof Error ? error.message : "Unable to apply the cutout.")).finally(() => setEncoding(false));
            }, "image/png");
          }}>{isBusy ? "Applying…" : "Apply cutout"}</button>
        </div>
      </div>
    </div>
  );
}
