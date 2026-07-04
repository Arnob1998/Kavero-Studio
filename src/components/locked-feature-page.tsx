import Link from "next/link";
import type { ComponentType } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { SiteNav } from "@/components/site-nav";

interface LockedFeaturePageProps {
  title: string;
  description: string;
  activeLabel: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

export function LockedFeaturePage({
  title,
  description,
  activeLabel,
  icon: Icon,
}: LockedFeaturePageProps) {
  return (
    <main className="relative min-h-svh overflow-hidden bg-black px-5 py-24 font-sans text-white [isolation:isolate]">
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_45%,rgb(255_255_255_/_0.075),transparent_30%),linear-gradient(90deg,rgb(0_0_0_/_0.94),transparent_36%,transparent_62%,rgb(0_0_0_/_0.92)),linear-gradient(180deg,rgb(0_0_0),rgb(9_9_9)_46%,rgb(0_0_0))]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-35 [background-image:linear-gradient(rgb(255_255_255_/_0.055)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255_/_0.055)_1px,transparent_1px)] [background-size:96px_96px]"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute left-1/2 top-0 z-0 h-px w-[min(980px,80vw)] -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgb(255_255_255_/_0.22),transparent)]"
        aria-hidden="true"
      />

      <SiteNav activeLabel={activeLabel} />

      <section className="relative z-10 mx-auto grid min-h-[calc(100svh-12rem)] w-full max-w-[1180px] items-center">
        <div className="grid gap-10 md:grid-cols-[minmax(0,0.82fr)_minmax(280px,0.48fr)] md:items-center">
          <div>
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.045] px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-white/58 backdrop-blur-xl">
              <Icon size={15} className="text-accent" />
              {activeLabel}
            </div>
            <h1 className="max-w-[11ch] text-[clamp(58px,9vw,132px)] font-light leading-none tracking-normal text-white">
              {title}
            </h1>
            <p className="mt-6 max-w-[54ch] text-[15px] font-semibold leading-7 text-white/56">
              {description}
            </p>
            <Link
              className="mt-8 inline-flex h-11 items-center gap-2 rounded-xl border border-white/[0.1] bg-white/[0.055] px-4 text-[12px] font-extrabold text-white/74 transition hover:bg-white/[0.09] hover:text-white"
              href="/generate"
            >
              Generate
              <ArrowRight size={15} />
            </Link>
          </div>

          <div className="relative hidden min-h-[420px] md:block" aria-hidden="true">
            <div className="absolute right-0 top-4 h-[360px] w-[300px] border border-white/[0.08] bg-white/[0.035] shadow-[0_28px_90px_rgb(0_0_0_/_0.46),inset_0_1px_0_rgb(255_255_255_/_0.06)] backdrop-blur-xl" />
            <div className="absolute right-16 top-24 h-[250px] w-[330px] border border-white/[0.08] bg-black/40 shadow-[0_24px_80px_rgb(0_0_0_/_0.52),inset_0_1px_0_rgb(255_255_255_/_0.05)] backdrop-blur-xl" />
            <div className="absolute right-8 top-56 h-32 w-56 border border-white/[0.08] bg-white/[0.05] shadow-[0_20px_70px_rgb(0_0_0_/_0.48)] backdrop-blur-xl" />
            <div className="absolute right-24 top-40 grid h-16 w-16 place-items-center rounded-2xl border border-white/[0.1] bg-black/58 text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)] backdrop-blur-xl">
              <LockKeyhole size={24} className="text-white/72" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
