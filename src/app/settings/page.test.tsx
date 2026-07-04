import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "./page";
import { createClient } from "@/lib/supabase/server";

vi.mock("@/components/site-nav", () => ({
  SiteNav: () => <nav aria-label="Main navigation">Settings navigation</nav>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps Cloud/default settings overview Drive and subscription oriented", async () => {
    mockSupabaseUser({ id: "user-1", email: "user@example.com" });

    await renderSettingsPage();

    expect(screen.getByText("Drive")).toBeInTheDocument();
    expect(screen.getByText("Free plan archive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Connect storage/i })).toHaveAttribute(
      "href",
      "/settings/storage",
    );
    expect(screen.getByRole("link", { name: /View subscription/i })).toHaveAttribute(
      "href",
      "/subscription",
    );
    expect(screen.queryByText("Managed storage")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View account details/i })).not.toBeInTheDocument();
  });

  it("uses Local-first managed storage copy without upgrade-oriented quick actions", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mockSupabaseUser({ id: "user-1", email: "user@example.com" });

    await renderSettingsPage();

    expect(screen.getAllByText("Kavero").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Managed storage")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review storage/i })).toHaveAttribute(
      "href",
      "/settings/storage",
    );
    expect(screen.getByRole("link", { name: /View account details/i })).toHaveAttribute(
      "href",
      "/subscription",
    );
    expect(screen.queryByRole("link", { name: /Connect storage/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View subscription/i })).not.toBeInTheDocument();
  });

  it("defaults invalid profiles to Cloud and does not infer Local-first from storage envs", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "LOCAL-FIRST");
    vi.stubEnv("KAVERO_STORAGE_PROVIDER", "kavero-managed");
    vi.stubEnv("KAVERO_MANAGED_STORAGE_BACKEND", "local-filesystem");
    vi.stubEnv("KAVERO_LOCAL_STORAGE_ROOT", "C:\\kavero-storage");
    mockSupabaseUser({ id: "user-1", email: "user@example.com" });

    await renderSettingsPage();

    expect(screen.getByText("Drive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Connect storage/i })).toBeInTheDocument();
    expect(screen.queryByText("Managed storage")).not.toBeInTheDocument();
  });
});

async function renderSettingsPage() {
  const page = await SettingsPage();
  render(page);
}

function mockSupabaseUser(user: { id: string; email: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: user
            ? {
                ...user,
                user_metadata: {},
              }
            : null,
        },
      }),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: { plan: "free" } }),
        })),
      })),
    })),
  } as any);
}
