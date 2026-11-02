import Image from "next/image";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function GitHubIcon({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn("relative inline-block size-4 shrink-0", className)}
      {...props}
    >
      <Image
        src="/icons/brands/github.svg"
        alt=""
        width={1024}
        height={1024}
        className="size-full object-contain invert"
      />
    </span>
  );
}
