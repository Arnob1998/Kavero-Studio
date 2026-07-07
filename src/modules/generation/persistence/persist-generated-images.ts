import { getGenerationLimit, normalizeUserPlan } from "@/lib/plans";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { parseBase64DataUrl } from "@/modules/generation/utils/data-url";
import type { ManagedStorageEnv } from "@/modules/storage/managed/config";
import type { ManagedStorageBackend } from "@/modules/storage/managed/kavero-managed-storage";
import { resolveRuntimeManagedStorageBackend } from "@/modules/storage/managed/runtime";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
import { prepareGoogleDriveGeneratedImageStorage, uploadGoogleDriveGeneratedImageWithMetadata } from "@/modules/storage/providers/google-drive/generated-image-storage";

export type PersistGeneratedImage = {
  id: string;
  variant: number;
  mimeType: string;
  dataUrl: string;
  text?: string;
};

export type PersistGeneratedReferenceImage = {
  name?: string;
  mimeType: string;
  dataUrl: string;
};

export type PersistGeneratedImagesInput = {
  userId: string;
  prompt: string;
  model: string;
  modelLabel: string;
  images: PersistGeneratedImage[];
  text: string;
  settings: Record<string, unknown>;
  referenceImages: PersistGeneratedReferenceImage[];
};

export type GeneratedImageStorageProviderId = "google-drive" | "kavero-managed";

export type GeneratedImageStorageProviderSelection =
  | { providerId: GeneratedImageStorageProviderId; invalidProviderId?: undefined }
  | { providerId: "google-drive"; invalidProviderId: string };

export type PersistGeneratedImagesResult = {
  saved: number;
  warning: string | null;
  storageLabel: string;
};

export type GeneratedImageStorageEnv = ManagedStorageEnv & {
  KAVERO_STORAGE_PROVIDER?: string | undefined;
} & Record<string, string | undefined>;

export type PersistGeneratedImagesDependencies = {
  env?: GeneratedImageStorageEnv;
  managedBackend?: ManagedStorageBackend;
};

const MANAGED_STORAGE_SAVE_WARNING =
  "Generated images are ready, but Kavero could not save them to managed storage.";

function safeFileSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56) || "image";
}

function safePathSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "user"
  );
}

function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "png";
}

export function getGeneratedImageStorageProviderFromEnv(
  env: GeneratedImageStorageEnv = process.env as GeneratedImageStorageEnv,
): GeneratedImageStorageProviderSelection {
  const rawProviderId = env?.KAVERO_STORAGE_PROVIDER?.trim();
  if (!rawProviderId || rawProviderId === "google-drive") {
    return { providerId: "google-drive" };
  }

  if (rawProviderId === "kavero-managed") {
    return { providerId: "kavero-managed" };
  }

  return { providerId: "google-drive", invalidProviderId: rawProviderId };
}

export async function persistGeneratedImages(
  input: PersistGeneratedImagesInput,
  dependencies: PersistGeneratedImagesDependencies = {},
): Promise<PersistGeneratedImagesResult> {
  const selection = getGeneratedImageStorageProviderFromEnv(dependencies.env);
  if (selection.invalidProviderId) {
    console.warn(
      `Ignoring invalid KAVERO_STORAGE_PROVIDER value "${selection.invalidProviderId}". Falling back to Google Drive generated image storage.`,
    );
  }

  if (selection.providerId === "kavero-managed") {
    return persistGeneratedImagesToManagedStorage(input, dependencies);
  }

  return persistGeneratedImagesToDrive(input);
}

