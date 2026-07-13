import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { GET, POST } from "./route";

describe("/api/provider-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires auth for listing", async () => {
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: null }));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });

  it("lists existing provider keys without secret material", async () => {
    const providerKeys = [
      providerKeyRow(),
      { ...providerKeyRow(), id: "key-2", provider_id: "openai", provider_label: "OpenAI" },
      { ...providerKeyRow(), id: "key-3", provider_id: "groq", provider_label: "Groq" },
    ];
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: { id: "user-1" } }));
    mocks.createAdminClient.mockReturnValue(createAdminClient({ providerKeys }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providerKeys).toEqual(providerKeys);
    expect(body.providers.map((provider: { id: string }) => provider.id)).toEqual([
      "google-gemini",
      "openai",
      "groq",
      "azure-openai",
      "openai-compatible",
    ]);
    expect(body.providers.find((provider: { id: string }) => provider.id === "azure-openai")).toMatchObject({
      checkMode: "live",
      credentialFields: [
        { id: "apiKey", secret: true, inputType: "password" },
        { id: "apiBase", secret: false, inputType: "url" },
        { id: "apiVersion", secret: false, inputType: "text" },
        { id: "deploymentName", secret: false, inputType: "text" },
        { id: "baseModel", secret: false, inputType: "select", options: expect.any(Array) },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(JSON.stringify(body)).not.toContain("AIza");
    expect(JSON.stringify(body)).not.toContain("api_base");
    expect(JSON.stringify(body)).not.toContain("storageFormat");
  });

  it("keeps google-gemini save behavior compatible", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        id: "key-1",
        provider_id: "google-gemini",
        provider_label: "Google Gemini",
        key_hint: "...1234",
        status: "active",
        last_checked_at: null,
        updated_at: "2026-07-05T00:00:00.000Z",
      },
      error: null,
    }));
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: { id: "user-1" } }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(
      new Request("http://localhost/api/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "google-gemini",
          apiKey: "AIzaSy0123456789012345678901234",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("upsert_provider_key", {
      p_user_id: "user-1",
      p_provider_id: "google-gemini",
      p_secret: "AIzaSy0123456789012345678901234",
      p_key_hint: "...1234",
    });
    expect(body).toEqual({
      providerKey: {
        id: "key-1",
        providerId: "google-gemini",
        providerLabel: "Google Gemini",
        keyHint: "...1234",
        status: "active",
        lastCheckedAt: null,
        updatedAt: "2026-07-05T00:00:00.000Z",
      },
    });
  });

  it.each([
    ["openai", { apiKey: "sk-openai-012345678901234567890" }, "sk-openai-012345678901234567890", "...7890"],
    ["groq", { apiKey: "gsk_groq_012345678901234567890" }, "gsk_groq_012345678901234567890", "...7890"],
  ])("saves and validates %s credentials", async (providerId, credentials, expectedSecret, keyHint) => {
    const rpc = createUpsertRpc(providerId, keyHint);
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: { id: "user-1" } }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(providerRequest(providerId, credentials));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("upsert_provider_key", {
      p_user_id: "user-1",
      p_provider_id: providerId,
      p_secret: expectedSecret,
      p_key_hint: keyHint,
    });
    expect(JSON.stringify(body)).not.toContain(expectedSecret);
  });

  it("stores Azure OpenAI multi-field credentials as encrypted JSON text", async () => {
    const rpc = createUpsertRpc("azure-openai", "...7890");
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: { id: "user-1" } }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const credentials = {
      apiKey: "azure-key-012345678901234567890",
      apiBase: "https://kavero.openai.azure.com/",
      apiVersion: "2025-04-01-preview",
      deploymentName: "deployment-one",
      baseModel: "gpt-4.1",
    };
    const response = await POST(providerRequest("azure-openai", credentials));
    const body = await response.json();
    const rpcPayload = rpc.mock.calls[0]![1] as { p_secret: string };

    expect(response.status).toBe(200);
    expect(JSON.parse(rpcPayload.p_secret)).toEqual({ ...credentials, apiBase: "https://kavero.openai.azure.com" });
    expect(JSON.stringify(body)).not.toContain(credentials.apiKey);
    expect(JSON.stringify(body)).not.toContain(credentials.apiBase);
    expect(JSON.stringify(body)).not.toContain(credentials.apiVersion);
    expect(JSON.stringify(body)).not.toContain(credentials.deploymentName);
  });

  it("accepts an OpenAI-compatible public base URL without requiring an API key", async () => {
    const rpc = createUpsertRpc("openai-compatible", "Configured");
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: { id: "user-1" } }));
    mocks.createAdminClient.mockReturnValue({ rpc });

    const response = await POST(
      providerRequest("openai-compatible", { apiBase: "https://models.example.com/v1" }),
    );

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("upsert_provider_key", {
      p_user_id: "user-1",
      p_provider_id: "openai-compatible",
      p_secret: JSON.stringify({ apiBase: "https://models.example.com/v1" }),
      p_key_hint: "Configured",
    });
  });

  it.each([
    ["anthropic", { apiKey: "sk-0123456789012345678901234" }],
    ["azure-openai", { apiKey: "azure-key-012345678901234567890", apiBase: "https://example.com" }],
    ["openai-compatible", { apiBase: "http://127.0.0.1:11434/v1" }],
  ])("rejects unsupported providers or invalid credential shapes", async (providerId, credentials) => {
    const response = await POST(
      providerRequest(providerId, credentials),
    );

    expect(response.status).toBe(400);
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
  });
});

function createSupabaseClient(options: { user: { id: string } | null }) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: options.user }, error: null })),
    },
  };
}

function providerRequest(providerId: string, credentials: Record<string, string>) {
  return new Request("http://localhost/api/provider-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ providerId, credentials }),
  });
}

function createUpsertRpc(providerId: string, keyHint: string) {
  return vi.fn(async (_name: string, _payload: Record<string, unknown>) => ({
    data: {
      id: `key-${providerId}`,
      provider_id: providerId,
      provider_label: providerId,
      key_hint: keyHint,
      status: "active",
      last_checked_at: null,
      updated_at: "2026-07-10T00:00:00.000Z",
    },
    error: null,
  }));
}

function createAdminClient(options: { providerKeys: unknown[] }) {
  return {
    from: vi.fn((table: string) => {
      if (table !== "user_provider_keys") throw new Error(`Unexpected table: ${table}`);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        order: vi.fn(async () => ({ data: options.providerKeys, error: null })),
      };
      return query;
    }),
  };
}

function providerKeyRow() {
  return {
    id: "key-1",
    provider_id: "google-gemini",
    provider_label: "Google Gemini",
    key_hint: "...1234",
    status: "active",
    last_checked_at: null,
    created_at: "2026-07-05T00:00:00.000Z",
    updated_at: "2026-07-05T00:00:00.000Z",
  };
}
