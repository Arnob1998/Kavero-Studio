import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LeftSidebar } from "./left-sidebar";
import { useEditor } from "@/modules/canvas/state/context";
import type { SceneRelationMap } from "@/modules/canvas/state/relation-map";

const canvasAssetMocks = vi.hoisted(() => ({
  uploadCanvasAsset: vi.fn(),
}));

vi.mock("@/modules/canvas/state/context", () => ({
  useEditor: vi.fn(),
}));

vi.mock("@/modules/assets/canvas-assets", () => ({
  uploadCanvasAsset: canvasAssetMocks.uploadCanvasAsset,
}));

const relationMap: SceneRelationMap = {
  version: 1,
  designId: "design-1",
  pageId: "page-1",
  canvas: { width: 900, height: 600 },
  nodes: [
    {
      id: "canvas-background",
      objectId: null,
      type: "color",
      kind: "background",
      role: "background",
      bounds: { left: 0, top: 0, right: 900, bottom: 600, width: 900, height: 600 },
      zIndex: null,
      visible: true,
      metadata: { value: "#ffffff" },
    },
    {
      id: "card-1",
      objectId: "card-1",
      type: "rect",
      kind: "shape",
      role: "card",
      bounds: { left: 80, top: 160, right: 280, bottom: 400, width: 200, height: 240 },
      zIndex: 0,
      visible: true,
      metadata: { locked: true, text: null, image: null },
    },
    {
      id: "title-1",
      objectId: "title-1",
      type: "textbox",
      kind: "text",
      role: "heading",
      bounds: { left: 104, top: 190, right: 256, bottom: 226, width: 152, height: 36 },
      zIndex: 1,
      visible: true,
      metadata: { locked: false, text: "Plan One", image: null },
    },
    {
      id: "missing-image",
      objectId: "missing-image",
      type: "image",
      kind: "image",
      role: "image",
      bounds: { left: 320, top: 160, right: 460, bottom: 260, width: 140, height: 100 },
      zIndex: 2,
      visible: true,
      metadata: { locked: false, text: null, image: { src: "/api/canvas/assets/missing", status: "missing" } },
    },
    {
      id: "photo-1",
      objectId: "photo-1",
      type: "image",
      kind: "image",
      role: "image",
      bounds: { left: 500, top: 160, right: 640, bottom: 260, width: 140, height: 100 },
      zIndex: 3,
      visible: true,
      metadata: { locked: false, text: null, image: { src: "/api/canvas/assets/photo-1", status: "available" } },
    },
  ],
  edges: [
    {
      id: "card-1:title-1:contains",
      from: "card-1",
      to: "title-1",
      type: "contains",
      confidence: 0.88,
      metadata: { source: "geometry" },
    },
    {
      id: "title-1:card-1:inside",
      from: "title-1",
      to: "card-1",
      type: "inside",
      confidence: 0.88,
      metadata: { source: "geometry" },
    },
    {
      id: "card-1:missing-image:left-of",
      from: "card-1",
      to: "missing-image",
      type: "left-of",
      confidence: 0.76,
      distance: 40,
    },
  ],
};

function mockEditor(overrides: Record<string, unknown> = {}) {
  const selectLayer = vi.fn();
  const addImage = vi.fn();
  const executeCanvasTool = vi.fn(async (toolName: string) => {
    const summaries: Record<string, string> = {
      add_text: "Added heading.",
      transform_object: "Moved selected object.",
      delete_objects: "Deleted selected object.",
      undo: "Undid the last canvas edit.",
    };
    return {
      ok: true,
      toolName,
      changedObjectIds: toolName === "add_text" ? ["new-heading"] : ["title-1"],
      selectedObjectIds: toolName === "add_text" ? ["new-heading"] : ["title-1"],
      errors: [],
      summary: summaries[toolName] ?? "Applied canvas edit.",
    };
  });
  vi.mocked(useEditor).mockReturnValue({
    addText: vi.fn(),
    addShape: vi.fn(),
    addImage,
    showError: vi.fn(),
    layers: [],
    selectedObject: null,
    selectLayer,
    moveLayerToLevel: vi.fn(),
    getCanvasRelationMap: vi.fn(() => relationMap),
    getCanvasVisualPreview: vi.fn(() => ({
      status: "available",
      pageId: "page-1",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
      width: 900,
      height: 600,
      bytes: 3,
    })),
    getCanvasSceneSnapshot: vi.fn(() => ({
      version: 1,
      designId: "design-1",
      pageId: "page-1",
      canvas: { width: 900, height: 600 },
      selectedObjectIds: ["title-1"],
      background: { kind: "color", value: "#ffffff" },
      objects: [{ id: "title-1" }],
    })),
    executeCanvasTool,
    ...overrides,
  } as any);
  return { selectLayer, executeCanvasTool, addImage };
}