export async function persistGeneratedImagesToDrive({
  userId,
  prompt,
  model,
  modelLabel,
  images,
  text,
  settings,
  referenceImages,
}: PersistGeneratedImagesInput): Promise<PersistGeneratedImagesResult> {
  const quotaResult = await checkGenerationQuota(userId);
  if (!quotaResult.ok) {
    return {
      saved: 0,
      warning: quotaResult.warning,
      storageLabel: "Google Drive",
    };
  }

  const storage = await prepareGoogleDriveGeneratedImageStorage(userId);
  if (!storage.ready) {
    return {
      saved: 0,
      warning: storage.warning,
      storageLabel: "Google Drive",
    };
  }
  const readyStorage = storage;

  const admin = createAdminClient();
  const context = createPersistenceContext({ prompt, referenceImages });

  const { error: runError } = await admin.from("generation_runs").insert({
    id: context.generationId,
    user_id: userId,
    prompt,
    model_id: model,
    model_label: modelLabel,
    settings,
    generated_text: text || null,
    reference_images: context.referenceMetadata,
    storage_provider: "google-drive",
    created_at: context.createdAt,
  });

  if (runError) {
    console.error("Unable to save generation run metadata", runError);
    return {
      saved: 0,
      warning: "Generated images are ready, but Kavero could not save the generation metadata.",
      storageLabel: "Google Drive",
    };
  }

  async function saveImage(image: (typeof images)[number]) {
    try {
      const fileBase = getFileBase(context, image.variant);
      const upload = await uploadGoogleDriveGeneratedImageWithMetadata({
        storage: readyStorage,
        fileBase,
        dataUrl: image.dataUrl,
        metadata: {
          prompt,
          model,
          modelLabel,
          settings,
          variant: image.variant,
          generatedText: image.text || text,
          referenceImages: context.referenceMetadata,
          createdAt: context.createdAt,
        },
      });
      if (!upload) return false;

      const { error } = await admin.from("generated_images").insert({
        user_id: userId,
        generation_id: context.generationId,
        variant: image.variant,
        mime_type: upload.mimeType,
        drive_file_id: upload.driveFileId,
        drive_file_name: upload.driveFileName,
        drive_web_view_link: upload.driveWebViewLink,
        drive_metadata_file_id: upload.driveMetadataFileId,
        drive_status: "available",
        storage_provider: "google-drive",
        storage_kind: "connected",
        storage_status: "available",
        storage_ref: upload.imageObject.ref,
        metadata_storage_ref: upload.metadataObject.ref,
        storage_metadata: {
          providerId: "google-drive",
          imageObjectName: upload.imageObject.name,
          metadataObjectName: upload.metadataObject.name,
        },
        storage_external_id: upload.driveFileId,
        storage_external_url: upload.driveWebViewLink,
        created_at: context.createdAt,
      });

      if (error) {
        console.error("Unable to save generated image metadata", error);
        return false;
      }

      return true;
    } catch (saveError) {
      console.error("Unable to save generated image to Google Drive", saveError);
      return false;
    }
  }

  return finishImageSaves({
    admin,
    userId,
    generationId: context.generationId,
    images,
    storageLabel: "Google Drive",
    zeroSavedWarning: "Generated images could not be saved to Google Drive.",
    partialWarning: (saved) =>
      `Saved ${saved}/${images.length} images to Google Drive. Download any unsaved images you want to keep.`,
    saveImage,
  });
}

