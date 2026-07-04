import type { StorageObjectStatus, StorageProviderKind, StoredObjectRef } from "@/modules/storage/storage-provider";

export interface CanvasAsset {
  id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  public_url: string;
  drive_file_id?: string | null;
  drive_file_name?: string | null;
  drive_web_view_link?: string | null;
  drive_status: "available" | "missing" | "unknown";
  storage_ref?: StoredObjectRef | null;
  storage_kind?: StorageProviderKind | null;
  storage_status?: StorageObjectStatus | null;
  storage_metadata?: Record<string, unknown> | null;
  storage_external_id?: string | null;
  storage_external_url?: string | null;
  last_used_at?: string | null;
  created_at: string;
}

export interface CanvasAssetsResponse {
  assets: CanvasAsset[];
  error?: string;
}

interface CanvasAssetUploadResponse {
  asset?: CanvasAsset;
  error?: string;
}

export function uploadCanvasAsset(
  file: File,
  onProgress?: (progress: number) => void,
) {
  return new Promise<CanvasAsset>((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);

    const request = new XMLHttpRequest();
    request.open("POST", "/api/canvas/assets");
    request.responseType = "json";

    request.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(Math.min(95, Math.round((event.loaded / event.total) * 95)));
    };

    request.onload = () => {
      const payload = (request.response ?? {}) as CanvasAssetUploadResponse;
      if (request.status < 200 || request.status >= 300 || !payload.asset) {
        reject(new Error(payload.error ?? "Upload failed."));
        return;
      }

      onProgress?.(100);
      resolve(payload.asset);
    };

    request.onerror = () => reject(new Error("Upload failed."));
    request.send(form);
  });
}
