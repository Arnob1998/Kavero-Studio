import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GalleryCard } from "./gallery-card";
import { GenerationFolderCard } from "./generation-folder-card";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import type { GalleryFolder, GalleryImage } from "../types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

function image(overrides: Partial<GalleryImage> = {}): GalleryImage {
  return {
    id: "image-1",
    variant: 1,
    mime_type: "image/png",
    drive_file_id: "drive-file-1",
    drive_file_name: "image.png",
    drive_web_view_link: null,
    drive_metadata_file_id: null,
    drive_status: "available",
    storage_provider: null,
    storage_kind: null,
    storage_status: null,
    storage_ref: null,
    metadata_storage_ref: null,
    storage_metadata: null,
    storage_external_id: null,
    storage_external_url: null,
    resolved_storage_ref: null,
    resolved_metadata_storage_ref: null,
    created_at: "2026-05-26T12:00:00Z",
    ...overrides,
  };
}

function folder(overrides: Partial<GalleryFolder> = {}): GalleryFolder {
  const coverImage = image();

  return {
    id: "generation-1",
    prompt: "A gallery prompt",
    modelId: "model-1",
    modelLabel: "Model 1",
    settings: {},
    generatedText: null,
    createdAt: "2026-05-26T12:00:00Z",
    imageCount: 1,
    coverImage,
    images: [coverImage],
    ...overrides,
  };
}

function ref(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "generated-image",
    objectKey: "drive-file-1",
    bucket: null,
    path: null,
    externalId: "drive-file-1",
    externalUrl: null,
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

describe("Gallery image preview URLs", () => {
  it("renders GalleryCard preview through the provider-neutral content route", () => {
    const { container } = render(
      <GalleryCard image={image({ id: "image 1/2" })} folder={folder()} />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/api/gallery/images/image%201%2F2/content",
    );
  });

  it("renders GenerationFolderCard cover preview through the provider-neutral content route", () => {
    const { container } = render(
      <GenerationFolderCard
        folder={folder({
          coverImage: image({ id: "cover 1/2" }),
          images: [image({ id: "cover 1/2" })],
        })}
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "/api/gallery/images/cover%201%2F2/content",
    );
  });

  it("keeps missing Drive images on the missing placeholder instead of rendering a preview image", () => {
    const { container } = render(
      <GalleryCard
        image={image({ drive_status: "missing" })}
        folder={folder({ coverImage: image({ drive_status: "missing" }) })}
      />,
    );

    expect(screen.getByText("Missing in Drive")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders provider-neutral reconnect placeholders instead of preview images", () => {
    const { container } = render(
      <GalleryCard image={image({ storage_status: "reconnect_required" })} folder={folder()} />,
    );

    expect(screen.getByText("Reconnect storage")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders provider-neutral unavailable placeholders instead of preview images", () => {
    const { container } = render(
      <GalleryCard image={image({ storage_status: "unavailable" })} folder={folder()} />,
    );

    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("renders provider-neutral unknown placeholders instead of preview images", () => {
    const { container } = render(
      <GalleryCard image={image({ storage_status: "unknown" })} folder={folder()} />,
    );

    expect(screen.getByText("Storage status unknown")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });

  it("uses resolved storage status for generation folder covers", () => {
    const coverImage = image({ resolved_storage_ref: ref({ status: "unavailable" }) });
    const { container } = render(
      <GenerationFolderCard folder={folder({ coverImage, images: [coverImage] })} />,
    );

    expect(screen.getByText("Image unavailable")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
