import { z } from "zod";
import { SEQUENCE_PRODUCT_LIMITS } from "./limits";
import { sequencePlanDraftSchema, sequencePlannerReferenceSchema } from "./planner-schema";

export const freezeSequenceRunSchema = z.object({
  goal: z.string().trim().min(1).max(12000),
  plannerModelAlias: z.string().trim().min(1).max(200),
  imageModelAlias: z.string().trim().min(1).max(200),
  plannerCallsUsed: z.number().int().min(1).max(SEQUENCE_PRODUCT_LIMITS.maximumPlannerCalls),
  revision: z.number().int().min(1).max(1000),
  plan: sequencePlanDraftSchema,
  references: z.array(sequencePlannerReferenceSchema).max(8),
}).superRefine((input, context) => {
  const referenceIds = new Set(input.references.map((reference) => reference.id));
  if (referenceIds.size !== input.references.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["references"], message: "Reference IDs must be unique." });
  }
  const frameIds = new Set<string>();
  for (const [index, frame] of input.plan.frames.entries()) {
    if (frameIds.has(frame.id)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["plan", "frames", index, "id"], message: "Frame IDs must be unique." });
    }
    if (frame.referenceIds.some((id) => !referenceIds.has(id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["plan", "frames", index, "referenceIds"], message: "Frame references must exist in the approved input set." });
    }
    if (frame.dependencies.some((id) => !frameIds.has(id))) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["plan", "frames", index, "dependencies"], message: "Dependencies must point to earlier frames." });
    }
    frameIds.add(frame.id);
  }
  const totalBytes = input.references.reduce((total, reference) => total + reference.byteSize, 0);
  if (totalBytes > SEQUENCE_PRODUCT_LIMITS.maximumTotalUploadBytes) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["references"], message: "Sequence references exceed the total byte limit." });
  }
});

export type FreezeSequenceRunInput = z.infer<typeof freezeSequenceRunSchema>;

const sequenceRunActionBase = z.object({
  sequenceId: z.string().uuid(),
  expectedVersion: z.number().int().min(1),
});

export const sequenceRunActionSchema = z.discriminatedUnion("action", [
  sequenceRunActionBase.extend({ action: z.literal("start") }),
  sequenceRunActionBase.extend({
    action: z.literal("attempt-start"),
    frameId: z.string().trim().min(1).max(80),
    attemptId: z.string().uuid(),
    replacesOutputId: z.string().uuid().nullable().optional(),
  }),
  sequenceRunActionBase.extend({
    action: z.literal("attempt-success"),
    attemptId: z.string().uuid(),
    generatedImageId: z.string().uuid(),
    modelAlias: z.string().trim().min(1).max(200),
    prompt: z.string().trim().min(1).max(12000),
    referenceIds: z.array(z.string().trim().min(1).max(80)).max(8),
    sourceOutputIds: z.array(z.string().uuid()).max(8),
  }),
  sequenceRunActionBase.extend({
    action: z.literal("attempt-failure"),
    attemptId: z.string().uuid(),
    errorCode: z.string().trim().min(1).max(80),
    retryable: z.boolean(),
  }),
  sequenceRunActionBase.extend({ action: z.literal("cancel") }),
  sequenceRunActionBase.extend({ action: z.literal("resume") }),
]);

export type SequenceRunActionInput = z.infer<typeof sequenceRunActionSchema>;
