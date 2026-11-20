import type {LocalProfile} from '@/modules/model-providers/local/browser-profiles';
// Historical Q4 descriptor retained for existing callers; selection uses the registry.
export const LOCAL_IMAGE_CAPABILITIES = {
  profile: "qwen-image-2.1-q4-evaluation", label: "Qwen Image 2.1 · Q4",
  width: 512, height: 512, count: 1, maxPromptCharacters: 1000,
  references: false, editing: false, planning: false,
} as const;
export function localPromptError(prompt: string) {
  if (!prompt.trim()) return "Describe the image you want to create.";
  if (prompt.length > LOCAL_IMAGE_CAPABILITIES.maxPromptCharacters) return "Use up to 1,000 characters. Your prompt has not been shortened.";
  return null;
}
export function localSourceBlockReason({ references, activeResult, generating, sequence }: { references: number; activeResult: boolean; generating: boolean; sequence: boolean }) {
  return references || activeResult || generating || sequence ? "Finish or close the current result, references or sequence before switching to Local." : null;
}
export type LocalBrowserJob = { id: string; state: string; createdAt: string; output?: {
  state: "pending" | "generated" | "invalid" | "expired"; expiresAt?: string;
} };
export type LocalBrowserSave = { state: "unsaved" | "saving" | "save-failed" | "saved";
  generationId?: string; imageId?: string; historyRemoved?: boolean; storageProvider?: string; storageBackend?: string };
export type LocalBrowserReadiness = {
  ownerId: string; ready: boolean; saveAvailable: boolean; saveDestination: string;
  hardware?: { freeVramMiB: number; freeRamBytes: number };
  model?: {profile:LocalProfile;label:string;width:512;height:512;count:1;maxPromptCharacters:1000;references:false;editing:false;planning:false;sequence:false}|null;
};
export function localProgressMessage(job: LocalBrowserJob | null, reconnecting: boolean, readiness?: LocalBrowserReadiness | null) {
  if (reconnecting) return "Reconnecting to your existing job…";
  if (job?.state === "submission-unknown" || !job) return "Checking whether your job was accepted…";
  if (["pending", "queued"].includes(job.state)) {
    // Readiness is polled already. Never present stale offline measurements,
    // or infer that an already running job is waiting on its allocated memory.
    const hardware = readiness?.ready ? readiness.hardware : undefined;
    if (hardware && Number.isFinite(hardware.freeVramMiB) && hardware.freeVramMiB >= 0 && hardware.freeVramMiB < 6144)
      return `Waiting for GPU memory · ${(hardware.freeVramMiB / 1024).toFixed(1)} GB available; 6 GB required.`;
    if (hardware && Number.isFinite(hardware.freeRamBytes) && hardware.freeRamBytes >= 0 && hardware.freeRamBytes < 8 * 1024 ** 3)
      return `Waiting for system memory · ${(hardware.freeRamBytes / 1024 ** 3).toFixed(1)} GB available; 8 GB required.`;
    return "Queued · waiting for available resources.";
  }
  if (job.state === "dispatching") return "Preparing generation…";
  if (job.state === "running") return "Generating on your GPU.";
  if (job.state === "cancel-requested") return "Cancelling…";
  if (job.state === "generated-unvalidated") return "Validating your image…";
  return "Checking job status…";
}
export function localJobMessage(job: LocalBrowserJob | null, reconnecting: boolean, save: LocalBrowserSave, readiness?: LocalBrowserReadiness | null) {
  if (save.state === "saved") return save.historyRemoved ? "This image was removed from Gallery." : "Saved to Gallery.";
  if (reconnecting) return "Reconnecting to your existing job…";
  if (save.state === "saving") return "Saving your image…";
  if (job?.output?.state === "expired") return "The temporary image has expired.";
  if (job?.output?.state === "invalid") return "The image failed validation.";
  if (job?.output?.state === "generated") return save.state === "save-failed" ? "Image ready. Saving failed; you can download or retry." : "Your image is ready.";
  if (job?.state === "failed") return "Generation stopped. Check the local engine before creating again.";
  if (job?.state === "cancelled") return "Generation cancelled.";
  if (job?.state === "cancel-requested") return "Cancelling…";
  if (job) return localProgressMessage(job, reconnecting, readiness);
  return "Ready to create.";
}