async function persistGeneratedImagesToManagedStorage(
  {
    userId,
    prompt,
    model,
    modelLabel,
    images,
    text,
    settings,
    referenceImages,
  }: PersistGeneratedImagesInput,
  dependencies: PersistGeneratedImagesDependencies,
): Promise<PersistGeneratedImagesResult> {
  const quotaResult = await checkGenerationQuota(userId);
  if (!quotaResult.ok) {
    return {
      saved: 0,
      warning: quotaResult.warning,
      storageLabel: "Kavero storage",
    };
  }

  const admin = createAdminClient();
  const backend = resolveManagedGeneratedImageBackend({ admin, dependencies });
  if (!backend) {
    return {
      saved: 0,
      warning: MANAGED_STORAGE_SAVE_WARNING,
      storageLabel: "Kavero storage",
    };
  }

  try {
    await backend.ensureReady({ userId, purpose: "generated-image" });
    await backend.ensureReady({ userId, purpose: "generated-metadata" });
  } catch (error) {
    console.error("Managed generated image storage is not ready", error);
    return {
      saved: 0,
      warning: MANAGED_STORAGE_SAVE_WARNING,
      storageLabel: "Kavero storage",
    };
  }
  const readyBackend = backend;

  const context = createPersistenceContext({ prompt, referenceImages });
  const { error: runError } = await admin.from("generation_runs").insert({
    id: context.generationId,
    user_id: userId,
    prompt,
    model_id: model,
    model_label: modelLabel,
    settings,
    generated_text: text || null,
    reference_images: context.referenceMetadata,
    storage_provider: "kavero-managed",
    created_at: context.createdAt,
  });

  if (runError) {
    console.error("Unable to save generation run metadata", runError);
    return {
      saved: 0,
      warning: "Generated images are ready, but Kavero could not save the generation metadata.",
      storageLabel: "Kavero storage",
    };
  }

  async function saveImage(image: (typeof images)[number]) {
    const uploadedRefs: StoredObjectRef[] = [];

    try {
      const fileBase = getFileBase(context, image.variant);
      const parsed = parseBase64DataUrl(image.dataUrl);
      if (!parsed) return false;

      const imageName = `${fileBase}.${extensionForMimeType(parsed.mimeType)}`;
      const metadataName = `${fileBase}.json`;
      const imageObjectBasePath = `users/${safePathSegment(userId)}/generated-images/${context.generationId}/${safePathSegment(image.id)}`;
      const metadataObjectBasePath = `users/${safePathSegment(userId)}/generated-metadata/${context.generationId}/${safePathSegment(image.id)}`;
      const imageObject = await readyBackend.uploadObject({
        userId,
        purpose: "generated-image",
        name: imageName,
        mimeType: parsed.mimeType,
        data: Buffer.from(parsed.data, "base64"),
        metadata: {
          objectKey: `${imageObjectBasePath}/${imageName}`,
          prompt,
          model,
          modelLabel,
          variant: image.variant,
          generatedText: image.text || text,
        },
      });
      uploadedRefs.push(imageObject.ref);

      const metadataObject = await readyBackend.uploadObject({
        userId,
        purpose: "generated-metadata",
        name: metadataName,
        mimeType: "application/json",
        data: JSON.stringify(
          {
            prompt,
            model,
            modelLabel,
            settings,
            variant: image.variant,
            mimeType: parsed.mimeType,
            generatedText: image.text || text,
            referenceImages: context.referenceMetadata,
            imageObjectKey: imageObject.ref.objectKey,
            createdAt: context.createdAt,
          },
          null,
          2,
        ),
        metadata: {
          objectKey: `${metadataObjectBasePath}/${metadataName}`,
          imageObjectKey: imageObject.ref.objectKey,
        },
      });
      uploadedRefs.push(metadataObject.ref);

      const { error } = await admin.from("generated_images").insert({
        user_id: userId,
        generation_id: context.generationId,
        variant: image.variant,
        mime_type: parsed.mimeType,
        drive_file_id: null,
        drive_file_name: null,
        drive_web_view_link: null,
        drive_metadata_file_id: null,
        drive_status: "available",
        storage_provider: "kavero-managed",
        storage_kind: "managed",
        storage_status: "available",
        storage_ref: imageObject.ref,
        metadata_storage_ref: metadataObject.ref,
        storage_metadata: {
          providerId: "kavero-managed",
          backendProviderId: readyBackend.id,
          imageObjectName: imageObject.name,
          metadataObjectName: metadataObject.name,
        },
        storage_external_id: null,
        storage_external_url: null,
        created_at: context.createdAt,
      });

      if (error) {
        console.error("Unable to save managed generated image metadata", error);
        await cleanupUploadedManagedGeneratedImageRefs({
          userId,
          backend: readyBackend,
          refs: uploadedRefs,
        });
        return false;
      }

      return true;
    } catch (saveError) {
      console.error("Unable to save generated image to managed storage", saveError);
      await cleanupUploadedManagedGeneratedImageRefs({
        userId,
        backend: readyBackend,
        refs: uploadedRefs,
      });
      return false;
    }
  }

  return finishImageSaves({
    admin,
    userId,
    generationId: context.generationId,
    images,
    storageLabel: "Kavero storage",
    zeroSavedWarning: "Generated images could not be saved to managed storage.",
    partialWarning: (saved) =>
      `Saved ${saved}/${images.length} images to Kavero storage. Download any unsaved images you want to keep.`,
    saveImage,
  });
}

