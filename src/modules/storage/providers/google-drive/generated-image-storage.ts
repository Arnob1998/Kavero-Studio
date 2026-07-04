import {
  createGoogleDriveFolder,
  deleteGoogleDriveFile,
  extensionForMimeType,
  getGoogleDriveAccessTokenForUser,
  getGoogleDriveConnection,
  isGoogleDriveMissingError,
  markGoogleDriveFolderMissing,
  parseImageDataUrl,
  updateGoogleDriveFolder,
  uploadGoogleDriveFile,
} from "@/lib/google-drive";
import type { StoredObject, StoredObjectRef } from "@/modules/storage/storage-provider";

export const GOOGLE_DRIVE_GENERATED_HISTORY_NOT_CONNECTED_WARNING =
  "Connect Google Drive in Settings or Gallery to save generated history.";

export const GOOGLE_DRIVE_GENERATED_HISTORY_TOKEN_WARNING =
  "Google Drive is connected, but Kavero could not refresh Drive access.";

export type GoogleDriveGeneratedImageStorageReady = {
  ready: true;
  providerId: "google-drive";
  kind: "connected";
  userId: string;
  accessToken: string;
  folderId: string;
};

export type GoogleDriveGeneratedImageStorageUnavailable = {
  ready: false;
  providerId: "google-drive";
  kind: "connected";
  warning: string;
};

export type GoogleDriveGeneratedImageStorageStatus =
  | GoogleDriveGeneratedImageStorageReady
  | GoogleDriveGeneratedImageStorageUnavailable;

export type UploadGoogleDriveGeneratedImageInput = {
  storage: GoogleDriveGeneratedImageStorageReady;
  fileBase: string;
  dataUrl: string;
  metadata: {
    prompt: string;
    model: string;
    modelLabel: string;
    settings: Record<string, unknown>;
    variant: number;
    generatedText: string;
    referenceImages: Array<{ name: string; mimeType: string }>;
    createdAt: string;
  };
};

export type UploadedGoogleDriveGeneratedImage = {
  mimeType: string;
  driveFileId: string;
  driveFileName: string;
  driveWebViewLink: string | null;
  driveMetadataFileId: string | null;
  imageObject: StoredObject;
  metadataObject: StoredObject;
};

export type DeleteGoogleDriveGeneratedImageFilesResult =
  | { success: true; deleted: boolean }
  | { success: false; reason: "missing-token" }
  | { success: false; reason: "delete-failed"; failures: PromiseRejectedResult[] };

export async function prepareGoogleDriveGeneratedImageStorage(
  userId: string,
): Promise<GoogleDriveGeneratedImageStorageStatus> {
  const connection = await getGoogleDriveConnection(userId);
  if (!connection) {
    return {
      ready: false,
      providerId: "google-drive",
      kind: "connected",
      warning: GOOGLE_DRIVE_GENERATED_HISTORY_NOT_CONNECTED_WARNING,
    };
  }

  const accessToken = await getGoogleDriveAccessTokenForUser(userId);
  if (!accessToken) {
    return {
      ready: false,
      providerId: "google-drive",
      kind: "connected",
      warning: GOOGLE_DRIVE_GENERATED_HISTORY_TOKEN_WARNING,
    };
  }

  return {
    ready: true,
    providerId: "google-drive",
    kind: "connected",
    userId,
    accessToken,
    folderId: connection.folder_id,
  };
}

