import { NextResponse } from "next/server";
import {
  createGoogleDriveFolder,
  deleteGoogleDriveFile,
  getGoogleDriveAccessTokenForUser,
  getGoogleDriveConnection,
  googleDriveCanvasFolderName,
  isGoogleDriveReconnectError,
  markGoogleDriveReconnectRequired,
  updateGoogleDriveCanvasFolder,
  uploadGoogleDriveFile,
} from "@/lib/google-drive";
import { CANVAS_LIMITS, getCanvasUser, jsonError, requireCanvasAccess, requireCanvasAdmin } from "@/lib/canvas/api";
import {
  getCanvasAssetGoogleDriveDeleteFileId,
  getCanvasAssetStorageRef,
} from "@/modules/assets/canvas-asset-storage-refs";
import { deleteStorageObjects } from "@/modules/storage/dispatch/storage-object-dispatch";
import type { ManagedStorageBackend } from "@/modules/storage/managed/kavero-managed-storage";
import {
  getRuntimeManagedStorageDispatchDependencies,
  resolveRuntimeManagedStorageBackend,
} from "@/modules/storage/managed/runtime";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";

export const runtime = "nodejs";

const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxBulkDeleteAssets = 200;
type CanvasAssetStorageProviderSelection =
  | { providerId: "google-drive"; invalidProviderId?: string }
  | { providerId: "kavero-managed"; invalidProviderId?: undefined };

export async function GET() {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const [{ data: assets, error: assetsError }, { count: designCount }, { count: pageCount }] =
    await Promise.all([
      admin
        .from("canvas_assets")
        .select(
          "id, original_name, content_type, size_bytes, public_url, drive_file_id, drive_file_name, drive_web_view_link, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url, last_used_at, created_at",
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("canvas_designs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
      admin
        .from("canvas_pages")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]);

  if (assetsError) return jsonError("Unable to load canvas assets.", 500);

  const assetRows = assets ?? [];
  const usedBytes = assetRows.reduce((total, asset) => total + (asset.size_bytes ?? 0), 0);

  return NextResponse.json({
    assets: assetRows,
    usage: {
      designs: designCount ?? 0,
      pages: pageCount ?? 0,
      assets: assetRows.length,
      assetBytes: usedBytes,
    },
    limits: CANVAS_LIMITS,
  });
}

export async function POST(request: Request) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("Upload an image file.", 400);
  if (!allowedImageTypes.has(file.type)) return jsonError("Canvas uploads must be PNG, JPG, or WebP.", 400);
  if (file.size <= 0 || file.size > CANVAS_LIMITS.driveAssetBytesPerFile) {
    return jsonError("Canvas uploads must be 10MB or smaller.", 400);
  }

  const { count, error: countError } = await admin
    .from("canvas_assets")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) return jsonError("Unable to check asset limits.", 500);
  if ((count ?? 0) >= CANVAS_LIMITS.driveAssetsPerUser) {
    return jsonError("Canvas asset limit reached.", 403);
  }

  const selection = getCanvasAssetStorageProviderFromEnv();
  if (selection.invalidProviderId) {
    console.warn(
      `Ignoring invalid KAVERO_STORAGE_PROVIDER value "${selection.invalidProviderId}". Falling back to Google Drive canvas asset storage.`,
    );
  }

  if (selection.providerId === "kavero-managed") {
    return uploadManagedCanvasAsset({
      admin,
      userId: user.id,
      file,
    });
  }

  let accessToken: string | null;
  try {
    accessToken = await getGoogleDriveAccessTokenForUser(user.id);
  } catch {
    return jsonError("Google Drive needs to be reconnected.", 409);
  }

  if (!accessToken) return jsonError("Google Drive is not connected.", 409);

  let connection = await getGoogleDriveConnection(user.id);
  if (!connection) return jsonError("Google Drive is not connected.", 409);

  let canvasFolderId = connection.canvas_folder_id;
  if (!canvasFolderId || connection.canvas_folder_status === "missing") {
    try {
      const folder = await createGoogleDriveFolder(accessToken, googleDriveCanvasFolderName);
      if (!folder.id) return jsonError("Unable to create Canvas asset folder.", 502);
      await updateGoogleDriveCanvasFolder(user.id, folder.id);
      canvasFolderId = folder.id;
    } catch (error) {
      if (isGoogleDriveReconnectError(error)) {
        await markGoogleDriveReconnectRequired(user.id);
        return jsonError("Google Drive needs to be reconnected.", 409);
      }

      return jsonError("Unable to create Canvas asset folder.", 502);
    }
  }

  const assetId = crypto.randomUUID();
  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] ?? "png";
  const safeBase = file.name
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "canvas-asset";
  const driveName = `${safeBase}-${assetId.slice(0, 8)}.${extension}`;

  let uploaded;
  try {
    uploaded = await uploadGoogleDriveFile(accessToken, {
      name: driveName,
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
      folderId: canvasFolderId,
    });
  } catch (error) {
    if (isGoogleDriveReconnectError(error)) {
      await markGoogleDriveReconnectRequired(user.id);
      return jsonError("Google Drive needs to be reconnected.", 409);
    }

    return jsonError("Unable to upload image to Google Drive.", 502);
  }

  const publicUrl = `/api/canvas/assets/${assetId}`;
  const driveFileId = uploaded.id!;
  const driveFileName = uploaded.name ?? driveName;
  const storageRef: StoredObjectRef = {
    providerId: "google-drive",
    kind: "connected",
    purpose: "canvas-asset",
    objectKey: driveFileId,
    bucket: "google-drive",
    path: driveFileId,
    externalId: driveFileId,
    externalUrl: uploaded.webViewLink ?? null,
    metadata: {
      providerId: "google-drive",
      folderId: canvasFolderId,
      name: driveFileName,
      originalName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
    },
    status: "available",
    version: 1,
  };
  const { data: asset, error: insertError } = await admin
    .from("canvas_assets")
    .insert({
      id: assetId,
      user_id: user.id,
      storage_provider: "google-drive",
      bucket: "google-drive",
      storage_path: driveFileId,
      original_name: file.name,
      content_type: file.type,
      size_bytes: file.size,
      public_url: publicUrl,
      drive_file_id: driveFileId,
      drive_file_name: driveFileName,
      drive_web_view_link: uploaded.webViewLink ?? null,
      drive_status: "available",
      storage_kind: "connected",
      storage_status: "available",
      storage_ref: storageRef,
      storage_metadata: {
        providerId: "google-drive",
        folderId: canvasFolderId,
        driveFileName,
        originalName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      },
      storage_external_id: driveFileId,
      storage_external_url: uploaded.webViewLink ?? null,
    })
    .select(
      "id, original_name, content_type, size_bytes, public_url, drive_file_id, drive_file_name, drive_web_view_link, drive_status, last_used_at, created_at",
    )
    .single();

  if (insertError) return jsonError("Image uploaded, but asset metadata could not be saved.", 500);
  return NextResponse.json({ asset });
}

