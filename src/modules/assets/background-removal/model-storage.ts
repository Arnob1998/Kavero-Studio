import { BUILTIN_BACKGROUND_REMOVAL_MODELS, createImportedModelMetadata } from "./model-registry";
import type {
  BackgroundRemovalModel,
  BackgroundRemovalPreprocessing,
  StoredBackgroundRemovalModel,
} from "./types";

const DATABASE_NAME = "kavero-background-removal";
const DATABASE_VERSION = 1;
const MODEL_STORE = "models";

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser does not support local model storage."));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(MODEL_STORE)) database.createObjectStore(MODEL_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open local model storage."));
  });
}

async function runStoreRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(MODEL_STORE, mode);
      const request = operation(transaction.objectStore(MODEL_STORE));
      let result: T;
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error ?? new Error("Local model storage failed."));
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error("Local model storage was interrupted."));
      transaction.onerror = () => reject(transaction.error ?? new Error("Local model storage failed."));
    });
  } finally {
    database.close();
  }
}

export async function listImportedBackgroundRemovalModels() {
  return runStoreRequest<StoredBackgroundRemovalModel[]>("readonly", (store) => store.getAll());
}

export async function listBackgroundRemovalModels(): Promise<BackgroundRemovalModel[]> {
  const imported = await listImportedBackgroundRemovalModels();
  return [...BUILTIN_BACKGROUND_REMOVAL_MODELS, ...imported.map(({ modelBlob: _modelBlob, ...model }) => model)];
}

export async function importBackgroundRemovalModel({
  file,
  name,
  preprocessing,
  fallbackInputSize,
}: {
  file: File;
  name?: string;
  preprocessing: BackgroundRemovalPreprocessing;
  fallbackInputSize: number;
}) {
  const metadata = createImportedModelMetadata({ file, name, preprocessing, fallbackInputSize });
  const stored: StoredBackgroundRemovalModel = { ...metadata, source: "imported", modelBlob: file };
  await runStoreRequest<IDBValidKey>("readwrite", (store) => store.add(stored));
  return metadata;
}

export async function deleteImportedBackgroundRemovalModel(modelId: string) {
  await runStoreRequest<undefined>("readwrite", (store) => store.delete(modelId));
}

export async function getBackgroundRemovalModelBlob(modelId: string) {
  const stored = await runStoreRequest<StoredBackgroundRemovalModel | undefined>("readonly", (store) => store.get(modelId));
  if (!stored?.modelBlob) throw new Error("The imported model is no longer available in this browser.");
  return stored.modelBlob;
}
