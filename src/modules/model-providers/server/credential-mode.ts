export const modelGatewayCredentialModes = [
  "env-or-user",
  "user-required",
  "env-only",
] as const;

export type ModelGatewayCredentialMode = (typeof modelGatewayCredentialModes)[number];

export type ModelGatewayCredentialModeEnv = {
  KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE?: string | undefined;
};

export function getModelGatewayCredentialMode(
  env: ModelGatewayCredentialModeEnv = process.env as ModelGatewayCredentialModeEnv,
): ModelGatewayCredentialMode {
  const value = env.KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE?.trim();

  return modelGatewayCredentialModes.includes(value as ModelGatewayCredentialMode)
    ? (value as ModelGatewayCredentialMode)
    : "env-or-user";
}
