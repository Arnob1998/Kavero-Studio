import { describe, expect, it } from "vitest";
import {
  getConfigurationConnectivityResult,
  getFailedConnectivityResult,
  getSafeGatewayStatus,
  getSuccessfulConnectivityResult,
} from "./connectivity";
import type { ModelGatewayConfig } from "./types";

describe("model provider connectivity helpers", () => {
  it("redacts configured gateway credentials and internal URLs", () => {
    const config: Extract<ModelGatewayConfig, { status: "configured" }> = {
      status: "configured",
      gateway: "litellm",
      baseUrl: "http://litellm:4000",
      apiKey: "sk-secret",
    };

    const status = getSafeGatewayStatus(config);

    expect(status).toEqual({
      status: "configured",
      gateway: "litellm",
      configured: true,
      issues: [],
    });
    expect(JSON.stringify(status)).not.toContain("http://litellm:4000");
    expect(JSON.stringify(status)).not.toContain("sk-secret");
  });

  it("normalizes disabled and misconfigured gateway results without env keys", () => {
    expect(
      getConfigurationConnectivityResult(
        { status: "disabled", gateway: null, reason: "not-configured" },
        "2026-07-05T00:00:00.000Z",
      ),
    ).toEqual({
      status: "disabled",
      gateway: null,
      configured: false,
      checkedAt: "2026-07-05T00:00:00.000Z",
      checkedBy: "configuration",
      issues: [{ code: "not-configured", message: "Model gateway is not configured." }],
    });

    const errorResult = getConfigurationConnectivityResult(
      {
        status: "error",
        gateway: "litellm",
        issues: [
          {
            code: "missing-api-key",
            key: "KAVERO_LITELLM_API_KEY",
            message: "LiteLLM API key is required.",
          },
        ],
      },
      "2026-07-05T00:00:00.000Z",
    );

    expect(errorResult).toMatchObject({
      status: "error",
      issues: [{ code: "missing-api-key" }],
    });
    expect(JSON.stringify(errorResult)).not.toContain("KAVERO_LITELLM_API_KEY");
  });

  it("normalizes successful and failed live checks", () => {
    expect(getSuccessfulConnectivityResult("model-info", "2026-07-05T00:00:00.000Z")).toEqual({
      status: "configured",
      gateway: "litellm",
      configured: true,
      checkedAt: "2026-07-05T00:00:00.000Z",
      checkedBy: "model-info",
      issues: [],
    });

    expect(getFailedConnectivityResult("authentication_error", "2026-07-05T00:00:00.000Z")).toEqual({
      status: "error",
      gateway: "litellm",
      configured: true,
      checkedAt: "2026-07-05T00:00:00.000Z",
      checkedBy: "configuration",
      issues: [
        {
          code: "authentication_error",
          message: "Model gateway authentication failed.",
        },
      ],
    });
  });
});
