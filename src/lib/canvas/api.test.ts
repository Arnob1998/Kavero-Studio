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

  it("allows Cloud users with connected Drive without checking a subscription plan", async () => {
    const admin = adminClient("active");
    mocks.createAdminClient.mockReturnValueOnce(admin);

    const result = await requireCanvasAccess("user-1");

    expect(result).toMatchObject({
      access: {
        deploymentProfile: "cloud",
        driveConnected: true,
        allowed: true,
      },
      response: null,
    });
    expect(admin.from).not.toHaveBeenCalledWith("user_metadata");
  });

  it("keeps the Cloud Drive connection requirement", async () => {
    mocks.createAdminClient.mockReturnValueOnce(adminClient(null));

    const result = await requireCanvasAccess("user-1");

    expect(result.access).toMatchObject({
      deploymentProfile: "cloud",
      driveConnected: false,
      driveReconnectRequired: false,
      allowed: false,
    });
    expect(result.response?.status).toBe(403);
    await expect(result.response?.json()).resolves.toEqual({
      error: "Connect Google Drive to use Canvas.",
    });
  });

  it("keeps the Cloud Drive reconnect message", async () => {
    mocks.createAdminClient.mockReturnValueOnce(adminClient("reconnect_required"));

    const result = await requireCanvasAccess("user-1");

    expect(result.access).toMatchObject({
      deploymentProfile: "cloud",
      driveConnected: false,
      driveReconnectRequired: true,
      allowed: false,
    });
    await expect(result.response?.json()).resolves.toEqual({
      error: "Reconnect Google Drive to use Canvas.",
    });
  });

  it("allows Local-first users without Google Drive", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mocks.createAdminClient.mockReturnValueOnce(adminClient(null));

    const access = await getCanvasAccess("user-1");

    expect(access).toMatchObject({
      deploymentProfile: "local-first",
      driveConnected: false,
      allowed: true,
    });
  });

  it("defaults invalid profiles to Cloud and does not infer Local-first from storage envs", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "LOCAL-FIRST");
    vi.stubEnv("KAVERO_STORAGE_PROVIDER", "kavero-managed");
    mocks.createAdminClient.mockReturnValueOnce(adminClient(null));

    const result = await requireCanvasAccess("user-1");

    expect(result.access).toMatchObject({
      deploymentProfile: "cloud",
      driveConnected: false,
      allowed: false,
    });
    await expect(result.response?.json()).resolves.toEqual({
      error: "Connect Google Drive to use Canvas.",
    });
  });
});

function adminClient(driveStatus: string | null) {
  return {
    from: vi.fn((table: string) => {
      if (table !== "user_drive_connections") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return queryFor(driveStatus ? { status: driveStatus } : null);
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
