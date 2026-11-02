import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import {
  HardDrive,
  KeyRound,
  LayoutDashboard,
} from "lucide-react";
import { BrandMark } from "@/components/brand";
import { SiteNav } from "@/components/site-nav";
import { brand } from "@/lib/brand";
import { cn } from "@/lib/utils";
import styles from "./settings.module.css";

const settingsNav = [
  { label: "Overview", href: "/settings", icon: LayoutDashboard },
  { label: "Model Hub", href: "/settings/models", icon: KeyRound },
  { label: "Storage", href: "/settings/storage", icon: HardDrive },
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
    <main className={styles.page}>
      <SiteNav activeLabel="Settings" />

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <div>
            <div className="mb-3 flex items-center gap-3 px-2 py-2">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.1]">
                <BrandMark className="h-[20px] w-[20px] gap-[3px]" />
              </div>
              <div>
                <p className="m-0 text-[13px] font-semibold text-white">{brand.name}</p>
                <p className="m-0 mt-0.5 text-[11px] font-medium text-white/42">Settings</p>
              </div>
            </div>

            <nav className={styles.navigation} aria-label="Settings navigation">
              {settingsNav.map((item) => (
                <SettingsNavItem key={item.label} active={active === item.label} {...item} />
              ))}
            </nav>
          </div>
        </aside>

        <section className="min-w-0">
          <div className={styles.heading}>
            <div>
              <h1>
                {title}
              </h1>
              <p>
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
        styles.navItem,
        active && styles.navActive,
      )}
      href={href}
      aria-current={active ? "page" : undefined}
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
        styles.panel,
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
    <div className={styles.panelHeader}>
      <div>
        <h2>{title}</h2>
        {description ? (
          <p>
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
    <SettingsPanel className={styles.stat}>
      <div className="mb-4 flex items-center justify-between">
        <p className="m-0 text-[12px] font-medium text-text-secondary">{label}</p>
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.07] text-white/66">
          <Icon size={16} />
        </div>
      </div>
      <p className="m-0 text-[22px] font-medium tracking-tight text-text-primary">{value}</p>
      <p className="m-0 mt-2 text-[12px] leading-5 text-text-secondary">{helper}</p>
    </SettingsPanel>
  );
}