function getCanvasAssetStorageProviderFromEnv(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): CanvasAssetStorageProviderSelection {
  const rawProviderId = env.KAVERO_STORAGE_PROVIDER?.trim();
  if (!rawProviderId || rawProviderId === "google-drive") {
    return { providerId: "google-drive" };
  }

  if (rawProviderId === "kavero-managed") {
    return { providerId: "kavero-managed" };
  }

  return { providerId: "google-drive", invalidProviderId: rawProviderId };
}

async function uploadManagedCanvasAsset({
  admin,
  userId,
  file,
}: {
  admin: NonNullable<ReturnType<typeof requireCanvasAdmin>["admin"]>;
  userId: string;
  file: File;
}) {
  const backendResult = resolveRuntimeManagedStorageBackend({ admin });
  if (!backendResult.ok) {
    const detail = backendResult.reason === "not-configured" ? backendResult.error : backendResult.backendId;
    console.error("Managed canvas asset storage is not configured", detail);
    return jsonError("Unable to upload image to managed storage.", 502);
  }
  const backend = backendResult.backend;

  try {
    await backend.ensureReady({ userId, purpose: "canvas-asset" });
  } catch (error) {
    console.error("Managed canvas asset storage is not ready", error);
    return jsonError("Unable to upload image to managed storage.", 502);
  }

  const assetId = crypto.randomUUID();
  const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1] ?? "png";
  const safeBase = safeFileBase(file.name);
  const objectName = `${safeBase}-${assetId.slice(0, 8)}.${extension}`;
  const objectKey = `users/${safePathSegment(userId)}/canvas-assets/${assetId}/${objectName}`;
  const publicUrl = `/api/canvas/assets/${assetId}`;
  let uploadedRef: StoredObjectRef | null = null;

  try {
    const uploaded = await backend.uploadObject({
      userId,
      purpose: "canvas-asset",
      name: objectName,
      mimeType: file.type,
      data: Buffer.from(await file.arrayBuffer()),
      metadata: {
        objectKey,
        originalName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
      },
    });
    uploadedRef = uploaded.ref;

    const { data: asset, error: insertError } = await admin
      .from("canvas_assets")
      .insert({
        id: assetId,
        user_id: userId,
        storage_provider: "kavero-managed",
        bucket: uploaded.ref.bucket ?? "kavero-canvas-assets",
        storage_path: uploaded.ref.path ?? uploaded.ref.objectKey,
        original_name: file.name,
        content_type: file.type,
        size_bytes: file.size,
        public_url: publicUrl,
        drive_file_id: null,
        drive_file_name: null,
        drive_web_view_link: null,
        drive_status: "available",
        storage_kind: "managed",
        storage_status: "available",
        storage_ref: uploaded.ref,
        storage_metadata: {
          providerId: "kavero-managed",
          backendProviderId: backend.id,
          objectName: uploaded.name,
          originalName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        },
        storage_external_id: null,
        storage_external_url: null,
      })
      .select(
        "id, original_name, content_type, size_bytes, public_url, drive_file_id, drive_file_name, drive_web_view_link, drive_status, last_used_at, created_at",
      )
      .single();

    if (insertError) {
      await cleanupManagedCanvasAssetUpload({ userId, backend, ref: uploadedRef });
      return jsonError("Image uploaded, but asset metadata could not be saved.", 500);
    }

    return NextResponse.json({ asset });
  } catch (error) {
    if (uploadedRef) {
      await cleanupManagedCanvasAssetUpload({ userId, backend, ref: uploadedRef });
    }
    console.error("Unable to upload image to managed storage", error);
    return jsonError("Unable to upload image to managed storage.", 502);
  }
}

