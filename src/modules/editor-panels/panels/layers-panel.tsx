import { Image as ImageIcon, GripVertical, Layers, Square, Type } from "lucide-react";

type LayerPanelItem = {
  id: string;
  kind: string;
  label: string;
  level: number;
  width: number;
  height: number;
  color?: string | null;
};

export function LayersPanel({
  layers,
  selectedLayerId,
  draggingLayerId,
  dropLevel,
  setDraggingLayerId,
  setDropLevel,
  selectLayer,
  moveLayerToLevel,
}: {
  layers: LayerPanelItem[];
  selectedLayerId: string | null;
  draggingLayerId: string | null;
  dropLevel: number | null;
  setDraggingLayerId: (id: string | null) => void;
  setDropLevel: (level: number | null | ((current: number | null) => number | null)) => void;
  selectLayer: (id: string) => void;
  moveLayerToLevel: (id: string, level: number) => void;
}) {
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between">
        <p className="m-0 text-[11px] font-semibold text-white/38">Top to bottom stack</p>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-white/42">
          {layers.length}
        </span>
      </div>
      {layers.length === 0 ? (
        <div className="grid min-h-[160px] place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-center">
          <span>
            <Layers size={22} className="mx-auto mb-2 text-white/34" />
            <span className="block text-[11px] font-semibold text-white/42">
              Add text, shapes, or uploads to build layers
            </span>
          </span>
        </div>
      ) : (
        <div className="grid gap-2">
          {layers.map((layer) => {
            const Icon = layer.kind === "text" ? Type : layer.kind === "image" ? ImageIcon : Square;
            const selected = selectedLayerId === layer.id;
            const dropping = dropLevel === layer.level && draggingLayerId !== layer.id;
            return (
              <div
                key={layer.id}
                className={`group grid grid-cols-[18px_36px_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border p-2 text-left transition ${
                  selected
                    ? "border-accent/70 bg-accent/16 shadow-[0_12px_28px_rgb(59_130_246_/_0.18)]"
                    : dropping
                      ? "border-fuchsia-400/70 bg-fuchsia-400/12"
                      : "border-white/8 bg-white/4 hover:border-white/16 hover:bg-white/6.5"
                }`}
                draggable
                onClick={() => selectLayer(layer.id)}
                onDragStart={(event) => {
                  setDraggingLayerId(layer.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-kavero-layer-id", layer.id);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setDropLevel(layer.level);
                }}
                onDragLeave={() => setDropLevel((current) => (current === layer.level ? null : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = event.dataTransfer.getData("application/x-kavero-layer-id") || draggingLayerId;
                  setDraggingLayerId(null);
                  setDropLevel(null);
                  if (!sourceId || sourceId === layer.id) return;
                  moveLayerToLevel(sourceId, layer.level);
                }}
                onDragEnd={() => {
                  setDraggingLayerId(null);
                  setDropLevel(null);
                }}
                title={`${layer.label} - level ${layer.level}`}
              >
                <GripVertical size={15} className="text-white/24 transition group-hover:text-white/46" />
                <span className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-lg border border-white/[0.1] bg-[linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%),linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%)] bg-[length:10px_10px] bg-[position:0_0,5px_5px]">
                  <span
                    className="absolute inset-1 rounded-md opacity-80"
                    style={{
                      background:
                        layer.kind === "image"
                          ? "rgba(255,255,255,0.08)"
                          : layer.color && /^#|rgb|hsl/i.test(layer.color)
                            ? layer.color
                            : "rgba(255,255,255,0.08)",
                    }}
                  />
                  <Icon size={15} className="relative text-white/82 drop-shadow" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-bold text-white/70">{layer.label}</span>
                  <span className="block truncate font-mono text-[10px] text-white/34">
                    {layer.width} x {layer.height}
                  </span>
                </span>
                <span className="rounded-lg border border-white/[0.08] bg-black/30 px-2 py-1 font-mono text-[10px] font-bold text-white/50">
                  {layer.level}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
