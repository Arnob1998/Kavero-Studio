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
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: { id: "user-1" } }));
    mocks.createAdminClient.mockReturnValue(createAdminClient({ providerKeys: [providerKeyRow()] }));

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ providerKeys: [providerKeyRow()] });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(JSON.stringify(body)).not.toContain("AIza");
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

  it("continues to reject unsupported providers", async () => {
    const response = await POST(
      new Request("http://localhost/api/provider-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: "openai",
          apiKey: "sk-0123456789012345678901234",
        }),
      }),
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
