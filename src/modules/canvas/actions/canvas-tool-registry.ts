import { z } from "zod";
import type { BackgroundImageFit } from "@/modules/canvas/state/context";
import { normalizeRotationDegrees } from "@/modules/canvas/utils/rotation";

export type CanvasToolRisk = "low" | "medium" | "high";

export interface CanvasToolResult {
  ok: boolean;
  toolName: string;
  changedObjectIds: string[];
  selectedObjectIds?: string[];
  errors: string[];
  summary: string;
  data?: Record<string, unknown>;
}

export interface CanvasToolDefinition<Input = unknown> {
  name: CanvasToolName;
  description: string;
  riskLevel: CanvasToolRisk;
  inputSchema: z.ZodTypeAny;
  jsonSchema: Record<string, unknown>;
  executor: (input: Input, context: CanvasToolExecutionContext) => Promise<CanvasToolResult> | CanvasToolResult;
}

export const BLEND_MODES = [
  "source-over", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
  "exclusion", "hue", "saturation", "color", "luminosity",
] as const;

export type BlendMode = typeof BLEND_MODES[number];

export interface CanvasToolExecutionContext {
  addText: (input: { preset: "heading" | "subheading" | "body"; text?: string }) => Promise<CanvasToolResult> | CanvasToolResult;
  addShape: (input: { type: "rect" | "circle" | "line" | "triangle" }) => Promise<CanvasToolResult> | CanvasToolResult;
  addUploadedImage: (input: { assetUrl: string; position?: { x: number; y: number } }) => Promise<CanvasToolResult> | CanvasToolResult;
  generateImageAsset: (input: {
    prompt: string;
    transparentBackground?: boolean;
    backgroundPreference?: "auto" | "white" | "black";
    position?: { x: number; y: number };
    useAsBackground?: boolean;
    backgroundFit?: BackgroundImageFit;
    purpose?: string;
  }) => Promise<CanvasToolResult> | CanvasToolResult;
  setBackground: (
    input:
      | { type: "color"; value: string }
      | { type: "gradient"; value: string }
      | { type: "image"; value: string; fit?: BackgroundImageFit },
  ) => Promise<CanvasToolResult> | CanvasToolResult;
  setImageAsBackground: (input: { objectId: string; fit?: BackgroundImageFit }) => Promise<CanvasToolResult> | CanvasToolResult;
  removeBackgroundImage: (input: { mode?: "delete" | "detach" }) => Promise<CanvasToolResult> | CanvasToolResult;
  setCanvasSize: (input: { width: number; height: number }) => Promise<CanvasToolResult> | CanvasToolResult;
  updateObject: (input: { objectId: string; props: Record<string, unknown> }) => Promise<CanvasToolResult> | CanvasToolResult;
  transformObject: (
    input: {
      objectId: string;
      left?: number;
      top?: number;
      width?: number;
      height?: number;
      rotation?: number;
      scaleX?: number;
      scaleY?: number;
      skewX?: number;
      skewY?: number;
    },
  ) => Promise<CanvasToolResult> | CanvasToolResult;
  rotateObject: (input: { objectId: string; rotation: number }) => Promise<CanvasToolResult> | CanvasToolResult;
  flipObject: (input: { objectId: string; mode: "none" | "horizontal" | "vertical" | "both" }) => Promise<CanvasToolResult> | CanvasToolResult;
  setObjectPerspective: (input: { objectId: string; skewX: number; skewY: number }) => Promise<CanvasToolResult> | CanvasToolResult;
  setImageBorderRadius: (input: { objectId: string; radius: number }) => Promise<CanvasToolResult> | CanvasToolResult;
  getImageObjectInfo: (input: { objectId: string }) => Promise<CanvasToolResult> | CanvasToolResult;
  cropImageObject: (input: {
    objectId: string;
    crop: { unit: "source_px" | "normalized"; x: number; y: number; width: number; height: number };
    outputFit?: "preserve-frame" | "resize-frame-to-crop";
  }) => Promise<CanvasToolResult> | CanvasToolResult;
  resetImageCrop: (input: { objectId: string }) => Promise<CanvasToolResult> | CanvasToolResult;
  fitObjectsInCanvas: (input: { objectIds: string[]; padding?: number; preserveAspectRatio?: boolean }) => Promise<CanvasToolResult> | CanvasToolResult;
  repairCanvasOverflow: (input: { scope?: "selected" | "all"; padding?: number }) => Promise<CanvasToolResult> | CanvasToolResult;
  normalizeTextBox: (input: { objectId: string; maxWidth?: number; maxHeight?: number; padding?: number }) => Promise<CanvasToolResult> | CanvasToolResult;
  layoutStack: (
    input: {
      objectIds: string[];
      direction: "vertical" | "horizontal";
      bounds: { left: number; top: number; width: number; height: number };
      gap?: number;
      align?: "start" | "center" | "end";
    },
  ) => Promise<CanvasToolResult> | CanvasToolResult;
  alignObject: (input: { objectId: string; alignment: "left" | "center" | "right" | "top" | "middle" | "bottom" }) => Promise<CanvasToolResult> | CanvasToolResult;
  reorderObject: (
    input: { objectId: string; action?: "front" | "forward" | "backward" | "back"; level?: number },
  ) => Promise<CanvasToolResult> | CanvasToolResult;
  selectObject: (input: { objectId: string }) => Promise<CanvasToolResult> | CanvasToolResult;
  deleteObjects: (input: { objectIds: string[] }) => Promise<CanvasToolResult> | CanvasToolResult;
  duplicateObjects: (input: { objectIds: string[] }) => Promise<CanvasToolResult> | CanvasToolResult;
  setObjectShadow: (input: { objectId: string; shadow: { color: string; blur: number; offsetX: number; offsetY: number } | null }) => Promise<CanvasToolResult> | CanvasToolResult;
  setObjectBlur: (input: { objectId: string; blur: number }) => Promise<CanvasToolResult> | CanvasToolResult;
  setObjectBlendMode: (input: { objectId: string; blendMode: BlendMode }) => Promise<CanvasToolResult> | CanvasToolResult;
  undo: () => Promise<CanvasToolResult> | CanvasToolResult;
  redo: () => Promise<CanvasToolResult> | CanvasToolResult;
  save: () => Promise<CanvasToolResult> | CanvasToolResult;
}

