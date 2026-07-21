export const modelProviderIds = ["gemini", "openai", "groq", "ollama", "azure-openai"] as const;

export type ModelProviderId = (typeof modelProviderIds)[number];

export const modelCapabilitySlots = ["chatOrchestration", "imageGeneration"] as const;

export type ModelCapabilitySlot = (typeof modelCapabilitySlots)[number];

export type ModelRequirement = "provider-key" | "local-runtime";

export type ModelCapabilities = {
  slots: readonly ModelCapabilitySlot[];
  supportsTools: boolean;
  supportsStructuredJson: boolean;
  supportsMultimodalImageInput: boolean;
  supportsImageOutput: boolean;
  supportsStreaming: boolean;
  requirements: readonly ModelRequirement[];
};

export type ModelCatalogEntry = {
  provider: ModelProviderId;
  model: string;
  modelAlias: string;
  displayLabel: string;
  capabilities: ModelCapabilities;
};

export type ModelGatewayName = "litellm";

export type ModelGatewayConfig =
  | {
      status: "disabled";
      gateway: null;
      reason: "not-configured";
    }
  | {
      status: "configured";
      gateway: "litellm";
      baseUrl: string;
      apiKey: string;
      routingSecret: string;
    }
  | {
      status: "error";
      gateway: ModelGatewayName | null;
      issues: readonly GatewayConfigIssue[];
    };

export type GatewayConfigIssueCode =
  | "unsupported-gateway"
  | "missing-base-url"
  | "invalid-base-url"
  | "missing-api-key"
  | "missing-routing-secret"
  | "invalid-routing-secret"
  | "public-env-exposure";

export type GatewayConfigIssue = {
  code: GatewayConfigIssueCode;
  key?: string;
  message: string;
};

export type ModelGatewayUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  imageCount: number | null;
  estimatedCost: number | null;
};

export type ModelGatewayErrorCode =
  | "configuration_error"
  | "network_error"
  | "authentication_error"
  | "rate_limited"
  | "provider_error"
  | "invalid_response";

export type ModelGatewayErrorDetails = {
  status: number | null;
  errorCode: ModelGatewayErrorCode;
  message: string;
  provider: ModelProviderId | null;
  model: string | null;
  modelAlias: string | null;
  gateway: "litellm";
  requestId: string | null;
  callId: string | null;
  retryable: boolean;
};

export class ModelGatewayError extends Error {
  details: ModelGatewayErrorDetails;

  constructor(details: ModelGatewayErrorDetails) {
    super(details.message);
    this.name = "ModelGatewayError";
    this.details = details;
  }
}

export type ModelGatewayEventStatus = "success" | "error";

export type ModelGatewayCredentialSource =
  | "user-byok"
  | "gateway-env"
  | "direct-gemini"
  | "mock";

export type ModelGatewayEvent = {
  userId: string | null;
  feature: string;
  slot: ModelCapabilitySlot | null;
  provider: ModelProviderId | null;
  model: string | null;
  modelAlias: string;
  requestId: string | null;
  callId: string | null;
  status: ModelGatewayEventStatus;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  imageCount: number | null;
  estimatedCost: number | null;
  errorCode: string | null;
  gateway: "litellm" | "direct-gemini" | "mock";
  credentialSource: ModelGatewayCredentialSource;
};

export type LiteLlmFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type LiteLlmClientOptions = {
  config: Extract<ModelGatewayConfig, { status: "configured" }>;
  fetchImpl?: LiteLlmFetch;
  now?: () => number;
};

export type LiteLlmResponseMetadata = {
  requestId: string | null;
  callId: string | null;
  usage: ModelGatewayUsage;
};

export type LiteLlmJsonResponse<TData> = LiteLlmResponseMetadata & {
  data: TData;
};
