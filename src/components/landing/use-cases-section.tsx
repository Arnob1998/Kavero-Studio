import {
  BriefcaseBusiness,
  Crosshair,
  MessageSquare,
  Rocket,
} from "lucide-react";
import Image, { type StaticImageData } from "next/image";
import type { ComponentType } from "react";

import adsIllustration from "../../../public/home/imported/use-case-ads.png";
import clientIllustration from "../../../public/home/imported/use-case-client.png";
import launchIllustration from "../../../public/home/imported/use-case-launch.png";
import socialIllustration from "../../../public/home/imported/use-case-social.png";

import { Container } from "@/components/landing/container";

type UseCaseCardProps = {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  image: StaticImageData;
  imageAlt: string;
};

function UseCaseCard({
  icon: Icon,
  title,
  description,
  image,
  imageAlt,
}: UseCaseCardProps) {
  return (
    <article className="landing-card grid min-h-[19rem] min-w-0 gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,0.34fr)_minmax(0,0.66fr)] lg:items-center">
      <div className="min-w-0">
        <span className="flex size-14 items-center justify-center rounded-xl border border-[var(--home-accent)]/25 bg-[var(--home-accent)]/10 text-[var(--kavero-text-primary)] shadow-none">
          <Icon className="size-7" />
        </span>
        <h3 className="landing-card-title mt-5">{title}</h3>
        <p className="mt-3 text-base leading-6 text-[var(--kavero-text-secondary)] sm:text-lg sm:leading-7">
          {description}
        </p>
      </div>

      <div className="flex min-h-0 items-center justify-center overflow-hidden rounded-xl">
        <Image
          src={image}
          alt={imageAlt}
          className="max-h-[16rem] w-full object-contain"
          sizes="(max-width: 767px) 90vw, (max-width: 1279px) 85vw, 29vw"
        />
      </div>
    </article>
  );
}

export function UseCasesSection() {
  return (
    <section id="use-cases" className="landing-section">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[45rem] w-[76rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--home-accent)]/[0.045] blur-[170px]"
      />

      <Container className="min-w-0 max-w-[90rem]">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="landing-heading mt-4 text-balance">
            Built for everyday visual work
          </h2>
          <p className="landing-lede mx-auto mt-4 max-w-3xl text-pretty">
            From launch graphics to client work, Kavero helps creators and
            teams make visual content faster, with more control.
          </p>
        </div>

        <div className="landing-content-gap grid min-w-0 gap-5 xl:grid-cols-2">
          <UseCaseCard
            icon={Rocket}
            title="Launch graphics"
            description="Create product launches, announcements, and founder updates."
            image={launchIllustration}
            imageAlt="A Kavero product launch graphic with four coordinated campaign variations"
          />
          <UseCaseCard
            icon={MessageSquare}
            title="Social posts"
            description="Design carousels, posts, and content for every channel."
            image={socialIllustration}
            imageAlt="A Kavero social carousel and editable post templates"
          />
          <UseCaseCard
            icon={Crosshair}
            title="Ads & thumbnails"
            description="Generate fast variations for campaigns and tests."
            image={adsIllustration}
            imageAlt="An earbud advertising campaign with generated visual variations"
          />
          <UseCaseCard
            icon={BriefcaseBusiness}
            title="Client work"
            description="Organize and create assets across multiple brands."
            image={clientIllustration}
            imageAlt="A client asset workspace organized by brand and campaign"
          />
        </div>
      </Container>
    </section>
  );
}