const objectIdSchema = z.string().trim().min(1).max(160);
const canvasAssetIdSchema = z.string().trim().regex(/^[a-zA-Z0-9_-]+$/);
const canvasAssetUrlSchema = z.string().trim().regex(/^\/api\/canvas\/assets\/[a-zA-Z0-9_-]+$/);
const safeTextSchema = z.string().max(1200).optional();
const safeStyleStringSchema = z.string().trim().min(1).max(240);
const clampedNumber = (min: number, max: number) =>
  z.preprocess((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return value;
    return Math.min(max, Math.max(min, value));
  }, z.number().finite());
const coordinateSchema = clampedNumber(-10000, 10000);
const dimensionSchema = clampedNumber(1, 10000);
const scaleSchema = clampedNumber(0.01, 20);
const perspectiveSkewSchema = clampedNumber(-60, 60);
const imageBorderRadiusSchema = clampedNumber(0, 10000);
const angleSchema = z.preprocess((value) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return normalizeRotationDegrees(value);
}, z.number().finite().min(-180).max(180));
const flipModeSchema = z.enum(["none", "horizontal", "vertical", "both"]);
const positionSchema = z.object({
  x: coordinateSchema,
  y: coordinateSchema,
});
const paddingSchema = clampedNumber(0, 1000);
const objectIdsSchema = z.array(objectIdSchema).min(1).max(100);
const layoutBoundsSchema = z.object({
  left: coordinateSchema,
  top: coordinateSchema,
  width: dimensionSchema,
  height: dimensionSchema,
}).strict();
const imageCropSchema = z.object({
  unit: z.enum(["source_px", "normalized"]).default("source_px"),
  x: clampedNumber(0, 100000),
  y: clampedNumber(0, 100000),
  width: clampedNumber(0.000001, 100000),
  height: clampedNumber(0.000001, 100000),
}).strict();

const assetInputSchema = z
  .object({
    assetUrl: canvasAssetUrlSchema.optional(),
    assetId: canvasAssetIdSchema.optional(),
    position: positionSchema.optional(),
  })
  .refine((value) => Boolean(value.assetUrl || value.assetId), "Provide assetUrl or assetId.")
  .transform((value) => ({
    assetUrl: value.assetUrl ?? `/api/canvas/assets/${value.assetId}`,
    position: value.position,
  }));

