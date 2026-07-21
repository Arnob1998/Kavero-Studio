export interface PromptPreset {
  id: string;
  name: string;
  thumbnailIcon: PromptThumbnailIcon;
  prompt: string;
  referenceImages?: PresetReferenceImage[];
  persisted?: boolean;
}

export interface PromptThumbnailIcon {
  name: string;
  color: string;
  version: 1;
}

export interface PromptTemplateRecord {
  id: string;
  name: string;
  prompt: string;
  thumbnail_icon: PromptThumbnailIcon | null;
  reference_images: PresetReferenceImage[] | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type { SelectableLegacyImageModelId as ModelId } from "@/modules/model-providers/image-capabilities";

export interface ReferenceImage {
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/heic" | "image/heif";
  name: string;
  size: number;
}

export interface PresetReferenceImage {
  dataUrl?: string;
  src?: string;
  mimeType: ReferenceImage["mimeType"];
  name: string;
  size: number;
}

export interface GeneratedImage {
  id: string;
  dataUrl: string;
  mimeType: string;
  text?: string;
  variant: number;
}

export type SettingKey = "model" | "count" | "thinking" | "aspect" | "quality" | "providerQuality" | "background";

export interface GenerationRun {
  id: string;
  prompt: string;
  model: string;
  modelLabel: string;
  kind: "image";
  images: GeneratedImage[];
  text: string;
  referenceImages: ReferenceImage[];
  createdAt: string;
  settings: Record<SettingKey, string>;
  warnings: string[];
}

export interface GenerateApiResponse {
  model: string;
  modelLabel: string;
  kind: "image";
  images: GeneratedImage[];
  text: string;
  warnings: string[];
  settings: {
    count: number;
    thinking: string;
    aspectRatio: string;
    imageSize: string;
    quality: string;
    background: "auto" | "opaque" | "transparent";
    schema: string;
  };
}

export type UploadStatus = "idle" | "uploading" | "success" | "error";

export interface GenerateApiError {
  error?: string;
  details?: {
    fieldErrors?: Record<string, string[]>;
    formErrors?: string[];
  };
}

export interface PromptRefinerChoice {
  id: string;
  label: string;
  value: string;
  allowsCustom: boolean;
}

export interface PromptRefinerQuestion {
  id: string;
  text: string;
  options: PromptRefinerChoice[];
}

export interface PromptRefinerAnswer {
  question: string;
  answer: string;
}

export interface PromptRefinerApiResponse {
  status: "questions" | "refined";
  intentSummary: string;
  question?: PromptRefinerQuestion;
  refinedPrompt?: string;
  refinementNote?: string;
  maxQuestions: number;
}

export type PromptRefinerState =
  | { status: "idle"; answers: PromptRefinerAnswer[] }
  | { status: "loading"; answers: PromptRefinerAnswer[]; message: string }
  | {
      status: "question";
      answers: PromptRefinerAnswer[];
      intentSummary: string;
      question: PromptRefinerQuestion;
      maxQuestions: number;
      customAnswer: string;
    }
  | {
      status: "refined";
      answers: PromptRefinerAnswer[];
      intentSummary: string;
      refinedPrompt: string;
      refinementNote: string;
      originalPrompt: string;
    }
  | { status: "error"; answers: PromptRefinerAnswer[]; message: string };

export interface DrivePreflightResponse {
  canSave: boolean;
  connected: boolean;
  reconnectRequired: boolean;
  quotaFull: boolean;
  usage: {
    used: number;
    limit: number | null;
  };
  warning: string | null;
}

export interface WorkspaceStatusResponse {
  authenticated: boolean;
  hasGeminiKey: boolean;
  deploymentProfile?: "cloud" | "local-first";
  workspace?: {
    ready: boolean;
    missing: Array<
      "auth" | "gemini-key" | "google-drive" | "google-drive-reconnect" | "storage" | "quota"
    >;
  };
  storage?: {
    providerId: "google-drive" | "kavero-managed";
    ready: boolean;
    required: boolean;
    warning: string | null;
  };
  drive: {
    connected: boolean;
    reconnectRequired: boolean;
    quotaFull: boolean;
    usage: {
      used: number;
      limit: number | null;
    };
  };
}

export type GateDialog = {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  href?: string;
  variant?: "default" | "warning";
  icon?: "signin" | "model" | "drive" | "warning";
  allowCancel?: boolean;
};

export type GeneratedPanelMode = "generated-focus" | "source-focus" | "split";
