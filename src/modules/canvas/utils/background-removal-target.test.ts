import { describe, expect, it } from "vitest";
import * as fabric from "fabric";
import { isBackgroundRemovalTarget } from "./background-removal-target";

describe("background-removal Canvas target", () => {
  it("accepts normal image objects and rejects shapes", () => {
    const image = new fabric.FabricImage(document.createElement("img"));
    expect(isBackgroundRemovalTarget(image)).toBe(true);
    expect(isBackgroundRemovalTarget(new fabric.Rect({ width: 20, height: 20 }))).toBe(false);
  });

  it("rejects page background image objects", () => {
    const image = new fabric.FabricImage(document.createElement("img"));
    image.set({ _isBgImage: true } as any);
    expect(isBackgroundRemovalTarget(image)).toBe(false);
  });
});
