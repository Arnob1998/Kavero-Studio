import type { DragEvent, RefObject } from "react";
import { Image as ImageIcon, RefreshCw, Upload } from "lucide-react";
import type { CanvasAsset } from "@/modules/assets/canvas-assets";
import { getCanvasAssetDisplayStatus } from "@/modules/assets/canvas-asset-status";

export function AssetsPanel({
  assets,
  assetsLoading,
  uploading,
  uploadProgress,
  uploadLabel,
  fileInputRef,
  loadAssets,
  handleDrop,
  handleImageUpload,
  addImage,
}: {
  assets: CanvasAsset[];
  assetsLoading: boolean;
  uploading: boolean;
  uploadProgress: number;
  uploadLabel: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  loadAssets: () => Promise<void>;
  handleDrop: (event: DragEvent<HTMLDivElement>) => void;
  handleImageUpload: (files: FileList | null) => void;
  addImage: (url: string) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="m-0 text-[11px] font-semibold text-white/38">Upload or reuse assets</p>
        <button
          className="grid h-7 w-7 place-items-center rounded-lg text-white/42 transition hover:bg-white/[0.08] hover:text-white"
          onClick={() => void loadAssets()}
          title="Refresh uploads"
        >
          <RefreshCw size={13} className={assetsLoading ? "animate-spin" : ""} />
        </button>
      </div>
      <div
        className="rounded-xl border border-dashed border-white/[0.18] bg-white/[0.035] p-6 text-center transition-all hover:border-accent/55 hover:bg-accent/10"
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={(event) => event.preventDefault()}
      >
        <Upload size={24} className="mx-auto mb-2 text-white/46" />
        <p className="text-xs font-semibold text-white/56">
          {uploading ? uploadLabel || "Uploading" : "Click or drag images here"}
        </p>
        <p className="mt-1 text-[10px] font-semibold text-white/34">PNG, JPG, WebP</p>
        {uploading ? (
          <div className="mt-4 overflow-hidden rounded-full bg-white/[0.08]">
            <div className="h-1.5 rounded-full bg-accent transition-[width]" style={{ width: `${uploadProgress}%` }} />
          </div>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => handleImageUpload((event.target as HTMLInputElement).files)}
      />

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold text-white/38">Assets</span>
          <span className="text-[10px] font-semibold text-white/28">{assets.length}</span>
        </div>
        {assetsLoading && assets.length === 0 ? (
          <div className="grid min-h-[140px] place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] text-[11px] font-semibold text-white/38">
            Loading uploads...
          </div>
        ) : assets.length === 0 ? (
          <div className="grid min-h-[140px] place-items-center rounded-xl border border-white/[0.08] bg-white/[0.035] px-4 text-center">
            <span>
              <ImageIcon size={20} className="mx-auto mb-2 text-white/36" />
              <span className="block text-[11px] font-semibold text-white/42">No uploads yet</span>
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {assets.map((asset) => {
              const displayStatus = getCanvasAssetDisplayStatus(asset);

              return (
                <button
                  key={asset.id}
                  className="group overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.04] text-left transition hover:border-accent/45 hover:bg-accent/10"
                  draggable={displayStatus.canPreview}
                  onClick={() => {
                    if (displayStatus.canPreview) addImage(asset.public_url);
                  }}
                  onDragStart={(event) => {
                    if (!displayStatus.canPreview) return;
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData("application/x-kavero-canvas-asset", asset.public_url);
                    event.dataTransfer.setData("text/plain", asset.public_url);
                    const dragPreview = document.createElement("div");
                    dragPreview.className =
                      "pointer-events-none fixed left-[-9999px] top-[-9999px] grid h-20 w-20 place-items-center overflow-hidden rounded-xl border border-white/20 bg-black shadow-[0_18px_44px_rgb(0_0_0_/_0.38)]";
                    const image = document.createElement("img");
                    image.src = asset.public_url;
                    image.alt = "";
                    image.className = "h-full w-full object-cover";
                    dragPreview.appendChild(image);
                    document.body.appendChild(dragPreview);
                    event.dataTransfer.setDragImage(dragPreview, 40, 40);
                    window.setTimeout(() => dragPreview.remove(), 0);
                  }}
                  title={asset.original_name}
                >
                  <span className="grid aspect-square place-items-center overflow-hidden bg-[linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%),linear-gradient(45deg,rgb(255_255_255_/_0.08)_25%,transparent_25%,transparent_75%,rgb(255_255_255_/_0.08)_75%)] bg-[length:14px_14px] bg-[position:0_0,7px_7px]">
                    {!displayStatus.canPreview ? (
                      <span className="text-[10px] font-semibold text-red-100/58">{displayStatus.title}</span>
                    ) : (
                      <img
                        className="h-full w-full object-cover opacity-90 transition group-hover:scale-[1.03] group-hover:opacity-100"
                        src={asset.public_url}
                        alt=""
                        draggable={false}
                      />
                    )}
                  </span>
                  <span className="block truncate border-t border-white/[0.08] px-2 py-1.5 text-[10px] font-semibold text-white/52">
                    {asset.original_name}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
