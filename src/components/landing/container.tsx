import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Container({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[var(--content-width)] px-[var(--page-gutter)]",
        className,
      )}
      {...props}
    />
  );
}
