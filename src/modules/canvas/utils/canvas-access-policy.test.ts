import { describe, expect, it } from "vitest";
import {
  getCanvasAccessPolicyDecision,
  type CanvasAccessPolicyStatus,
} from "./canvas-access-policy";

describe("canvas client access policy", () => {
  it("keeps Cloud/default gated on authentication, premium plan, and connected Drive", () => {
    expect(decision(status({ authenticated: false })).allowed).toBe(false);
    expect(decision(status({ authenticated: true, plan: "free", driveConnected: true }))).toMatchObject({
      allowed: false,
      title: "Canvas is premium",
      actionHref: "/pricing",
      actionLabel: "View plans",
    });
    expect(decision(status({ authenticated: true, plan: "premium", driveConnected: false }))).toMatchObject({
      allowed: false,
      title: "Connect Google Drive",
      actionHref: "/api/google-drive/connect?next=/canvas",
      actionLabel: "Connect Drive",
    });
    expect(decision(status({ authenticated: true, plan: "premium", driveConnected: true }))).toMatchObject({
      allowed: true,
    });
  });

  it("keeps the Cloud/default reconnect Drive gate", () => {
    expect(
      decision(
        status({
          authenticated: true,
          plan: "premium",
          driveConnected: false,
          driveReconnectRequired: true,
        }),
      ),
    ).toMatchObject({
      allowed: false,
      title: "Reconnect Google Drive",
      actionHref: "/api/google-drive/connect?next=/canvas",
      actionLabel: "Reconnect Drive",
    });
  });

  it("allows authenticated Local-first users without premium plan or Drive", () => {
    expect(
      decision(
        status({
          authenticated: true,
          deploymentProfile: "local-first",
          plan: "free",
          driveConnected: false,
        }),
      ),
    ).toMatchObject({ allowed: true });
  });

  it("keeps the sign-in gate for unauthenticated Local-first users", () => {
    expect(
      decision(
        status({
          authenticated: false,
          deploymentProfile: "local-first",
          plan: "free",
          driveConnected: false,
        }),
      ),
    ).toMatchObject({
      allowed: false,
      title: "Sign in to use Canvas",
      description: "Canvas projects are attached to your workspace and require an account.",
      actionHref: "/auth/login?next=/canvas",
      actionLabel: "Sign in",
    });
  });

  it("treats missing or invalid profile values as Cloud/default", () => {
    expect(
      decision(
        status({
          authenticated: true,
          deploymentProfile: undefined,
          plan: "free",
          driveConnected: false,
        }),
      ),
    ).toMatchObject({
      allowed: false,
      title: "Canvas is premium",
    });
    expect(
      decision(
        status({
          authenticated: true,
          deploymentProfile: "LOCAL-FIRST",
          plan: "free",
          driveConnected: false,
        }),
      ),
    ).toMatchObject({
      allowed: false,
      title: "Canvas is premium",
    });
  });
});

function decision(status: CanvasAccessPolicyStatus) {
  return getCanvasAccessPolicyDecision(status);
}

function status({
  authenticated,
  deploymentProfile = "cloud",
  plan = "premium",
  driveConnected = false,
  driveReconnectRequired = false,
}: {
  authenticated: boolean;
  deploymentProfile?: CanvasAccessPolicyStatus["deploymentProfile"];
  plan?: CanvasAccessPolicyStatus["plan"];
  driveConnected?: boolean;
  driveReconnectRequired?: boolean;
}): CanvasAccessPolicyStatus {
  return {
    authenticated,
    deploymentProfile,
    plan,
    drive: {
      connected: driveConnected,
      reconnectRequired: driveReconnectRequired,
    },
  };
}
