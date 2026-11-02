import {
  ChevronDown,
  Code2,
  EllipsisVertical,
  Eye,
  Folder,
  Grid2X2,
  ImageIcon,
  KeyRound,
  MousePointer2,
  Scan,
  Sparkles,
  Square,
  Type,
} from "lucide-react";
import Image from "next/image";
import type { ComponentType, ReactNode } from "react";

import chairSelection from "../../../public/home/imported/chair-selection-illustration.png";

import { GoogleDriveIcon } from "@/components/landing/google-drive-icon";
import { Container } from "@/components/landing/container";

type ControlCardProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  children: ReactNode;
};

function ControlCard({
  icon: Icon,
  title,
  description,
  children,
}: ControlCardProps) {
  return (
    <article className="landing-card flex h-full flex-col p-4 sm:p-5 2xl:p-6">
      <div className="flex h-56 min-w-0 flex-none items-center justify-center 2xl:h-60">
        {children}
      </div>
      <div className="mt-5 flex items-start gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-[var(--home-accent)] bg-[var(--home-accent)]/5 text-[var(--kavero-text-primary)]">
          <Icon className="size-7" />
        </span>
        <div className="min-w-0">
          <h3 className="landing-card-title">
            {title}
          </h3>
          <p className="landing-card-copy mt-3">
            {description}
          </p>
        </div>
      </div>
    </article>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return <p className="mb-2 text-sm text-[var(--kavero-text-primary)]">{children}</p>;
}

export function ControlSection() {
  return (
    <section id="control" className="landing-section">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-48 top-0 -z-10 size-[38rem] rounded-full bg-[var(--home-accent)]/10 blur-[150px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-64 bottom-0 -z-10 size-[42rem] rounded-full bg-[var(--home-accent)]/10 blur-[160px]"
      />

      <Container className="min-w-0">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="landing-heading text-balance">
            Built for control, not lock-in.
          </h2>
          <p className="landing-lede mx-auto mt-5 max-w-3xl text-pretty">
            Everything you need to design with AI without giving up control
            of your models, files, or workflow.
          </p>
        </div>

        <div className="landing-content-gap grid min-w-0 gap-5 xl:grid-cols-3">
          <ControlCard
            icon={KeyRound}
            title="Bring your own AI"
            description="Use your own AI key when you want more control over model choice and cost."
          >
            <div className="w-full max-w-[20rem] rounded-2xl border border-white/10 bg-[var(--kavero-surface)] p-4 shadow-2xl 2xl:max-w-[22rem]">
              <FieldLabel>AI Provider</FieldLabel>
              <div className="flex h-14 items-center rounded-lg border border-[var(--home-accent)]/80 bg-white/[0.025] px-4">
                <span className="mr-3 flex size-8 items-center justify-center rounded-lg bg-[var(--home-accent)] text-white shadow-none">
                  <KeyRound className="size-4" />
                </span>
                <span className="text-base text-[var(--kavero-text-primary)]">OpenAI</span>
                <ChevronDown className="ml-auto size-4 text-[var(--kavero-text-secondary)]" />
              </div>
              <div className="mt-5">
                <FieldLabel>API Key</FieldLabel>
                <div className="flex h-12 items-center rounded-lg border border-white/12 bg-black/15 px-4">
                  <span className="min-w-0 truncate text-sm tracking-[0.2em] text-[var(--kavero-text-secondary)]">
                    ••••••••••••••••••
                  </span>
                  <Eye className="ml-auto size-5 text-[var(--kavero-text-secondary)]" />
                </div>
              </div>
            </div>
          </ControlCard>

          <ControlCard
            icon={Folder}
            title="Own your files"
            description="Save assets to your own Google Drive, or use managed storage for your installation."
          >
            <div className="w-full max-w-[20rem] rounded-2xl border border-white/10 bg-[var(--kavero-surface)] p-4 shadow-2xl 2xl:max-w-[22rem]">
              <FieldLabel>Save to</FieldLabel>
              <div className="flex h-14 items-center rounded-lg border border-[var(--home-accent)]/80 bg-white/[0.025] px-4">
                <GoogleDriveIcon className="mr-3 size-7" />
                <span className="text-base text-[var(--kavero-text-primary)]">Google Drive</span>
                <ChevronDown className="ml-auto size-4 text-[var(--kavero-text-secondary)]" />
              </div>
              <div className="mt-5">
                <p className="mb-2 text-sm text-[var(--kavero-text-secondary)]">Kavero Drive</p>
                <div className="flex h-16 items-center rounded-lg border border-white/10 bg-black/15 px-4">
                  <Folder className="mr-3 size-7 fill-[var(--home-accent)] text-[var(--home-accent)]" />
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--kavero-text-primary)]">Brand Assets</p>
                    <p className="mt-0.5 text-xs text-[var(--kavero-text-secondary)]">
                      12 items · Updated 2m ago
                    </p>
                  </div>
                  <EllipsisVertical className="ml-auto size-5 text-[var(--kavero-text-secondary)]" />
                </div>
              </div>
            </div>
          </ControlCard>

          <ControlCard
            icon={Sparkles}
            title="AI edits the canvas"
            description="Generate assets, segment images, fix layouts, and create variations inside the design."
          >
            <div className="flex min-w-0 max-w-full items-center justify-center gap-2 sm:gap-3">
              <div className="hidden flex-col gap-3 rounded-xl border border-white/10 bg-[var(--kavero-surface)] p-2 text-[var(--kavero-text-secondary)] sm:flex">
                <MousePointer2 className="size-5 text-[var(--kavero-text-primary)]" />
                <Square className="size-5" />
                <Type className="size-5" />
                <ImageIcon className="size-5" />
                <Grid2X2 className="size-5" />
              </div>
              <Image
                src={chairSelection}
                alt="A black chair selected on the Kavero canvas"
                className="h-auto w-28 min-w-0 rounded-lg 2xl:w-32"
                sizes="128px"
              />
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex size-16 items-center justify-center rounded-lg border border-dashed border-white/20 bg-white/[0.02] 2xl:size-20">
                  <ImageIcon className="size-7 text-[var(--home-subtle)]" />
                </div>
                <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 text-xs text-[var(--kavero-text-primary)] 2xl:h-11 2xl:px-3 2xl:text-sm">
                  <Sparkles className="size-4 text-[var(--kavero-text-primary)]" />
                  Generate
                </span>
                <span className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/[0.04] px-2.5 text-xs text-[var(--kavero-text-primary)] 2xl:h-11 2xl:px-3 2xl:text-sm">
                  <Scan className="size-4" />
                  Segment
                </span>
              </div>
            </div>
          </ControlCard>
        </div>

        <ul className="mt-5 grid overflow-hidden rounded-[var(--radius-card)] border border-white/12 bg-white/[0.025] sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Generate", icon: Sparkles },
            { label: "Segment", icon: Scan },
            { label: "Save to Drive", icon: GoogleDriveIcon },
            { label: "Free open source", icon: Code2 },
          ].map(({ label, icon: Icon }, index) => (
            <li
              key={label}
              className="relative flex min-h-20 min-w-0 items-center justify-center gap-3 border-white/10 px-4 text-base text-[var(--kavero-text-primary)] max-sm:not-last:border-b sm:[&:nth-child(-n+2)]:border-b lg:border-b-0 lg:not-first:border-l lg:px-6"
            >
              {index > 0 && (
                <span
                  aria-hidden="true"
                  className="absolute left-0 hidden h-12 w-px bg-white/10 lg:block"
                />
              )}
              <Icon className="size-8 text-[var(--kavero-text-primary)]" />
              <span className="min-w-0">{label}</span>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
