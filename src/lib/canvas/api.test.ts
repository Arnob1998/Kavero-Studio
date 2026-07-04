import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { getCanvasAccess, requireCanvasAccess } from "./api";

describe("canvas access policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("denies Cloud/default free users with the existing premium message", async () => {
    mocks.createAdminClient.mockReturnValueOnce(adminClient({ plan: "free", driveStatus: "active" }));

    const result = await requireCanvasAccess("user-1");

    expect(result.access).toMatchObject({
      deploymentProfile: "cloud",
      plan: "free",
      driveConnected: true,
      allowed: false,
    });
    expect(result.response?.status).toBe(403);
    await expect(result.response?.json()).resolves.toEqual({
      error: "Canvas is available on the premium plan.",
    });
  });

  it("denies Cloud/default premium users without active Google Drive", async () => {
    mocks.createAdminClient.mockReturnValueOnce(adminClient({ plan: "premium", driveStatus: null }));

    const result = await requireCanvasAccess("user-1");

    expect(result.access).toMatchObject({
      deploymentProfile: "cloud",
      plan: "premium",
      driveConnected: false,
      driveReconnectRequired: false,
      allowed: false,
    });
    expect(result.response?.status).toBe(403);
    await expect(result.response?.json()).resolves.toEqual({
      error: "Connect Google Drive to use Canvas.",
    });
  });

  it("allows Cloud/default premium users with active Google Drive", async () => {
    mocks.createAdminClient.mockReturnValueOnce(adminClient({ plan: "premium", driveStatus: "active" }));

    const result = await requireCanvasAccess("user-1");

    expect(result).toMatchObject({
      access: {
        deploymentProfile: "cloud",
        plan: "premium",
        driveConnected: true,
        allowed: true,
      },
      response: null,
    });
  });

  it("keeps the Cloud/default reconnect message for premium users with reconnect-required Drive", async () => {
    mocks.createAdminClient.mockReturnValueOnce(
      adminClient({ plan: "premium", driveStatus: "reconnect_required" }),
    );

    const result = await requireCanvasAccess("user-1");

    expect(result.access).toMatchObject({
      deploymentProfile: "cloud",
      plan: "premium",
      driveConnected: false,
      driveReconnectRequired: true,
      allowed: false,
    });
    expect(result.response?.status).toBe(403);
    await expect(result.response?.json()).resolves.toEqual({
      error: "Reconnect Google Drive to use Canvas.",
    });
  });

  it("allows Local-first free users without Google Drive", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mocks.createAdminClient.mockReturnValueOnce(adminClient({ plan: "free", driveStatus: null }));

    const access = await getCanvasAccess("user-1");

    expect(access).toMatchObject({
      deploymentProfile: "local-first",
      plan: "free",
      driveConnected: false,
      driveReconnectRequired: false,
      allowed: true,
    });
  });

  it("allows Local-first premium users without Google Drive", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mocks.createAdminClient.mockReturnValueOnce(adminClient({ plan: "premium", driveStatus: null }));

    const result = await requireCanvasAccess("user-1");

    expect(result).toMatchObject({
      access: {
        deploymentProfile: "local-first",
        plan: "premium",
        driveConnected: false,
        allowed: true,
      },
      response: null,
    });
  });

  it("defaults invalid profiles to Cloud and does not infer Local-first from storage envs", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "LOCAL-FIRST");
    vi.stubEnv("KAVERO_AUTH_MODE", "password");
    vi.stubEnv("KAVERO_STORAGE_PROVIDER", "kavero-managed");
    vi.stubEnv("KAVERO_MANAGED_STORAGE_BACKEND", "local-filesystem");
    vi.stubEnv("KAVERO_LOCAL_STORAGE_ROOT", "C:\\kavero-storage");
    mocks.createAdminClient.mockReturnValueOnce(adminClient({ plan: "free", driveStatus: null }));

    const result = await requireCanvasAccess("user-1");

    expect(result.access).toMatchObject({
      deploymentProfile: "cloud",
      plan: "free",
      driveConnected: false,
      allowed: false,
    });
    await expect(result.response?.json()).resolves.toEqual({
      error: "Canvas is available on the premium plan.",
    });
  });
});

function adminClient({
  plan,
  driveStatus,
}: {
  plan: string | null;
  driveStatus: string | null;
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "user_metadata") {
        return queryFor({ plan });
      }
      if (table === "user_drive_connections") {
        return queryFor(driveStatus ? { status: driveStatus } : null);
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function queryFor(data: Record<string, unknown> | null) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  return query;
}
