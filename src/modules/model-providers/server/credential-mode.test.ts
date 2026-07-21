import { describe, expect, it } from "vitest";
import { getModelGatewayCredentialMode } from "./credential-mode";

describe("model gateway credential mode", () => {
  it.each(["env-or-user", "user-required", "env-only"] as const)(
    "accepts %s",
    (mode) => {
      expect(
        getModelGatewayCredentialMode({ KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE: mode }),
      ).toBe(mode);
    },
  );

  it("defaults blank and invalid values to env-or-user", () => {
    expect(getModelGatewayCredentialMode({})).toBe("env-or-user");
    expect(
      getModelGatewayCredentialMode({ KAVERO_MODEL_GATEWAY_CREDENTIAL_MODE: "invalid" }),
    ).toBe("env-or-user");
  });
});
