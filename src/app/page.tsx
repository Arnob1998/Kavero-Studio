import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  FolderLock,
  GraduationCap,
  Grid2X2,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { SiteNav } from "@/components/site-nav";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${brand.name} | AI Creative Suite`,
  description: `Generate, edit, enhance, and compose AI images with ${brand.name}.`,
};

type FeatureCardData = {
  title: string;
  subtitle: string;
  action: string;
  href: string;
  className: string;
  image?: string;
  visual?: "flux";
  badge?: string;
  preview?: string;
};

const featureCards: FeatureCardData[] = [
  {
    title: "Generate",
    subtitle: "High quality generations",
    action: "Generate Images",
    href: "/generate",
    className: "lg:col-span-6",
    visual: "flux",
  },
  {
    title: "Edit",
    subtitle: "Modify & transform images",
    action: "Edit Images",
    href: "/canvas",
    className: "lg:col-span-6",
    image: "/bg-image-assets/hfodzcy0205pa0cy4r07kuwc92-z-image-turbo-raw-photo-captured-with-hasselblad-x1d-ii-50c-low-key-lighting-high-micro-contrast-iso-100-with-a-50mm-prime.png",
  },
  {
    title: "Image",
    subtitle: "AI image generation",
    action: "Generate Images",
    href: "/generate",
    className: "lg:col-span-4",
    image: "/bg-image-assets/trisha-romance_top_right.jpg",
    badge: "Image ready",
  },
  {
    title: "Canvas",
    subtitle: "Compose & refine images",
    action: "Compose Images",
    href: "/canvas",
    className: "lg:col-span-4",
    image: "/bg-image-assets/alexandre-calame_top_right.jpg",
  },
  {
    title: "Enhancer",
    subtitle: "Upscale images",
    action: "Upscale & Enhance",
    href: "/canvas",
    className: "lg:col-span-4",
    image: "/bg-image-assets/ro7o9x699id37n4vfduabgadq1-nano-banana-nano-banana-2-4k-ultra-high-resolution-png-format-with-transparent-background-and-isolated-alpha-channel-scene-concept-the-aesthetic-of-hideo-kojimas.jpeg",
  },
];

const fluxTiles = [
  "/bg-image-assets/c69p5onf0gi4s8fyloccirxx7s-hero-10-prompt-masterpiece-high-quality-anime-illustration-a-beautiful-girl-looking-up-towards-the-sky-with-her-eyes-gently-closed-serene.jpeg",
  "/bg-image-assets/uf67pwpxbxf99j2rqji4hax930-hero-10-the-image-depicts-a-kitchen-scene-with-a-cat-sitting-at-a-table-the-cat-has-wide-eyes-and-an.jpeg",
  "/bg-image-assets/anne-rothenstein_top_left.jpg",
  "/bg-image-assets/brandon-woelfel_top_right.jpg",
  "/bg-image-assets/alastair-magnaldo_bottom_right.jpg",
  "/bg-image-assets/kazuo-oga_top_right.jpg",
  "/bg-image-assets/s678l1kw99jk57t0q9aa9us0sm-flux-kontext-flux-kontext-pro-gundam-rx-78-wearing-cyberpunk-costume.jpeg",
  "/bg-image-assets/jack-vettriano_bottom_right.jpg",
];

const privacyFaqItems = [
  {
    question: "Is my API key safe?",
    answer: [
      "Yes. Kavero stores your provider API keys securely using server-side secret storage. Your full key is never exposed in the browser.",
      "Inside the app, we only show a short key hint so you can recognize which key is connected. The full key is only read by Kavero's server when it is needed to send a generation request to your selected provider.",
    ],
  },
  {
    question: "Can Kavero see my entire Google Drive?",
    answer: [
      "No. Kavero uses limited Google Drive access through Google's drive.file permission.",
      "This means Kavero is designed to work with files it creates or files you explicitly connect through the app. For generated images, Kavero creates a dedicated folder called Kavero Generated Images and stores your generated files there.",
      "Kavero does not request broad access to browse your entire Google Drive.",
    ],
  },
  {
    question: "What data does Kavero store?",
    answer: [
      "Kavero stores only the information needed to run your workspace, including your account details, plan status, connection metadata, prompt templates, generation history, gallery records, and Google Drive file IDs used by your Gallery.",
      "Sensitive secrets, such as full API keys and Google refresh tokens, are stored separately through secure server-side secret storage.",
    ],
  },
  {
    question: "Who owns the images I generate?",
    answer: [
      "You own the images you generate, subject to the terms of the image provider you use.",
      "Kavero does not own the image models. It acts as an interface between you and the provider you connect, such as Google Gemini. When you generate an image, your prompt, settings, and reference images are sent to that provider using your own API key.",
    ],
  },
  {
    question: "What information is sent to image providers?",
    answer: [
      "When you generate an image, Kavero sends the information required to complete that request. This may include your prompt, selected settings, and any reference images you upload.",
      "Provider behavior is controlled by that provider's own API terms, privacy policies, and data handling rules.",
    ],
  },
  {
    question: "What happens if I disconnect Google Drive?",
    answer: [
      "When you disconnect Google Drive, Kavero attempts to revoke its access and marks the connection as disconnected.",
      "You can still generate images without Google Drive connected, but they may not be saved to your Gallery or backed up to Drive until you reconnect.",
    ],
  },
  {
    question: "Can I use Kavero without Google Drive?",
    answer: [
      "Yes. Google Drive is used for saving generated images and metadata to your connected Drive folder.",
      "If Drive is not connected, Kavero can still return generated images during your session, but Gallery saving may be limited.",
    ],
  },
];

type HomePageProps = {
  searchParams?: Promise<{ tab?: string }> | { tab?: string };
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = searchParams ? await searchParams : {};
  const activeTab = params.tab === "learn" ? "learn" : "apps";

  return (
    <main className="h-svh overflow-y-auto bg-black text-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="min-h-svh px-4 pb-7 pt-2 sm:px-6 lg:px-8">
        <SiteNav activeLabel="Home" />

        <section className="mx-auto w-full max-w-[1536px] pt-[82px]">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="flex items-center gap-4">
              <Link
                className={`inline-flex h-8 items-center gap-2 rounded-full px-4 text-[12px] font-semibold shadow-[inset_0_1px_0_rgb(255_255_255_/_0.05)] transition ${
                  activeTab === "apps"
                    ? "bg-white/[0.09] text-white"
                    : "text-white/58 hover:bg-white/[0.05] hover:text-white"
                }`}
                href="/"
              >
                <Grid2X2 size={13} />
                Apps
              </Link>
              <Link
                className={`inline-flex h-8 items-center gap-1.5 rounded-full px-4 text-[12px] font-semibold transition ${
                  activeTab === "learn"
                    ? "bg-white/[0.09] text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.05)]"
                    : "text-white/58 hover:bg-white/[0.05] hover:text-white"
                }`}
                href="/?tab=learn"
              >
                <GraduationCap size={13} />
                Learn
              </Link>
            </div>

            <Link
              className="hidden h-9 items-center gap-1 rounded-full border border-white/[0.08] bg-black/50 px-4 text-[13px] font-medium text-white/68 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.05)] transition hover:text-white md:inline-flex"
              href="/generate"
            >
              Ultra fast image generation.
              <ArrowRight size={14} className="-rotate-45" />
            </Link>

            <div aria-hidden="true" />
          </div>

          {activeTab === "learn" ? <LearnTab /> : <AppsTab />}
        </section>
      </div>
    </main>
  );
}

function AppsTab() {
  return (
    <div className="mt-7 space-y-7">
      <section className="rounded-[44px] bg-[#1b1b1b] p-6 sm:p-8 lg:p-12">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-14">
          {featureCards.slice(0, 2).map((card) => (
            <FeatureCard key={card.title} {...card} />
          ))}
        </div>
      </section>

      <section className="rounded-[44px] bg-[#1b1b1b] p-6 sm:p-8 lg:p-12">
        <div className="grid gap-6 lg:grid-cols-12 lg:gap-14">
          {featureCards.slice(2).map((card) => (
            <FeatureCard key={card.title} {...card} />
          ))}
        </div>
      </section>
    </div>
  );
}

function LearnTab() {
  return (
    <div className="mt-7 space-y-7">
      <section className="overflow-hidden rounded-[44px] bg-[#1b1b1b] p-6 sm:p-8 lg:p-12">
        <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
          <div>
            <div className="mb-5 inline-flex h-9 items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.055] px-4 text-[12px] font-semibold text-white/68">
              <ShieldCheck size={14} className="text-accent" />
              Privacy & Security FAQ
            </div>
            <h1 className="max-w-[760px] text-[clamp(44px,5vw,78px)] font-light leading-none tracking-normal text-white">
              Privacy & Security
            </h1>
            <p className="mt-5 max-w-[680px] text-[17px] font-medium leading-7 text-white/58">
              Kavero is built to give you control over your image generation workflow without asking for unnecessary
              access.
            </p>
          </div>

          <div className="grid gap-3 rounded-[24px] border border-white/[0.08] bg-black/24 p-4">
            <TrustRow
              icon={FolderLock}
              label="Drive access"
              value="Kavero uses limited drive.file access and does not request broad Drive browsing access."
            />
            <TrustRow
              icon={KeyRound}
              label="API keys"
              value="Full provider keys are kept out of the browser and used only by server-side generation requests."
            />
          </div>
        </div>
      </section>

      <section className="rounded-[44px] bg-[#1b1b1b] p-6 sm:p-8 lg:p-12">
        <div className="grid gap-4 lg:grid-cols-2">
          {privacyFaqItems.map((item) => (
            <FaqCard key={item.question} question={item.question} answer={item.answer} />
          ))}
        </div>
      </section>
    </div>
  );
}

function FaqCard({ question, answer }: { question: string; answer: string[] }) {
  return (
    <div className="rounded-[18px] border border-white/[0.08] bg-white/[0.04] p-5">
      <h2 className="m-0 text-[18px] font-semibold text-white">{question}</h2>
      <div className="mt-4 grid gap-3">
        {answer.map((paragraph) => (
          <p key={paragraph} className="m-0 text-[13px] font-medium leading-6 text-white/54">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}

function TrustRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof KeyRound;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3 rounded-[16px] border border-white/[0.07] bg-white/[0.04] p-4">
      <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-white/58">
        <Icon size={16} />
      </div>
      <div>
        <p className="m-0 text-[12px] font-bold uppercase tracking-[0.08em] text-white/34">{label}</p>
        <p className="m-0 mt-1 text-[13px] font-semibold leading-5 text-white/72">{value}</p>
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  subtitle,
  action,
  href,
  className,
  image,
  visual,
  badge,
  preview,
}: {
  title: string;
  subtitle: string;
  action: string;
  href: string;
  className: string;
  image?: string;
  visual?: "flux";
  badge?: string;
  preview?: string;
}) {
  return (
    <Link
      className={`group relative min-h-[260px] overflow-hidden rounded-[18px] bg-neutral-900 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)] ${className}`}
      href={href}
    >
      {visual === "flux" ? <FluxVisual /> : <CardImage image={image ?? ""} title={title} />}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(0_0_0_/_0.44),rgb(0_0_0_/_0.16)_44%,rgb(0_0_0_/_0.34)),linear-gradient(180deg,rgb(0_0_0_/_0.18),rgb(0_0_0_/_0.38))]" />
      <div className="relative z-10 flex min-h-[260px] flex-col justify-between p-7">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[clamp(52px,4.9vw,72px)] font-light leading-none tracking-normal text-white drop-shadow-[0_18px_54px_rgb(0_0_0_/_0.36)]">
              {title}
            </h2>
            {badge ? (
              <span className="rounded-md bg-indigo-500/70 px-2 py-1 text-[12px] font-semibold text-white/88 backdrop-blur">
                {badge}
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-[clamp(17px,1.35vw,22px)] font-semibold leading-6 tracking-normal text-white/92">
            {subtitle}
          </p>
          {preview ? (
            <span className="mt-2 inline-flex rounded-md bg-black/32 px-2 py-1 text-[12px] font-medium text-white/76">
              {preview}
            </span>
          ) : null}
        </div>

        <span className="inline-flex h-10 w-max items-center gap-2 rounded-full bg-white px-6 text-[12px] font-semibold tracking-normal text-black shadow-[0_12px_34px_rgb(0_0_0_/_0.28)] transition group-hover:translate-x-1">
          {action}
          <ArrowRight size={17} />
        </span>
      </div>
    </Link>
  );
}

function CardImage({ image, title }: { image: string; title: string }) {
  return (
    <img
      className="absolute inset-0 h-full w-full scale-105 object-cover transition duration-500 group-hover:scale-110"
      src={image}
      alt=""
      aria-hidden="true"
      style={{ objectPosition: title === "Edit" ? "center 38%" : "center" }}
    />
  );
}

function FluxVisual() {
  return (
    <div className="absolute inset-0 bg-black">
      <div className="absolute left-1/2 top-1/2 grid w-[780px] -translate-x-1/2 -translate-y-1/2 -rotate-[18deg] grid-cols-4 gap-3">
        {fluxTiles.map((tile, index) => (
          <img
            key={tile}
            className="h-[136px] w-full rounded-[10px] object-cover opacity-85"
            src={tile}
            alt=""
            aria-hidden="true"
            style={{ transform: `translateY(${index % 2 === 0 ? "-18px" : "18px"})` }}
          />
        ))}
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_48%_46%,transparent_0_34%,rgb(0_0_0_/_0.54)_78%),linear-gradient(90deg,rgb(0_0_0_/_0.48),transparent_50%,rgb(0_0_0_/_0.22))]" />
    </div>
  );
}
