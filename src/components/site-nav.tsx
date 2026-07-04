"use client";

import { SiteNavClient } from "@/components/site-nav-client";

interface SiteNavProps {
  activeLabel: string;
  ariaLabel?: string;
  excludedLabels?: string[];
}

export function SiteNav({
  activeLabel,
  ariaLabel = "Main navigation",
  excludedLabels = [],
}: SiteNavProps) {
  return (
    <SiteNavClient
      activeLabel={activeLabel}
      ariaLabel={ariaLabel}
      excludedLabels={excludedLabels}
    />
  );
}
