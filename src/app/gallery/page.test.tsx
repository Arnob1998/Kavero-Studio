import React from "react";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GalleryImage, GalleryRun } from "@/modules/gallery/types";
import GalleryPage from "./page";
import { createClient } from "@/lib/supabase/server";
import { getGalleryData } from "@/modules/gallery/persistence/get-gallery-data";

vi.mock("@/components/site-nav", () => ({
  SiteNav: () => <nav aria-label="Main navigation">Gallery navigation</nav>,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/modules/gallery/persistence/get-gallery-data", () => ({
  getGalleryData: vi.fn(),
}));

const mockCreateClient = vi.mocked(createClient);
const mockGetGalleryData = vi.mocked(getGalleryData);

describe("GalleryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the sign-in gate for unauthenticated users", async () => {
    mockSupabaseUser(null);

    await renderGalleryPage();

    expect(screen.getByRole("heading", { name: "Sign in to open Gallery" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/auth/login?next=/gallery",
    );
    expect(mockGetGalleryData).not.toHaveBeenCalled();
  });

  it("keeps Cloud/default gated on an active Google Drive connection", async () => {
    mockSupabaseUser({ id: "user-1" });
    mockGetGalleryData.mockResolvedValue(
      galleryData({
        connection: null,
        runs: [run()],
      }),
    );

    await renderGalleryPage();

    expect(screen.getByRole("heading", { name: "Connect Google Drive" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Drive" })).toHaveAttribute(
      "href",
      "/api/google-drive/connect?next=/gallery",
    );
    expect(screen.queryByText("A local-first gallery prompt")).not.toBeInTheDocument();
  });

  it("defaults invalid deployment profiles to Cloud and does not infer Local-first from storage envs", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "LOCAL-FIRST");
    vi.stubEnv("KAVERO_STORAGE_PROVIDER", "kavero-managed");
    vi.stubEnv("KAVERO_MANAGED_STORAGE_BACKEND", "local-filesystem");
    vi.stubEnv("KAVERO_LOCAL_STORAGE_ROOT", "C:\\kavero-storage");
    mockSupabaseUser({ id: "user-1" });
    mockGetGalleryData.mockResolvedValue(
      galleryData({
        connection: null,
        runs: [run()],
      }),
    );

    await renderGalleryPage();

    expect(screen.getByRole("heading", { name: "Connect Google Drive" })).toBeInTheDocument();
    expect(screen.queryByText("A local-first gallery prompt")).not.toBeInTheDocument();
  });

  it("renders Local-first Gallery history without an active Google Drive connection", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mockSupabaseUser({ id: "user-1" });
    mockGetGalleryData.mockResolvedValue(
      galleryData({
        connection: null,
        runs: [run()],
        generationCount: 1,
      }),
    );

    await renderGalleryPage();

    expect(screen.queryByRole("heading", { name: "Connect Google Drive" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gallery" })).toBeInTheDocument();
    expect(screen.getByText("Kavero storage")).toBeInTheDocument();
    expect(screen.getByText("Generated images saved through Kavero storage.")).toBeInTheDocument();
    expect(screen.getByText("A local-first gallery prompt")).toBeInTheDocument();
  });

  it("uses neutral Local-first empty Gallery copy without active Google Drive", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    mockSupabaseUser({ id: "user-1" });
    mockGetGalleryData.mockResolvedValue(
      galleryData({
        connection: null,
        runs: [],
        generationCount: 0,
      }),
    );

    await renderGalleryPage();

    expect(screen.getByRole("heading", { name: "No saved generations yet" })).toBeInTheDocument();
    expect(screen.getByText("Kavero storage")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Generate an image and it will appear here from Kavero storage with its prompt and settings.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Connect Google Drive" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Drive is connected/i)).not.toBeInTheDocument();
  });
});

async function renderGalleryPage(searchParams: { generation?: string } = {}) {
  const page = await GalleryPage({ searchParams: Promise.resolve(searchParams) });
  render(page);
}

function mockSupabaseUser(user: { id: string } | null) {
  mockCreateClient.mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
      }),
    },
  } as any);
}

function galleryData({
  connection = { folder_name: "Kavero Gallery", google_email: "user@example.com", status: "active" },
  runs = [],
  metadata = { plan: "free" },
  generationCount = runs.length,
}: {
  connection?: { folder_name: string; google_email: string | null; status: string } | null;
  runs?: GalleryRun[];
  metadata?: { plan: string } | null;
  generationCount?: number | null;
}) {
  return {
    connection,
    runs,
    metadata,
    generationCount,
  };
}

function run(overrides: Partial<GalleryRun> = {}): GalleryRun {
  return {
    id: "generation-1",
    prompt: "A local-first gallery prompt",
    model_id: "gemini-model",
    model_label: "Gemini",
    settings: { aspectRatio: "1:1" },
    generated_text: null,
    created_at: "2026-06-28T12:00:00.000Z",
    generated_images: [image()],
    ...overrides,
  };
}

function image(overrides: Partial<GalleryImage> = {}): GalleryImage {
  return {
    id: "image-1",
    variant: 1,
    mime_type: "image/png",
    drive_file_id: null,
    drive_file_name: null,
    drive_web_view_link: null,
    drive_metadata_file_id: null,
    drive_status: "available",
    storage_provider: "kavero-managed",
    storage_kind: "managed",
    storage_status: "available",
    storage_ref: null,
    metadata_storage_ref: null,
    storage_metadata: null,
    storage_external_id: null,
    storage_external_url: null,
    resolved_storage_ref: null,
    resolved_metadata_storage_ref: null,
    created_at: "2026-06-28T12:00:00.000Z",
    ...overrides,
  };
}
