import { useState, useRef, useEffect } from "react";
import * as fabric from "fabric";
import { Plus, MoreHorizontal, Copy, Trash2, Pencil, ChevronUp, ChevronDown } from "lucide-react";
import { useEditor } from "@/modules/canvas/state/context";
import { normalizeCanvasImageSources } from "@/modules/canvas/hooks/use-canvas";
import type { Page } from "@/modules/canvas/types/editor-types";

function PageThumb({ page, width, height }: { page: Page; width: number; height: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const prevJsonRef = useRef<string>("");

  useEffect(() => {
    if (page.canvas_json === prevJsonRef.current) return;
    prevJsonRef.current = page.canvas_json;

    const el = document.createElement("canvas");
    const sc = new fabric.StaticCanvas(el, { width, height });
    let disposed = false;
    try {
      const parsed = normalizeCanvasImageSources(JSON.parse(page.canvas_json));
      sc.loadFromJSON(parsed).then(() => {
        if (disposed || sc.disposed) return;
        sc.renderAll();
        const multiplier = Math.min(200 / width, 200 / height, 1);
        setSrc(sc.toDataURL({ format: "png", multiplier }));
        void sc.dispose();
      }).catch(() => {
        if (!disposed && !sc.disposed) void sc.dispose();
      });
    } catch {
      void sc.dispose();
    }

    return () => {
      disposed = true;
      if (!sc.disposed) void sc.dispose();
    };
  }, [page.canvas_json, width, height]);

  return src ? (
    <img src={src} className="h-full w-full rounded-lg object-cover" alt={page.title} />
  ) : (
    <div className="h-full w-full rounded-lg bg-white/[0.05]" />
  );
}

export function PagesBar() {
  const {
    pages, activePageId, addPage, duplicatePage, deletePage, renamePage,
    switchToPage, setActiveCanvas, canvasWidth, canvasHeight,
  } = useEditor();
  const [expanded, setExpanded] = useState(false);
  const [menuPageId, setMenuPageId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuPageId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuPageId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuPageId]);

  // Auto-focus rename input
  useEffect(() => {
    if (renamingId && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renamingId]);

  const startRename = (pageId: string, currentTitle: string) => {
    setMenuPageId(null);
    setRenamingId(pageId);
    setRenameValue(currentTitle);
  };

  const finishRename = () => {
    if (renamingId && renameValue.trim()) {
      renamePage(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handlePageClick = (pageId: string) => {
    setActiveCanvas(pageId);
    switchToPage(pageId);
    const pageEl = document.querySelector(`[data-page-id="${pageId}"]`);
    if (pageEl) pageEl.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  if (pages.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-white/[0.08] bg-black/48 shadow-[0_-18px_70px_rgb(0_0_0_/_0.28),inset_0_1px_0_rgb(255_255_255_/_0.04)] backdrop-blur-2xl">
      {/* Collapsed bar — always visible */}
      <button
        className="flex w-full items-center justify-between bg-transparent px-4 py-2 transition-colors hover:bg-white/[0.05]"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-white/42">
          Pages ({pages.length})
        </span>
        {expanded ? (
          <ChevronDown size={14} className="text-white/42" />
        ) : (
          <ChevronUp size={14} className="text-white/42" />
        )}
      </button>

      {/* Expanded thumbnail strip */}
      {expanded && (
        <div className="flex items-center gap-3 overflow-x-auto border-t border-white/[0.08] px-4 py-3">
          {pages.map((page) => {
            const isActive = page.id === activePageId;
            return (
              <div key={page.id} className="relative flex-shrink-0 group">
                <div
                  className={`relative flex flex-col items-center gap-1 rounded-xl border p-1 transition-all ${
                    isActive
                      ? "border-accent/70 bg-accent/10 shadow-[0_12px_34px_rgb(59_130_246_/_0.18)]"
                      : "border-white/[0.1] bg-white/[0.04] hover:border-white/[0.2]"
                  }`}
                  onClick={() => handlePageClick(page.id)}
                  style={{ width: 88 }}
                >
                  <div className="w-full overflow-hidden rounded-lg bg-[linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%),linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%)] bg-[length:14px_14px] bg-[position:0_0,7px_7px]" style={{ height: 50 }}>
                    <PageThumb page={page} width={canvasWidth} height={canvasHeight} />
                  </div>
                  <button
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-md bg-black/70 opacity-0 transition-opacity hover:bg-white/[0.12] group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuPageId(menuPageId === page.id ? null : page.id);
                    }}
                  >
                    <MoreHorizontal size={12} className="text-white/56" />
                  </button>
                </div>
                <div className="mt-0.5 text-center" style={{ width: 88 }}>
                  {renamingId === page.id ? (
                    <input
                      ref={renameRef}
                      className="w-full rounded-md border border-accent/60 bg-black/72 px-1 py-0 text-center text-[10px] text-white outline-none"
                      value={renameValue}
                      onInput={(e) => setRenameValue((e.target as HTMLInputElement).value)}
                      onBlur={finishRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") finishRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                    />
                  ) : (
                    <span
                      className={`text-[10px] truncate block ${
                        isActive ? "font-bold text-white" : "font-semibold text-white/42"
                      }`}
                    >
                      {page.title}
                    </span>
                  )}
                </div>

                {menuPageId === page.id && (
                  <div
                    ref={menuRef}
                    className="absolute bottom-full left-0 z-30 mb-2 min-w-[140px] overflow-hidden rounded-xl border border-white/[0.1] bg-black/82 py-1 shadow-[0_18px_60px_rgb(0_0_0_/_0.48)] backdrop-blur-xl"
                  >
                    <button
                      className="flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left text-xs font-semibold text-white/56 hover:bg-white/[0.07] hover:text-white"
                      onClick={() => startRename(page.id, page.title)}
                    >
                      <Pencil size={12} />
                      Rename
                    </button>
                    <button
                      className="flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left text-xs font-semibold text-white/56 hover:bg-white/[0.07] hover:text-white"
                      onClick={() => {
                        setMenuPageId(null);
                        duplicatePage(page.id);
                      }}
                    >
                      <Copy size={12} />
                      Duplicate
                    </button>
                    {pages.length > 1 && (
                      <button
                        className="flex w-full items-center gap-2 bg-transparent px-3 py-2 text-left text-xs font-semibold text-red-100/70 hover:bg-red-500/16 hover:text-red-50"
                        onClick={() => {
                          setMenuPageId(null);
                          deletePage(page.id);
                        }}
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <button
            className="flex h-[62px] w-11 shrink-0 items-center justify-center rounded-xl border border-dashed border-white/[0.18] bg-white/[0.035] transition-all hover:border-accent/60 hover:bg-accent/10"
            onClick={() => addPage()}
            title="Add page"
          >
            <Plus size={16} className="text-white/48" />
          </button>
        </div>
      )}
    </div>
  );
}