async function cleanupManagedCanvasAssetUpload({
  userId,
  backend,
  ref,
}: {
  userId: string;
  backend: ManagedStorageBackend;
  ref: StoredObjectRef | null;
}) {
  if (!ref) return;
  try {
    await backend.deleteObject({ userId, ref });
  } catch (error) {
    console.error("Unable to clean up managed canvas asset upload", error);
  }
}

function safePathSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "user"
  );
}

function safeFileBase(value: string) {
  return (
    value
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "canvas-asset"
  );
}

export async function DELETE(request: Request) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const payload = (await request.json().catch(() => ({}))) as {
    assetIds?: unknown;
    deleteAll?: unknown;
  };
  const deleteAll = payload.deleteAll === true;
  const assetIds = Array.isArray(payload.assetIds)
    ? Array.from(
        new Set(
          payload.assetIds.filter((id): id is string => typeof id === "string" && /^[a-zA-Z0-9_-]+$/.test(id)),
        ),
      )
    : [];

  if (!deleteAll && assetIds.length === 0) return jsonError("Select at least one asset to delete.", 400);
  if (assetIds.length > maxBulkDeleteAssets) return jsonError("Too many assets selected.", 400);

  let query = admin
    .from("canvas_assets")
    .select(
      "id, storage_provider, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    )
    .eq("user_id", user.id)
    .limit(maxBulkDeleteAssets);

  if (!deleteAll) query = query.in("id", assetIds);

  const { data: assets, error } = await query;
  if (error) return jsonError("Unable to load assets.", 500);

  const ownedAssets = assets ?? [];
  if (ownedAssets.length === 0) return NextResponse.json({ ok: true, deleted: 0 });

  const driveFileIds = Array.from(
    new Set(
      ownedAssets
        .map((asset) => getCanvasAssetGoogleDriveDeleteFileId(asset))
        .filter((fileId): fileId is string => Boolean(fileId)),
    ),
  );

  if (driveFileIds.length > 0) {
    let accessToken: string | null;
    try {
      accessToken = await getGoogleDriveAccessTokenForUser(user.id);
    } catch {
      return jsonError("Google Drive needs to be reconnected before deleting these assets.", 409);
    }

    if (!accessToken) return jsonError("Google Drive is not connected.", 409);

    try {
      for (const fileId of driveFileIds) {
        await deleteGoogleDriveFile(accessToken, fileId);
      }
    } catch (deleteError) {
      if (isGoogleDriveReconnectError(deleteError)) {
        await markGoogleDriveReconnectRequired(user.id);
        return jsonError("Google Drive needs to be reconnected before deleting these assets.", 409);
      }

      return jsonError("Unable to delete one or more assets from Google Drive.", 502);
    }
  }

  const managedRefs = ownedAssets
    .map((asset) => getCanvasAssetStorageRef(asset))
    .filter((ref): ref is StoredObjectRef => ref?.providerId === "kavero-managed");

  if (managedRefs.length > 0) {
    const dependenciesResult = getRuntimeManagedStorageDispatchDependencies();
    if (!dependenciesResult.ok) {
      console.error("Managed canvas asset storage delete is not configured", dependenciesResult.error);
      return jsonError("Unable to delete one or more assets from managed storage.", 502);
    }

    const managedDelete = await deleteStorageObjects({
      userId: user.id,
      refs: managedRefs,
      dependencies: dependenciesResult.dependencies,
    });
    if (managedDelete.unsupportedRefs.length > 0) {
      console.warn("Skipping unsupported managed canvas asset storage refs during delete", managedDelete.unsupportedRefs);
    }
    if (!managedDelete.ok) {
      console.error("Unable to delete canvas assets from managed storage", managedDelete);
      return jsonError("Unable to delete one or more assets from managed storage.", 502);
    }
  }

  const idsToDelete = ownedAssets.map((asset) => asset.id);
  const { error: deleteRowsError } = await admin
    .from("canvas_assets")
    .delete()
    .eq("user_id", user.id)
    .in("id", idsToDelete);

  if (deleteRowsError) return jsonError("Unable to delete asset metadata.", 500);
  return NextResponse.json({ ok: true, deleted: idsToDelete.length });
}
