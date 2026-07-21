import {
  createHttpModelGatewayError,
  createModelGatewayError,
  createNetworkModelGatewayError,
} from "./errors";
import { normalizeModelGatewayUsage } from "./usage";
import {
  createRoutingSignature,
  KAVERO_ROUTING_CONTRACT_VERSION,
  KAVERO_ROUTING_HEADER_SIGNATURE,
  KAVERO_ROUTING_HEADER_TIMESTAMP,
  KAVERO_ROUTING_HEADER_VERSION,
} from "./routing-signature";
import {
  ModelGatewayError,
  type LiteLlmClientOptions,
  type LiteLlmJsonResponse,
  type ModelProviderId,
} from "./types";

type RequestContext = {
  provider?: ModelProviderId | null;
  model?: string | null;
  modelAlias?: string | null;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function appendQuery(path: string, query?: Record<string, string | undefined>) {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const queryString = params.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function responseIds(response: Response) {
  return {
    requestId: response.headers.get("x-request-id"),
    callId: response.headers.get("x-litellm-call-id"),
  };
}

export class LiteLlmClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly routingSecret: string;
  private readonly fetchImpl: NonNullable<LiteLlmClientOptions["fetchImpl"]>;
  private readonly now: NonNullable<LiteLlmClientOptions["now"]>;

  constructor(options: LiteLlmClientOptions) {
    this.baseUrl = trimTrailingSlash(options.config.baseUrl);
    this.apiKey = options.config.apiKey;
    this.routingSecret = options.config.routingSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async chatCompletions<TData = unknown>(
    body: Record<string, unknown>,
    context: RequestContext = {},
  ): Promise<LiteLlmJsonResponse<TData>> {
    return this.request<TData>("/v1/chat/completions", {
      method: "POST",
      body,
      context,
    });
  }

  async generateImage<TData = unknown>(
    body: Record<string, unknown>,
    context: RequestContext = {},
  ): Promise<LiteLlmJsonResponse<TData>> {
    return this.request<TData>("/v1/images/generations", {
      method: "POST",
      body,
      context,
    });
  }

  async editImage<TData = unknown>(
    body: Uint8Array,
    contentType: string,
    context: RequestContext = {},
  ): Promise<LiteLlmJsonResponse<TData>> {
    return this.request<TData>("/v1/images/edits", {
      method: "POST",
      rawBody: { bytes: body, contentType },
      context,
    });
  }

  async getModelInfo<TData = unknown>(model?: string): Promise<LiteLlmJsonResponse<TData>> {
    return this.request<TData>(appendQuery("/model/info", { model }), { method: "GET" });
  }

  async listModels<TData = unknown>(): Promise<LiteLlmJsonResponse<TData>> {
    return this.request<TData>("/v1/models", { method: "GET" });
  }

  private async request<TData>(
    path: string,
    options: {
      method: "GET" | "POST";
      body?: Record<string, unknown>;
      rawBody?: { bytes: Uint8Array; contentType: string };
      context?: RequestContext;
    },
  ): Promise<LiteLlmJsonResponse<TData>> {
    const url = `${this.baseUrl}${path}`;
    const pathname = new URL(url).pathname;
    const serializedBody = options.rawBody?.bytes ?? (options.body ? JSON.stringify(options.body) : undefined);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": options.rawBody?.contentType ?? "application/json",
    };

    if (serializedBody !== undefined) {
      const timestamp = Math.floor(this.now() / 1000);
      headers[KAVERO_ROUTING_HEADER_VERSION] = KAVERO_ROUTING_CONTRACT_VERSION;
      headers[KAVERO_ROUTING_HEADER_TIMESTAMP] = String(timestamp);
      headers[KAVERO_ROUTING_HEADER_SIGNATURE] = createRoutingSignature({
        secret: this.routingSecret,
        timestamp,
        method: options.method,
        pathname,
        serializedBody,
      });
    }
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers,
        body: serializedBody as BodyInit | undefined,
      });
    } catch (error) {
      throw createNetworkModelGatewayError(error, options.context);
    }

    const ids = responseIds(response);
    if (!response.ok) {
      throw await createHttpModelGatewayError(response, { ...options.context, ...ids });
    }

    let data: TData;
    try {
      data = (await response.json()) as TData;
    } catch {
      throw createModelGatewayError("LiteLLM returned invalid JSON.", { ...options.context, ...ids }, "invalid_response");
    }

    return {
      data,
      ...ids,
      usage: normalizeModelGatewayUsage(data),
    };
  }
}

export function createLiteLlmClient(options: LiteLlmClientOptions) {
  return new LiteLlmClient(options);
}

export function isModelGatewayError(error: unknown): error is ModelGatewayError {
  return error instanceof ModelGatewayError;
}
