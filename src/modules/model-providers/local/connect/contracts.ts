import { z } from "zod";

export const uuid = z.string().uuid();
export const publicKey = z.string().regex(/^[A-Za-z0-9_-]{59}$/);
export const name = z.string().trim().min(1).max(60).refine(v => !/[\x00-\x1f\x7f<>]/.test(v));
export const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
export const browserCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name }).strict(),
  z.object({ action: z.literal("confirm"), id: uuid, installationId: uuid, fingerprint }).strict(),
  z.object({ action: z.literal("cancel"), id: uuid }).strict(),
]);
export const profile = z.enum(["qwen-image-2.1-q4-evaluation", "qwen-image-2.1-q3-evaluation"]);
// Protocol-only candidate, never proof of installed weights or model permission.
export const deliveryBinding = z.object({profile, workerEpoch: uuid, ledgerIdentity: uuid,
  executionDevice: fingerprint, permission: z.boolean(), maintenance: z.boolean()}).strict();
export const jobCommand = z.discriminatedUnion("action", [
  z.object({action:z.literal("create"), deviceId:uuid, key:uuid, bindingHash:fingerprint, profile,
    execute:z.literal(true).optional(), prompt:z.string().min(1).max(1000).refine(value=>!!value.trim())}).strict(),
  z.object({action:z.literal("inspect"), id:uuid}).strict(),
  z.object({action:z.literal("cancel"), id:uuid}).strict(),
]);
export const deviceCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), epoch: uuid, report: z.object({
    platform: z.literal("win32"), arch: z.literal("x64"),
    node: z.string().regex(/^\d{1,2}\.\d{1,2}\.\d{1,2}$/),
    ramMiB: z.number().int().min(0).max(4194304),
    gpus: z.array(z.object({ label: name, vramMiB: z.number().int().min(0).max(1048576) }).strict()).max(8),
  }).strict() }).strict(),
  z.object({action:z.literal("execution-poll"), session:uuid, binding:deliveryBinding.nullable()}).strict(),
  z.object({action:z.literal("execution-checkpoint"), session:uuid, id:uuid, token:uuid,
    attempt:z.number().int().min(1).max(2147483647), sequence:z.number().int().min(1).max(2147483647),
    reason:z.enum(["queue-full","staging-full","permission-denied","identity-changed","worker-unavailable"]).optional(),
    state:z.enum(["accepted","running","submission-unknown","generated-unvalidated","failed","cancelled","rejected"])}).strict(),
  z.object({ action: z.literal("rotate"), publicKey }).strict(),
  z.object({ action: z.literal("unpair") }).strict(),
  z.object({action:z.literal("delivery-poll"), session:uuid, binding:deliveryBinding.nullable()}).strict(),
  z.object({action:z.literal("delivery-checkpoint"), session:uuid, id:uuid, token:uuid,
    attempt:z.number().int().min(1).max(2147483647), sequence:z.number().int().min(1).max(2147483647),
    reason:z.enum(["queue-full","staging-full","permission-denied","identity-changed","worker-unavailable"]).optional(),
    state:z.enum(["accepted","running","submission-unknown","generated-unvalidated","failed","cancelled","rejected"])}).strict(),
]);
export const claimCommand = z.object({
  code: z.string().regex(/^[a-f0-9]{24}$/), installationId: uuid, deviceId: uuid, publicKey,
  proof: z.string().regex(/^[A-Za-z0-9_-]{86}$/),
}).strict();
export const manageDeviceCommand = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), id: uuid, name }).strict(),
  z.object({ action: z.literal("revoke"), id: uuid }).strict(),
]);
