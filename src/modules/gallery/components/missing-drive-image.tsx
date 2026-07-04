import { Image as ImageIcon } from "lucide-react";

export function MissingDriveImage({
  title = "Missing in Drive",
  description = "Remove it from Gallery to clear this record.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="grid h-full w-full place-items-center bg-black/30 p-6 text-center">
      <span>
        <span className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl border border-white/[0.08] bg-white/[0.045] text-white/42">
          <ImageIcon size={20} />
        </span>
        <span className="block text-[13px] font-semibold text-white/62">{title}</span>
        <span className="mt-1 block text-[11px] font-medium text-white/38">
          {description}
        </span>
      </span>
    </div>
  );
}
