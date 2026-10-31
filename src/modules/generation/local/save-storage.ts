import { createHash } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { getGoogleDriveConnection, getGoogleDriveAccessTokenForUser } from "@/lib/google-drive";
import { resolveRuntimeManagedStorageBackend } from "@/modules/storage/managed/runtime";
import type { ManagedStorageBackend } from "@/modules/storage/managed/kavero-managed-storage";
import { StorageError, type StoredObjectRef, type StoragePurpose } from "@/modules/storage/storage-provider";
import { reserveLocalDriveIds, readLocalDriveObject, createLocalDriveObject } from "@/modules/storage/providers/google-drive/local-image-save";
import type { LocalSaveDestination, LocalSaveMapping, LocalSaveRecord } from "./save-contract";
import type { LocalJobRecord } from "./contracts";

export const objectSHA = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type DestinationRuntime = { destination: LocalSaveDestination; backend?: ManagedStorageBackend; token?: string };
export async function resolveLocalSaveDestination(owner: string, admin: unknown): Promise<DestinationRuntime> {
  const provider = process.env.KAVERO_STORAGE_PROVIDER?.trim() || "google-drive";
  if (provider === "google-drive") {
    const connection = await getGoogleDriveConnection(owner);
    if (!connection || !connection.google_email || connection.status !== "active" || connection.folder_status !== "available") throw new Error("local-save-storage-not-ready");
    const token = await getGoogleDriveAccessTokenForUser(owner); if (!token) throw new Error("local-save-storage-not-ready");
    return { destination: { provider, connectionId: connection.id, email: connection.google_email, folderId: connection.folder_id }, token };
  }
  if (provider !== "kavero-managed") throw new Error("local-save-storage-not-ready");
  const resolved = resolveRuntimeManagedStorageBackend({ admin });
  if (!resolved.ok || !["supabase-storage", "local-filesystem"].includes(resolved.backend.id)) throw new Error("local-save-storage-not-ready");
  const backend = resolved.backend;
  await backend.ensureReady({ userId: owner, purpose: "generated-image" });
  await backend.ensureReady({ userId: owner, purpose: "generated-metadata" });
  let location: string;
  if (backend.id === "local-filesystem") {
    const configuredRoot = process.env.KAVERO_LOCAL_STORAGE_ROOT?.trim();
    if (!configuredRoot) throw new Error("local-save-storage-not-ready");
    // This server-configured data directory is provisioned separately from the
    // application bundle; do not trace its contents into deployment artifacts.
    const root = await realpath(/* turbopackIgnore: true */ configuredRoot);
    const info = await stat(/* turbopackIgnore: true */ root);
    if (!info.isDirectory()) throw new Error("local-save-storage-not-ready");
    location = `${root}|device=${info.dev}|inode=${info.ino}`;
  } else {
    location = process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    if (!location) throw new Error("local-save-storage-not-ready");
  }
  return { destination: { provider, backendId: backend.id as "supabase-storage" | "local-filesystem", location }, backend };
}
function refFor(save: LocalSaveRecord, purpose: StoragePurpose, name: string, externalId?: string): StoredObjectRef {
  const destination = save.destination, mimeType = purpose === "generated-image" ? "image/png" : "application/json";
  if (destination.provider === "google-drive") {
    if (!externalId) throw new Error("local-save-mapping-invalid");
    return { providerId: "google-drive", kind: "connected", purpose, objectKey: externalId, bucket: null, path: null,
      externalId, externalUrl: `https://drive.google.com/file/d/${encodeURIComponent(externalId)}/view`,
      metadata: { folderId: destination.folderId, name, contentType: mimeType }, status: "available", version: 1 };
  }
  const key = `users/${save.owner_id}/local-generated/${save.generation_id}/${name}`;
  return { providerId: "kavero-managed", kind: "managed", purpose, objectKey: key, path: key,
    bucket: purpose === "generated-image" ? "kavero-generated-images" : "kavero-generated-metadata", externalId: null, externalUrl: null,
    metadata: { backendProviderId: destination.backendId, name, contentType: mimeType }, status: "available", version: 1 };
}
export async function createLocalSaveMapping(save: LocalSaveRecord, job: LocalJobRecord, runtime: DestinationRuntime): Promise<LocalSaveMapping> {
  const ids = runtime.token ? await reserveLocalDriveIds(runtime.token) : undefined;
  const imageRef = refFor(save, "generated-image", `${save.image_id}.png`, ids?.[0]);
  const metadataRef = refFor(save, "generated-metadata", `${save.image_id}.json`, ids?.[1]);
  const metadataBody = JSON.stringify({ version: 1, localJobId: job.id, generationId: save.generation_id, imageId: save.image_id,
    prompt: job.intent.prompt, model: job.intent.profile, variant: 1, mimeType: "image/png", width: 512, height: 512,
    sha256: save.sha256, packageFingerprint: job.package_fingerprint, imageObjectKey: imageRef.objectKey, createdAt: save.created_at });
  return { imageRef, metadataRef, metadataBody };
}
async function toBoundedBuffer(data: ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer, max: number) {
  if (data instanceof ReadableStream) {
    const reader = data.getReader(), chunks: Uint8Array[] = []; let size = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length;
      if (size > max) { await reader.cancel(); throw new Error("local-save-object-conflict"); } chunks.push(value); }
    return Buffer.concat(chunks);
  }
  const bytes = Buffer.from(data instanceof Uint8Array ? data : new Uint8Array(data));
  if (bytes.length > max) throw new Error("local-save-object-conflict");
  return bytes;
}
export async function readLocalSaveObject(runtime: DestinationRuntime, save: LocalSaveRecord, ref: StoredObjectRef, sha: string, size: number) {
  let bytes: Buffer | null;
  if (runtime.token) bytes = await readLocalDriveObject(runtime.token, ref, save.job_id, sha, size);
  else {
    if (!runtime.backend) throw new Error("local-save-storage-not-ready");
    try { const result = await runtime.backend.readObject({ userId: save.owner_id, ref }); bytes = await toBoundedBuffer(result.data, size); }
    catch (error) { if (error instanceof StorageError && error.code === "missing") return null; throw error; }
  }
  if (bytes && (bytes.length !== size || objectSHA(bytes) !== sha)) throw new Error("local-save-object-conflict");
  return bytes;
}
export async function ensureLocalSaveObject(runtime: DestinationRuntime, save: LocalSaveRecord, ref: StoredObjectRef, bytes: Buffer, assertActive: () => void) {
  const sha = objectSHA(bytes);
  assertActive();
  const existing = await readLocalSaveObject(runtime, save, ref, sha, bytes.length); assertActive();
  if (existing) return;
  let uploadError: unknown;
  try {
    if (runtime.token) await createLocalDriveObject(runtime.token, ref, save.job_id, sha, bytes);
    else {
      if (!runtime.backend) throw new Error("local-save-storage-not-ready");
      await runtime.backend.uploadObject({ userId: save.owner_id, purpose: ref.purpose,
        name: String(ref.metadata?.name), mimeType: String(ref.metadata?.contentType), data: bytes, metadata: { ...ref.metadata, objectKey: ref.objectKey } });
    }
  } catch (error) { uploadError = error; }
  // Re-read even after failure: an upload may have succeeded before its ack
  // disappeared. Never delete potentially committed objects on an uncertain ack.
  assertActive();
  const confirmed = await readLocalSaveObject(runtime, save, ref, sha, bytes.length); assertActive();
  if (!confirmed) throw uploadError ?? new Error("local-save-storage-unconfirmed");
}
