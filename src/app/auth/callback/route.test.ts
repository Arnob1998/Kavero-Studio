import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getRequestSiteOrigin: vi.fn(),
  getSafeAuthRedirectPath: vi.fn(),
  getAuthModeConfig: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/auth/origin", () => ({
  getRequestSiteOrigin: mocks.getRequestSiteOrigin,
}));

vi.mock("@/lib/auth/redirect", () => ({
  getSafeAuthRedirectPath: mocks.getSafeAuthRedirectPath,
}));

vi.mock("@/lib/auth/config", () => ({
  getAuthModeConfig: mocks.getAuthModeConfig,
}));

import { GET } from "./route";

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRequestSiteOrigin.mockReturnValue("https://app.example");
    mocks.getSafeAuthRedirectPath.mockImplementation((value: string | null | undefined) => value ?? "/");
    mocks.getAuthModeConfig.mockReturnValue({
      mode: "google",
      googleEnabled: true,
      passwordEnabled: false,
    });
  });

  it("exchanges the auth code and redirects to the safe next path", async () => {
    const exchangeCodeForSession = vi.fn().mockResolvedValue({ error: null });
    mocks.createClient.mockResolvedValue({
      auth: {
        exchangeCodeForSession,
      },
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=abc123&next=%2Fcanvas"));

    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(response.headers.get("location")).toBe("https://app.example/canvas");
  });

  it("redirects to the auth error page when the auth code is missing", async () => {
    const response = await GET(new Request("https://app.example/auth/callback?next=%2Fcanvas"));

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.example/auth/auth-code-error");
  });

  it("fails gracefully when password-only auth mode is active", async () => {
    mocks.getAuthModeConfig.mockReturnValue({
      mode: "password",
      googleEnabled: false,
      passwordEnabled: true,
    });

    const response = await GET(new Request("https://app.example/auth/callback?code=abc123&next=%2Fcanvas"));

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.example/auth/auth-code-error");
  });
});
