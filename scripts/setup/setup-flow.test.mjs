import { describe, expect, it } from "vitest";
import { buildSetupValues } from "./setup-flow.mjs";

describe("setup flow values", () => {
  it("builds local Docker env values", () => {
    const values = buildSetupValues({
      profileId: "local-docker",
      authMode: "password",
      storageChoiceId: "kavero-managed-local-filesystem",
      inputs: { KAVERO_APP_PORT: "3001", SUPABASE_KONG_PORT: "54322" },
      dockerSecrets: {
        POSTGRES_PASSWORD: "postgres-secret",
        SUPABASE_JWT_SECRET: "jwt-secret",
        SUPABASE_ANON_KEY: "anon",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
      },
    });

    expect(values).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54322",
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3001",
      KAVERO_DEPLOYMENT_PROFILE: "local-first",
      KAVERO_AUTH_MODE: "password",
      KAVERO_STORAGE_PROVIDER: "kavero-managed",
      KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem",
      KAVERO_LOCAL_STORAGE_ROOT: "/data/kavero-storage",
    });
  });

  it("rejects non-password auth for local Docker", () => {
    expect(() =>
      buildSetupValues({
        profileId: "local-docker",
        authMode: "google",
        storageChoiceId: "kavero-managed-local-filesystem",
        dockerSecrets: {
          POSTGRES_PASSWORD: "postgres-secret",
          SUPABASE_JWT_SECRET: "jwt-secret",
          SUPABASE_ANON_KEY: "anon",
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon",
          SUPABASE_SERVICE_ROLE_KEY: "service",
        },
      }),
    ).toThrow("Local Docker setup supports password auth only.");
  });

  it("builds cloud/self-host env values from selected storage", () => {
    const values = buildSetupValues({
      profileId: "cloud-self-host",
      authMode: "google-password",
      storageChoiceId: "kavero-managed-supabase",
      inputs: {
        NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        NEXT_PUBLIC_SITE_URL: "https://app.example.com",
      },
    });

    expect(values).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      KAVERO_DEPLOYMENT_PROFILE: "cloud",
      KAVERO_AUTH_MODE: "google-password",
      KAVERO_STORAGE_PROVIDER: "kavero-managed",
      KAVERO_MANAGED_STORAGE_BACKEND: "supabase-storage",
    });
  });
});
