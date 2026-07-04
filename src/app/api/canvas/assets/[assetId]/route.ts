import { NextResponse } from "next/server";
import {
  deleteGoogleDriveFile,
  getGoogleDriveAccessTokenForUser,
  isGoogleDriveReconnectError,
  markGoogleDriveReconnectRequired,
} from "@/lib/google-drive";
import { getCanvasUser, jsonError, requireCanvasAccess, requireCanvasAdmin } from "@/lib/canvas/api";
import {
  getCanvasAssetGoogleDriveDeleteFileId,
  getCanvasAssetStorageRef,
} from "@/modules/assets/canvas-asset-storage-refs";
import { deleteStorageObjects, readStorageObject } from "@/modules/storage/dispatch/storage-object-dispatch";
import { getRuntimeManagedStorageDispatchDependencies } from "@/modules/storage/managed/runtime";
import type { ReadObjectResult } from "@/modules/storage/storage-provider";

export const runtime = "nodejs";

interface CanvasAssetRouteContext {
  params: Promise<{ assetId: string }>;
}

type CanvasAssetStorageRow = {
  id: string;
  storage_provider: string;
  public_url: string;
  content_type: string | null;
  drive_file_id: string | null;
  drive_status: "available" | "missing" | "unknown";
  storage_ref?: unknown;
};

export async function GET(_request: Request, { params }: CanvasAssetRouteContext) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { assetId } = await params;
  const { data: asset, error } = await admin
    .from("canvas_assets")
    .select(
      "id, storage_provider, public_url, content_type, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    )
    .eq("id", assetId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return jsonError("Unable to load asset.", 500);
  if (!asset) return jsonError("Not found", 404);

  await admin
    .from("canvas_assets")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", asset.id)
    .eq("user_id", user.id);

  const storageRef = getCanvasAssetStorageRef(asset);
  if (
    storageRef &&
    (storageRef.providerId === "kavero-managed" || storageRef.providerId === "supabase-storage") &&
    asset.storage_provider !== "supabase-storage"
  ) {
    const dependenciesResult = getRuntimeManagedStorageDispatchDependencies();
    if (!dependenciesResult.ok) {
      console.error("Managed canvas asset storage is not configured", dependenciesResult.error);
      return jsonError("Managed storage is not configured.", 502);
    }

    const readResult = await readStorageObject({
      userId: user.id,
      ref: storageRef,
      dependencies: dependenciesResult.dependencies,
    });
    if (readResult.ok) {
      return new Response(toResponseBody(readResult.object), {
        status: 200,
        headers: {
          "Content-Type": asset.content_type || readResult.object.mimeType || "image/png",
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    if (readResult.reason === "missing") {
      return jsonError("Asset is missing in storage.", 404);
    }

    if (readResult.reason === "provider-error") {
      return jsonError("Unable to stream stored asset.", 502);
    }

    return jsonError("Storage provider is not supported for asset streaming yet.", 501);
  }

  if (asset.storage_provider !== "google-drive") {
    return NextResponse.redirect(asset.public_url);
  }

  if (!storageRef || storageRef.status === "missing") {
    return jsonError("Asset is missing in Google Drive.", 404);
  }
  if (storageRef.providerId !== "google-drive") {
    return jsonError("Storage provider is not supported for asset streaming yet.", 501);
  }

  const driveFileId = storageRef.externalId ?? storageRef.objectKey;

  let accessToken: string | null;
  try {
    accessToken = await getGoogleDriveAccessTokenForUser(user.id);
  } catch {
    return jsonError("Google Drive needs to be reconnected.", 409);
  }

  if (!accessToken) return jsonError("Google Drive is not connected.", 409);

  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!driveResponse.ok || !driveResponse.body) {
    if (driveResponse.status === 404) {
      await admin
        .from("canvas_assets")
        .update({ drive_status: "missing" })
        .eq("id", asset.id)
        .eq("user_id", user.id);

      return jsonError("Asset is missing in Google Drive.", 404);
    }

    if (driveResponse.status === 401 || driveResponse.status === 403) {
      await markGoogleDriveReconnectRequired(user.id);
      return jsonError("Google Drive needs to be reconnected.", 409);
    }

    return jsonError("Unable to stream Drive asset.", 502);
  }

  return new Response(driveResponse.body, {
    status: 200,
    headers: {
      "Content-Type": asset.content_type || driveResponse.headers.get("Content-Type") || "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}

function toResponseBody(result: ReadObjectResult): BodyInit {
  if (result.data instanceof Uint8Array) {
    const bytes = new Uint8Array(result.data.byteLength);
    bytes.set(result.data);
    return bytes.buffer;
  }

  return result.data;
}

export async function DELETE(_request: Request, { params }: CanvasAssetRouteContext) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { assetId } = await params;
  const { data: asset, error } = await admin
    .from("canvas_assets")
    .select(
      "id, storage_provider, drive_file_id, drive_status, storage_ref, storage_kind, storage_status, storage_metadata, storage_external_id, storage_external_url",
    )
    .eq("id", assetId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return jsonError("Unable to load asset.", 500);
  if (!asset) return jsonError("Not found", 404);

  const driveFileId = getCanvasAssetGoogleDriveDeleteFileId(asset);
  if (driveFileId) {
    let accessToken: string | null;
    try {
      accessToken = await getGoogleDriveAccessTokenForUser(user.id);
    } catch {
      return jsonError("Google Drive needs to be reconnected before deleting this asset.", 409);
    }

    if (!accessToken) return jsonError("Google Drive is not connected.", 409);

    try {
      await deleteGoogleDriveFile(accessToken, driveFileId);
    } catch (deleteError) {
      if (isGoogleDriveReconnectError(deleteError)) {
        await markGoogleDriveReconnectRequired(user.id);
        return jsonError("Google Drive needs to be reconnected before deleting this asset.", 409);
      }

      return jsonError("Unable to delete asset from Google Drive.", 502);
    }
  }

  const storageRef = getCanvasAssetStorageRef(asset);
  if (storageRef?.providerId === "kavero-managed") {
    const dependenciesResult = getRuntimeManagedStorageDispatchDependencies();
    if (!dependenciesResult.ok) {
      console.error("Managed canvas asset storage delete is not configured", dependenciesResult.error);
      return jsonError("Unable to delete asset from managed storage.", 502);
    }

    const managedDelete = await deleteStorageObjects({
      userId: user.id,
      refs: [storageRef],
      dependencies: dependenciesResult.dependencies,
    });
    if (managedDelete.unsupportedRefs.length > 0) {
      console.warn("Skipping unsupported managed canvas asset storage refs during delete", managedDelete.unsupportedRefs);
    }
    if (!managedDelete.ok) {
      console.error("Unable to delete canvas asset from managed storage", managedDelete);
      return jsonError("Unable to delete asset from managed storage.", 502);
    }
  }

  const { error: deleteRowError } = await admin
    .from("canvas_assets")
    .delete()
    .eq("id", asset.id)
    .eq("user_id", user.id);

  if (deleteRowError) return jsonError("Unable to delete asset metadata.", 500);
  return NextResponse.json({ ok: true });
}
