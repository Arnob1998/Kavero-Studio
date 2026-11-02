import { z } from "zod";

export const hubSource = z.object({ id: z.string().min(1).max(64), source: z.string().url().max(1024), preferredFile: z.string().max(180).optional() });
export const hubModel = z.object({
  id: z.string().uuid(), key: z.string().uuid(), createdAt: z.number().int(),
  state: z.enum(["inspected", "inspecting", "retry-required"]), source: hubSource,
  requestedRevision: z.string().max(120), revision: z.string().nullable(), sourceValidity: z.string().max(100),
  recipeSupport: z.string().max(100), license: z.string().max(512).nullable(), ready: z.literal(false), installable: z.literal(false),
});
const text = z.object({ content: z.string().max(256 * 1024), bytes: z.number().int(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).nullable();
export const hubLicense = z.object({ identifier: z.string().max(512).nullable(), sourceUrl: z.string().max(2048).nullable(), status: z.string().max(100), text, attribution: z.string().optional() });
const file = z.object({ name: z.string().max(180), bytes: z.number().nullable(), sha256: z.string().nullable() });
export const hubSnapshot = z.object({
  schemaVersion: z.literal(1), source: hubSource, requestedRevision: z.string(), revision: z.string().nullable(), sourceValidity: z.string(), recipeSupport: z.string(),
  declared: z.object({ task: z.string().max(512).nullable(), license: z.string().max(512).nullable(), licenseLink: z.string().max(512).nullable(), baseModel: z.string().max(512).nullable() }).nullable(),
  readme: z.object({ text: z.string().max(256 * 1024), sha256: z.string(), bytes: z.number(), url: z.string().max(2048) }).nullable(),
  selectedFile: file.nullable(), variants: z.array(file).max(1000), license: hubLicense.nullable(),
  components: z.array(z.object({ role: z.string().max(64), status: z.string().max(100), bytes: z.number(), sha256: z.string(), revision: z.string(), license: hubLicense })).max(4),
  recipeId: z.string().nullable(), recipeManifest: z.string().nullable(), hardware: z.literal("not-checked"), installation: z.literal("not-checked"), smoke: z.literal("not-run"),
  ready: z.literal(false), installable: z.literal(false), issues: z.array(z.string().max(100)).max(100),
}).nullable();
export const hubList = z.object({ models: z.array(hubModel).max(5), seeds: z.array(z.object({ source: hubSource, ready: z.literal(false), installable: z.literal(false) })).max(5), seedCount: z.number().int().max(100), nextOffset: z.number().int().nullable() });
export const hubDetail = z.object({ model: hubModel, snapshot: hubSnapshot });
export type HubSource = z.infer<typeof hubSource>;
export type HubModel = z.infer<typeof hubModel>;
export type HubSnapshot = NonNullable<z.infer<typeof hubSnapshot>>;
export type HubLicense = z.infer<typeof hubLicense>;
