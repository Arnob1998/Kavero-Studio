import { NextResponse } from "next/server";
import {
  getDeploymentProfile,
  isLocalFirstDeploymentProfile,
  type DeploymentProfile,
} from "@/lib/deployment-profile";
import { getGenerationLimit, normalizeUserPlan } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveRuntimeManagedStorageBackend } from "@/modules/storage/managed/runtime";
import type { ManagedStorageEnv } from "@/modules/storage/managed/config";
import type { StorageStatus } from "@/modules/storage/storage-provider";

type WorkspaceMissingReason =
  | "auth"
  | "gemini-key"
  | "google-drive"
  | "google-drive-reconnect"
  | "storage"
  | "quota";

type WorkspaceDriveStatus = {
  connected: boolean;
  reconnectRequired: boolean;
  quotaFull: boolean;
  usage: {
    used: number;
    limit: number | null;
  };
};

type WorkspaceStorageStatus = {
  providerId: "google-drive" | "kavero-managed";
  ready: boolean;
  required: boolean;
  warning: string | null;
};

type WorkspaceStatusResponseInput = {
  deploymentProfile: DeploymentProfile;
  authenticated: boolean;
  hasGeminiKey: boolean;
  plan?: ReturnType<typeof normalizeUserPlan>;
  drive: WorkspaceDriveStatus;
  managedStorageStatus?: Pick<StorageStatus, "ready" | "warning"> | null;
};

export async function GET() {
  const deploymentProfile = getDeploymentProfile();
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      buildWorkspaceStatusResponse({
        deploymentProfile,
        authenticated: false,
        hasGeminiKey: false,
        drive: {
          connected: false,
          reconnectRequired: false,
          quotaFull: false,
          usage: { used: 0, limit: null },
        },
      }),
    );
  }

  const admin = createAdminClient();
  const [{ data: providerKey }, { data: metadata }, { count }, { data: driveConnection }] =
    await Promise.all([
      admin
        .from("user_provider_keys")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("provider_id", "google-gemini")
        .eq("status", "active")
        .maybeSingle(),
      supabase.from("user_metadata").select("plan").eq("user_id", user.id).maybeSingle(),
      supabase
        .from("generation_runs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      supabase
        .from("user_drive_connections")
        .select("status, folder_status")
        .eq("user_id", user.id)
        .eq("provider", "google-drive")
        .maybeSingle(),
    ]);

  const plan = normalizeUserPlan(metadata?.plan);
  const limit = getGenerationLimit(plan);
  const used = count ?? 0;
  const hasGeminiKey = Boolean(providerKey);
  const drive: WorkspaceDriveStatus = {
    connected: driveConnection?.status === "active",
    reconnectRequired: driveConnection?.status === "reconnect_required",
    quotaFull: limit !== null && used >= limit,
    usage: { used, limit },
  };

  const managedStorageStatus = isLocalFirstDeploymentProfile(deploymentProfile)
    ? await getLocalFirstManagedStorageStatus({ admin, userId: user.id })
    : null;

  return NextResponse.json(
    buildWorkspaceStatusResponse({
      deploymentProfile,
      authenticated: true,
      hasGeminiKey,
      plan,
      drive,
      managedStorageStatus,
    }),
  );
}

export function buildWorkspaceStatusResponse(input: WorkspaceStatusResponseInput) {
  const localFirst = isLocalFirstDeploymentProfile(input.deploymentProfile);
  const storage = localFirst
    ? buildManagedStorageStatus(input.managedStorageStatus)
    : buildGoogleDriveStorageStatus(input.drive);
  const missing = buildWorkspaceMissingReasons({
    authenticated: input.authenticated,
    hasGeminiKey: input.hasGeminiKey,
    drive: input.drive,
    storage,
    localFirst,
  });

  return {
    authenticated: input.authenticated,
    hasGeminiKey: input.hasGeminiKey,
    ...(input.plan ? { plan: input.plan } : {}),
    drive: input.drive,
    deploymentProfile: input.deploymentProfile,
    workspace: {
      ready: missing.length === 0,
      missing,
    },
    storage,
  };
}

async function getLocalFirstManagedStorageStatus(input: { admin: unknown; userId: string }) {
  const resolved = resolveRuntimeManagedStorageBackend({
    admin: input.admin,
    env: process.env as ManagedStorageEnv,
  });
  if (!resolved.ok) {
    return {
      ready: false,
      warning: managedStorageResolutionWarning(resolved),
    };
  }

  try {
    const status = await resolved.backend.getStatus({
      userId: input.userId,
      purpose: "generated-image",
    });
    return {
      ready: status.ready,
      warning: status.warning ?? null,
    };
  } catch (error) {
    return {
      ready: false,
      warning:
        error instanceof Error ? error.message : "Managed storage readiness could not be checked.",
    };
  }
}

function buildGoogleDriveStorageStatus(drive: WorkspaceDriveStatus): WorkspaceStorageStatus {
  const ready = drive.connected && !drive.reconnectRequired && !drive.quotaFull;
  return {
    providerId: "google-drive",
    ready,
    required: true,
    warning: ready ? null : googleDriveStorageWarning(drive),
  };
}

function buildManagedStorageStatus(
  status: Pick<StorageStatus, "ready" | "warning"> | null | undefined,
): WorkspaceStorageStatus {
  return {
    providerId: "kavero-managed",
    ready: Boolean(status?.ready),
    required: true,
    warning: status?.ready ? null : status?.warning ?? "Managed storage is not ready.",
  };
}

function buildWorkspaceMissingReasons(input: {
  authenticated: boolean;
  hasGeminiKey: boolean;
  drive: WorkspaceDriveStatus;
  storage: WorkspaceStorageStatus;
  localFirst: boolean;
}): WorkspaceMissingReason[] {
  const missing: WorkspaceMissingReason[] = [];

  if (!input.authenticated) {
    missing.push("auth");
    return missing;
  }

  if (!input.hasGeminiKey) missing.push("gemini-key");

  if (input.localFirst) {
    if (!input.storage.ready) missing.push("storage");
    return missing;
  }

  if (input.drive.reconnectRequired) {
    missing.push("google-drive-reconnect");
  } else if (!input.drive.connected) {
    missing.push("google-drive");
  }

  if (input.drive.quotaFull) missing.push("quota");
  return missing;
}

function googleDriveStorageWarning(drive: WorkspaceDriveStatus) {
  if (drive.reconnectRequired) return "Google Drive needs to be reconnected.";
  if (!drive.connected) return "Google Drive is not connected.";
  if (drive.quotaFull) return "Google Drive storage quota is full.";
  return null;
}

function managedStorageResolutionWarning(
  resolved: Exclude<ReturnType<typeof resolveRuntimeManagedStorageBackend>, { ok: true }>,
) {
  if (resolved.reason === "invalid-backend") {
    return `Managed storage backend "${resolved.backendId}" is invalid.`;
  }

  if (resolved.reason === "backend-not-registered") {
    return `Managed storage backend "${resolved.backendId}" is not registered.`;
  }

  return resolved.error instanceof Error ? resolved.error.message : "Managed storage is not configured.";
}
