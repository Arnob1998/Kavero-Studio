"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FileText, Loader2, Trash2, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { ReferenceImage } from "../types";
import { isSupportedImageMimeType, readFileAsDataUrl } from "../utils/client-helpers";
import { rasterDimensions, rejectEncryptedPdfBytes, selectedImportTotal, SEQUENCE_IMPORT_LIMITS, validatePdfFile, validatePdfPageCount } from "../sequence/import-policy";

type Entry = { id: string; label: string; preview: string; selected: boolean; page?: number; file?: File };

async function renderPage(pdf: PDFDocumentProxy, pageNumber: number, edge: number) {
  const page = await pdf.getPage(pageNumber);
  const original = page.getViewport({ scale: 1 });
  const dimensions = rasterDimensions(original.width, original.height, edge);
  const viewport = page.getViewport({ scale: Math.min(dimensions.width / original.width, dimensions.height / original.height) });
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("Canvas rendering is unavailable.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const task = page.render({ canvasContext: context, viewport });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        task.promise,
        new Promise<never>((_, reject) => { timeout = setTimeout(() => { task.cancel(); reject(new Error(`Page ${pageNumber} took too long to render.`)); }, 15000); }),
      ]);
    } finally { if (timeout) clearTimeout(timeout); }
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not rasterize the PDF page.")), "image/jpeg", 0.85));
    if (blob.size === 0 || blob.size > SEQUENCE_IMPORT_LIMITS.maximumRasterBytes) throw new Error(`Page ${pageNumber} exceeds the 7 MiB image limit.`);
    return { dataUrl: await readFileAsDataUrl(blob), size: blob.size };
  } finally {
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }
}

