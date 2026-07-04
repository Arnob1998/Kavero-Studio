import { describe, expect, it } from "vitest";
import * as fabric from "fabric";
import {
  createCanvasSceneSnapshot,
  ensureObjectId,
  normalizeCanvasImageSources,
  resetObjectIds,
  serializeCanvas,
} from "./scene-snapshot";

class TestCanvas {
  backgroundColor: unknown;
  private objects: fabric.FabricObject[] = [];
  private activeObjects: fabric.FabricObject[] = [];

  constructor(
    private width = 500,
    private height = 300,
  ) {}

  add(...objects: fabric.FabricObject[]) {
    this.objects.push(...objects);
    objects.forEach((object) => {
      (object as any).canvas = this;
    });
  }

  getObjects() {
    return this.objects;
  }

  getActiveObjects() {
    return this.activeObjects;
  }

  setActiveObject(object: fabric.FabricObject) {
    this.activeObjects = [object];
  }

  getWidth() {
    return this.width;
  }

  getHeight() {
    return this.height;
  }

  toJSON(propertiesToInclude?: string[]) {
    return {
      version: fabric.version,
      objects: this.objects.map((object) => object.toObject(propertiesToInclude)),
      background: this.backgroundColor,
    };
  }
}

function createCanvas(width = 500, height = 300) {
  return new TestCanvas(width, height) as unknown as fabric.Canvas;
}

