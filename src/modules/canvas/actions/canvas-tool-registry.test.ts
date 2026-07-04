import { describe, expect, it, vi } from "vitest";
import {
  CANVAS_TOOL_REGISTRY,
  canvasToolFailure,
  canvasToolSuccess,
  executeCanvasTool,
  type CanvasToolExecutionContext,
  type CanvasToolName,
} from "./canvas-tool-registry";

function createContext(overrides: Partial<CanvasToolExecutionContext> = {}) {
  const calls: string[] = [];
  const success = (name: CanvasToolName, summary: string = name, changedObjectIds: string[] = ["obj-1"]) => {
    calls.push(name);
    return canvasToolSuccess(name, summary, { changedObjectIds });
  };
  const context: CanvasToolExecutionContext = {
    addText: vi.fn(() => success("add_text")),
    addShape: vi.fn(() => success("add_shape")),
    addUploadedImage: vi.fn(() => success("add_uploaded_image")),
    generateImageAsset: vi.fn(() => success("generate_image_asset")),
    setBackground: vi.fn(() => success("set_background", "background", [])),
    setImageAsBackground: vi.fn(() => success("set_image_as_background", "image background")),
    removeBackgroundImage: vi.fn(() => success("remove_background_image", "removed background", [])),
    setCanvasSize: vi.fn(() => success("set_canvas_size", "size", [])),
    updateObject: vi.fn(() => success("update_object")),
    transformObject: vi.fn(() => success("transform_object")),
    rotateObject: vi.fn(() => success("rotate_object")),
    flipObject: vi.fn(() => success("flip_object")),
    setObjectPerspective: vi.fn(() => success("set_object_perspective")),
    setImageBorderRadius: vi.fn(() => success("set_image_border_radius")),
    getImageObjectInfo: vi.fn(() => success("get_image_object_info", "image info", [])),
    cropImageObject: vi.fn(() => success("crop_image_object")),
    resetImageCrop: vi.fn(() => success("reset_image_crop")),
    fitObjectsInCanvas: vi.fn(() => success("fit_objects_in_canvas")),
    repairCanvasOverflow: vi.fn(() => success("repair_canvas_overflow")),
    normalizeTextBox: vi.fn(() => success("normalize_text_box")),
    layoutStack: vi.fn(() => success("layout_stack")),
    alignObject: vi.fn(() => success("align_object")),
    reorderObject: vi.fn(() => success("reorder_object")),
    selectObject: vi.fn(() => canvasToolSuccess("select_object", "selected", { selectedObjectIds: ["obj-1"] })),
    deleteObjects: vi.fn(() => success("delete_objects")),
    duplicateObjects: vi.fn(() => success("duplicate_objects", "duplicated", ["obj-copy"])),
    setObjectShadow: vi.fn(() => success("set_object_shadow")),
    setObjectBlur: vi.fn(() => success("set_object_blur")),
    setObjectBlendMode: vi.fn(() => success("set_object_blend_mode")),
    undo: vi.fn(() => canvasToolSuccess("undo", "undone")),
    redo: vi.fn(() => canvasToolSuccess("redo", "redone")),
    save: vi.fn(() => canvasToolSuccess("save", "saved")),
    ...overrides,
  };
  return { context, calls };
}

