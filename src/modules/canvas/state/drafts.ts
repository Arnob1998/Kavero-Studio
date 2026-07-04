const DB_NAME = "kavero-canvas-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

export interface CanvasDraft {
  key: string;
  designId: string;
  pageId: string;
  canvasJson: string;
  width: number;
  height: number;
  updatedAt: number;
  cloudSyncedAt: number | null;
  dirty: boolean;
}

export interface SaveCanvasDraftInput {
  designId: string;
  pageId: string;
  canvasJson: string;
  width: number;
  height: number;
}

function draftKey(designId: string, pageId: string) {
  return `${designId}:${pageId}`;
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("designId", "designId", { unique: false });
        store.createIndex("dirty", "dirty", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open canvas drafts."));
  });
}

function runStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDraftDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const store = tx.objectStore(STORE_NAME);
        const request = operation(store);
        let result: T | undefined;

        if (request) {
          request.onsuccess = () => {
            result = request.result;
          };
          request.onerror = () => reject(request.error ?? new Error("Canvas draft operation failed."));
        }

        tx.oncomplete = () => {
          db.close();
          resolve(result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error("Canvas draft transaction failed."));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error("Canvas draft transaction aborted."));
        };
      }),
  );
}

export async function saveCanvasDraft(input: SaveCanvasDraftInput) {
  const now = Date.now();
  const draft: CanvasDraft = {
    key: draftKey(input.designId, input.pageId),
    designId: input.designId,
    pageId: input.pageId,
    canvasJson: input.canvasJson,
    width: input.width,
    height: input.height,
    updatedAt: now,
    cloudSyncedAt: null,
    dirty: true,
  };

  await runStore("readwrite", (store) => store.put(draft));
  return draft;
}

export function getCanvasDraft(designId: string, pageId: string) {
  return runStore<CanvasDraft>("readonly", (store) => store.get(draftKey(designId, pageId)));
}

export function markCanvasDraftSynced(designId: string, pageId: string, cloudSyncedAt = Date.now()) {
  return openDraftDb().then((db) => {
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(draftKey(designId, pageId));

      request.onsuccess = () => {
        const draft = request.result as CanvasDraft | undefined;
        if (draft) store.put({ ...draft, dirty: false, cloudSyncedAt });
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to read canvas draft."));

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error("Unable to mark canvas draft synced."));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? new Error("Canvas draft sync transaction aborted."));
      };
    });
  });
}

export function deleteCanvasDraftsForDesign(designId: string) {
  return runStore("readwrite", (store) => {
    const index = store.index("designId");
    const request = index.openCursor(IDBKeyRange.only(designId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    return request;
  });
}
