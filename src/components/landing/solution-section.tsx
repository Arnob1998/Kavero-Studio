import {
  ChevronDown,
  Code2,
  Crop,
  KeyRound,
  LockKeyhole,
  Puzzle,
  ShieldCheck,
  Sparkles,
  UsersRound,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import canvasIllustration from "../../../public/home/imported/solution-canvas-illustration-clean.png";
import driveIllustration from "../../../public/home/imported/solution-drive-illustration-clean.png";

import { GoogleDriveIcon } from "@/components/landing/google-drive-icon";
import { Container } from "@/components/landing/container";

type SolutionCardProps = {
  number: string;
  icon: ReactNode;
  title: string;
  description: string;
  accent: "violet" | "blue" | "teal";
  footer: string;
  children: ReactNode;
};

const accentStyles = {
  violet: {
    icon: "border-violet-500/30 bg-violet-500/10 text-[var(--kavero-text-primary)]",
    badge: "border-violet-500/25 bg-violet-500/8 text-[var(--kavero-text-primary)]",
  },
  blue: {
    icon: "border-[var(--home-accent)]/35 bg-[var(--home-accent)]/10 text-[var(--kavero-text-primary)]",
    badge: "border-[var(--home-accent)]/30 bg-[var(--home-accent)]/8 text-[var(--kavero-text-primary)]",
  },
  teal: {
    icon: "border-teal-400/30 bg-teal-400/8 text-[var(--kavero-text-primary)]",
    badge: "border-teal-400/25 bg-teal-400/8 text-[var(--kavero-text-primary)]",
  },
} as const;

function SolutionCard({
  number,
  icon,
  title,
  description,
  accent,
  footer,
  children,
}: SolutionCardProps) {
  const styles = accentStyles[accent];

  return (
    <article className="landing-card flex h-full min-h-[20.5rem] flex-col p-4 sm:p-5 2xl:p-6">
      <div className="flex items-start justify-between">
        <span
          className={`flex size-14 items-center justify-center rounded-xl border ${styles.icon}`}
        >
          {icon}
        </span>
        <span
          className={`rounded-lg border px-3 py-1.5 font-mono text-sm ${styles.badge}`}
        >
          {number}
        </span>
      </div>

      <h3 className="landing-card-title mt-4 2xl:mt-5">
        {title}
      </h3>
      <p className="landing-card-copy mt-2.5 min-h-12">
        {description}
      </p>

      <div className="solution-preview mt-4 flex flex-none items-center justify-center 2xl:mt-5">
        {children}
      </div>

      <div className="mt-4 2xl:mt-5">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.025] px-3.5 py-1.5 text-sm text-[var(--kavero-text-primary)]">
          <ShieldCheck className={`size-4 ${styles.icon.split(" ").at(-1)}`} />
          {footer}
        </span>
      </div>
    </article>
  );
}

const foundationFeatures = [
  {
    title: "Open source",
    description: "Transparent, auditable, and community-driven.",
    icon: Code2,
    color: "text-[var(--kavero-text-primary)]",
  },
  {
    title: "Extend it",
    description: "Built for extensibility. Make it your own.",
    icon: Puzzle,
    color: "text-[var(--kavero-text-primary)]",
  },
  {
    title: "Made for creators",
    description: "From solo makers to growing teams.",
    icon: UsersRound,
    color: "text-[var(--kavero-text-primary)]",
  },
  {
    title: "Privacy first",
    description: "You’re in control of your data and your workflow.",
    icon: LockKeyhole,
    color: "text-[var(--kavero-text-primary)]",
  },
] as const;

