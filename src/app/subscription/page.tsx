import type { Metadata } from "next";
import { ArrowRight, BadgeCheck, CreditCard, ReceiptText, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { brand } from "@/lib/brand";
import { SettingsPanel, SettingsPanelHeader, SettingsShell, StatCard } from "../settings/settings-shell";

export const metadata: Metadata = {
  title: `Subscription | ${brand.name}`,
  description: `Manage your ${brand.name} subscription.`,
};

export default function SubscriptionPage() {
  return (
    <SettingsShell
      active="Subscription"
      title="Subscription"
      description="Review plan status, billing actions, and usage limits for your workspace."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Current plan" value="Free" helper="No billing method required" icon={Sparkles} />
        <StatCard label="Monthly usage" value="0%" helper="Usage tracking coming soon" icon={Zap} />
        <StatCard label="Invoices" value="0" helper="No invoices available" icon={ReceiptText} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SettingsPanel>
          <SettingsPanelHeader
            title="Plan"
            description="Upgrade controls can connect to your billing provider when subscriptions are enabled."
            action={
              <Button disabled>
                Upgrade
                <ArrowRight size={15} />
              </Button>
            }
          />
          <div className="p-5">
            <div className="rounded-3xl border border-white/[0.1] bg-[linear-gradient(135deg,rgb(255_255_255_/_0.1),rgb(255_255_255_/_0.035))] p-6">
              <div className="mb-6 inline-flex h-8 items-center gap-2 rounded-full bg-white/[0.1] px-3 text-[12px] font-medium text-white/68">
                <BadgeCheck size={14} />
                Active
              </div>
              <p className="m-0 text-4xl font-light tracking-normal text-white">Free</p>
              <p className="m-0 mt-3 max-w-[58ch] text-[13px] font-medium leading-6 text-white/50">
                Good for trying protected generation and workspace flows. Paid limits, usage, and billing will appear here when enabled.
              </p>
            </div>
          </div>
        </SettingsPanel>

        <SettingsPanel>
          <SettingsPanelHeader title="Billing" />
          <div className="grid gap-3 p-5">
            <BillingRow label="Payment method" value="Not connected" />
            <BillingRow label="Renewal" value="Not applicable" />
            <BillingRow label="Billing email" value="Account email" />
          </div>
        </SettingsPanel>
      </div>
    </SettingsShell>
  );
}

function BillingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-white/[0.08] bg-black/20 px-4 py-3">
      <span className="inline-flex items-center gap-2 text-[13px] font-medium text-white/54">
        <CreditCard size={14} />
        {label}
      </span>
      <span className="text-right text-[13px] font-semibold text-white">{value}</span>
    </div>
  );
}
