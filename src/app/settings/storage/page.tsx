import type { Metadata } from "next";
import { brand } from "@/lib/brand";
import { getDeploymentProfile } from "@/lib/deployment-profile";
import { getSettingsCopy } from "../settings-copy";
import { SettingsShell } from "../settings-shell";
import { StorageSettingsPanel } from "./storage-settings-panel";

export const metadata: Metadata = {
  title: `Storage | ${brand.name}`,
  description: "Connect Google Drive storage for generated image history.",
};

export default function StorageSettingsPage() {
  const settingsCopy = getSettingsCopy(getDeploymentProfile());

  return (
    <SettingsShell
      active="Storage"
      title="Storage"
      description={settingsCopy.storagePageDescription}
    >
      <StorageSettingsPanel deploymentProfile={settingsCopy.deploymentProfile} />
    </SettingsShell>
  );
}
