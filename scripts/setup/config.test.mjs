import { describe, expect, it } from "vitest";
import {
  getEnabledAuthModes,
  getEnabledStorageChoices,
  getSetupProfile,
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
});
