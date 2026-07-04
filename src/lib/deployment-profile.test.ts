import { describe, expect, it } from "vitest";
import {
  defaultDeploymentProfile,
  deploymentProfiles,
  getDeploymentProfile,
  isDeploymentProfile,
  isLocalFirstDeploymentProfile,
  resolveDeploymentProfile,
} from "./deployment-profile";

describe("deployment profile", () => {
  it("recognizes only supported deployment profiles", () => {
    expect(deploymentProfiles).toEqual(["cloud", "local-first"]);
    expect(isDeploymentProfile("cloud")).toBe(true);
    expect(isDeploymentProfile("local-first")).toBe(true);
    expect(isDeploymentProfile("LOCAL-FIRST")).toBe(false);
    expect(isDeploymentProfile("Cloud")).toBe(false);
    expect(isDeploymentProfile("self-hosted")).toBe(false);
  });

  it("defaults to cloud when the env var is missing", () => {
    expect(defaultDeploymentProfile).toBe("cloud");
    expect(getDeploymentProfile({})).toBe("cloud");
  });

  it("defaults to cloud when the env var is blank", () => {
    expect(getDeploymentProfile({ KAVERO_DEPLOYMENT_PROFILE: "   " })).toBe("cloud");
    expect(resolveDeploymentProfile("")).toBe("cloud");
  });

  it("defaults to cloud for invalid or malformed profile values", () => {
    expect(getDeploymentProfile({ KAVERO_DEPLOYMENT_PROFILE: "self-hosted" })).toBe("cloud");
    expect(getDeploymentProfile({ KAVERO_DEPLOYMENT_PROFILE: "cloud/local-first" })).toBe("cloud");
    expect(getDeploymentProfile({ KAVERO_DEPLOYMENT_PROFILE: "local first" })).toBe("cloud");
  });

  it("defaults to cloud for differently cased profile values", () => {
    expect(getDeploymentProfile({ KAVERO_DEPLOYMENT_PROFILE: "Cloud" })).toBe("cloud");
    expect(getDeploymentProfile({ KAVERO_DEPLOYMENT_PROFILE: "LOCAL-FIRST" })).toBe("cloud");
  });

  it("resolves cloud when explicitly configured", () => {
    expect(getDeploymentProfile({ KAVERO_DEPLOYMENT_PROFILE: "cloud" })).toBe("cloud");
    expect(resolveDeploymentProfile(" cloud ")).toBe("cloud");
  });

  it("resolves local-first when explicitly configured", () => {
    expect(getDeploymentProfile({ KAVERO_DEPLOYMENT_PROFILE: "local-first" })).toBe("local-first");
    expect(resolveDeploymentProfile(" local-first ")).toBe("local-first");
    expect(isLocalFirstDeploymentProfile("local-first")).toBe(true);
    expect(isLocalFirstDeploymentProfile("cloud")).toBe(false);
  });

  it("does not infer local-first from auth, storage, local backend, or Supabase envs", () => {
    expect(
      getDeploymentProfile({
        KAVERO_AUTH_MODE: "password",
        KAVERO_STORAGE_PROVIDER: "kavero-managed",
        KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem",
        KAVERO_LOCAL_STORAGE_ROOT: "C:\\kavero-storage",
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "local-service-role-key",
      }),
    ).toBe("cloud");
  });
});
