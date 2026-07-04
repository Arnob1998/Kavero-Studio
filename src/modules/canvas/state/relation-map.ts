import type { CanvasSceneSnapshot, SceneBoundsSnapshot, SceneObjectSnapshot } from "@/modules/canvas/state/scene-snapshot";

export type SceneRelationType =
  | "contains"
  | "inside"
  | "above"
  | "below"
  | "left-of"
  | "right-of"
  | "overlaps"
  | "aligned-left"
  | "aligned-center"
  | "aligned-right"
  | "aligned-top"
  | "aligned-middle"
  | "aligned-bottom"
  | "same-size"
  | "same-style"
  | "repeated-item";

export type SceneSemanticRole =
  | "background"
  | "heading"
  | "subtitle"
  | "button"
  | "card"
  | "icon"
  | "image"
  | "section"
  | "decorative"
  | "text"
  | "shape"
  | "group"
  | "unknown";

export interface SceneRelationMap {
  version: 1;
  designId: string | null;
  pageId: string | null;
  canvas: CanvasSceneSnapshot["canvas"];
  nodes: SceneRelationNode[];
  edges: SceneRelationEdge[];
}

export interface SceneRelationNode {
  id: string;
  objectId: string | null;
  type: string;
  kind: SceneObjectSnapshot["kind"] | "background";
  role: SceneSemanticRole;
  bounds: SceneBoundsSnapshot | null;
  zIndex: number | null;
  visible: boolean;
  metadata?: Record<string, unknown>;
}

export interface SceneRelationEdge {
  id: string;
  from: string;
  to: string;
  type: SceneRelationType;
  confidence: number;
  distance?: number;
  metadata?: Record<string, unknown>;
}

const ALIGN_TOLERANCE = 6;
const SIZE_TOLERANCE = 4;
const CENTER_TOLERANCE = 8;
const MIN_OVERLAP_AXIS_RATIO = 0.2;

