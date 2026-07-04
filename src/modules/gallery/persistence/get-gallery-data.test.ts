import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import { getGalleryData } from "./get-gallery-data";

describe("getGalleryData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockSupabase = ({
    connectionData = null,
    runsData = [],
    metadataData = null,
    generationCount = 0,
  }: {
    connectionData?: any;
    runsData?: any;
    metadataData?: any;
    generationCount?: any;
  } = {}) => {
    const generationRunsSelectMock = vi.fn((selector) => {
      if (selector === "id") {
        return {
          eq: vi.fn().mockResolvedValue({ count: generationCount }),
        };
      }
      return {
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: runsData }),
      };
    });

    const fromMock = vi.fn((table: string) => {
      if (table === "user_drive_connections") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: connectionData }),
        };
      }
      if (table === "generation_runs") {
        return {
          select: generationRunsSelectMock,
        };
      }
      if (table === "user_metadata") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: metadataData }),
        };
      }
      return {};
    });

    return {
      from: fromMock,
      __mocks: {
        generationRunsSelectMock,
      },
    } as any;
  };

  it("returns data correctly when all queries succeed", async () => {
    const mockConnection = { folder_name: "Test", google_email: "test@test.com", status: "active" };
    const mockRuns = [{ id: "run-1" }];
    const mockMetadata = { plan: "pro" };
    
    const supabase = createMockSupabase({
      connectionData: mockConnection,
      runsData: mockRuns,
      metadataData: mockMetadata,
      generationCount: 10,
    });

    const result = await getGalleryData(supabase, "user-1");

    expect(result.connection).toEqual(mockConnection);
    expect(result.runs).toEqual(mockRuns);
    expect(result.metadata).toEqual(mockMetadata);
    expect(result.generationCount).toBe(10);
  });

  it("selects generated image provider-neutral storage metadata fields", async () => {
    const supabase = createMockSupabase();

    await getGalleryData(supabase, "user-1");

    expect(supabase.__mocks.generationRunsSelectMock).toHaveBeenCalledWith(
      expect.stringContaining("storage_provider"),
    );
    expect(supabase.__mocks.generationRunsSelectMock).toHaveBeenCalledWith(
      expect.stringContaining("storage_ref"),
    );
    expect(supabase.__mocks.generationRunsSelectMock).toHaveBeenCalledWith(
      expect.stringContaining("metadata_storage_ref"),
    );
    expect(supabase.__mocks.generationRunsSelectMock).toHaveBeenCalledWith(
      expect.stringContaining("storage_external_url"),
    );
  });

  it("adds resolved storage refs for stored and legacy-only generated images", async () => {
    const storedImageRef: StoredObjectRef = {
      providerId: "google-drive",
      kind: "connected",
      purpose: "generated-image",
      objectKey: "stored-image",
      bucket: null,
      path: null,
      externalId: "stored-image",
      externalUrl: "https://drive.google.com/file/d/stored-image/view",
      metadata: { name: "stored.png" },
      status: "available",
      version: 1,
    };
    const storedMetadataRef: StoredObjectRef = {
      providerId: "google-drive",
      kind: "connected",
      purpose: "generated-metadata",
      objectKey: "stored-metadata",
      bucket: null,
      path: null,
      externalId: "stored-metadata",
      externalUrl: null,
      metadata: { name: "stored.json" },
      status: "available",
      version: 1,
    };
    const runsData = [
      {
        id: "run-1",
        generated_images: [
          {
            id: "image-1",
            variant: 1,
            mime_type: "image/png",
            drive_file_id: "drive-image-1",
            drive_file_name: "image-1.png",
            drive_web_view_link: "https://drive.google.com/file/d/drive-image-1/view",
            drive_metadata_file_id: "drive-metadata-1",
            drive_status: "available",
            storage_provider: "google-drive",
            storage_kind: "connected",
            storage_status: "available",
            storage_ref: storedImageRef,
            metadata_storage_ref: storedMetadataRef,
            storage_metadata: {},
            storage_external_id: "stored-image",
            storage_external_url: "https://drive.google.com/file/d/stored-image/view",
            created_at: "2026-05-26T12:00:00Z",
          },
          {
            id: "image-2",
            variant: 2,
            mime_type: "image/png",
            drive_file_id: "legacy-image-2",
            drive_file_name: "legacy-2.png",
            drive_web_view_link: "https://drive.google.com/file/d/legacy-image-2/view",
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
            created_at: "2026-05-26T12:01:00Z",
          },
        ],
      },
    ];
    const supabase = createMockSupabase({ runsData });

    const result = await getGalleryData(supabase, "user-1");

    expect(result.runs[0].generated_images?.[0].resolved_storage_ref).toEqual(storedImageRef);
    expect(result.runs[0].generated_images?.[0].resolved_metadata_storage_ref).toEqual(
      storedMetadataRef,
    );
    expect(result.runs[0].generated_images?.[1].resolved_storage_ref).toEqual({
      providerId: "google-drive",
      kind: "connected",
      purpose: "generated-image",
      objectKey: "legacy-image-2",
      bucket: null,
      path: null,
      externalId: "legacy-image-2",
      externalUrl: "https://drive.google.com/file/d/legacy-image-2/view",
      metadata: { name: "legacy-2.png" },
      status: "available",
      version: 1,
    });
    expect(result.runs[0].generated_images?.[1].resolved_metadata_storage_ref).toBeNull();
  });

  it("handles empty arrays/nulls appropriately", async () => {
    const supabase = createMockSupabase({
      connectionData: null,
      runsData: null as any,
      metadataData: null,
      generationCount: null as any,
    });

    const result = await getGalleryData(supabase, "user-1");

    expect(result.connection).toBeNull();
    expect(result.runs).toEqual([]);
    expect(result.metadata).toBeNull();
    expect(result.generationCount).toBeNull();
  });
});
