import Image from "next/image";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function GoogleDriveIcon({
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-block size-4 shrink-0", className)}
      {...props}
    >
      <Image
        src="/icons/brands/google-drive.svg"
        alt=""
        width={87}
        height={78}
        className="size-full object-contain"
      />
    </span>
  );
}
