import Link from "next/link";
import { Calendar, Folder, Sparkles } from "lucide-react";
import type { GalleryFolder } from "../types";
import { getGalleryImageContentUrl } from "../utils/gallery-image-content-url";
import { getGalleryImageDisplayStatus } from "../utils/gallery-image-status";
import { MissingDriveImage } from "./missing-drive-image";
import { GalleryGenerationActions } from "./gallery-generation-actions";

export function GenerationFolderCard({ folder }: { folder: GalleryFolder }) {
  const createdAt = new Date(folder.createdAt);
  const coverStatus = getGalleryImageDisplayStatus(folder.coverImage);

  return (
    <article className="group overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.045] shadow-[0_22px_70px_rgb(0_0_0_/_0.34),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl transition hover:border-white/[0.18] hover:bg-white/[0.065]">
      <Link
        className="block"
        href={`/gallery?generation=${encodeURIComponent(folder.id)}`}
      >
      <div className="relative grid aspect-[4/3] place-items-center bg-black/36">
        {coverStatus.canPreview ? (
          <img
            className="max-h-full w-full object-contain opacity-86 transition duration-300 group-hover:scale-[1.015] group-hover:opacity-100"
            src={getGalleryImageContentUrl(folder.coverImage.id)}
            alt=""
          />
        ) : (
          <MissingDriveImage
            title={coverStatus.title}
            description={coverStatus.description}
          />
        )}
          <span className="absolute left-3 top-3 inline-flex h-8 items-center gap-2 rounded-lg border border-white/[0.12] bg-black/62 px-2.5 text-[12px] font-bold text-white/78 backdrop-blur-xl">
            <Folder size={14} />
            {folder.imageCount} image{folder.imageCount === 1 ? "" : "s"}
          </span>
        </div>
      </Link>
      <div className="grid gap-4 p-4">
        <Link href={`/gallery?generation=${encodeURIComponent(folder.id)}`}>
          <p className="m-0 line-clamp-3 text-[14px] font-semibold leading-5 text-white">
            {folder.prompt}
          </p>
        </Link>
        <div className="grid gap-2 border-t border-white/[0.08] pt-3">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-2 text-[12px] font-medium text-white/42">
              <Calendar size={13} className="shrink-0" />
              <span className="truncate">{createdAt.toLocaleString()}</span>
            </span>
            <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-white/58">
              <Sparkles size={13} />
              {folder.modelLabel}
            </span>
          </div>
          <GalleryGenerationActions generationId={folder.id} redirectToGallery={false} compact />
        </div>
      </div>
    </article>
  );
}
