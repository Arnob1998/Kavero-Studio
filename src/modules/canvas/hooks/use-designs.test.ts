import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDesigns } from "./use-designs";
import { api } from "@/modules/canvas/persistence/editor-api";
import {
  deleteCanvasDraftsForDesign,
  getCanvasDraft,
  markCanvasDraftSynced,
} from "@/modules/canvas/state/drafts";
import type { Design, DesignWithPages, Page, Template } from "@/modules/canvas/types/editor-types";

vi.mock("@/modules/canvas/persistence/editor-api", () => ({
  api: vi.fn(),
}));

vi.mock("@/modules/canvas/state/drafts", () => ({
  deleteCanvasDraftsForDesign: vi.fn(async () => undefined),
  getCanvasDraft: vi.fn(async () => undefined),
  markCanvasDraftSynced: vi.fn(async () => undefined),
}));

const apiMock = vi.mocked(api);
const getCanvasDraftMock = vi.mocked(getCanvasDraft);
const deleteCanvasDraftsForDesignMock = vi.mocked(deleteCanvasDraftsForDesign);
const markCanvasDraftSyncedMock = vi.mocked(markCanvasDraftSynced);

function makeDesign(overrides: Partial<Design> = {}): Design {
  return {
    id: "design-1",
    name: "Launch Poster",
    canvas_json: "{}",
    width: 1080,
    height: 1080,
    thumbnail_url: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: "page-1",
    design_id: "design-1",
    title: "Page 1",
    canvas_json: "{}",
    sort_order: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: "template-1",
    name: "Square Promo",
    category: "social",
    canvas_json: "{\"objects\":[]}",
    width: 1080,
    height: 1080,
    thumbnail_url: null,
    sort_order: 1,
    ...overrides,
  };
}

function renderUseDesigns() {
  const getCanvasJSONForPage = vi.fn((pageId: string) =>
    pageId === "page-1" ? "{\"objects\":[{\"id\":\"rect-1\"}]}" : "{}",
  );
  const getCanvasSize = vi.fn(() => ({ width: 1080, height: 1080 }));
  const onError = vi.fn();
  const hook = renderHook(() => useDesigns(getCanvasJSONForPage, true, getCanvasSize, onError));

  return {
    ...hook,
    getCanvasJSONForPage,
    getCanvasSize,
    onError,
  };
}

async function waitForInitialLoad(result: ReturnType<typeof renderUseDesigns>["result"]) {
  await waitFor(() => expect(result.current.loading).toBe(false));
}