export function SequenceImportDialog({ availableSlots, existingBytes, onImport, onClose }: {
  availableSlots: number;
  existingBytes: number;
  onImport: (images: ReferenceImage[]) => boolean;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sourceName, setSourceName] = useState("");
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const urlsRef = useRef<string[]>([]);
  const revisionRef = useRef(0);

  function releaseSource() {
    revisionRef.current += 1;
    void pdfRef.current?.destroy();
    pdfRef.current = null;
    urlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    urlsRef.current = [];
  }

  useEffect(() => () => releaseSource(), []);

  async function stageFiles(files: File[]) {
    releaseSource();
    const revision = revisionRef.current;
    setEntries([]);
    setError("");
    setBusy(true);
    try {
      if (files.length < 1) return;
      const isPdf = files.length === 1 && (files[0].type === "application/pdf" || files[0].name.toLowerCase().endsWith(".pdf"));
      if (isPdf) {
        const file = files[0];
        const header = new Uint8Array(await file.slice(0, 5).arrayBuffer());
        validatePdfFile(file, header);
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
        const bytes = new Uint8Array(await file.arrayBuffer());
        rejectEncryptedPdfBytes(bytes);
        const loading = pdfjs.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false, stopAtErrors: true });
        // Password-protected documents are never prompted for credentials or uploaded.
        loading.onPassword = () => { void loading.destroy(); };
        let pdf: PDFDocumentProxy;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try { pdf = await Promise.race([loading.promise, new Promise<never>((_, reject) => { timeout = setTimeout(() => { void loading.destroy(); reject(new Error("PDF parsing timed out.")); }, 15000); })]); }
        catch { throw new Error("PDF is encrypted, password-protected, or malformed."); }
        finally { if (timeout) clearTimeout(timeout); }
        if (revision !== revisionRef.current) { await pdf.destroy(); return; }
        pdfRef.current = pdf;
        validatePdfPageCount(pdf.numPages);
        const next: Entry[] = [];
        for (let page = 1; page <= pdf.numPages; page += 1) {
          if (revision !== revisionRef.current) return;
          const preview = await renderPage(pdf, page, SEQUENCE_IMPORT_LIMITS.thumbnailEdge);
          next.push({ id: `page-${page}`, page, label: `${file.name} · page ${page}`, preview: preview.dataUrl, selected: page <= availableSlots });
        }
        setEntries(next);
        setSourceName(`${file.name} · ${pdf.numPages} pages`);
      } else {
        if (files.length > SEQUENCE_IMPORT_LIMITS.maximumSelectedPages) throw new Error("Choose at most 8 images at a time.");
        if (files.some((file) => !isSupportedImageMimeType(file.type))) throw new Error("Choose PNG, JPEG, WebP, HEIC, or HEIF images, or one PDF.");
        if (files.some((file) => file.size === 0 || file.size > SEQUENCE_IMPORT_LIMITS.maximumRasterBytes)) throw new Error("Each image must be non-empty and at most 7 MiB.");
        const next = files.map((file, index) => {
          const preview = URL.createObjectURL(file);
          urlsRef.current.push(preview);
          return { id: `image-${index}`, file, label: file.name, preview, selected: index < availableSlots };
        });
        setEntries(next);
        setSourceName(`${files.length} ordered images`);
      }
    } catch (cause) {
      releaseSource();
      setError(cause instanceof Error ? cause.message : "Could not open this import.");
    } finally {
      if (revision === revisionRef.current) setBusy(false);
      else setBusy(false);
    }
  }

  async function confirm() {
    const selected = entries.filter((entry) => entry.selected);
    if (selected.length < 1 || selected.length > availableSlots) { setError(`Select 1–${availableSlots} items.`); return; }
    setBusy(true);
    setError("");
    try {
      const images: ReferenceImage[] = [];
      for (const entry of selected) {
        const raster = entry.page ? await renderPage(pdfRef.current!, entry.page, SEQUENCE_IMPORT_LIMITS.rasterEdge) : null;
        const file = entry.file;
        images.push({
          clientId: crypto.randomUUID(),
          name: entry.label.trim() || (entry.page ? `Page ${entry.page}` : file!.name),
          mimeType: raster ? "image/jpeg" : file!.type as ReferenceImage["mimeType"],
          dataUrl: raster ? raster.dataUrl : await readFileAsDataUrl(file!),
          size: raster ? raster.size : file!.size,
        });
      }
      selectedImportTotal(existingBytes, images.map((image) => image.size));
      if (!onImport(images)) throw new Error("Sequence reference capacity changed. Review the import again.");
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not import the selected items.");
    } finally { setBusy(false); }
  }

  const selectedCount = entries.filter((entry) => entry.selected).length;
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/80 p-4 backdrop-blur-lg">
      <section role="dialog" aria-modal="true" aria-label="Import sequence references" onKeyDown={(event) => { if (event.key === "Escape" && !busy) onClose(); }} className="flex max-h-[90svh] w-[min(760px,100%)] flex-col rounded-2xl border border-white/15 bg-zinc-950 p-4 text-white shadow-2xl">
        <div className="flex items-center justify-between gap-3"><h2 className="text-base font-bold">Import sequence pages or carousel</h2><button type="button" aria-label="Close import" onClick={onClose}><X size={18} /></button></div>
        <p className="mt-2 text-xs text-white/60">Choose one PDF or up to 8 images. Review the order and labels before adding them. Importing never starts generation.</p>
        <label className="mt-4 grid gap-1 text-xs font-semibold">PDF or images <input autoFocus type="file" accept="application/pdf,.pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" multiple disabled={busy} onChange={(event) => { void stageFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} /></label>
        {busy ? <p role="status" className="mt-3 flex items-center gap-2 text-xs text-white/70"><Loader2 className="animate-spin" size={15} /> Processing locally…</p> : null}
        {error ? <p role="alert" className="mt-3 text-xs text-red-300">{error}</p> : null}
        {entries.length ? <p className="mt-3 text-xs text-white/60">{sourceName} · {selectedCount} selected · {availableSlots} slots available</p> : null}
        <div className="mt-3 grid min-h-0 gap-2 overflow-y-auto">
          {entries.map((entry, index) => <div key={entry.id} className="grid grid-cols-[auto_54px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-white/10 p-2">
            <label className="flex items-center"><input type="checkbox" aria-label={`Select ${entry.label}`} checked={entry.selected} disabled={busy || (!entry.selected && selectedCount >= availableSlots)} onChange={(event) => setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, selected: event.target.checked } : item))} /></label>
            {entry.file?.type === "image/heic" || entry.file?.type === "image/heif" ? <FileText size={24} /> : <img src={entry.preview} alt={`Preview of ${entry.label}`} className="h-14 w-14 rounded object-contain" />}
            <label className="grid min-w-0 gap-1 text-[10px] text-white/50">Label<input aria-label={`Label for item ${index + 1}`} maxLength={120} className="min-w-0 rounded border border-white/15 bg-white/5 p-1.5 text-xs text-white" value={entry.label} disabled={busy} onChange={(event) => setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, label: event.target.value } : item))} /></label>
            <div className="flex gap-1"><button type="button" aria-label={`Move item ${index + 1} up`} disabled={busy || index === 0} onClick={() => setEntries((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><ArrowUp size={15} /></button><button type="button" aria-label={`Move item ${index + 1} down`} disabled={busy || index === entries.length - 1} onClick={() => setEntries((current) => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}><ArrowDown size={15} /></button><button type="button" aria-label={`Remove item ${index + 1}`} disabled={busy} onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))}><Trash2 size={15} /></button></div>
          </div>)}
        </div>
        <div className="mt-4 flex justify-end gap-2"><button type="button" className="rounded-lg px-3 py-2 text-xs text-white/70" onClick={onClose}>Cancel</button><button type="button" className="rounded-lg bg-accent px-3 py-2 text-xs font-bold disabled:opacity-40" disabled={busy || selectedCount < 1} onClick={() => void confirm()}>Add selected references</button></div>
      </section>
    </div>
  );
}
