import { iconNames } from "lucide-react/dynamic";
import type { IconName } from "lucide-react/dynamic";
import type {
  PresetReferenceImage,
  PromptPreset,
  PromptTemplateRecord,
  PromptThumbnailIcon,
  ReferenceImage,
} from "../types";

export const DEFAULT_PROMPT_ICON: PromptThumbnailIcon = {
  name: "file-text",
  color: "#3b82f6",
  version: 1,
};

export const PROMPT_ICON_COLORS = [
  "#3b82f6",
  "#8b5cf6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#ec4899",
  "#f8fafc",
];

export const promptIconNames = iconNames as string[];

export const maxReferenceImageBytes = 7 * 1024 * 1024;

export function isPromptIconName(value: string): value is IconName {
  return promptIconNames.includes(value);
}

export function normalizePromptIcon(icon: Partial<PromptThumbnailIcon> | null | undefined): PromptThumbnailIcon {
  if (icon?.name && isPromptIconName(icon.name)) {
    return {
      name: icon.name,
      color: /^#[0-9a-f]{6}$/i.test(icon.color ?? "") ? icon.color! : DEFAULT_PROMPT_ICON.color,
      version: 1,
    };
  }
  return DEFAULT_PROMPT_ICON;
}

export function promptIconLabel(name: string) {
  return name.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function promptTemplateToPreset(template: PromptTemplateRecord): PromptPreset {
  return {
    id: template.id,
    name: template.name,
    thumbnailIcon: normalizePromptIcon(template.thumbnail_icon),
    prompt: template.prompt,
    referenceImages: template.reference_images ?? [],
    persisted: true,
  };
}

export function stableScramble<T>(items: readonly T[]) {
  return items
    .map((item, index) => ({
      item,
      rank: (index * 73 + 41) % items.length,
    }))
    .sort((a, b) => a.rank - b.rank)
    .map(({ item }) => item);
}

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function readFileAsDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

export function isSupportedImageMimeType(type: string): type is ReferenceImage["mimeType"] {
  return (
    type === "image/png" ||
    type === "image/jpeg" ||
    type === "image/webp" ||
    type === "image/heic" ||
    type === "image/heif"
  );
}

export function getPresetReferenceSource(image: PresetReferenceImage) {
  return image.dataUrl ?? image.src ?? "";
}