export function SolutionSection() {
  return (
    <section id="solution" className="landing-section">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[44rem] w-[76rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--home-accent)]/[0.06] blur-[160px]"
      />

      <Container className="min-w-0">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="landing-heading text-balance">
            Everything you need.
            <br />
            Nothing{" "}
            <span className="text-[var(--kavero-text-primary)]">
              you don’t.
            </span>
          </h2>
          <p className="landing-lede mx-auto mt-5 max-w-3xl text-pretty">
            Kavero gives you the core design tools and AI power, with the
            freedom to choose your AI, your storage, and your workflow.
          </p>
        </div>

        <div className="landing-content-gap grid min-w-0 gap-5 xl:grid-cols-3">
          <SolutionCard
            number="01"
            icon={<Sparkles className="size-7" />}
            title="Bring your own AI"
            description="Use your own AI key instead of being locked into one provider. More choice, more control, better costs."
            accent="violet"
            footer="Your key. Your rules."
          >
            <div className="w-[92%] rounded-xl border border-white/10 bg-[var(--kavero-surface)] p-3 shadow-2xl">
              <p className="text-[0.68rem] font-medium text-[var(--kavero-text-primary)]">AI Provider</p>
              <div className="mt-1.5 flex h-8 items-center rounded-lg border border-white/15 bg-white/[0.025] px-3">
                <Sparkles className="mr-2 size-4 text-[var(--kavero-text-primary)]" />
                <span className="text-xs text-[var(--kavero-text-primary)]">Gemini</span>
                <ChevronDown className="ml-auto size-4 text-[var(--kavero-text-secondary)]" />
              </div>
              <p className="mt-2.5 text-[0.68rem] font-medium text-[var(--kavero-text-primary)]">API Key</p>
              <div className="mt-1.5 flex h-8 items-center rounded-lg border border-white/15 bg-black/15 px-3">
                <span className="min-w-0 truncate text-xs tracking-[0.18em] text-[var(--kavero-text-secondary)]">
                  ••••••••••••
                </span>
                <KeyRound className="ml-auto size-4 text-[var(--kavero-text-secondary)]" />
              </div>
              <p className="mt-2 text-[0.62rem] text-[var(--kavero-text-secondary)]">
                Your key connects Kavero to your chosen provider.
              </p>
            </div>
          </SolutionCard>

          <SolutionCard
            number="02"
            icon={<GoogleDriveIcon className="size-8" />}
            title="Own your files"
            description="Save your designs and assets directly to your Google Drive. Your work stays yours, always."
            accent="blue"
            footer="Your files. Your forever."
          >
            <Image
              src={driveIllustration}
              alt="Kavero save-to-Google-Drive interface"
              className="h-full w-full object-contain"
              sizes="(max-width: 1279px) 100vw, 31vw"
            />
          </SolutionCard>

          <SolutionCard
            number="03"
            icon={<Crop className="size-7" />}
            title="AI that edits the canvas"
            description="Kavero’s AI works on the canvas: segmenting objects, fixing layouts, and creating variations."
            accent="teal"
            footer="Not just images. Real edits."
          >
            <Image
              src={canvasIllustration}
              alt="Before-and-after canvas design edited by Kavero AI"
              className="h-full w-full object-contain"
              sizes="(max-width: 1279px) 100vw, 31vw"
            />
          </SolutionCard>
        </div>

        <ul className="solution-foundation-strip mt-7 grid overflow-hidden rounded-[var(--radius-card)] border border-white/12 bg-white/[0.025] sm:grid-cols-2 xl:grid-cols-4">
          {foundationFeatures.map(({ title, description, icon: Icon, color }) => (
            <li
              key={title}
              className="flex min-h-24 min-w-0 items-center gap-4 border-white/10 p-4 max-sm:not-last:border-b sm:[&:nth-child(-n+2)]:border-b xl:border-b-0 xl:not-first:border-l"
            >
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-full border border-current/25 bg-current/5 ${color}`}>
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-medium text-[var(--kavero-text-primary)]">{title}</h3>
                <p className="mt-1 text-sm leading-5 text-[var(--kavero-text-secondary)]">
                  {description}
                </p>
              </div>
            </li>
          ))}
        </ul>

      </Container>
    </section>
  );
}
