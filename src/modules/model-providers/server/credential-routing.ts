import { type ProviderCredentials, type SupportedProviderId } from "@/lib/provider-key-registry";
import { getUserProviderCredentials } from "@/lib/provider-keys";
import { getModelCatalogEntry } from "../catalog";
import { validateModelAliasForSlot } from "../preferences";
import { getProviderKeyIdForModelProvider } from "../provider-key-mapping";
import type { ModelCapabilitySlot, ModelProviderId } from "../types";
import {
  getModelGatewayCredentialMode,
  type ModelGatewayCredentialMode,
} from "./credential-mode";
import { getAzureOpenAiEnvCredentials, type AzureOpenAiEnv } from "./azure-routing";

export { getProviderKeyIdForModelProvider } from "../provider-key-mapping";

export type CredentialResolutionErrorCode =
  | "unknown-alias"
  | "wrong-slot"
  | "unsupported-provider"
  | "missing-credentials"
  | "credential-load-failed";

type CredentialResolutionContext = {
  modelAlias: string;
  slot: ModelCapabilitySlot;
  provider: ModelProviderId | null;
  providerKeyId: SupportedProviderId | null;
};

export type UserByokCredentialResolution = CredentialResolutionContext & {
  ok: true;
  status: "resolved";
  credentialSource: "user-byok";
  credentials: ProviderCredentials;
};

export type GatewayEnvCredentialResolution = CredentialResolutionContext & {
  ok: true;
  status: "resolved";
  credentialSource: "gateway-env";
  credentials: ProviderCredentials | null;
};

export type FailedCredentialResolution = CredentialResolutionContext & {
  ok: false;
  status: "error";
  credentialSource: null;
  code: CredentialResolutionErrorCode;
  message: string;
};

export type ModelCredentialResolution =
  | UserByokCredentialResolution
  | GatewayEnvCredentialResolution
  | FailedCredentialResolution;

export type SafeModelCredentialResolution =
  | (Omit<UserByokCredentialResolution, "credentials"> & { hasCredentials: true })
  | (Omit<GatewayEnvCredentialResolution, "credentials"> & { hasCredentials: boolean })
  | FailedCredentialResolution;

type ResolveModelCredentialsInput = {
  userId: string;
  modelAlias: string;
  slot: ModelCapabilitySlot;
  credentialMode?: ModelGatewayCredentialMode;
};

type ResolveModelCredentialsDependencies = {
  getUserProviderCredentials: typeof getUserProviderCredentials;
  env?: AzureOpenAiEnv;
};

const defaultDependencies: ResolveModelCredentialsDependencies = {
  getUserProviderCredentials,
};

export async function resolveModelCredentials(
  input: ResolveModelCredentialsInput,
  dependencies: ResolveModelCredentialsDependencies = defaultDependencies,
): Promise<ModelCredentialResolution> {
  const entry = getModelCatalogEntry(input.modelAlias);
  if (!entry) {
    return failure(input, null, null, "unknown-alias", "Unknown model alias.");
  }

  const validation = validateModelAliasForSlot(input.modelAlias, input.slot);
  if (!validation.ok) {
    return failure(input, entry.provider, null, validation.code, validation.message);
  }

  const providerKeyId = getProviderKeyIdForModelProvider(entry.provider);
  const credentialMode = input.credentialMode ?? getModelGatewayCredentialMode();
  const context = {
    modelAlias: input.modelAlias,
    slot: input.slot,
    provider: entry.provider,
    providerKeyId,
  };

  if (credentialMode === "env-only") {
    return gatewayEnvOrFailure(input, context, dependencies.env);
  }

  if (!providerKeyId) {
    return credentialMode === "env-or-user"
      ? gatewayEnv(context)
      : failure(
          input,
          entry.provider,
          null,
          "unsupported-provider",
          "The selected provider does not support user credentials.",
        );
  }

  let credentials: ProviderCredentials | null;
  try {
    credentials = await dependencies.getUserProviderCredentials(input.userId, providerKeyId);
  } catch {
    return failure(
      input,
      entry.provider,
      providerKeyId,
      "credential-load-failed",
      "Unable to resolve provider credentials.",
    );
  }

  if (credentials) {
    return {
      ...context,
      ok: true,
      status: "resolved",
      credentialSource: "user-byok",
      credentials,
    };
  }

  return credentialMode === "env-or-user"
    ? gatewayEnvOrFailure(input, context, dependencies.env)
    : failure(
        input,
        entry.provider,
        providerKeyId,
        "missing-credentials",
        "User provider credentials are required for the selected model.",
      );
}

export function toSafeModelCredentialResolution(
  resolution: ModelCredentialResolution,
): SafeModelCredentialResolution {
  if (resolution.ok && resolution.credentialSource === "user-byok") {
    const { credentials: _credentials, ...safe } = resolution;
    return { ...safe, hasCredentials: true };
  }

  if (resolution.ok && resolution.credentialSource === "gateway-env") {
    const { credentials: _credentials, ...safe } = resolution;
    return { ...safe, hasCredentials: Boolean(resolution.credentials) };
  }

  return resolution;
}

function gatewayEnv(
  context: CredentialResolutionContext,
  credentials: ProviderCredentials | null = null,
): GatewayEnvCredentialResolution {
  return {
    ...context,
    ok: true,
    status: "resolved",
    credentialSource: "gateway-env",
    credentials,
  };
}

function gatewayEnvOrFailure(
  input: Pick<ResolveModelCredentialsInput, "modelAlias" | "slot">,
  context: CredentialResolutionContext,
  env?: AzureOpenAiEnv,
): GatewayEnvCredentialResolution | FailedCredentialResolution {
  if (context.providerKeyId !== "azure-openai") return gatewayEnv(context);

  const credentials = getAzureOpenAiEnvCredentials(env);
  return credentials
    ? gatewayEnv(context, credentials)
    : failure(
        input,
        context.provider,
        context.providerKeyId,
        "missing-credentials",
        "Complete Azure OpenAI environment credentials are required.",
      );
}

function failure(
  input: Pick<ResolveModelCredentialsInput, "modelAlias" | "slot">,
  provider: ModelProviderId | null,
  providerKeyId: SupportedProviderId | null,
  code: CredentialResolutionErrorCode,
  message: string,
): FailedCredentialResolution {
  return {
    ok: false,
    status: "error",
    credentialSource: null,
    code,
    message,
    modelAlias: input.modelAlias,
    slot: input.slot,
    provider,
    providerKeyId,
  };
}
