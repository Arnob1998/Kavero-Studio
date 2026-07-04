import { NextResponse } from "next/server";
import {
  createGoogleDriveFolder,
  deleteGoogleDriveFile,
  getGoogleDriveAccessTokenForUser,
  getGoogleDriveConnection,
  googleDriveCanvasFolderName,
  isGoogleDriveMissingError,
  isGoogleDriveReconnectError,
  markGoogleDriveReconnectRequired,
  markGoogleDriveCanvasFolderMissing,
  updateGoogleDriveCanvasFolder,
  uploadGoogleDriveFile,
} from "@/lib/google-drive";
import { CANVAS_LIMITS, getCanvasUser, jsonError, requireCanvasAccess, requireCanvasAdmin } from "@/lib/canvas/api";

export const runtime = "nodejs";

const ALLOWED_TYPES = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/webp", "webp"],
]);

const MAX_MULTIPART_OVERHEAD_BYTES = 512 * 1024;

function safeName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "upload";
}

async function getCanvasDriveFolderId(userId: string, accessToken: string) {
  const connection = await getGoogleDriveConnection(userId);
  if (!connection) return null;
  if (connection.canvas_folder_id && connection.canvas_folder_status !== "missing") {
    return connection.canvas_folder_id;
  }

  const folder = await createGoogleDriveFolder(accessToken, googleDriveCanvasFolderName);
  if (!folder.id) return null;
  await updateGoogleDriveCanvasFolder(userId, folder.id);
  return folder.id;
}

export async function POST(request: Request) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const contentLength = Number(request.headers.get("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > CANVAS_LIMITS.driveAssetBytesPerFile + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    return jsonError("Upload is larger than 10 MB.", 413);
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("No file provided.", 400);

  if (!ALLOWED_TYPES.has(file.type)) return jsonError("Unsupported file type.", 400);
  if (file.size > CANVAS_LIMITS.driveAssetBytesPerFile) {
    return jsonError("Upload is larger than 10 MB.", 413);
  }

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { data: existingAssets, error: usageError } = await admin
    .from("canvas_assets")
    .select("id")
    .eq("user_id", user.id);

  if (usageError) return jsonError("Unable to check upload quota.", 500);

  const assetId = crypto.randomUUID();
  const stableUrl = `/api/canvas/assets/${assetId}`;
  const originalName = safeName(file.name);

  const { data: driveConnection } = await admin
    .from("user_drive_connections")
    .select("status")
    .eq("user_id", user.id)
    .eq("provider", "google-drive")
    .maybeSingle();

  if (driveConnection?.status === "reconnect_required") {
    return jsonError("Google Drive needs to be reconnected.", 409);
  }
  if (!driveConnection) {
    return jsonError("Connect Google Drive before uploading canvas assets.", 403);
  }

  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleDriveAccessTokenForUser(user.id);
  } catch {
    return jsonError("Google Drive needs to be reconnected.", 409);
  }

  if (!accessToken) {
    return jsonError("Connect Google Drive before uploading canvas assets.", 403);
  }

  if ((existingAssets?.length ?? 0) >= CANVAS_LIMITS.driveAssetsPerUser) {
    return jsonError(`Upload limit reached (${CANVAS_LIMITS.driveAssetsPerUser}).`, 409);
  }
  let folderId: string | null;
  try {
    folderId = await getCanvasDriveFolderId(user.id, accessToken);
  } catch (error) {
    if (isGoogleDriveReconnectError(error)) {
      await markGoogleDriveReconnectRequired(user.id);
      return jsonError("Google Drive needs to be reconnected.", 409);
    }

    return jsonError("Unable to prepare Google Drive canvas folder.", 502);
  }
  if (!folderId) return jsonError("Google Drive is not connected.", 409);

  const buffer = await file.arrayBuffer();
  let driveFile: Awaited<ReturnType<typeof uploadGoogleDriveFile>>;
  try {
    driveFile = await uploadGoogleDriveFile(accessToken, {
      folderId,
      name: `${assetId}-${originalName}`,
      mimeType: file.type,
      data: Buffer.from(buffer),
    });
  } catch (error) {
    if (isGoogleDriveReconnectError(error)) {
      await markGoogleDriveReconnectRequired(user.id);
      return jsonError("Google Drive needs to be reconnected.", 409);
    }

    if (!isGoogleDriveMissingError(error)) {
      return jsonError("Unable to upload file to Google Drive.", 502);
    }

    await markGoogleDriveCanvasFolderMissing(user.id);
    try {
      const replacementFolder = await createGoogleDriveFolder(accessToken, googleDriveCanvasFolderName);
      if (!replacementFolder.id) return jsonError("Unable to recreate Google Drive canvas folder.", 502);
      folderId = replacementFolder.id;
      await updateGoogleDriveCanvasFolder(user.id, folderId);
      driveFile = await uploadGoogleDriveFile(accessToken, {
        folderId,
        name: `${assetId}-${originalName}`,
        mimeType: file.type,
        data: Buffer.from(buffer),
      });
    } catch (retryError) {
      if (isGoogleDriveReconnectError(retryError)) {
        await markGoogleDriveReconnectRequired(user.id);
        return jsonError("Google Drive needs to be reconnected.", 409);
      }

      return jsonError("Unable to recreate Google Drive canvas folder.", 502);
    }
  }

  if (!driveFile.id) return jsonError("Google Drive did not return a file id.", 502);

  const { error: insertError } = await admin.from("canvas_assets").insert({
    id: assetId,
    user_id: user.id,
    storage_provider: "google-drive",
    bucket: "google-drive",
    storage_path: driveFile.id,
    original_name: originalName,
    content_type: file.type,
    size_bytes: file.size,
    public_url: stableUrl,
    drive_file_id: driveFile.id,
    drive_file_name: driveFile.name ?? `${assetId}-${originalName}`,
    drive_web_view_link: driveFile.webViewLink ?? null,
    drive_status: "available",
    last_used_at: new Date().toISOString(),
  });

  if (insertError) {
    await deleteGoogleDriveFile(accessToken, driveFile.id).catch(() => undefined);
    return jsonError("Unable to save upload metadata.", 500);
  }

  return NextResponse.json({
    id: assetId,
    url: stableUrl,
    provider: "google-drive",
    size_bytes: file.size,
    content_type: file.type,
  });
}
