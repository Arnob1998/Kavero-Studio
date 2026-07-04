import { useState } from "react";
import { Trash2, Edit3, Plus } from "lucide-react";
import { useEditor } from "@/modules/canvas/state/context";

export function DesignList() {
  const { designs, activeDesign, createDesign, loadDesign, deleteDesign, renameDesign, navigate } =
    useEditor();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setEditName(name);
  };

  const finishRename = () => {
    if (editingId && editName.trim()) renameDesign(editingId, editName.trim());
    setEditingId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-xs font-bold text-white shadow-[0_12px_32px_rgb(59_130_246_/_0.2)] transition-all hover:bg-accent-hover"
        onClick={createDesign}
      >
        <Plus size={14} />
        New Design
      </button>

      {designs.length === 0 && (
        <p className="py-4 text-center text-[11px] font-semibold text-white/38">No saved designs yet</p>
      )}

      {designs.map((d) => (
        <div
          key={d.id}
          className={`group flex cursor-pointer items-center rounded-xl border px-2.5 py-2 transition-all ${
            activeDesign?.id === d.id
              ? "border-accent/70 bg-accent/12"
              : "border-white/[0.08] bg-white/[0.04] hover:border-white/[0.18] hover:bg-white/[0.065]"
          }`}
          onClick={() => {
            navigate(`/design/${d.id}`);
            loadDesign(d.id);
          }}
        >
          {editingId === d.id ? (
            <input
              className="flex-1 rounded-lg border border-accent/60 bg-black/72 px-2 py-1 text-xs text-white outline-none"
              value={editName}
              onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
              onBlur={finishRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") finishRename();
                if (e.key === "Escape") setEditingId(null);
              }}
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="flex-1 min-w-0">
              <span className="block truncate text-xs font-semibold text-white/68">{d.name}</span>
              <span className="text-[10px] font-semibold text-white/34">
                {d.width}x{d.height} &middot;{" "}
                {new Date(d.updated_at).toLocaleDateString()}
              </span>
            </div>
          )}
          <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ml-1">
            <button
              className="grid h-6 w-6 place-items-center rounded-md text-white/42 transition-colors hover:bg-white/[0.08] hover:text-white"
              onClick={(e) => {
                e.stopPropagation();
                startRename(d.id, d.name);
              }}
            >
              <Edit3 size={12} />
            </button>
            <button
              className="grid h-6 w-6 place-items-center rounded-md text-white/42 transition-colors hover:bg-red-500/16 hover:text-red-100"
              onClick={(e) => {
                e.stopPropagation();
                deleteDesign(d.id);
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
