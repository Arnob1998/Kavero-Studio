import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAssistantRequest } from "./handle-assistant-request";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

const mocks = vi.hoisted(() => ({
  getCanvasUser: vi.fn(),
  requireCanvasAccess: vi.fn(),
  getCanvasAdmin: vi.fn(),
  getUserProviderApiKey: vi.fn(),
}));

vi.mock("@/lib/canvas/api", () => ({
  getCanvasUser: mocks.getCanvasUser,
  requireCanvasAccess: mocks.requireCanvasAccess,
  getCanvasAdmin: mocks.getCanvasAdmin,
}));

vi.mock("@/lib/provider-keys", () => ({
  getUserProviderApiKey: mocks.getUserProviderApiKey,
}));

type AssetRow = {
  id: string;
  public_url: string | null;
  content_type: string | null;
  size_bytes: number | null;
  drive_file_id: string | null;
  drive_status: "available" | "missing" | "unknown";
  storage_ref?: unknown;
  storage_kind?: unknown;
  storage_status?: unknown;
  storage_metadata?: unknown;
  storage_external_id?: unknown;
  storage_external_url?: unknown;
};

function googleDriveRef(overrides: Partial<StoredObjectRef> = {}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: "canvas-asset",
    objectKey: "ref-drive-file",
    bucket: "google-drive",
    path: "ref-drive-file",
    externalId: "ref-drive-file",
    externalUrl: null,
    metadata: {},
    status: "available",
    version: 1,
    ...overrides,
  };
}

function asset(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: "asset-1",
    public_url: "/api/canvas/assets/asset-1",
    content_type: "image/png",
    size_bytes: 1024,
    drive_file_id: "legacy-drive-file",
    drive_status: "available",
    storage_ref: null,
    storage_kind: null,
    storage_status: null,
    storage_metadata: {},
    storage_external_id: null,
    storage_external_url: null,
    ...overrides,
  };
}

function createAdmin(assetRows: Record<string, AssetRow | null>) {
  const selects: string[] = [];

  return {
    __selects: selects,
    from(table: string) {
      const state = {
        table,
        select: "",
        filters: new Map<string, unknown>(),
      };
      const query = {
        select(value: string) {
          state.select = value;
          selects.push(value);
          return query;
        },
        eq(column: string, value: unknown) {
          state.filters.set(column, value);
          return query;
        },
        async maybeSingle() {
          if (state.table === "canvas_pages") {
            return { data: { id: "page-1", design_id: "design-1" }, error: null };
          }

          if (state.table === "canvas_assets") {
            const assetId = String(state.filters.get("id"));
            const row = assetRows[assetId] ?? null;
            if (!row) return { data: null, error: null };
            if (state.select === "id") return { data: { id: row.id }, error: null };
            return { data: row, error: null };
          }

          return { data: null, error: null };
        },
      };
      return query;
    },
  };
}

function request(assetIdsToInspect: string[]) {
  return new Request("http://localhost/api/canvas/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      designId: "design-1",
      pageId: "page-1",
      messages: [{ role: "user", content: "inspect the uploaded assets" }],
      assetIdsToInspect,
    }),
  });
}

async function inspectAsset(row: AssetRow | null) {
  const admin = createAdmin({ "asset-1": row });
  mocks.getCanvasAdmin.mockReturnValue(admin);
  const response = await handleAssistantRequest(request(["asset-1"]));
  const body = await response.json();
  return { admin, response, body };
}

describe("handleAssistantRequest asset inspection", () => {
  beforeEach(() => {
    vi.stubEnv("CANVAS_ASSISTANT_PROVIDER", "mock");
    vi.stubGlobal("fetch", vi.fn());
    mocks.getCanvasUser.mockResolvedValue({ id: "user-1" });
    mocks.requireCanvasAccess.mockResolvedValue({ response: null });
    mocks.getUserProviderApiKey.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("selects provider-neutral storage fields for inspected assets", async () => {
    const { admin } = await inspectAsset(asset({ storage_ref: googleDriveRef() }));

    expect(admin.__selects).toContain(
      "id, public_url, content_type, size_bytes, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    );
  });

  it("reports an available asset from a valid Google Drive storage_ref", async () => {
    const { body } = await inspectAsset(asset({ storage_ref: googleDriveRef({ status: "available" }) }));

    expect(body.context.inspectedAssets).toEqual([
      {
        assetId: "asset-1",
        status: "available",
        mimeType: "image/png",
        bytes: 1024,
        publicUrl: "/api/canvas/assets/asset-1",
      },
    ]);
  });

  it("uses legacy drive_status when storage_ref is missing", async () => {
    const { body } = await inspectAsset(asset({ storage_ref: null, drive_status: "missing" }));

    expect(body.context.inspectedAssets[0]).toMatchObject({ assetId: "asset-1", status: "missing" });
  });

  it("falls back to legacy drive_status when storage_ref is malformed", async () => {
    const { body } = await inspectAsset(asset({ storage_ref: { providerId: "google-drive" }, drive_status: "available" }));

    expect(body.context.inspectedAssets[0]).toMatchObject({ assetId: "asset-1", status: "available" });
  });

  it.each(["missing", "reconnect_required", "unavailable", "unknown"] as const)(
    "maps provider-neutral %s storage_ref status to missing inspection status",
    async (status) => {
      const { body } = await inspectAsset(asset({ storage_ref: googleDriveRef({ status }) }));

      expect(body.context.inspectedAssets[0]).toMatchObject({ assetId: "asset-1", status: "missing" });
    },
  );

  it("does not fetch asset bytes for unsupported provider refs", async () => {
    const { body } = await inspectAsset(
      asset({
        storage_ref: googleDriveRef({
          providerId: "kavero-managed",
          kind: "managed",
          bucket: null,
          path: null,
          externalId: null,
          status: "available",
        }),
      }),
    );

    expect(body.context.inspectedAssets[0]).toMatchObject({ assetId: "asset-1", status: "available" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
