import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/modules/canvas/persistence/editor-api";
import {
  createDesign,
  createPage,
  deleteDesign,
  deletePage,
  duplicatePage,
  getDesign,
  listDesigns,
  listTemplates,
  updateDesign,
  updatePage,
} from "./designs-repository";

vi.mock("@/modules/canvas/persistence/editor-api", () => ({
  api: vi.fn(async () => ({})),
}));

const apiMock = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("designs repository", () => {
  it("preserves design and template list endpoints", async () => {
    await listDesigns();
    await listTemplates();

    expect(apiMock).toHaveBeenCalledWith("GET", "/canvas/api/designs");
    expect(apiMock).toHaveBeenCalledWith("GET", "/api/templates");
  });

  it("preserves design create, read, update, and delete endpoints", async () => {
    const createInput = { name: "Untitled Design", canvas_json: "{}" };
    const updateInput = { canvas_json: "{\"objects\":[]}", width: 1080, height: 1080 };

    await createDesign(createInput);
    await getDesign("design-1");
    await updateDesign("design-1", updateInput);
    await deleteDesign("design-1");

    expect(apiMock).toHaveBeenCalledWith("POST", "/canvas/api/designs", createInput);
    expect(apiMock).toHaveBeenCalledWith("GET", "/canvas/api/designs/design-1");
    expect(apiMock).toHaveBeenCalledWith("PUT", "/canvas/api/designs/design-1", updateInput);
    expect(apiMock).toHaveBeenCalledWith("DELETE", "/canvas/api/designs/design-1");
  });

  it("preserves page create, update, delete, and duplicate endpoints", async () => {
    const createInput = { after_sort_order: 10 };
    const updateInput = { title: "Renamed Page" };

    await createPage("design-1", createInput);
    await updatePage("page-1", updateInput);
    await deletePage("page-1");
    await duplicatePage("page-1");

    expect(apiMock).toHaveBeenCalledWith("POST", "/canvas/api/designs/design-1/pages", createInput);
    expect(apiMock).toHaveBeenCalledWith("PUT", "/api/pages/page-1", updateInput);
    expect(apiMock).toHaveBeenCalledWith("DELETE", "/api/pages/page-1");
    expect(apiMock).toHaveBeenCalledWith("POST", "/api/pages/page-1/duplicate", {});
  });
});
