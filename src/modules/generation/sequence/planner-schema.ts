import { z } from "zod";
import { SEQUENCE_PRODUCT_LIMITS } from "./limits";

export const sequenceReferenceRoles = [
  "frame-specific",
  "subject",
  "character",
  "product",
  "brand",
  "style",
  "palette",
  "typography",
  "composition",
] as const;

export const sequencePlannerReferenceSchema = z.object({
  id: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  role: z.enum(sequenceReferenceRoles),
  dataUrl: z.string().min(1),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]),
  byteSize: z.number().int().nonnegative().max(SEQUENCE_PRODUCT_LIMITS.maximumUploadBytes),
});

export const sequencePlanRequestSchema = z.object({
  goal: z.string().trim().min(1).max(12000),
  imageModelAlias: z.string().trim().min(1).max(200),
  plannerCallNumber: z.number().int().min(1).max(SEQUENCE_PRODUCT_LIMITS.maximumPlannerCalls),
  references: z.array(sequencePlannerReferenceSchema).max(8).default([]),
});

const sharedRulesSchema = z.object({
  style: z.string().trim().max(1200).nullable(),
  subject: z.string().trim().max(1200).nullable(),
  character: z.string().trim().max(1200).nullable(),
  product: z.string().trim().max(1200).nullable(),
  palette: z.string().trim().max(1200).nullable(),
  typography: z.string().trim().max(1200).nullable(),
  composition: z.string().trim().max(1200).nullable(),
});

export const sequencePlanFrameSchema = z.object({
  id: z.string().trim().min(1).max(80),
  purpose: z.string().trim().min(1).max(800),
  prompt: z.string().trim().min(1).max(12000),
  referenceIds: z.array(z.string().trim().min(1).max(80)).max(8),
  dependencies: z.array(z.string().trim().min(1).max(80)).max(SEQUENCE_PRODUCT_LIMITS.maximumFrames - 1),
});

export const sequencePlanDraftSchema = z.object({
  title: z.string().trim().min(1).max(160),
  sequenceType: z.string().trim().min(1).max(80),
  countRationale: z.string().trim().min(1).max(1200),
  sharedRules: sharedRulesSchema,
  frames: z.array(sequencePlanFrameSchema).min(2).max(SEQUENCE_PRODUCT_LIMITS.maximumFrames),
  warnings: z.array(z.string().trim().min(1).max(800)).max(12),
  assumptions: z.array(z.string().trim().min(1).max(800)).max(12),
});

export type SequencePlannerReferenceInput = z.infer<typeof sequencePlannerReferenceSchema>;
export type SequencePlanRequestInput = z.infer<typeof sequencePlanRequestSchema>;
export type SequencePlanDraft = z.infer<typeof sequencePlanDraftSchema>;
export type SequencePlanFrameDraft = z.infer<typeof sequencePlanFrameSchema>;

export const sequencePlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", minLength: 1, maxLength: 160 },
    sequenceType: { type: "string", minLength: 1, maxLength: 80 },
    countRationale: { type: "string", minLength: 1, maxLength: 1200 },
    sharedRules: {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(
        ["style", "subject", "character", "product", "palette", "typography", "composition"].map((key) => [
          key,
          { anyOf: [{ type: "string", maxLength: 1200 }, { type: "null" }] },
        ]),
      ),
      required: ["style", "subject", "character", "product", "palette", "typography", "composition"],
    },
    frames: {
      type: "array",
      minItems: 2,
      maxItems: SEQUENCE_PRODUCT_LIMITS.maximumFrames,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 80 },
          purpose: { type: "string", minLength: 1, maxLength: 800 },
          prompt: { type: "string", minLength: 1, maxLength: 12000 },
          referenceIds: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 80 } },
          dependencies: {
            type: "array",
            maxItems: SEQUENCE_PRODUCT_LIMITS.maximumFrames - 1,
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
        },
        required: ["id", "purpose", "prompt", "referenceIds", "dependencies"],
      },
    },
    warnings: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 800 } },
    assumptions: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 800 } },
  },
  required: ["title", "sequenceType", "countRationale", "sharedRules", "frames", "warnings", "assumptions"],
} as const;

export function validateAndNormalizeSequencePlan(
  value: unknown,
  referenceIds: ReadonlySet<string>,
): { success: true; plan: SequencePlanDraft } | { success: false; reason: string } {
  const parsed = sequencePlanDraftSchema.safeParse(value);
  if (!parsed.success) return { success: false, reason: "schema" };

  const frameIds = new Set<string>();
  for (const frame of parsed.data.frames) {
    if (frameIds.has(frame.id)) return { success: false, reason: "duplicate-frame-id" };
    frameIds.add(frame.id);
  }

  const normalizedFrames: SequencePlanFrameDraft[] = [];
  const priorFrameIds = new Set<string>();
  for (const frame of parsed.data.frames) {
    if (frame.referenceIds.some((id) => !referenceIds.has(id))) {
      return { success: false, reason: "unknown-reference" };
    }
    if (frame.dependencies.some((id) => !priorFrameIds.has(id))) {
      return { success: false, reason: "invalid-dependency" };
    }
    normalizedFrames.push({
      ...frame,
      referenceIds: [...new Set(frame.referenceIds)],
      dependencies: [...new Set(frame.dependencies)],
    });
    priorFrameIds.add(frame.id);
  }

  return { success: true, plan: { ...parsed.data, frames: normalizedFrames } };
}

export function shouldSuggestSequence(goal: string) {
  return /\b(sequence|carousel|storyboard|comic|slide\s+set|image\s+series|product\s+series)\b/i.test(goal);
}
