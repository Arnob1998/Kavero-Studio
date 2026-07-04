import { Calendar, ExternalLink, Sparkles } from "lucide-react";
import type { GalleryFolder, GalleryImage } from "../types";
import { getGalleryImageContentUrl } from "../utils/gallery-image-content-url";
import { getGalleryImageDisplayStatus } from "../utils/gallery-image-status";
import { MissingDriveImage } from "./missing-drive-image";
import { GalleryImageActions } from "./gallery-image-actions";

export function GalleryCard({ image, folder }: { image: GalleryImage; folder: GalleryFolder }) {
  const createdAt = new Date(image.created_at);
  const settings = folder.settings ?? {};
  const displayStatus = getGalleryImageDisplayStatus(image);

  return (
    <article className="group overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.045] shadow-[0_22px_70px_rgb(0_0_0_/_0.34),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl">
      <div className="grid aspect-[4/3] place-items-center bg-black/36">
        {displayStatus.canPreview ? (
          <img
            className="max-h-full w-full object-contain transition duration-300 group-hover:scale-[1.015]"
            src={getGalleryImageContentUrl(image.id)}
            alt=""
          />
        ) : (
          <MissingDriveImage
            title={displayStatus.title}
            description={displayStatus.description}
          />
        )}
      </div>
      <div className="grid gap-4 p-4">
        <div>
          <p className="m-0 line-clamp-3 text-[14px] font-semibold leading-5 text-white">
            {folder.prompt}
          </p>
          {folder.generatedText ? (
            <p className="m-0 mt-2 line-clamp-2 text-[12px] font-medium leading-5 text-white/44">
              {folder.generatedText}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-bold text-white/52">
          <span className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-white/[0.045] px-2.5">
            <Sparkles size={12} />
            {folder.modelLabel}
          </span>
          <span className="inline-flex h-7 items-center rounded-lg border border-white/[0.08] bg-white/[0.045] px-2.5">
            v{image.variant}
          </span>
          {settings.aspectRatio ? (
            <span className="inline-flex h-7 items-center rounded-lg border border-white/[0.08] bg-white/[0.045] px-2.5">
              {settings.aspectRatio}
            </span>
          ) : null}
          {settings.imageSize ? (
            <span className="inline-flex h-7 items-center rounded-lg border border-white/[0.08] bg-white/[0.045] px-2.5">
              {settings.imageSize}
            </span>
          ) : null}
        </div>

        <div className="grid gap-2 border-t border-white/[0.08] pt-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="inline-flex min-w-0 items-center gap-2 text-[12px] font-medium text-white/42">
              <Calendar size={13} className="shrink-0" />
              <span className="truncate">{createdAt.toLocaleString()}</span>
            </span>
            {image.drive_web_view_link ? (
              <a
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-white/58 transition hover:bg-white/[0.07] hover:text-white"
                href={image.drive_web_view_link}
                target="_blank"
                rel="noreferrer"
              >
                Drive
                <ExternalLink size={13} />
              </a>
            ) : null}
          </div>
          <GalleryImageActions imageId={image.id} />
        </div>
      </div>
    </article>
  );
}