const updatePropsSchema = z
  .object({
    fill: safeStyleStringSchema.optional(),
    stroke: safeStyleStringSchema.optional(),
    strokeWidth: clampedNumber(0, 200).optional(),
    opacity: clampedNumber(0, 1).optional(),
    fontFamily: safeStyleStringSchema.optional(),
    fontSize: clampedNumber(1, 300).optional(),
    fontWeight: z.union([z.string().trim().max(32), clampedNumber(100, 1000)]).optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    underline: z.boolean().optional(),
    textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
    lineHeight: clampedNumber(0.5, 4).optional(),
    charSpacing: clampedNumber(-500, 5000).optional(),
    rx: clampedNumber(0, 500).optional(),
    ry: clampedNumber(0, 500).optional(),
    text: z.string().max(5000).optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
  })
  .strict();

const shadowValueSchema = z.object({
  color: safeStyleStringSchema.default("rgba(0,0,0,0.3)"),
  blur: clampedNumber(0, 200).default(10),
  offsetX: clampedNumber(-200, 200).default(5),
  offsetY: clampedNumber(-200, 200).default(5),
}).strict();

const toolSchemas = {
  add_text: z.object({ preset: z.enum(["heading", "subheading", "body"]).default("body"), text: safeTextSchema }).strict(),
  add_shape: z.object({ type: z.enum(["rect", "circle", "line", "triangle"]) }).strict(),
  add_uploaded_image: assetInputSchema,
  generate_image_asset: z.object({
    prompt: z.string().trim().min(1).max(4000),
    transparentBackground: z.boolean().default(false),
    backgroundPreference: z.enum(["auto", "white", "black"]).default("auto"),
    position: positionSchema.optional(),
    useAsBackground: z.boolean().default(false),
    backgroundFit: z.enum(["cover", "contain", "stretch", "overflow"]).default("cover"),
    purpose: z.string().trim().max(800).optional(),
  }).strict(),
  set_background: z.discriminatedUnion("type", [
    z.object({ type: z.literal("color"), value: safeStyleStringSchema }).strict(),
    z.object({ type: z.literal("gradient"), value: safeStyleStringSchema }).strict(),
    z.object({ type: z.literal("image"), value: canvasAssetUrlSchema, fit: z.enum(["cover", "contain", "stretch", "overflow"]).optional() }).strict(),
  ]),
  set_image_as_background: z
    .object({
      objectId: objectIdSchema,
      fit: z.enum(["cover", "contain", "stretch", "overflow"]).default("cover"),
    })
    .strict(),
  remove_background_image: z.object({ mode: z.enum(["delete", "detach"]).default("delete") }).strict(),
  set_canvas_size: z
    .object({
      width: clampedNumber(64, 5000),
      height: clampedNumber(64, 5000),
    })
    .strict(),
  update_object: z.object({ objectId: objectIdSchema, props: updatePropsSchema }).strict(),
  transform_object: z
    .object({
      objectId: objectIdSchema,
      left: coordinateSchema.optional(),
      top: coordinateSchema.optional(),
      width: dimensionSchema.optional(),
      height: dimensionSchema.optional(),
      rotation: angleSchema.optional(),
      scaleX: scaleSchema.optional(),
      scaleY: scaleSchema.optional(),
      skewX: perspectiveSkewSchema.optional(),
      skewY: perspectiveSkewSchema.optional(),
    })
    .strict()
    .refine((value) => Object.keys(value).length > 1, "Provide at least one transform field."),
  rotate_object: z.object({ objectId: objectIdSchema, rotation: angleSchema }).strict(),
  flip_object: z.object({ objectId: objectIdSchema, mode: flipModeSchema }).strict(),
  set_object_perspective: z.object({
    objectId: objectIdSchema,
    skewX: perspectiveSkewSchema.default(0),
    skewY: perspectiveSkewSchema.default(0),
  }).strict(),
  set_image_border_radius: z.object({
    objectId: objectIdSchema,
    radius: imageBorderRadiusSchema,
  }).strict(),
  get_image_object_info: z.object({ objectId: objectIdSchema }).strict(),
  crop_image_object: z.object({
    objectId: objectIdSchema,
    crop: imageCropSchema,
    outputFit: z.enum(["preserve-frame", "resize-frame-to-crop"]).default("preserve-frame"),
  }).strict(),
  reset_image_crop: z.object({ objectId: objectIdSchema }).strict(),
  fit_objects_in_canvas: z.object({
    objectIds: objectIdsSchema,
    padding: paddingSchema.default(24),
    preserveAspectRatio: z.boolean().default(true),
  }).strict(),
  repair_canvas_overflow: z.object({
    scope: z.enum(["selected", "all"]).default("selected"),
    padding: paddingSchema.default(24),
  }).strict(),
  normalize_text_box: z.object({
    objectId: objectIdSchema,
    maxWidth: dimensionSchema.optional(),
    maxHeight: dimensionSchema.optional(),
    padding: paddingSchema.default(24),
  }).strict(),
  layout_stack: z.object({
    objectIds: objectIdsSchema,
    direction: z.enum(["vertical", "horizontal"]),
    bounds: layoutBoundsSchema,
    gap: clampedNumber(0, 1000).default(24),
    align: z.enum(["start", "center", "end"]).default("center"),
  }).strict(),
  align_object: z.object({ objectId: objectIdSchema, alignment: z.enum(["left", "center", "right", "top", "middle", "bottom"]) }).strict(),
  reorder_object: z
    .object({
      objectId: objectIdSchema,
      action: z.enum(["front", "forward", "backward", "back"]).optional(),
      level: clampedNumber(0, 10000).optional(),
    })
    .strict()
    .refine((value) => value.action !== undefined || value.level !== undefined, "Provide action or level."),
  select_object: z.object({ objectId: objectIdSchema }).strict(),
  delete_objects: z.object({ objectIds: z.array(objectIdSchema).min(1).max(100) }).strict(),
  duplicate_objects: z.object({ objectIds: z.array(objectIdSchema).min(1).max(100) }).strict(),
  set_object_shadow: z.object({
    objectId: objectIdSchema,
    shadow: shadowValueSchema.nullable(),
  }).strict(),
  set_object_blur: z.object({
    objectId: objectIdSchema,
    blur: clampedNumber(0, 1),
  }).strict(),
  set_object_blend_mode: z.object({
    objectId: objectIdSchema,
    blendMode: z.enum(BLEND_MODES),
  }).strict(),
  undo: z.object({}).strict(),
  redo: z.object({}).strict(),
  save: z.object({}).strict(),
} satisfies Record<string, z.ZodTypeAny>;

