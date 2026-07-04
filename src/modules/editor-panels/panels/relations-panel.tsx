import { AlertTriangle, Lock, Network } from "lucide-react";
import type { SceneRelationEdge, SceneRelationMap, SceneRelationNode } from "@/modules/canvas/state/relation-map";

export function RelationsPanel({
  map,
  selectedObjectId,
  selectedRelationId,
  onSelectObject,
  onSelectRelation,
}: {
  map: SceneRelationMap | null;
  selectedObjectId: string | null;
  selectedRelationId: string | null;
  onSelectObject: (id: string) => void;
  onSelectRelation: (edge: SceneRelationEdge) => void;
}) {
  const objectNodes = (map?.nodes ?? []).filter((node) => node.kind !== "background");
  const backgroundNodes = (map?.nodes ?? []).filter((node) => node.kind === "background");
  const edges = map?.edges ?? [];

  if (!map || (objectNodes.length === 0 && backgroundNodes.length === 0)) {
    return (
      <div className="grid min-h-45 place-items-center rounded-xl border border-white/8 bg-white/[0.035] px-4 text-center">
        <span>
          <Network size={22} className="mx-auto mb-2 text-white/34" />
          <span className="block text-[11px] font-semibold text-white/42">
            Add objects to inspect hierarchy and relations
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Objects" value={objectNodes.length} />
        <Metric label="Relations" value={edges.length} />
      </div>

      {backgroundNodes.length > 0 && (
        <section className="grid gap-2">
          <PanelHeading label="Background" count={backgroundNodes.length} />
          {backgroundNodes.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              relations={edges}
              selected={selectedObjectId === node.objectId}
              onSelectObject={onSelectObject}
            />
          ))}
        </section>
      )}

      <section className="grid gap-2">
        <PanelHeading label="Hierarchy" count={objectNodes.length} />
        {objectNodes.length === 0 ? (
          <EmptyMiniState label="No scene objects" />
        ) : (
          objectNodes.map((node) => (
            <NodeRow
              key={node.id}
              node={node}
              relations={edges}
              selected={selectedObjectId === node.objectId}
              onSelectObject={onSelectObject}
            />
          ))
        )}
      </section>

      <section className="grid gap-2">
        <PanelHeading label="Major Relations" count={edges.length} />
        {edges.length === 0 ? (
          <EmptyMiniState label="No relations detected" />
        ) : (
          edges.slice(0, 48).map((edge) => (
            <button
              key={edge.id}
              className={`rounded-xl border p-2 text-left transition ${
                selectedRelationId === edge.id
                  ? "border-accent/70 bg-accent/16"
                  : "border-white/8 bg-white/4 hover:border-white/16 hover:bg-white/6.5"
              }`}
              onClick={() => onSelectRelation(edge)}
              title={`${edge.from} ${edge.type} ${edge.to}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate text-[11px] font-black text-white/70">{formatRelationType(edge.type)}</span>
                <Confidence value={edge.confidence} />
              </span>
              <span className="mt-1 block truncate font-mono text-[10px] text-white/34">
                {shortId(edge.from)} {"->"} {shortId(edge.to)}
                {typeof edge.distance === "number" ? ` / ${Math.round(edge.distance)}px` : ""}
              </span>
            </button>
          ))
        )}
        {edges.length > 48 && (
          <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-[10px] font-semibold text-white/38">
            Showing 48 of {edges.length} relations
          </div>
        )}
      </section>
    </div>
  );
}

function NodeRow({
  node,
  relations,
  selected,
  onSelectObject,
}: {
  node: SceneRelationNode;
  relations: SceneRelationEdge[];
  selected: boolean;
  onSelectObject: (id: string) => void;
}) {
  const majorRelations = relations
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .filter((edge) => ["contains", "inside", "overlaps", "repeated-item", "above", "left-of"].includes(edge.type))
    .slice(0, 4);
  const children = relations.filter((edge) => edge.from === node.id && edge.type === "contains");
  const parent = relations.find((edge) => edge.from === node.id && edge.type === "inside");
  const missing = node.metadata && hasMissingAsset(node.metadata);

  return (
    <button
      className={`rounded-xl border p-2.5 text-left transition ${
        selected
          ? "border-accent/70 bg-accent/16 shadow-[0_12px_28px_rgb(59_130_246/0.18)]"
          : "border-white/8 bg-white/4 hover:border-white/16 hover:bg-white/6.5"
      }`}
      onClick={() => {
        if (node.objectId) onSelectObject(node.objectId);
      }}
      title={node.objectId ?? node.id}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-black text-white/74">{nodeLabel(node)}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-white/34">
            {node.kind} / {node.role}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {missing ? <AlertTriangle size={12} className="text-amber-300/80" /> : null}
          {node.metadata?.locked ? <Lock size={12} className="text-white/38" /> : null}
        </span>
      </span>

      {node.bounds ? (
        <span className="mt-2 grid grid-cols-2 gap-1 font-mono text-[10px] text-white/38">
          <span>
            x {Math.round(node.bounds.left)}, y {Math.round(node.bounds.top)}
          </span>
          <span className="text-right">
            {Math.round(node.bounds.width)} x {Math.round(node.bounds.height)}
          </span>
        </span>
      ) : null}

      <span className="mt-2 flex flex-wrap gap-1">
        {parent ? <Badge label={`parent ${shortId(parent.to)}`} /> : null}
        {children.length > 0 ? <Badge label={`${children.length} child${children.length === 1 ? "" : "ren"}`} /> : null}
        {majorRelations.map((edge) => (
          <Badge key={edge.id} label={`${formatRelationType(edge.type)} ${Math.round(edge.confidence * 100)}%`} />
        ))}
      </span>
    </button>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/4 p-2">
      <span className="block text-[10px] font-bold uppercase tracking-[0.08em] text-white/32">{label}</span>
      <span className="mt-1 block font-mono text-lg font-black text-white/76">{value}</span>
    </div>
  );
}

function PanelHeading({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between">
      <h3 className="m-0 text-[11px] font-black uppercase tracking-[0.08em] text-white/46">{label}</h3>
      <span className="rounded-full border border-white/8 bg-white/4 px-2 py-0.5 text-[10px] font-bold text-white/36">
        {count}
      </span>
    </div>
  );
}

function EmptyMiniState({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/3 px-3 py-4 text-center text-[11px] font-semibold text-white/38">
      {label}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rounded-md border border-white/8 bg-black/24 px-1.5 py-0.5 text-[9px] font-bold text-white/42">
      {label}
    </span>
  );
}

function Confidence({ value }: { value: number }) {
  return (
    <span className="rounded-md border border-white/8 bg-black/24 px-1.5 py-0.5 font-mono text-[9px] font-bold text-white/46">
      {Math.round(value * 100)}%
    </span>
  );
}

function nodeLabel(node: SceneRelationNode) {
  if (typeof node.metadata?.text === "string" && node.metadata.text.trim()) {
    return node.metadata.text.trim().slice(0, 38);
  }
  if (node.role === "background") return "Canvas background";
  return `${capitalize(node.role)} ${shortId(node.id)}`;
}

function formatRelationType(type: string) {
  return type.replace(/-/g, " ");
}

function shortId(id: string) {
  if (id === "canvas-background") return "background";
  return id.length > 10 ? `${id.slice(0, 7)}...` : id;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function hasMissingAsset(metadata: Record<string, unknown>) {
  const image = metadata.image as { status?: string } | null | undefined;
  return image?.status === "missing" || image?.status === "invalid";
}
