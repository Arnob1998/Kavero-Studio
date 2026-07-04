"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DatabaseZap, Trash2 } from "lucide-react";

export function GalleryGenerationActions({
  generationId,
  redirectToGallery = true,
  compact = false,
}: {
  generationId: string;
  redirectToGallery?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"record" | "files" | null>(null);

  async function removeGeneration(mode: "record" | "files") {
    if (pendingAction) return;
    setPendingAction(mode);

    const query = mode === "files" ? "?files=delete" : "";
    const response = await fetch(`/api/gallery/generations/${encodeURIComponent(generationId)}${query}`, {
      method: "DELETE",
    });

    setPendingAction(null);
    if (response.ok) {
      if (redirectToGallery) {
        router.push("/gallery");
      }
      router.refresh();
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <button
        className={`${compact ? "h-8 px-2 text-[11px]" : "h-9 px-3 text-[12px]"} inline-flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.035] font-semibold text-white/56 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:opacity-55`}
        type="button"
        disabled={Boolean(pendingAction)}
        onClick={() => void removeGeneration("record")}
      >
        <DatabaseZap size={13} />
        {pendingAction === "record" ? "Freeing" : "Free folder"}
      </button>
      <button
        className={`${compact ? "h-8 px-2 text-[11px]" : "h-9 px-3 text-[12px]"} inline-flex items-center gap-1.5 rounded-lg border border-red-300/10 bg-red-500/5 font-semibold text-red-100/72 transition hover:bg-red-500/14 hover:text-red-50 disabled:cursor-wait disabled:opacity-55`}
        type="button"
        disabled={Boolean(pendingAction)}
        onClick={() => void removeGeneration("files")}
      >
        <Trash2 size={13} />
        {pendingAction === "files" ? "Deleting" : "Delete folder"}
      </button>
    </span>
  );
}
