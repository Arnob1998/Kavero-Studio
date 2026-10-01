"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { downloadImagesZip, type ImageExportSource } from "@/lib/image-export";

export function DownloadImagesButton({ images, name, label = "Download all" }: { images: ImageExportSource[]; name: string; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="relative inline-flex">
      <button type="button" aria-label={busy ? "Exporting images" : `${label} (${images.length})`} disabled={busy || !images.length} className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-[10px] font-bold text-white/70 hover:bg-white/[0.08] disabled:opacity-40" onClick={async () => {
        setBusy(true);
        setError(null);
        try { await downloadImagesZip(images, name); }
        catch (error) { setError(error instanceof Error ? error.message : "Export failed. Try again."); }
        finally { setBusy(false); }
      }}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        <span className="hidden sm:inline">{busy ? "Exporting…" : label}</span>
        {!busy ? <span>({images.length})</span> : null}
      </button>
      {error ? <span role="alert" className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border border-red-400/20 bg-black p-3 text-[11px] text-red-100">{error}</span> : null}
    </span>
  );
}
