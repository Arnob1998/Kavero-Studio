export const storagePurposes = [
  "generated-image",
  "generated-metadata",
  "canvas-asset",
  "canvas-export",
  "imported-file",
] as const;

export type StoragePurpose = (typeof storagePurposes)[number];

export const storageProviderKinds = ["managed", "connected"] as const;

export type StorageProviderKind = (typeof storageProviderKinds)[number];

export const storageProviderIds = [
  "kavero-managed",
  "google-drive",
  "local-filesystem",
  "supabase-storage",
  "s3-compatible",
] as const;

export type StorageProviderId = (typeof storageProviderIds)[number];

export const storageProviderKindById = {
  "kavero-managed": "managed",
  "google-drive": "connected",
  "local-filesystem": "managed",
  "supabase-storage": "managed",
  "s3-compatible": "managed",
} as const satisfies Record<StorageProviderId, StorageProviderKind>;

export type StorageProviderKindForId<TProviderId extends StorageProviderId> =
  (typeof storageProviderKindById)[TProviderId];

/**
 * kavero-managed is the logical app-managed provider identity that product
 * modules should prefer for Kavero-owned storage. Backend IDs such as
 * supabase-storage, local-filesystem, and s3-compatible describe possible
 * future implementations and are not wired to runtime selection yet.
 */

export const storageObjectStatuses = [
  "available",
  "missing",
  "unknown",
  "reconnect_required",
  "unavailable",
] as const;

export type StorageObjectStatus = (typeof storageObjectStatuses)[number];

export type StorageStatus = {
  providerId: StorageProviderId;
  kind: StorageProviderKind;
  ready: boolean;
  connected: boolean;
  reconnectRequired?: boolean;
  missingRoot?: boolean;
  warning?: string | null;
};

export type StoredObjectRef = {
  providerId: StorageProviderId;
  kind: StorageProviderKind;
  purpose: StoragePurpose;
  objectKey: string;
  bucket?: string | null;
  path?: string | null;
  externalId?: string | null;
  externalUrl?: string | null;
  metadata?: Record<string, unknown>;
  status: StorageObjectStatus;
  version: 1;
};

export type UploadObjectInput = {
  userId: string;
  purpose: StoragePurpose;
  name: string;
  mimeType: string;
  data: ArrayBuffer | Uint8Array | Blob | string | ReadableStream<Uint8Array>;
  metadata?: Record<string, unknown>;
};

export type StoredObject = {
  ref: StoredObjectRef;
  name: string;
  mimeType: string;
  sizeBytes?: number | null;
  webViewUrl?: string | null;
};

export type ReadObjectInput = {
  userId: string;
  ref: StoredObjectRef;
};

export type ReadObjectResult = {
  data: ReadableStream<Uint8Array> | Uint8Array | ArrayBuffer;
  mimeType: string;
  sizeBytes?: number | null;
};

export type DeleteObjectInput = {
  userId: string;
  ref: StoredObjectRef;
};

export const storageErrorCodes = [
  "not_configured",
  "not_connected",
  "reconnect_required",
  "missing",
  "quota_exceeded",
  "permission_denied",
  "provider_error",
] as const;

export type StorageErrorCode = (typeof storageErrorCodes)[number];

export type StorageErrorOptions = {
  code: StorageErrorCode;
  providerId: StorageProviderId;
  retryable?: boolean;
  cause?: unknown;
};

export class StorageError extends Error {
  code: StorageErrorCode;
  providerId: StorageProviderId;
  retryable: boolean;

  constructor(message: string, options: StorageErrorOptions) {
    super(message);
    this.name = "StorageError";
    this.code = options.code;
    this.providerId = options.providerId;
    this.retryable = options.retryable ?? false;

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface StorageProvider {
  id: StorageProviderId;
  kind: StorageProviderKind;
  getStatus(input: { userId: string; purpose?: StoragePurpose }): Promise<StorageStatus>;
  ensureReady(input: { userId: string; purpose: StoragePurpose }): Promise<StorageStatus>;
  uploadObject(input: UploadObjectInput): Promise<StoredObject>;
  readObject(input: ReadObjectInput): Promise<ReadObjectResult>;
  getReadUrl?(input: ReadObjectInput): Promise<string | null>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  markMissing?(input: { userId: string; ref: StoredObjectRef }): Promise<void>;
  serializeRef(ref: StoredObjectRef): Record<string, unknown>;
  deserializeRef(value: Record<string, unknown>): StoredObjectRef;
}

export interface ManagedStorageProvider extends StorageProvider {
  kind: "managed";
  ensureDeploymentReady(): Promise<StorageStatus>;
}

export interface ConnectedStorageProvider extends StorageProvider {
  kind: "connected";
  getConnectUrl(input: { userId: string; next?: string }): Promise<string>;
  disconnect(input: { userId: string }): Promise<void>;
}

export function isStoragePurpose(value: unknown): value is StoragePurpose {
  return typeof value === "string" && storagePurposes.includes(value as StoragePurpose);
}

export function isStorageProviderKind(value: unknown): value is StorageProviderKind {
  return typeof value === "string" && storageProviderKinds.includes(value as StorageProviderKind);
}

export function isStorageProviderId(value: unknown): value is StorageProviderId {
  return typeof value === "string" && storageProviderIds.includes(value as StorageProviderId);
}

export function isStorageObjectStatus(value: unknown): value is StorageObjectStatus {
  return typeof value === "string" && storageObjectStatuses.includes(value as StorageObjectStatus);
}

export function isStorageErrorCode(value: unknown): value is StorageErrorCode {
  return typeof value === "string" && storageErrorCodes.includes(value as StorageErrorCode);
}
