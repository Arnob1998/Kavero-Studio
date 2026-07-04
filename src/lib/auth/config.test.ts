import { describe, expect, it } from "vitest";
import { getAuthModeConfigFromEnv } from "./config";

describe("getAuthModeConfigFromEnv", () => {
  it("defaults to google when the env var is missing", () => {
    expect(getAuthModeConfigFromEnv({})).toEqual({
      mode: "google",
      googleEnabled: true,
      passwordEnabled: false,
    });
  });

  it("defaults to google when the env var is blank", () => {
    expect(getAuthModeConfigFromEnv({ KAVERO_AUTH_MODE: "   " })).toEqual({
      mode: "google",
      googleEnabled: true,
      passwordEnabled: false,
    });
  });

  it("defaults to google for invalid auth modes", () => {
    expect(getAuthModeConfigFromEnv({ KAVERO_AUTH_MODE: "github" })).toEqual({
      mode: "google",
      googleEnabled: true,
      passwordEnabled: false,
    });
  });

  it("enables password auth when explicitly configured", () => {
    expect(getAuthModeConfigFromEnv({ KAVERO_AUTH_MODE: "password" })).toEqual({
      mode: "password",
      googleEnabled: false,
      passwordEnabled: true,
    });
  });

  it("enables both auth paths in mixed mode", () => {
    expect(getAuthModeConfigFromEnv({ KAVERO_AUTH_MODE: "google-password" })).toEqual({
      mode: "google-password",
      googleEnabled: true,
      passwordEnabled: true,
    });
  });
});
