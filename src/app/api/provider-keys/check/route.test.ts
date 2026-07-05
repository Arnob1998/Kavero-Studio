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

function createSupabaseClient(options: { user: { id: string } | null }) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: options.user }, error: null })),
    },
  };
}
