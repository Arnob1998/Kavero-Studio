import {
  type DeploymentProfile,
  isLocalFirstDeploymentProfile,
  resolveDeploymentProfile,
} from "@/lib/deployment-profile";

export type SettingsCopy = {
  deploymentProfile: DeploymentProfile;
  overviewDescription: string;
  storageStat: {
    value: string;
    helper: string;
  };
  storageQuickActionLabel: string;
  subscriptionQuickActionLabel: string;
  storagePageDescription: string;
  storagePanel: {
    title: string;
    description: string;
    badge: string;
    details: Array<{
      label: string;
      value: string;
    }>;
    summaryTitle: string;
    summaryDescription: string;
  };
};

export function getSettingsCopy(profile?: string | null): SettingsCopy {
  const deploymentProfile = resolveDeploymentProfile(profile);

  if (isLocalFirstDeploymentProfile(deploymentProfile)) {
    return {
      deploymentProfile,
      overviewDescription:
        "Manage your profile, workspace preferences, API access, and Kavero storage.",
      storageStat: {
        value: "Kavero",
        helper: "Managed storage",
      },
      storageQuickActionLabel: "Review storage",
      subscriptionQuickActionLabel: "View account details",
      storagePageDescription:
        "Review the managed Kavero storage path used by local-first generation, Gallery, and canvas workflows.",
      storagePanel: {
        title: "Kavero storage",
        description:
          "Local-first workflows save Kavero-owned files through the configured managed storage backend.",
        badge: "Managed",
        details: [
          { label: "Provider", value: "kavero-managed" },
          { label: "Backend", value: "Local managed storage" },
          { label: "Scope", value: "Single-node app storage" },
        ],
        summaryTitle: "Local-first storage",
        summaryDescription:
          "Generated images, Gallery history, and canvas assets use Kavero storage for core workflows. Google Drive is not required for this profile.",
      },
    };
  }

  return {
    deploymentProfile,
    overviewDescription:
      "Manage your profile, workspace preferences, API access, and subscription.",
    storageStat: {
      value: "Drive",
      helper: "Free plan archive",
    },
    storageQuickActionLabel: "Connect storage",
    subscriptionQuickActionLabel: "View subscription",
    storagePageDescription:
      "Connect a scoped Google Drive folder so generated images and history can be saved on the free plan.",
    storagePanel: {
      title: "Google Drive",
      description:
        "Kavero creates a dedicated folder and only requests file access for Drive files it creates.",
      badge: "Connected",
      details: [],
      summaryTitle: "Free plan storage",
      summaryDescription: "New generations are saved to Drive and listed in Gallery.",
    },
  };
}
