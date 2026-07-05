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

function validLocalDockerEnv(overrides = {}) {
  return {
    KAVERO_APP_PORT: "3000",
    SUPABASE_KONG_PORT: "54321",
    POSTGRES_DB: "postgres",
    POSTGRES_USER: "postgres",
    POSTGRES_PASSWORD: "password",
    SUPABASE_JWT_SECRET: "secret",
    SUPABASE_ANON_KEY: "anon.jwt",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    SUPABASE_INTERNAL_URL: "http://supabase-kong:8000",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "anon.jwt",
    SUPABASE_SERVICE_ROLE_KEY: "service.jwt",
    NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3000",
    KAVERO_API_ORIGIN: "http://127.0.0.1:3000",
    KAVERO_DEPLOYMENT_PROFILE: "local-first",
    KAVERO_AUTH_MODE: "password",
    KAVERO_STORAGE_PROVIDER: "kavero-managed",
    KAVERO_MANAGED_STORAGE_BACKEND: "local-filesystem",
    KAVERO_LOCAL_STORAGE_ROOT: "/data/kavero-storage",
    KAVERO_MODEL_GATEWAY: "litellm",
    KAVERO_LITELLM_BASE_URL: "http://litellm:4000",
    KAVERO_LITELLM_API_KEY: "sk-local-app",
    LITELLM_MASTER_KEY: "sk-local-master",
    OPENAI_API_KEY: "",
    GEMINI_API_KEY: "",
    GROQ_API_KEY: "",
    OLLAMA_BASE_URL: "http://host.docker.internal:11434",
    ...overrides,
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

  it("fails invalid LiteLLM gateway values", () => {
    const publicLiteLlmKey = `NEXT_PUBLIC_${"LITE" + "LLM"}_BASE_URL`;
    const checks = validateEnvForProfile({
      profileId: "local-docker",
      env: validLocalDockerEnv({
        KAVERO_MODEL_GATEWAY: "direct",
        KAVERO_LITELLM_BASE_URL: "not-a-url",
        KAVERO_LITELLM_API_KEY: "not-sk",
        LITELLM_MASTER_KEY: "sk-replace-with-litellm-master-key",
        [publicLiteLlmKey]: "http://litellm:4000",
      }),
    });

    expect(checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "fail", label: "KAVERO_MODEL_GATEWAY" }),
        expect.objectContaining({ status: "fail", label: "KAVERO_LITELLM_BASE_URL" }),
        expect.objectContaining({ status: "fail", label: "KAVERO_LITELLM_API_KEY" }),
        expect.objectContaining({ status: "fail", label: "LITELLM_MASTER_KEY" }),
        expect.objectContaining({ status: "fail", label: publicLiteLlmKey }),
      ]),
    );
  });

  it("allows blank optional provider envs and rejects placeholders or invalid URLs", () => {
    const validChecks = validateEnvForProfile({
      profileId: "local-docker",
      env: validLocalDockerEnv({
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        GROQ_API_KEY: "",
        OLLAMA_BASE_URL: "",
      }),
    });
    expect(validChecks.filter((item) => item.status === "fail")).toEqual([]);

    const invalidChecks = validateEnvForProfile({
      profileId: "local-docker",
      env: validLocalDockerEnv({
        OPENAI_API_KEY: "replace-with-openai-key",
        GEMINI_API_KEY: "sk-replace-with-gemini-key",
        OLLAMA_BASE_URL: "localhost:11434",
      }),
    });
    expect(invalidChecks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "fail", label: "OPENAI_API_KEY" }),
        expect.objectContaining({ status: "fail", label: "GEMINI_API_KEY" }),
        expect.objectContaining({ status: "fail", label: "OLLAMA_BASE_URL" }),
      ]),
    );
  });

  it("validates cloud/self-host gateway shape only when configured", () => {
    const blankChecks = validateEnvForProfile({
      profileId: "cloud-self-host",
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        NEXT_PUBLIC_SITE_URL: "https://app.example.com",
        KAVERO_DEPLOYMENT_PROFILE: "cloud",
        KAVERO_AUTH_MODE: "google",
        KAVERO_MODEL_GATEWAY: "",
        KAVERO_LITELLM_BASE_URL: "",
        KAVERO_LITELLM_API_KEY: "",
      },
    });
    expect(blankChecks.filter((item) => item.status === "fail")).toEqual([]);

    const configuredChecks = validateEnvForProfile({
      profileId: "cloud-self-host",
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        NEXT_PUBLIC_SITE_URL: "https://app.example.com",
        KAVERO_DEPLOYMENT_PROFILE: "cloud",
        KAVERO_AUTH_MODE: "google",
        KAVERO_MODEL_GATEWAY: "litellm",
        KAVERO_LITELLM_BASE_URL: "https://litellm.example.com",
        KAVERO_LITELLM_API_KEY: "sk-hosted-app",
      },
    });
    expect(configuredChecks.filter((item) => item.status === "fail")).toEqual([]);
  });

  it("passes a valid local Docker env and compose config", () => {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "kavero-doctor-"));
    try {
      writeFileSync(
        path.join(cwd, ".env.docker.local"),
        `${Object.entries(validLocalDockerEnv())
          .map(([key, value]) => `${key}=${value}`)
          .join("\n")}\n`,
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
