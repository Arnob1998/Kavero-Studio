import {
  createHttpModelGatewayError,
  createModelGatewayError,
  createNetworkModelGatewayError,
} from "./errors";
import { normalizeModelGatewayUsage } from "./usage";
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
  private readonly fetchImpl: NonNullable<LiteLlmClientOptions["fetchImpl"]>;

  constructor(options: LiteLlmClientOptions) {
    this.baseUrl = trimTrailingSlash(options.config.baseUrl);
    this.apiKey = options.config.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
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
      context?: RequestContext;
    },
  ): Promise<LiteLlmJsonResponse<TData>> {
    const url = `${this.baseUrl}${path}`;
    let response: Response;

    try {
      response = await this.fetchImpl(url, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
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
