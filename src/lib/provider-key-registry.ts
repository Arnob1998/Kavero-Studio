import { z } from "zod";

export const supportedProviderIds = [
  "google-gemini",
  "openai",
  "groq",
  "azure-openai",
  "openai-compatible",
] as const;

export type SupportedProviderId = (typeof supportedProviderIds)[number];

export type ProviderCredentialsMap = {
  "google-gemini": { apiKey: string };
  openai: { apiKey: string };
  groq: { apiKey: string };
  "azure-openai": {
    apiKey: string;
    apiBase: string;
    apiVersion: string;
    deploymentName: string;
    baseModel: AzureOpenAiBaseModel;
  };
  "openai-compatible": { apiKey?: string; apiBase: string };
};

export type ProviderCredentials = ProviderCredentialsMap[SupportedProviderId];

export type ProviderKeyRegistryEntry = {
  id: SupportedProviderId;
  label: string;
  credentialFields: Array<{
    id: "apiKey" | "apiBase" | "apiVersion" | "deploymentName" | "baseModel";
    required: boolean;
    secret: boolean;
  }>;
  storageFormat: "raw-api-key" | "json";
  checkMode: "live" | "validation-only";
};

export type BrowserProviderKeyCatalogEntry = {
  id: SupportedProviderId;
  label: string;
  logoPath: string;
  checkMode: "live" | "validation-only";
  credentialFields: Array<{
    id: "apiKey" | "apiBase" | "apiVersion" | "deploymentName" | "baseModel";
    label: string;
    required: boolean;
    secret: boolean;
    inputType: "password" | "url" | "text" | "select";
    options?: Array<{ value: string; label: string }>;
  }>;
};

export const providerKeyRegistry: Record<SupportedProviderId, ProviderKeyRegistryEntry> = {
  "google-gemini": {
    id: "google-gemini",
    label: "Google Gemini",
    credentialFields: [{ id: "apiKey", required: true, secret: true }],
    storageFormat: "raw-api-key",
    checkMode: "live",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    credentialFields: [{ id: "apiKey", required: true, secret: true }],
    storageFormat: "raw-api-key",
    checkMode: "live",
  },
  groq: {
    id: "groq",
    label: "Groq",
    credentialFields: [{ id: "apiKey", required: true, secret: true }],
    storageFormat: "raw-api-key",
    checkMode: "live",
  },
  "azure-openai": {
    id: "azure-openai",
    label: "Azure OpenAI",
    credentialFields: [
      { id: "apiKey", required: true, secret: true },
      { id: "apiBase", required: true, secret: false },
      { id: "apiVersion", required: true, secret: false },
      { id: "deploymentName", required: true, secret: false },
      { id: "baseModel", required: true, secret: false },
    ],
    storageFormat: "json",
    checkMode: "live",
  },
  "openai-compatible": {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    credentialFields: [
      { id: "apiKey", required: false, secret: true },
      { id: "apiBase", required: true, secret: false },
    ],
    storageFormat: "json",
    checkMode: "validation-only",
  },
};

const providerLogoPaths: Record<SupportedProviderId, string> = {
  "google-gemini": "/llm-providers/google-gemini-icon.png",
  openai: "/llm-providers/openai.png",
  groq: "/llm-providers/grok-icon.png",
  "azure-openai": "/llm-providers/Microsoft_Azure.svg",
  "openai-compatible": "/llm-providers/openai.png",
};

const credentialFieldLabels = {
  apiKey: "API key",
  apiBase: "API base URL",
  apiVersion: "API version",
  deploymentName: "Deployment name",
  baseModel: "Model family",
} as const;

export const azureOpenAiBaseModels = ["gpt-4o", "gpt-4.1", "gpt-5"] as const;
export type AzureOpenAiBaseModel = (typeof azureOpenAiBaseModels)[number];

const azureBaseModelLabels: Record<AzureOpenAiBaseModel, string> = {
  "gpt-4o": "GPT-4o family",
  "gpt-4.1": "GPT-4.1 family",
  "gpt-5": "GPT-5 family",
};

export function getBrowserProviderKeyCatalog(): BrowserProviderKeyCatalogEntry[] {
  return supportedProviderIds.map((providerId) => {
    const entry = providerKeyRegistry[providerId];

    return {
      id: entry.id,
      label: entry.label,
      logoPath: providerLogoPaths[providerId],
      checkMode: entry.checkMode,
      credentialFields: entry.credentialFields.map((field) => ({
        ...field,
        label:
          providerId === "azure-openai" && field.id === "apiBase"
            ? "Azure endpoint"
            : credentialFieldLabels[field.id],
        inputType: field.secret
          ? "password"
          : field.id === "apiBase"
            ? "url"
            : field.id === "baseModel"
              ? "select"
              : "text",
        ...(field.id === "baseModel"
          ? {
              options: azureOpenAiBaseModels.map((value) => ({
                value,
                label: azureBaseModelLabels[value],
              })),
            }
          : {}),
      })),
    };
  });
}

