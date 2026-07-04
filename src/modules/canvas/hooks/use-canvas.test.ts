import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { normalizeCanvasImageSources, useCanvasState } from "./use-canvas";

describe("useCanvasState", () => {
  it("re-exports image source normalization for canvas JSON", () => {
    const canvasJson = {
      objects: [
        {
          type: "image",
          src: "https://example.com/api/canvas/assets/asset_123",
          nested: {
            kaveroAssetSrc: "/api/canvas/assets/asset_nested",
          },
        },
        {
          type: "image",
          kaveroBgSrc: "http://kavero.local/api/canvas/assets/background-1",
        },
        {
          type: "image",
          src: "https://example.com/not-a-canvas-asset.png",
        },
      ],
    };

    const result = normalizeCanvasImageSources(canvasJson);

    expect(result).toBe(canvasJson);
    expect(canvasJson.objects[0]).toMatchObject({
      src: "/api/canvas/assets/asset_123",
      kaveroAssetSrc: "/api/canvas/assets/asset_123",
      crossOrigin: "anonymous",
    });
    expect(canvasJson.objects[0].nested).toMatchObject({
      src: "/api/canvas/assets/asset_nested",
      kaveroAssetSrc: "/api/canvas/assets/asset_nested",
      crossOrigin: "anonymous",
    });
    expect(canvasJson.objects[1]).toMatchObject({
      src: "/api/canvas/assets/background-1",
      kaveroAssetSrc: "/api/canvas/assets/background-1",
      kaveroBgSrc: "/api/canvas/assets/background-1",
      kaveroKind: "background-image",
      selectable: false,
      evented: false,
      hasControls: false,
      lockMovementX: true,
      lockMovementY: true,
      lockScalingX: true,
      lockScalingY: true,
      lockRotation: true,
      crossOrigin: "anonymous",
    });
    expect(canvasJson.objects[2]).toEqual({
      type: "image",
      src: "https://example.com/not-a-canvas-asset.png",
    });
  });

  it("returns the current initial canvas API shape without an active Fabric canvas", () => {
    const { result } = renderHook(() => useCanvasState());

    expect(result.current.activeCanvasId).toBeNull();
    expect(result.current.canvas).toBeNull();
    expect(result.current.selectedObject).toBeNull();
    expect(result.current.canvasWidth).toBe(1080);
    expect(result.current.canvasHeight).toBe(1080);
    expect(result.current.zoom).toBe(0.58);
    expect(result.current.fitScale).toBe(0.58);
    expect(result.current.snapEnabled).toBe(true);
    expect(result.current.layers).toEqual([]);
    expect(result.current.backgroundImageFit).toBe("cover");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.imageCropModeObjectId).toBeNull();
    expect(result.current.canvasMap.current).toBeInstanceOf(Map);

    expect(result.current.getCanvasJSON()).toBe("{}");
    expect(result.current.getCanvasJSONForPage("missing-page")).toBe("{}");
    expect(result.current.getCanvasSceneSnapshot()).toBeNull();
    expect(result.current.getCanvasRelationMap()).toBeNull();
    expect(result.current.getCanvasVisualPreview()).toBeNull();
  });

  it("updates safe view state before any canvas is registered", () => {
    const { result } = renderHook(() => useCanvasState());

    act(() => {
      result.current.setCanvasSize(1200, 630);
      result.current.setSnapEnabled(false);
      result.current.setFitScale(0.42);
      result.current.setZoomRaw(0.75);
    });

    expect(result.current.canvasWidth).toBe(1200);
    expect(result.current.canvasHeight).toBe(630);
    expect(result.current.snapEnabled).toBe(false);
    expect(result.current.fitScale).toBe(0.42);
    expect(result.current.zoom).toBe(0.75);

    act(() => {
      result.current.zoomIn();
    });
    expect(result.current.zoom).toBeCloseTo(0.9);

    act(() => {
      result.current.zoomOut();
    });
    expect(result.current.zoom).toBeCloseTo(0.75);
  });
});
