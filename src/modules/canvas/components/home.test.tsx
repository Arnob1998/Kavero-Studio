import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Home } from "@/modules/canvas/components/home";

const baseProps = {
  designs: [],
  navigate: vi.fn(),
  createDesign: vi.fn(async () => "design-1"),
  deleteDesign: vi.fn(),
  renameDesign: vi.fn(),
  error: null,
  clearError: vi.fn(),
};

function mockAssetsFetch(assets: unknown[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/canvas/assets") {
      return new Response(JSON.stringify({
        assets,
        usage: { designs: 0, pages: 0, assets: assets.length, assetBytes: 0 },
        limits: {
          designsPerUser: 3,
          pagesPerDesign: 5,
          canvasJsonBytesPerPage: 1000000,
          driveAssetsPerUser: 200,
          driveAssetBytesPerFile: 10000000,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.startsWith("/api/canvas/assets/") && init?.method === "DELETE") {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Home", () => {
  it("renders the Kavero app shell", async () => {
    mockAssetsFetch();
    render(<Home {...baseProps} />);

    expect(screen.getByRole("heading", { name: "Kavero Canvas" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Recent" })).toBeInTheDocument();
    expect(screen.getByText("No designs yet")).toBeInTheDocument();
    await screen.findByText("No assets yet");
  });

  it("creates a design and navigates to its editor route", async () => {
    const user = userEvent.setup();
    mockAssetsFetch();
    const props = {
      ...baseProps,
      navigate: vi.fn(),
      createDesign: vi.fn(async () => "design-42"),
    };

    render(<Home {...props} />);
    await screen.findByText("No assets yet");
    await user.click(screen.getByRole("button", { name: /New design/i }));

    expect(props.createDesign).toHaveBeenCalledTimes(1);
    expect(props.navigate).toHaveBeenCalledWith("/design/design-42");
  });

  it("confirms asset deletion with the themed dialog", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.fn();
    vi.stubGlobal("confirm", confirmSpy);
    const fetchMock = mockAssetsFetch([
      {
        id: "asset-1",
        original_name: "poster.png",
        content_type: "image/png",
        size_bytes: 2048,
        public_url: "/api/canvas/assets/asset-1",
        drive_web_view_link: null,
        drive_status: "available",
        last_used_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    render(<Home {...baseProps} />);

    await screen.findByText("poster.png");
    await user.click(screen.getByTitle("Delete forever"));

    expect(confirmSpy).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Delete asset forever?" });
    expect(dialog).toBeInTheDocument();

    await user.click(within(dialog).getByRole("button", { name: "Delete forever" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/canvas/assets/asset-1", { method: "DELETE" });
    });
  });

  it("renders available asset previews with canvas asset content URLs", async () => {
    mockAssetsFetch([
      {
        id: "asset-1",
        original_name: "poster.png",
        content_type: "image/png",
        size_bytes: 2048,
        public_url: "/api/canvas/assets/asset-1",
        drive_file_id: "drive-file-1",
        drive_web_view_link: null,
        drive_status: "available",
        storage_ref: {
          providerId: "google-drive",
          kind: "connected",
          purpose: "canvas-asset",
          objectKey: "drive-file-1",
          externalId: "drive-file-1",
          status: "available",
          version: 1,
        },
        storage_status: "available",
        last_used_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const { container } = render(<Home {...baseProps} />);

    await screen.findByText("poster.png");

    expect(container.querySelector('img[src="/api/canvas/assets/asset-1"]')).toBeInTheDocument();
  });

  it("suppresses previews for provider-neutral unavailable assets", async () => {
    mockAssetsFetch([
      {
        id: "asset-1",
        original_name: "poster.png",
        content_type: "image/png",
        size_bytes: 2048,
        public_url: "/api/canvas/assets/asset-1",
        drive_file_id: "drive-file-1",
        drive_web_view_link: null,
        drive_status: "available",
        storage_ref: {
          providerId: "google-drive",
          kind: "connected",
          purpose: "canvas-asset",
          objectKey: "drive-file-1",
          externalId: "drive-file-1",
          status: "unavailable",
          version: 1,
        },
        storage_status: "unavailable",
        last_used_at: "2026-01-01T00:00:00.000Z",
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ]);
    const { container } = render(<Home {...baseProps} />);

    await screen.findByText("poster.png");

    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    expect(container.querySelector('img[src="/api/canvas/assets/asset-1"]')).not.toBeInTheDocument();
  });
});
