import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

import { POST } from "./route";

const envKeys = [
  "KAVERO_MODEL_GATEWAY",
  "KAVERO_LITELLM_BASE_URL",
  "KAVERO_LITELLM_API_KEY",
] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

describe("/api/model-providers/connectivity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    for (const key of envKeys) delete process.env[key];
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: { id: "user-1" } }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("requires auth", async () => {
    mocks.createClient.mockResolvedValue(createSupabaseClient({ user: null }));

    const response = await POST();

    expect(response.status).toBe(401);
  });

  it("returns safe disabled and misconfigured statuses without secrets", async () => {
    const disabled = await POST();
    const disabledBody = await disabled.json();
    expect(disabledBody).toMatchObject({
      status: "disabled",
      configured: false,
      checkedBy: "configuration",
      issues: [{ code: "not-configured" }],
    });

    process.env.KAVERO_MODEL_GATEWAY = "litellm";
    process.env.KAVERO_LITELLM_API_KEY = "sk-secret";
    const misconfigured = await POST();
    const misconfiguredBody = await misconfigured.json();

    expect(misconfiguredBody).toMatchObject({
      status: "error",
      configured: false,
      issues: [{ code: "missing-base-url" }],
    });
    expect(JSON.stringify(misconfiguredBody)).not.toContain("KAVERO_LITELLM");
    expect(JSON.stringify(misconfiguredBody)).not.toContain("sk-secret");
  });

  it("checks model info server-side and redacts gateway credentials", async () => {
    process.env.KAVERO_MODEL_GATEWAY = "litellm";
    process.env.KAVERO_LITELLM_BASE_URL = "http://litellm:4000";
    process.env.KAVERO_LITELLM_API_KEY = "sk-secret";
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "configured",
      configured: true,
      checkedBy: "model-info",
      issues: [],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://litellm:4000/model/info",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer sk-secret" }),
      }),
    );
    expect(JSON.stringify(body)).not.toContain("http://litellm:4000");
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });

  it("falls back to model listing when model info is unavailable", async () => {
    process.env.KAVERO_MODEL_GATEWAY = "litellm";
    process.env.KAVERO_LITELLM_BASE_URL = "http://litellm:4000";
    process.env.KAVERO_LITELLM_API_KEY = "sk-secret";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "missing" }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "configured",
      checkedBy: "model-list",
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://litellm:4000/model/info",
      "http://litellm:4000/v1/models",
    ]);
  });
});

function createSupabaseClient(options: { user: { id: string } | null }) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: options.user }, error: null })),
    },
  };
}
