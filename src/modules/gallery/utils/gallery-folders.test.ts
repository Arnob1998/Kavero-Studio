import { describe, it, expect } from "vitest";
import { getGalleryFolders } from "./gallery-folders";
import type { GalleryRun, GalleryImage } from "../types";

describe("getGalleryFolders", () => {
  const mockImage: GalleryImage = {
    id: "img-1",
    variant: 1,
    mime_type: "image/png",
    drive_file_id: "drive-1",
    drive_file_name: "test.png",
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
  };

  const mockRun: GalleryRun = {
    id: "run-1",
    prompt: "A test prompt",
    model_id: "test-model",
    model_label: "Test Model",
    settings: { aspectRatio: "1:1" },
    generated_text: null,
    created_at: "2026-05-26T12:00:00Z",
    generated_images: [mockImage],
  };

  it("returns an empty array when given empty input", () => {
    expect(getGalleryFolders([])).toEqual([]);
  });

  it("filters out runs with null generated_images", () => {
    const runWithoutImages: GalleryRun = {
      ...mockRun,
      generated_images: null,
    };
    expect(getGalleryFolders([runWithoutImages])).toEqual([]);
  });

  it("filters out runs with empty generated_images array", () => {
    const runWithEmptyImages: GalleryRun = {
      ...mockRun,
      generated_images: [],
    };
    expect(getGalleryFolders([runWithEmptyImages])).toEqual([]);
  });

  it("maps a valid run to a gallery folder correctly", () => {
    const folders = getGalleryFolders([mockRun]);
    expect(folders).toHaveLength(1);
    
    const folder = folders[0];
    expect(folder.id).toBe(mockRun.id);
    expect(folder.prompt).toBe(mockRun.prompt);
    expect(folder.modelId).toBe(mockRun.model_id);
    expect(folder.modelLabel).toBe(mockRun.model_label);
    expect(folder.settings).toEqual(mockRun.settings);
    expect(folder.generatedText).toBe(mockRun.generated_text);
    expect(folder.createdAt).toBe(mockRun.created_at);
    expect(folder.imageCount).toBe(1);
    expect(folder.coverImage).toEqual(mockImage);
    expect(folder.images).toEqual([mockImage]);
  });

  it("provides empty object for missing settings", () => {
    const runNoSettings: GalleryRun = {
      ...mockRun,
      settings: null as unknown as Record<string, string>, // Simulating bad DB data
    };
    const folders = getGalleryFolders([runNoSettings]);
    expect(folders[0].settings).toEqual({});
  });

  it("sorts folders by createdAt date descending", () => {
    const olderRun: GalleryRun = {
      ...mockRun,
      id: "run-older",
      created_at: "2026-05-25T12:00:00Z",
    };
    const newerRun: GalleryRun = {
      ...mockRun,
      id: "run-newer",
      created_at: "2026-05-27T12:00:00Z",
    };

    const folders = getGalleryFolders([olderRun, newerRun, mockRun]);
    
    expect(folders).toHaveLength(3);
    expect(folders[0].id).toBe("run-newer");
    expect(folders[1].id).toBe("run-1");
    expect(folders[2].id).toBe("run-older");
  });

  it("handles missing Drive file/image metadata accurately without crashing", () => {
    const missingDriveImage: GalleryImage = {
      ...mockImage,
      drive_status: "missing",
    };
    const runWithMissingDrive: GalleryRun = {
      ...mockRun,
      generated_images: [missingDriveImage],
    };

    const folders = getGalleryFolders([runWithMissingDrive]);
    expect(folders).toHaveLength(1);
    expect(folders[0].coverImage.drive_status).toBe("missing");
    expect(folders[0].images[0].drive_status).toBe("missing");
  });
});
