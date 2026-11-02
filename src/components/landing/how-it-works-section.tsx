import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Download,
  FileImage,
  FileText,
  ImageIcon,
  MousePointer2,
  Plug,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

import aiCanvas from "../../../public/home/imported/how-it-works-ai-clean.png";
import blankCanvas from "../../../public/home/imported/how-it-works-canvas-clean.png";

import { GoogleDriveIcon } from "@/components/landing/google-drive-icon";
import { Container } from "@/components/landing/container";

type StepCardProps = {
  number: string;
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
  connector?: boolean;
};

function StepCard({
  number,
  icon,
  title,
  description,
  children,
  connector = false,
}: StepCardProps) {
  return (
    <div className="relative min-w-0">
      <article className="how-step-card landing-card flex h-full flex-col items-center px-4 pb-4 pt-5 text-center sm:px-5 sm:pb-5 2xl:px-6">
        <span className="inline-flex h-8 items-center rounded-full border border-[var(--home-accent)]/70 bg-[var(--home-accent)]/[0.055] px-4 text-xs font-semibold tracking-[0.04em] text-[var(--kavero-text-primary)]">
          STEP {number}
        </span>

        <span className="mt-5 flex size-11 items-center justify-center text-[var(--kavero-text-primary)]">
          {icon}
        </span>

        <h3 className="mt-3 text-xl font-semibold tracking-[-0.035em] text-[var(--kavero-text-primary)]">
          {title}
        </h3>
        <p className="mt-2 min-h-12 max-w-[18rem] text-sm leading-6 text-[var(--kavero-text-secondary)] sm:text-base">
          {description}
        </p>

        <div className="mt-4 flex min-h-0 w-full flex-1 items-center justify-center">
          {children}
        </div>
      </article>

      {connector ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-full top-1/2 z-20 hidden h-8 w-8 -translate-y-1/2 items-center justify-center xl:flex"
        >
          <ChevronRight className="size-7 text-[var(--kavero-text-primary)] drop-shadow-none" />
        </div>
      ) : null}
    </div>
  );
}

function SettingsPreview() {
  return (
    <div className="w-[117.65%] origin-center scale-[0.85] rounded-xl border border-white/15 bg-[var(--kavero-surface)] text-left shadow-2xl">
      <div className="flex h-11 items-center border-b border-white/10 px-3 text-sm font-medium text-[var(--kavero-text-primary)]">
        Settings
        <X className="ml-auto size-4 text-[var(--kavero-text-secondary)]" />
      </div>
      <div className="p-3 text-[0.68rem] sm:p-4">
        <p className="font-medium text-[var(--kavero-text-primary)]">AI Provider</p>
        <p className="mt-3 text-[var(--kavero-text-secondary)]">API Key</p>
        <div className="mt-1.5 flex h-10 items-center rounded-lg border border-white/10 bg-white/[0.02] px-3 tracking-[0.15em] text-[var(--kavero-text-secondary)]">
          ••••••••••••••••••
          <span className="ml-auto tracking-normal text-[var(--kavero-text-primary)]">◉</span>
        </div>
        <p className="mt-2 text-[var(--kavero-text-primary)]">Model Hub</p>
        <div className="my-3 h-px bg-white/10" />
        <p className="font-medium text-[var(--kavero-text-primary)]">Storage</p>
        <div className="mt-2 flex items-center rounded-lg border border-white/12 bg-white/[0.025] p-2.5">
          <GoogleDriveIcon className="size-6" />
          <span className="ml-2 min-w-0">
            <span className="block text-xs font-medium text-[var(--kavero-text-primary)]">Google Drive</span>
            <span className="block truncate text-[0.6rem] text-[var(--kavero-text-secondary)]">Connected as you@company.com</span>
          </span>
          <CheckCircle2 className="ml-auto size-4 shrink-0 text-green-400" />
        </div>
        <span className="flex items-center justify-center mt-2 h-8 w-full rounded-lg border border-white/12 text-[0.65rem] text-[var(--kavero-text-primary)]">
          Choose a different folder
        </span>
      </div>
    </div>
  );
}