export type CanvasToolName = keyof typeof toolSchemas;
export type CanvasToolInput<Name extends CanvasToolName = CanvasToolName> = z.input<(typeof toolSchemas)[Name]>;

const toolJsonSchemas: Record<keyof typeof toolSchemas, Record<string, unknown>> = {
  add_text: {
    type: "object",
    properties: {
      preset: { type: "string", enum: ["heading", "subheading", "body"], default: "body" },
      text: { type: "string", maxLength: 1200 },
    },
  },
  add_shape: {
    type: "object",
    required: ["type"],
    properties: { type: { type: "string", enum: ["rect", "circle", "line", "triangle"] } },
  },
  add_uploaded_image: {
    type: "object",
    properties: {
      assetUrl: { type: "string", pattern: "^/api/canvas/assets/[a-zA-Z0-9_-]+$" },
      assetId: { type: "string", pattern: "^[a-zA-Z0-9_-]+$" },
      position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
    },
  },
  generate_image_asset: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        maxLength: 4000,
        description: "Image generation prompt for the object, illustration, photo, or canvas asset to create.",
      },
      transparentBackground: {
        type: "boolean",
        default: false,
        description: "Set true for isolated objects, icons, stickers, illustrations, or elements that should be placed without a rectangular background.",
      },
      backgroundPreference: {
        type: "string",
        enum: ["auto", "white", "black"],
        default: "auto",
        description: "High-contrast solid background to request before programmatic removal when transparentBackground is true.",
      },
      position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
      useAsBackground: {
        type: "boolean",
        default: false,
        description: "Set true when the generated image should become the canvas background instead of a normal image layer.",
      },
      backgroundFit: {
        type: "string",
        enum: ["cover", "contain", "stretch", "overflow"],
        default: "cover",
        description: "Background image fit when useAsBackground is true.",
      },
      purpose: { type: "string", maxLength: 800, description: "Short note about how the generated asset should support the current canvas." },
    },
  },
  set_background: {
    oneOf: [
      { type: "object", required: ["type", "value"], properties: { type: { const: "color" }, value: { type: "string" } } },
      { type: "object", required: ["type", "value"], properties: { type: { const: "gradient" }, value: { type: "string" } } },
      {
        type: "object",
        required: ["type", "value"],
        properties: {
          type: { const: "image" },
          value: { type: "string", pattern: "^/api/canvas/assets/[a-zA-Z0-9_-]+$" },
          fit: { type: "string", enum: ["cover", "contain", "stretch", "overflow"] },
        },
      },
    ],
  },
  set_image_as_background: {
    type: "object",
    required: ["objectId"],
    properties: {
      objectId: { type: "string", description: "ID of an existing uploaded image object on the canvas." },
      fit: { type: "string", enum: ["cover", "contain", "stretch", "overflow"], default: "cover" },
    },
  },
  remove_background_image: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["delete", "detach"],
        default: "delete",
        description: "delete removes the background image; detach converts it back into an editable image layer.",
      },
    },
  },
  set_canvas_size: { type: "object", required: ["width", "height"], properties: { width: { type: "number" }, height: { type: "number" } } },
  update_object: {
    type: "object",
    required: ["objectId", "props"],
    properties: { objectId: { type: "string" }, props: { type: "object" } },
  },
  transform_object: {
    type: "object",
    required: ["objectId"],
    properties: {
      objectId: { type: "string" },
      left: { type: "number" },
      top: { type: "number" },
      width: { type: "number" },
      height: { type: "number" },
      rotation: { type: "number", minimum: -180, maximum: 180, description: "Absolute object rotation in degrees, normalized from -180 to 180." },
      scaleX: { type: "number" },
      scaleY: { type: "number" },
      skewX: { type: "number", minimum: -60, maximum: 60, description: "Horizontal perspective/skew angle in degrees." },
      skewY: { type: "number", minimum: -60, maximum: 60, description: "Vertical perspective/skew angle in degrees." },
    },
  },
  rotate_object: {
    type: "object",
    required: ["objectId", "rotation"],
    properties: {
      objectId: { type: "string" },
      rotation: { type: "number", minimum: -180, maximum: 180, description: "Absolute object rotation in degrees, normalized from -180 to 180." },
    },
  },
  flip_object: {
    type: "object",
    required: ["objectId", "mode"],
    properties: {
      objectId: { type: "string" },
      mode: {
        type: "string",
        enum: ["none", "horizontal", "vertical", "both"],
        description: "Absolute object flip mode. horizontal mirrors left/right, vertical mirrors top/bottom, both mirrors both axes, none clears flipping.",
      },
    },
  },
  set_object_perspective: {
    type: "object",
    required: ["objectId"],
    properties: {
      objectId: { type: "string" },
      skewX: { type: "number", minimum: -60, maximum: 60, default: 0, description: "Horizontal perspective/skew angle in degrees." },
      skewY: { type: "number", minimum: -60, maximum: 60, default: 0, description: "Vertical perspective/skew angle in degrees." },
    },
  },
  set_image_border_radius: {
    type: "object",
    required: ["objectId", "radius"],
    properties: {
      objectId: { type: "string", description: "Durable ID of an image object." },
      radius: { type: "number", minimum: 0, description: "Corner radius in source/crop pixels. 0 removes rounded corners." },
    },
  },
  get_image_object_info: {
    type: "object",
    required: ["objectId"],
    properties: {
      objectId: { type: "string", description: "Durable ID of an image object. Call this before crop_image_object to get source pixel dimensions." },
    },
  },
  crop_image_object: {
    type: "object",
    required: ["objectId", "crop"],
    properties: {
      objectId: { type: "string" },
      crop: {
        type: "object",
        required: ["unit", "x", "y", "width", "height"],
        properties: {
          unit: {
            type: "string",
            enum: ["source_px", "normalized"],
            default: "source_px",
            description: "Use source_px for exact pixel crops from the original image. Use normalized for ratios from 0 to 1.",
          },
          x: { type: "number", description: "Left crop coordinate in the selected unit." },
          y: { type: "number", description: "Top crop coordinate in the selected unit." },
          width: { type: "number", description: "Crop width in the selected unit." },
          height: { type: "number", description: "Crop height in the selected unit." },
        },
      },
      outputFit: {
        type: "string",
        enum: ["preserve-frame", "resize-frame-to-crop"],
        default: "preserve-frame",
        description: "preserve-frame keeps the object's current on-canvas frame size; resize-frame-to-crop keeps image scale and changes the visible frame.",
      },
    },
  },
  reset_image_crop: {
    type: "object",
    required: ["objectId"],
    properties: { objectId: { type: "string" } },
  },
  align_object: {
    type: "object",
    required: ["objectId", "alignment"],
    properties: { objectId: { type: "string" }, alignment: { type: "string", enum: ["left", "center", "right", "top", "middle", "bottom"] } },
  },
  fit_objects_in_canvas: {
    type: "object",
    required: ["objectIds"],
    properties: {
      objectIds: { type: "array", items: { type: "string" } },
      padding: { type: "number", default: 24 },
      preserveAspectRatio: { type: "boolean", default: true },
    },
  },
  repair_canvas_overflow: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["selected", "all"], default: "selected" },
      padding: { type: "number", default: 24 },
    },
  },
  normalize_text_box: {
    type: "object",
    required: ["objectId"],
    properties: {
      objectId: { type: "string" },
      maxWidth: { type: "number" },
      maxHeight: { type: "number" },
      padding: { type: "number", default: 24 },
    },
  },
  layout_stack: {
    type: "object",
    required: ["objectIds", "direction", "bounds"],
    properties: {
      objectIds: { type: "array", items: { type: "string" } },
      direction: { type: "string", enum: ["vertical", "horizontal"] },
      bounds: {
        type: "object",
        required: ["left", "top", "width", "height"],
        properties: {
          left: { type: "number" },
          top: { type: "number" },
          width: { type: "number" },
          height: { type: "number" },
        },
      },
      gap: { type: "number", default: 24 },
      align: { type: "string", enum: ["start", "center", "end"], default: "center" },
    },
  },
  reorder_object: {
    type: "object",
    required: ["objectId"],
    properties: { objectId: { type: "string" }, action: { type: "string", enum: ["front", "forward", "backward", "back"] }, level: { type: "number" } },
  },
  select_object: { type: "object", required: ["objectId"], properties: { objectId: { type: "string" } } },
  delete_objects: { type: "object", required: ["objectIds"], properties: { objectIds: { type: "array", items: { type: "string" } } } },
  duplicate_objects: { type: "object", required: ["objectIds"], properties: { objectIds: { type: "array", items: { type: "string" } } } },
  set_object_shadow: {
    type: "object",
    required: ["objectId", "shadow"],
    properties: {
      objectId: { type: "string" },
      shadow: {
        oneOf: [
          {
            type: "object",
            required: ["color", "blur", "offsetX", "offsetY"],
            properties: {
              color: { type: "string" },
              blur: { type: "number", minimum: 0, maximum: 200 },
              offsetX: { type: "number", minimum: -200, maximum: 200 },
              offsetY: { type: "number", minimum: -200, maximum: 200 },
            },
          },
          { type: "null" },
        ],
      },
    },
  },
  set_object_blur: {
    type: "object",
    required: ["objectId", "blur"],
    properties: {
      objectId: { type: "string" },
      blur: { type: "number", minimum: 0, maximum: 1, description: "Gaussian blur intensity 0 (none) to 1 (max)." },
    },
  },
  set_object_blend_mode: {
    type: "object",
    required: ["objectId", "blendMode"],
    properties: {
      objectId: { type: "string" },
      blendMode: { type: "string", enum: [...BLEND_MODES] },
    },
  },
  undo: { type: "object", properties: {} },
  redo: { type: "object", properties: {} },
  save: { type: "object", properties: {} },
};

