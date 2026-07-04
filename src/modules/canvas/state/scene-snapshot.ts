import * as fabric from "fabric";
import { normalizeRotationDegrees } from "@/modules/canvas/utils/rotation";

export const SERIALIZED_CANVAS_PROPS = [
  "kaveroId",
  "kaveroKind",
  "kaveroMeta",
  "kaveroAssetSrc",
  "kaveroCrop",
  "kaveroBorderRadius",
  "kaveroMissingAssetSrc",
  "_isBgImage",
  "kaveroBgSrc",
  "kaveroBgFit",
] as const;

const canvasAssetUrlPattern = /^\/api\/canvas\/assets\/[a-zA-Z0-9_-]+$/;

fabric.FabricObject.customProperties = Array.from(
  new Set([...(fabric.FabricObject.customProperties ?? []), ...SERIALIZED_CANVAS_PROPS]),
);

export interface CanvasSceneSnapshotOptions {
  designId?: string | null;
  pageId?: string | null;
  includeHelpers?: boolean;
  /** Logical canvas width in pixels. Overrides canvas.getWidth() which may return DPR-scaled physical pixels. */
  canvasWidth?: number;
  /** Logical canvas height in pixels. Overrides canvas.getHeight() which may return DPR-scaled physical pixels. */
  canvasHeight?: number;
}

export interface CanvasSceneSnapshot {
  version: 1;
  designId: string | null;
  pageId: string | null;
  canvas: {
    width: number;
    height: number;
  };
  selectedObjectIds: string[];
  background: SceneBackgroundSnapshot;
  objects: SceneObjectSnapshot[];
}

export type SceneBackgroundSnapshot =
  | { kind: "none" }
  | { kind: "color"; value: string }
  | { kind: "image"; objectId: string; fit: string | null; asset: SceneImageAssetSnapshot; bounds: SceneBoundsSnapshot };

export interface SceneObjectSnapshot {
  id: string;
  kind: "text" | "image" | "shape" | "group" | "background-image" | "missing-asset" | "helper" | "unknown";
  type: string;
  zIndex: number;
  visible: boolean;
  locked: boolean;
  lockState: {
    movementX: boolean;
    movementY: boolean;
    scalingX: boolean;
    scalingY: boolean;
    rotation: boolean;
  };
  bounds: SceneBoundsSnapshot;
  normalizedBounds: SceneNormalizedBoundsSnapshot;
  transform: SceneTransformSnapshot;
  canvasFit: SceneCanvasFitSnapshot;
  center: { x: number; y: number };
  rotation: number;
  scale: { x: number; y: number };
  styles: Record<string, unknown>;
  effects: SceneEffectsSnapshot;
  text: string | null;
  textMetrics: SceneTextMetricsSnapshot | null;
  image: SceneImageAssetSnapshot | null;
  parentId: string | null;
  childIds: string[];
}

