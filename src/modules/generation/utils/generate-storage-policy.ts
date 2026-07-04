import type {
  DrivePreflightResponse,
  GateDialog,
  WorkspaceStatusResponse,
} from "@/modules/generation/types";

export type EnsureGenerateStorageReadyInput = {
  workspaceStatus: WorkspaceStatusResponse | null;
  loadDrivePreflight: () => Promise<DrivePreflightResponse | null>;
  openGateDialog: (dialog: GateDialog) => Promise<boolean>;
};

export async function ensureGenerateStorageReady({
  workspaceStatus,
  loadDrivePreflight,
  openGateDialog,
}: EnsureGenerateStorageReadyInput) {
  if (workspaceStatus?.deploymentProfile === "local-first") {
    return ensureLocalFirstStorageReady({ workspaceStatus, openGateDialog });
  }

  return ensureCloudStorageReady({ loadDrivePreflight, openGateDialog });
}

async function ensureCloudStorageReady({
  loadDrivePreflight,
  openGateDialog,
}: Pick<EnsureGenerateStorageReadyInput, "loadDrivePreflight" | "openGateDialog">) {
  try {
    const preflight = await loadDrivePreflight();
    if (!preflight || preflight.canSave || !preflight.warning) return true;

    return openGateDialog({
      title: preflight.quotaFull ? "Gallery storage full" : "Drive save unavailable",
      description: `${preflight.warning} You can still generate, but download images you want to keep.`,
      confirmLabel: "Generate anyway",
      cancelLabel: preflight.reconnectRequired ? "Reconnect first" : "Cancel",
      href: preflight.reconnectRequired ? "/settings/storage" : undefined,
      variant: "warning",
      icon: preflight.reconnectRequired ? "drive" : "warning",
    });
  } catch {
    return openGateDialog({
      title: "Storage check unavailable",
      description:
        "Kavero could not check Google Drive storage before generation. You can still generate, but download images you want to keep.",
      confirmLabel: "Generate anyway",
      cancelLabel: "Cancel",
      variant: "warning",
      icon: "warning",
    });
  }
}

async function ensureLocalFirstStorageReady({
  workspaceStatus,
  openGateDialog,
}: Pick<EnsureGenerateStorageReadyInput, "workspaceStatus" | "openGateDialog">) {
  const storageMissing = workspaceStatus?.workspace?.missing.includes("storage") ?? false;
  const storageReady = workspaceStatus?.storage?.ready === true;

  if (!storageMissing && storageReady) return true;

  return openGateDialog({
    title: "Kavero storage unavailable",
    description: `${workspaceStatus?.storage?.warning ?? "Kavero storage is not ready."} You can still generate, but download images you want to keep.`,
    confirmLabel: "Generate anyway",
    cancelLabel: "Cancel",
    variant: "warning",
    icon: "warning",
  });
}
