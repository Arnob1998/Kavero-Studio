"use client";

import { SiteNavClient } from "@/components/site-nav-client";

interface SiteNavProps {
  activeLabel: string;
  ariaLabel?: string;
  excludedLabels?: string[];
  variant?: "workspace" | "landing";
}

export function SiteNav({
  activeLabel,
  ariaLabel = "Main navigation",
  excludedLabels = [],
  variant = "workspace",
}: SiteNavProps) {
  return (
    <SiteNavClient
      activeLabel={activeLabel}
      ariaLabel={ariaLabel}
      excludedLabels={excludedLabels}
      variant={variant}
    />
  );
}
