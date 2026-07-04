import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  getGoogleDriveAuthorizationUrl: vi.fn(),
  getGoogleDriveAccessTokenForUser: vi.fn(),
  getGoogleDriveRefreshToken: vi.fn(),
  revokeGoogleOAuthToken: vi.fn(),
  normalizeUserPlan: vi.fn(),
  getGenerationLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/google-drive", () => ({
  getGoogleDriveAuthorizationUrl: mocks.getGoogleDriveAuthorizationUrl,
  getGoogleDriveAccessTokenForUser: mocks.getGoogleDriveAccessTokenForUser,
  getGoogleDriveRefreshToken: mocks.getGoogleDriveRefreshToken,
  revokeGoogleOAuthToken: mocks.revokeGoogleOAuthToken,
}));

vi.mock("@/lib/plans", () => ({
  normalizeUserPlan: mocks.normalizeUserPlan,
  getGenerationLimit: mocks.getGenerationLimit,
}));

import { GET as connectGET } from "./connect/route";
import { POST as disconnectPOST } from "./disconnect/route";
import { GET as preflightGET } from "./preflight/route";
import { GET as statusGET } from "./status/route";

type DriveConnection = {
  google_email?: string | null;
  folder_id?: string;
  folder_name?: string;
  scope?: string;
  status?: string;
  folder_status?: string | null;
  connected_at?: string;
  updated_at?: string;
} | null;

type GoogleDriveRouteOptions = {
  user?: { id: string } | null;
  metadata?: { plan?: string | null } | null;
  generationCount?: number | null;
  driveConnection?: DriveConnection;
};

