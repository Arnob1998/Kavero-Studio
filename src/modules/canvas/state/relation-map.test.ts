import { describe, expect, it } from "vitest";
import { createCanvasRelationMap, type SceneRelationMap } from "./relation-map";
import type { CanvasSceneSnapshot, SceneObjectSnapshot } from "./scene-snapshot";

function bounds(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function object(partial: Partial<SceneObjectSnapshot> & Pick<SceneObjectSnapshot, "id" | "kind" | "bounds">): SceneObjectSnapshot {
  return {
    type: partial.kind,
    zIndex: 0,
    visible: true,
    locked: false,
    lockState: { movementX: false, movementY: false, scalingX: false, scalingY: false, rotation: false },
    center: {
      x: partial.bounds.left + partial.bounds.width / 2,
      y: partial.bounds.top + partial.bounds.height / 2,
    },
    rotation: 0,
    scale: { x: 1, y: 1 },
    transform: {
      left: partial.bounds.left,
      top: partial.bounds.top,
      width: partial.bounds.width,
      height: partial.bounds.height,
      scaledWidth: partial.bounds.width,
      scaledHeight: partial.bounds.height,
      originX: "left",
      originY: "top",
      flipX: false,
      flipY: false,
      skewX: 0,
      skewY: 0,
    },
    canvasFit: {
      insideCanvas: true,
      overflow: { left: 0, top: 0, right: 0, bottom: 0 },
      visibleAreaRatio: 1,
    },
    styles: {},
    text: null,
    image: null,
    parentId: null,
    childIds: [],
    effects: { shadow: null, blur: 0, blendMode: "source-over" },
    normalizedBounds: {
      x: partial.bounds.left / 900,
      y: partial.bounds.top / 600,
      w: partial.bounds.width / 900,
      h: partial.bounds.height / 600,
      cx: (partial.bounds.left + partial.bounds.width / 2) / 900,
      cy: (partial.bounds.top + partial.bounds.height / 2) / 600,
    },
    textMetrics: null,
    ...partial,
  };
}

function snapshot(objects: SceneObjectSnapshot[], overrides: Partial<CanvasSceneSnapshot> = {}): CanvasSceneSnapshot {
  return {
    version: 1,
    designId: "design-1",
    pageId: "page-1",
    canvas: { width: 900, height: 600 },
    selectedObjectIds: [],
    background: { kind: "color", value: "#ffffff" },
    objects: objects.map((item, index) => ({ ...item, zIndex: item.zIndex || index })),
    ...overrides,
  };
}

function edge(map: SceneRelationMap, from: string, to: string, type: string) {
  return map.edges.find((candidate) => candidate.from === from && candidate.to === to && candidate.type === type);
}

function role(map: SceneRelationMap, id: string) {
  return map.nodes.find((node) => node.id === id)?.role;
}

describe("canvas relation map", () => {
  it("detects cards, contained content, alignment, and repeated card layouts", () => {
    const cards = [80, 340, 600].map((left, index) =>
      object({
        id: `card-${index + 1}`,
        kind: "shape",
        bounds: bounds(left, 160, 200, 240),
        styles: { fill: "#101828", rx: 12, ry: 12 },
      }),
    );
    const headings = cards.map((card, index) =>
      object({
        id: `title-${index + 1}`,
        kind: "text",
        bounds: bounds(card.bounds.left + 24, 190, 152, 36),
        styles: { fontSize: 24, fontWeight: "700", fontFamily: "Inter" },
        text: `Plan ${index + 1}`,
      }),
    );

    const map = createCanvasRelationMap(snapshot([...cards, ...headings]));

    expect(role(map, "card-1")).toBe("card");
    expect(edge(map, "card-1", "title-1", "contains")).toMatchObject({ metadata: { source: "geometry" } });
    expect(edge(map, "title-1", "card-1", "inside")).toBeTruthy();
    expect(edge(map, "card-1", "card-2", "aligned-top")).toBeTruthy();
    expect(edge(map, "card-1", "card-2", "same-size")).toBeTruthy();
    expect(edge(map, "card-1", "card-2", "repeated-item")).toMatchObject({ metadata: { axis: "x", count: 3 } });
    expect(edge(map, "card-2", "card-3", "repeated-item")).toBeTruthy();
  });

  it("infers button structure from a rounded shape containing centered text", () => {
    const button = object({
      id: "button-bg",
      kind: "shape",
      bounds: bounds(360, 430, 180, 52),
      styles: { fill: "#2563eb", rx: 18, ry: 18 },
    });
    const label = object({
      id: "button-label",
      kind: "text",
      bounds: bounds(394, 444, 112, 24),
      styles: { fontSize: 16, fontWeight: "700", fill: "#ffffff" },
      text: "Get started",
    });

    const map = createCanvasRelationMap(snapshot([button, label]));

    expect(role(map, "button-bg")).toBe("button");
    expect(edge(map, "button-bg", "button-label", "contains")).toBeTruthy();
    expect(edge(map, "button-bg", "button-label", "aligned-center")).toBeTruthy();
    expect(edge(map, "button-bg", "button-label", "aligned-middle")).toBeTruthy();
  });

  it("infers header hierarchy with heading, subtitle, left/right placement, and background role", () => {
    const logo = object({
      id: "logo",
      kind: "image",
      bounds: bounds(64, 32, 48, 48),
      image: { src: "/api/canvas/assets/logo", status: "available" },
    });
    const heading = object({
      id: "heading",
      kind: "text",
      bounds: bounds(120, 160, 420, 56),
      styles: { fontSize: 44, fontWeight: "700" },
      text: "Launch faster",
    });
    const subtitle = object({
      id: "subtitle",
      kind: "text",
      bounds: bounds(120, 228, 520, 28),
      styles: { fontSize: 22 },
      text: "Templates for every campaign",
    });
    const heroImage = object({
      id: "hero-image",
      kind: "image",
      bounds: bounds(680, 120, 160, 180),
      image: { src: "/api/canvas/assets/hero", status: "available" },
    });

    const map = createCanvasRelationMap(
      snapshot([logo, heading, subtitle, heroImage], {
        background: {
          kind: "image",
          objectId: "bg",
          fit: "cover",
          asset: { src: "/api/canvas/assets/bg", status: "available" },
          bounds: bounds(0, 0, 900, 600),
        },
      }),
    );

    expect(role(map, "bg")).toBe("background");
    expect(role(map, "logo")).toBe("icon");
    expect(role(map, "heading")).toBe("heading");
    expect(role(map, "subtitle")).toBe("subtitle");
    expect(role(map, "hero-image")).toBe("image");
    expect(edge(map, "heading", "subtitle", "above")).toBeTruthy();
    expect(edge(map, "heading", "subtitle", "aligned-left")).toBeTruthy();
    expect(edge(map, "subtitle", "hero-image", "left-of")).toBeTruthy();
  });

  it("uses explicit Fabric group membership as high-confidence parent-child edges", () => {
    const group = object({
      id: "group-1",
      kind: "group",
      bounds: bounds(100, 100, 180, 120),
      childIds: ["group-icon", "group-label"],
    });
    const icon = object({
      id: "group-icon",
      kind: "shape",
      bounds: bounds(124, 124, 32, 32),
      parentId: "group-1",
      styles: { fill: "#22c55e" },
    });
    const label = object({
      id: "group-label",
      kind: "text",
      bounds: bounds(168, 126, 72, 24),
      parentId: "group-1",
      styles: { fontSize: 16 },
      text: "Online",
    });

    const map = createCanvasRelationMap(snapshot([group, icon, label]));

    expect(role(map, "group-1")).toBe("group");
    expect(edge(map, "group-1", "group-icon", "contains")).toMatchObject({
      confidence: 1,
      metadata: { source: "fabric-group" },
    });
    expect(edge(map, "group-label", "group-1", "inside")).toMatchObject({
      confidence: 1,
      metadata: { source: "fabric-group" },
    });
    expect(edge(map, "group-icon", "group-label", "left-of")).toBeTruthy();
  });

  it("detects overlapping objects and directional placement", () => {
    const photo = object({
      id: "photo",
      kind: "image",
      bounds: bounds(200, 120, 260, 180),
      image: { src: "/api/canvas/assets/photo", status: "available" },
    });
    const badge = object({
      id: "badge",
      kind: "shape",
      bounds: bounds(390, 240, 110, 48),
      styles: { fill: "#f97316", rx: 24 },
    });
    const caption = object({
      id: "caption",
      kind: "text",
      bounds: bounds(200, 330, 240, 24),
      styles: { fontSize: 16 },
      text: "Featured product",
    });

    const map = createCanvasRelationMap(snapshot([photo, badge, caption]));

    expect(edge(map, "photo", "badge", "overlaps")).toMatchObject({ metadata: { area: 3360 } });
    expect(edge(map, "photo", "caption", "above")).toBeTruthy();
    expect(edge(map, "photo", "caption", "aligned-left")).toBeTruthy();
  });

  it("detects repeated vertical layout items", () => {
    const rows = [80, 160, 240].map((top, index) =>
      object({
        id: `row-${index + 1}`,
        kind: "shape",
        bounds: bounds(120, top, 420, 48),
        styles: { fill: "#f8fafc", rx: 8, ry: 8 },
      }),
    );

    const map = createCanvasRelationMap(snapshot(rows));

    expect(edge(map, "row-1", "row-2", "repeated-item")).toMatchObject({ metadata: { axis: "y", count: 3 } });
    expect(edge(map, "row-2", "row-3", "repeated-item")).toBeTruthy();
    expect(edge(map, "row-1", "row-2", "same-style")).toBeTruthy();
  });
});