export async function uploadGoogleDriveGeneratedImageWithMetadata({
  storage,
  fileBase,
  dataUrl,
  metadata,
}: UploadGoogleDriveGeneratedImageInput): Promise<UploadedGoogleDriveGeneratedImage | null> {
  const parsed = parseImageDataUrl(dataUrl);
  if (!parsed) return null;

  const extension = extensionForMimeType(parsed.mimeType);
  const imageFileName = `${fileBase}.${extension}`;
  const imageFile = await uploadToGeneratedImagesFolder(storage, {
    name: imageFileName,
    mimeType: parsed.mimeType,
    data: parsed.buffer,
  });
  const resolvedImageFileName = imageFile.name ?? imageFileName;

  const metadataFile = await uploadToGeneratedImagesFolder(storage, {
    name: `${fileBase}.json`,
    mimeType: "application/json",
    data: JSON.stringify(
      {
        prompt: metadata.prompt,
        model: metadata.model,
        modelLabel: metadata.modelLabel,
        settings: metadata.settings,
        variant: metadata.variant,
        mimeType: parsed.mimeType,
        generatedText: metadata.generatedText,
        referenceImages: metadata.referenceImages,
        imageDriveFileId: imageFile.id,
        createdAt: metadata.createdAt,
      },
      null,
      2,
    ),
  });

  const imageRef = createGoogleDriveStoredObjectRef({
    purpose: "generated-image",
    objectKey: imageFile.id!,
    externalUrl: imageFile.webViewLink ?? null,
    folderId: storage.folderId,
    name: resolvedImageFileName,
  });
  const metadataRef = createGoogleDriveStoredObjectRef({
    purpose: "generated-metadata",
    objectKey: metadataFile.id!,
    externalUrl: metadataFile.webViewLink ?? null,
    folderId: storage.folderId,
    name: metadataFile.name ?? `${fileBase}.json`,
  });

  return {
    mimeType: parsed.mimeType,
    driveFileId: imageFile.id!,
    driveFileName: resolvedImageFileName,
    driveWebViewLink: imageFile.webViewLink ?? null,
    driveMetadataFileId: metadataFile.id ?? null,
    imageObject: {
      ref: imageRef,
      name: resolvedImageFileName,
      mimeType: parsed.mimeType,
      webViewUrl: imageFile.webViewLink ?? null,
    },
    metadataObject: {
      ref: metadataRef,
      name: metadataFile.name ?? `${fileBase}.json`,
      mimeType: "application/json",
      webViewUrl: metadataFile.webViewLink ?? null,
    },
  };
}

export async function deleteGoogleDriveGeneratedImageFiles(input: {
  userId: string;
  fileIds: string[];
}): Promise<DeleteGoogleDriveGeneratedImageFilesResult> {
  const accessToken = await getGoogleDriveAccessTokenForUser(input.userId);
  if (!accessToken) {
    return { success: false, reason: "missing-token" };
  }

  const deleteResults = await Promise.allSettled(
    input.fileIds.map((fileId) => deleteGoogleDriveFile(accessToken, fileId)),
  );
  const failures = deleteResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );

  if (failures.length > 0) {
    return { success: false, reason: "delete-failed", failures };
  }

  return { success: true, deleted: true };
}

async function uploadToGeneratedImagesFolder(
  storage: GoogleDriveGeneratedImageStorageReady,
  input: {
    name: string;
    mimeType: string;
    data: Buffer | string;
  },
) {
  try {
    return await uploadGoogleDriveFile(storage.accessToken, { ...input, folderId: storage.folderId });
  } catch (error) {
    if (!isGoogleDriveMissingError(error)) {
      throw error;
    }

    await markGoogleDriveFolderMissing(storage.userId);
    const replacementFolder = await createGoogleDriveFolder(storage.accessToken);
    storage.folderId = replacementFolder.id!;
    await updateGoogleDriveFolder(storage.userId, storage.folderId);

    return uploadGoogleDriveFile(storage.accessToken, { ...input, folderId: storage.folderId });
  }
}

function createGoogleDriveStoredObjectRef(input: {
  purpose: "generated-image" | "generated-metadata";
  objectKey: string;
  externalUrl: string | null;
  folderId: string;
  name: string;
}): StoredObjectRef {
  return {
    providerId: "google-drive",
    kind: "connected",
    purpose: input.purpose,
    objectKey: input.objectKey,
    bucket: null,
    path: null,
    externalId: input.objectKey,
    externalUrl: input.externalUrl,
    metadata: {
      folderId: input.folderId,
      name: input.name,
    },
    status: "available",
    version: 1,
  };
}
