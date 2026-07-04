import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageSettingsPanel } from "./storage-settings-panel";

describe("StorageSettingsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          connected: false,
          plan: "free",
          usage: { used: 0, limit: 20 },
          connection: null,
        }),
      } as unknown as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps Cloud/default Google Drive status and connect UI", async () => {
    render(<StorageSettingsPanel />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/google-drive/status");
    });

    expect(screen.getByRole("heading", { name: "Google Drive" })).toBeInTheDocument();
    expect(screen.getByText(/Kavero creates a dedicated folder/i)).toBeInTheDocument();
    expect(screen.getByText("Free plan storage")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Connect Drive/i })).toHaveAttribute(
      "href",
      "/api/google-drive/connect?next=/settings/storage",
    );
  });

  it("shows Local-first Kavero storage copy without touching Google Drive routes", () => {
    render(<StorageSettingsPanel deploymentProfile="local-first" />);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Kavero storage" })).toBeInTheDocument();
    expect(screen.getByText("Provider")).toBeInTheDocument();
    expect(screen.getByText("kavero-managed")).toBeInTheDocument();
    expect(screen.getByText("Local managed storage")).toBeInTheDocument();
    expect(screen.getByText("Single-node app storage")).toBeInTheDocument();
    expect(screen.getByText("Local-first storage")).toBeInTheDocument();
    expect(screen.getByText(/Google Drive is not required for this profile/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Connect Drive/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Google account")).not.toBeInTheDocument();
  });
});
