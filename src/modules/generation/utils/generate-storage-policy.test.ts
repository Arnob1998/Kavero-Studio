import { describe, expect, it, vi } from "vitest";
import type { DrivePreflightResponse, WorkspaceStatusResponse } from "@/modules/generation/types";
import { ensureGenerateStorageReady } from "./generate-storage-policy";

type WorkspaceMissingReasons = NonNullable<WorkspaceStatusResponse["workspace"]>["missing"];

describe("generate storage policy", () => {
  it("uses Cloud Drive preflight when the deployment profile is missing", async () => {
    const loadDrivePreflight = vi.fn(async (): Promise<DrivePreflightResponse> => drivePreflight());
    const openGateDialog = vi.fn(async () => true);

    await expect(
      ensureGenerateStorageReady({
        workspaceStatus: workspaceStatus({ deploymentProfile: undefined }),
        loadDrivePreflight,
        openGateDialog,
      }),
    ).resolves.toBe(true);

    expect(loadDrivePreflight).toHaveBeenCalledTimes(1);
    expect(openGateDialog).not.toHaveBeenCalled();
  });

  it("preserves Cloud Drive preflight warning dialogs", async () => {
    const loadDrivePreflight = vi.fn(async (): Promise<DrivePreflightResponse> =>
      drivePreflight({
        canSave: false,
        reconnectRequired: true,
        warning: "Reconnect Google Drive to save generated history.",
      }),
    );
    const openGateDialog = vi.fn(async () => false);

    await expect(
      ensureGenerateStorageReady({
        workspaceStatus: workspaceStatus({ deploymentProfile: "cloud" }),
        loadDrivePreflight,
        openGateDialog,
      }),
    ).resolves.toBe(false);

    expect(openGateDialog).toHaveBeenCalledWith({
      title: "Drive save unavailable",
      description:
        "Reconnect Google Drive to save generated history. You can still generate, but download images you want to keep.",
      confirmLabel: "Generate anyway",
      cancelLabel: "Reconnect first",
      href: "/settings/storage",
      variant: "warning",
      icon: "drive",
    });
  });

  it("preserves Cloud Drive preflight check failure dialogs", async () => {
    const loadDrivePreflight = vi.fn(async () => {
      throw new Error("network");
    });
    const openGateDialog = vi.fn(async () => true);

    await expect(
      ensureGenerateStorageReady({
        workspaceStatus: workspaceStatus({ deploymentProfile: "cloud" }),
        loadDrivePreflight,
        openGateDialog,
      }),
    ).resolves.toBe(true);

    expect(openGateDialog).toHaveBeenCalledWith({
      title: "Storage check unavailable",
      description:
        "Kavero could not check Google Drive storage before generation. You can still generate, but download images you want to keep.",
      confirmLabel: "Generate anyway",
      cancelLabel: "Cancel",
      variant: "warning",
      icon: "warning",
    });
  });

  it("skips Drive preflight in Local-first when managed storage is ready", async () => {
    const loadDrivePreflight = vi.fn(async (): Promise<DrivePreflightResponse> => drivePreflight());
    const openGateDialog = vi.fn(async () => true);

    await expect(
      ensureGenerateStorageReady({
        workspaceStatus: workspaceStatus({
          deploymentProfile: "local-first",
          workspaceMissing: [],
          storageReady: true,
        }),
        loadDrivePreflight,
        openGateDialog,
      }),
    ).resolves.toBe(true);

    expect(loadDrivePreflight).not.toHaveBeenCalled();
    expect(openGateDialog).not.toHaveBeenCalled();
  });

  it("warns with storage-neutral copy when Local-first managed storage is not ready", async () => {
    const loadDrivePreflight = vi.fn(async (): Promise<DrivePreflightResponse> => drivePreflight());
    const openGateDialog = vi.fn(async () => false);

    await expect(
      ensureGenerateStorageReady({
        workspaceStatus: workspaceStatus({
          deploymentProfile: "local-first",
          workspaceMissing: ["storage"],
          storageReady: false,
          storageWarning: "Local filesystem storage root is not configured.",
        }),
        loadDrivePreflight,
        openGateDialog,
      }),
    ).resolves.toBe(false);

    expect(loadDrivePreflight).not.toHaveBeenCalled();
    expect(openGateDialog).toHaveBeenCalledWith({
      title: "Kavero storage unavailable",
      description:
        "Local filesystem storage root is not configured. You can still generate, but download images you want to keep.",
      confirmLabel: "Generate anyway",
      cancelLabel: "Cancel",
      variant: "warning",
      icon: "warning",
    });
  });

  it("allows Local-first generation when the user confirms the storage warning", async () => {
    const loadDrivePreflight = vi.fn(async (): Promise<DrivePreflightResponse> => drivePreflight());
    const openGateDialog = vi.fn(async () => true);

    await expect(
      ensureGenerateStorageReady({
        workspaceStatus: workspaceStatus({
          deploymentProfile: "local-first",
          workspaceMissing: ["storage"],
          storageReady: false,
        }),
        loadDrivePreflight,
        openGateDialog,
      }),
    ).resolves.toBe(true);

    expect(loadDrivePreflight).not.toHaveBeenCalled();
    expect(openGateDialog).toHaveBeenCalledTimes(1);
  });
});

function drivePreflight(overrides: Partial<DrivePreflightResponse> = {}): DrivePreflightResponse {
  return {
    canSave: true,
    connected: true,
    reconnectRequired: false,
    quotaFull: false,
    usage: { used: 0, limit: 20 },
    warning: null,
    ...overrides,
  };
}

function workspaceStatus({
  deploymentProfile = "cloud",
  workspaceMissing = [],
  storageReady = true,
  storageWarning = null,
}: {
  deploymentProfile?: WorkspaceStatusResponse["deploymentProfile"];
  workspaceMissing?: WorkspaceMissingReasons;
  storageReady?: boolean;
  storageWarning?: string | null;
} = {}): WorkspaceStatusResponse {
  return {
    authenticated: true,
    hasGeminiKey: true,
    deploymentProfile,
    workspace: {
      ready: workspaceMissing.length === 0,
      missing: workspaceMissing,
    },
    storage: {
      providerId: deploymentProfile === "local-first" ? "kavero-managed" : "google-drive",
      ready: storageReady,
      required: true,
      warning: storageWarning,
    },
    drive: {
      connected: deploymentProfile !== "local-first",
      reconnectRequired: false,
      quotaFull: false,
      usage: { used: 0, limit: 20 },
    },
  };
}
