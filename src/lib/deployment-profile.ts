export const deploymentProfiles = ["cloud", "local-first"] as const;

export type DeploymentProfile = (typeof deploymentProfiles)[number];

export type DeploymentProfileEnv = {
  KAVERO_DEPLOYMENT_PROFILE?: string | undefined;
  [key: string]: string | undefined;
};

export const defaultDeploymentProfile: DeploymentProfile = "cloud";

export function isDeploymentProfile(value: unknown): value is DeploymentProfile {
  return typeof value === "string" && deploymentProfiles.includes(value as DeploymentProfile);
}

export function resolveDeploymentProfile(value?: string | null): DeploymentProfile {
  const profile = value?.trim();
  return isDeploymentProfile(profile) ? profile : defaultDeploymentProfile;
}

export function getDeploymentProfile(env: DeploymentProfileEnv = process.env): DeploymentProfile {
  return resolveDeploymentProfile(env.KAVERO_DEPLOYMENT_PROFILE);
}

export function isLocalFirstDeploymentProfile(profile?: DeploymentProfile | null) {
  return profile === "local-first";
}
