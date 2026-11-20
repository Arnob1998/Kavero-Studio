import type { HubSnapshot } from './model-hub-contract';
import type { SetupSnapshot } from '@/modules/generation/local/setup-contract';
import { localProfiles } from './browser-profiles';
export const previewOwner = '110fce0e-22ba-4a44-a68a-6619b477ca1b';
export const previewDevice = '44697489-d22b-432b-818b-155f201cc52d';
export const previewSource = { id: 'qwen', source: 'https://huggingface.co/Abiray/Qwen-Image-2.1-GGUF', preferredFile: localProfiles[0].file };
export function previewSnapshot(changes: Partial<HubSnapshot> = {}): HubSnapshot {
  return { schemaVersion: 1, source: previewSource, requestedRevision: 'main', revision: 'a'.repeat(40), sourceValidity: 'valid', recipeSupport: 'known-recipe', declared: null, readme: null,
    selectedFile: { name: localProfiles[0].file, bytes: 1024, sha256: 'a'.repeat(64) }, variants: [], license: null, components: [], recipeId: localProfiles[0].recipeId, recipeManifest: localProfiles[0].manifest,
    hardware: 'not-checked', installation: 'not-checked', smoke: 'not-run', ready: false, installable: false, issues: [], ...changes };
}
export function previewSetup(changes: Partial<SetupSnapshot> = {}): SetupSnapshot {
  return { packageId: 'qwen-2-1-research-delivery-v1', manifest: localProfiles[0].manifest, termsDigest: 'b'.repeat(64), consentToken: '1760000000000.' + 'c'.repeat(64), purpose: 'research-evaluation', accepted: true,
    available: true, supported: true, compatibility: 'eligible', ready: true, installed: true, freeBytes: 100 * 1024 ** 3, downloadBytes: 10 * 1024 ** 3, workBytes: 20 * 1024 ** 3, requiredFreeBytes: 21 * 1024 ** 3, operation: null, ...changes };
}
