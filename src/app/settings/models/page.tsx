import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { createClient } from "@/lib/supabase/server";
import { localGenerationUIEnabled } from "@/modules/model-providers/local/enabled";
import { ModelHub } from "@/modules/model-providers/local/model-hub";
import { ProviderSettingsPanel } from "../api-keys/provider-settings-panel";
import { SettingsShell } from "../settings-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Model Hub | ${brand.name}`, description: "Manage local models, cloud providers and model defaults." };

export default async function ModelsPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const query = await searchParams;
  const client = await createClient(), { data: { user } } = await client.auth.getUser();
  return <SettingsShell active="Model Hub" title="Model Hub" description="Your models. Your providers. One place.">
    <ModelHub localEnabled={localGenerationUIEnabled()} ownerId={user?.id} initialSource={query.source === "cloud" ? "cloud" : undefined} cloudPanel={<ProviderSettingsPanel />} />
  </SettingsShell>;
}
