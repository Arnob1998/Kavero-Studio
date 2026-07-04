export const authModes = ["google", "password", "google-password"] as const;

export type AuthMode = (typeof authModes)[number];

export type AuthModeEnv = {
  KAVERO_AUTH_MODE?: string | undefined;
};

export type AuthModeConfig = {
  mode: AuthMode;
  googleEnabled: boolean;
  passwordEnabled: boolean;
};

export const defaultAuthMode: AuthMode = "google";

export function isAuthMode(value: unknown): value is AuthMode {
  return typeof value === "string" && authModes.includes(value as AuthMode);
}

export function getAuthModeConfigFromEnv(env: AuthModeEnv): AuthModeConfig {
  const rawMode = env.KAVERO_AUTH_MODE?.trim();
  const mode = isAuthMode(rawMode) ? rawMode : defaultAuthMode;

  return {
    mode,
    googleEnabled: mode === "google" || mode === "google-password",
    passwordEnabled: mode === "password" || mode === "google-password",
  };
}

export function getAuthModeConfig() {
  return getAuthModeConfigFromEnv({
    KAVERO_AUTH_MODE: process.env.KAVERO_AUTH_MODE,
  });
}
