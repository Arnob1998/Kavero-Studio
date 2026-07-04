export const setupProfiles = [
  {
    id: "local-docker",
    label: "Local Docker",
    hint: "Run Kavero and the bundled Supabase stack on this machine.",
    envFile: ".env.docker.local",
    docker: true,
    authModeIds: ["password"],
    defaultAuthMode: "password",
    defaultStorageChoice: "kavero-managed-local-filesystem",
  },
  {
    id: "cloud-self-host",
    label: "Cloud / self-host",
    hint: "Connect Kavero to an existing Supabase project or hosted stack.",
    envFile: ".env.local",
    docker: false,
    authModeIds: ["google", "password", "google-password"],
    defaultAuthMode: "google",
    defaultStorageChoice: "google-drive",
  },
];

export const setupAuthModes = [
  {
    id: "google",
    label: "Google",
    hint: "Google sign-in only.",
    enabled: true,
  },
  {
    id: "password",
    label: "Email and password",
    hint: "Simple local/self-host login.",
    enabled: true,
  },
  {
    id: "google-password",
    label: "Google + password",
    hint: "Use both sign-in methods when Supabase is configured for both.",
    enabled: true,
  },
];

export const setupStorageChoices = [
  {
    id: "google-drive",
    label: "Google Drive",
    hint: "Current connected storage behavior.",
    enabled: true,
    profileIds: ["cloud-self-host"],
    env: {
      KAVERO_STORAGE_PROVIDER: "",
      KAVERO_MANAGED_STORAGE_BACKEND: "",
      KAVERO_LOCAL_STORAGE_ROOT: "",
    },
  },
  {
    id: "kavero-managed-supabase",
    label: "Kavero managed: Supabase Storage",
    hint: "App-managed storage using the configured Supabase project.",
    enabled: true,
    profileIds: ["cloud-self-host"],
    env: {
      KAVERO_STORAGE_PROVIDER: "kavero-managed",
      KAVERO_MANAGED_STORAGE_BACKEND: "supabase-storage",
      KAVERO_LOCAL_STORAGE_ROOT: "",
    },
  },
  {
    id: "kavero-managed-local-filesystem",
    label: "Kavero managed: local filesystem",
    hint: "Single-node storage backed by a local path or Docker volume.",
    enabled: true,
    profileIds: ["local-docker", "cloud-self-host"],
    env: {
      KAVERO_STORAGE_PROVIDER: "kavero-managed",
      KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem",
    },
  },
  {
    id: "s3-compatible",
    label: "S3 compatible",
    hint: "Reserved for a future storage backend.",
    enabled: false,
    profileIds: ["cloud-self-host"],
    env: {
      KAVERO_STORAGE_PROVIDER: "kavero-managed",
      KAVERO_MANAGED_STORAGE_BACKEND: "s3-compatible",
    },
  },
];

export const sensitiveEnvKeys = new Set([
  "POSTGRES_PASSWORD",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "GOOGLE_DRIVE_CLIENT_SECRET",
]);

export const dockerGeneratedSecretKeys = [
  "POSTGRES_PASSWORD",
  "SUPABASE_JWT_SECRET",
  "SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];

export function getSetupProfile(profileId) {
  return setupProfiles.find((profile) => profile.id === profileId) ?? null;
}

export function getEnabledAuthModes(profileId) {
  const profile = profileId ? getSetupProfile(profileId) : null;
  return setupAuthModes.filter(
    (mode) => mode.enabled && (!profile || profile.authModeIds.includes(mode.id)),
  );
}

export function getEnabledStorageChoices(profileId) {
  return setupStorageChoices.filter(
    (choice) => choice.enabled && choice.profileIds.includes(profileId),
  );
}

export function getSetupStorageChoice(choiceId) {
  return setupStorageChoices.find((choice) => choice.id === choiceId) ?? null;
}

export function isPlaceholderValue(value) {
  const trimmed = String(value ?? "").trim();
  return (
    trimmed === "" ||
    trimmed.startsWith("replace-with-") ||
    (trimmed.startsWith("<") && trimmed.endsWith(">"))
  );
}

export function requiredEnvKeysForProfile(profileId) {
  if (profileId === "local-docker") {
    return [
      "KAVERO_APP_PORT",
      "SUPABASE_KONG_PORT",
      "POSTGRES_DB",
      "POSTGRES_USER",
      "POSTGRES_PASSWORD",
      "SUPABASE_JWT_SECRET",
      "SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_INTERNAL_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "NEXT_PUBLIC_SITE_URL",
      "KAVERO_API_ORIGIN",
      "KAVERO_DEPLOYMENT_PROFILE",
      "KAVERO_AUTH_MODE",
      "KAVERO_STORAGE_PROVIDER",
      "KAVERO_MANAGED_STORAGE_BACKEND",
      "KAVERO_LOCAL_STORAGE_ROOT",
    ];
  }

  return [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "NEXT_PUBLIC_SITE_URL",
    "KAVERO_DEPLOYMENT_PROFILE",
    "KAVERO_AUTH_MODE",
  ];
}