export interface SceneBoundsSnapshot {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SceneNormalizedBoundsSnapshot {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
}

export interface SceneTransformSnapshot {
  left: number;
  top: number;
  width: number;
  height: number;
  scaledWidth: number;
  scaledHeight: number;
  originX: string;
  originY: string;
  flipX: boolean;
  flipY: boolean;
  skewX: number;
  skewY: number;
}

export interface SceneCanvasFitSnapshot {
  insideCanvas: boolean;
  overflow: {
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  visibleAreaRatio: number;
}

export interface SceneEffectsSnapshot {
  shadow: {
    color: string;
    blur: number;
    offsetX: number;
    offsetY: number;
  } | null;
  blur: number;
  blendMode: string;
}

export interface SceneTextMetricsSnapshot {
  lineCount: number;
  textHeight: number;
  containerHeight: number;
  overflows: boolean;
}

export interface SceneImageAssetSnapshot {
  src: string | null;
  status: "available" | "missing" | "invalid";
  missingSource?: string;
  sourceWidth?: number;
  sourceHeight?: number;
  crop?: {
    unit: "source_px";
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export function normalizeCanvasAssetUrl(url: string | null | undefined) {
  if (!url) return null;
  if (canvasAssetUrlPattern.test(url)) return url;
  try {
    const parsed = new URL(url, "http://kavero.local");
    return canvasAssetUrlPattern.test(parsed.pathname) ? parsed.pathname : null;
  } catch {
    return null;
  }
}

export function createObjectId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `obj_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function ensureObjectId(obj: fabric.FabricObject) {
  if (!(obj as any).kaveroId) {
    obj.set("kaveroId" as any, createObjectId());
  }
}

export function ensureObjectIds(canvas: fabric.Canvas) {
  canvas.getObjects().forEach(ensureObjectId);
}

export function resetObjectIds(obj: fabric.FabricObject) {
  obj.set("kaveroId" as any, createObjectId());
  const children = (obj as any)._objects;
  if (Array.isArray(children)) children.forEach(resetObjectIds);
}

export function normalizeCanvasImageSources<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    value.forEach((item) => normalizeCanvasImageSources(item));
    return value;
  }

  const record = value as Record<string, unknown>;
  const stableSrc =
    typeof record.kaveroAssetSrc === "string"
      ? record.kaveroAssetSrc
      : typeof record.kaveroBgSrc === "string"
        ? record.kaveroBgSrc
        : typeof record.src === "string"
          ? record.src
          : null;

  const normalizedSrc = normalizeCanvasAssetUrl(stableSrc);
  if (normalizedSrc) {
    record.src = normalizedSrc;
    record.kaveroAssetSrc = normalizedSrc;
    if (typeof record.kaveroBgSrc === "string") record.kaveroBgSrc = normalizedSrc;
    record.crossOrigin = "anonymous";
  }

  if (typeof record.kaveroBgSrc === "string" || record.kaveroKind === "background-image") {
    record._isBgImage = true;
    record.kaveroKind = "background-image";
    record.selectable = false;
    record.evented = false;
    record.hasControls = false;
    record.lockMovementX = true;
    record.lockMovementY = true;
    record.lockScalingX = true;
    record.lockScalingY = true;
    record.lockRotation = true;
  }

  Object.values(record).forEach((item) => normalizeCanvasImageSources(item));
  return value;
}

export function getImageSource(obj: fabric.FabricObject) {
  const source = (obj as any).kaveroAssetSrc ?? (obj as any).kaveroBgSrc ?? (obj as any).getSrc?.() ?? (obj as any).src;
  if (typeof source !== "string") return null;
  return normalizeCanvasAssetUrl(source) ?? source;
}

export function isBackgroundImageObject(obj: fabric.FabricObject) {
  return Boolean((obj as any)._isBgImage) || (obj as any).kaveroKind === "background-image" || Boolean((obj as any).kaveroBgSrc);
}

export function isEditorHelperObject(obj: fabric.FabricObject) {
  return (obj as any).kaveroKind === "smart-guide" || (obj as any).kaveroKind === "crop-helper";
}

export function isNonSceneObject(obj: fabric.FabricObject) {
  return isEditorHelperObject(obj) || isBackgroundImageObject(obj);
}

export function serializeCanvas(canvas: fabric.Canvas) {
  ensureObjectIds(canvas);
  canvas.getObjects().forEach((obj) => {
    const stableSrc = normalizeCanvasAssetUrl((obj as any).kaveroAssetSrc ?? (obj as any).kaveroBgSrc ?? getImageSource(obj));
    if (stableSrc) {
      obj.set({ src: stableSrc, kaveroAssetSrc: stableSrc, crossOrigin: "anonymous" } as any);
      if (isBackgroundImageObject(obj)) {
        obj.set({
          _isBgImage: true,
          kaveroKind: "background-image",
          kaveroBgSrc: stableSrc,
          selectable: false,
          evented: false,
          hasControls: false,
        } as any);
      }
    }
  });
  return JSON.stringify(normalizeCanvasImageSources((canvas.toJSON as any)(SERIALIZED_CANVAS_PROPS)));
}

export function getObjectBounds(obj: fabric.FabricObject) {
  const rect = obj.getBoundingRect();
  return {
    left: rect.left,
    right: rect.left + rect.width,
    top: rect.top,
    bottom: rect.top + rect.height,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

export function createCanvasSceneSnapshot(
  canvas: fabric.Canvas,
  options: CanvasSceneSnapshotOptions = {},
): CanvasSceneSnapshot {
  ensureObjectIds(canvas);
  const allObjects = canvas.getObjects();
  const backgroundObject = allObjects.find(isBackgroundImageObject);
  const includedObjects = allObjects.filter((obj) => {
    if (isBackgroundImageObject(obj)) return options.includeHelpers === true;
    if (isEditorHelperObject(obj)) return options.includeHelpers === true;
    return true;
  });
  const cw = options.canvasWidth ?? canvas.getWidth();
  const ch = options.canvasHeight ?? canvas.getHeight();
  const objects = includedObjects.flatMap((obj) => createObjectSnapshots(obj, allObjects.indexOf(obj), null, cw, ch));
  const activeSelection = new Set(
    canvas
      .getActiveObjects()
      .filter((obj) => !isNonSceneObject(obj))
      .map((obj) => String((obj as any).kaveroId)),
  );

  return {
    version: 1,
    designId: options.designId ?? null,
    pageId: options.pageId ?? null,
    canvas: {
      width: cw,
      height: ch,
    },
    selectedObjectIds: Array.from(activeSelection),
    background: createBackgroundSnapshot(canvas, backgroundObject),
    objects,
  };
}

function createBackgroundSnapshot(canvas: fabric.Canvas, bgObj: fabric.FabricObject | undefined): SceneBackgroundSnapshot {
  if (bgObj) {
    ensureObjectId(bgObj);
    const bounds = getObjectBounds(bgObj);
    return {
      kind: "image",
      objectId: String((bgObj as any).kaveroId),
      fit: typeof (bgObj as any).kaveroBgFit === "string" ? (bgObj as any).kaveroBgFit : null,
      asset: createImageAssetSnapshot(bgObj) ?? { src: null, status: "invalid" },
      bounds: boundsSnapshot(bounds),
    };
  }

  const backgroundColor = canvas.backgroundColor;
  if (typeof backgroundColor === "string" && backgroundColor.trim()) {
    return { kind: "color", value: backgroundColor };
  }

  return { kind: "none" };
}

function createObjectSnapshots(obj: fabric.FabricObject, zIndex: number, parentId: string | null, cw: number, ch: number): SceneObjectSnapshot[] {
  const snapshot = createObjectSnapshot(obj, zIndex, parentId, cw, ch);
  const children = getGroupChildren(obj).flatMap((child, index) => createObjectSnapshots(child, zIndex + (index + 1) / 1000, snapshot.id, cw, ch));
  return [snapshot, ...children];
}

function createObjectSnapshot(obj: fabric.FabricObject, zIndex: number, parentId: string | null, canvasWidth: number, canvasHeight: number): SceneObjectSnapshot {
  ensureObjectId(obj);
  const bounds = getObjectBounds(obj);
  const lockState = {
    movementX: Boolean(obj.lockMovementX),
    movementY: Boolean(obj.lockMovementY),
    scalingX: Boolean(obj.lockScalingX),
    scalingY: Boolean(obj.lockScalingY),
    rotation: Boolean(obj.lockRotation),
  };

  return {
    id: String((obj as any).kaveroId),
    kind: sceneKindForObject(obj),
    type: obj.type ?? obj.constructor.name,
    zIndex,
    visible: obj.visible !== false,
    locked: Object.values(lockState).some(Boolean) || obj.selectable === false || obj.evented === false,
    lockState,
    bounds: boundsSnapshot(bounds),
    normalizedBounds: normalizedBoundsSnapshot(bounds, canvasWidth, canvasHeight),
    transform: transformSnapshot(obj),
    canvasFit: canvasFitSnapshot(bounds, canvasWidth, canvasHeight),
    center: {
      x: bounds.centerX,
      y: bounds.centerY,
    },
    rotation: normalizeRotationDegrees(obj.angle ?? 0),
    scale: {
      x: obj.scaleX ?? 1,
      y: obj.scaleY ?? 1,
    },
    styles: createStyleSnapshot(obj),
    effects: createEffectsSnapshot(obj),
    text: getTextContent(obj),
    textMetrics: createTextMetricsSnapshot(obj),
    image: createImageAssetSnapshot(obj),
    parentId,
    childIds: getGroupChildren(obj).map((child) => {
      ensureObjectId(child);
      return String((child as any).kaveroId);
    }),
  };
}

function getGroupChildren(obj: fabric.FabricObject): fabric.FabricObject[] {
  const children = (obj as any)._objects;
  return Array.isArray(children) ? children : [];
}

function boundsSnapshot(bounds: ReturnType<typeof getObjectBounds>): SceneBoundsSnapshot {
  return {
    left: bounds.left,
    top: bounds.top,
    right: bounds.right,
    bottom: bounds.bottom,
    width: bounds.width,
    height: bounds.height,
  };
}

function normalizedBoundsSnapshot(bounds: ReturnType<typeof getObjectBounds>, cw: number, ch: number): SceneNormalizedBoundsSnapshot {
  const safeW = cw || 1;
  const safeH = ch || 1;
  return {
    x: round4(bounds.left / safeW),
    y: round4(bounds.top / safeH),
    w: round4(bounds.width / safeW),
    h: round4(bounds.height / safeH),
    cx: round4(bounds.centerX / safeW),
    cy: round4(bounds.centerY / safeH),
  };
}

function transformSnapshot(obj: fabric.FabricObject): SceneTransformSnapshot {
  return {
    left: round2(obj.left ?? 0),
    top: round2(obj.top ?? 0),
    width: round2(obj.width ?? 0),
    height: round2(obj.height ?? 0),
    scaledWidth: round2(obj.getScaledWidth?.() ?? (obj.width ?? 0) * (obj.scaleX ?? 1)),
    scaledHeight: round2(obj.getScaledHeight?.() ?? (obj.height ?? 0) * (obj.scaleY ?? 1)),
    originX: String(obj.originX ?? "left"),
    originY: String(obj.originY ?? "top"),
    flipX: Boolean(obj.flipX),
    flipY: Boolean(obj.flipY),
    skewX: round2(obj.skewX ?? 0),
    skewY: round2(obj.skewY ?? 0),
  };
}

function canvasFitSnapshot(
  bounds: ReturnType<typeof getObjectBounds>,
  canvasWidth: number,
  canvasHeight: number,
): SceneCanvasFitSnapshot {
  const overflow = {
    left: round2(Math.max(0, -bounds.left)),
    top: round2(Math.max(0, -bounds.top)),
    right: round2(Math.max(0, bounds.right - canvasWidth)),
    bottom: round2(Math.max(0, bounds.bottom - canvasHeight)),
  };
  const visibleWidth = Math.max(0, Math.min(bounds.right, canvasWidth) - Math.max(bounds.left, 0));
  const visibleHeight = Math.max(0, Math.min(bounds.bottom, canvasHeight) - Math.max(bounds.top, 0));
  const totalArea = Math.max(1, bounds.width * bounds.height);
  return {
    insideCanvas: overflow.left === 0 && overflow.top === 0 && overflow.right === 0 && overflow.bottom === 0,
    overflow,
    visibleAreaRatio: round4((visibleWidth * visibleHeight) / totalArea),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function round4(n: number) {
  return Math.round(n * 10000) / 10000;
}

function createEffectsSnapshot(obj: fabric.FabricObject): SceneEffectsSnapshot {
  const rawShadow = obj.shadow;
  let shadow: SceneEffectsSnapshot["shadow"] = null;
  if (rawShadow && typeof rawShadow === "object") {
    const s = rawShadow as { color?: string; blur?: number; offsetX?: number; offsetY?: number };
    shadow = {
      color: typeof s.color === "string" ? s.color : "rgba(0,0,0,0.3)",
      blur: typeof s.blur === "number" ? s.blur : 0,
      offsetX: typeof s.offsetX === "number" ? s.offsetX : 0,
      offsetY: typeof s.offsetY === "number" ? s.offsetY : 0,
    };
  }

  let blur = 0;
  const filters = (obj as any).filters;
  if (Array.isArray(filters)) {
    for (const filter of filters) {
      if (filter && typeof filter === "object" && (filter.type === "Blur" || filter.constructor?.name === "Blur")) {
        blur = typeof filter.blur === "number" ? filter.blur : 0;
        break;
      }
    }
  }

  return {
    shadow,
    blur,
    blendMode: typeof (obj as any).globalCompositeOperation === "string" ? (obj as any).globalCompositeOperation : "source-over",
  };
}

function createTextMetricsSnapshot(obj: fabric.FabricObject): SceneTextMetricsSnapshot | null {
  if (!(obj instanceof fabric.Textbox) && !(obj instanceof fabric.IText) && !(obj instanceof fabric.Text)) return null;
  const t = obj as fabric.Textbox;
  const lineCount = Array.isArray(t.textLines) ? t.textLines.length : 1;
  const textHeight = typeof (t as any).calcTextHeight === "function" ? Math.round((t as any).calcTextHeight()) : 0;
  const containerHeight = Math.round((t.height ?? 0) * (t.scaleY ?? 1));
  return {
    lineCount,
    textHeight,
    containerHeight,
    overflows: textHeight > containerHeight + 2,
  };
}

function sceneKindForObject(obj: fabric.FabricObject): SceneObjectSnapshot["kind"] {
  if (isEditorHelperObject(obj)) return "helper";
  if (isBackgroundImageObject(obj)) return "background-image";
  if ((obj as any).kaveroKind === "missing-asset") return "missing-asset";
  if (obj instanceof fabric.Textbox || obj instanceof fabric.IText || obj instanceof fabric.Text) return "text";
  if (obj instanceof fabric.FabricImage) return "image";
  if (obj instanceof fabric.Group || obj instanceof fabric.ActiveSelection) return "group";
  if (
    obj instanceof fabric.Rect ||
    obj instanceof fabric.Circle ||
    obj instanceof fabric.Triangle ||
    obj instanceof fabric.Line ||
    obj instanceof fabric.Path
  ) {
    return "shape";
  }
  return "unknown";
}

function createStyleSnapshot(obj: fabric.FabricObject) {
  const record: Record<string, unknown> = {};
  for (const key of [
    "fill",
    "stroke",
    "strokeWidth",
    "opacity",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "underline",
    "textAlign",
    "lineHeight",
    "charSpacing",
    "rx",
    "ry",
    "radius",
    "flipX",
    "flipY",
  ]) {
    const value = (obj as any)[key];
    if (value === undefined || typeof value === "function") continue;
    record[key] = serializeStyleValue(value);
  }
  return record;
}

function serializeStyleValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(serializeStyleValue);
  const maybeGradient = value as { type?: unknown; colorStops?: unknown; coords?: unknown; gradientUnits?: unknown; offsetX?: unknown; offsetY?: unknown };
  if (typeof maybeGradient.type === "string" && maybeGradient.colorStops) {
    return {
      type: maybeGradient.type,
      coords: maybeGradient.coords,
      colorStops: Array.isArray(maybeGradient.colorStops)
        ? maybeGradient.colorStops.map((stop: any) => ({ offset: stop.offset, color: stop.color }))
        : maybeGradient.colorStops,
      gradientUnits: maybeGradient.gradientUnits,
      offsetX: maybeGradient.offsetX,
      offsetY: maybeGradient.offsetY,
    };
  }
  return String(value);
}

function getTextContent(obj: fabric.FabricObject) {
  if (obj instanceof fabric.Textbox || obj instanceof fabric.IText || obj instanceof fabric.Text) {
    return obj.text ?? "";
  }
  return null;
}

function createImageAssetSnapshot(obj: fabric.FabricObject): SceneImageAssetSnapshot | null {
  const missingSource = typeof (obj as any).kaveroMissingAssetSrc === "string" ? (obj as any).kaveroMissingAssetSrc : null;
  if (missingSource) {
    return {
      src: normalizeCanvasAssetUrl(missingSource),
      status: "missing",
      missingSource,
    };
  }

  const source = getImageSource(obj);
  if (!source) return null;
  const normalized = normalizeCanvasAssetUrl(source);
  const element = obj instanceof fabric.FabricImage ? obj.getElement() as HTMLImageElement | HTMLCanvasElement | undefined : undefined;
  const sourceWidth = element instanceof HTMLImageElement ? element.naturalWidth : element?.width;
  const sourceHeight = element instanceof HTMLImageElement ? element.naturalHeight : element?.height;
  const crop = (obj as any).kaveroCrop;
  return {
    src: normalized,
    status: normalized ? "available" : "invalid",
    sourceWidth: typeof sourceWidth === "number" ? sourceWidth : undefined,
    sourceHeight: typeof sourceHeight === "number" ? sourceHeight : undefined,
    crop: crop && typeof crop === "object" ? crop : undefined,
  };
}