const exportTypes = [
  { label: "PNG", detail: "Best for images", icon: FileImage },
  { label: "JPG", detail: "Best for sharing", icon: ImageIcon },
  { label: "PDF", detail: "Best for documents", icon: FileText },
  { label: "SVG", detail: "Best for scaling", icon: Square },
] as const;

function ExportPreview() {
  return (
    <div className="w-[117.65%] origin-center scale-[0.85] space-y-3 text-left">
      <div className="rounded-xl border border-white/15 bg-[var(--kavero-surface)] shadow-2xl">
        <div className="flex h-11 items-center border-b border-white/10 px-3 text-sm font-medium text-[var(--kavero-text-primary)]">
          Export
          <X className="ml-auto size-4 text-[var(--kavero-text-secondary)]" />
        </div>
        <ul className="divide-y divide-white/[0.06] px-3 py-1">
          {exportTypes.map(({ label, detail, icon: Icon }) => (
            <li key={label} className="flex h-12 items-center gap-3">
              <span className="flex size-8 items-center justify-center rounded-md bg-white/[0.05]">
                <Icon className="size-4 text-[var(--kavero-text-primary)]" />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-medium text-[var(--kavero-text-primary)]">{label}</span>
                <span className="block text-[0.62rem] text-[var(--kavero-text-secondary)]">{detail}</span>
              </span>
              <ChevronRight className="ml-auto size-4 text-[var(--kavero-text-secondary)]" />
            </li>
          ))}
        </ul>
      </div>

      <div className="flex items-center rounded-xl border border-white/15 bg-[var(--kavero-surface)] p-3">
        <GoogleDriveIcon className="size-8" />
        <span className="ml-3 min-w-0">
          <span className="block text-xs font-medium text-[var(--kavero-text-primary)]">Saved to Google Drive</span>
          <span className="block truncate text-[0.62rem] text-[var(--kavero-text-secondary)]">Hero section – Kavero</span>
        </span>
        <CheckCircle2 className="ml-auto size-4 shrink-0 text-green-400" />
      </div>
    </div>
  );
}

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="landing-section">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[46rem] w-[72rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--home-accent)]/[0.055] blur-[170px]"
      />

      <Container className="min-w-0">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="landing-heading text-balance">How Kavero works</h2>
          <p className="landing-lede mx-auto mt-3 max-w-2xl text-pretty">
            From idea to finished design in a few simple steps.
          </p>
        </div>

        <div className="landing-content-gap grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-4 xl:gap-8">
          <StepCard
            number="01"
            icon={<MousePointer2 className="size-9" />}
            title="Open the canvas"
            description="Start from a blank design or template."
            connector
          >
            <Image
              src={blankCanvas}
              alt="A blank Kavero canvas ready for a new design"
              className="max-h-[21.5rem] w-auto max-w-full object-contain"
              sizes="(max-width: 767px) 90vw, (max-width: 1279px) 45vw, 23vw"
            />
          </StepCard>

          <StepCard
            number="02"
            icon={<Plug className="size-9" />}
            title="Connect your stack"
            description="Add your AI key and choose where your files are stored."
            connector
          >
            <SettingsPreview />
          </StepCard>

          <StepCard
            number="03"
            icon={<Sparkles className="size-9" />}
            title="Co-create with AI"
            description="Generate assets, segment images, fix layouts, and create variations."
            connector
          >
            <div className="w-full space-y-2">
              <div className="flex items-center gap-2 rounded-lg border border-white/12 bg-white/[0.025] p-2 text-left text-[0.68rem] text-[var(--kavero-text-primary)]">
                <span className="min-w-0 flex-1">Create a hero section for a productivity SaaS landing page</span>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--home-accent)]">
                  <ArrowRight className="size-4" />
                </span>
              </div>
              <Image
                src={aiCanvas}
                alt="A Kavero canvas co-created with AI"
                className="max-h-[18rem] w-full object-contain"
                sizes="(max-width: 767px) 90vw, (max-width: 1279px) 45vw, 23vw"
              />
            </div>
          </StepCard>

          <StepCard
            number="04"
            icon={<Download className="size-9" />}
            title="Export or keep editing"
            description="Download your design or keep working from your Drive."
          >
            <ExportPreview />
          </StepCard>
        </div>

      </Container>
    </section>
  );
}