function mockAssistantFetch(body: Record<string, unknown>, status = 200) {
  const fetchMock = vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockMultiFetch(handler: (url: string, init?: RequestInit) => Record<string, unknown> | Response) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const result = handler(url, init);
    if (result instanceof Response) return result;
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function assistantResponse(toolCalls: unknown[] = [], message = "Assistant response.") {
  return {
    ok: true,
    provider: "mock",
    model: "test-model",
    message: { role: "assistant", content: message },
    context: {
      sceneSnapshot: true,
      relationMap: true,
      selectedObjectIds: ["title-1"],
      visualPreview: "available",
      visualPreviewBytes: 3,
      inspectedAssets: [],
    },
    tools: [],
    toolCalls,
    errors: [],
  };
}

describe("LeftSidebar relations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canvasAssetMocks.uploadCanvasAsset.mockResolvedValue({
      id: "uploaded-segment",
      original_name: "segment.png",
      content_type: "image/png",
      size_bytes: 123,
      public_url: "/api/canvas/assets/uploaded-segment",
      drive_status: "available",
      created_at: "2026-05-21T00:00:00.000Z",
    });
    mockAssistantFetch(assistantResponse());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens the relations panel and renders relation debug data", async () => {
    const user = userEvent.setup();
    mockEditor();

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Relations/i }));

    expect(screen.getByRole("heading", { name: "Relations" })).toBeInTheDocument();
    expect(screen.getByText("Objects")).toBeInTheDocument();
    expect(screen.getAllByText("Relations").length).toBeGreaterThan(1);
    expect(screen.getByText("Plan One")).toBeInTheDocument();
    expect(screen.getByText("shape / card")).toBeInTheDocument();
    expect(screen.getByText("contains")).toBeInTheDocument();
    expect(screen.getAllByText("88%").length).toBeGreaterThan(0);
  });

  it("selects the matching canvas object when an object row is clicked", async () => {
    const user = userEvent.setup();
    const { selectLayer } = mockEditor();

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Relations/i }));
    await user.click(screen.getByRole("button", { name: /Plan One/i }));

    expect(selectLayer).toHaveBeenCalledWith("title-1");
  });

  it("selects the target object when a relation row is clicked", async () => {
    const user = userEvent.setup();
    const { selectLayer } = mockEditor();

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Relations/i }));
    await user.click(screen.getByTitle("card-1 contains title-1"));

    expect(selectLayer).toHaveBeenCalledWith("title-1");
  });

  it("handles an empty relation map", async () => {
    const user = userEvent.setup();
    mockEditor({
      getCanvasRelationMap: vi.fn(() => ({
        ...relationMap,
        nodes: [],
        edges: [],
      })),
    });

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Relations/i }));

    expect(screen.getByText("Add objects to inspect hierarchy and relations")).toBeInTheDocument();
  });

  it("opens Auto Segment and uses a valid selected image source", async () => {
    const user = userEvent.setup();
    mockEditor({
      selectedObject: { kaveroAssetSrc: "/api/canvas/assets/photo-1", kaveroMeta: { name: "Product photo" } },
    });

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Segment/i }));

    expect(screen.getByRole("heading", { name: "Auto Segment" })).toBeInTheDocument();
    expect(screen.getByText("Product photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto Segment" })).toBeEnabled();
  });

  it("rejects non-image selections in Auto Segment", async () => {
    const user = userEvent.setup();
    mockEditor({
      selectedObject: { type: "rect", kaveroId: "shape-1" },
    });

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Segment/i }));

    expect(screen.getByText(/Shapes, text, groups, and missing images cannot be segmented/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Auto Segment" })).toBeDisabled();
  });

  it("renders Auto Segment groups and adds a segment to the canvas", async () => {
    const user = userEvent.setup();
    const { addImage } = mockEditor({
      selectedObject: { kaveroAssetSrc: "/api/canvas/assets/photo-1", kaveroMeta: { name: "Product photo" } },
    });
    canvasAssetMocks.uploadCanvasAsset.mockResolvedValueOnce({
      id: "product-cutout",
      original_name: "segment-products-product.png",
      content_type: "image/png",
      size_bytes: 123,
      public_url: "/api/canvas/assets/product-cutout",
      drive_status: "available",
      created_at: "2026-05-21T00:00:00.000Z",
    });
    const OriginalImage = globalThis.Image;
    vi.stubGlobal(
      "Image",
      class {
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    mockMultiFetch((url) => {
      if (String(url).startsWith("data:image/")) {
        return new Response("image", { headers: { "Content-Type": "image/png" } });
      }
      if (url === "/api/canvas/auto-segment") {
        return {
          sessionId: "segment-session",
          categories: [
            {
              key: "products",
              label: "Products",
              segments: [
                {
                  id: "product",
                  label: "Main product",
                  category: "products",
                  confidence: 0.91,
                  image: { dataUrl: "data:image/png;base64,AAAA", mimeType: "image/png" },
                },
              ],
            },
          ],
          warnings: [],
        };
      }
      return assistantResponse();
    });

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Segment/i }));
    await user.click(screen.getByRole("button", { name: "Auto Segment" }));

    expect(await screen.findByText("Products")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Main product/i }));

    expect(addImage).toHaveBeenCalledWith("/api/canvas/assets/product-cutout");
    vi.stubGlobal("Image", OriginalImage);
  });

  it("auto-applies a safe Copilot edit and renders the tool log", async () => {
    const user = userEvent.setup();
    const { executeCanvasTool } = mockEditor();
    mockAssistantFetch(
      assistantResponse(
        [
          {
            id: "tool-add-heading",
            name: "add_text",
            input: { preset: "heading", text: "New heading" },
            riskLevel: "low",
            status: "ready",
            errors: [],
            summary: 'Add text "New heading".',
          },
        ],
        "I can add that heading.",
      ),
    );

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Copilot/i }));
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "add a heading");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(executeCanvasTool).toHaveBeenCalledWith("add_text", { preset: "heading", text: "New heading" });
    await waitFor(() => expect(executeCanvasTool).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: "Toggle Copilot activity history" }));
    expect(await screen.findByText(/add_text/)).toBeInTheDocument();
    expect(screen.queryByText("Applied: Added heading.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve/i })).not.toBeInTheDocument();
  });

  it("blocks destructive Copilot edits until confirmation", async () => {
    const user = userEvent.setup();
    const { executeCanvasTool } = mockEditor({
      selectedObject: { kaveroId: "title-1" },
    });
    mockAssistantFetch(
      assistantResponse(
        [
          {
            id: "tool-delete",
            name: "delete_objects",
            input: { objectIds: ["title-1"] },
            riskLevel: "high",
            status: "requires_confirmation",
            errors: [],
            summary: "Delete 1 object. Confirmation is required.",
          },
        ],
        "I can delete the selected object after confirmation.",
      ),
    );

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Copilot/i }));
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "delete selected");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(executeCanvasTool).not.toHaveBeenCalled();
    expect(await screen.findByText(/delete_objects/)).toBeInTheDocument();
    expect(screen.getByText("Delete 1 object. Confirmation is required.")).toBeInTheDocument();
    expect(screen.getByText("Review proposed changes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Customize/i })).toBeInTheDocument();
  });

  it("confirms a blocked Copilot edit and renders the applied tool log", async () => {
    const user = userEvent.setup();
    const { executeCanvasTool } = mockEditor({
      selectedObject: { kaveroId: "title-1" },
    });
    mockAssistantFetch(
      assistantResponse([
        {
          id: "tool-delete",
          name: "delete_objects",
          input: { objectIds: ["title-1"] },
          riskLevel: "high",
          status: "requires_confirmation",
          errors: [],
          summary: "Delete 1 object. Confirmation is required.",
        },
      ]),
    );

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Copilot/i }));
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "delete selected");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: /Approve/i }));

    expect(executeCanvasTool).toHaveBeenCalledWith("delete_objects", { objectIds: ["title-1"] });
    expect(await screen.findByText(/delete_objects/)).toBeInTheDocument();
  });

  it("rejects a blocked Copilot edit without executing the tool", async () => {
    const user = userEvent.setup();
    const { executeCanvasTool } = mockEditor({
      selectedObject: { kaveroId: "title-1" },
    });
    mockAssistantFetch(
      assistantResponse([
        {
          id: "tool-delete",
          name: "delete_objects",
          input: { objectIds: ["title-1"] },
          riskLevel: "high",
          status: "requires_confirmation",
          errors: [],
          summary: "Delete 1 object. Confirmation is required.",
        },
      ]),
    );

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Copilot/i }));
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "delete selected");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await user.click(screen.getByRole("button", { name: /Reject/i }));

    expect(executeCanvasTool).not.toHaveBeenCalled();
    expect(screen.getByText("Rejected the proposed change. Send a revised instruction when you're ready.")).toBeInTheDocument();
  });

  it("auto-applies transform edits and undo through normal tool execution", async () => {
    const user = userEvent.setup();
    const { executeCanvasTool } = mockEditor({
      selectedObject: { kaveroId: "title-1" },
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            assistantResponse([
              {
                id: "tool-move",
                name: "transform_object",
                input: { objectId: "title-1", left: 100, top: 100 },
                riskLevel: "medium",
                status: "ready",
                errors: [],
                summary: "Move or transform object title-1.",
              },
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(assistantResponse([], "Done.")),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(assistantResponse([], "Reviewed final placement.")),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            assistantResponse([
              {
                id: "tool-undo",
                name: "undo",
                input: {},
                riskLevel: "low",
                status: "ready",
                errors: [],
                summary: "Undo the latest canvas edit.",
              },
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(assistantResponse([], "Done.")),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(assistantResponse([], "Reviewed final placement.")),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Copilot/i }));
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "move selected");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Done.")).toBeInTheDocument();
    expect(await screen.findByText("Reviewed final placement.")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "undo");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(executeCanvasTool).toHaveBeenCalledWith("transform_object", { objectId: "title-1", left: 100, top: 100 });
    expect(executeCanvasTool).toHaveBeenCalledWith("undo", {});
    expect(screen.queryByText("Applied: Moved selected object.")).not.toBeInTheDocument();
    expect(screen.queryByText("Applied: Undid the last canvas edit.")).not.toBeInTheDocument();
  });

  it("requires confirmation for page-level canvas changes", async () => {
    const user = userEvent.setup();
    const { executeCanvasTool } = mockEditor();
    mockAssistantFetch(
      assistantResponse([
        {
          id: "tool-size",
          name: "set_canvas_size",
          input: { width: 4000, height: 4000 },
          riskLevel: "medium",
          status: "requires_confirmation",
          errors: [],
          summary: "Resize canvas to 4000 x 4000. Confirmation is required.",
        },
      ]),
    );

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Copilot/i }));
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "resize canvas");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(executeCanvasTool).not.toHaveBeenCalled();
    expect(screen.getByText(/set_canvas_size/)).toBeInTheDocument();
    expect(screen.getByText("Resize canvas to 4000 x 4000. Confirmation is required.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve/i })).toBeInTheDocument();
  });

  it("routes explicit fix requests after reported issues into repair mode", async () => {
    const user = userEvent.setup();
    const { executeCanvasTool } = mockEditor({
      selectedObject: { kaveroId: "title-1" },
    });
    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify(assistantResponse([], "The text is clipped off the left edge.")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Copilot/i }));
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "what is wrong?");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("The text is clipped off the left edge.")).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "fix it");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    const fetchCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const repairCall = fetchCalls.find((call) => {
      const body = JSON.parse(call[1].body as string);
      return body.phase === "repair";
    });
    expect(repairCall).toBeTruthy();
    const repairBody = JSON.parse(repairCall![1].body as string);
    expect(repairBody.action).toBe("resume");
    expect(repairBody.phase).toBe("repair");
    expect(repairBody.customInstruction).toContain("Do not just restate the problem");
    expect(executeCanvasTool).not.toHaveBeenCalled();
  });

  it("recovers from mocked assistant errors and safe tool failures", async () => {
    const user = userEvent.setup();
    const executeCanvasTool = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        toolName: "add_text",
        changedObjectIds: [],
        errors: ["Tool failed in test."],
        summary: "Tool failed in test.",
      })
      .mockResolvedValueOnce({
        ok: true,
        toolName: "add_text",
        changedObjectIds: ["new-heading"],
        selectedObjectIds: ["new-heading"],
        errors: [],
        summary: "Added heading.",
      });
    mockEditor({
      executeCanvasTool,
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Mock assistant error: unable to prepare edit." }), {
          status: 502,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            assistantResponse([
              {
                id: "tool-add-heading",
                name: "add_text",
                input: { preset: "heading", text: "New heading" },
                riskLevel: "low",
                status: "ready",
                errors: [],
                summary: 'Add text "New heading".',
              },
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            assistantResponse([
              {
                id: "tool-add-heading-2",
                name: "add_text",
                input: { preset: "heading", text: "New heading" },
                riskLevel: "low",
                status: "ready",
                errors: [],
                summary: 'Add text "New heading".',
              },
            ]),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<LeftSidebar />);
    await user.click(screen.getByRole("button", { name: /Copilot/i }));
    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "mock error");
    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit...")).not.toBeDisabled());

    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "add a heading");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(screen.getByText("Tool failed: Tool failed in test.")).toBeInTheDocument();
    expect(screen.getAllByText(/Tool failed in test/).length).toBeGreaterThan(0);

    await user.type(screen.getByPlaceholderText("Ask Copilot to inspect or propose an edit..."), "add a heading");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(executeCanvasTool).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Applied: Added heading.")).not.toBeInTheDocument();
  });
});