export const CANVAS_TOOL_REGISTRY: { [Name in CanvasToolName]: CanvasToolDefinition<any> } = {
  add_text: tool("add_text", "Add a text object to the active canvas.", "low", toolSchemas.add_text, (input, context) => context.addText(input)),
  add_shape: tool("add_shape", "Add a shape object to the active canvas.", "low", toolSchemas.add_shape, (input, context) => context.addShape(input)),
  add_uploaded_image: tool("add_uploaded_image", "Add an uploaded Kavero canvas image asset.", "medium", toolSchemas.add_uploaded_image, (input, context) =>
    context.addUploadedImage(input),
  ),
  generate_image_asset: tool(
    "generate_image_asset",
    "Generate a temporary AI image candidate set, judge it against the current canvas, upload only the winning image as a Kavero canvas asset, and place it on the canvas.",
    "medium",
    toolSchemas.generate_image_asset,
    (input, context) => context.generateImageAsset(input),
  ),
  set_background: tool("set_background", "Set the canvas background color, gradient, or uploaded image.", "medium", toolSchemas.set_background, (input, context) =>
    context.setBackground(input),
  ),
  set_image_as_background: tool(
    "set_image_as_background",
    "Convert an existing uploaded image object into the canvas background, detaching any current background image as a normal layer first.",
    "medium",
    toolSchemas.set_image_as_background,
    (input, context) => context.setImageAsBackground(input),
  ),
  remove_background_image: tool(
    "remove_background_image",
    "Remove the current canvas background image, or detach it back into an editable image layer.",
    "medium",
    toolSchemas.remove_background_image,
    (input, context) => context.removeBackgroundImage(input),
  ),
  set_canvas_size: tool("set_canvas_size", "Resize the canvas design surface.", "medium", toolSchemas.set_canvas_size, (input, context) =>
    context.setCanvasSize(input),
  ),
  update_object: tool("update_object", "Update editable object properties such as text, color, opacity, and lock state.", "medium", toolSchemas.update_object, (input, context) =>
    context.updateObject(input),
  ),
  transform_object: tool("transform_object", "Move, resize, scale, rotate, or skew an object.", "medium", toolSchemas.transform_object, (input, context) =>
    context.transformObject(input),
  ),
  rotate_object: tool("rotate_object", "Set an object's absolute rotation angle in degrees.", "medium", toolSchemas.rotate_object, (input, context) =>
    context.rotateObject(input),
  ),
  flip_object: tool("flip_object", "Set an object's absolute horizontal/vertical mirror flip mode.", "medium", toolSchemas.flip_object, (input, context) =>
    context.flipObject(input),
  ),
  set_object_perspective: tool(
    "set_object_perspective",
    "Set an object's perspective-like skew angles in degrees. Use skewX/skewY 0 to reset.",
    "medium",
    toolSchemas.set_object_perspective,
    (input, context) => context.setObjectPerspective(input),
  ),
  set_image_border_radius: tool(
    "set_image_border_radius",
    "Set rounded corners on an image object in pixels. Use radius 0 to remove rounded corners.",
    "medium",
    toolSchemas.set_image_border_radius,
    (input, context) => context.setImageBorderRadius(input),
  ),
  get_image_object_info: tool(
    "get_image_object_info",
    "Return exact source pixel dimensions, current crop, and canvas bounds for an image object. Use this before crop_image_object.",
    "low",
    toolSchemas.get_image_object_info,
    (input, context) => context.getImageObjectInfo(input),
  ),
  crop_image_object: tool(
    "crop_image_object",
    "Apply a deterministic non-destructive crop to an image using source pixel or normalized coordinates.",
    "medium",
    toolSchemas.crop_image_object,
    (input, context) => context.cropImageObject(input),
  ),
  reset_image_crop: tool(
    "reset_image_crop",
    "Reset an image object to show the full source image.",
    "medium",
    toolSchemas.reset_image_crop,
    (input, context) => context.resetImageCrop(input),
  ),
  fit_objects_in_canvas: tool(
    "fit_objects_in_canvas",
    "Deterministically move and scale objects so their visual bounds fit inside the canvas safe area.",
    "medium",
    toolSchemas.fit_objects_in_canvas,
    (input, context) => context.fitObjectsInCanvas(input),
  ),
  repair_canvas_overflow: tool(
    "repair_canvas_overflow",
    "Deterministically repair selected or all objects that are clipped outside the canvas safe area.",
    "medium",
    toolSchemas.repair_canvas_overflow,
    (input, context) => context.repairCanvasOverflow(input),
  ),
  normalize_text_box: tool(
    "normalize_text_box",
    "Reset distorted text scaling and fit a textbox within width/height constraints.",
    "medium",
    toolSchemas.normalize_text_box,
    (input, context) => context.normalizeTextBox(input),
  ),
  layout_stack: tool(
    "layout_stack",
    "Deterministically arrange objects in a vertical or horizontal stack inside a bounding rectangle.",
    "medium",
    toolSchemas.layout_stack,
    (input, context) => context.layoutStack(input),
  ),
  align_object: tool("align_object", "Align an object to the canvas bounds.", "medium", toolSchemas.align_object, (input, context) =>
    context.alignObject(input),
  ),
  reorder_object: tool("reorder_object", "Change an object's z-order.", "medium", toolSchemas.reorder_object, (input, context) =>
    context.reorderObject(input),
  ),
  select_object: tool("select_object", "Select an object by durable canvas object ID.", "low", toolSchemas.select_object, (input, context) =>
    context.selectObject(input),
  ),
  delete_objects: tool("delete_objects", "Delete one or more canvas objects.", "high", toolSchemas.delete_objects, (input, context) =>
    context.deleteObjects(input),
  ),
  duplicate_objects: tool("duplicate_objects", "Duplicate one or more canvas objects.", "medium", toolSchemas.duplicate_objects, (input, context) =>
    context.duplicateObjects(input),
  ),
  set_object_shadow: tool(
    "set_object_shadow",
    "Set or remove a drop shadow on a canvas object. Pass shadow:null to remove it.",
    "medium",
    toolSchemas.set_object_shadow,
    (input, context) => context.setObjectShadow(input),
  ),
  set_object_blur: tool(
    "set_object_blur",
    "Apply a Gaussian blur filter to a canvas object. blur:0 removes the blur.",
    "medium",
    toolSchemas.set_object_blur,
    (input, context) => context.setObjectBlur(input),
  ),
  set_object_blend_mode: tool(
    "set_object_blend_mode",
    "Set how an object composites with layers below it (blend mode / globalCompositeOperation). Use 'source-over' to reset.",
    "medium",
    toolSchemas.set_object_blend_mode,
    (input, context) => context.setObjectBlendMode(input),
  ),
  undo: tool("undo", "Undo the latest canvas edit.", "low", toolSchemas.undo, (_input, context) => context.undo()),
  redo: tool("redo", "Redo the latest undone canvas edit.", "low", toolSchemas.redo, (_input, context) => context.redo()),
  save: tool("save", "Save the current design.", "medium", toolSchemas.save, (_input, context) => context.save()),
};

