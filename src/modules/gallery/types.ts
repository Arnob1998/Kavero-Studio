import type { StoredObjectRef } from "@/modules/storage/storage-provider";

export type GalleryImage = {
  id: string;
  variant: number;
  mime_type: string;
  drive_file_id: string | null;
  drive_file_name: string | null;
  drive_web_view_link: string | null;
  drive_metadata_file_id: string | null;
  drive_status: "available" | "missing" | "unknown";
  storage_provider: string | null;
  storage_kind: string | null;
  storage_status: string | null;
  storage_ref: unknown | null;
  metadata_storage_ref: unknown | null;
  storage_metadata: Record<string, unknown> | null;
  storage_external_id: string | null;
  storage_external_url: string | null;
  resolved_storage_ref: StoredObjectRef | null;
  resolved_metadata_storage_ref: StoredObjectRef | null;
  created_at: string;
};

export type GalleryFolder = {
  id: string;
  prompt: string;
  modelId: string;
  modelLabel: string;
  settings: Record<string, string>;
  generatedText: string | null;
  createdAt: string;
  imageCount: number;
  coverImage: GalleryImage;
  images: GalleryImage[];
};

export type GalleryRun = {
  id: string;
  prompt: string;
  model_id: string;
  model_label: string;
  settings: Record<string, string>;
  generated_text: string | null;
  created_at: string;
  generated_images: GalleryImage[] | null;
};
