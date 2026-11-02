import {
  ChevronDown,
  Grid2X2,
  Layers3,
  PenLine,
  ScanLine,
  Sparkles,
  Upload,
} from "lucide-react";
import Image, { type StaticImageData } from "next/image";
import type { ComponentType, ReactNode } from "react";

import editingIllustration from "../../../public/home/imported/power-editing-clean.png";
import generationIllustration from "../../../public/home/imported/power-image-generation-clean.png";
import layersIllustration from "../../../public/home/imported/power-layers-clean.png";
import segmentationIllustration from "../../../public/home/imported/power-segmentation-clean.png";
import templatesIllustration from "../../../public/home/imported/power-templates-clean.png";

import { Container } from "@/components/landing/container";

type PowerCardProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  image?: StaticImageData;
  imageAlt?: string;
  children?: ReactNode;
};

function PowerCard({
  icon: Icon,
  title,
  description,
  image,
  imageAlt = "",
  children,
}: PowerCardProps) {
  return (
    <article className="landing-card flex min-h-[17rem] flex-col p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--home-accent)]/25 bg-[var(--home-accent)]/10 text-[var(--kavero-text-primary)]">
          <Icon className="size-6" />
        </span>
        <div className="min-w-0 pt-0.5">
          <h3 className="landing-card-title">{title}</h3>
          <p className="mt-2 text-sm leading-5 text-[var(--kavero-text-secondary)] sm:text-[0.9375rem] sm:leading-6">
            {description}
          </p>
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 items-end justify-center overflow-hidden rounded-xl">
        {image ? (
          <Image
            src={image}
            alt={imageAlt}
            className="max-h-[9rem] w-full object-contain"
            sizes="(max-width: 767px) 90vw, (max-width: 1279px) 45vw, 31vw"
          />
        ) : (
          children
        )}
      </div>
    </article>
  );
}

const exportFormats = ["PNG", "JPG", "SVG", "PDF", "•••"];

function ExportControls() {
  return (
    <div className="mx-auto w-[92%] max-w-[30rem] space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {exportFormats.map((format) => (
          <span
            key={format}
            className="flex h-11 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.04] text-xs font-medium text-[var(--kavero-text-primary)] sm:text-sm"
          >
            {format}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,.7fr)_auto_minmax(0,.7fr)_auto] items-center gap-2 text-xs text-[var(--kavero-text-primary)] sm:text-sm">
        <span className="flex h-11 items-center justify-between rounded-lg border border-white/10 bg-white/[0.025] px-3">
          Custom size
          <ChevronDown className="size-4 text-[var(--kavero-text-secondary)]" />
        </span>
        <span className="flex h-11 items-center rounded-lg border border-white/10 bg-white/[0.025] px-3">1200</span>
        <span className="text-[var(--kavero-text-secondary)]">×</span>
        <span className="flex h-11 items-center rounded-lg border border-white/10 bg-white/[0.025] px-3">628</span>
        <span className="text-[var(--kavero-text-secondary)]">px</span>
      </div>
    </div>
  );
}

export function PowerSection() {
  return (
    <section id="features" className="landing-section">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[44rem] w-[80rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--home-accent)]/[0.05] blur-[170px]"
      />

      <Container className="min-w-0 max-w-[90rem]">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="landing-heading text-balance">More power. More possibilities.</h2>
          <p className="landing-lede mx-auto mt-4 max-w-2xl text-pretty">
            Kavero gives you the tools and flexibility to go from idea to final
            design faster and without limits.
          </p>
        </div>

        <div className="landing-content-gap grid min-w-0 gap-5 md:grid-cols-2 xl:grid-cols-3">
          <PowerCard
            icon={Sparkles}
            title="AI image generation"
            description="Create stunning images from text prompts using your own AI key."
            image={generationIllustration}
            imageAlt="A set of AI-generated car, astronaut, and landscape images"
          />
          <PowerCard
            icon={ScanLine}
            title="Smart segmentation"
            description="Automatically segment objects and separate layers in one click."
            image={segmentationIllustration}
            imageAlt="A shoe before and after background segmentation"
          />
          <PowerCard
            icon={Layers3}
            title="Layer control"
            description="Organize, lock, and manage layers with complete flexibility."
            image={layersIllustration}
            imageAlt="Kavero layer controls for heading, product, glow, and background layers"
          />
          <PowerCard
            icon={PenLine}
            title="Advanced editing"
            description="Remove backgrounds, refine details, and edit with precision tools."
            image={editingIllustration}
            imageAlt="A centered portrait before and after background removal"
          />
          <PowerCard
            icon={Grid2X2}
            title="Templates & assets"
            description="Use templates, gradients, icons, and styles to speed up your workflow."
            image={templatesIllustration}
            imageAlt="A collection of Kavero templates, gradient assets, and icons"
          />
          <PowerCard
            icon={Upload}
            title="Export anywhere"
            description="Export in any format, any size. Share, publish, or print with ease."
          >
            <ExportControls />
          </PowerCard>
        </div>

      </Container>
    </section>
  );
}
