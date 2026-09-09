import { describe, expect, it } from "vitest";
import { imageDataToNchw, normalizeForegroundMask } from "./image-processing";

describe("background-removal image processing", () => {
  it("converts RGBA pixels into channel-first zero-to-one RGB", () => {
    const image = {
      width: 2,
      height: 1,
      data: new Uint8ClampedArray([255, 128, 0, 255, 0, 64, 255, 255]),
    } as ImageData;
    const output = imageDataToNchw(image, "zero-to-one");
    expect(Array.from(output.slice(0, 2))).toEqual([1, 0]);
    expect(output[2]).toBeCloseTo(128 / 255);
    expect(output[3]).toBeCloseTo(64 / 255);
    expect(Array.from(output.slice(4))).toEqual([0, 1]);
  });

  it("applies ImageNet normalization when requested", () => {
    const image = {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray([255, 255, 255, 255]),
    } as ImageData;
    const output = imageDataToNchw(image, "imagenet");
    expect(output[0]).toBeCloseTo((1 - 0.485) / 0.229);
    expect(output[1]).toBeCloseTo((1 - 0.456) / 0.224);
    expect(output[2]).toBeCloseTo((1 - 0.406) / 0.225);
  });

  it("clamps probabilities and converts logits through a sigmoid", () => {
    expect(Array.from(normalizeForegroundMask(new Float32Array([0, 0.5, 1])))).toEqual([0, 128, 255]);
    const logits = normalizeForegroundMask(new Float32Array([-10, 0, 10]));
    expect(logits[0]).toBeLessThan(1);
    expect(logits[1]).toBe(128);
    expect(logits[2]).toBeGreaterThan(254);
  });
});
