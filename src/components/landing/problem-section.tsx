import {
  CircleDollarSign,
  Cloud,
  Layers3,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import Image from "next/image";
import type { ComponentType } from "react";

import comparisonIllustration from "../../../public/home/imported/kavero-vs-others-illustration.png";

import { Container } from "@/components/landing/container";

const problems = [
  {
    title: "Platform-controlled AI",
    description: "You’re stuck with their models and their limits.",
    icon: LockKeyhole,
    color: "var(--kavero-text-primary)",
    background: "rgb(255 255 255 / .04)",
  },
  {
    title: "Files tied to the platform",
    description: "Your assets live on their servers. Not yours.",
    icon: Cloud,
    color: "var(--kavero-text-primary)",
    background: "rgb(255 255 255 / .04)",
  },
  {
    title: "AI that only generates flat images",
    description: "Hard to edit, impossible to re-use properly.",
    icon: Layers3,
    color: "var(--kavero-text-primary)",
    background: "rgb(255 255 255 / .04)",
  },
  {
    title: "Expensive bundled subscriptions",
    description: "Pay for features you don’t use just to get the basics.",
    icon: CircleDollarSign,
    color: "var(--kavero-text-primary)",
    background: "rgb(255 255 255 / .04)",
  },
] as const satisfies ReadonlyArray<{
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  background: string;
}>;

export function ProblemSection() {
  return (
    <section id="problem" className="landing-section">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[34rem] w-[70rem] -translate-x-1/2 rounded-full bg-[var(--home-accent)]/[0.07] blur-[150px]"
      />

      <Container className="min-w-0">
        <div className="grid min-w-0 items-center gap-10 xl:grid-cols-[minmax(0,0.46fr)_minmax(0,0.54fr)]">
          <div className="min-w-0">
            <h2 className="landing-heading">
              Creative tools
              <br />
              became{" "}
              <span className="text-[var(--kavero-text-primary)]">
                closed bundles.
              </span>
            </h2>

            <p className="landing-lede mt-4 max-w-[38rem] text-pretty">
              You just want to make a launch graphic, thumbnail, ad, or client
              design. But most tools now bundle the AI, storage, and workflow
              inside one closed platform.
            </p>

            <div className="mt-6 flex items-start gap-4 rounded-2xl border border-[var(--home-accent)]/60 bg-[var(--home-accent)]/[0.035] p-5 sm:items-center">
              <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-[var(--home-accent)]/20 text-[var(--kavero-text-primary)] shadow-none">
                <Sparkles className="size-7" />
              </span>
              <p className="text-base leading-7 text-[var(--kavero-text-secondary)] sm:text-lg">
                Kavero gives you a better way: create freely,{" "}
                <span className="font-medium text-[var(--kavero-text-primary)]">
                  without giving up control.
                </span>
              </p>
            </div>
          </div>

          <div className="relative min-w-0">
            <div
              aria-hidden="true"
              className="absolute inset-[12%] -z-10 rounded-full bg-[var(--home-accent)]/15 blur-[90px]"
            />
            <div className="relative mx-auto aspect-[1.58/1] w-[92%] max-w-[28rem] overflow-hidden rounded-[var(--radius-card)] xl:ml-auto xl:mr-0">
              <Image
                src={comparisonIllustration}
                alt="Closed creative platforms compared with Kavero’s user-controlled AI, storage, and workflow"
                fill
                className="object-cover"
                sizes="(max-width: 1279px) 100vw, 56vw"
              />
            </div>
          </div>
        </div>

        <div className="landing-content-gap grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {problems.map((problem) => {
            const Icon = problem.icon;

            return (
              <article
                key={problem.title}
                className="landing-card flex min-h-40 gap-4 p-5"
              >
                <span
                  className="flex size-12 shrink-0 items-center justify-center rounded-xl border"
                  style={{
                    color: problem.color,
                    backgroundColor: problem.background,
                    borderColor: `color-mix(in srgb, ${problem.color} 35%, transparent)`,
                  }}
                >
                  <Icon className="size-6" />
                </span>
                <div className="min-w-0">
                  <h3 className="landing-card-title">
                    {problem.title}
                  </h3>
                  <span
                    aria-hidden="true"
                    className="mt-4 block h-1 w-8 rounded-full"
                    style={{ backgroundColor: problem.color }}
                  />
                  <p className="landing-card-copy mt-4">
                    {problem.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </Container>
    </section>
  );
}

