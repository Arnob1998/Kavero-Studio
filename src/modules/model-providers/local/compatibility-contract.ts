import { z } from 'zod';
import { hubSnapshot, hubSource } from './model-hub-contract';
export const modelDestination = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }).strict(),
  z.object({ kind: z.literal('remote'), deviceId: z.string().uuid() }).strict(),
]);
export const compatibilityRequest = z.object({ source: hubSource.strict(), destination: modelDestination }).strict();
const evidence = z.object({ state: z.enum(['pass', 'blocked', 'unknown']), message: z.string().max(500) }).strict();
export const compatibilityResult = z.object({
  version: z.literal(1), ownerId: z.string().uuid(), assessmentId: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.string().datetime(), expiresAt: z.string().datetime(), destination: modelDestination, destinationName: z.string().max(100),
  source: hubSource, snapshot: hubSnapshot, runtime: evidence, hardware: evidence, storage: evidence, access: evidence, availability: evidence,
  ready: z.boolean(), installable: z.literal(false),
}).strict();
export type ModelDestination = z.infer<typeof modelDestination>;
export type CompatibilityResult = z.infer<typeof compatibilityResult>;
