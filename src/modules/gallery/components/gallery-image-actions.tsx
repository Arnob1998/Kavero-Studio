"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { DatabaseZap, Trash2 } from "lucide-react";

export function GalleryImageActions({ imageId }: { imageId: string }) {
  const router = useRouter();
  const [pendingAction, setPendingAction] = useState<"record" | "files" | null>(null);

  async function removeImage(mode: "record" | "files") {
    if (pendingAction) return;
    setPendingAction(mode);

    const query = mode === "files" ? "?files=delete" : "";
    const response = await fetch(`/api/gallery/${encodeURIComponent(imageId)}${query}`, {
      method: "DELETE",
    });

    setPendingAction(null);
    if (response.ok) {
      router.refresh();
    }
  }

  return (
    <span className="flex flex-wrap items-center justify-end gap-1">
      <button
        className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-white/48 transition hover:bg-white/[0.07] hover:text-white disabled:cursor-wait disabled:opacity-55"
        type="button"
        disabled={Boolean(pendingAction)}
        onClick={() => void removeImage("record")}
        aria-label="Remove from Gallery, keep stored files"
        title="Remove from Gallery, keep stored files"
      >
        <DatabaseZap size={13} />
        {pendingAction === "record" ? "Removing" : "Remove from Gallery"}
      </button>
      <button
        className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-white/48 transition hover:bg-red-500/14 hover:text-red-100 disabled:cursor-wait disabled:opacity-55"
        type="button"
        disabled={Boolean(pendingAction)}
        onClick={() => void removeImage("files")}
        aria-label="Delete permanently from Gallery and storage"
        title="Delete permanently from Gallery and storage"
      >
        <Trash2 size={13} />
        {pendingAction === "files" ? "Deleting" : "Delete permanently"}
      </button>
    </span>
  );
}
