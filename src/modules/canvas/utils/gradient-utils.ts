import * as fabric from "fabric";

export interface GradientConfig {
  type: "linear" | "radial";
  angle: number;
  colors: string[];   // 2–5 color stops
  stops: number[];    // parallel to colors, each 0–100
  opacity: number;
}

export function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace("#", "");
  const value = /^[0-9a-f]{6}$/i.test(normalized) ? normalized : "000000";
  const red = parseInt(value.slice(0, 2), 16);
  const green = parseInt(value.slice(2, 4), 16);
  const blue = parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

export function createGradient(width: number, height: number, config: GradientConfig) {
  const opacity = Math.min(Math.max(config.opacity, 0), 1);
  const colorStops = config.colors.map((color, index) => ({
    offset: Math.min(Math.max((config.stops[index] ?? (index * 100 / Math.max(1, config.colors.length - 1))), 0), 100) / 100,
    color: hexToRgba(color, opacity),
  }));

  if (config.type === "radial") {
    return new fabric.Gradient({
      type: "radial",
      coords: {
        x1: width / 2,
        y1: height / 2,
        r1: 0,
        x2: width / 2,
        y2: height / 2,
        r2: Math.max(width, height) / 1.25,
      },
      colorStops,
    });
  }

  const radians = (config.angle * Math.PI) / 180;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const radius = Math.sqrt(width * width + height * height) / 2;
  const dx = Math.cos(radians) * radius;
  const dy = Math.sin(radians) * radius;

  return new fabric.Gradient({
    type: "linear",
    coords: {
      x1: halfWidth - dx,
      y1: halfHeight - dy,
      x2: halfWidth + dx,
      y2: halfHeight + dy,
    },
    colorStops,
  });
}

export function gradientCss(config: GradientConfig) {
  const stops = config.colors
    .map((color, index) => `${color} ${config.stops[index] ?? Math.round(index * 100 / Math.max(1, config.colors.length - 1))}%`)
    .join(", ");
  return config.type === "radial"
    ? `radial-gradient(circle, ${stops})`
    : `linear-gradient(${config.angle}deg, ${stops})`;
}

export function gradientConfigFromString(value: string): GradientConfig | null {
  try {
    const parsed = JSON.parse(value) as Partial<GradientConfig>;
    if (
      (parsed.type === "linear" || parsed.type === "radial") &&
      typeof parsed.angle === "number" &&
      Array.isArray(parsed.colors) &&
      parsed.colors.length >= 2 &&
      parsed.colors.every((c) => typeof c === "string") &&
      Array.isArray(parsed.stops) &&
      parsed.stops.length === parsed.colors.length &&
      parsed.stops.every((s) => typeof s === "number") &&
      typeof parsed.opacity === "number"
    ) {
      return parsed as GradientConfig;
    }
  } catch {
    return null;
  }
  return null;
}

export function defaultGradientConfig(): GradientConfig {
  return { type: "linear", angle: 135, colors: ["#667eea", "#764ba2"], stops: [0, 100], opacity: 1 };
}