describe("canvas scene snapshots", () => {
  it("preserves object ids through save and load while cloned duplicates get a new id", async () => {
    const canvas = createCanvas();
    const rect = new fabric.Rect({ left: 10, top: 20, width: 40, height: 30, fill: "#123456" });
    canvas.add(rect);
    ensureObjectId(rect);
    const originalId = String((rect as any).kaveroId);

    const json = serializeCanvas(canvas);
    const loadedJson = normalizeCanvasImageSources(JSON.parse(json));
    expect(loadedJson.objects[0].kaveroId).toBe(originalId);

    const clone = await rect.clone();
    resetObjectIds(clone);
    expect((clone as any).kaveroId).not.toBe(originalId);
    expect((rect as any).kaveroId).toBe(originalId);
  });

  it("reports accurate bounds, centers, rotation, and scale", () => {
    const canvas = createCanvas(800, 600);
    const rect = new fabric.Rect({
      left: 10,
      top: 20,
      originX: "left",
      originY: "top",
      width: 100,
      height: 40,
      scaleX: 2,
      scaleY: 0.5,
      angle: 0,
      fill: "#abcdef",
      strokeWidth: 0,
    });
    canvas.add(rect);

    const snapshot = createCanvasSceneSnapshot(canvas, { designId: "design-1", pageId: "page-1" });
    expect(snapshot.canvas).toEqual({ width: 800, height: 600 });
    expect(snapshot.designId).toBe("design-1");
    expect(snapshot.pageId).toBe("page-1");
    expect(snapshot.objects).toHaveLength(1);
    expect(snapshot.objects[0].bounds).toEqual({
      left: 10,
      top: 20,
      right: 210,
      bottom: 40,
      width: 200,
      height: 20,
    });
    expect(snapshot.objects[0].center).toEqual({ x: 110, y: 30 });
    expect(snapshot.objects[0].rotation).toBe(0);
    expect(snapshot.objects[0].scale).toEqual({ x: 2, y: 0.5 });
    expect(snapshot.objects[0].transform).toEqual({
      left: 10,
      top: 20,
      width: 100,
      height: 40,
      scaledWidth: 200,
      scaledHeight: 20,
      originX: "left",
      originY: "top",
      flipX: false,
      flipY: false,
      skewX: 0,
      skewY: 0,
    });
    expect(snapshot.objects[0].canvasFit).toEqual({
      insideCanvas: true,
      overflow: { left: 0, top: 0, right: 0, bottom: 0 },
      visibleAreaRatio: 1,
    });
  });

  it("reports rotation as signed degrees", () => {
    const canvas = createCanvas();
    canvas.add(new fabric.Rect({ width: 100, height: 100, angle: 270 }));

    const snapshot = createCanvasSceneSnapshot(canvas);

    expect(snapshot.objects[0].rotation).toBe(-90);
  });

  it("reports canvas overflow diagnostics for clipped objects", () => {
    const canvas = createCanvas(800, 600);
    const rect = new fabric.Rect({
      left: -40,
      top: 560,
      originX: "left",
      originY: "top",
      width: 100,
      height: 80,
      strokeWidth: 0,
    });
    canvas.add(rect);

    const snapshot = createCanvasSceneSnapshot(canvas);
    expect(snapshot.objects[0].canvasFit).toEqual({
      insideCanvas: false,
      overflow: { left: 40, top: 0, right: 0, bottom: 40 },
      visibleAreaRatio: 0.3,
    });
  });

  it("keeps stack order as z-index and records selected object ids", () => {
    const canvas = createCanvas();
    const bottom = new fabric.Rect({ width: 20, height: 20 });
    const top = new fabric.Circle({ radius: 10 });
    canvas.add(bottom, top);
    ensureObjectId(bottom);
    ensureObjectId(top);
    canvas.setActiveObject(top);

    const snapshot = createCanvasSceneSnapshot(canvas);
    expect(snapshot.objects.map((object) => object.id)).toEqual([
      String((bottom as any).kaveroId),
      String((top as any).kaveroId),
    ]);
    expect(snapshot.objects.map((object) => object.zIndex)).toEqual([0, 1]);
    expect(snapshot.selectedObjectIds).toEqual([String((top as any).kaveroId)]);
  });

  it("separates background images from scene objects and excludes helpers by default", () => {
    const canvas = createCanvas();
    const background = new fabric.Rect({
      left: 0,
      top: 0,
      width: 500,
      height: 300,
      selectable: false,
      evented: false,
    });
    background.set({
      kaveroKind: "background-image",
      kaveroBgSrc: "/api/canvas/assets/bg-1",
      kaveroBgFit: "cover",
      _isBgImage: true,
    } as any);
    const guide = new fabric.Line([0, 0, 100, 0]);
    guide.set({ kaveroKind: "smart-guide" } as any);
    const rect = new fabric.Rect({ width: 20, height: 20 });
    canvas.add(background, rect, guide);

    const snapshot = createCanvasSceneSnapshot(canvas);
    expect(snapshot.background).toMatchObject({
      kind: "image",
      fit: "cover",
      asset: { src: "/api/canvas/assets/bg-1", status: "available" },
    });
    expect(snapshot.objects).toHaveLength(1);
    expect(snapshot.objects[0].kind).toBe("shape");

    const withHelpers = createCanvasSceneSnapshot(canvas, { includeHelpers: true });
    expect(withHelpers.objects.map((object) => object.kind)).toEqual(["background-image", "shape", "helper"]);
  });

  it("marks missing and invalid image assets without introducing external persisted sources", () => {
    const canvas = createCanvas();
    const missing = new fabric.Rect({ width: 160, height: 120 });
    missing.set({
      kaveroKind: "missing-asset",
      kaveroMissingAssetSrc: "/api/canvas/assets/missing-1",
    } as any);
    const invalid = new fabric.Rect({ width: 80, height: 60 });
    invalid.set({ kaveroAssetSrc: "https://example.com/external.png" } as any);
    canvas.add(missing, invalid);

    const snapshot = createCanvasSceneSnapshot(canvas);
    expect(snapshot.objects[0].image).toEqual({
      src: "/api/canvas/assets/missing-1",
      status: "missing",
      missingSource: "/api/canvas/assets/missing-1",
    });
    expect(snapshot.objects[1].image).toEqual({
      src: null,
      status: "invalid",
    });
  });

  it("serializes durable ids and normalized asset paths for save/load", () => {
    const canvas = createCanvas();
    const rect = new fabric.Rect({ width: 100, height: 100 });
    rect.set({ kaveroAssetSrc: "https://kavero.local/api/canvas/assets/asset-1" } as any);
    canvas.add(rect);

    const json = JSON.parse(serializeCanvas(canvas));
    expect(json.objects[0].kaveroId).toEqual(expect.any(String));
    expect(json.objects[0].kaveroAssetSrc).toBe("/api/canvas/assets/asset-1");
  });
});