export function createCanvasRelationMap(snapshot: CanvasSceneSnapshot): SceneRelationMap {
  const objects = snapshot.objects.filter((object) => object.visible);
  const roleById = new Map<string, SceneSemanticRole>();
  const containmentByChild = findContainmentParents(objects);

  for (const object of objects) {
    roleById.set(object.id, inferSemanticRole(object, snapshot, containmentByChild));
  }

  const nodes: SceneRelationNode[] = [];
  if (snapshot.background.kind !== "none") {
    nodes.push({
      id: backgroundNodeId(snapshot),
      objectId: snapshot.background.kind === "image" ? snapshot.background.objectId : null,
      type: snapshot.background.kind,
      kind: "background",
      role: "background",
      bounds: snapshot.background.kind === "image" ? snapshot.background.bounds : fullCanvasBounds(snapshot),
      zIndex: null,
      visible: true,
      metadata:
        snapshot.background.kind === "image"
          ? { fit: snapshot.background.fit, asset: snapshot.background.asset }
          : { value: snapshot.background.value },
    });
  }

  nodes.push(
    ...objects.map((object): SceneRelationNode => ({
      id: object.id,
      objectId: object.id,
      type: object.type,
      kind: object.kind,
      role: roleById.get(object.id) ?? "unknown",
      bounds: object.bounds,
      zIndex: object.zIndex,
      visible: object.visible,
      metadata: {
        text: object.text,
        image: object.image,
        locked: object.locked,
      },
    })),
  );

  const edges: SceneRelationEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (edge: Omit<SceneRelationEdge, "id">) => {
    const key = `${edge.from}:${edge.to}:${edge.type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ ...edge, id: key });
  };

  for (const object of objects) {
    if (!object.parentId) continue;
    addEdge({
      from: object.parentId,
      to: object.id,
      type: "contains",
      confidence: 1,
      metadata: { source: "fabric-group" },
    });
    addEdge({
      from: object.id,
      to: object.parentId,
      type: "inside",
      confidence: 1,
      metadata: { source: "fabric-group" },
    });
  }

  for (const [childId, parentId] of containmentByChild) {
    addEdge({
      from: parentId,
      to: childId,
      type: "contains",
      confidence: 0.88,
      metadata: { source: "geometry" },
    });
    addEdge({
      from: childId,
      to: parentId,
      type: "inside",
      confidence: 0.88,
      metadata: { source: "geometry" },
    });
  }

  for (let i = 0; i < objects.length; i += 1) {
    for (let j = i + 1; j < objects.length; j += 1) {
      addPairRelations(objects[i], objects[j], addEdge);
    }
  }

  addRepeatedItemEdges(objects, roleById, addEdge);

  return {
    version: 1,
    designId: snapshot.designId,
    pageId: snapshot.pageId,
    canvas: snapshot.canvas,
    nodes,
    edges: edges.sort(compareEdges),
  };
}

function inferSemanticRole(
  object: SceneObjectSnapshot,
  snapshot: CanvasSceneSnapshot,
  containmentByChild: Map<string, string>,
): SceneSemanticRole {
  if (object.kind === "background-image") return "background";
  if (object.kind === "image") {
    return isSmallObject(object, snapshot, 72) ? "icon" : "image";
  }
  if (object.kind === "group") return "group";
  if (object.kind === "text") {
    const fontSize = numberStyle(object, "fontSize");
    const weight = String(object.styles.fontWeight ?? "");
    const isBold = weight === "700" || weight.toLowerCase() === "bold" || Number(weight) >= 650;
    if (fontSize >= 32 || (fontSize >= 26 && isBold)) return "heading";
    if (fontSize >= 18 && object.bounds.top < snapshot.canvas.height * 0.45) return "subtitle";
    return "text";
  }
  if (object.kind === "shape") {
    const children = objectsInside(object.id, containmentByChild);
    const areaRatio = area(object.bounds) / Math.max(1, snapshot.canvas.width * snapshot.canvas.height);
    const radius = Math.max(numberStyle(object, "rx"), numberStyle(object, "ry"), numberStyle(object, "radius"));
    if (object.bounds.width >= snapshot.canvas.width * 0.65 && object.bounds.height >= snapshot.canvas.height * 0.15) return "section";
    if (children.length > 0 && radius >= 6 && object.bounds.height <= 96) return "button";
    if (children.length > 0 && areaRatio >= 0.04) return "card";
    if (isSmallObject(object, snapshot, 72)) return "icon";
    if ((object.styles.opacity as number | undefined) !== undefined && Number(object.styles.opacity) < 0.45) return "decorative";
    return "shape";
  }
  return "unknown";
}

function addPairRelations(
  a: SceneObjectSnapshot,
  b: SceneObjectSnapshot,
  addEdge: (edge: Omit<SceneRelationEdge, "id">) => void,
) {
  const overlap = intersection(a.bounds, b.bounds);
  if (overlap.area > 0) {
    addEdge({
      from: a.id,
      to: b.id,
      type: "overlaps",
      confidence: Math.min(0.95, overlap.area / Math.max(1, Math.min(area(a.bounds), area(b.bounds)))),
      metadata: { area: overlap.area },
    });
  }

  const horizontalOverlap = overlap.lengthX / Math.max(1, Math.min(a.bounds.width, b.bounds.width));
  const verticalOverlap = overlap.lengthY / Math.max(1, Math.min(a.bounds.height, b.bounds.height));
  if (a.bounds.bottom <= b.bounds.top && horizontalOverlap >= MIN_OVERLAP_AXIS_RATIO) {
    const distance = b.bounds.top - a.bounds.bottom;
    addEdge({ from: a.id, to: b.id, type: "above", distance, confidence: proximityConfidence(distance) });
    addEdge({ from: b.id, to: a.id, type: "below", distance, confidence: proximityConfidence(distance) });
  } else if (b.bounds.bottom <= a.bounds.top && horizontalOverlap >= MIN_OVERLAP_AXIS_RATIO) {
    const distance = a.bounds.top - b.bounds.bottom;
    addEdge({ from: b.id, to: a.id, type: "above", distance, confidence: proximityConfidence(distance) });
    addEdge({ from: a.id, to: b.id, type: "below", distance, confidence: proximityConfidence(distance) });
  }

  if (a.bounds.right <= b.bounds.left && verticalOverlap >= MIN_OVERLAP_AXIS_RATIO) {
    const distance = b.bounds.left - a.bounds.right;
    addEdge({ from: a.id, to: b.id, type: "left-of", distance, confidence: proximityConfidence(distance) });
    addEdge({ from: b.id, to: a.id, type: "right-of", distance, confidence: proximityConfidence(distance) });
  } else if (b.bounds.right <= a.bounds.left && verticalOverlap >= MIN_OVERLAP_AXIS_RATIO) {
    const distance = a.bounds.left - b.bounds.right;
    addEdge({ from: b.id, to: a.id, type: "left-of", distance, confidence: proximityConfidence(distance) });
    addEdge({ from: a.id, to: b.id, type: "right-of", distance, confidence: proximityConfidence(distance) });
  }

  addAlignmentEdges(a, b, addEdge);

  if (isSameSize(a, b)) {
    addEdge({
      from: a.id,
      to: b.id,
      type: "same-size",
      confidence: 0.92,
      metadata: { widthDelta: Math.abs(a.bounds.width - b.bounds.width), heightDelta: Math.abs(a.bounds.height - b.bounds.height) },
    });
  }

  if (styleSignature(a) && styleSignature(a) === styleSignature(b)) {
    addEdge({ from: a.id, to: b.id, type: "same-style", confidence: 0.9, metadata: { signature: styleSignature(a) } });
  }
}

function addAlignmentEdges(
  a: SceneObjectSnapshot,
  b: SceneObjectSnapshot,
  addEdge: (edge: Omit<SceneRelationEdge, "id">) => void,
) {
  const alignments: [SceneRelationType, number][] = [
    ["aligned-left", Math.abs(a.bounds.left - b.bounds.left)],
    ["aligned-center", Math.abs(a.center.x - b.center.x)],
    ["aligned-right", Math.abs(a.bounds.right - b.bounds.right)],
    ["aligned-top", Math.abs(a.bounds.top - b.bounds.top)],
    ["aligned-middle", Math.abs(a.center.y - b.center.y)],
    ["aligned-bottom", Math.abs(a.bounds.bottom - b.bounds.bottom)],
  ];

  for (const [type, delta] of alignments) {
    const tolerance = type === "aligned-center" || type === "aligned-middle" ? CENTER_TOLERANCE : ALIGN_TOLERANCE;
    if (delta <= tolerance) {
      addEdge({ from: a.id, to: b.id, type, confidence: 1 - delta / (tolerance + 1), distance: delta });
    }
  }
}

function addRepeatedItemEdges(
  objects: SceneObjectSnapshot[],
  roleById: Map<string, SceneSemanticRole>,
  addEdge: (edge: Omit<SceneRelationEdge, "id">) => void,
) {
  const buckets = new Map<string, SceneObjectSnapshot[]>();
  for (const object of objects) {
    const signature = repeatSignature(object, roleById.get(object.id) ?? "unknown");
    if (!signature) continue;
    buckets.set(signature, [...(buckets.get(signature) ?? []), object]);
  }

  let groupIndex = 0;
  for (const items of buckets.values()) {
    if (items.length < 3) continue;
    const sorted = [...items].sort((a, b) => a.bounds.top - b.bounds.top || a.bounds.left - b.bounds.left);
    const horizontal = hasConsistentSpacing([...items].sort((a, b) => a.bounds.left - b.bounds.left), "x");
    const vertical = hasConsistentSpacing(sorted, "y");
    if (!horizontal && !vertical) continue;
    const groupId = `repeat-${groupIndex}`;
    groupIndex += 1;
    const ordered = horizontal ? [...items].sort((a, b) => a.bounds.left - b.bounds.left) : sorted;
    for (let index = 0; index < ordered.length - 1; index += 1) {
      addEdge({
        from: ordered[index].id,
        to: ordered[index + 1].id,
        type: "repeated-item",
        confidence: 0.86,
        metadata: { groupId, axis: horizontal ? "x" : "y", index, count: ordered.length },
      });
    }
  }
}

function findContainmentParents(objects: SceneObjectSnapshot[]) {
  const byChild = new Map<string, string>();
  for (const child of objects) {
    if (child.parentId) continue;
    const candidates = objects
      .filter((parent) => parent.id !== child.id && !parent.parentId && containsBounds(parent.bounds, child.bounds))
      .sort((a, b) => area(a.bounds) - area(b.bounds));
    if (candidates[0]) byChild.set(child.id, candidates[0].id);
  }
  return byChild;
}

function containsBounds(parent: SceneBoundsSnapshot, child: SceneBoundsSnapshot) {
  if (area(parent) <= area(child)) return false;
  return child.left >= parent.left && child.right <= parent.right && child.top >= parent.top && child.bottom <= parent.bottom;
}

function objectsInside(parentId: string, containmentByChild: Map<string, string>) {
  return Array.from(containmentByChild.entries())
    .filter(([, candidateParentId]) => candidateParentId === parentId)
    .map(([childId]) => childId);
}

function intersection(a: SceneBoundsSnapshot, b: SceneBoundsSnapshot) {
  const lengthX = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const lengthY = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return { lengthX, lengthY, area: lengthX * lengthY };
}

function area(bounds: SceneBoundsSnapshot) {
  return bounds.width * bounds.height;
}

function fullCanvasBounds(snapshot: CanvasSceneSnapshot): SceneBoundsSnapshot {
  return {
    left: 0,
    top: 0,
    right: snapshot.canvas.width,
    bottom: snapshot.canvas.height,
    width: snapshot.canvas.width,
    height: snapshot.canvas.height,
  };
}

function backgroundNodeId(snapshot: CanvasSceneSnapshot) {
  return snapshot.background.kind === "image" ? snapshot.background.objectId : "canvas-background";
}

function numberStyle(object: SceneObjectSnapshot, key: string) {
  const value = object.styles[key];
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) || 0 : 0;
}

function isSmallObject(object: SceneObjectSnapshot, snapshot: CanvasSceneSnapshot, maxSize: number) {
  return object.bounds.width <= maxSize && object.bounds.height <= maxSize && area(object.bounds) < snapshot.canvas.width * snapshot.canvas.height * 0.02;
}

function proximityConfidence(distance: number) {
  return Math.max(0.35, Math.min(0.95, 1 - distance / 600));
}

function isSameSize(a: SceneObjectSnapshot, b: SceneObjectSnapshot) {
  return Math.abs(a.bounds.width - b.bounds.width) <= SIZE_TOLERANCE && Math.abs(a.bounds.height - b.bounds.height) <= SIZE_TOLERANCE;
}

function styleSignature(object: SceneObjectSnapshot) {
  const style = object.styles;
  const keys = ["fill", "stroke", "strokeWidth", "fontFamily", "fontSize", "fontWeight", "rx", "ry"];
  const parts = keys.map((key) => `${key}:${JSON.stringify(style[key] ?? null)}`);
  const meaningful = keys.some((key) => style[key] !== undefined && style[key] !== null && style[key] !== "");
  return meaningful ? `${object.kind}|${parts.join("|")}` : "";
}

function repeatSignature(object: SceneObjectSnapshot, role: SceneSemanticRole) {
  if (role === "decorative" || role === "background" || role === "unknown") return "";
  const width = Math.round(object.bounds.width / 8) * 8;
  const height = Math.round(object.bounds.height / 8) * 8;
  return `${role}|${object.kind}|${width}x${height}|${styleSignature(object)}`;
}

function hasConsistentSpacing(objects: SceneObjectSnapshot[], axis: "x" | "y") {
  if (objects.length < 3) return false;
  const deltas: number[] = [];
  for (let index = 0; index < objects.length - 1; index += 1) {
    deltas.push(axis === "x" ? objects[index + 1].bounds.left - objects[index].bounds.left : objects[index + 1].bounds.top - objects[index].bounds.top);
  }
  const expected = deltas[0];
  if (expected <= 0) return false;
  return deltas.every((delta) => Math.abs(delta - expected) <= 8);
}

function compareEdges(a: SceneRelationEdge, b: SceneRelationEdge) {
  return a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.type.localeCompare(b.type);
}
