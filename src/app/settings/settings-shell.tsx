import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import {
  CreditCard,
  HardDrive,
  KeyRound,
  LayoutDashboard,
  SlidersHorizontal,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { SiteNav } from "@/components/site-nav";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";

const settingsNav = [
  { label: "Overview", href: "/settings", icon: LayoutDashboard },
  { label: "API Keys", href: "/settings/api-keys", icon: KeyRound },
  { label: "Storage", href: "/settings/storage", icon: HardDrive },
  { label: "Subscription", href: "/subscription", icon: CreditCard },
];

export function SettingsShell({
  active,
  title,
  description,
  children,
}: {
  active: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="h-svh overflow-y-auto overscroll-contain bg-[#050506] text-white [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <SiteNav activeLabel="Settings" />

      <div
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_18%_16%,rgb(255_255_255_/_0.08),transparent_28%),radial-gradient(circle_at_82%_4%,rgb(59_130_246_/_0.08),transparent_24%),linear-gradient(180deg,rgb(255_255_255_/_0.035),transparent_28%)]"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-auto grid w-full max-w-[1340px] gap-6 px-4 pb-10 pt-24 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:px-8">
        <aside className="lg:sticky lg:top-24 lg:h-[calc(100svh-7rem)]">
          <div className="rounded-2xl border border-white/[0.1] bg-white/[0.045] p-3 shadow-[0_24px_90px_rgb(0_0_0_/_0.42),inset_0_1px_0_rgb(255_255_255_/_0.06)] backdrop-blur-xl">
            <div className="mb-3 flex items-center gap-3 px-2 py-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.1]">
                <BrandMark className="h-[20px] w-[20px] gap-[3px]" />
              </div>
              <div>
                <p className="m-0 text-[13px] font-semibold text-white">{brand.name}</p>
                <p className="m-0 mt-0.5 text-[11px] font-medium text-white/42">Settings</p>
              </div>
            </div>

            <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none] lg:block [&::-webkit-scrollbar]:hidden">
              {settingsNav.map((item) => (
                <SettingsNavItem key={item.label} active={active === item.label} {...item} />
              ))}
            </nav>
          </div>
        </aside>

        <section className="min-w-0">
          <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <div className="mb-3 inline-flex h-8 items-center gap-2 rounded-full border border-white/[0.1] bg-white/[0.055] px-3 text-[12px] font-medium text-white/58">
                <SlidersHorizontal size={13} />
                Account controls
              </div>
              <h1 className="m-0 text-[clamp(38px,5vw,74px)] font-light leading-none tracking-normal">
                {title}
              </h1>
              <p className="mt-4 max-w-[720px] text-[14px] font-medium leading-6 text-white/52">
                {description}
              </p>
            </div>
          </div>

          {children}
        </section>
      </div>
    </main>
  );
}

function SettingsNavItem({
  label,
  href,
  icon: Icon,
  active,
}: {
  label: string;
  href: string;
  icon: ComponentType<{ size?: number; className?: string }>;
  active: boolean;
}) {
  return (
    <Link
      className={cn(
        "flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-[13px] font-medium text-white/54 transition hover:bg-white/[0.07] hover:text-white lg:w-full",
        active && "bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)]",
      )}
      href={href}
    >
      <Icon size={15} />
      {label}
    </Link>
  );
}

export function SettingsPanel({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "rounded-2xl border border-white/[0.1] bg-white/[0.045] shadow-[0_24px_90px_rgb(0_0_0_/_0.36),inset_0_1px_0_rgb(255_255_255_/_0.055)] backdrop-blur-xl",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function SettingsPanelHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 border-b border-white/[0.08] p-5 sm:flex-row sm:items-center">
      <div>
        <h2 className="m-0 text-[18px] font-semibold tracking-normal text-white">{title}</h2>
        {description ? (
          <p className="m-0 mt-1 max-w-[64ch] text-[13px] font-medium leading-5 text-white/48">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  helper,
  icon: Icon,
}: {
  label: string;
  value: string;
  helper: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}) {
  return (
    <SettingsPanel className="p-5">
      <div className="mb-5 flex items-center justify-between">
        <p className="m-0 text-[12px] font-medium uppercase text-white/42">{label}</p>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.07] text-white/66">
          <Icon size={16} />
        </div>
      </div>
      <p className="m-0 text-3xl font-light tracking-normal text-white">{value}</p>
      <p className="m-0 mt-2 text-[12px] font-medium text-white/42">{helper}</p>
    </SettingsPanel>
  );
}