const apiKeySchema = z.string().trim().min(20).max(4000);
const apiVersionSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/);
const deploymentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
const azureBaseModelSchema = z.enum(azureOpenAiBaseModels);
const apiBaseSchema = z.string().trim().max(2048).transform((value, context) => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    context.addIssue({ code: "custom", message: "Invalid API base URL." });
    return z.NEVER;
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    !isPublicHostname(url.hostname)
  ) {
    context.addIssue({ code: "custom", message: "Invalid API base URL." });
    return z.NEVER;
  }

  url.search = "";
  return url.toString().replace(/\/$/, "");
});
const azureApiBaseSchema = apiBaseSchema.transform((value, context) => {
  const url = new URL(value);
  if (url.pathname !== "/" || !url.hostname.toLowerCase().endsWith(".openai.azure.com")) {
    context.addIssue({ code: "custom", message: "Invalid Azure endpoint." });
    return z.NEVER;
  }
  return url.origin;
});

const credentialSchemas = {
  "google-gemini": z.object({ apiKey: apiKeySchema }).strict(),
  openai: z.object({ apiKey: apiKeySchema }).strict(),
  groq: z.object({ apiKey: apiKeySchema }).strict(),
  "azure-openai": z
    .object({
      apiKey: apiKeySchema,
      apiBase: azureApiBaseSchema,
      apiVersion: apiVersionSchema,
      deploymentName: deploymentNameSchema,
      baseModel: azureBaseModelSchema,
    })
    .strict(),
  "openai-compatible": z
    .object({ apiKey: apiKeySchema.optional(), apiBase: apiBaseSchema })
    .strict()
    .transform((credentials) => ({
      ...credentials,
      ...(credentials.apiKey ? { apiKey: credentials.apiKey } : {}),
    })),
} satisfies Record<SupportedProviderId, z.ZodType>;

export function isSupportedProviderId(value: unknown): value is SupportedProviderId {
  return typeof value === "string" && supportedProviderIds.includes(value as SupportedProviderId);
}

export function parseProviderCredentials<T extends SupportedProviderId>(
  providerId: T,
  value: unknown,
): ProviderCredentialsMap[T] | null {
  const parsed = credentialSchemas[providerId].safeParse(value);
  return parsed.success ? (parsed.data as ProviderCredentialsMap[T]) : null;
}

export function parseProviderCredentialPayload(value: unknown):
  | { providerId: SupportedProviderId; credentials: ProviderCredentials }
  | null {
  if (!value || typeof value !== "object") return null;

  const payload = value as Record<string, unknown>;
  if (!isSupportedProviderId(payload.providerId)) return null;

  const credentialInput =
    payload.credentials && typeof payload.credentials === "object"
      ? payload.credentials
      : { apiKey: payload.apiKey };
  const credentials = parseProviderCredentials(payload.providerId, credentialInput);

  return credentials ? { providerId: payload.providerId, credentials } : null;
}

export function serializeProviderCredentials<T extends SupportedProviderId>(
  providerId: T,
  credentials: ProviderCredentialsMap[T],
) {
  if (providerKeyRegistry[providerId].storageFormat === "raw-api-key") {
    return (credentials as { apiKey: string }).apiKey;
  }

  return JSON.stringify(credentials);
}

export function deserializeProviderCredentials<T extends SupportedProviderId>(
  providerId: T,
  secret: string,
): ProviderCredentialsMap[T] | null {
  if (providerKeyRegistry[providerId].storageFormat === "raw-api-key") {
    return parseProviderCredentials(providerId, { apiKey: secret });
  }

  try {
    return parseProviderCredentials(providerId, JSON.parse(secret));
  } catch {
    return null;
  }
}

export function getProviderKeyHint(credentials: ProviderCredentials) {
  const apiKey = "apiKey" in credentials ? credentials.apiKey : undefined;
  return apiKey ? `...${apiKey.slice(-4)}` : "Configured";
}

function isPublicHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  ) {
    return false;
  }

  if (normalized === "::1" || normalized === "[::1]" || normalized.startsWith("fe80:")) {
    return false;
  }

  const octets = normalized.split(".").map(Number);
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    const [first, second] = octets;
    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }

  return normalized.includes(".");
}
