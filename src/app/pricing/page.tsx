import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  KeyRound,
  LockKeyhole,
  PlugZap,
  WalletCards,
  WandSparkles,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { SiteNav } from "@/components/site-nav";
import { brand } from "@/lib/brand";

export const metadata: Metadata = {
  title: `Pricing | ${brand.name}`,
  description: `${brand.name} is free while you bring your own provider API keys.`,
};

const planFeatures = [
  "Image generation",
  "Bring your own keys",
  "Private key manager",
  "No usage markup",
];

const valueProps = [
  {
    icon: KeyRound,
    title: "Bring your own keys",
    description: "Use providers you already trust.",
  },
  {
    icon: WandSparkles,
    title: "Create for free",
    description: "Generate without a platform fee.",
  },
  {
    icon: PlugZap,
    title: "Upgrade later",
    description: "Paid editing and team plans are coming.",
  },
];

export default function PricingPage() {
  return (
    <main className="h-svh overflow-y-auto overscroll-contain bg-black text-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <SiteNav activeLabel="Pricing" />

      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_50%_8%,rgb(255_255_255_/_0.08),transparent_24%),linear-gradient(180deg,rgb(255_255_255_/_0.025),transparent_34%)]"
        aria-hidden="true"
      />

      <section className="relative z-10 mx-auto w-full max-w-[1260px] px-4 pb-14 pt-24 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="mb-4 inline-flex h-7 items-center gap-2 rounded-lg border border-white/[0.12] bg-white/[0.035] px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-white/56">
            <WalletCards size={13} />
            Pricing
          </div>
          <h1 className="m-0 text-[clamp(42px,6vw,78px)] font-light leading-none tracking-normal">
            Join {brand.name} for free
          </h1>
        </div>

        <div className="mt-12 grid gap-10 xl:grid-cols-[360px_minmax(0,640px)] xl:items-center xl:justify-center xl:gap-16">
          <aside className="mx-auto w-full max-w-[680px] xl:mx-0 xl:max-w-none">
            <div className="mb-4 inline-flex h-7 items-center rounded-lg border border-white/[0.1] bg-white/[0.035] px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-white/42">
              Bring your own key
            </div>
            <h2 className="m-0 max-w-[18ch] text-[clamp(28px,4vw,34px)] font-light leading-tight tracking-normal">
              Create with your own AI providers.
            </h2>
            <p className="m-0 mt-4 max-w-[36ch] text-[13px] font-medium leading-6 text-white/36">
              No subscription today. No markup on usage. You stay in control of provider spend.
            </p>

            <div className="mt-9 grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
              {valueProps.map((item) => (
                <ValueProp key={item.title} {...item} />
              ))}
            </div>
          </aside>

          <section className="mx-auto w-full max-w-[640px] rounded-3xl border border-white/[0.08] bg-[#111112]/96 p-5 shadow-[0_32px_120px_rgb(0_0_0_/_0.62),inset_0_1px_0_rgb(255_255_255_/_0.055)] sm:p-8 lg:p-10 xl:mx-0">
            <div className="flex items-start justify-between gap-6">
              <div>
                <h2 className="m-0 text-[clamp(24px,5vw,32px)] font-light tracking-normal text-white">
                  Free Plan
                </h2>
                <div className="mt-3 flex items-end gap-3">
                  <span className="text-[clamp(38px,8vw,50px)] font-light leading-none tracking-normal">
                    Free
                  </span>
                  <span className="pb-1.5 text-[12px] font-medium text-white/34">per user/mo</span>
                </div>
              </div>

              <div className="hidden pt-1 sm:block" aria-hidden="true">
                <BrandMark className="h-8 w-20 grid-cols-4 gap-[5px]" tileClassName="rounded-[3px] bg-white" />
              </div>
            </div>

            <div className="my-8 h-px bg-white/[0.08]" />

            <div className="grid gap-8 md:grid-cols-2 lg:gap-12">
              <div>
                <p className="m-0 mb-4 text-[12px] font-medium text-white/84">Included:</p>
                <ul className="m-0 grid list-none gap-3.5 p-0">
                  {planFeatures.map((feature) => (
                    <li key={feature} className="flex items-center gap-3 text-[12px] font-medium leading-5 text-white/48">
                      <Check size={15} className="shrink-0 text-accent" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="m-0 mb-4 text-[12px] font-medium text-white/84">You pay for:</p>
                <ul className="m-0 grid list-none gap-3.5 p-0">
                  <li className="flex items-center gap-3 text-[12px] font-medium leading-5 text-white/48">
                    <Check size={15} className="shrink-0 text-accent" />
                    Provider usage
                  </li>
                  <li className="flex items-center gap-3 text-[12px] font-medium leading-5 text-white/48">
                    <Check size={15} className="shrink-0 text-accent" />
                    Optional paid upgrades later
                  </li>
                  <li className="flex items-center gap-3 text-[12px] font-medium leading-5 text-white/48">
                    <Check size={15} className="shrink-0 text-accent" />
                    No card required to start
                  </li>
                </ul>
              </div>
            </div>

            <div className="mt-12 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-center">
              <Button
                asChild
                className="h-11 rounded-xl bg-accent px-5 text-[13px] font-semibold text-white hover:bg-accent-hover"
              >
                <Link href="/generate">
                  Get started
                  <ArrowRight size={15} />
                </Link>
              </Button>
              <Button asChild variant="ghost" className="h-11 rounded-xl text-white/46">
                <Link href="/settings/api-keys">
                  <LockKeyhole size={15} />
                  Add API key
                </Link>
              </Button>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function ValueProp({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof KeyRound;
  title: string;
  description: string;
}) {
  return (
    <div className="grid grid-cols-[50px_minmax(0,1fr)] gap-4">
      <div className="grid h-12 w-12 place-items-center rounded-xl border border-white/[0.09] bg-white/[0.025] text-white/70">
        <Icon size={19} />
      </div>
      <div>
        <h3 className="m-0 text-[14px] font-medium text-white/80">{title}</h3>
        <p className="m-0 mt-1 max-w-[34ch] text-[12px] font-medium leading-5 text-white/34">
          {description}
        </p>
      </div>
    </div>
  );
}