beforeEach(() => {
  vi.clearAllMocks();
  getCanvasDraftMock.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDesigns", () => {
  it("loads designs and templates through the canvas API helper", async () => {
    const design = makeDesign();
    const template = makeTemplate();
    apiMock.mockImplementation(async (method, path) => {
      if (method === "GET" && path === "/canvas/api/designs") return [design] as never;
      if (method === "GET" && path === "/api/templates") return [template] as never;
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });

    const { result } = renderUseDesigns();

    await waitForInitialLoad(result);

    expect(apiMock).toHaveBeenCalledWith("GET", "/canvas/api/designs");
    expect(apiMock).toHaveBeenCalledWith("GET", "/api/templates");
    expect(result.current.designs).toEqual([design]);
    expect(result.current.templates).toEqual([template]);
    expect(result.current.error).toBeNull();
  });

  it("creates a design through the existing request path and updates local state", async () => {
    const existingDesign = makeDesign({ id: "design-old", name: "Old Design" });
    const createdDesign = makeDesign({ id: "design-new", name: "Untitled Design" });
    apiMock.mockImplementation(async (method, path, body) => {
      if (method === "GET" && path === "/canvas/api/designs") return [existingDesign] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "POST" && path === "/canvas/api/designs") {
        expect(body).toEqual({ name: "Untitled Design", canvas_json: "{}" });
        return createdDesign as never;
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);

    let createdId: string | undefined;
    await act(async () => {
      createdId = await result.current.createDesign();
    });

    expect(createdId).toBe("design-new");
    expect(result.current.designs).toEqual([createdDesign, existingDesign]);
    expect(result.current.activeDesign).toEqual(createdDesign);
    expect(result.current.activeIdRef.current).toBe("design-new");
  });

  it("loads a design, applies dirty draft data, and selects the first page", async () => {
    const cleanPage = makePage({ id: "page-clean", title: "Clean", sort_order: 1, canvas_json: "{\"clean\":true}" });
    const dirtyPage = makePage({ id: "page-dirty", title: "Dirty", sort_order: 2, canvas_json: "{\"cloud\":true}" });
    const designWithPages: DesignWithPages = {
      ...makeDesign(),
      pages: [cleanPage, dirtyPage],
    };
    getCanvasDraftMock.mockImplementation(async (_designId, pageId) => {
      if (pageId !== "page-dirty") return undefined;
      return {
        key: "design-1:page-dirty",
        designId: "design-1",
        pageId: "page-dirty",
        canvasJson: "{\"draft\":true}",
        width: 1080,
        height: 1080,
        updatedAt: 1,
        cloudSyncedAt: null,
        dirty: true,
      };
    });
    apiMock.mockImplementation(async (method, path) => {
      if (method === "GET" && path === "/canvas/api/designs") return [] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "GET" && path === "/canvas/api/designs/design-1") return designWithPages as never;
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);

    await act(async () => {
      await result.current.loadDesign("design-1");
    });

    expect(getCanvasDraftMock).toHaveBeenCalledWith("design-1", "page-clean");
    expect(getCanvasDraftMock).toHaveBeenCalledWith("design-1", "page-dirty");
    expect(result.current.activeDesign).toEqual(designWithPages);
    expect(result.current.pages).toEqual([cleanPage, { ...dirtyPage, canvas_json: "{\"draft\":true}" }]);
    expect(result.current.activePageId).toBe("page-clean");
    expect(result.current.activePage).toEqual(cleanPage);
  });

  it("adds a page after the selected page and reloads page state", async () => {
    const firstPage = makePage({ id: "page-1", sort_order: 10 });
    const addedPage = makePage({ id: "page-2", title: "Page 2", sort_order: 20 });
    const initialDesign: DesignWithPages = { ...makeDesign(), pages: [firstPage] };
    const reloadedDesign: DesignWithPages = { ...makeDesign(), pages: [firstPage, addedPage] };
    apiMock.mockImplementation(async (method, path, body) => {
      if (method === "GET" && path === "/canvas/api/designs") return [] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "GET" && path === "/canvas/api/designs/design-1") {
        return (apiMock.mock.calls.some((call) => call[0] === "POST") ? reloadedDesign : initialDesign) as never;
      }
      if (method === "POST" && path === "/canvas/api/designs/design-1/pages") {
        expect(body).toEqual({ after_sort_order: 10 });
        return addedPage as never;
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);
    await act(async () => {
      await result.current.loadDesign("design-1");
    });

    await act(async () => {
      await result.current.addPage("page-1");
    });

    expect(result.current.pages).toEqual([firstPage, addedPage]);
    expect(result.current.activePageId).toBe("page-2");
  });

  it("renames designs and pages through the existing update paths", async () => {
    const design = makeDesign();
    const page = makePage();
    const designWithPages: DesignWithPages = { ...design, pages: [page] };
    const renamedDesign = makeDesign({ name: "Renamed Design" });
    const renamedPage = makePage({ title: "Renamed Page" });
    apiMock.mockImplementation(async (method, path, body) => {
      if (method === "GET" && path === "/canvas/api/designs") return [design] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "GET" && path === "/canvas/api/designs/design-1") return designWithPages as never;
      if (method === "PUT" && path === "/canvas/api/designs/design-1") {
        expect(body).toEqual({ name: "Renamed Design" });
        return renamedDesign as never;
      }
      if (method === "PUT" && path === "/api/pages/page-1") {
        expect(body).toEqual({ title: "Renamed Page" });
        return renamedPage as never;
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);
    await act(async () => {
      await result.current.loadDesign("design-1");
    });

    await act(async () => {
      await result.current.renameDesign("design-1", "Renamed Design");
      await result.current.renamePage("page-1", "Renamed Page");
    });

    expect(result.current.designs).toEqual([renamedDesign]);
    expect(result.current.activeDesign).toEqual(renamedDesign);
    expect(result.current.pages).toEqual([renamedPage]);
  });

  it("deletes pages and designs through the existing delete paths", async () => {
    const design = makeDesign();
    const firstPage = makePage({ id: "page-1", sort_order: 1 });
    const secondPage = makePage({ id: "page-2", sort_order: 2 });
    const designWithPages: DesignWithPages = { ...design, pages: [firstPage, secondPage] };
    apiMock.mockImplementation(async (method, path) => {
      if (method === "GET" && path === "/canvas/api/designs") return [design] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "GET" && path === "/canvas/api/designs/design-1") return designWithPages as never;
      if (method === "DELETE" && path === "/api/pages/page-1") return { ok: true } as never;
      if (method === "DELETE" && path === "/canvas/api/designs/design-1") return { ok: true } as never;
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);
    await act(async () => {
      await result.current.loadDesign("design-1");
    });

    await act(async () => {
      await result.current.deletePage("page-1");
    });

    expect(result.current.pages).toEqual([secondPage]);
    expect(result.current.activePageId).toBe("page-2");

    await act(async () => {
      await result.current.deleteDesign("design-1");
    });

    expect(result.current.designs).toEqual([]);
    expect(result.current.activeDesign).toBeNull();
    expect(result.current.activeIdRef.current).toBeNull();
    expect(deleteCanvasDraftsForDesignMock).toHaveBeenCalledWith("design-1");
  });

  it("surfaces API errors without hiding the returned message", async () => {
    const onError = vi.fn();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    apiMock.mockImplementation(async (method, path) => {
      if (method === "GET" && path === "/canvas/api/designs") return [] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "POST" && path === "/canvas/api/designs") {
        throw new Error("Canvas design limit reached (3)");
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const getCanvasJSONForPage = vi.fn(() => "{}");
    const { result } = renderHook(() => useDesigns(getCanvasJSONForPage, true, undefined, onError));
    await waitForInitialLoad(result);

    await act(async () => {
      await result.current.createDesign();
    });

    const feedback = "Canvas limit reached. You can keep up to 3 designs. Delete an old design to create a new one.";
    expect(result.current.error).toBe(feedback);
    expect(onError).toHaveBeenCalledWith(feedback);
    expect(consoleErrorSpy).not.toHaveBeenCalledWith("Failed to create design:", expect.anything());
  });

  it("saves page and design data through the existing paths and marks drafts synced", async () => {
    const design = makeDesign();
    const page = makePage();
    const designWithPages: DesignWithPages = { ...design, pages: [page] };
    const updatedPage = makePage({ canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}" });
    const updatedDesign = makeDesign({ canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}" });
    apiMock.mockImplementation(async (method, path, body) => {
      if (method === "GET" && path === "/canvas/api/designs") return [design] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "GET" && path === "/canvas/api/designs/design-1") return designWithPages as never;
      if (method === "PUT" && path === "/api/pages/page-1") {
        expect(body).toEqual({ canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}" });
        return updatedPage as never;
      }
      if (method === "PUT" && path === "/canvas/api/designs/design-1") {
        expect(body).toEqual({
          canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}",
          width: 1080,
          height: 1080,
        });
        return updatedDesign as never;
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);
    await act(async () => {
      await result.current.loadDesign("design-1");
    });

    await act(async () => {
      await result.current.saveDesign();
    });

    expect(result.current.pages).toEqual([updatedPage]);
    expect(result.current.activeDesign).toEqual(updatedDesign);
    expect(markCanvasDraftSyncedMock).toHaveBeenCalledWith("design-1", "page-1");
  });

  it("creates a design from a template without activating it", async () => {
    const existingDesign = makeDesign({ id: "design-old", name: "Old Design" });
    const template = makeTemplate({
      name: "Template Design",
      canvas_json: "{\"template\":true}",
      width: 1200,
      height: 628,
    });
    const createdDesign = makeDesign({
      id: "design-template",
      name: "Template Design",
      canvas_json: "{\"template\":true}",
      width: 1200,
      height: 628,
    });
    apiMock.mockImplementation(async (method, path, body) => {
      if (method === "GET" && path === "/canvas/api/designs") return [existingDesign] as never;
      if (method === "GET" && path === "/api/templates") return [template] as never;
      if (method === "POST" && path === "/canvas/api/designs") {
        expect(body).toEqual({
          name: "Template Design",
          canvas_json: "{\"template\":true}",
          width: 1200,
          height: 628,
        });
        return createdDesign as never;
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);

    let createdId: string | undefined;
    await act(async () => {
      createdId = await result.current.createFromTemplate(template);
    });

    expect(createdId).toBe("design-template");
    expect(result.current.designs).toEqual([createdDesign, existingDesign]);
    expect(result.current.activeDesign).toBeNull();
    expect(result.current.activeIdRef.current).toBeNull();
  });

  it("duplicates a page after best-effort pre-save and reloads page state", async () => {
    const design = makeDesign();
    const firstPage = makePage({ id: "page-1", sort_order: 1 });
    const duplicatedPage = makePage({ id: "page-copy", title: "Page 1 copy", sort_order: 2 });
    const initialDesign: DesignWithPages = { ...design, pages: [firstPage] };
    const reloadedDesign: DesignWithPages = { ...design, pages: [firstPage, duplicatedPage] };
    const savedPage = makePage({ id: "page-1", canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}" });
    let duplicateCalled = false;
    apiMock.mockImplementation(async (method, path, body) => {
      if (method === "GET" && path === "/canvas/api/designs") return [design] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "GET" && path === "/canvas/api/designs/design-1") {
        return (duplicateCalled ? reloadedDesign : initialDesign) as never;
      }
      if (method === "PUT" && path === "/api/pages/page-1") {
        expect(body).toEqual({ canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}" });
        return savedPage as never;
      }
      if (method === "POST" && path === "/api/pages/page-1/duplicate") {
        expect(body).toEqual({});
        duplicateCalled = true;
        return duplicatedPage as never;
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);
    await act(async () => {
      await result.current.loadDesign("design-1");
    });

    await act(async () => {
      await result.current.duplicatePage("page-1");
    });

    expect(result.current.pages).toEqual([firstPage, duplicatedPage]);
    expect(result.current.activePageId).toBe("page-copy");
    expect(markCanvasDraftSyncedMock).toHaveBeenCalledWith("design-1", "page-1");
  });

  it("debounces scheduled saves and runs the existing save path after the delay", async () => {
    const design = makeDesign();
    const page = makePage();
    const designWithPages: DesignWithPages = { ...design, pages: [page] };
    const updatedPage = makePage({ canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}" });
    const updatedDesign = makeDesign({ canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}" });
    apiMock.mockImplementation(async (method, path, body) => {
      if (method === "GET" && path === "/canvas/api/designs") return [design] as never;
      if (method === "GET" && path === "/api/templates") return [] as never;
      if (method === "GET" && path === "/canvas/api/designs/design-1") return designWithPages as never;
      if (method === "PUT" && path === "/api/pages/page-1") {
        expect(body).toEqual({ canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}" });
        return updatedPage as never;
      }
      if (method === "PUT" && path === "/canvas/api/designs/design-1") {
        expect(body).toEqual({
          canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}",
          width: 1080,
          height: 1080,
        });
        return updatedDesign as never;
      }
      throw new Error(`Unexpected API call: ${method} ${path}`);
    });
    const { result } = renderUseDesigns();
    await waitForInitialLoad(result);
    await act(async () => {
      await result.current.loadDesign("design-1");
    });

    vi.useFakeTimers();
    try {
      act(() => {
        result.current.scheduleSave();
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(9999);
      });
      expect(apiMock).not.toHaveBeenCalledWith("PUT", "/api/pages/page-1", expect.anything());
      expect(apiMock).not.toHaveBeenCalledWith("PUT", "/canvas/api/designs/design-1", expect.anything());

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });

      expect(apiMock).toHaveBeenCalledWith("PUT", "/api/pages/page-1", {
        canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}",
      });
      expect(apiMock).toHaveBeenCalledWith("PUT", "/canvas/api/designs/design-1", {
        canvas_json: "{\"objects\":[{\"id\":\"rect-1\"}]}",
        width: 1080,
        height: 1080,
      });
      expect(markCanvasDraftSyncedMock).toHaveBeenCalledWith("design-1", "page-1");
    } finally {
      vi.useRealTimers();
    }
  });
});
