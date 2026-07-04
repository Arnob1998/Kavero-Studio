import { describe, expect, it } from "vitest";
import {
  createGradient,
  defaultGradientConfig,
  gradientConfigFromString,
  gradientCss,
  hexToRgba,
  type GradientConfig,
} from "./gradient-utils";

describe("gradient utils", () => {
  it("converts hex colors to rgba and falls back to black for invalid input", () => {
    expect(hexToRgba("#336699", 0.5)).toBe("rgba(51, 102, 153, 0.5)");
    expect(hexToRgba("ff00aa", 1)).toBe("rgba(255, 0, 170, 1)");
    expect(hexToRgba("not-a-color", 0.75)).toBe("rgba(0, 0, 0, 0.75)");
  });

  it("creates CSS gradient strings from the current config shape", () => {
    const linear: GradientConfig = {
      type: "linear",
      angle: 45,
      colors: ["#111111", "#222222", "#333333"],
      stops: [0, 40, 100],
      opacity: 0.8,
    };
    const radial: GradientConfig = { ...linear, type: "radial" };

    expect(gradientCss(linear)).toBe("linear-gradient(45deg, #111111 0%, #222222 40%, #333333 100%)");
    expect(gradientCss(radial)).toBe("radial-gradient(circle, #111111 0%, #222222 40%, #333333 100%)");
  });

  it("parses only complete serialized gradient configs", () => {
    const config: GradientConfig = {
      type: "linear",
      angle: 135,
      colors: ["#667eea", "#764ba2"],
      stops: [0, 100],
      opacity: 1,
    };

    expect(gradientConfigFromString(JSON.stringify(config))).toEqual(config);
    expect(gradientConfigFromString("{bad json")).toBeNull();
    expect(gradientConfigFromString(JSON.stringify({ ...config, type: "conic" }))).toBeNull();
    expect(gradientConfigFromString(JSON.stringify({ ...config, stops: [0] }))).toBeNull();
    expect(gradientConfigFromString(JSON.stringify({ ...config, colors: ["#667eea"] }))).toBeNull();
  });

  it("returns the current default gradient config", () => {
    expect(defaultGradientConfig()).toEqual({
      type: "linear",
      angle: 135,
      colors: ["#667eea", "#764ba2"],
      stops: [0, 100],
      opacity: 1,
    });
  });

  it("creates a Fabric linear gradient with clamped stops and opacity", () => {
    const gradient = createGradient(100, 50, {
      type: "linear",
      angle: 0,
      colors: ["#ff0000", "#00ff00", "invalid"],
      stops: [-25, 50, 125],
      opacity: 1.5,
    }).toObject();

    expect(gradient.type).toBe("linear");
    expect(gradient.coords).toBeDefined();
    const coords = gradient.coords;
    if (!coords) throw new Error("Expected linear gradient coords.");
    expect(coords.x1).toBeCloseTo(-5.901699);
    expect(coords.y1).toBeCloseTo(25);
    expect(coords.x2).toBeCloseTo(105.901699);
    expect(coords.y2).toBeCloseTo(25);
    expect(gradient.colorStops).toEqual([
      { offset: 0, color: "rgba(255, 0, 0, 1)" },
      { offset: 0.5, color: "rgba(0, 255, 0, 1)" },
      { offset: 1, color: "rgba(0, 0, 0, 1)" },
    ]);
  });

  it("creates a Fabric radial gradient from canvas dimensions", () => {
    const gradient = createGradient(120, 80, {
      type: "radial",
      angle: 90,
      colors: ["#000000", "#ffffff"],
      stops: [0, 100],
      opacity: -1,
    }).toObject();

    expect(gradient.type).toBe("radial");
    expect(gradient.coords).toEqual({
      x1: 60,
      y1: 40,
      r1: 0,
      x2: 60,
      y2: 40,
      r2: 96,
    });
    expect(gradient.colorStops).toEqual([
      { offset: 0, color: "rgba(0, 0, 0, 0)" },
      { offset: 1, color: "rgba(255, 255, 255, 0)" },
    ]);
  });
});