describe("canvas tool registry", () => {
  it("defines metadata for every editor canvas tool", () => {
    expect(Object.keys(CANVAS_TOOL_REGISTRY).sort()).toEqual([
      "add_shape",
      "add_text",
      "add_uploaded_image",
      "align_object",
      "crop_image_object",
      "delete_objects",
      "duplicate_objects",
      "fit_objects_in_canvas",
      "flip_object",
      "generate_image_asset",
      "get_image_object_info",
      "layout_stack",
      "normalize_text_box",
      "redo",
      "remove_background_image",
      "reorder_object",
      "repair_canvas_overflow",
      "reset_image_crop",
      "rotate_object",
      "save",
      "select_object",
      "set_background",
      "set_canvas_size",
      "set_image_as_background",
      "set_image_border_radius",
      "set_object_blend_mode",
      "set_object_blur",
      "set_object_perspective",
      "set_object_shadow",
      "transform_object",
      "undo",
      "update_object",
    ]);
    expect(CANVAS_TOOL_REGISTRY.delete_objects.riskLevel).toBe("high");
    expect(CANVAS_TOOL_REGISTRY.add_text.description).toContain("text");
  });

  it.each([
    ["add_text", { preset: "heading", text: "Hello" }, "addText"],
    ["add_shape", { type: "rect" }, "addShape"],
    ["add_uploaded_image", { assetId: "asset_1", position: { x: 10, y: 20 } }, "addUploadedImage"],
    ["generate_image_asset", { prompt: "A transparent blue bird sticker", transparentBackground: true }, "generateImageAsset"],
    ["set_background", { type: "color", value: "#ffffff" }, "setBackground"],
    ["set_image_as_background", { objectId: "obj-1", fit: "contain" }, "setImageAsBackground"],
    ["remove_background_image", { mode: "detach" }, "removeBackgroundImage"],
    ["set_canvas_size", { width: 1200, height: 630 }, "setCanvasSize"],
    ["update_object", { objectId: "obj-1", props: { fill: "#000000", opacity: 0.5 } }, "updateObject"],
    ["transform_object", { objectId: "obj-1", left: 10, width: 240, rotation: 20 }, "transformObject"],
    ["rotate_object", { objectId: "obj-1", rotation: 141 }, "rotateObject"],
    ["flip_object", { objectId: "obj-1", mode: "horizontal" }, "flipObject"],
    ["set_object_perspective", { objectId: "obj-1", skewX: 12, skewY: -8 }, "setObjectPerspective"],
    ["set_image_border_radius", { objectId: "obj-1", radius: 24 }, "setImageBorderRadius"],
    ["get_image_object_info", { objectId: "obj-1" }, "getImageObjectInfo"],
    ["crop_image_object", { objectId: "obj-1", crop: { unit: "source_px", x: 10, y: 20, width: 300, height: 200 } }, "cropImageObject"],
    ["reset_image_crop", { objectId: "obj-1" }, "resetImageCrop"],
    ["fit_objects_in_canvas", { objectIds: ["obj-1"], padding: 32 }, "fitObjectsInCanvas"],
    ["repair_canvas_overflow", { scope: "all", padding: 32 }, "repairCanvasOverflow"],
    ["normalize_text_box", { objectId: "obj-1", maxWidth: 420 }, "normalizeTextBox"],
    ["layout_stack", { objectIds: ["obj-1"], direction: "vertical", bounds: { left: 20, top: 20, width: 400, height: 300 } }, "layoutStack"],
    ["align_object", { objectId: "obj-1", alignment: "center" }, "alignObject"],
    ["reorder_object", { objectId: "obj-1", action: "front" }, "reorderObject"],
    ["select_object", { objectId: "obj-1" }, "selectObject"],
    ["delete_objects", { objectIds: ["obj-1"] }, "deleteObjects"],
    ["duplicate_objects", { objectIds: ["obj-1"] }, "duplicateObjects"],
    ["undo", {}, "undo"],
    ["redo", {}, "redo"],
    ["save", {}, "save"],
  ] as const)("validates and executes %s", async (name, input, method) => {
    const { context } = createContext();

    const result = await executeCanvasTool(name, input, context);

    expect(result.ok).toBe(true);
    expect(context[method]).toHaveBeenCalledTimes(1);
  });

  it("normalizes uploaded asset IDs to Kavero asset URLs", async () => {
    const { context } = createContext();

    await executeCanvasTool("add_uploaded_image", { assetId: "abc_123" }, context);

    expect(context.addUploadedImage).toHaveBeenCalledWith({ assetUrl: "/api/canvas/assets/abc_123", position: undefined });
  });

  it("rejects arbitrary image URLs and file paths", async () => {
    const { context } = createContext();

    const external = await executeCanvasTool("add_uploaded_image", { assetUrl: "https://example.com/a.png" }, context);
    const filePath = await executeCanvasTool("set_background", { type: "image", value: "C:/tmp/a.png" }, context);

    expect(external.ok).toBe(false);
    expect(filePath.ok).toBe(false);
    expect(context.addUploadedImage).not.toHaveBeenCalled();
    expect(context.setBackground).not.toHaveBeenCalled();
  });

  it("clamps unsafe numeric values before execution", async () => {
    const { context } = createContext();

    const size = await executeCanvasTool("set_canvas_size", { width: 99999, height: 10 }, context);
    const transform = await executeCanvasTool("transform_object", { objectId: "obj-1", scaleX: 100 }, context);
    const update = await executeCanvasTool("update_object", { objectId: "obj-1", props: { opacity: 2 } }, context);

    expect(size.ok).toBe(true);
    expect(transform.ok).toBe(true);
    expect(update.ok).toBe(true);
    expect(context.setCanvasSize).toHaveBeenCalledWith({ width: 5000, height: 64 });
    expect(context.transformObject).toHaveBeenCalledWith({ objectId: "obj-1", scaleX: 20 });
    expect(context.updateObject).toHaveBeenCalledWith({ objectId: "obj-1", props: { opacity: 1 } });
  });

  it("normalizes rotation inputs to signed degrees", async () => {
    const { context } = createContext();

    await executeCanvasTool("transform_object", { objectId: "obj-1", rotation: 270 }, context);
    await executeCanvasTool("rotate_object", { objectId: "obj-1", rotation: -270 }, context);

    expect(context.transformObject).toHaveBeenCalledWith({ objectId: "obj-1", rotation: -90 });
    expect(context.rotateObject).toHaveBeenCalledWith({ objectId: "obj-1", rotation: 90 });
    expect(CANVAS_TOOL_REGISTRY.rotate_object.jsonSchema.properties).toMatchObject({
      rotation: { minimum: -180, maximum: 180 },
    });
  });

  it("exposes absolute flip modes to assistant tools", async () => {
    const { context } = createContext();

    await executeCanvasTool("flip_object", { objectId: "obj-1", mode: "both" }, context);

    expect(context.flipObject).toHaveBeenCalledWith({ objectId: "obj-1", mode: "both" });
    expect(CANVAS_TOOL_REGISTRY.flip_object.jsonSchema.properties).toMatchObject({
      mode: { enum: ["none", "horizontal", "vertical", "both"] },
    });
  });

  it("clamps perspective skew inputs for assistant tools", async () => {
    const { context } = createContext();

    await executeCanvasTool("set_object_perspective", { objectId: "obj-1", skewX: 90, skewY: -90 }, context);
    await executeCanvasTool("transform_object", { objectId: "obj-1", skewX: 72 }, context);

    expect(context.setObjectPerspective).toHaveBeenCalledWith({ objectId: "obj-1", skewX: 60, skewY: -60 });
    expect(context.transformObject).toHaveBeenCalledWith({ objectId: "obj-1", skewX: 60 });
    expect(CANVAS_TOOL_REGISTRY.set_object_perspective.jsonSchema.properties).toMatchObject({
      skewX: { minimum: -60, maximum: 60 },
      skewY: { minimum: -60, maximum: 60 },
    });
  });

  it("returns structured executor errors", async () => {
    const { context } = createContext({
      updateObject: vi.fn(() => canvasToolFailure("update_object", "Object obj-missing was not found.")),
    });

    const result = await executeCanvasTool("update_object", { objectId: "obj-missing", props: { fill: "#fff" } }, context);

    expect(result).toMatchObject({
      ok: false,
      toolName: "update_object",
      changedObjectIds: [],
      errors: ["Object obj-missing was not found."],
    });
  });

  it("surfaces thrown executor errors as structured failures", async () => {
    const { context } = createContext({
      save: vi.fn(() => {
        throw new Error("Save failed.");
      }),
    });

    const result = await executeCanvasTool("save", {}, context);

    expect(result).toMatchObject({
      ok: false,
      toolName: "save",
      errors: ["Save failed."],
    });
  });

  it("keeps undo and redo as explicit deterministic tools", async () => {
    const { context } = createContext();

    const undo = await executeCanvasTool("undo", {}, context);
    const redo = await executeCanvasTool("redo", {}, context);

    expect(undo.summary).toBe("undone");
    expect(redo.summary).toBe("redone");
    expect(context.undo).toHaveBeenCalledTimes(1);
    expect(context.redo).toHaveBeenCalledTimes(1);
  });
});