describe("Google Drive Cloud regression routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.getGoogleDriveAuthorizationUrl.mockReturnValue("https://accounts.google.test/oauth?state=state-1");
    mocks.getGoogleDriveAccessTokenForUser.mockResolvedValue("access-token");
    mocks.getGoogleDriveRefreshToken.mockResolvedValue("refresh-token");
    mocks.revokeGoogleOAuthToken.mockResolvedValue(undefined);
    mocks.createAdminClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ error: null }),
    });
    mocks.normalizeUserPlan.mockImplementation((plan?: string | null) =>
      plan === "premium" ? "premium" : "free",
    );
    mocks.getGenerationLimit.mockImplementation((plan: "free" | "premium") =>
      plan === "premium" ? null : 20,
    );
    configureGoogleDriveMocks();
  });

  it("redirects unauthenticated Drive connect requests to login with the requested next path", async () => {
    configureGoogleDriveMocks({ user: null });

    const response = await connectGET(
      new Request("https://app.example/api/google-drive/connect?next=/gallery"),
    );

    expect(response.headers.get("location")).toBe(
      "https://app.example/auth/login?next=%2Fgallery",
    );
    expect(mocks.getGoogleDriveAuthorizationUrl).not.toHaveBeenCalled();
  });

  it("redirects authenticated Drive connect requests to Google and sets a state cookie", async () => {
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue("state-1" as `${string}-${string}-${string}-${string}-${string}`);

    const response = await connectGET(
      new Request("https://app.example/api/google-drive/connect?next=/settings/storage"),
    );

    expect(mocks.getGoogleDriveAuthorizationUrl).toHaveBeenCalledWith(
      "state-1",
      "https://app.example/api/google-drive/connect?next=/settings/storage",
    );
    expect(response.headers.get("location")).toBe("https://accounts.google.test/oauth?state=state-1");
    expect(response.headers.get("set-cookie")).toContain("kavero_google_drive_state=state-1");
    randomUUID.mockRestore();
  });

  it("returns unauthorized from Drive status when signed out", async () => {
    configureGoogleDriveMocks({ user: null });

    const response = await statusGET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("preserves active Drive status response shape with plan and usage", async () => {
    configureGoogleDriveMocks({
      metadata: { plan: "premium" },
      generationCount: 7,
      driveConnection: activeDriveConnection(),
    });

    const response = await statusGET();
    const body = await response.json();

    expect(body).toEqual({
      connected: true,
      reconnectRequired: false,
      plan: "premium",
      usage: { used: 7, limit: null },
      connection: {
        googleEmail: "user@example.com",
        folderId: "folder-1",
        folderName: "Kavero",
        scope: "drive.file",
        status: "active",
        folderStatus: "ready",
        connectedAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-02T00:00:00.000Z",
      },
    });
  });

  it("preserves reconnect and no-connection Drive status states", async () => {
    configureGoogleDriveMocks({
      generationCount: 2,
      driveConnection: { ...activeDriveConnection(), status: "reconnect_required" },
    });

    const reconnectResponse = await statusGET();
    expect(await reconnectResponse.json()).toMatchObject({
      connected: false,
      reconnectRequired: true,
      plan: "free",
      usage: { used: 2, limit: 20 },
      connection: {
        status: "reconnect_required",
      },
    });

    configureGoogleDriveMocks({ generationCount: 0, driveConnection: null });

    const disconnectedResponse = await statusGET();
    expect(await disconnectedResponse.json()).toEqual({
      connected: false,
      reconnectRequired: false,
      plan: "free",
      usage: { used: 0, limit: 20 },
      connection: null,
    });
  });

  it("returns unauthorized from Drive preflight when signed out", async () => {
    configureGoogleDriveMocks({ user: null });

    const response = await preflightGET();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("preserves Drive preflight disconnected and reconnect warnings", async () => {
    configureGoogleDriveMocks({ generationCount: 1, driveConnection: null });

    const disconnected = await preflightGET();
    expect(await disconnected.json()).toEqual({
      canSave: false,
      connected: false,
      reconnectRequired: false,
      quotaFull: false,
      usage: { used: 1, limit: 20 },
      warning:
        "Google Drive is not connected. This generation will not be saved to Gallery, so download any images you want to keep.",
    });

    configureGoogleDriveMocks({
      generationCount: 1,
      driveConnection: { status: "reconnect_required", folder_status: "ready" },
    });

    const reconnect = await preflightGET();
    expect(await reconnect.json()).toEqual({
      canSave: false,
      connected: true,
      reconnectRequired: true,
      quotaFull: false,
      usage: { used: 1, limit: 20 },
      warning:
        "Google Drive needs to be reconnected. This generation will not be saved to Gallery unless Drive is reconnected first.",
    });
  });

  it("preserves Drive preflight token failure, quota-full, and can-save semantics", async () => {
    configureGoogleDriveMocks({ generationCount: 1, driveConnection: activeDriveConnection() });
    mocks.getGoogleDriveAccessTokenForUser.mockRejectedValueOnce(new Error("token expired"));

    const tokenFailure = await preflightGET();
    expect(await tokenFailure.json()).toEqual({
      canSave: false,
      connected: true,
      reconnectRequired: true,
      quotaFull: false,
      usage: { used: 1, limit: 20 },
      warning:
        "Google Drive needs to be reconnected. This generation will not be saved to Gallery unless Drive is reconnected first.",
    });

    configureGoogleDriveMocks({ generationCount: 20, driveConnection: activeDriveConnection() });

    const quotaFull = await preflightGET();
    expect(await quotaFull.json()).toEqual({
      canSave: false,
      connected: true,
      reconnectRequired: false,
      quotaFull: true,
      usage: { used: 20, limit: 20 },
      warning:
        "Free plan Gallery storage is full (20/20 generations). This generation will not be saved unless you free a folder first.",
    });

    configureGoogleDriveMocks({ generationCount: 3, driveConnection: activeDriveConnection() });

    const canSave = await preflightGET();
    expect(await canSave.json()).toEqual({
      canSave: true,
      connected: true,
      reconnectRequired: false,
      quotaFull: false,
      usage: { used: 3, limit: 20 },
      warning: null,
    });
  });

  it("returns unauthorized from Drive disconnect when signed out", async () => {
    configureGoogleDriveMocks({ user: null });

    const response = await disconnectPOST();
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ error: "Unauthorized" });
  });

  it("disconnects Drive and treats refresh-token or revoke failures as non-fatal", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    mocks.createAdminClient.mockReturnValue({ rpc });
    mocks.getGoogleDriveRefreshToken.mockRejectedValueOnce(new Error("vault unavailable"));

    const noTokenResponse = await disconnectPOST();

    expect(await noTokenResponse.json()).toEqual({ connected: false });
    expect(rpc).toHaveBeenCalledWith("disconnect_google_drive", { p_user_id: "user-1" });
    expect(mocks.revokeGoogleOAuthToken).not.toHaveBeenCalled();

    mocks.getGoogleDriveRefreshToken.mockResolvedValueOnce("refresh-token");
    mocks.revokeGoogleOAuthToken.mockRejectedValueOnce(new Error("revocation failed"));

    const revokeFailureResponse = await disconnectPOST();

    expect(await revokeFailureResponse.json()).toEqual({ connected: false });
    expect(mocks.revokeGoogleOAuthToken).toHaveBeenCalledWith("refresh-token");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

function configureGoogleDriveMocks(options: GoogleDriveRouteOptions = {}) {
  const user = options.user === undefined ? { id: "user-1" } : options.user;
  mocks.createClient.mockResolvedValue(createSupabaseClient({ ...options, user }));
}

function createSupabaseClient(options: GoogleDriveRouteOptions) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: options.user ?? null }, error: null })),
    },
    from: vi.fn((table: string) => {
      if (table === "user_drive_connections") {
        return maybeSingleQuery({ data: options.driveConnection ?? null });
      }

      if (table === "user_metadata") {
        return maybeSingleQuery({ data: options.metadata ?? { plan: "free" } });
      }

      if (table === "generation_runs") {
        return countQuery({ count: options.generationCount ?? 0 });
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function maybeSingleQuery(result: { data: unknown }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => result),
  };
  return query;
}

function countQuery(result: { count: number | null }) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(async () => result),
  };
  return query;
}

function activeDriveConnection(): NonNullable<DriveConnection> {
  return {
    google_email: "user@example.com",
    folder_id: "folder-1",
    folder_name: "Kavero",
    scope: "drive.file",
    status: "active",
    folder_status: "ready",
    connected_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-02T00:00:00.000Z",
  };
}
