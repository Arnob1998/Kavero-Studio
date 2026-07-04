import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { SettingsShell } from "../settings-shell";
import { ProviderSettingsPanel } from "./provider-settings-panel";

export const metadata: Metadata = {
  title: `API Providers | ${brand.name}`,
  description: `Connect provider API keys for ${brand.name}.`,
};

export default function ApiKeysPage() {
  return (
    <SettingsShell
      active="API Keys"
      title="API Providers"
      description="Connect your generation provider. Google Gemini is available now, with more providers coming later."
    >
      <ProviderSettingsPanel />
    </SettingsShell>
  );
}