function resolveManagedGeneratedImageBackend({
  admin,
  dependencies,
}: {
  admin: unknown;
  dependencies: PersistGeneratedImagesDependencies;
}) {
  const resolved = resolveRuntimeManagedStorageBackend({
    admin,
    env: (dependencies.env ?? process.env) as ManagedStorageEnv,
    managedBackend: dependencies.managedBackend,
  });

  if (!resolved.ok) {
    if (resolved.reason === "invalid-backend") {
      console.error("Invalid managed generated image storage backend", resolved.backendId);
      return null;
    }

    if (resolved.reason === "backend-not-registered") {
      console.error("Managed generated image storage backend is not registered", resolved.backendId);
      return null;
    }

    console.error("Managed generated image storage backend is not configured", resolved.error);
    return null;
  }

  return resolved.backend;
}

async function cleanupUploadedManagedGeneratedImageRefs({
  userId,
  backend,
  refs,
}: {
  userId: string;
  backend: ManagedStorageBackend;
  refs: StoredObjectRef[];
}) {
  const refsToDelete = dedupeStoredObjectRefs(refs);
  if (refsToDelete.length === 0) return;

  await Promise.allSettled(
    refsToDelete.map(async (ref) => {
      try {
        await backend.deleteObject({ userId, ref });
      } catch (error) {
        console.error("Unable to clean up managed generated image upload", error);
      }
    }),
  );
}

function dedupeStoredObjectRefs(refs: StoredObjectRef[]) {
  const seen = new Set<string>();
  const uniqueRefs: StoredObjectRef[] = [];

  for (const ref of refs) {
    const key = `${ref.providerId}:${ref.bucket ?? ""}:${ref.path ?? ref.objectKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueRefs.push(ref);
  }

  return uniqueRefs;
}

async function checkGenerationQuota(userId: string): Promise<
  | { ok: true }
  | {
      ok: false;
      warning: string;
    }
> {
  const supabase = await createClient();
  const { data: metadata } = await supabase
    .from("user_metadata")
    .select("plan")
    .eq("user_id", userId)
    .maybeSingle();
  const plan = normalizeUserPlan(metadata?.plan);
  const generationLimit = getGenerationLimit(plan);

  if (generationLimit === null) {
    return { ok: true };
  }

  const { count, error: countError } = await supabase
    .from("generation_runs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countError) {
    console.error("Unable to check generated image quota", countError);
    return {
      ok: false,
      warning: "Generated images are ready, but Kavero could not check your gallery generation limit.",
    };
  }

  const used = count ?? 0;
  if (used >= generationLimit) {
    return {
      ok: false,
      warning: `Free plan gallery storage is full (${used}/${generationLimit} generations). Remove a generation from Gallery or upgrade before saving more.`,
    };
  }

  return { ok: true };
}

function createPersistenceContext({
  prompt,
  referenceImages,
}: Pick<PersistGeneratedImagesInput, "prompt" | "referenceImages">) {
  const createdAt = new Date().toISOString();
  return {
    createdAt,
    generationId: crypto.randomUUID(),
    promptSlug: safeFileSegment(prompt),
    referenceMetadata: referenceImages.map((image) => ({
      name: image.name ?? "Reference image",
      mimeType: image.mimeType,
    })),
  };
}

function getFileBase(
  context: ReturnType<typeof createPersistenceContext>,
  variant: number,
) {
  return `${context.createdAt.replace(/[:.]/g, "-")}-${context.promptSlug}-v${variant}`;
}

async function finishImageSaves(input: {
  admin: ReturnType<typeof createAdminClient>;
  userId: string;
  generationId: string;
  images: PersistGeneratedImage[];
  storageLabel: string;
  zeroSavedWarning: string;
  partialWarning: (saved: number) => string;
  saveImage: (image: PersistGeneratedImage) => Promise<boolean>;
}): Promise<PersistGeneratedImagesResult> {
  const saveResults = await Promise.allSettled(input.images.map((image) => input.saveImage(image)));
  const saved = saveResults.filter((result) => result.status === "fulfilled" && result.value).length;

  if (saved === 0) {
    await input.admin
      .from("generation_runs")
      .delete()
      .eq("id", input.generationId)
      .eq("user_id", input.userId);
  }

  return {
    saved,
    storageLabel: input.storageLabel,
    warning:
      saved === 0
        ? input.zeroSavedWarning
        : saved < input.images.length
          ? input.partialWarning(saved)
          : null,
  };
}