export async function executeCanvasTool(
  name: CanvasToolName,
  rawInput: unknown,
  context: CanvasToolExecutionContext,
): Promise<CanvasToolResult> {
  const definition = CANVAS_TOOL_REGISTRY[name];
  if (!definition) return failure(String(name), `Unknown canvas tool: ${String(name)}`);
  const parsed = definition.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return failure(
      definition.name,
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "),
    );
  }

  try {
    return await definition.executor(parsed.data, context);
  } catch (error) {
    return failure(definition.name, error instanceof Error ? error.message : "Canvas tool failed.");
  }
}

export function canvasToolSuccess(
  toolName: CanvasToolName,
  summary: string,
  options: Partial<Omit<CanvasToolResult, "ok" | "toolName" | "summary" | "errors">> = {},
): CanvasToolResult {
  return {
    ok: true,
    toolName,
    changedObjectIds: options.changedObjectIds ?? [],
    selectedObjectIds: options.selectedObjectIds,
    errors: [],
    summary,
    data: options.data,
  };
}

export function canvasToolFailure(toolName: CanvasToolName, summary: string, errors = [summary]): CanvasToolResult {
  return {
    ok: false,
    toolName,
    changedObjectIds: [],
    errors,
    summary,
  };
}

function tool<Name extends CanvasToolName>(
  name: Name,
  description: string,
  riskLevel: CanvasToolRisk,
  inputSchema: (typeof toolSchemas)[Name],
  executor: CanvasToolDefinition<any>["executor"],
): CanvasToolDefinition<any> {
  return { name, description, riskLevel, inputSchema, jsonSchema: toolJsonSchemas[name], executor };
}

function failure(toolName: string, message: string): CanvasToolResult {
  return {
    ok: false,
    toolName,
    changedObjectIds: [],
    errors: [message],
    summary: message,
  };
}
