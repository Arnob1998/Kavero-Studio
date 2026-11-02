import { ArrowRight, Code2, Share2 } from "lucide-react";
import Image from "next/image";

import heroMock from "../../public/home/imported/hero-mock-illustration.png";

import { GoogleDriveIcon } from "@/components/landing/google-drive-icon";
import { GitHubIcon } from "@/components/landing/github-icon";
import { ControlSection } from "@/components/landing/control-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { HowItWorksSection } from "@/components/landing/how-it-works-section";
import { PowerSection } from "@/components/landing/power-section";
import { SolutionSection } from "@/components/landing/solution-section";
import {SiteNav} from "@/components/site-nav";
import styles from "./home.module.css";
import { UseCasesSection } from "@/components/landing/use-cases-section";
import { Container } from "@/components/landing/container";
import { ButtonLink } from "@/components/landing/button";

const featureBadges = [
  { label: "Bring your own AI", icon: Share2 },
  { label: "Save to Google Drive", icon: GoogleDriveIcon },
  { label: "Free open source", icon: Code2 },
];

export function HomeContent() {
  return (
    <main className={styles.page}>
      <a className={styles.skipLink} href="#home">Skip to content</a>
      <SiteNav activeLabel="Home" variant="landing"/>

      <section id="home" className="landing-hero-section">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-12 -z-10 h-[38rem] w-[54rem] -translate-x-1/2 rounded-full bg-[var(--home-accent)]/10 blur-[140px]"
        />

        <Container className="grid min-w-0 items-center gap-8 xl:grid-cols-[minmax(0,0.4fr)_minmax(0,0.6fr)] xl:gap-8">
          <div className="relative z-10 min-w-0 max-w-[34rem]">
            <p className="mb-5 text-sm font-medium text-[var(--kavero-text-primary)] sm:text-base">
              Open-source Canva alternative for AI design
            </p>
            <h1 className="text-balance text-[clamp(3rem,5.5vw,4.25rem)] font-semibold leading-[0.98] tracking-[-0.055em] text-[var(--kavero-text-primary)]">
              Design with AI. Keep control of your work.
            </h1>
            <p className="mt-7 max-w-[31rem] text-pretty text-base leading-7 text-[var(--kavero-text-secondary)] sm:text-lg sm:leading-8">
              Create on a familiar canvas, bring your own AI key, save files to
              your own Drive, and use AI to generate, segment, fix, and remix
              designs.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <ButtonLink
                href="/dashboard"
                size="lg"
                className="h-13 rounded-full px-6 shadow-none"
              >
                Start designing free
                <ArrowRight className="size-5" />
              </ButtonLink>
              <ButtonLink
                href="https://github.com/Arnob1998/Kavero-Studio"
                size="lg"
                variant="secondary"
                className="h-13 rounded-full border-white/15 bg-transparent px-7 hover:bg-white/6"
              >
                View GitHub
                <GitHubIcon className="size-5" />
              </ButtonLink>
            </div>

            <ul className="mt-8 flex flex-wrap gap-2.5 xl:flex-nowrap" aria-label="Product highlights">
              {featureBadges.map(({ label, icon: Icon }) => (
                <li
                  key={label}
                  className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl border border-white/12 bg-white/[0.035] px-3.5 text-xs text-[var(--kavero-text-secondary)] sm:text-sm"
                >
                  <Icon className="size-4" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mx-auto w-[96%] min-w-0 sm:max-w-[64rem] xl:mx-0 xl:w-[min(64rem,55vw)] xl:max-w-none xl:justify-self-end">
            <div
              aria-hidden="true"
              className="absolute inset-x-[12%] bottom-[2%] h-[28%] rounded-full bg-[var(--home-accent)]/20 blur-[80px]"
            />
            <Image
              src={heroMock}
              alt="Kavero design editor showing AI generation, image segmentation, layout tools, and Google Drive export"
              className="relative h-auto w-full drop-shadow-none"
              sizes="(max-width: 1279px) 100vw, 58vw"
              preload
            />
          </div>
        </Container>
      </section>

      <ControlSection />
      <SolutionSection />
      <HowItWorksSection />
      <PowerSection />
      <UseCasesSection />
      <FinalCtaSection />
    </main>
  );
}
