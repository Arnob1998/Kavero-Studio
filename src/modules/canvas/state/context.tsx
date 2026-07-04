import { createContext } from "react";
import { useContext } from "react";
import type { Design, Template, Page } from "@/modules/canvas/types/editor-types";
import type * as fabric from "fabric";
import type { CanvasSceneSnapshot } from "@/modules/canvas/state/scene-snapshot";
import type { SceneRelationMap } from "@/modules/canvas/state/relation-map";
import type { CanvasToolName, CanvasToolResult } from "@/modules/canvas/actions/canvas-tool-registry";
import type { CanvasVisualPreview } from "@/modules/canvas/utils/canvas-visual-preview";

export interface CanvasSize {
  label: string;
  platform: string;
  category: "social" | "video" | "presentation" | "web" | "print";
  width: number;
  height: number;
}

export interface CanvasLayer {
  id: string;
  label: string;
  kind: "text" | "image" | "shape" | "group" | "unknown";
  level: number;
  max: number;
  color: string | null;
  width: number;
  height: number;
}

export type BackgroundImageFit = "cover" | "contain" | "stretch" | "overflow";
export type ImageCropUnit = "source_px" | "normalized";

export interface ImageCropInput {
  unit: ImageCropUnit;
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CANVAS_SIZE_GROUPS: { platform: string; category: CanvasSize["category"]; sizes: Omit<CanvasSize, "platform" | "category">[] }[] = [
  {
    platform: "LinkedIn",
    category: "social",
    sizes: [
      { label: "Square Post", width: 1080, height: 1080 },
      { label: "Landscape Post", width: 1200, height: 627 },
      { label: "Portrait Post", width: 1200, height: 1500 },
      { label: "Banner", width: 1584, height: 396 },
    ],
  },
  {
    platform: "Instagram",
    category: "social",
    sizes: [
      { label: "Square Post", width: 1080, height: 1080 },
      { label: "Portrait Post", width: 1080, height: 1350 },
      { label: "Landscape Post", width: 1080, height: 566 },
      { label: "Story / Reel", width: 1080, height: 1920 },
    ],
  },
  {
    platform: "Facebook",
    category: "social",
    sizes: [
      { label: "Post", width: 1200, height: 630 },
      { label: "Story", width: 1080, height: 1920 },
      { label: "Cover", width: 1640, height: 924 },
    ],
  },
  {
    platform: "X / Twitter",
    category: "social",
    sizes: [
      { label: "Post", width: 1600, height: 900 },
      { label: "Header", width: 1500, height: 500 },
    ],
  },
  {
    platform: "YouTube",
    category: "video",
    sizes: [
      { label: "Thumbnail", width: 1280, height: 720 },
      { label: "Channel Art", width: 2560, height: 1440 },
      { label: "Shorts", width: 1080, height: 1920 },
    ],
  },
  {
    platform: "TikTok",
    category: "video",
    sizes: [
      { label: "Video", width: 1080, height: 1920 },
      { label: "Profile Photo", width: 1080, height: 1080 },
    ],
  },
  {
    platform: "Pinterest",
    category: "social",
    sizes: [
      { label: "Pin", width: 1000, height: 1500 },
      { label: "Square Pin", width: 1000, height: 1000 },
    ],
  },
  {
    platform: "Presentation",
    category: "presentation",
    sizes: [
      { label: "Widescreen", width: 1920, height: 1080 },
      { label: "Standard", width: 1024, height: 768 },
    ],
  },
  {
    platform: "Website",
    category: "web",
    sizes: [
      { label: "Desktop Hero", width: 1366, height: 768 },
      { label: "Open Graph", width: 1200, height: 630 },
      { label: "Square Banner", width: 1080, height: 1080 },
    ],
  },
  {
    platform: "Print",
    category: "print",
    sizes: [
      { label: "A4 Portrait", width: 2480, height: 3508 },
      { label: "A4 Landscape", width: 3508, height: 2480 },
      { label: "US Letter", width: 2550, height: 3300 },
    ],
  },
];

export const CANVAS_SIZES: CanvasSize[] = CANVAS_SIZE_GROUPS.flatMap((group) =>
  group.sizes.map((size) => ({ ...size, platform: group.platform, category: group.category })),
);

export interface EditorContextValue {
  // Canvas (multi-canvas)
  registerCanvas: (pageId: string, canvas: fabric.Canvas) => void;
  unregisterCanvas: (pageId: string) => void;
  setActiveCanvas: (pageId: string) => void;
  activeCanvasId: string | null;
  canvas: fabric.Canvas | null;
  selectedObject: fabric.FabricObject | null;
  canvasWidth: number;
  canvasHeight: number;
  zoom: number;
  setZoomRaw: (z: number) => void;
  fitScale: number;
  setFitScale: (s: number) => void;
  snapEnabled: boolean;
  setSnapEnabled: (enabled: boolean) => void;
  layers: CanvasLayer[];

