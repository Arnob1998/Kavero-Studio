import { z } from "zod";
import {validateJobSnapshot,type LocalRecipeSnapshot} from "@/modules/model-providers/local/job-snapshot";
const snapshotSchema=z.custom<LocalRecipeSnapshot>(value=>{try{validateJobSnapshot(value);return true;}catch{return false;}});

export const localOutputDescriptorSchema = z.object({
  jobId: z.string().uuid(), ownerId: z.string().uuid(), ledgerIdentity: z.string().uuid(),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/), packageFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  deviceId: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  sizeBytes: z.number().int().positive().max(32 * 1024 * 1024),
  width: z.literal(512), height: z.literal(512), mimeType: z.literal("image/png"),
  generatedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  recipeSnapshot:snapshotSchema.optional(),
}).strict().refine(value => Date.parse(value.expiresAt) - Date.parse(value.generatedAt) === 24 * 60 * 60 * 1000);
export type LocalOutputDescriptor = z.infer<typeof localOutputDescriptorSchema>;
export const localOutputStatusSchema = z.object({
  state: z.enum(["pending", "generated", "invalid", "expired"]),
  descriptor: localOutputDescriptorSchema.nullable(),
}).strict().refine(value => !["generated", "expired"].includes(value.state) || value.descriptor !== null);
export type LocalOutputStatus = z.infer<typeof localOutputStatusSchema>;
export function publicLocalOutput(output: LocalOutputStatus) {
  const descriptor = output.descriptor;
  return { state: output.state, ...(descriptor ? {
    sha256: descriptor.sha256, sizeBytes: descriptor.sizeBytes, width: descriptor.width, height: descriptor.height,
    mimeType: descriptor.mimeType, generatedAt: descriptor.generatedAt, expiresAt: descriptor.expiresAt,
  } : {}) };
}
