import type { DeploymentProfile } from "@/lib/deployment-profile";

export type CanvasAccessPolicyStatus = {
  authenticated: boolean;
  deploymentProfile?: DeploymentProfile | string | null;
  plan?: "free" | "premium";
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
    : status.authenticated && status.plan === "premium" && status.drive.connected;

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

  if (status.plan !== "premium") {
    return {
      allowed,
      title: "Canvas is premium",
      description:
        "Canvas is a premium workspace feature. Upgrade to unlock design editing, Drive-backed assets, autosave, and export.",
      actionHref: "/pricing",
      actionLabel: "View plans",
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
