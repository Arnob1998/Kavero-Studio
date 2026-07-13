import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createAdminClient: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { getUserProviderApiKey, getUserProviderCredentials } from "@/lib/provider-keys";

describe("provider key secret helpers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps getUserProviderApiKey compatible with legacy Gemini string secrets", async () => {
    mocks.createAdminClient.mockReturnValue(createAdmin("AIzaSy0123456789012345678901234"));

    await expect(getUserProviderApiKey("user-1", "google-gemini")).resolves.toBe(
      "AIzaSy0123456789012345678901234",
    );
  });

  it("loads generalized multi-field credentials without changing runtime callers", async () => {
    const credentials = {
      apiKey: "azure-key-012345678901234567890",
      apiBase: "https://kavero.openai.azure.com",
      apiVersion: "2025-04-01-preview",
      deploymentName: "deployment-one",
      baseModel: "gpt-4o",
    };
    mocks.createAdminClient.mockReturnValue(createAdmin(JSON.stringify(credentials)));

    await expect(getUserProviderCredentials("user-1", "azure-openai")).resolves.toEqual(credentials);
  });

  it("treats incomplete legacy Azure rows as unconfigured", async () => {
    mocks.createAdminClient.mockReturnValue(createAdmin(JSON.stringify({
      apiKey: "azure-key-012345678901234567890",
      apiBase: "https://kavero.openai.azure.com",
      apiVersion: "2025-04-01-preview",
    })));

    await expect(getUserProviderCredentials("user-1", "azure-openai")).resolves.toBeNull();
  });
});

function createAdmin(secret: string) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: { id: "key-1" }, error: null })),
  };
  return {
    from: vi.fn(() => query),
    rpc: vi.fn(async () => ({ data: secret, error: null })),
  };
}
