import type { SequencePlannerReferenceInput } from "./planner-schema";
import type { SequencePlanRevision } from "./contracts";
import { SEQUENCE_PRODUCT_LIMITS } from "./limits";
import { sequencePlannerReferenceSchema } from "./planner-schema";

const DB_NAME = "kavero-sequence-sources";
const STORE_NAME = "runs";
const RECENT_KEY = "kavero-recent-sequence-id";

function hasExactDataUrl(reference: SequencePlannerReferenceInput) {
  const prefix = `data:${reference.mimeType};base64,`;
  if (!reference.dataUrl.startsWith(prefix)) return false;
  const base64 = reference.dataUrl.slice(prefix.length);
  if (base64.length === 0 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return false;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return base64.length / 4 * 3 - padding === reference.byteSize;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("Browser storage is unavailable for Sequence references."));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "sequenceId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open Sequence reference storage."));
  });
}

function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error ?? new Error("Sequence reference storage failed."));
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error("Sequence reference storage failed.")); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error("Sequence reference storage was interrupted.")); };
  }));
}

export async function saveSequenceLocalSources(sequenceId: string, references: readonly SequencePlannerReferenceInput[]) {
  if (references.length > SEQUENCE_PRODUCT_LIMITS.maximumUploads
    || references.reduce((total, reference) => total + reference.byteSize, 0) > SEQUENCE_PRODUCT_LIMITS.maximumTotalUploadBytes
    || references.some((reference) => !sequencePlannerReferenceSchema.safeParse(reference).success || !hasExactDataUrl(reference))) {
    throw new Error("Sequence references exceed the approved storage limits.");
  }
  if (references.length > 0) await transact("readwrite", (store) => store.put({ sequenceId, references }));
  localStorage.setItem(RECENT_KEY, sequenceId);
}

export async function loadSequenceLocalSources(sequenceId: string, plan: SequencePlanRevision) {
  if (plan.references.length === 0) return [];
  const saved = await transact<{ sequenceId: string; references: unknown } | undefined>("readonly", (store) => store.get(sequenceId));
  const parsed = sequencePlannerReferenceSchema.array().safeParse(saved?.references);
  if (!parsed.success || parsed.data.length !== plan.references.length) return null;
  const byId = new Map(parsed.data.map((reference) => [reference.id, reference]));
  if (byId.size !== parsed.data.length) return null;
  const ordered = plan.references.map((reference) => byId.get(reference.id));
  if (ordered.some((reference, index) => !reference || !hasExactDataUrl(reference)
    || reference.mimeType !== plan.references[index].source.mimeType
    || reference.byteSize !== plan.references[index].source.byteSize)) return null;
  return ordered as SequencePlannerReferenceInput[];
}

export function getRecentSequenceId() {
  try { return localStorage.getItem(RECENT_KEY); } catch { return null; }
}

export function clearRecentSequenceId(sequenceId: string) {
  try { if (localStorage.getItem(RECENT_KEY) === sequenceId) localStorage.removeItem(RECENT_KEY); } catch { /* Browser storage may be unavailable. */ }
}
