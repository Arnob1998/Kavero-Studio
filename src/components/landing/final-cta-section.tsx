import {
  ArrowRight,
  Check,
  KeyRound,
  Workflow,
} from "lucide-react";
import type { ComponentType } from "react";

import { GoogleDriveIcon } from "@/components/landing/google-drive-icon";
import { GitHubIcon } from "@/components/landing/github-icon";
import { Container } from "@/components/landing/container";
import { ButtonLink } from "@/components/landing/button";

type OwnershipItemProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
};

function OwnershipItem({
  icon: Icon,
  title,
  description,
}: OwnershipItemProps) {
  return (
    <div className="relative flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3.5 backdrop-blur-sm">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--home-accent)]/25 bg-[var(--home-accent)]/10 text-[var(--kavero-text-primary)]">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--kavero-text-primary)]">{title}</span>
        <span className="mt-0.5 block text-xs text-[var(--kavero-text-secondary)]">{description}</span>
      </span>
      <Check className="ml-auto size-4 shrink-0 text-[var(--kavero-text-primary)]" />
    </div>
  );
}

function KaveroMark() {
  return (
    <span aria-hidden="true" className="grid size-9 grid-cols-2 gap-1">
      <span className="rounded-[0.28rem] bg-white" />
      <span className="rounded-[0.28rem] bg-white" />
      <span className="rounded-[0.28rem] bg-white" />
      <span className="rounded-[0.28rem] bg-white" />
    </span>
  );
}

export function FinalCtaSection() {
  return (
    <section id="get-started" className="landing-section">
      <Container className="max-w-[90rem]">
        <div className="relative overflow-hidden rounded-[2rem] border border-white/12 bg-[var(--kavero-surface)] shadow-none">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-28 bottom-[-12rem] size-[38rem] rounded-full bg-[var(--home-accent)]/20 blur-[130px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-[-8rem] top-[-12rem] size-[32rem] rounded-full bg-[#235ed8]/15 blur-[120px]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(94,145,255,.18)_1px,transparent_1px),linear-gradient(90deg,rgba(94,145,255,.18)_1px,transparent_1px)] [background-size:4rem_4rem] [mask-image:linear-gradient(to_bottom,transparent,black_38%,black_70%,transparent)]"
          />

          <div className="relative grid min-w-0 gap-10 px-6 py-10 sm:px-10 sm:py-14 lg:grid-cols-[minmax(0,1.08fr)_minmax(22rem,.72fr)] lg:items-center lg:px-14 lg:py-16 xl:px-20 xl:py-20">
            <div className="min-w-0">
              <p className="text-sm font-semibold uppercase tracking-[0.1em] text-[var(--kavero-text-primary)]">
                Create on your terms
              </p>
              <h2 className="mt-5 max-w-[48rem] text-balance text-[clamp(2.75rem,5vw,4.75rem)] font-semibold leading-[0.96] tracking-[-0.06em] text-[var(--kavero-text-primary)]">
                Your canvas. Your AI. Your files.
                <span className="mt-2 block text-[var(--kavero-text-primary)]">
                  No lock-in.
                </span>
              </h2>
              <p className="mt-6 max-w-[42rem] text-pretty text-base leading-7 text-[var(--kavero-text-secondary)] sm:text-lg sm:leading-8">
                Start with Kavero’s free open source foundation. Bring the models and storage
                you already trust, then create without handing over your workflow.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink
                  href="/canvas"
                  size="lg"
                  className="h-13 rounded-xl px-7 shadow-none"
                >
                  Start designing free
                  <ArrowRight className="size-5" />
                </ButtonLink>
                <ButtonLink
                  href="https://github.com/Arnob1998/Kavero-Studio"
                  size="lg"
                  variant="secondary"
                  className="h-13 rounded-xl border-white/15 bg-white/[0.025] px-7 hover:bg-white/[0.06]"
                >
                  View on GitHub
                  <GitHubIcon className="size-5" />
                </ButtonLink>
              </div>

              <p className="mt-5 text-sm text-[var(--home-subtle)]">
                No credit card. No forced cloud. Your work stays yours.
              </p>
            </div>

            <div className="relative mx-auto w-full max-w-[28rem]">
              <div
                aria-hidden="true"
                className="absolute inset-[15%] rounded-full bg-[var(--home-accent)]/20 blur-[75px]"
              />
              <div className="relative rounded-[1.6rem] border border-white/12 bg-[var(--kavero-surface)]/90 p-4 shadow-none backdrop-blur-xl sm:p-5">
                <div className="flex items-center justify-between border-b border-white/10 pb-4">
                  <div>
                    <p className="text-sm font-medium text-[var(--kavero-text-primary)]">Your creative stack</p>
                    <p className="mt-1 text-xs text-[var(--kavero-text-secondary)]">Connected on your terms</p>
                  </div>
                  <span className="flex h-7 items-center rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 text-[0.65rem] font-medium uppercase tracking-wide text-[var(--kavero-text-primary)]">
                    You control it
                  </span>
                </div>

                <div className="relative mt-4 space-y-2.5">
                  <div aria-hidden="true" className="absolute bottom-4 left-5 top-4 w-px bg-gradient-to-b from-[var(--home-accent)]/0 via-[var(--home-accent)]/55 to-[var(--home-accent)]/0" />
                  <OwnershipItem
                    icon={KeyRound}
                    title="Your AI"
                    description="Use the models and keys you choose"
                  />
                  <div className="relative flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3.5 backdrop-blur-sm">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-[var(--home-accent)]/25 bg-[var(--home-accent)]/10">
                      <GoogleDriveIcon className="size-6" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-[var(--kavero-text-primary)]">Your Drive</span>
                      <span className="mt-0.5 block text-xs text-[var(--kavero-text-secondary)]">Keep assets in storage you own</span>
                    </span>
                    <Check className="ml-auto size-4 shrink-0 text-[var(--kavero-text-primary)]" />
                  </div>
                  <OwnershipItem
                    icon={Workflow}
                    title="Your workflow"
                    description="Extend, automate, and make it yours"
                  />
                </div>

                <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--home-accent)]/30 bg-[var(--home-accent)]/[0.08] p-4">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--home-accent)] shadow-none">
                    <KaveroMark />
                  </span>
                  <span>
                    <span className="block font-medium text-[var(--kavero-text-primary)]">Kavero canvas</span>
                    <span className="mt-0.5 block text-xs text-[var(--kavero-text-secondary)]">Everything connects. Nothing is trapped.</span>
                  </span>
                </div>
              </div>
            </div>
          </div>

          <footer className="relative flex flex-col gap-4 border-t border-white/10 px-6 py-5 text-sm text-[var(--home-subtle)] sm:flex-row sm:items-center sm:px-10 lg:px-14 xl:px-20">
            <span className="flex items-center gap-2.5 font-medium text-[var(--kavero-text-secondary)]">
              <span className="grid size-5 grid-cols-2 gap-0.5">
                <span className="rounded-[0.15rem] bg-white" />
                <span className="rounded-[0.15rem] bg-white" />
                <span className="rounded-[0.15rem] bg-white" />
                <span className="rounded-[0.15rem] bg-white" />
              </span>
              Kavero
            </span>
            <span className="sm:ml-auto">Open source AI design, without the lock-in.</span>
            <a href="https://github.com/Arnob1998/Kavero-Studio" className="inline-flex items-center gap-2 text-[var(--kavero-text-secondary)] transition-colors hover:text-[var(--kavero-text-primary)]">
              <GitHubIcon className="size-4" />
              GitHub
            </a>
          </footer>
        </div>
      </Container>
    </section>
  );
}
