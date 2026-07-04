import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));

import { DELETE as deletePage, PUT as updatePage } from "@/app/api/pages/[pageId]/route";
import { POST as duplicatePage } from "@/app/api/pages/[pageId]/duplicate/route";
import { DELETE as deleteDesign, GET as getDesign, PUT as updateDesign } from "./[id]/route";
import { POST as createPage } from "./[id]/pages/route";
import { GET as listDesigns, POST as createDesign } from "./route";

type Plan = "free" | "premium";
type DriveStatus = "active" | "reconnect_required" | null;

const user = { id: "user-1" };

const designRow = {
  id: "design-1",
  user_id: user.id,
  name: "Launch Poster",
  canvas_json: "{}",
  width: 1080,
  height: 1080,
  thumbnail_url: null,
  metadata: {},
  created_at: "2026-06-28T00:00:00.000Z",
  updated_at: "2026-06-28T00:00:00.000Z",
};

const pageRow = {
  id: "page-1",
  user_id: user.id,
  design_id: designRow.id,
  title: "Page 1",
  canvas_json: "{}",
  sort_order: 0,
  metadata: {},
  created_at: "2026-06-28T00:00:00.000Z",
  updated_at: "2026-06-28T00:00:00.000Z",
};

const secondPageRow = {
  ...pageRow,
  id: "page-2",
  title: "Page 2",
  sort_order: 1,
};

describe("canvas design/page route access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn(async () => ({ data: { user }, error: null })),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows Local-first free users without Google Drive through design and page routes", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "local-first");
    const admin = createCanvasAdmin({ plan: "free", driveStatus: null });
    mocks.createAdminClient.mockReturnValue(admin);

    const listResponse = await listDesigns();
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject([{ id: "design-1", name: "Launch Poster" }]);

    const createDesignResponse = await createDesign(jsonRequest({ name: "New Design", canvas_json: "{}" }));
    expect(createDesignResponse.status).toBe(200);
    await expect(createDesignResponse.json()).resolves.toMatchObject({ id: "design-created", name: "New Design" });

    const getDesignResponse = await getDesign(new Request("http://localhost/canvas/api/designs/design-1"), designContext());
    expect(getDesignResponse.status).toBe(200);
    await expect(getDesignResponse.json()).resolves.toMatchObject({
      id: "design-1",
      pages: [
        { id: "page-1", title: "Page 1" },
        { id: "page-2", title: "Page 2" },
      ],
    });

    const updateDesignResponse = await updateDesign(
      jsonRequest({ name: "Renamed Design" }, "PUT"),
      designContext(),
    );
    expect(updateDesignResponse.status).toBe(200);
    await expect(updateDesignResponse.json()).resolves.toMatchObject({ id: "design-1", name: "Renamed Design" });

    const deleteDesignResponse = await deleteDesign(
      new Request("http://localhost/canvas/api/designs/design-1", { method: "DELETE" }),
      designContext(),
    );
    expect(deleteDesignResponse.status).toBe(200);
    await expect(deleteDesignResponse.json()).resolves.toEqual({ ok: true });

    const createPageResponse = await createPage(
      jsonRequest({ title: "New Page", canvas_json: "{}" }),
      designContext(),
    );
    expect(createPageResponse.status).toBe(200);
    await expect(createPageResponse.json()).resolves.toMatchObject({ id: "page-created", title: "New Page" });

    const updatePageResponse = await updatePage(
      jsonRequest({ title: "Renamed Page" }, "PUT"),
      pageContext(),
    );
    expect(updatePageResponse.status).toBe(200);
    await expect(updatePageResponse.json()).resolves.toMatchObject({ id: "page-1", title: "Renamed Page" });

    const deletePageResponse = await deletePage(
      new Request("http://localhost/api/pages/page-1", { method: "DELETE" }),
      pageContext(),
    );
    expect(deletePageResponse.status).toBe(200);
    await expect(deletePageResponse.json()).resolves.toEqual({ ok: true });

    const duplicatePageResponse = await duplicatePage(
      new Request("http://localhost/api/pages/page-1/duplicate", { method: "POST" }),
      pageContext(),
    );
    expect(duplicatePageResponse.status).toBe(200);
    await expect(duplicatePageResponse.json()).resolves.toMatchObject({ id: "page-copy", title: "Page 1 (copy)" });

    expect(admin.__mocks.from).toHaveBeenCalledWith("canvas_designs");
    expect(admin.__mocks.from).toHaveBeenCalledWith("canvas_pages");
  });

  it("keeps Cloud/default free users blocked by the premium gate", async () => {
    const admin = createCanvasAdmin({ plan: "free", driveStatus: "active" });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await listDesigns();

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Canvas is available on the premium plan.",
    });
  });

  it("keeps Cloud/default premium users without Google Drive blocked by the Drive gate", async () => {
    const admin = createCanvasAdmin({ plan: "premium", driveStatus: null });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await createDesign(jsonRequest({ name: "Blocked Design", canvas_json: "{}" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Connect Google Drive to use Canvas.",
    });
  });

  it("defaults invalid deployment profiles to Cloud and does not infer Local-first from storage envs", async () => {
    vi.stubEnv("KAVERO_DEPLOYMENT_PROFILE", "LOCAL-FIRST");
    vi.stubEnv("KAVERO_AUTH_MODE", "password");
    vi.stubEnv("KAVERO_STORAGE_PROVIDER", "kavero-managed");
    vi.stubEnv("KAVERO_MANAGED_STORAGE_BACKEND", "local-filesystem");
    vi.stubEnv("KAVERO_LOCAL_STORAGE_ROOT", "C:\\kavero-storage");
    const admin = createCanvasAdmin({ plan: "free", driveStatus: null });
    mocks.createAdminClient.mockReturnValue(admin);

    const response = await getDesign(new Request("http://localhost/canvas/api/designs/design-1"), designContext());

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "Canvas is available on the premium plan.",
    });
  });
});

