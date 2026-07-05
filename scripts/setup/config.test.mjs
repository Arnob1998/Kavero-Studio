import { describe, expect, it } from "vitest";
import {
  getEnabledAuthModes,
  getEnabledStorageChoices,
  getSetupProfile,
  requiredEnvKeysForProfile,
  sensitiveEnvKeys,
  setupStorageChoices,
} from "./config.mjs";

describe("setup config", () => {
  it("exposes supported profiles", () => {
    expect(getSetupProfile("local-docker")?.envFile).toBe(".env.docker.local");
    expect(getSetupProfile("cloud-self-host")?.envFile).toBe(".env.local");
  });

  it("exposes enabled auth modes from config", () => {
    expect(getEnabledAuthModes().map((mode) => mode.id)).toEqual([
      "google",
      "password",
      "google-password",
    ]);
    expect(getEnabledAuthModes("local-docker").map((mode) => mode.id)).toEqual(["password"]);
    expect(getEnabledAuthModes("cloud-self-host").map((mode) => mode.id)).toEqual([
      "google",
      "password",
      "google-password",
    ]);
  });

  it("does not expose disabled storage choices", () => {
    expect(setupStorageChoices.find((choice) => choice.id === "s3-compatible")?.enabled).toBe(false);
    expect(getEnabledStorageChoices("cloud-self-host").map((choice) => choice.id)).toEqual([
      "google-drive",
      "kavero-managed-supabase",
      "kavero-managed-local-filesystem",
    ]);
    expect(getEnabledStorageChoices("local-docker").map((choice) => choice.id)).toEqual([
      "kavero-managed-local-filesystem",
    ]);
  });

  it("treats gateway secrets and upstream provider keys as sensitive", () => {
    expect(sensitiveEnvKeys.has("KAVERO_LITELLM_API_KEY")).toBe(true);
    expect(sensitiveEnvKeys.has("LITELLM_MASTER_KEY")).toBe(true);
    expect(sensitiveEnvKeys.has("OPENAI_API_KEY")).toBe(true);
    expect(sensitiveEnvKeys.has("GEMINI_API_KEY")).toBe(true);
    expect(sensitiveEnvKeys.has("GROQ_API_KEY")).toBe(true);
  });

  it("requires the local Docker LiteLLM gateway shape", () => {
    expect(requiredEnvKeysForProfile("local-docker")).toEqual(
      expect.arrayContaining([
        "KAVERO_MODEL_GATEWAY",
        "KAVERO_LITELLM_BASE_URL",
        "KAVERO_LITELLM_API_KEY",
        "LITELLM_MASTER_KEY",
      ]),
    );
  });
});
