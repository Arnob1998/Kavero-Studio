import { useState, useCallback, useRef, useEffect } from "react";
import type { MutableRefObject } from "react";
import * as fabric from "fabric";
import type { BackgroundImageFit, CanvasLayer, ImageCropInput } from "@/modules/canvas/state/context";
import type { Template } from "@/modules/canvas/types/editor-types";
import { createGradient, gradientConfigFromString } from "@/modules/canvas/utils/gradient-utils";
import { createCanvasRelationMap } from "@/modules/canvas/state/relation-map";
import { normalizeRotationDegrees } from "@/modules/canvas/utils/rotation";
import {
  canvasToolFailure,
  canvasToolSuccess,
  executeCanvasTool as executeRegisteredCanvasTool,
  type CanvasToolName,
  type CanvasToolResult,
  type BlendMode,
} from "@/modules/canvas/actions/canvas-tool-registry";
import { createCanvasVisualPreview, type CanvasVisualPreview } from "@/modules/canvas/utils/canvas-visual-preview";
import {
  createCanvasSceneSnapshot,
  createObjectId,
  ensureObjectId,
  ensureObjectIds,
  getImageSource,
  getObjectBounds,
  isBackgroundImageObject,
  isNonSceneObject as isEditorHelperObject,
  normalizeCanvasAssetUrl,
  normalizeCanvasImageSources,
  resetObjectIds,
  serializeCanvas,
} from "@/modules/canvas/state/scene-snapshot";

export { normalizeCanvasImageSources } from "@/modules/canvas/state/scene-snapshot";

const MAX_HISTORY = 50;
const GUIDE_THRESHOLD = 12;
const SNAP_THRESHOLD = 4;
const CANVAS_GUIDE_STYLE = {
  stroke: "#22C55E",
  strokeWidth: 1,
  strokeDashArray: [6, 5],
  selectable: false,
  evented: false,
  excludeFromExport: true,
  opacity: 0.95,
};
const OBJECT_GUIDE_STYLE = {
  ...CANVAS_GUIDE_STYLE,
  stroke: "#F472B6",
};

const TEXT_PRESETS = {
  heading: { text: "Add a heading", fontSize: 48, fontWeight: "700", fontFamily: "Montserrat" },
  subheading: { text: "Add a subheading", fontSize: 32, fontWeight: "500", fontFamily: "Inter" },
  body: { text: "Add body text", fontSize: 18, fontWeight: "400", fontFamily: "Inter" },
} as const;

const SHAPE_DEFAULTS = {
  fill: "#3B82F6",
  stroke: "",
  strokeWidth: 0,
  opacity: 1,
};

const MIN_IMAGE_CROP_SIZE = 1;

interface CanvasHistory {
  entries: string[];
  index: number;
}

interface CanvasChangeMeta {
  width: number;
  height: number;
}

interface UseCanvasStateOptions {
  onCanvasChange?: (pageId: string, canvasJson: string, meta: CanvasChangeMeta) => void;
  onError?: (message: string) => void;
}

function clearSmartGuides(canvas: fabric.Canvas) {
  canvas
    .getObjects()
    .filter((obj) => (obj as any).kaveroKind === "smart-guide")
    .forEach((guide) => canvas.remove(guide));
}

function addSmartGuide(
  canvas: fabric.Canvas,
  orientation: "vertical" | "horizontal",
  position: number,
  length: number,
  source: "canvas" | "object",
) {
  const guide =
    orientation === "vertical"
      ? new fabric.Line([position, 0, position, length], source === "canvas" ? CANVAS_GUIDE_STYLE : OBJECT_GUIDE_STYLE)
      : new fabric.Line([0, position, length, position], source === "canvas" ? CANVAS_GUIDE_STYLE : OBJECT_GUIDE_STYLE);
  guide.set({ kaveroKind: "smart-guide" } as any);
  canvas.add(guide);
  canvas.bringObjectToFront(guide);
}

function applySmartGuides(
  canvas: fabric.Canvas,
  target: fabric.FabricObject,
  width: number,
  height: number,
  shouldSnap: boolean,
) {
  clearSmartGuides(canvas);
  if (!target.left || !target.top) return;

  const targetBounds = getObjectBounds(target);
  const xCandidates: { value: number; kind: "left" | "centerX" | "right"; guide: number; source: "canvas" | "object" }[] = [
    { value: 0, kind: "left" as const, guide: 0, source: "canvas" },
    { value: width / 2, kind: "centerX" as const, guide: width / 2, source: "canvas" },
    { value: width, kind: "right" as const, guide: width, source: "canvas" },
  ];
  const yCandidates: { value: number; kind: "top" | "centerY" | "bottom"; guide: number; source: "canvas" | "object" }[] = [
    { value: 0, kind: "top" as const, guide: 0, source: "canvas" },
    { value: height / 2, kind: "centerY" as const, guide: height / 2, source: "canvas" },
    { value: height, kind: "bottom" as const, guide: height, source: "canvas" },
  ];

  canvas.getObjects().forEach((obj) => {
    if (obj === target || (obj as any).kaveroKind === "smart-guide" || isBackgroundImageObject(obj)) return;
    const bounds = getObjectBounds(obj);
    xCandidates.push(
      { value: bounds.left, kind: "left", guide: bounds.left, source: "object" },
      { value: bounds.centerX, kind: "centerX", guide: bounds.centerX, source: "object" },
      { value: bounds.right, kind: "right", guide: bounds.right, source: "object" },
    );
    yCandidates.push(
      { value: bounds.top, kind: "top", guide: bounds.top, source: "object" },
      { value: bounds.centerY, kind: "centerY", guide: bounds.centerY, source: "object" },
      { value: bounds.bottom, kind: "bottom", guide: bounds.bottom, source: "object" },
    );
  });

  let nextLeft = target.left ?? 0;
  let nextTop = target.top ?? 0;
  let bestX: { delta: number; guide: number; source: "canvas" | "object" } | null = null;
  let bestY: { delta: number; guide: number; source: "canvas" | "object" } | null = null;

  for (const point of [
    { value: targetBounds.left, kind: "left" as const },
    { value: targetBounds.centerX, kind: "centerX" as const },
    { value: targetBounds.right, kind: "right" as const },
  ]) {
    for (const candidate of xCandidates) {
      const delta = candidate.value - point.value;
      if (Math.abs(delta) <= GUIDE_THRESHOLD && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
        bestX = { delta, guide: candidate.guide, source: candidate.source };
      }
    }
  }

  for (const point of [
    { value: targetBounds.top, kind: "top" as const },
    { value: targetBounds.centerY, kind: "centerY" as const },
    { value: targetBounds.bottom, kind: "bottom" as const },
  ]) {
    for (const candidate of yCandidates) {
      const delta = candidate.value - point.value;
      if (Math.abs(delta) <= GUIDE_THRESHOLD && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
        bestY = { delta, guide: candidate.guide, source: candidate.source };
      }
    }
  }

  if (bestX) {
    if (shouldSnap && Math.abs(bestX.delta) <= SNAP_THRESHOLD) {
    nextLeft += bestX.delta;
    }
    addSmartGuide(canvas, "vertical", bestX.guide, height, bestX.source);
  }
  if (bestY) {
    if (shouldSnap && Math.abs(bestY.delta) <= SNAP_THRESHOLD) {
    nextTop += bestY.delta;
    }
    addSmartGuide(canvas, "horizontal", bestY.guide, width, bestY.source);
  }

  if (shouldSnap && ((bestX && Math.abs(bestX.delta) <= SNAP_THRESHOLD) || (bestY && Math.abs(bestY.delta) <= SNAP_THRESHOLD))) {
    target.set({ left: nextLeft, top: nextTop });
    target.setCoords();
  }
}

function isAllowedCanvasImageUrl(url: string) {
  return Boolean(normalizeCanvasAssetUrl(url));
}

