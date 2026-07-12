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

  it.each([
    [
      "azure-openai",
      {
        apiKey: "azure-key-012345678901234567890",
        apiBase: "https://kavero.openai.azure.com",
        apiVersion: "2025-04-01-preview",
      },
    ],
    ["openai-compatible", { apiBase: "https://models.example.com/v1" }],
  ])("returns safe validation-only metadata for %s", async (providerId, credentials) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(checkCredentialsRequest(providerId, credentials));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: "validation_only", check: "not_implemented" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain("azure-key");
    expect(JSON.stringify(body)).not.toContain("models.example.com");
    expect(JSON.stringify(body)).not.toContain("kavero.openai.azure.com");
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
