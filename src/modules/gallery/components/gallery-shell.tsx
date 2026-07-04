import type { ReactNode } from "react";
import { SiteNav } from "@/components/site-nav";

export function GalleryShell({ children }: { children: ReactNode }) {
  return (
    <main className="h-svh overflow-y-auto overscroll-contain bg-[#050506] text-white">
      <SiteNav activeLabel="Gallery" />
      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_20%_12%,rgb(255_255_255_/_0.08),transparent_28%),radial-gradient(circle_at_86%_8%,rgb(105_101_253_/_0.1),transparent_24%),linear-gradient(180deg,rgb(255_255_255_/_0.035),transparent_32%)]"
        aria-hidden="true"
      />
      <section className="relative z-10 mx-auto w-full max-w-[1480px] px-4 pb-12 pt-24 sm:px-6 lg:px-8">
        {children}
      </section>
    </main>
  );
}
