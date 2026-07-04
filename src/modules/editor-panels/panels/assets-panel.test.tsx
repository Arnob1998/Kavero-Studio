import React, { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AssetsPanel } from "./assets-panel";
import type { CanvasAsset } from "@/modules/assets/canvas-assets";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

function googleDriveRef(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "canvas-asset",
    objectKey: "drive-file-1",
    bucket: "google-drive",
    path: "drive-file-1",
    externalId: "drive-file-1",
    externalUrl: null,
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

function asset(overrides: Partial<CanvasAsset> = {}): CanvasAsset {
  return {
    id: "asset-1",
    original_name: "poster.png",
    content_type: "image/png",
    size_bytes: 2048,
    public_url: "/api/canvas/assets/asset-1",
    drive_file_id: "drive-file-1",
    drive_status: "available",
    storage_ref: null,
    storage_status: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderPanel(assets: CanvasAsset[], addImage = vi.fn()) {
  render(
    <AssetsPanel
      assets={assets}
      assetsLoading={false}
      uploading={false}
      uploadProgress={0}
      uploadLabel=""
      fileInputRef={createRef<HTMLInputElement>()}
      loadAssets={vi.fn()}
      handleDrop={vi.fn()}
      handleImageUpload={vi.fn()}
      addImage={addImage}
    />,
  );
  return { addImage };
}

describe("AssetsPanel", () => {
  it("adds available assets using the existing canvas asset content URL", async () => {
    const user = userEvent.setup();
    const { addImage } = renderPanel([asset({ storage_ref: googleDriveRef({ status: "available" }) })]);

    await user.click(screen.getByTitle("poster.png"));

    expect(addImage).toHaveBeenCalledWith("/api/canvas/assets/asset-1");
    expect(document.querySelector('img[src="/api/canvas/assets/asset-1"]')).toBeInTheDocument();
  });

  it("suppresses preview and add behavior for provider-neutral unavailable assets", async () => {
    const user = userEvent.setup();
    const { addImage } = renderPanel([
      asset({
        storage_ref: googleDriveRef({ status: "reconnect_required" }),
        storage_status: "reconnect_required",
      }),
    ]);

    await user.click(screen.getByTitle("poster.png"));

    expect(screen.getByText("Reconnect storage")).toBeInTheDocument();
    expect(document.querySelector('img[src="/api/canvas/assets/asset-1"]')).not.toBeInTheDocument();
    expect(addImage).not.toHaveBeenCalled();
  });
});
