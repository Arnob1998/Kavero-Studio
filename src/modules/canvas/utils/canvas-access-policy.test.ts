import { describe, expect, it } from "vitest";
import {
  getCanvasAccessPolicyDecision,
  type CanvasAccessPolicyStatus,
} from "./canvas-access-policy";

describe("canvas client access policy", () => {
  it("keeps Cloud/default gated on authentication and connected Drive only", () => {
    expect(decision(status({ authenticated: false })).allowed).toBe(false);
    expect(decision(status({ authenticated: true, driveConnected: false }))).toMatchObject({
      allowed: false,
      title: "Connect Google Drive",
      actionHref: "/api/google-drive/connect?next=/canvas",
      actionLabel: "Connect Drive",
    });
    expect(decision(status({ authenticated: true, driveConnected: true }))).toMatchObject({
      allowed: true,
    });
  });

  it("keeps the Cloud/default reconnect Drive gate", () => {
    expect(
      decision(
        status({
          authenticated: true,
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

  it("allows authenticated Local-first users without Drive", () => {
    expect(
      decision(
        status({
          authenticated: true,
          deploymentProfile: "local-first",
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
          driveConnected: false,
        }),
      ),
    ).toMatchObject({
      allowed: false,
      title: "Connect Google Drive",
    });
    expect(
      decision(
        status({
          authenticated: true,
          deploymentProfile: "LOCAL-FIRST",
          driveConnected: false,
        }),
      ),
    ).toMatchObject({
      allowed: false,
      title: "Connect Google Drive",
    });
  });
});

function decision(status: CanvasAccessPolicyStatus) {
  return getCanvasAccessPolicyDecision(status);
}

function status({
  authenticated,
  deploymentProfile = "cloud",
  driveConnected = false,
  driveReconnectRequired = false,
}: {
  authenticated: boolean;
  deploymentProfile?: CanvasAccessPolicyStatus["deploymentProfile"];
  driveConnected?: boolean;
  driveReconnectRequired?: boolean;
}): CanvasAccessPolicyStatus {
  return {
    authenticated,
    deploymentProfile,
    drive: {
      connected: driveConnected,
      reconnectRequired: driveReconnectRequired,
    },
  };
}
