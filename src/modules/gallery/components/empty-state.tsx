import Link from "next/link";
import { Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

export function EmptyState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="grid min-h-[520px] place-items-center rounded-2xl border border-white/[0.1] bg-white/[0.045] p-6 text-center shadow-[0_24px_90px_rgb(0_0_0_/_0.36),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl">
      <div className="grid max-w-[520px] justify-items-center">
        <div className="mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/[0.1] bg-white/[0.07] text-white/64">
          <ImageIcon size={24} />
        </div>
        <h1 className="m-0 text-[clamp(34px,5vw,64px)] font-light leading-none tracking-normal text-white">
          {title}
        </h1>
        <p className="mb-6 mt-4 text-[14px] font-medium leading-6 text-white/52">{description}</p>
        <Button asChild className="h-11 rounded-xl bg-accent px-5 text-white hover:bg-accent-hover">
          {actionHref.startsWith("/api/") ? (
            <a href={actionHref}>{actionLabel}</a>
          ) : (
            <Link href={actionHref}>{actionLabel}</Link>
          )}
        </Button>
      </div>
    </div>
  );
}
