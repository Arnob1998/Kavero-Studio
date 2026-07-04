import type { ComponentType } from "react";
import type { FeatureKey } from "@/modules/features/features";
import type { CanvasToolName, CanvasToolResult, CanvasToolRisk } from "@/modules/canvas/actions/canvas-tool-registry";

export type EditorPanelId = "text" | "shapes" | "generate" | "images" | "autoSegment" | "layers" | "relations" | "copilot";

export type EditorPanelDefinition = {
  id: EditorPanelId;
  label: string;
  title: string;
  feature: FeatureKey;
  width: 240 | 360;
  icon: ComponentType<{ size?: number; className?: string }>;
};

export type AssistantMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type AssistantToolCall = {
  id: string;
  toolName: CanvasToolName;
  input: Record<string, unknown>;
  summary: string;
  status: "pending" | "applied" | "rejected" | "error";
  riskLevel: CanvasToolRisk;
  requiresConfirmation: boolean;
  result?: CanvasToolResult;
};

export type AssistantStatus = "planning" | "executing" | "verifying" | "awaiting_review" | "repairing" | null;

export type PendingAssistantToolCall = Omit<AssistantToolCall, "riskLevel" | "requiresConfirmation"> & {
  forceConfirmation?: boolean;
};

export type CanvasImageModel = "gemini-3.1-flash-image-preview" | "gemini-3-pro-image-preview" | "gemini-2.5-flash-image";
export type CanvasImageBatchSize = 4 | 8 | 12 | 16;
export type CanvasImageThinking = "fast" | "balanced" | "deep";
export type CanvasImageQuality = "1K" | "2K" | "4K";
export type CanvasImageBackgroundPreference = "auto" | "white" | "black";

export type CanvasImageGenerationSettings = {
  enabled: boolean;
  model: CanvasImageModel;
  batchSize: CanvasImageBatchSize;
  thinking: CanvasImageThinking;
  aspectRatio: string;
  imageSize: CanvasImageQuality;
  transparentBackgroundDefault: boolean;
};

export type GeneratedCanvasImage = {
  id: string;
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  variant: number;
  prompt: string;
  transparentBackground: boolean;
};

export type AutoSegmentCategoryKey = "background" | "people" | "products" | "objects" | "text_graphics" | "other";

export type AutoSegmentSource = {
  assetId: string;
  assetUrl: string;
  name: string;
};

export type AutoSegmentStatus = "idle" | "analyzing" | "isolating" | "uploading" | "ready" | "error";

export type AutoSegmentAsset = {
  id: string;
  label: string;
  category: AutoSegmentCategoryKey;
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  previewBackground: string;
  crop: AutoSegmentCrop | null;
  confidence?: number;
};

export type AutoSegmentCrop = {
  x: number;
  y: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type AutoSegmentPlacement = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type AutoSegmentGroup = {
  key: AutoSegmentCategoryKey;
  label: string;
  segments: AutoSegmentAsset[];
};
