import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getClientSiteOrigin: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/auth/origin", () => ({
  getClientSiteOrigin: mocks.getClientSiteOrigin,
}));

import { LoginForm } from "./login-form";

const assignMock = vi.fn();

function authConfig(mode: "google" | "password" | "google-password") {
  return {
    mode,
    googleEnabled: mode === "google" || mode === "google-password",
    passwordEnabled: mode === "password" || mode === "google-password",
  };
}

function createSupabaseClient(overrides?: {
  signInWithOAuth?: ReturnType<typeof vi.fn>;
  signInWithPassword?: ReturnType<typeof vi.fn>;
  signUp?: ReturnType<typeof vi.fn>;
}) {
  return {
    auth: {
      signInWithOAuth: overrides?.signInWithOAuth ?? vi.fn().mockResolvedValue({ error: null }),
      signInWithPassword: overrides?.signInWithPassword ?? vi.fn().mockResolvedValue({ error: null }),
      signUp: overrides?.signUp ?? vi.fn().mockResolvedValue({ data: { session: { access_token: "token" } }, error: null }),
    },
  };
}

describe("LoginForm", () => {
  beforeEach(() => {
    mocks.getClientSiteOrigin.mockReturnValue("https://app.example");
    assignMock.mockReset();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        ...window.location,
        assign: assignMock,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders only the Google flow in google mode and uses a safe redirect path", async () => {
    const user = userEvent.setup();
    const client = createSupabaseClient();
    mocks.createClient.mockReturnValue(client);

    render(<LoginForm next="/auth/login" authConfig={authConfig("google")} />);

    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "https://app.example/auth/callback?next=%2F",
      },
    });
  });

  it("renders only email/password controls in password mode and signs in to the safe next path", async () => {
    const user = userEvent.setup();
    const client = createSupabaseClient();
    mocks.createClient.mockReturnValue(client);

    render(<LoginForm next="//evil.example" authConfig={authConfig("password")} />);

    expect(screen.queryByRole("button", { name: "Continue with Google" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret-pass",
    });
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith("/"));
  });

  it("renders both auth paths in mixed mode", () => {
    mocks.createClient.mockReturnValue(createSupabaseClient());

    render(<LoginForm next="/generate" authConfig={authConfig("google-password")} />);

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create account" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeInTheDocument();
  });

  it("shows a generic follow-up message when password sign-up succeeds without a session", async () => {
    const user = userEvent.setup();
    const client = createSupabaseClient({
      signUp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    });
    mocks.createClient.mockReturnValue(client);

    render(<LoginForm next="/gallery" authConfig={authConfig("password")} />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "secret-pass");
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret-pass",
    });
    expect(
      await screen.findByText("Account created. Check your email for next steps before signing in."),
    ).toBeInTheDocument();
    expect(assignMock).not.toHaveBeenCalled();
  });
});
