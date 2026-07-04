import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor, validateEnvForProfile } from "./doctor.mjs";

function spawnOk(command, args) {
  return {
    status: 0,
    stdout: command === "node" ? "v24.0.0" : args.join(" "),
    stderr: "",
  };
}

describe("setup doctor", () => {
  it("reports missing and placeholder env values", () => {
    const checks = validateEnvForProfile({
      profileId: "cloud-self-host",
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "replace-with-key",
        SUPABASE_SERVICE_ROLE_KEY: "",
        NEXT_PUBLIC_SITE_URL: "not a url",
        KAVERO_DEPLOYMENT_PROFILE: "cloud",
        KAVERO_AUTH_MODE: "google",
      },
    });

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "fail", label: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" }),
        expect.objectContaining({ status: "fail", label: "SUPABASE_SERVICE_ROLE_KEY" }),
        expect.objectContaining({ status: "fail", label: "NEXT_PUBLIC_SITE_URL" }),
      ]),
    );
  });

  it("passes a valid local Docker env and compose config", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kavero-doctor-"));
    try {
      writeFileSync(
        path.join(cwd, ".env.docker.local"),
        [
          "KAVERO_APP_PORT=3000",
          "SUPABASE_KONG_PORT=54321",
          "POSTGRES_DB=postgres",
          "POSTGRES_USER=postgres",
          "POSTGRES_PASSWORD=password",
          "SUPABASE_JWT_SECRET=secret",
          "SUPABASE_ANON_KEY=anon.jwt",
          "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
          "SUPABASE_INTERNAL_URL=http://supabase-kong:8000",
          "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=anon.jwt",
          "SUPABASE_SERVICE_ROLE_KEY=service.jwt",
          "NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000",
          "KAVERO_API_ORIGIN=http://127.0.0.1:3000",
          "KAVERO_DEPLOYMENT_PROFILE=local-first",
          "KAVERO_AUTH_MODE=password",
          "KAVERO_STORAGE_PROVIDER=kavero-managed",
          "KAVERO_MANAGED_STORAGE_BACKEND=local-filesystem",
          "KAVERO_LOCAL_STORAGE_ROOT=/data/kavero-storage",
          "",
        ].join("\n"),
      );

      const result = runDoctor({
        profileId: "local-docker",
        cwd,
        spawnSyncImpl: spawnOk,
      });
      expect(result.summary.ok).toBe(true);
      expect(result.checks.find((item) => item.label === "Compose config")?.status).toBe("pass");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
