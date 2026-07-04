import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  CreditCard,
  HardDrive,
  KeyRound,
  Mail,
  Palette,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";
import { getDeploymentProfile } from "@/lib/deployment-profile";
import { normalizeUserPlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { getSettingsCopy } from "./settings-copy";
import { SettingsPanel, SettingsPanelHeader, SettingsShell, StatCard } from "./settings-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: `Settings | ${brand.name}`,
  description: `Manage your ${brand.name} account and workspace preferences.`,
};

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const displayName =
    user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? user?.email ?? "Account";
  const avatarUrl = user?.user_metadata?.avatar_url ?? user?.user_metadata?.picture;
  const { data: metadata } = user
    ? await supabase.from("user_metadata").select("plan").eq("user_id", user.id).maybeSingle()
    : { data: null };
  const plan = normalizeUserPlan(metadata?.plan);
  const planLabel = plan === "premium" ? "Premium" : "Free";
  const settingsCopy = getSettingsCopy(getDeploymentProfile());

  return (
    <SettingsShell
      active="Overview"
      title="Settings"
      description={settingsCopy.overviewDescription}
    >
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Plan" value={planLabel} helper="Personal workspace" icon={CreditCard} />
        <StatCard label="API access" value="Ready" helper="Connect provider keys" icon={KeyRound} />
        <StatCard
          label="Storage"
          value={settingsCopy.storageStat.value}
          helper={settingsCopy.storageStat.helper}
          icon={HardDrive}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsPanel>
          <SettingsPanelHeader
            title="Profile"
            description="This information is used across your workspace and account emails."
            action={
              <Button variant="secondary" size="default" disabled>
                Edit profile
              </Button>
            }
          />
          <div className="grid gap-5 p-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
            <div className="grid h-20 w-20 place-items-center overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.07] text-2xl font-semibold text-white">
              {avatarUrl ? (
                <img className="h-full w-full object-cover" src={avatarUrl} alt="" />
              ) : (
                getInitials(displayName)
              )}
            </div>
            <div className="min-w-0">
              <p className="m-0 truncate text-2xl font-light tracking-normal text-white">
                {displayName}
              </p>
              <div className="mt-3 grid gap-2 text-[13px] font-medium text-white/52">
                <span className="inline-flex min-w-0 items-center gap-2">
                  <Mail size={14} className="shrink-0 text-white/36" />
                  <span className="truncate">{user?.email ?? "No email available"}</span>
                </span>
              </div>
            </div>
          </div>
        </SettingsPanel>

        <SettingsPanel>
          <SettingsPanelHeader title="Quick actions" />
          <div className="grid gap-2 p-3">
            <QuickLink href="/settings/api-keys" icon={KeyRound} label="Manage API keys" />
            <QuickLink
              href="/settings/storage"
              icon={HardDrive}
              label={settingsCopy.storageQuickActionLabel}
            />
            <QuickLink
              href="/subscription"
              icon={CreditCard}
              label={settingsCopy.subscriptionQuickActionLabel}
            />
            <QuickLink href="/generate" icon={Palette} label="Open workspace" />
          </div>
        </SettingsPanel>
      </div>

      <div className="mt-4">
        <SettingsPanel>
          <SettingsPanelHeader
            title="Workspace activity"
            description="A quick overview of your creative workspace."
          />
          <div className="p-5">
            <div className="rounded-2xl border border-white/[0.08] bg-black/24 p-4">
              <div className="mb-4 flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/[0.07] text-white/64">
                  <Activity size={17} />
                </div>
                <div>
                  <p className="m-0 text-[14px] font-semibold text-white">Ready</p>
                  <p className="m-0 mt-0.5 text-[12px] font-medium text-white/42">
                    Your workspace is ready for generation and design workflows.
                  </p>
                </div>
              </div>
              <Button asChild variant="secondary" className="w-full">
                <Link href="/generate">
                  Open Generate
                  <ArrowRight size={15} />
                </Link>
              </Button>
            </div>
          </div>
        </SettingsPanel>
      </div>
    </SettingsShell>
  );
}

function QuickLink({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: typeof KeyRound;
  label: string;
}) {
  return (
    <Link
      className="flex h-11 items-center justify-between rounded-xl px-3 text-[13px] font-medium text-white/62 transition hover:bg-white/[0.07] hover:text-white"
      href={href}
    >
      <span className="inline-flex items-center gap-2">
        <Icon size={15} />
        {label}
      </span>
      <ArrowRight size={14} />
    </Link>
  );
}

function getInitials(value: string) {
  return (
    value
      .replace(/@.*/, "")
      .split(/\s|[._-]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  );
}
