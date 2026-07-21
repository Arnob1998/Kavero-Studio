import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { POST } from "./route";

describe("/api/provider-keys/check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: { id: "user-1" } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("requires auth", async () => {
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: null }));

    const response = await POST(checkRequest("AIzaSy0123456789012345678901234"));

    expect(response.status).toBe(401);
  });

  it("checks a Gemini key server-side without returning key material", async () => {
    const apiKey = "AIzaSy0123456789012345678901234";
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ models: [] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(checkRequest(apiKey));
    const body = await response.json();
    const firstCall = fetchMock.mock.calls[0]!;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "passed" });
    expect(String(firstCall[0])).toContain("generativelanguage.googleapis.com");
    expect(String(firstCall[0])).toContain(encodeURIComponent(apiKey));
    expect(JSON.stringify(body)).not.toContain(apiKey);
  });

  it("returns a safe failure without exposing the key", async () => {
    const apiKey = "AIzaSy0123456789012345678901234";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { message: apiKey } }), { status: 403 })),
    );

    const response = await POST(checkRequest(apiKey));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "failed",
      code: "authentication_error",
      message: "Gemini key check failed.",
    });
    expect(JSON.stringify(body)).not.toContain(apiKey);
  });

  it.each([
    ["openai", "sk-openai-012345678901234567890", "https://api.openai.com/v1/models"],
    ["groq", "gsk_groq_012345678901234567890", "https://api.groq.com/openai/v1/models"],
  ])("checks %s through a fixed server-side URL", async (providerId, apiKey, expectedUrl) => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      new Response(null, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(checkCredentialsRequest(providerId, { apiKey }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe("passed");
    expect(String(fetchMock.mock.calls[0]![0])).toBe(expectedUrl);
    expect(JSON.stringify(body)).not.toContain(apiKey);
  });

  it("returns safe validation-only metadata for OpenAI-compatible", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(checkCredentialsRequest("openai-compatible", { apiBase: "https://models.example.com/v1" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "validation_only", check: "not_implemented" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("models.example.com");
  });

  it("runs Azure connectivity through the signed dynamic route without exposing credentials", async () => {
    configureGateway();
    const credentials = azureCredentials();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [], usage: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(checkCredentialsRequest("azure-openai", credentials));
    const body = await response.json();
    const [url, init] = fetchMock.mock.calls[0]!;
    const outbound = JSON.parse(String(init?.body));

    expect(response.status).toBe(200);
    expect(body.status).toBe("passed");
    expect(String(url)).toBe("http://litellm:4000/v1/chat/completions");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer sk-gateway-secret",
      "x-kavero-routing-version": "v1",
      "x-kavero-routing-signature": expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(outbound).toMatchObject({
      model: "kavero-chat-azure-openai",
      user_config: {
        model_list: [{
          model_name: "kavero-chat-azure-openai",
          litellm_params: {
            model: "azure/deployment-one",
            api_key: credentials.apiKey,
            api_base: credentials.apiBase,
            api_version: credentials.apiVersion,
          },
        }],
      },
    });
    expect(JSON.stringify(body)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(body)).not.toContain(credentials.apiBase);
    expect(JSON.stringify(body)).not.toContain(credentials.deploymentName);
  });

  it("returns a safe Azure live-check failure", async () => {
    configureGateway();
    const credentials = azureCredentials();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: credentials }), { status: 401 })));

    const response = await POST(checkCredentialsRequest("azure-openai", credentials));
    const body = await response.json();

    expect(body).toMatchObject({ status: "failed", code: "authentication_error" });
    expect(JSON.stringify(body)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(body)).not.toContain(credentials.apiBase);
    expect(JSON.stringify(body)).not.toContain(credentials.deploymentName);
  });

  it("checks the independent Azure image slot through its validated deployment route", async () => {
    const credentials = azureImageCredentials();
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: [{ b64_json: "aW1hZ2U=" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(checkCredentialsRequest("azure-openai-image", credentials));
    const body = await response.json();
    const [url, init] = fetchMock.mock.calls[0]!;

    expect(body).toMatchObject({ status: "passed" });
    expect(String(url)).toBe(
      "https://images.openai.azure.com/openai/deployments/image-deployment/images/generations?api-version=2024-02-01",
    );
    expect(init).toMatchObject({ method: "POST" });
    expect(init?.headers).toMatchObject({ "api-key": credentials.apiKey });
    expect(JSON.stringify(body)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(body)).not.toContain(credentials.apiBase);
    expect(JSON.stringify(body)).not.toContain(credentials.deploymentName);
  });

  it("rejects a malformed Azure image response without exposing configuration", async () => {
    const credentials = azureImageCredentials();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 })));
    const response = await POST(checkCredentialsRequest("azure-openai-image", credentials));
    const body = await response.json();
    expect(body).toMatchObject({ status: "failed", code: "provider_error" });
    expect(JSON.stringify(body)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(body)).not.toContain(credentials.deploymentName);
  });

  it.each([
    ["unsupported", { apiKey: "sk-0123456789012345678901234" }],
    ["openai-compatible", { apiBase: "http://localhost:11434/v1" }],
    ["azure-openai", { apiKey: "azure-key-012345678901234567890", apiBase: "https://example.com" }],
  ])("rejects unsupported or invalid checks", async (providerId, credentials) => {
    const response = await POST(checkCredentialsRequest(providerId, credentials));
    expect(response.status).toBe(400);
  });
});

function checkRequest(apiKey: string) {
  return new Request("http://localhost/api/provider-keys/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      providerId: "google-gemini",
      apiKey,
    }),
  });
}

function configureGateway() {
  vi.stubEnv("KAVERO_MODEL_GATEWAY", "litellm");
  vi.stubEnv("KAVERO_LITELLM_BASE_URL", "http://litellm:4000");
  vi.stubEnv("KAVERO_LITELLM_API_KEY", "sk-gateway-secret");
  vi.stubEnv("KAVERO_LITELLM_ROUTING_SECRET", "routingSecret_0123456789012345678901234567890123456789");
}

function azureCredentials() {
  return {
    apiKey: "azure-key-012345678901234567890",
    apiBase: "https://kavero.openai.azure.com",
    apiVersion: "2025-04-01-preview",
    deploymentName: "deployment-one",
    baseModel: "gpt-4.1",
  };
}

function azureImageCredentials() {
  return {
    apiKey: "azure-image-key-012345678901234567890",
    apiBase: "https://images.openai.azure.com",
    apiVersion: "2024-02-01",
    deploymentName: "image-deployment",
    baseModel: "gpt-image-2",
  };
}

function checkCredentialsRequest(providerId: string, credentials: Record<string, string>) {
  return new Request("http://localhost/api/provider-keys/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, credentials }),
  });
}

function createSupabaseClient(options: { user: { id: string } | null }) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: options.user }, error: null })),
    },
  };
}
