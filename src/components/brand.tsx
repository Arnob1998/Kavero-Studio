import { cn } from "@/lib/utils";

type BrandMarkProps = {
  className?: string;
  tileClassName?: string;
};

export function BrandMark({ className, tileClassName }: BrandMarkProps) {
  return (
    <span className={cn("grid grid-cols-2", className)} aria-hidden="true">
      <span className={cn("block rounded-[8px_8px_2px_8px] bg-white/90", tileClassName)} />
      <span className={cn("block rounded-[8px_8px_8px_2px] bg-white/90", tileClassName)} />
      <span className={cn("block rounded-[8px_2px_8px_8px] bg-white/90", tileClassName)} />
      <span className={cn("block rounded-[2px_8px_8px_8px] bg-white/90", tileClassName)} />
    </span>
  );
}
