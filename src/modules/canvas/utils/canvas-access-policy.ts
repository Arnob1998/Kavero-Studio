import type { DeploymentProfile } from "@/lib/deployment-profile";

export type CanvasAccessPolicyStatus = {
  authenticated: boolean;
  deploymentProfile?: DeploymentProfile | string | null;
  drive: {
    connected: boolean;
    reconnectRequired: boolean;
  };
};

export type CanvasAccessPolicyDecision = {
  allowed: boolean;
  title: string;
  description: string;
  actionHref: string;
  actionLabel: string;
};

export function getCanvasAccessPolicyDecision(
  status: CanvasAccessPolicyStatus,
): CanvasAccessPolicyDecision {
  const isLocalFirst = status.deploymentProfile === "local-first";
  const allowed = isLocalFirst
    ? status.authenticated
    : status.authenticated && status.drive.connected;

  if (allowed) {
    return {
      allowed,
      title: "",
      description: "",
      actionHref: "",
      actionLabel: "",
    };
  }

  if (!status.authenticated) {
    return {
      allowed,
      title: "Sign in to use Canvas",
      description: "Canvas projects are attached to your workspace and require an account.",
      actionHref: "/auth/login?next=/canvas",
      actionLabel: "Sign in",
    };
  }

  return {
    allowed,
    title: status.drive.reconnectRequired ? "Reconnect Google Drive" : "Connect Google Drive",
    description: "Canvas stores images and assets in your Google Drive. Connect Drive to use the design editor.",
    actionHref: "/api/google-drive/connect?next=/canvas",
    actionLabel: status.drive.reconnectRequired ? "Reconnect Drive" : "Connect Drive",
  };
}