  // Canvas actions
  addText: (preset: "heading" | "subheading" | "body") => void;
  addShape: (type: "rect" | "circle" | "line" | "triangle") => void;
  addImage: (url: string, position?: { x: number; y: number }) => void;
  setBackground: (type: "color" | "gradient" | "image", value: string, options?: { fit?: BackgroundImageFit }) => void;
  setBackgroundImageFit: (fit: BackgroundImageFit) => void;
  backgroundImageFit: BackgroundImageFit;
  updateSelectedObject: (props: Record<string, unknown>) => void;
  setImageBorderRadius: (objectId: string, radius: number) => boolean;
  cropImageObject: (objectId: string, crop: ImageCropInput, options?: { outputFit?: "preserve-frame" | "resize-frame-to-crop" }) => boolean;
  resetImageCrop: (objectId: string) => boolean;
  getImageCropInfo: (objectId: string) => {
    objectId: string;
    sourceWidth: number;
    sourceHeight: number;
    currentCrop: { unit: "source_px"; x: number; y: number; width: number; height: number };
    objectBounds: { left: number; top: number; width: number; height: number; rotation: number };
  } | null;
  startImageCropMode: () => void;
  endImageCropMode: () => void;
  cancelImageCropMode: () => void;
  imageCropModeObjectId: string | null;
  deleteSelected: () => void;
  duplicateSelected: () => Promise<void>;
  copySelected: () => Promise<void>;
  pasteClipboard: () => Promise<void>;
  alignSelected: (alignment: "left" | "center" | "right" | "top" | "middle" | "bottom") => void;
  arrangeSelected: (action: "front" | "forward" | "backward" | "back") => void;
  getSelectedLayerInfo: () => { level: number; min: number; max: number } | null;
  selectLayer: (id: string) => void;
  moveLayerToLevel: (id: string, level: number) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setCanvasSize: (width: number, height: number) => void;
  zoomToFit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  exportPNG: () => void;
  getCanvasJSON: () => string;
  getCanvasJSONForPage: (pageId: string) => string;
  getCanvasSceneSnapshot: (options?: { includeHelpers?: boolean }) => CanvasSceneSnapshot | null;
  getCanvasRelationMap: (options?: { includeHelpers?: boolean }) => SceneRelationMap | null;
  getCanvasVisualPreview: () => CanvasVisualPreview | null;
  executeCanvasTool: (name: CanvasToolName, input?: unknown) => Promise<CanvasToolResult>;
  loadTemplate: (template: Template) => void;
  showError: (message: string) => void;
  clearError: () => void;

  // Router
  navigate: (to: string) => void;

  // Designs
  designs: Design[];
  activeDesign: Design | null;
  createDesign: () => Promise<string | undefined>;
  createFromTemplate: (template: Template) => Promise<string | undefined>;
  loadDesign: (id: string) => Promise<void>;
  saveDesign: () => Promise<void>;
  deleteDesign: (id: string) => Promise<void>;
  renameDesign: (id: string, name: string) => Promise<void>;
  saving: boolean;
  error: string | null;

  // Pages
  pages: Page[];
  activePageId: string | null;
  activePage: Page | null;
  addPage: (afterPageId?: string) => Promise<void>;
  duplicatePage: (pageId: string) => Promise<void>;
  deletePage: (pageId: string) => Promise<void>;
  renamePage: (pageId: string, title: string) => Promise<void>;
  switchToPage: (pageId: string) => void;
  updatePageDraft: (pageId: string, canvasJson: string) => void;

  // Templates
  templates: Template[];

  // State
  loading: boolean;
}

export const EditorContext = createContext<EditorContextValue>(null!);

export function useEditor() {
  return useContext(EditorContext);
}