function layerKindForObject(obj: fabric.FabricObject): CanvasLayer["kind"] {
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

function layerLabelForObject(obj: fabric.FabricObject, kind: CanvasLayer["kind"]) {
  if (kind === "text") {
    const text = ((obj as fabric.Textbox).text ?? "").trim().replace(/\s+/g, " ");
    return text ? text.slice(0, 36) : "Text";
  }
  if (kind === "image") return (obj as any).kaveroMeta?.name ?? "Image";
  if (obj instanceof fabric.Rect) return "Rectangle";
  if (obj instanceof fabric.Circle) return "Circle";
  if (obj instanceof fabric.Triangle) return "Triangle";
  if (obj instanceof fabric.Line) return "Line";
  if (kind === "group") return "Group";
  return "Object";
}

function objectOverflowsCanvas(obj: fabric.FabricObject, canvasWidth: number, canvasHeight: number, padding: number) {
  obj.setCoords();
  const bounds = getObjectBounds(obj);
  return bounds.left < padding || bounds.top < padding || bounds.right > canvasWidth - padding || bounds.bottom > canvasHeight - padding;
}

function fitObjectInsideCanvas(obj: fabric.FabricObject, canvasWidth: number, canvasHeight: number, padding: number, preserveAspectRatio: boolean) {
  obj.setCoords();
  let bounds = getObjectBounds(obj);
  const safeWidth = Math.max(1, canvasWidth - padding * 2);
  const safeHeight = Math.max(1, canvasHeight - padding * 2);
  if (bounds.width > safeWidth || bounds.height > safeHeight) {
    const fitX = safeWidth / Math.max(1, bounds.width);
    const fitY = safeHeight / Math.max(1, bounds.height);
    if (preserveAspectRatio) {
      const fit = Math.min(fitX, fitY);
      obj.set({ scaleX: Math.max(0.01, (obj.scaleX ?? 1) * fit), scaleY: Math.max(0.01, (obj.scaleY ?? 1) * fit) });
    } else {
      obj.set({
        scaleX: Math.max(0.01, (obj.scaleX ?? 1) * Math.min(1, fitX)),
        scaleY: Math.max(0.01, (obj.scaleY ?? 1) * Math.min(1, fitY)),
      });
    }
    obj.setCoords();
    bounds = getObjectBounds(obj);
  }

  let dx = 0;
  let dy = 0;
  if (bounds.left < padding) dx = padding - bounds.left;
  else if (bounds.right > canvasWidth - padding) dx = canvasWidth - padding - bounds.right;
  if (bounds.top < padding) dy = padding - bounds.top;
  else if (bounds.bottom > canvasHeight - padding) dy = canvasHeight - padding - bounds.bottom;
  obj.set({ left: (obj.left ?? 0) + dx, top: (obj.top ?? 0) + dy });
  obj.setCoords();
}

function normalizeTextObject(
  obj: fabric.FabricObject,
  canvasWidth: number,
  canvasHeight: number,
  options: { maxWidth?: number; maxHeight?: number; padding: number },
) {
  const text = obj as fabric.Textbox;
  const maxWidth = Math.min(options.maxWidth ?? canvasWidth - options.padding * 2, canvasWidth - options.padding * 2);
  const maxHeight = Math.min(options.maxHeight ?? canvasHeight - options.padding * 2, canvasHeight - options.padding * 2);
  const currentBounds = getObjectBounds(obj);
  obj.set({ scaleX: 1, scaleY: 1, width: Math.max(1, Math.min(maxWidth, currentBounds.width || text.width || maxWidth)) } as any);
  const measuredHeight = () => typeof (text as any).calcTextHeight === "function" ? Number((text as any).calcTextHeight()) : Number(text.height ?? currentBounds.height);
  let fontSize = Number((text as any).fontSize ?? 24);
  for (let i = 0; i < 8 && measuredHeight() > maxHeight; i++) {
    fontSize = Math.max(8, fontSize * 0.9);
    obj.set({ fontSize } as any);
  }
  obj.set({ height: Math.min(maxHeight, Math.max(measuredHeight(), Number(text.height ?? 1))) } as any);
  obj.setCoords();
}

function layoutObjectsInStack(
  objects: fabric.FabricObject[],
  direction: "vertical" | "horizontal",
  bounds: { left: number; top: number; width: number; height: number },
  gap: number,
  align: "start" | "center" | "end",
) {
  const measure = () => objects.map((obj) => {
    obj.setCoords();
    return getObjectBounds(obj);
  });
  let objectBounds = measure();
  const totalMain = objectBounds.reduce((sum, item) => sum + (direction === "vertical" ? item.height : item.width), 0) + gap * Math.max(0, objects.length - 1);
  const maxCross = Math.max(...objectBounds.map((item) => (direction === "vertical" ? item.width : item.height)), 1);
  const fit = Math.min(
    1,
    direction === "vertical" ? bounds.height / Math.max(1, totalMain) : bounds.width / Math.max(1, totalMain),
    direction === "vertical" ? bounds.width / maxCross : bounds.height / maxCross,
  );
  if (fit < 1) {
    objects.forEach((obj) => obj.set({ scaleX: (obj.scaleX ?? 1) * fit, scaleY: (obj.scaleY ?? 1) * fit }));
    objectBounds = measure();
  }
  const nextTotalMain = objectBounds.reduce((sum, item) => sum + (direction === "vertical" ? item.height : item.width), 0) + gap * Math.max(0, objects.length - 1);
  let cursor = (direction === "vertical" ? bounds.top : bounds.left) + Math.max(0, ((direction === "vertical" ? bounds.height : bounds.width) - nextTotalMain) / 2);
  objects.forEach((obj, index) => {
    const item = objectBounds[index];
    const crossFree = direction === "vertical" ? bounds.width - item.width : bounds.height - item.height;
    const cross = align === "start" ? (direction === "vertical" ? bounds.left : bounds.top) : align === "end" ? (direction === "vertical" ? bounds.left : bounds.top) + crossFree : (direction === "vertical" ? bounds.left : bounds.top) + crossFree / 2;
    obj.set({ left: (obj.left ?? 0) + (direction === "vertical" ? cross - item.left : cursor - item.left), top: (obj.top ?? 0) + (direction === "vertical" ? cursor - item.top : cross - item.top) });
    obj.setCoords();
    cursor += (direction === "vertical" ? item.height : item.width) + gap;
  });
}

function layerColorForObject(obj: fabric.FabricObject) {
  const fill = (obj as any).fill;
  if (typeof fill === "string" && fill.trim()) return fill;
  const stroke = (obj as any).stroke;
  if (typeof stroke === "string" && stroke.trim()) return stroke;
  return null;
}

function applyBackgroundImageLayout(
  image: fabric.FabricImage,
  fit: BackgroundImageFit | "original",
  canvasWidth: number,
  canvasHeight: number,
) {
  const resolvedFit: BackgroundImageFit = fit === "original" ? "overflow" : fit;
  const element = image.getElement() as HTMLImageElement | HTMLCanvasElement | undefined;
  const imageWidth = image.width || (element instanceof HTMLImageElement ? element.naturalWidth : element?.width) || 1;
  const imageHeight = image.height || (element instanceof HTMLImageElement ? element.naturalHeight : element?.height) || 1;
  const coverScale = Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const containScale = Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const scale = resolvedFit === "cover" ? coverScale : resolvedFit === "contain" ? containScale : 1;
  const baseProps = {
    originX: "left" as const,
    originY: "top" as const,
    angle: 0,
    flipX: false,
    flipY: false,
    width: imageWidth,
    height: imageHeight,
  };

  if (resolvedFit === "stretch") {
    image.set({
      ...baseProps,
      left: 0,
      top: 0,
      scaleX: canvasWidth / imageWidth,
      scaleY: canvasHeight / imageHeight,
    });
    image.setCoords();
    return;
  }

  image.set({
    ...baseProps,
    left: (canvasWidth - imageWidth * scale) / 2,
    top: (canvasHeight - imageHeight * scale) / 2,
    scaleX: scale,
    scaleY: scale,
  });
  image.setCoords();
}

function getImageSourceSize(image: fabric.FabricImage) {
  const element = image.getElement() as HTMLImageElement | HTMLCanvasElement | undefined;
  const sourceWidth = element instanceof HTMLImageElement ? element.naturalWidth : element?.width;
  const sourceHeight = element instanceof HTMLImageElement ? element.naturalHeight : element?.height;
  return {
    width: Math.max(1, Math.round(sourceWidth || image.width || 1)),
    height: Math.max(1, Math.round(sourceHeight || image.height || 1)),
  };
}

function getCurrentImageCrop(image: fabric.FabricImage) {
  const source = getImageSourceSize(image);
  const cropX = Math.round(Number((image as any).cropX ?? 0));
  const cropY = Math.round(Number((image as any).cropY ?? 0));
  const width = Math.round(Number(image.width ?? source.width));
  const height = Math.round(Number(image.height ?? source.height));
  return {
    unit: "source_px" as const,
    x: Math.min(source.width - MIN_IMAGE_CROP_SIZE, Math.max(0, cropX)),
    y: Math.min(source.height - MIN_IMAGE_CROP_SIZE, Math.max(0, cropY)),
    width: Math.min(source.width - Math.max(0, cropX), Math.max(MIN_IMAGE_CROP_SIZE, width)),
    height: Math.min(source.height - Math.max(0, cropY), Math.max(MIN_IMAGE_CROP_SIZE, height)),
  };
}

function normalizeImageCrop(image: fabric.FabricImage, input: ImageCropInput) {
  const source = getImageSourceSize(image);
  const raw =
    input.unit === "normalized"
      ? {
          x: input.x * source.width,
          y: input.y * source.height,
          width: input.width * source.width,
          height: input.height * source.height,
        }
      : input;
  const x = Math.round(Math.min(source.width - MIN_IMAGE_CROP_SIZE, Math.max(0, raw.x)));
  const y = Math.round(Math.min(source.height - MIN_IMAGE_CROP_SIZE, Math.max(0, raw.y)));
  const width = Math.round(Math.min(source.width - x, Math.max(MIN_IMAGE_CROP_SIZE, raw.width)));
  const height = Math.round(Math.min(source.height - y, Math.max(MIN_IMAGE_CROP_SIZE, raw.height)));
  return { unit: "source_px" as const, x, y, width, height };
}

function applyImageCrop(
  image: fabric.FabricImage,
  crop: ReturnType<typeof normalizeImageCrop>,
  options: { outputFit?: "preserve-frame" | "resize-frame-to-crop" } = {},
) {
  const source = getImageSourceSize(image);
  const displayWidth = image.getScaledWidth() || (image.width || source.width) * (image.scaleX ?? 1);
  const displayHeight = image.getScaledHeight() || (image.height || source.height) * (image.scaleY ?? 1);
  const preserveFrame = options.outputFit !== "resize-frame-to-crop";
  image.set({
    cropX: crop.x,
    cropY: crop.y,
    width: crop.width,
    height: crop.height,
    scaleX: preserveFrame ? displayWidth / crop.width : image.scaleX ?? 1,
    scaleY: preserveFrame ? displayHeight / crop.height : image.scaleY ?? 1,
    kaveroCrop: crop,
  } as any);
  const radius = Number((image as any).kaveroBorderRadius ?? 0);
  if (radius > 0) applyImageBorderRadius(image, radius);
  image.setCoords();
}

function resetFabricImageCrop(image: fabric.FabricImage, options: { preserveFrame?: boolean } = {}) {
  const source = getImageSourceSize(image);
  const displayWidth = image.getScaledWidth() || source.width * (image.scaleX ?? 1);
  const displayHeight = image.getScaledHeight() || source.height * (image.scaleY ?? 1);
  const preserveFrame = options.preserveFrame !== false;
  image.set({
    cropX: 0,
    cropY: 0,
    width: source.width,
    height: source.height,
    scaleX: preserveFrame ? displayWidth / source.width : image.scaleX ?? 1,
    scaleY: preserveFrame ? displayHeight / source.height : image.scaleY ?? 1,
    kaveroCrop: { unit: "source_px", x: 0, y: 0, width: source.width, height: source.height },
  } as any);
  const radius = Number((image as any).kaveroBorderRadius ?? 0);
  if (radius > 0) applyImageBorderRadius(image, radius);
  image.setCoords();
}

function clampImageBorderRadius(image: fabric.FabricImage, radius: number) {
  const maxRadius = Math.max(0, Math.min(Number(image.width ?? 1), Number(image.height ?? 1)) / 2);
  if (!Number.isFinite(radius)) return 0;
  return Math.min(maxRadius, Math.max(0, radius));
}

function applyImageBorderRadius(image: fabric.FabricImage, radius: number) {
  const safeRadius = clampImageBorderRadius(image, radius);
  image.set("kaveroBorderRadius" as any, safeRadius);
  if (safeRadius <= 0) {
    image.set("clipPath" as any, undefined);
    image.setCoords();
    return safeRadius;
  }
  image.set("clipPath" as any, new fabric.Rect({
    width: image.width || 1,
    height: image.height || 1,
    rx: safeRadius,
    ry: safeRadius,
    originX: "center",
    originY: "center",
  }));
  image.setCoords();
  return safeRadius;
}

function refreshImageBorderRadii(canvas: fabric.Canvas) {
  canvas.getObjects().forEach((object) => {
    if (object instanceof fabric.FabricImage && !isBackgroundImageObject(object)) {
      const radius = Number((object as any).kaveroBorderRadius ?? 0);
      if (radius > 0) applyImageBorderRadius(object, radius);
    }
  });
}

function clearCropHelpers(canvas: fabric.Canvas) {
  canvas
    .getObjects()
    .filter((obj) => (obj as any).kaveroKind === "crop-helper")
    .forEach((helper) => canvas.remove(helper));
}

function lockCanvasForImageCrop(canvas: fabric.Canvas, target: fabric.FabricImage, stateRef: MutableRefObject<Map<fabric.FabricObject, { selectable: boolean; evented: boolean; hoverCursor?: string | null; opacity?: number }>>) {
  if (stateRef.current.size > 0) restoreCanvasAfterImageCrop(canvas, stateRef);
  clearCropHelpers(canvas);
  stateRef.current.clear();
  const targetId = String((target as any).kaveroId ?? "");
  canvas.getObjects().forEach((object) => {
    if (object === target || isEditorHelperObject(object)) return;
    stateRef.current.set(object, {
      selectable: object.selectable ?? true,
      evented: object.evented ?? true,
      hoverCursor: object.hoverCursor,
      opacity: object.opacity,
    });
    object.set({
      selectable: false,
      evented: false,
      hoverCursor: "default",
      opacity: Math.min(object.opacity ?? 1, 0.28),
    } as any);
  });
  target.set({
    selectable: false,
    evented: false,
    opacity: 0,
    lockMovementX: false,
    lockMovementY: false,
    lockScalingX: false,
    lockScalingY: false,
    lockRotation: false,
    hasControls: false,
    kaveroCropActiveTargetId: targetId,
  } as any);
}

function restoreCanvasAfterImageCrop(canvas: fabric.Canvas, stateRef: MutableRefObject<Map<fabric.FabricObject, { selectable: boolean; evented: boolean; hoverCursor?: string | null; opacity?: number }>>) {
  canvas.getObjects().forEach((object) => {
    const previous = stateRef.current.get(object);
    if (previous) {
      object.set({
        selectable: previous.selectable,
        evented: previous.evented,
        hoverCursor: previous.hoverCursor ?? undefined,
        opacity: previous.opacity ?? 1,
      } as any);
    }
    delete (object as any).kaveroCropActiveTargetId;
  });
  stateRef.current.clear();
}

function getCropTargetId(object: fabric.FabricObject) {
  const value = (object as any).kaveroCropTargetId;
  return typeof value === "string" ? value : null;
}

function createCropControllers(canvas: fabric.Canvas, image: fabric.FabricImage) {
  clearCropHelpers(canvas);
  const source = getImageSourceSize(image);
  const crop = getCurrentImageCrop(image);
  const scaleX = image.scaleX ?? 1;
  const scaleY = image.scaleY ?? 1;
  const angle = image.angle ?? 0;
  const targetId = String((image as any).kaveroId ?? "");
  const left = (image.left ?? 0) - crop.x * scaleX;
  const top = (image.top ?? 0) - crop.y * scaleY;
  const common = {
    originX: image.originX,
    originY: image.originY,
    angle,
    flipX: image.flipX,
    flipY: image.flipY,
    excludeFromExport: true,
    kaveroKind: "crop-helper",
    kaveroCropTargetId: targetId,
  } as any;
  const element = image.getElement() as HTMLImageElement | HTMLCanvasElement;
  const outer = new fabric.FabricImage(element, {
    ...common,
    left,
    top,
    scaleX,
    scaleY,
    cropX: 0,
    cropY: 0,
    width: source.width,
    height: source.height,
    opacity: 0.48,
    selectable: true,
    evented: true,
    hasControls: true,
    borderColor: "#8B5CF6",
    cornerColor: "#ffffff",
    cornerStrokeColor: "#8B5CF6",
    transparentCorners: false,
    padding: 0,
    hoverCursor: "move",
    kaveroCropRole: "outer",
  } as any);
  const cropWindow = new fabric.Rect({
    ...common,
    left: image.left,
    top: image.top,
    width: crop.width,
    height: crop.height,
    scaleX,
    scaleY,
    fill: "rgba(0,0,0,0)",
    stroke: "#ffffff",
    strokeWidth: 2 / Math.max(0.0001, Math.max(Math.abs(scaleX), Math.abs(scaleY))),
    selectable: true,
    evented: true,
    hasControls: true,
    borderColor: "#ffffff",
    cornerColor: "#ffffff",
    cornerStrokeColor: "#ffffff",
    transparentCorners: false,
    padding: 0,
    hoverCursor: "move",
    kaveroCropRole: "window",
  } as any);
  image.set({
    selectable: false,
    evented: false,
    hasControls: false,
    opacity: 1,
  } as any);
  canvas.add(outer);
  canvas.add(cropWindow);
  outer.set({
    borderColor: "#8B5CF6",
    cornerColor: "#ffffff",
    cornerStrokeColor: "#8B5CF6",
  } as any);
  cropWindow.set({
    borderColor: "#ffffff",
    cornerColor: "#ffffff",
    cornerStrokeColor: "#ffffff",
  } as any);
  canvas.bringObjectToFront(outer);
  canvas.bringObjectToFront(image);
  canvas.bringObjectToFront(cropWindow);
  canvas.setActiveObject(cropWindow);
  canvas.requestRenderAll();
}

function findCropController(canvas: fabric.Canvas, targetId: string, role: "outer" | "window") {
  return canvas.getObjects().find((object) =>
    (object as any).kaveroKind === "crop-helper" &&
    (object as any).kaveroCropRole === role &&
    getCropTargetId(object) === targetId
  ) ?? null;
}

function syncTargetFromCropControllers(canvas: fabric.Canvas, target: fabric.FabricImage) {
  const targetId = String((target as any).kaveroId ?? "");
  const outer = findCropController(canvas, targetId, "outer");
  const cropWindow = findCropController(canvas, targetId, "window");
  if (!outer || !cropWindow) return;
  const scaleX = Math.max(0.0001, outer.scaleX ?? 1);
  const scaleY = Math.max(0.0001, outer.scaleY ?? 1);
  const crop = normalizeImageCrop(target, {
    unit: "source_px",
    x: ((cropWindow.left ?? 0) - (outer.left ?? 0)) / scaleX,
    y: ((cropWindow.top ?? 0) - (outer.top ?? 0)) / scaleY,
    width: cropWindow.getScaledWidth() / scaleX,
    height: cropWindow.getScaledHeight() / scaleY,
  });
  target.set({
    left: cropWindow.left,
    top: cropWindow.top,
    scaleX,
    scaleY,
    angle: outer.angle ?? target.angle,
  } as any);
  applyImageCrop(target, crop, { outputFit: "resize-frame-to-crop" });
  target.setCoords();
  canvas.bringObjectToFront(outer);
  canvas.bringObjectToFront(target);
  canvas.bringObjectToFront(cropWindow);
}

function applyCanvasLogicalDimensions(canvas: fabric.Canvas, width: number, height: number) {
  canvas.setDimensions({ width, height }, { cssOnly: false });
  canvas.setDimensions({ width, height }, { cssOnly: true });
  canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
}

async function isFetchableCanvasAsset(url: string) {
  if (!isAllowedCanvasImageUrl(url)) return false;
  try {
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

function createMissingAssetPlaceholder(source: string, image: fabric.FabricImage) {
  const width = Math.max(160, Math.min(480, image.getScaledWidth() || image.width || 240));
  const height = Math.max(120, Math.min(360, image.getScaledHeight() || image.height || 180));
  const rect = new fabric.Rect({
    left: -width / 2,
    top: -height / 2,
    width,
    height,
    fill: "#1f2937",
    stroke: "#ef4444",
    strokeWidth: 2,
    rx: 8,
    ry: 8,
  });
  const text = new fabric.Textbox("Missing image", {
    left: -width / 2 + 16,
    top: -12,
    width: width - 32,
    fontFamily: "Inter",
    fontSize: 18,
    fontWeight: "700",
    fill: "#ffffff",
    textAlign: "center",
  });
  const group = new fabric.Group([rect, text], {
    left: image.left,
    top: image.top,
    angle: image.angle,
    opacity: image.opacity,
    selectable: true,
    evented: true,
  });
  group.set({
    kaveroId: (image as any).kaveroId ?? createObjectId(),
    kaveroKind: "missing-asset",
    kaveroMissingAssetSrc: source,
  } as any);
  return group;
}

async function repairBrokenImages(canvas: fabric.Canvas) {
  const images = canvas.getObjects().filter((obj): obj is fabric.FabricImage => obj instanceof fabric.FabricImage);
  let replaced = 0;

  for (const image of images) {
    const source = getImageSource(image);
    if (!source || (await isFetchableCanvasAsset(source))) continue;
    const placeholder = createMissingAssetPlaceholder(source, image);
    canvas.remove(image);
    canvas.add(placeholder);
    replaced += 1;
  }

  return replaced;
}

export function useCanvasState(options: UseCanvasStateOptions = {}) {
  const canvasMapRef = useRef<Map<string, fabric.Canvas>>(new Map());
  const historyMapRef = useRef<Map<string, CanvasHistory>>(new Map());
  const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
  const activeCanvasIdRef = useRef<string | null>(null);
  const [selectedObject, setSelectedObject] = useState<fabric.FabricObject | null>(null);
  const [, refreshSelectedObject] = useState(0);
  const [canvasWidth, setCanvasWidth] = useState(1080);
  const [canvasHeight, setCanvasHeight] = useState(1080);
  const [zoom, setZoom] = useState(0.58);
  const [fitScale, setFitScale] = useState(0.58);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [layers, setLayers] = useState<CanvasLayer[]>([]);
  const [backgroundImageFit, setBackgroundImageFitState] = useState<BackgroundImageFit>("cover");
  const [imageCropModeObjectId, setImageCropModeObjectId] = useState<string | null>(null);
  const snapEnabledRef = useRef(true);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const clipboardRef = useRef<fabric.FabricObject[]>([]);
  const isRestoringRef = useRef<Set<string>>(new Set());
  const canvasCleanupMapRef = useRef<Map<string, () => void>>(new Map());
  const onCanvasChangeRef = useRef(options.onCanvasChange);
  const onErrorRef = useRef(options.onError);
  const canvasWidthRef = useRef(canvasWidth);
  const canvasHeightRef = useRef(canvasHeight);
  const backgroundImageFitRef = useRef<BackgroundImageFit>("cover");
  const snapDisabledRef = useRef(false);
  const canvasLockedRef = useRef(false);
  const imageCropModeObjectIdRef = useRef<string | null>(null);
  const imageCropStartRef = useRef<{ objectId: string; crop: ReturnType<typeof getCurrentImageCrop> } | null>(null);
  const imageCropObjectStateRef = useRef<
    Map<fabric.FabricObject, { selectable: boolean; evented: boolean; hoverCursor?: string | null; opacity?: number }>
  >(new Map());

  useEffect(() => {
    onCanvasChangeRef.current = options.onCanvasChange;
  }, [options.onCanvasChange]);

  useEffect(() => {
    onErrorRef.current = options.onError;
  }, [options.onError]);

  useEffect(() => {
    canvasWidthRef.current = canvasWidth;
  }, [canvasWidth]);

  useEffect(() => {
    canvasHeightRef.current = canvasHeight;
  }, [canvasHeight]);

  useEffect(() => {
    snapEnabledRef.current = snapEnabled;
  }, [snapEnabled]);

  useEffect(() => {
    backgroundImageFitRef.current = backgroundImageFit;
  }, [backgroundImageFit]);

  useEffect(() => {
    imageCropModeObjectIdRef.current = imageCropModeObjectId;
  }, [imageCropModeObjectId]);

  useEffect(() => {
    const handleLock = (event: Event) => {
      canvasLockedRef.current = Boolean((event as CustomEvent<{ locked?: boolean }>).detail?.locked);
    };
    window.addEventListener("kavero:canvas-lock", handleLock);
    return () => window.removeEventListener("kavero:canvas-lock", handleLock);
  }, []);

  // Helper to get the active canvas
  const getActiveCanvas = useCallback((): fabric.Canvas | null => {
    const id = activeCanvasIdRef.current;
    if (!id) return null;
    return canvasMapRef.current.get(id) ?? null;
  }, []);

  const getLayerObjects = useCallback((canvas: fabric.Canvas) => {
    return canvas.getObjects().filter((obj) => !isEditorHelperObject(obj));
  }, []);

  const findLayerObjectById = useCallback(
    (canvas: fabric.Canvas, id: string) => getLayerObjects(canvas).find((obj) => String((obj as any).kaveroId) === id) ?? null,
    [getLayerObjects],
  );

  const getActiveObjectIds = useCallback((canvas: fabric.Canvas) => {
    return canvas
      .getActiveObjects()
      .map((obj) => String((obj as any).kaveroId ?? ""))
      .filter(Boolean);
  }, []);

  const setActiveObjectsByIds = useCallback(
    (canvas: fabric.Canvas, ids: string[]) => {
      const targets = ids.map((id) => findLayerObjectById(canvas, id)).filter((obj): obj is fabric.FabricObject => Boolean(obj));
      if (targets.length === 0) return [];
      const activeObject = targets.length === 1 ? targets[0] : new fabric.ActiveSelection(targets, { canvas });
      canvas.setActiveObject(activeObject);
      targets.forEach((target) => target.setCoords());
      canvas.requestRenderAll();
      setSelectedObject(targets[0]);
      refreshSelectedObject((version) => version + 1);
      return targets;
    },
    [findLayerObjectById],
  );

  const refreshLayers = useCallback(
    (pageId = activeCanvasIdRef.current) => {
      if (!pageId || pageId !== activeCanvasIdRef.current) return;
      const canvas = canvasMapRef.current.get(pageId);
      if (!canvas) {
        setLayers([]);
        return;
      }
      const objects = getLayerObjects(canvas);
      const max = Math.max(0, objects.length - 1);
      const nextLayers = objects
        .map((obj, index): CanvasLayer => {
          ensureObjectId(obj);
          const bounds = getObjectBounds(obj);
          const kind = layerKindForObject(obj);
          return {
            id: String((obj as any).kaveroId),
            label: layerLabelForObject(obj, kind),
            kind,
            level: index,
            max,
            color: layerColorForObject(obj),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height),
          };
        })
        .reverse();
      setLayers(nextLayers);
    },
    [getLayerObjects],
  );

  const getBackgroundImageObject = useCallback((canvas: fabric.Canvas) => {
    return canvas.getObjects().find((obj): obj is fabric.FabricImage => obj instanceof fabric.FabricImage && isBackgroundImageObject(obj));
  }, []);

  const relayoutBackgroundImage = useCallback(
    (canvas: fabric.Canvas, width = canvasWidthRef.current, height = canvasHeightRef.current) => {
      const bgObj = getBackgroundImageObject(canvas);
      if (!bgObj) return false;
      const storedFit = (bgObj as any).kaveroBgFit;
      const fit = (storedFit === "original" ? "overflow" : storedFit ?? backgroundImageFitRef.current ?? "cover") as BackgroundImageFit;
      applyBackgroundImageLayout(bgObj, fit, width, height);
      bgObj.set({
        _isBgImage: true,
        kaveroKind: "background-image",
        selectable: false,
        evented: false,
        lockMovementX: true,
        lockMovementY: true,
        lockScalingX: true,
        lockScalingY: true,
        lockRotation: true,
        hasControls: false,
        kaveroBgFit: fit,
      } as any);
      setBackgroundImageFitState(fit);
      backgroundImageFitRef.current = fit;
      canvas.sendObjectToBack(bgObj);
      return true;
    },
    [getBackgroundImageObject],
  );

  // Update undo/redo state for active canvas
  const updateUndoRedoState = useCallback((pageId: string) => {
    if (pageId !== activeCanvasIdRef.current) return;
    const hist = historyMapRef.current.get(pageId);
    if (!hist) {
      setCanUndo(false);
      setCanRedo(false);
      return;
    }
    setCanUndo(hist.index > 0);
    setCanRedo(hist.index < hist.entries.length - 1);
  }, []);

  const emitCanvasChange = useCallback((pageId: string) => {
    if (isRestoringRef.current.has(pageId)) return;
    const canvas = canvasMapRef.current.get(pageId);
    if (!canvas) return;
    onCanvasChangeRef.current?.(pageId, serializeCanvas(canvas), {
      width: canvasWidthRef.current,
      height: canvasHeightRef.current,
    });
  }, []);

  const saveHistory = useCallback((pageId: string) => {
    if (isRestoringRef.current.has(pageId)) return;
    const canvas = canvasMapRef.current.get(pageId);
    if (!canvas) return;
    const json = serializeCanvas(canvas);
    let hist = historyMapRef.current.get(pageId);
    if (!hist) {
      hist = { entries: [], index: -1 };
      historyMapRef.current.set(pageId, hist);
    }
    // Truncate forward history
    hist.entries = hist.entries.slice(0, hist.index + 1);
    hist.entries.push(json);
    if (hist.entries.length > MAX_HISTORY) {
      hist.entries.shift();
    }
    hist.index = hist.entries.length - 1;
    updateUndoRedoState(pageId);
    emitCanvasChange(pageId);
  }, [emitCanvasChange, updateUndoRedoState]);

  const registerCanvas = useCallback((pageId: string, canvas: fabric.Canvas) => {
    canvasMapRef.current.set(pageId, canvas);
    applyCanvasLogicalDimensions(canvas, canvasWidthRef.current, canvasHeightRef.current);
    relayoutBackgroundImage(canvas, canvasWidthRef.current, canvasHeightRef.current);
    canvas.requestRenderAll();

    // Selection events
    canvas.on("selection:created", (e) => {
      if (activeCanvasIdRef.current === pageId) {
        setSelectedObject(e.selected?.[0] ?? null);
        refreshLayers(pageId);
      }
    });
    canvas.on("selection:updated", (e) => {
      if (activeCanvasIdRef.current === pageId) {
        setSelectedObject(e.selected?.[0] ?? null);
        refreshLayers(pageId);
      }
    });
    canvas.on("selection:cleared", () => {
      if (activeCanvasIdRef.current === pageId) {
        const cropId = imageCropModeObjectIdRef.current;
        if (cropId) {
          const cropTarget = findLayerObjectById(canvas, cropId);
          if (cropTarget) {
            setSelectedObject(cropTarget);
            canvas.setActiveObject(cropTarget);
            canvas.requestRenderAll();
            return;
          }
        }
        setSelectedObject(null);
        refreshLayers(pageId);
      }
    });

    const shouldSkipSnap = (event: { e?: Event }) => {
      const nativeEvent = event.e as MouseEvent | PointerEvent | undefined;
      return !snapEnabledRef.current || snapDisabledRef.current || Boolean(nativeEvent?.ctrlKey || nativeEvent?.metaKey);
    };

    const beginCropModeForTarget = (target: fabric.FabricObject | null | undefined) => {
      if (!(target instanceof fabric.FabricImage) || isBackgroundImageObject(target)) return;
      const id = String((target as any).kaveroId ?? "");
      if (!id) return;
      imageCropStartRef.current = { objectId: id, crop: getCurrentImageCrop(target) };
      canvas.setActiveObject(target);
      setSelectedObject(target);
      setImageCropModeObjectId(id);
      target.set({ borderColor: "#FFFFFF", cornerColor: "#FFFFFF", cornerStrokeColor: "#8B5CF6" } as any);
      lockCanvasForImageCrop(canvas, target, imageCropObjectStateRef);
      clearCropHelpers(canvas);
      canvas.requestRenderAll();
    };

    canvas.on("object:moving", (event) => {
      const target = event.target;
      const controllerTargetId = target ? getCropTargetId(target) : null;
      if (target && controllerTargetId) {
        const cropTarget = findLayerObjectById(canvas, controllerTargetId);
        if (cropTarget instanceof fabric.FabricImage) syncTargetFromCropControllers(canvas, cropTarget);
        canvas.requestRenderAll();
        clearSmartGuides(canvas);
        return;
      }
      if (!event.target || shouldSkipSnap(event)) {
        clearSmartGuides(canvas);
        return;
      }
      applySmartGuides(canvas, event.target, canvasWidthRef.current, canvasHeightRef.current, true);
      canvas.requestRenderAll();
    });

    canvas.on("object:scaling", (event) => {
      const nativeEvent = event.e as MouseEvent | PointerEvent | undefined;
      const target = event.target;
      const controllerTargetId = target ? getCropTargetId(target) : null;
      if (target && controllerTargetId) {
        const cropTarget = findLayerObjectById(canvas, controllerTargetId);
        if (cropTarget instanceof fabric.FabricImage) syncTargetFromCropControllers(canvas, cropTarget);
        canvas.requestRenderAll();
        clearSmartGuides(canvas);
        return;
      }
      const cropShortcut = Boolean(nativeEvent?.ctrlKey || nativeEvent?.metaKey);
      const cropMode = target && String((target as any).kaveroId ?? "") === imageCropModeObjectIdRef.current;
      if (target instanceof fabric.FabricImage && !isBackgroundImageObject(target) && (cropShortcut || cropMode)) {
        const transform = (event as any).transform;
        const original = transform?.original ?? {};
        const originalScaleX = Math.max(0.0001, Number(original.scaleX ?? target.scaleX ?? 1));
        const originalScaleY = Math.max(0.0001, Number(original.scaleY ?? target.scaleY ?? 1));
        const corner = String(transform?.corner ?? "");
        const current = getCurrentImageCrop(target);
        const nextWidth = Math.min(current.width + current.x, Math.max(MIN_IMAGE_CROP_SIZE, target.getScaledWidth() / originalScaleX));
        const nextHeight = Math.min(current.height + current.y, Math.max(MIN_IMAGE_CROP_SIZE, target.getScaledHeight() / originalScaleY));
        const cropFromLeft = corner.includes("l");
        const cropFromTop = corner.includes("t");
        const crop = {
          unit: "source_px" as const,
          x: cropFromLeft ? current.x + (current.width - nextWidth) : current.x,
          y: cropFromTop ? current.y + (current.height - nextHeight) : current.y,
          width: nextWidth,
          height: nextHeight,
        };
        applyImageCrop(target, normalizeImageCrop(target, crop), { outputFit: "resize-frame-to-crop" });
        target.set({ scaleX: originalScaleX, scaleY: originalScaleY } as any);
        target.setCoords();
        canvas.requestRenderAll();
        clearSmartGuides(canvas);
        return;
      }
      if (!event.target || shouldSkipSnap(event)) {
        clearSmartGuides(canvas);
        return;
      }
      applySmartGuides(canvas, event.target, canvasWidthRef.current, canvasHeightRef.current, false);
      canvas.requestRenderAll();
    });

    canvas.on("mouse:up", () => {
      canvas.getObjects().forEach((object) => {
        delete (object as any).__kaveroCropDragStart;
      });
      const id = imageCropModeObjectIdRef.current;
      const target = id ? findLayerObjectById(canvas, id) : null;
      if (target instanceof fabric.FabricImage) syncTargetFromCropControllers(canvas, target);
      clearSmartGuides(canvas);
      canvas.requestRenderAll();
    });

    canvas.on("mouse:dblclick", (event) => {
      if (activeCanvasIdRef.current !== pageId) return;
      beginCropModeForTarget(event.target);
    });

    const handleNativeDoubleClick = (event: MouseEvent) => {
      if (activeCanvasIdRef.current !== pageId) return;
      const target = ((canvas as any).findTarget?.(event) ?? null) as fabric.FabricObject | null;
      beginCropModeForTarget(target);
    };
    canvas.upperCanvasEl.addEventListener("dblclick", handleNativeDoubleClick);
    canvasCleanupMapRef.current.set(pageId, () => {
      canvas.upperCanvasEl.removeEventListener("dblclick", handleNativeDoubleClick);
    });

    const attachHistoryEvents = () => {
      canvas.on("object:added", (event) => {
        if (event.target && isEditorHelperObject(event.target)) return;
        if (event.target) ensureObjectId(event.target);
        saveHistory(pageId);
        refreshLayers(pageId);
      });
      canvas.on("object:modified", (event) => {
        if (event.target && isEditorHelperObject(event.target)) return;
        saveHistory(pageId);
        refreshLayers(pageId);
      });
      canvas.on("object:removed", (event) => {
        if (event.target && isEditorHelperObject(event.target)) return;
        saveHistory(pageId);
        refreshLayers(pageId);
      });
    };

    const initializeHistory = () => {
      const json = serializeCanvas(canvas);
      historyMapRef.current.set(pageId, { entries: [json], index: 0 });
      updateUndoRedoState(pageId);
      refreshLayers(pageId);
      attachHistoryEvents();
    };

    isRestoringRef.current.add(pageId);
    void repairBrokenImages(canvas)
      .then((count) => {
        if (count > 0) {
          canvas.requestRenderAll();
          onErrorRef.current?.(
            count === 1
              ? "One canvas asset is missing. It was replaced with a placeholder."
              : `${count} canvas assets are missing. They were replaced with placeholders.`,
          );
          isRestoringRef.current.delete(pageId);
          initializeHistory();
          emitCanvasChange(pageId);
          return;
        }
        const bgObj = getBackgroundImageObject(canvas);
        if (bgObj) {
          const storedFit = (bgObj as any).kaveroBgFit;
          const fit = (storedFit === "original" ? "overflow" : storedFit ?? "cover") as BackgroundImageFit;
          setBackgroundImageFitState(fit);
          backgroundImageFitRef.current = fit;
          relayoutBackgroundImage(canvas);
        }
        refreshImageBorderRadii(canvas);
        isRestoringRef.current.delete(pageId);
        initializeHistory();
      })
      .catch(() => {
        refreshImageBorderRadii(canvas);
        isRestoringRef.current.delete(pageId);
        initializeHistory();
      });
  }, [emitCanvasChange, findLayerObjectById, getBackgroundImageObject, refreshLayers, relayoutBackgroundImage, saveHistory, updateUndoRedoState]);

  const unregisterCanvas = useCallback((pageId: string) => {
    canvasCleanupMapRef.current.get(pageId)?.();
    canvasCleanupMapRef.current.delete(pageId);
    canvasMapRef.current.delete(pageId);
    historyMapRef.current.delete(pageId);
  }, []);

  const setActiveCanvas = useCallback((pageId: string) => {
    const prevId = activeCanvasIdRef.current;
    if (prevId === pageId) return;

    // Clear selection on previous canvas
    if (prevId) {
      const prevCanvas = canvasMapRef.current.get(prevId);
      if (prevCanvas) {
        prevCanvas.discardActiveObject();
        prevCanvas.requestRenderAll();
      }
    }

    activeCanvasIdRef.current = pageId;
    setActiveCanvasId(pageId);
    setSelectedObject(null);
    refreshLayers(pageId);
    updateUndoRedoState(pageId);
  }, [refreshLayers, updateUndoRedoState]);

  // ── Text ────────────────────────────────────────────────────────────

  const addText = useCallback(
    (preset: "heading" | "subheading" | "body") => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const cfg = TEXT_PRESETS[preset];
      const text = new fabric.Textbox(cfg.text, {
        left: canvasWidth / 2 - 200,
        top: canvasHeight / 2 - 30,
        width: 400,
        fontSize: cfg.fontSize,
        fontWeight: cfg.fontWeight,
        fontFamily: cfg.fontFamily,
        fill: "#ffffff",
        textAlign: "center",
        editable: true,
      });
      canvas.add(text);
      canvas.setActiveObject(text);
      canvas.requestRenderAll();
      setSelectedObject(text);
      refreshSelectedObject((version) => version + 1);
    },
    [getActiveCanvas, canvasWidth, canvasHeight]
  );

  // ── Shapes ──────────────────────────────────────────────────────────

  const addShape = useCallback(
    (type: "rect" | "circle" | "line" | "triangle") => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      let obj: fabric.FabricObject;
      const cx = canvasWidth / 2;
      const cy = canvasHeight / 2;

      switch (type) {
        case "rect":
          obj = new fabric.Rect({
            left: cx - 75,
            top: cy - 75,
            width: 150,
            height: 150,
            rx: 8,
            ry: 8,
            ...SHAPE_DEFAULTS,
          });
          break;
        case "circle":
          obj = new fabric.Circle({
            left: cx - 60,
            top: cy - 60,
            radius: 60,
            ...SHAPE_DEFAULTS,
          });
          break;
        case "triangle":
          obj = new fabric.Triangle({
            left: cx - 60,
            top: cy - 60,
            width: 120,
            height: 120,
            ...SHAPE_DEFAULTS,
          });
          break;
        case "line":
          obj = new fabric.Line([cx - 100, cy, cx + 100, cy], {
            stroke: "#3B82F6",
            strokeWidth: 3,
            fill: "",
          });
          break;
        default:
          return;
      }
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      setSelectedObject(obj);
      refreshSelectedObject((version) => version + 1);
    },
    [getActiveCanvas, canvasWidth, canvasHeight]
  );

  // ── Images ──────────────────────────────────────────────────────────

  const addImage = useCallback(
    async (url: string, position?: { x: number; y: number }) => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      if (!isAllowedCanvasImageUrl(url)) {
        onErrorRef.current?.("Images must be uploaded as canvas assets before adding them to the canvas.");
        return;
      }
      try {
        const img = await fabric.FabricImage.fromURL(url, { crossOrigin: "anonymous" });
        const scale = Math.min(
          (canvasWidth * 0.6) / (img.width || 1),
          (canvasHeight * 0.6) / (img.height || 1),
          1
        );
        img.set({
          left: (position?.x ?? canvasWidth / 2) - ((img.width || 0) * scale) / 2,
          top: (position?.y ?? canvasHeight / 2) - ((img.height || 0) * scale) / 2,
          scaleX: scale,
          scaleY: scale,
          kaveroAssetSrc: url,
          crossOrigin: "anonymous",
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        setSelectedObject(img);
        refreshSelectedObject((version) => version + 1);
      } catch (e) {
        console.error("Failed to load image:", e);
        onErrorRef.current?.("Unable to load that canvas asset.");
      }
    },
    [getActiveCanvas, canvasWidth, canvasHeight]
  );

  // ── Background ──────────────────────────────────────────────────────

  const setBackground = useCallback(
    (type: "color" | "gradient" | "image", value: string, options?: { fit?: BackgroundImageFit }) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return;
      if (type === "color" || type === "gradient") {
        if (type === "gradient") {
          const config = gradientConfigFromString(value);
          canvas.backgroundColor = config ? createGradient(canvasWidth, canvasHeight, config) : value;
        } else {
          canvas.backgroundColor = value;
        }
        canvas.requestRenderAll();
        saveHistory(pageId);
        refreshSelectedObject((version) => version + 1);
      } else if (type === "image") {
        if (!isAllowedCanvasImageUrl(value)) {
          onErrorRef.current?.("Background images must be uploaded as canvas assets first.");
          return;
        }
        fabric.FabricImage.fromURL(value, { crossOrigin: "anonymous" }).then((img) => {
          const fit = options?.fit ?? backgroundImageFitRef.current ?? "cover";
          setBackgroundImageFitState(fit);
          backgroundImageFitRef.current = fit;
          img.set({
            selectable: false,
            evented: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            hasControls: false,
          });
          applyBackgroundImageLayout(img, fit, canvasWidthRef.current, canvasHeightRef.current);
          const objects = canvas.getObjects();
          const bgObj = objects.find(isBackgroundImageObject);
          if (bgObj) canvas.remove(bgObj);
          (img as any)._isBgImage = true;
          img.set({
            kaveroKind: "background-image",
            kaveroAssetSrc: value,
            kaveroBgSrc: value,
            kaveroBgFit: fit,
            crossOrigin: "anonymous",
          } as any);
          canvas.add(img);
          canvas.sendObjectToBack(img);
          canvas.requestRenderAll();
          saveHistory(pageId);
          refreshSelectedObject((version) => version + 1);
        });
      }
    },
    [getActiveCanvas, saveHistory]
  );

  const setBackgroundImageFit = useCallback(
    (fit: BackgroundImageFit) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return;
      const bgObj = getBackgroundImageObject(canvas);
      setBackgroundImageFitState(fit);
      backgroundImageFitRef.current = fit;
      if (!bgObj) return;
      bgObj.set({ kaveroBgFit: fit } as any);
      relayoutBackgroundImage(canvas);
      canvas.requestRenderAll();
      saveHistory(pageId);
      refreshSelectedObject((version) => version + 1);
    },
    [getActiveCanvas, getBackgroundImageObject, relayoutBackgroundImage, saveHistory],
  );

  // ── Object manipulation ─────────────────────────────────────────────

  const updateSelectedObject = useCallback(
    (props: Record<string, unknown>) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      const target = canvas?.getActiveObject() ?? selectedObject;
      if (!canvas || !target || !pageId) return;

      const nextProps = { ...props };
      if (typeof nextProps.fill === "string") {
        const config = gradientConfigFromString(nextProps.fill);
        if (config) {
          const width = target.getScaledWidth?.() || target.width || 1;
          const height = target.getScaledHeight?.() || target.height || 1;
          nextProps.fill = createGradient(width, height, config);
          target.set("kaveroFillGradient" as any, nextProps.fill);
        } else {
          target.set("kaveroFillGradient" as any, undefined);
        }
      }

      target.set(nextProps as Partial<fabric.FabricObject>);
      target.setCoords();
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(target);
      refreshLayers(pageId);
      refreshSelectedObject((version) => version + 1);
    },
    [getActiveCanvas, refreshLayers, selectedObject, saveHistory]
  );

  const setImageBorderRadius = useCallback(
    (objectId: string, radius: number) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return false;
      const target = findLayerObjectById(canvas, objectId);
      if (!(target instanceof fabric.FabricImage) || isBackgroundImageObject(target)) return false;
      const safeRadius = applyImageBorderRadius(target, radius);
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(target);
      refreshLayers(pageId);
      refreshSelectedObject((version) => version + 1);
      return safeRadius >= 0;
    },
    [findLayerObjectById, getActiveCanvas, refreshLayers, saveHistory],
  );

  const cropImageObject = useCallback(
    (objectId: string, crop: ImageCropInput, options?: { outputFit?: "preserve-frame" | "resize-frame-to-crop" }) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return false;
      const target = findLayerObjectById(canvas, objectId);
      if (!(target instanceof fabric.FabricImage) || isBackgroundImageObject(target)) return false;
      const normalized = normalizeImageCrop(target, crop);
      applyImageCrop(target, normalized, options);
      if (imageCropModeObjectIdRef.current === objectId) {
        createCropControllers(canvas, target);
      } else {
        canvas.setActiveObject(target);
      }
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(target);
      refreshLayers(pageId);
      refreshSelectedObject((version) => version + 1);
      return true;
    },
    [findLayerObjectById, getActiveCanvas, refreshLayers, saveHistory],
  );

  const resetImageCrop = useCallback(
    (objectId: string) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return false;
      const target = findLayerObjectById(canvas, objectId);
      if (!(target instanceof fabric.FabricImage) || isBackgroundImageObject(target)) return false;
      resetFabricImageCrop(target);
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(target);
      refreshLayers(pageId);
      refreshSelectedObject((version) => version + 1);
      return true;
    },
    [findLayerObjectById, getActiveCanvas, refreshLayers, saveHistory],
  );

  const getImageCropInfo = useCallback(
    (objectId: string) => {
      const canvas = getActiveCanvas();
      if (!canvas) return null;
      const target = findLayerObjectById(canvas, objectId);
      if (!(target instanceof fabric.FabricImage) || isBackgroundImageObject(target)) return null;
      const source = getImageSourceSize(target);
      const bounds = getObjectBounds(target);
      return {
        objectId,
        sourceWidth: source.width,
        sourceHeight: source.height,
        currentCrop: getCurrentImageCrop(target),
        objectBounds: {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
          rotation: normalizeRotationDegrees(target.angle ?? 0),
        },
      };
    },
    [findLayerObjectById, getActiveCanvas],
  );

  const startImageCropMode = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    const target = canvas.getActiveObject();
    if (!(target instanceof fabric.FabricImage) || isBackgroundImageObject(target)) return;
    const id = String((target as any).kaveroId ?? "");
    if (!id) return;
    imageCropStartRef.current = { objectId: id, crop: getCurrentImageCrop(target) };
    setImageCropModeObjectId(id);
    target.set({ borderColor: "#FFFFFF", cornerColor: "#FFFFFF", cornerStrokeColor: "#8B5CF6" } as any);
    lockCanvasForImageCrop(canvas, target, imageCropObjectStateRef);
    clearCropHelpers(canvas);
    canvas.requestRenderAll();
  }, [getActiveCanvas]);

  const endImageCropMode = useCallback(() => {
    const canvas = getActiveCanvas();
    const id = imageCropModeObjectIdRef.current;
    if (canvas && id) {
      const target = findLayerObjectById(canvas, id);
      if (target) target.set({ selectable: true, evented: true, hasControls: true, opacity: 1, borderColor: "#60A5FA", cornerColor: "#ffffff", cornerStrokeColor: "#60A5FA" } as any);
      restoreCanvasAfterImageCrop(canvas, imageCropObjectStateRef);
      clearCropHelpers(canvas);
      if (target) canvas.setActiveObject(target);
      canvas.requestRenderAll();
    }
    imageCropStartRef.current = null;
    setImageCropModeObjectId(null);
  }, [findLayerObjectById, getActiveCanvas]);

  const cancelImageCropMode = useCallback(() => {
    const canvas = getActiveCanvas();
    const pageId = activeCanvasIdRef.current;
    const start = imageCropStartRef.current;
    if (canvas && pageId && start) {
      const target = findLayerObjectById(canvas, start.objectId);
      if (target instanceof fabric.FabricImage) {
        applyImageCrop(target, start.crop, { outputFit: "preserve-frame" });
        target.set({ selectable: true, evented: true, hasControls: true, opacity: 1, borderColor: "#60A5FA", cornerColor: "#ffffff", cornerStrokeColor: "#60A5FA" } as any);
        restoreCanvasAfterImageCrop(canvas, imageCropObjectStateRef);
        clearCropHelpers(canvas);
        canvas.setActiveObject(target);
        canvas.requestRenderAll();
        saveHistory(pageId);
        setSelectedObject(target);
        refreshLayers(pageId);
        refreshSelectedObject((version) => version + 1);
      }
    }
    if (canvas) {
      restoreCanvasAfterImageCrop(canvas, imageCropObjectStateRef);
      clearCropHelpers(canvas);
    }
    imageCropStartRef.current = null;
    setImageCropModeObjectId(null);
  }, [findLayerObjectById, getActiveCanvas, refreshLayers, saveHistory]);

  const deleteSelected = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;
    active.forEach((obj) => canvas.remove(obj));
    canvas.discardActiveObject();
    canvas.requestRenderAll();
  }, [getActiveCanvas]);

  const copySelected = useCallback(async () => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    const active = canvas.getActiveObjects().filter((obj) => !isEditorHelperObject(obj));
    if (active.length === 0) return;
    clipboardRef.current = await Promise.all(active.map((obj) => obj.clone()));
  }, [getActiveCanvas]);

  const pasteClipboard = useCallback(async () => {
    const canvas = getActiveCanvas();
    const pageId = activeCanvasIdRef.current;
    if (!canvas || !pageId || clipboardRef.current.length === 0) return;
    const clones = await Promise.all(clipboardRef.current.map((obj) => obj.clone()));
    clones.forEach((clone) => {
      clone.set({ left: (clone.left || 0) + 24, top: (clone.top || 0) + 24 });
      resetObjectIds(clone);
      canvas.add(clone);
    });
    const selection =
      clones.length === 1
        ? clones[0]
        : new fabric.ActiveSelection(clones, { canvas });
    canvas.setActiveObject(selection);
    setSelectedObject(clones[0] ?? null);
    canvas.requestRenderAll();
    saveHistory(pageId);
  }, [getActiveCanvas, saveHistory]);

  const duplicateSelected = useCallback(async () => {
    await copySelected();
    await pasteClipboard();
  }, [copySelected, pasteClipboard]);

  const alignSelected = useCallback(
    (alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      const target = canvas?.getActiveObject();
      if (!canvas || !pageId || !target) return;
      const bounds = getObjectBounds(target);
      const next: Partial<fabric.FabricObject> = {};
      if (alignment === "left") next.left = (target.left || 0) - bounds.left;
      if (alignment === "center") next.left = (target.left || 0) + canvasWidth / 2 - bounds.centerX;
      if (alignment === "right") next.left = (target.left || 0) + canvasWidth - bounds.right;
      if (alignment === "top") next.top = (target.top || 0) - bounds.top;
      if (alignment === "middle") next.top = (target.top || 0) + canvasHeight / 2 - bounds.centerY;
      if (alignment === "bottom") next.top = (target.top || 0) + canvasHeight - bounds.bottom;
      target.set(next);
      target.setCoords();
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(target as fabric.FabricObject);
      refreshLayers(pageId);
      refreshSelectedObject((version) => version + 1);
    },
    [canvasHeight, canvasWidth, getActiveCanvas, refreshLayers, saveHistory],
  );

  const getSelectedLayerInfo = useCallback(() => {
    const canvas = getActiveCanvas();
    const target = canvas?.getActiveObject();
    if (!canvas || !target) return null;
    const objects = getLayerObjects(canvas);
    const index = objects.indexOf(target);
    if (index < 0) return null;
    return {
      level: index,
      min: 0,
      max: Math.max(0, objects.length - 1),
    };
  }, [getActiveCanvas, getLayerObjects]);

  const arrangeSelected = useCallback(
    (action: "front" | "forward" | "backward" | "back") => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      const target = canvas?.getActiveObject();
      if (!canvas || !pageId || !target) return;
      const info = getSelectedLayerInfo();
      if (!info) return;
      if ((action === "front" || action === "forward") && info.level >= info.max) return;
      if ((action === "back" || action === "backward") && info.level <= info.min) return;

      if (action === "front") canvas.bringObjectToFront(target);
      if (action === "forward") canvas.bringObjectForward(target);
      if (action === "backward") canvas.sendObjectBackwards(target);
      if (action === "back") canvas.sendObjectToBack(target);

      const bgObj = canvas.getObjects().find(isBackgroundImageObject);
      if (bgObj) canvas.sendObjectToBack(bgObj);
      canvas.setActiveObject(target);
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(target as fabric.FabricObject);
      refreshLayers(pageId);
      refreshSelectedObject((version) => version + 1);
    },
    [getActiveCanvas, getSelectedLayerInfo, refreshLayers, saveHistory],
  );

  const selectLayer = useCallback(
    (id: string) => {
      const canvas = getActiveCanvas();
      if (!canvas) return;
      const target = getLayerObjects(canvas).find((obj) => String((obj as any).kaveroId) === id);
      if (!target) return;
      canvas.setActiveObject(target);
      target.setCoords();
      canvas.requestRenderAll();
      setSelectedObject(target);
      refreshSelectedObject((version) => version + 1);
    },
    [getActiveCanvas, getLayerObjects],
  );

  const moveLayerToLevel = useCallback(
    (id: string, level: number) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (!canvas || !pageId) return;

      const objects = getLayerObjects(canvas);
      const target = objects.find((obj) => String((obj as any).kaveroId) === id);
      if (!target) return;

      const clampedLevel = Math.min(Math.max(Math.round(level), 0), Math.max(0, objects.length - 1));
      const currentLevel = objects.indexOf(target);
      if (currentLevel === clampedLevel) return;

      const stackWithoutTarget = canvas.getObjects().filter((obj) => obj !== target);
      let realObjectCount = 0;
      let targetStackIndex = stackWithoutTarget.length;
      for (let index = 0; index < stackWithoutTarget.length; index += 1) {
        if (isEditorHelperObject(stackWithoutTarget[index])) continue;
        if (realObjectCount === clampedLevel) {
          targetStackIndex = index;
          break;
        }
        realObjectCount += 1;
      }

      canvas.moveObjectTo(target, targetStackIndex);
      const bgObj = canvas.getObjects().find(isBackgroundImageObject);
      if (bgObj) canvas.sendObjectToBack(bgObj);
      canvas.setActiveObject(target);
      target.setCoords();
      canvas.requestRenderAll();
      saveHistory(pageId);
      setSelectedObject(target);
      refreshLayers(pageId);
      refreshSelectedObject((version) => version + 1);
    },
    [getActiveCanvas, getLayerObjects, refreshLayers, saveHistory],
  );

  const nudgeSelected = useCallback(
    (dx: number, dy: number) => {
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      const active = canvas?.getActiveObjects();
      if (!canvas || !pageId || !active || active.length === 0) return;
      active.forEach((obj) => {
        obj.set({ left: (obj.left || 0) + dx, top: (obj.top || 0) + dy });
        obj.setCoords();
      });
      canvas.requestRenderAll();
      saveHistory(pageId);
      refreshSelectedObject((version) => version + 1);
    },
    [getActiveCanvas, saveHistory],
  );

  // ── Undo / Redo ─────────────────────────────────────────────────────

  const restoreFromHistory = useCallback(
    (index: number) => {
      const pageId = activeCanvasIdRef.current;
      const canvas = getActiveCanvas();
      if (!canvas || !pageId) return;
      const hist = historyMapRef.current.get(pageId);
      if (!hist || index < 0 || index >= hist.entries.length) return;
      isRestoringRef.current.add(pageId);
      hist.index = index;
      const json = hist.entries[index];
      canvas.loadFromJSON(normalizeCanvasImageSources(JSON.parse(json))).then(() => {
        applyCanvasLogicalDimensions(canvas, canvasWidthRef.current, canvasHeightRef.current);
        ensureObjectIds(canvas);
        relayoutBackgroundImage(canvas);
        canvas.requestRenderAll();
        isRestoringRef.current.delete(pageId);
        updateUndoRedoState(pageId);
        emitCanvasChange(pageId);
        refreshLayers(pageId);
      });
    },
    [emitCanvasChange, getActiveCanvas, refreshLayers, relayoutBackgroundImage, updateUndoRedoState]
  );

  const undo = useCallback(() => {
    const pageId = activeCanvasIdRef.current;
    if (!pageId) return;
    const hist = historyMapRef.current.get(pageId);
    if (!hist) return;
    restoreFromHistory(hist.index - 1);
  }, [restoreFromHistory]);

  const redo = useCallback(() => {
    const pageId = activeCanvasIdRef.current;
    if (!pageId) return;
    const hist = historyMapRef.current.get(pageId);
    if (!hist) return;
    restoreFromHistory(hist.index + 1);
  }, [restoreFromHistory]);

  // ── Canvas size ─────────────────────────────────────────────────────

  const setCanvasSize = useCallback(
    (width: number, height: number) => {
      setCanvasWidth(width);
      setCanvasHeight(height);
      canvasWidthRef.current = width;
      canvasHeightRef.current = height;
      // Resize all canvases using Fabric's logical coordinate space.
      for (const [pageId, canvas] of canvasMapRef.current.entries()) {
        applyCanvasLogicalDimensions(canvas, width, height);
        relayoutBackgroundImage(canvas, width, height);
        canvas.requestRenderAll();
        emitCanvasChange(pageId);
      }
    },
    [emitCanvasChange, relayoutBackgroundImage]
  );

  // ── Zoom ────────────────────────────────────────────────────────────

  const zoomToFit = useCallback(() => {
    setZoom(fitScale);
  }, [fitScale]);

  const zoomIn = useCallback(() => {
    setZoom((z) => Math.min(z * 1.2, 3));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => Math.max(z / 1.2, 0.05));
  }, []);

  // ── Export ──────────────────────────────────────────────────────────

  const exportPNG = useCallback(async () => {
    const canvas = getActiveCanvas();
    if (!canvas) return;
    const imageSources = canvas
      .getObjects()
      .filter((obj) => obj instanceof fabric.FabricImage)
      .map((obj) => getImageSource(obj))
      .filter((source): source is string => Boolean(source));
    const invalidImages = imageSources.filter((source) => !isAllowedCanvasImageUrl(source));
    const missingPlaceholders = canvas
      .getObjects()
      .filter((obj) => (obj as any).kaveroKind === "missing-asset").length;

    if (invalidImages.length > 0 || missingPlaceholders > 0) {
      onErrorRef.current?.("Export blocked because one or more images are missing or invalid.");
      return;
    }

    const availability = await Promise.all(imageSources.map(isFetchableCanvasAsset));
    if (availability.some((available) => !available)) {
      const pageId = activeCanvasIdRef.current;
      if (pageId) isRestoringRef.current.add(pageId);
      let replaced = 0;
      try {
        replaced = await repairBrokenImages(canvas);
      } finally {
        if (pageId) isRestoringRef.current.delete(pageId);
      }
      canvas.requestRenderAll();
      if (replaced > 0 && pageId) saveHistory(pageId);
      onErrorRef.current?.("Export blocked because one or more storage-backed images are missing.");
      return;
    }

    applyCanvasLogicalDimensions(canvas, canvasWidthRef.current, canvasHeightRef.current);
    relayoutBackgroundImage(canvas, canvasWidthRef.current, canvasHeightRef.current);
    const activeObj = canvas.getActiveObject();
    canvas.discardActiveObject();
    canvas.requestRenderAll();

    let dataURL: string;
    try {
      dataURL = canvas.toDataURL({
        format: "png",
        multiplier: 2,
        quality: 1,
      });
    } catch (error) {
      console.error("Export failed:", error);
      onErrorRef.current?.("Export failed. Check that all storage-backed images are still available.");
      if (activeObj) {
        canvas.setActiveObject(activeObj);
        canvas.requestRenderAll();
      }
      return;
    }

    const link = document.createElement("a");
    link.download = "design.png";
    link.href = dataURL;
    link.click();

    if (activeObj) {
      canvas.setActiveObject(activeObj);
      canvas.requestRenderAll();
    }
  }, [getActiveCanvas]);

  // ── Serialization ───────────────────────────────────────────────────

  const getCanvasJSON = useCallback(() => {
    const canvas = getActiveCanvas();
    if (!canvas) return "{}";
    return serializeCanvas(canvas);
  }, [getActiveCanvas, saveHistory]);

  const getCanvasJSONForPage = useCallback((pageId: string) => {
    const canvas = canvasMapRef.current.get(pageId);
    if (!canvas) return "{}";
    return serializeCanvas(canvas);
  }, []);

  const getCanvasSceneSnapshot = useCallback((options?: { designId?: string | null; includeHelpers?: boolean }) => {
    const pageId = activeCanvasIdRef.current;
    const canvas = getActiveCanvas();
    if (!canvas || !pageId) return null;
    return createCanvasSceneSnapshot(canvas, {
      designId: options?.designId ?? null,
      pageId,
      includeHelpers: options?.includeHelpers,
      canvasWidth: canvasWidthRef.current,
      canvasHeight: canvasHeightRef.current,
    });
  }, [getActiveCanvas]);

  const getCanvasRelationMap = useCallback((options?: { designId?: string | null; includeHelpers?: boolean }) => {
    const snapshot = getCanvasSceneSnapshot(options);
    return snapshot ? createCanvasRelationMap(snapshot) : null;
  }, [getCanvasSceneSnapshot]);

  const getCanvasVisualPreview = useCallback((): CanvasVisualPreview | null => {
    const pageId = activeCanvasIdRef.current;
    const canvas = getActiveCanvas();
    if (!canvas || !pageId) return null;
    return createCanvasVisualPreview(canvas, pageId);
  }, [getActiveCanvas]);

  const executeCanvasTool = useCallback(
    async (name: CanvasToolName, input: unknown): Promise<CanvasToolResult> => {
      const requireCanvas = () => {
        const canvas = getActiveCanvas();
        const pageId = activeCanvasIdRef.current;
        if (!canvas || !pageId) return null;
        return { canvas, pageId };
      };

      return executeRegisteredCanvasTool(name, input, {
        addText: ({ preset, text }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("add_text", "No active canvas.");
          addText(preset);
          const target = active.canvas.getActiveObject();
          if (text && target instanceof fabric.Textbox) {
            target.set({ text });
            target.setCoords();
            active.canvas.requestRenderAll();
            saveHistory(active.pageId);
          }
          const ids = getActiveObjectIds(active.canvas);
          return canvasToolSuccess("add_text", `Added ${preset} text.`, { changedObjectIds: ids, selectedObjectIds: ids });
        },
        addShape: ({ type }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("add_shape", "No active canvas.");
          addShape(type);
          const ids = getActiveObjectIds(active.canvas);
          return canvasToolSuccess("add_shape", `Added ${type} shape.`, { changedObjectIds: ids, selectedObjectIds: ids });
        },
        addUploadedImage: async ({ assetUrl, position }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("add_uploaded_image", "No active canvas.");
          await addImage(assetUrl, position);
          const ids = getActiveObjectIds(active.canvas);
          return canvasToolSuccess("add_uploaded_image", "Added uploaded image.", { changedObjectIds: ids, selectedObjectIds: ids });
        },
        generateImageAsset: () => canvasToolFailure("generate_image_asset", "Image generation is only available from the canvas sidebar."),
        setBackground: (background) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("set_background", "No active canvas.");
          setBackground(background.type, background.value, background.type === "image" ? { fit: background.fit } : undefined);
          return canvasToolSuccess("set_background", `Set ${background.type} background.`);
        },
        setImageAsBackground: ({ objectId, fit = "cover" }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("set_image_as_background", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("set_image_as_background", `Object ${objectId} was not found.`);
          if (!(target instanceof fabric.FabricImage)) {
            return canvasToolFailure("set_image_as_background", `Object ${objectId} is not an image.`);
          }

          const source = normalizeCanvasAssetUrl((target as any).kaveroAssetSrc ?? getImageSource(target));
          if (!source) {
            return canvasToolFailure("set_image_as_background", "Only uploaded Kavero image assets can be used as canvas backgrounds.");
          }

          const changedObjectIds = new Set<string>([objectId]);
          const existingBg = getBackgroundImageObject(active.canvas);
          if (existingBg && existingBg !== target) {
            ensureObjectId(existingBg);
            changedObjectIds.add(String((existingBg as any).kaveroId));
            const existingSource = normalizeCanvasAssetUrl((existingBg as any).kaveroBgSrc ?? getImageSource(existingBg));
            existingBg.set({
              selectable: true,
              evented: true,
              lockMovementX: false,
              lockMovementY: false,
              lockScalingX: false,
              lockScalingY: false,
              lockRotation: false,
              hasControls: true,
              kaveroAssetSrc: existingSource ?? undefined,
            } as any);
            delete (existingBg as any)._isBgImage;
            delete (existingBg as any).kaveroKind;
            delete (existingBg as any).kaveroBgSrc;
            delete (existingBg as any).kaveroBgFit;
          }

          setBackgroundImageFitState(fit);
          backgroundImageFitRef.current = fit;
          target.set({
            _isBgImage: true,
            kaveroKind: "background-image",
            kaveroAssetSrc: source,
            kaveroBgSrc: source,
            kaveroBgFit: fit,
            selectable: false,
            evented: false,
            lockMovementX: true,
            lockMovementY: true,
            lockScalingX: true,
            lockScalingY: true,
            lockRotation: true,
            hasControls: false,
            crossOrigin: "anonymous",
          } as any);
          applyBackgroundImageLayout(target, fit, canvasWidthRef.current, canvasHeightRef.current);
          active.canvas.discardActiveObject();
          active.canvas.sendObjectToBack(target);
          target.setCoords();
          active.canvas.requestRenderAll();
          setSelectedObject(null);
          refreshSelectedObject((version) => version + 1);
          saveHistory(active.pageId);
          refreshLayers(active.pageId);
          return canvasToolSuccess("set_image_as_background", "Set image as canvas background.", {
            changedObjectIds: Array.from(changedObjectIds),
            data: { objectId, fit },
          });
        },
        removeBackgroundImage: ({ mode = "delete" }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("remove_background_image", "No active canvas.");
          const background = getBackgroundImageObject(active.canvas);
          if (!background) return canvasToolFailure("remove_background_image", "No background image is set.");

          ensureObjectId(background);
          const objectId = String((background as any).kaveroId);
          const source = normalizeCanvasAssetUrl((background as any).kaveroBgSrc ?? getImageSource(background));

          if (mode === "detach") {
            background.set({
              selectable: true,
              evented: true,
              lockMovementX: false,
              lockMovementY: false,
              lockScalingX: false,
              lockScalingY: false,
              lockRotation: false,
              hasControls: true,
              kaveroAssetSrc: source ?? undefined,
            } as any);
            delete (background as any)._isBgImage;
            delete (background as any).kaveroKind;
            delete (background as any).kaveroBgSrc;
            delete (background as any).kaveroBgFit;
            active.canvas.setActiveObject(background);
            setSelectedObject(background);
          } else {
            active.canvas.discardActiveObject();
            active.canvas.remove(background);
            setSelectedObject(null);
          }

          active.canvas.requestRenderAll();
          refreshSelectedObject((version) => version + 1);
          saveHistory(active.pageId);
          refreshLayers(active.pageId);
          return canvasToolSuccess(
            "remove_background_image",
            mode === "detach" ? "Detached background image." : "Removed background image.",
            {
              changedObjectIds: [objectId],
              selectedObjectIds: mode === "detach" ? [objectId] : [],
              data: { objectId, mode },
            },
          );
        },
        setCanvasSize: ({ width, height }) => {
          setCanvasSize(width, height);
          return canvasToolSuccess("set_canvas_size", `Set canvas size to ${width} x ${height}.`, { data: { width, height } });
        },
        updateObject: ({ objectId, props }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("update_object", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("update_object", `Object ${objectId} was not found.`);
          setActiveObjectsByIds(active.canvas, [objectId]);
          const nextProps = { ...props };
          if ("locked" in nextProps) {
            const locked = Boolean(nextProps.locked);
            delete nextProps.locked;
            Object.assign(nextProps, {
              lockMovementX: locked,
              lockMovementY: locked,
              lockScalingX: locked,
              lockScalingY: locked,
              lockRotation: locked,
              selectable: !locked,
              evented: !locked,
            });
          }
          updateSelectedObject(nextProps);
          return canvasToolSuccess("update_object", `Updated object ${objectId}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
          });
        },
        transformObject: ({ objectId, left, top, width, height, rotation, scaleX, scaleY, skewX, skewY }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("transform_object", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("transform_object", `Object ${objectId} was not found.`);
          const next: Partial<fabric.FabricObject> = {};
          if (left !== undefined) next.left = left;
          if (top !== undefined) next.top = top;
          if (rotation !== undefined) next.angle = normalizeRotationDegrees(rotation);
          if (scaleX !== undefined) next.scaleX = scaleX;
          if (scaleY !== undefined) next.scaleY = scaleY;
          if (skewX !== undefined) next.skewX = skewX;
          if (skewY !== undefined) next.skewY = skewY;
          if (width !== undefined) next.scaleX = width / Math.max(1, target.width || 1);
          if (height !== undefined) next.scaleY = height / Math.max(1, target.height || 1);
          target.set(next);
          target.setCoords();
          active.canvas.setActiveObject(target);
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          return canvasToolSuccess("transform_object", `Transformed object ${objectId}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
          });
        },
        rotateObject: ({ objectId, rotation }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("rotate_object", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("rotate_object", `Object ${objectId} was not found.`);
          const nextRotation = normalizeRotationDegrees(rotation);
          target.set({ angle: nextRotation });
          target.setCoords();
          active.canvas.setActiveObject(target);
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          return canvasToolSuccess("rotate_object", `Rotated object ${objectId} to ${nextRotation} degrees.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
            data: { objectId, rotation: nextRotation },
          });
        },
        flipObject: ({ objectId, mode }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("flip_object", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("flip_object", `Object ${objectId} was not found.`);
          const flipX = mode === "horizontal" || mode === "both";
          const flipY = mode === "vertical" || mode === "both";
          target.set({ flipX, flipY });
          target.setCoords();
          active.canvas.setActiveObject(target);
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          return canvasToolSuccess("flip_object", `Set object ${objectId} flip mode to ${mode}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
            data: { objectId, mode, flipX, flipY },
          });
        },
        setObjectPerspective: ({ objectId, skewX, skewY }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("set_object_perspective", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("set_object_perspective", `Object ${objectId} was not found.`);
          target.set({ skewX, skewY });
          target.setCoords();
          active.canvas.setActiveObject(target);
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          return canvasToolSuccess("set_object_perspective", `Set object ${objectId} perspective to X ${skewX} degrees, Y ${skewY} degrees.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
            data: { objectId, skewX, skewY },
          });
        },
        setImageBorderRadius: ({ objectId, radius }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("set_image_border_radius", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!(target instanceof fabric.FabricImage) || isBackgroundImageObject(target)) {
            return canvasToolFailure("set_image_border_radius", `Image object ${objectId} was not found.`);
          }
          const safeRadius = applyImageBorderRadius(target, radius);
          active.canvas.setActiveObject(target);
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          return canvasToolSuccess("set_image_border_radius", `Set image border radius to ${safeRadius}px.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
            data: { objectId, radius: safeRadius },
          });
        },
        getImageObjectInfo: ({ objectId }) => {
          const info = getImageCropInfo(objectId);
          if (!info) return canvasToolFailure("get_image_object_info", `Image object ${objectId} was not found.`);
          return canvasToolSuccess("get_image_object_info", `Read image object ${objectId} crop metadata.`, {
            selectedObjectIds: [objectId],
            data: info,
          });
        },
        cropImageObject: ({ objectId, crop, outputFit = "preserve-frame" }) => {
          const before = getImageCropInfo(objectId);
          if (!before) return canvasToolFailure("crop_image_object", `Image object ${objectId} was not found.`);
          const ok = cropImageObject(objectId, crop, { outputFit });
          const after = getImageCropInfo(objectId);
          if (!ok || !after) return canvasToolFailure("crop_image_object", `Unable to crop image object ${objectId}.`);
          return canvasToolSuccess("crop_image_object", `Cropped image object ${objectId} to ${after.currentCrop.width} x ${after.currentCrop.height} source pixels.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
            data: { before, after, outputFit },
          });
        },
        resetImageCrop: ({ objectId }) => {
          const before = getImageCropInfo(objectId);
          if (!before) return canvasToolFailure("reset_image_crop", `Image object ${objectId} was not found.`);
          const ok = resetImageCrop(objectId);
          const after = getImageCropInfo(objectId);
          if (!ok || !after) return canvasToolFailure("reset_image_crop", `Unable to reset crop for image object ${objectId}.`);
          return canvasToolSuccess("reset_image_crop", `Reset crop for image object ${objectId}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
            data: { before, after },
          });
        },
        fitObjectsInCanvas: ({ objectIds, padding = 24, preserveAspectRatio = true }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("fit_objects_in_canvas", "No active canvas.");
          const targets = objectIds.map((id) => findLayerObjectById(active.canvas, id)).filter((obj): obj is fabric.FabricObject => Boolean(obj));
          if (targets.length === 0) return canvasToolFailure("fit_objects_in_canvas", "No matching objects were found.");
          targets.forEach((target) => fitObjectInsideCanvas(target, active.canvas.getWidth(), active.canvas.getHeight(), padding, preserveAspectRatio));
          active.canvas.setActiveObject(targets.length === 1 ? targets[0] : new fabric.ActiveSelection(targets, { canvas: active.canvas }));
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(targets[0]);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          const ids = targets.map((target) => String((target as any).kaveroId));
          return canvasToolSuccess("fit_objects_in_canvas", `Fit ${targets.length} object${targets.length === 1 ? "" : "s"} inside canvas.`, {
            changedObjectIds: ids,
            selectedObjectIds: ids,
          });
        },
        repairCanvasOverflow: ({ scope = "selected", padding = 24 }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("repair_canvas_overflow", "No active canvas.");
          const source = scope === "selected" ? active.canvas.getActiveObjects() : getLayerObjects(active.canvas);
          const targets = source.filter((obj) => !isEditorHelperObject(obj) && objectOverflowsCanvas(obj, active.canvas.getWidth(), active.canvas.getHeight(), padding));
          if (targets.length === 0) return canvasToolSuccess("repair_canvas_overflow", "No overflowing objects found.", { changedObjectIds: [] });
          targets.forEach((target) => fitObjectInsideCanvas(target, active.canvas.getWidth(), active.canvas.getHeight(), padding, true));
          active.canvas.setActiveObject(targets.length === 1 ? targets[0] : new fabric.ActiveSelection(targets, { canvas: active.canvas }));
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(targets[0]);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          const ids = targets.map((target) => String((target as any).kaveroId));
          return canvasToolSuccess("repair_canvas_overflow", `Repaired overflow for ${targets.length} object${targets.length === 1 ? "" : "s"}.`, {
            changedObjectIds: ids,
            selectedObjectIds: ids,
          });
        },
        normalizeTextBox: ({ objectId, maxWidth, maxHeight, padding = 24 }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("normalize_text_box", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("normalize_text_box", `Object ${objectId} was not found.`);
          if (!(target instanceof fabric.Textbox || target instanceof fabric.IText || target instanceof fabric.Text)) {
            return canvasToolFailure("normalize_text_box", `Object ${objectId} is not a text object.`);
          }
          normalizeTextObject(target, active.canvas.getWidth(), active.canvas.getHeight(), { maxWidth, maxHeight, padding });
          fitObjectInsideCanvas(target, active.canvas.getWidth(), active.canvas.getHeight(), padding, true);
          active.canvas.setActiveObject(target);
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          return canvasToolSuccess("normalize_text_box", `Normalized text object ${objectId}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
          });
        },
        layoutStack: ({ objectIds, direction, bounds, gap = 24, align = "center" }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("layout_stack", "No active canvas.");
          const targets = objectIds.map((id) => findLayerObjectById(active.canvas, id)).filter((obj): obj is fabric.FabricObject => Boolean(obj));
          if (targets.length === 0) return canvasToolFailure("layout_stack", "No matching objects were found.");
          layoutObjectsInStack(targets, direction, bounds, gap, align);
          active.canvas.setActiveObject(targets.length === 1 ? targets[0] : new fabric.ActiveSelection(targets, { canvas: active.canvas }));
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(targets[0]);
          refreshLayers(active.pageId);
          refreshSelectedObject((version) => version + 1);
          const ids = targets.map((target) => String((target as any).kaveroId));
          return canvasToolSuccess("layout_stack", `Arranged ${targets.length} object${targets.length === 1 ? "" : "s"} in a ${direction} stack.`, {
            changedObjectIds: ids,
            selectedObjectIds: ids,
          });
        },
        alignObject: ({ objectId, alignment }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("align_object", "No active canvas.");
          if (!findLayerObjectById(active.canvas, objectId)) return canvasToolFailure("align_object", `Object ${objectId} was not found.`);
          setActiveObjectsByIds(active.canvas, [objectId]);
          alignSelected(alignment);
          return canvasToolSuccess("align_object", `Aligned object ${objectId} ${alignment}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
          });
        },
        reorderObject: ({ objectId, action, level }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("reorder_object", "No active canvas.");
          if (!findLayerObjectById(active.canvas, objectId)) return canvasToolFailure("reorder_object", `Object ${objectId} was not found.`);
          setActiveObjectsByIds(active.canvas, [objectId]);
          if (typeof level === "number") moveLayerToLevel(objectId, level);
          else if (action) arrangeSelected(action);
          return canvasToolSuccess("reorder_object", `Reordered object ${objectId}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
          });
        },
        selectObject: ({ objectId }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("select_object", "No active canvas.");
          const targets = setActiveObjectsByIds(active.canvas, [objectId]);
          if (targets.length === 0) return canvasToolFailure("select_object", `Object ${objectId} was not found.`);
          return canvasToolSuccess("select_object", `Selected object ${objectId}.`, { selectedObjectIds: [objectId] });
        },
        deleteObjects: ({ objectIds }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("delete_objects", "No active canvas.");
          const targets = setActiveObjectsByIds(active.canvas, objectIds);
          if (targets.length === 0) return canvasToolFailure("delete_objects", "No matching objects were found.");
          deleteSelected();
          return canvasToolSuccess("delete_objects", `Deleted ${targets.length} object${targets.length === 1 ? "" : "s"}.`, {
            changedObjectIds: targets.map((target) => String((target as any).kaveroId)),
          });
        },
        duplicateObjects: async ({ objectIds }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("duplicate_objects", "No active canvas.");
          const targets = setActiveObjectsByIds(active.canvas, objectIds);
          if (targets.length === 0) return canvasToolFailure("duplicate_objects", "No matching objects were found.");
          await duplicateSelected();
          const ids = getActiveObjectIds(active.canvas);
          return canvasToolSuccess("duplicate_objects", `Duplicated ${targets.length} object${targets.length === 1 ? "" : "s"}.`, {
            changedObjectIds: ids,
            selectedObjectIds: ids,
          });
        },
        setObjectShadow: ({ objectId, shadow }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("set_object_shadow", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("set_object_shadow", `Object ${objectId} was not found.`);
          if (shadow === null || shadow === undefined) {
            target.set("shadow" as any, null);
          } else {
            target.set("shadow" as any, new fabric.Shadow({
              color: shadow.color,
              blur: shadow.blur,
              offsetX: shadow.offsetX,
              offsetY: shadow.offsetY,
            }));
          }
          target.setCoords();
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshSelectedObject((v) => v + 1);
          return canvasToolSuccess("set_object_shadow", shadow ? `Set shadow on ${objectId}.` : `Removed shadow from ${objectId}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
          });
        },
        setObjectBlur: ({ objectId, blur }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("set_object_blur", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("set_object_blur", `Object ${objectId} was not found.`);
          const clampedBlur = Math.min(1, Math.max(0, blur));
          if (clampedBlur === 0) {
            (target as any).filters = [];
          } else {
            const existing: any[] = Array.isArray((target as any).filters) ? (target as any).filters : [];
            const withoutBlur = existing.filter((f: any) => f?.type !== "Blur" && f?.constructor?.name !== "Blur");
            withoutBlur.push(new (fabric.filters as any).Blur({ blur: clampedBlur }));
            (target as any).filters = withoutBlur;
          }
          if (typeof (target as any).applyFilters === "function") (target as any).applyFilters();
          target.setCoords();
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshSelectedObject((v) => v + 1);
          return canvasToolSuccess("set_object_blur", `Set blur ${clampedBlur} on ${objectId}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
          });
        },
        setObjectBlendMode: ({ objectId, blendMode }: { objectId: string; blendMode: BlendMode }) => {
          const active = requireCanvas();
          if (!active) return canvasToolFailure("set_object_blend_mode", "No active canvas.");
          const target = findLayerObjectById(active.canvas, objectId);
          if (!target) return canvasToolFailure("set_object_blend_mode", `Object ${objectId} was not found.`);
          target.set("globalCompositeOperation" as any, blendMode);
          target.setCoords();
          active.canvas.requestRenderAll();
          saveHistory(active.pageId);
          setSelectedObject(target);
          refreshSelectedObject((v) => v + 1);
          return canvasToolSuccess("set_object_blend_mode", `Set blend mode '${blendMode}' on ${objectId}.`, {
            changedObjectIds: [objectId],
            selectedObjectIds: [objectId],
          });
        },
        undo: () => {
          if (!canUndo) return canvasToolFailure("undo", "Nothing to undo.");
          undo();
          return canvasToolSuccess("undo", "Undid the latest canvas edit.");
        },
        redo: () => {
          if (!canRedo) return canvasToolFailure("redo", "Nothing to redo.");
          redo();
          return canvasToolSuccess("redo", "Redid the latest canvas edit.");
        },
        save: () => canvasToolFailure("save", "Save is not available from the canvas-only action context."),
      });
    },
    [
      addImage,
      addShape,
      addText,
      alignSelected,
      arrangeSelected,
      canRedo,
      canUndo,
      deleteSelected,
      duplicateSelected,
      findLayerObjectById,
      getActiveCanvas,
      getActiveObjectIds,
      getImageCropInfo,
      moveLayerToLevel,
      redo,
      refreshLayers,
      resetImageCrop,
      saveHistory,
      setActiveObjectsByIds,
      setBackground,
      setCanvasSize,
      undo,
      cropImageObject,
      updateSelectedObject,
    ],
  );

  const loadTemplate = useCallback(
    (template: Template) => {
      setCanvasWidth(template.width);
      setCanvasHeight(template.height);
      // Template loading — resize all canvases to new dimensions
      for (const canvas of canvasMapRef.current.values()) {
        applyCanvasLogicalDimensions(canvas, template.width, template.height);
        relayoutBackgroundImage(canvas, template.width, template.height);
      }
      // Load template JSON onto active canvas
      const canvas = getActiveCanvas();
      const pageId = activeCanvasIdRef.current;
      if (canvas && pageId) {
        isRestoringRef.current.add(pageId);
        canvas.loadFromJSON(normalizeCanvasImageSources(JSON.parse(template.canvas_json))).then(() => {
          applyCanvasLogicalDimensions(canvas, template.width, template.height);
          ensureObjectIds(canvas);
          relayoutBackgroundImage(canvas, template.width, template.height);
          canvas.requestRenderAll();
          isRestoringRef.current.delete(pageId);
          const json = serializeCanvas(canvas);
          historyMapRef.current.set(pageId, {
            entries: [json],
            index: 0,
          });
          updateUndoRedoState(pageId);
          emitCanvasChange(pageId);
          refreshLayers(pageId);
        });
      }
    },
    [emitCanvasChange, getActiveCanvas, refreshLayers, relayoutBackgroundImage, updateUndoRedoState]
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (canvasLockedRef.current) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) return;
      snapDisabledRef.current = e.metaKey || e.ctrlKey;
      const meta = e.metaKey || e.ctrlKey;
      if (imageCropModeObjectIdRef.current && e.key === "Escape") {
        e.preventDefault();
        cancelImageCropMode();
        return;
      }
      if (imageCropModeObjectIdRef.current && e.key === "Enter") {
        e.preventDefault();
        endImageCropMode();
        return;
      }
      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (meta && e.key.toLowerCase() === "c" && !isTextEditing()) {
        e.preventDefault();
        void copySelected();
      } else if (meta && e.key.toLowerCase() === "v" && !isTextEditing()) {
        e.preventDefault();
        void pasteClipboard();
      } else if (meta && e.key.toLowerCase() === "d" && !isTextEditing()) {
        e.preventDefault();
        void duplicateSelected();
      } else if (meta && e.altKey && e.key === "]" && !isTextEditing()) {
        e.preventDefault();
        arrangeSelected("front");
      } else if (meta && e.key === "]" && !isTextEditing()) {
        e.preventDefault();
        arrangeSelected("forward");
      } else if (meta && e.altKey && e.key === "[" && !isTextEditing()) {
        e.preventDefault();
        arrangeSelected("back");
      } else if (meta && e.key === "[" && !isTextEditing()) {
        e.preventDefault();
        arrangeSelected("backward");
      } else if ((e.key === "Delete" || e.key === "Backspace") && !isTextEditing()) {
        e.preventDefault();
        deleteSelected();
      } else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) && !isTextEditing()) {
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        e.preventDefault();
        nudgeSelected(dx, dy);
      }
    };
    const keyupHandler = (e: KeyboardEvent) => {
      snapDisabledRef.current = e.metaKey || e.ctrlKey;
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keyup", keyupHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("keyup", keyupHandler);
    };
  }, [undo, redo, deleteSelected, copySelected, pasteClipboard, duplicateSelected, nudgeSelected, arrangeSelected, endImageCropMode, cancelImageCropMode]);

  function isTextEditing(): boolean {
    const canvas = getActiveCanvas();
    if (!canvas) return false;
    const obj = canvas.getActiveObject();
    return obj instanceof fabric.Textbox && obj.isEditing === true;
  }

  return {
    // Canvas map management
    registerCanvas,
    unregisterCanvas,
    setActiveCanvas,
    activeCanvasId,
    canvasMap: canvasMapRef,
    // For backward compat (right-sidebar uses canvas directly)
    get canvas() {
      return getActiveCanvas();
    },
    selectedObject,
    canvasWidth,
    canvasHeight,
    zoom,
    setZoomRaw: setZoom,
    fitScale,
    setFitScale,
    snapEnabled,
    setSnapEnabled,
    layers,
    backgroundImageFit,
    addText,
    addShape,
    addImage,
    setBackground,
    setBackgroundImageFit,
    updateSelectedObject,
    setImageBorderRadius,
    cropImageObject,
    resetImageCrop,
    getImageCropInfo,
    startImageCropMode,
    endImageCropMode,
    cancelImageCropMode,
    imageCropModeObjectId,
    deleteSelected,
    duplicateSelected,
    copySelected,
    pasteClipboard,
    alignSelected,
    arrangeSelected,
    getSelectedLayerInfo,
    selectLayer,
    moveLayerToLevel,
    undo,
    redo,
    canUndo,
    canRedo,
    setCanvasSize,
    zoomToFit,
    zoomIn,
    zoomOut,
    exportPNG,
    getCanvasJSON,
    getCanvasJSONForPage,
    getCanvasSceneSnapshot,
    getCanvasRelationMap,
    getCanvasVisualPreview,
    executeCanvasTool,
    loadTemplate,
  };
}
