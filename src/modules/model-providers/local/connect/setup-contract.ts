import { z } from 'zod';
import { profile, uuid, fingerprint } from './contracts';

export const setupState = z.enum(['requested','delivered','awaiting-approval','approved','admitted','downloading','verifying','activation-needed','ready','assessed','cancelling','cancelled','failed','rejected','interrupted','expired']);
export const setupOwnerCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('review'), deviceId: uuid, profile }).strict(),
  z.object({ action: z.literal('prepare'), deviceId: uuid, profile }).strict(),
  z.object({ action: z.literal('recover'), key: uuid }).strict(),
  z.object({ action: z.literal('create'), key: uuid, deviceId: uuid, profile, kind: z.enum(['assess','install']), reviewHash: fingerprint.optional(), accepted: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal('inspect'), id: uuid }).strict(),
  z.object({ action: z.literal('cancel'), id: uuid }).strict(),
]).superRefine((value, ctx) => {
  if (value.action === 'create' && (value.kind === 'install' ? !value.reviewHash || value.accepted !== true : value.reviewHash !== undefined || value.accepted !== undefined)) ctx.addIssue({ code: 'custom', message: 'Install requires explicit acceptance of the exact destination-bound review.' });
});
const bytes = z.number().int().nonnegative().max(2 ** 50);
export const setupEvidence = z.object({
  capturedAt: z.string().datetime(), manifestHash: fingerprint,
  compatibility: z.enum(['eligible','windows-only','multiple-gpus','gpu-unverified','gpu-too-small','ram-too-small','check-unavailable']),
  totalVramMiB: bytes.nullable(), freeVramMiB: bytes.nullable(), totalRamBytes: bytes.nullable(), freeRamBytes: bytes.nullable(),
  freeDiskBytes: bytes.nullable(), requiredFreeBytes: bytes.nullable(), installed: z.boolean().nullable(),
}).strict();
export const setupDeviceCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setup-poll'), setupProtocol: z.literal(1), session: uuid, approvedOwner: uuid, recoverId: uuid.optional(), profiles: z.array(profile).min(1).max(2).refine(values => new Set(values).size === values.length) }).strict(),
  z.object({ action: z.literal('setup-checkpoint'), setupProtocol: z.literal(1), session: uuid, id: uuid, token: uuid, attempt: z.number().int().positive().max(2147483647), sequence: z.number().int().positive().max(2147483647), intentHash: fingerprint,
    state: setupState.exclude(['requested','delivered','expired']), processedBytes: bytes,
    operationId: uuid.optional(), evidence: setupEvidence.optional(),
    approval: z.object({ ownerId: uuid, deviceId: uuid, intentHash: fingerprint, manifestHash: fingerprint, termsDigest: fingerprint, accepted: z.literal(true) }).strict().optional(),
    reason: z.enum(['permission-denied','model-changed','identity-changed','worker-busy','setup-failed','cancel-unconfirmed','unsupported-runtime']).optional(),
  }).strict(),
]);
export const setupIntent = z.object({ setupProtocol: z.literal(1), ownerId: uuid, origin: z.string().url().max(512), deviceId: uuid, installationId: uuid,
  keyVersion: z.number().int().positive(), profile, manifestHash: fingerprint, termsDigest: fingerprint, purpose: z.literal('research-evaluation'), recipeHash: fingerprint }).strict();
export const setupRequestView = z.object({ id: uuid, deviceId: uuid, key: uuid, kind: z.enum(['assess','install']), intent: setupIntent, intentHash: fingerprint,
  state: setupState, cancelRequested: z.boolean(), processedBytes: bytes, operationId: uuid.nullable(), evidence: setupEvidence.nullable(),
  reason: z.string().max(80).nullable(), createdAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }), version: z.number().int().positive(),
}).strict();
export const setupDeviceView = setupRequestView.extend({ ownerId: uuid, session: uuid, token: uuid, attempt: z.number().int().positive(), sequence: z.number().int().nonnegative(), phase: z.number().int().min(0).max(7), leaseUntil: z.string().datetime({ offset: true }), reconcile: z.literal(true) }).strict();
export const setupPreparation = z.object({setupProtocol:z.literal(1),intent:setupIntent,intentHash:fingerprint,deviceName:z.string().min(1).max(60),expiresAt:z.string().datetime(),capable:z.boolean(),installable:z.boolean(),message:z.string().max(250),assessment:setupRequestView.nullable(),active:setupRequestView.nullable(),notices:z.array(z.object({name:z.string().max(160),sha256:fingerprint}).strict()).max(64)}).strict();
export function setupGate() {
  if (['SETUP','DELIVERY','EXECUTION','RESULTS'].some(flag => process.env[`KAVERO_CONNECT_${flag}_ENABLED`] !== '1')) return { status: 404, error: 'Remote setup is not enabled.' };
  if (process.env.KAVERO_STORAGE_PROVIDER !== 'kavero-managed' || process.env.KAVERO_MANAGED_STORAGE_BACKEND !== 'supabase-storage') return { status: 503, error: 'Remote setup requires the configured Remote website storage.' };
  return null;
}