function jsonRequest(body: Record<string, unknown>, method = "POST") {
  return new Request("http://localhost/canvas/api/designs", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function designContext(id = "design-1") {
  return { params: Promise.resolve({ id }) };
}

function pageContext(pageId = "page-1") {
  return { params: Promise.resolve({ pageId }) };
}

function createCanvasAdmin({ plan, driveStatus }: { plan: Plan; driveStatus: DriveStatus }) {
  const from = vi.fn((table: string) => createTableQuery(table, { plan, driveStatus }));
  const rpc = vi.fn(async () => ({ error: null }));

  return {
    from,
    rpc,
    __mocks: {
      from,
      rpc,
    },
  };
}

function createTableQuery(table: string, options: { plan: Plan; driveStatus: DriveStatus }) {
  const filters = new Map<string, unknown>();
  const state: {
    operation: "select" | "insert" | "update" | "delete";
    payload?: Record<string, unknown>;
    countSelect?: boolean;
  } = { operation: "select" };

  const query: Record<string, unknown> & {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    then: (resolve: (value: { error: null }) => void) => void;
  } = {
    select: vi.fn((_columns?: string, selectOptions?: { count?: string; head?: boolean }) => {
      state.countSelect = selectOptions?.count === "exact" && selectOptions.head === true;
      return query;
    }),
    eq: vi.fn((column: string, value: unknown) => {
      filters.set(column, value);
      return query;
    }),
    order: vi.fn(async () => listResult(table)),
    maybeSingle: vi.fn(async () => maybeSingleResult(table, filters, state)),
    single: vi.fn(async () => singleResult(table, state)),
    insert: vi.fn((payload: Record<string, unknown>) => {
      state.operation = "insert";
      state.payload = payload;
      return query;
    }),
    update: vi.fn((payload: Record<string, unknown>) => {
      state.operation = "update";
      state.payload = payload;
      return query;
    }),
    delete: vi.fn(() => {
      state.operation = "delete";
      return query;
    }),
    then: (resolve: (value: { count?: number; error: null }) => void) => {
      if (state.countSelect) {
        resolve(countResult(table));
        return;
      }
      resolve({ error: null });
    },
  };

  if (table === "user_metadata") {
    query.maybeSingle.mockImplementation(async () => ({ data: { plan: options.plan }, error: null }));
  }

  if (table === "user_drive_connections") {
    query.maybeSingle.mockImplementation(async () => ({
      data: options.driveStatus ? { status: options.driveStatus } : null,
      error: null,
    }));
  }

  return query;
}

function listResult(table: string) {
  if (table === "canvas_designs") return { data: [designRow], error: null };
  if (table === "canvas_pages") return { data: [pageRow, secondPageRow], error: null };
  return { data: [], error: null };
}

function maybeSingleResult(
  table: string,
  filters: Map<string, unknown>,
  state: { operation: "select" | "insert" | "update" | "delete"; payload?: Record<string, unknown> },
) {
  if (table === "canvas_designs") {
    if (state.operation === "update") {
      return { data: { ...designRow, ...state.payload }, error: null };
    }
    return { data: filters.get("id") === "missing" ? null : designRow, error: null };
  }

  if (table === "canvas_pages") {
    if (state.operation === "update") {
      return { data: { ...pageRow, ...state.payload }, error: null };
    }
    return { data: filters.get("id") === "missing" ? null : pageRow, error: null };
  }

  return { data: null, error: null };
}

function singleResult(
  table: string,
  state: { operation: "select" | "insert" | "update" | "delete"; payload?: Record<string, unknown> },
) {
  if (table === "canvas_designs") {
    return {
      data: { ...designRow, id: "design-created", ...state.payload },
      error: null,
    };
  }

  if (table === "canvas_pages") {
    const isDuplicate = state.payload?.title === "Page 1 (copy)";
    return {
      data: {
        ...pageRow,
        id: isDuplicate ? "page-copy" : "page-created",
        sort_order: isDuplicate ? 1 : 2,
        ...state.payload,
      },
      error: null,
    };
  }

  return { data: null, error: null };
}

function countResult(table: string) {
  if (table === "canvas_designs") return { count: 1, error: null };
  if (table === "canvas_pages") return { count: 2, error: null };
  return { count: 0, error: null };
}
