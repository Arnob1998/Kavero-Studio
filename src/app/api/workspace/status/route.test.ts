import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
  resolveRuntimeManagedStorageBackend: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

vi.mock("@/modules/storage/managed/runtime", () => ({
  resolveRuntimeManagedStorageBackend: mocks.resolveRuntimeManagedStorageBackend,
}));

import { GET } from "./route";

const envKeys = [
  "KAVERO_DEPLOYMENT_PROFILE",
  "KAVERO_AUTH_MODE",
  "KAVERO_STORAGE_PROVIDER",
  "KAVERO_MANAGED_STORAGE_BACKEND",
  "KAVERO_LOCAL_STORAGE_ROOT",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

type WorkspaceStatusOptions = {
  user?: { id: string } | null;
  providerKey?: Record<string, unknown> | null;
  metadata?: { plan?: string | null } | null;
  generationCount?: number | null;
  driveConnection?: { status?: string | null; folder_status?: string | null } | null;
};

describe("/api/workspace/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      const value = originalEnv[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it("preserves the unauthenticated default Cloud response and adds readiness fields", async () => {
    configureWorkspaceStatusMocks({ user: null });

    const response = await GET();
    const body = await response.json();

    expect(body).toMatchObject({
      authenticated: false,
      hasGeminiKey: false,
      drive: {
        connected: false,
        reconnectRequired: false,
        quotaFull: false,
        usage: { used: 0, limit: null },
      },
      deploymentProfile: "cloud",
      workspace: {
        ready: false,
        missing: ["auth"],
      },
      storage: {
        providerId: "google-drive",
        ready: false,
        required: true,
        warning: "Google Drive is not connected.",
      },
    });
    expect(mocks.createAdminClient).not.toHaveBeenCalled();
    expect(mocks.resolveRuntimeManagedStorageBackend).not.toHaveBeenCalled();
  });

  it("preserves authenticated Cloud active Drive status and reports ready", async () => {
    configureWorkspaceStatusMocks({
      providerKey: { id: "key-1", status: "active" },
      metadata: { plan: "premium" },
      generationCount: 3,
      driveConnection: { status: "active", folder_status: "ready" },
    });

    const response = await GET();
    const body = await response.json();

    expect(body).toMatchObject({
      authenticated: true,
      hasGeminiKey: true,
      plan: "premium",
      drive: {
        connected: true,
        reconnectRequired: false,
        quotaFull: false,
        usage: { used: 3, limit: null },
      },
      deploymentProfile: "cloud",
      workspace: {
        ready: true,
        missing: [],
      },
      storage: {
        providerId: "google-drive",
        ready: true,
        required: true,
        warning: null,
      },
    });
    expect(mocks.resolveRuntimeManagedStorageBackend).not.toHaveBeenCalled();
  });

  it("defaults invalid or missing deployment profiles to Cloud without inferring from auth or storage envs", async () => {
    process.env.KAVERO_DEPLOYMENT_PROFILE = "LOCAL-FIRST";
    process.env.KAVERO_AUTH_MODE = "password";
    process.env.KAVERO_STORAGE_PROVIDER = "kavero-managed";
    process.env.KAVERO_MANAGED_STORAGE_BACKEND = "local-filesystem";
    process.env.KAVERO_LOCAL_STORAGE_ROOT = "C:\\kavero-storage";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
    configureWorkspaceStatusMocks({
      providerKey: { id: "key-1", status: "active" },
      driveConnection: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(body.deploymentProfile).toBe("cloud");
    expect(body.workspace).toEqual({
      ready: false,
      missing: ["google-drive"],
    });
    expect(body.storage).toMatchObject({
      providerId: "google-drive",
      ready: false,
      required: true,
    });
    expect(mocks.resolveRuntimeManagedStorageBackend).not.toHaveBeenCalled();
  });

  it("allows Local-first readiness without active Google Drive when managed storage is ready", async () => {
    process.env.KAVERO_DEPLOYMENT_PROFILE = "local-first";
    const managedGetStatus = vi.fn(async () => ({
      providerId: "kavero-managed",
      kind: "managed",
      ready: true,
      connected: true,
      warning: null,
    }));
    mocks.resolveRuntimeManagedStorageBackend.mockReturnValue({
      ok: true,
      backend: { getStatus: managedGetStatus },
    });
    configureWorkspaceStatusMocks({
      providerKey: { id: "key-1", status: "active" },
      driveConnection: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(body).toMatchObject({
      authenticated: true,
      hasGeminiKey: true,
      deploymentProfile: "local-first",
      drive: {
        connected: false,
        reconnectRequired: false,
        quotaFull: false,
      },
      workspace: {
        ready: true,
        missing: [],
      },
      storage: {
        providerId: "kavero-managed",
        ready: true,
        required: true,
        warning: null,
      },
    });
    expect(managedGetStatus).toHaveBeenCalledWith({
      userId: "user-1",
      purpose: "generated-image",
    });
  });

  it("keeps Gemini key as a Local-first readiness requirement", async () => {
    process.env.KAVERO_DEPLOYMENT_PROFILE = "local-first";
    mocks.resolveRuntimeManagedStorageBackend.mockReturnValue({
      ok: true,
      backend: {
        getStatus: vi.fn(async () => ({
          providerId: "kavero-managed",
          kind: "managed",
          ready: true,
          connected: true,
          warning: null,
        })),
      },
    });
    configureWorkspaceStatusMocks({
      providerKey: null,
      driveConnection: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(body.workspace).toEqual({
      ready: false,
      missing: ["gemini-key"],
    });
    expect(body.storage).toMatchObject({
      providerId: "kavero-managed",
      ready: true,
    });
  });

  it("reports Local-first managed storage readiness failures without requiring Drive", async () => {
    process.env.KAVERO_DEPLOYMENT_PROFILE = "local-first";
    mocks.resolveRuntimeManagedStorageBackend.mockReturnValue({
      ok: true,
      backend: {
        getStatus: vi.fn(async () => ({
          providerId: "kavero-managed",
          kind: "managed",
          ready: false,
          connected: false,
          warning: "Local filesystem storage root is not configured.",
        })),
      },
    });
    configureWorkspaceStatusMocks({
      providerKey: { id: "key-1", status: "active" },
      driveConnection: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(body.workspace).toEqual({
      ready: false,
      missing: ["storage"],
    });
    expect(body.storage).toEqual({
      providerId: "kavero-managed",
      ready: false,
      required: true,
      warning: "Local filesystem storage root is not configured.",
    });
  });

  it("keeps Cloud profile dependent on Drive and does not use managed storage readiness", async () => {
    process.env.KAVERO_DEPLOYMENT_PROFILE = "cloud";
    configureWorkspaceStatusMocks({
      providerKey: { id: "key-1", status: "active" },
      driveConnection: null,
    });

    const response = await GET();
    const body = await response.json();

    expect(body.deploymentProfile).toBe("cloud");
    expect(body.workspace).toEqual({
      ready: false,
      missing: ["google-drive"],
    });
    expect(body.storage).toMatchObject({
      providerId: "google-drive",
      ready: false,
    });
    expect(mocks.resolveRuntimeManagedStorageBackend).not.toHaveBeenCalled();
  });
});

function configureWorkspaceStatusMocks(options: WorkspaceStatusOptions = {}) {
  const user = options.user === undefined ? { id: "user-1" } : options.user;
  mocks.createClient.mockResolvedValue(createSupabaseClient({ ...options, user }));
  mocks.createAdminClient.mockReturnValue(createAdminClient({ providerKey: options.providerKey }));
}

function createSupabaseClient(options: WorkspaceStatusOptions) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: options.user ?? null } })),
    },
    from: vi.fn((table: string) => {
      if (table === "user_metadata") {
        return maybeSingleQuery({ data: options.metadata ?? { plan: "free" } });
      }

      if (table === "generation_runs") {
        return countQuery({ count: options.generationCount ?? 0 });
      }

      if (table === "user_drive_connections") {
        return maybeSingleQuery({ data: options.driveConnection ?? null });
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function createAdminClient(options: Pick<WorkspaceStatusOptions, "providerKey">) {
  return {
    from: vi.fn((table: string) => {
      if (table === "user_provider_keys") {
        return maybeSingleQuery({
          data:
            options.providerKey === undefined
              ? { id: "key-1", status: "active" }
              : options.providerKey,
        });
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
