import { createHash } from "node:crypto";
import { z } from "zod";
import { publicLocalOutput, type LocalOutputDescriptor, type LocalOutputStatus } from "./output-contract";
import { LOCAL_IMAGE_CAPABILITIES as limits } from "./capabilities";
import { localFailureMessage, validateLocalFailure, type LocalFailure } from "@/modules/model-providers/local/failure";

export const localJobIntentSchema = z.object({
  prompt: z.string().min(1).max(limits.maxPromptCharacters).refine(value => value.trim().length > 0),
  width: z.literal(limits.width), height: z.literal(limits.height), count: z.literal(limits.count),
  profile: z.literal(limits.profile),
}).strict();
export const localSubmissionSchema = z.object({
  idempotencyKey: z.string().uuid(), intent: localJobIntentSchema,
}).strict();
export type LocalJobIntent = z.infer<typeof localJobIntentSchema>;
export const localJobStates = ["pending", "queued", "dispatching", "running", "cancel-requested", "submission-unknown", "generated-unvalidated", "failed", "cancelled"] as const;
export type LocalJobState = typeof localJobStates[number];
export type LocalJobRecord = {
  id: string; owner_id: string; submission_key: string; request_hash: string;
  intent: LocalJobIntent; package_fingerprint: string; device_id: string; worker_identity: string;
  state: LocalJobState; created_at: string;
  output_descriptor?: LocalOutputDescriptor | null;
  output_status?: LocalOutputStatus;
  failure?: LocalFailure;
};
export function localIntentHash(intent: LocalJobIntent) {
  return createHash("sha256").update(JSON.stringify({
    profile: intent.profile, prompt: intent.prompt, width: intent.width,
    height: intent.height, count: intent.count,
  })).digest("hex");
}
export function localJobSummary(job: LocalJobRecord) {
  const failure = job.failure && ["failed", "submission-unknown"].includes(job.state) ? validateLocalFailure(job.failure) : null;
  return { id: job.id, state: job.state, createdAt: job.created_at, ...(job.output_status ? { output: publicLocalOutput(job.output_status) } : {}), ...(failure ? { failure: { ...failure, message: localFailureMessage(failure.code) } } : {}) };
}

