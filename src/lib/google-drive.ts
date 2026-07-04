import { createAdminClient } from "@/lib/supabase/admin";

export const googleDriveScope = "https://www.googleapis.com/auth/drive.file";
export const googleDriveFolderName = "Kavero Generated Images";
export const googleDriveCanvasFolderName = "Kavero Canvas Assets";

type TokenResponse = {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
};

type DriveFileResponse = {
  id?: string;
  name?: string;
  mimeType?: string;
  webViewLink?: string;
  webContentLink?: string;
};

type GoogleErrorResponse = {
  error?: string | { message?: string; code?: number; status?: string };
  error_description?: string;
};

export class GoogleDriveApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "GoogleDriveApiError";
    this.status = status;
    this.code = code;
  }
}

export type GoogleDriveConnection = {
  id: string;
  user_id: string;
  google_email: string | null;
  folder_id: string;
  folder_name: string;
  scope: string;
  status: "active" | "revoked" | "reconnect_required";
  folder_status: "available" | "missing" | "unknown";
  canvas_folder_id: string | null;
  canvas_folder_name: string | null;
  canvas_folder_status: "available" | "missing" | "unknown";
  connected_at: string;
  updated_at: string;
};

export type DriveUploadInput = {
  name: string;
  mimeType: string;
  data: Buffer | string;
  folderId: string;
};

function getGoogleErrorMessage(payload: GoogleErrorResponse, fallback: string) {
  if (typeof payload.error === "string") {
    return payload.error_description || payload.error || fallback;
  }

  return payload.error?.message || payload.error_description || fallback;
}

function getGoogleErrorCode(payload: GoogleErrorResponse) {
  return typeof payload.error === "string" ? payload.error : payload.error?.status;
}

export function isGoogleDriveReconnectError(error: unknown) {
  return (
    error instanceof GoogleDriveApiError &&
    (error.status === 401 ||
      error.status === 403 ||
      error.code === "invalid_grant" ||
      error.code === "UNAUTHENTICATED" ||
      error.code === "PERMISSION_DENIED")
  );
}

export function isGoogleDriveMissingError(error: unknown) {
  return error instanceof GoogleDriveApiError && error.status === 404;
}

function getGoogleClientConfig() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google Drive OAuth credentials are not configured.");
  }

  return { clientId, clientSecret };
}

function getGoogleDriveRedirectUri(requestUrl: string) {
  const callbackPath = "/api/google-drive/callback";

  if (process.env.NODE_ENV === "development") {
    return new URL(callbackPath, requestUrl).toString();
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    throw new Error("NEXT_PUBLIC_SITE_URL is required for Google Drive OAuth in production.");
  }

  return new URL(callbackPath, siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`).toString();
}

export function getGoogleDriveAuthorizationUrl(state: string, requestUrl: string) {
  const { clientId } = getGoogleClientConfig();
  const redirectUri = getGoogleDriveRedirectUri(requestUrl);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: googleDriveScope,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleDriveCode(code: string, requestUrl: string) {
  const { clientId, clientSecret } = getGoogleClientConfig();
  const redirectUri = getGoogleDriveRedirectUri(requestUrl);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new GoogleDriveApiError(
      payload.error_description || payload.error || "Unable to connect Google Drive.",
      response.status,
      payload.error,
    );
  }

  return payload;
}

export async function refreshGoogleDriveAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getGoogleClientConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  const payload = (await response.json()) as TokenResponse;
  if (!response.ok || !payload.access_token) {
    throw new GoogleDriveApiError(
      payload.error_description || payload.error || "Unable to refresh Google Drive access.",
      response.status,
      payload.error,
    );
  }

  return payload.access_token;
}

export async function getGoogleUserEmail(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as { email?: string };
  return payload.email ?? null;
}

export async function createGoogleDriveFolder(accessToken: string, name = googleDriveFolderName) {
  const response = await fetch("https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
    }),
  });

  const payload = (await response.json()) as DriveFileResponse & GoogleErrorResponse;
  if (!response.ok || !payload.id) {
    throw new GoogleDriveApiError(
      getGoogleErrorMessage(payload, "Unable to create Google Drive folder."),
      response.status,
      getGoogleErrorCode(payload),
    );
  }

  return payload;
}

export async function uploadGoogleDriveFile(accessToken: string, input: DriveUploadInput) {
  const metadata = {
    name: input.name,
    mimeType: input.mimeType,
    parents: [input.folderId],
  };
  const boundary = `kavero_${crypto.randomUUID().replaceAll("-", "")}`;
  const dataPart =
    typeof input.data === "string"
      ? input.data
      : new Uint8Array(input.data);
  const body = new Blob([
    `--${boundary}\r\n`,
    "Content-Type: application/json; charset=UTF-8\r\n\r\n",
    JSON.stringify(metadata),
    "\r\n",
    `--${boundary}\r\n`,
    `Content-Type: ${input.mimeType}\r\n\r\n`,
    dataPart,
    "\r\n",
    `--${boundary}--`,
  ]);

  const response = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink,webContentLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  const payload = (await response.json()) as DriveFileResponse & GoogleErrorResponse;
  if (!response.ok || !payload.id) {
    throw new GoogleDriveApiError(
      getGoogleErrorMessage(payload, "Unable to upload file to Google Drive."),
      response.status,
      getGoogleErrorCode(payload),
    );
  }

  return payload;
}

export async function deleteGoogleDriveFile(accessToken: string, fileId: string) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (response.ok || response.status === 404) {
    return;
  }

  throw new GoogleDriveApiError("Unable to delete Google Drive file.", response.status);
}

export async function revokeGoogleOAuthToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken }),
    signal: AbortSignal.timeout(3000),
  });

  if (response.ok || response.status === 400) {
    return;
  }

  throw new GoogleDriveApiError("Unable to revoke Google Drive access.", response.status);
}

export async function getGoogleDriveRefreshToken(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("get_google_drive_refresh_token", {
    p_user_id: userId,
  });

  if (error) {
    console.error("Unable to load Google Drive refresh token", error);
    throw new Error("Unable to load Google Drive access.");
  }

  return typeof data === "string" && data.trim() ? data : null;
}

export async function getGoogleDriveConnection(userId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_drive_connections")
    .select("id, user_id, google_email, folder_id, folder_name, scope, status, folder_status, canvas_folder_id, canvas_folder_name, canvas_folder_status, connected_at, updated_at")
    .eq("user_id", userId)
    .eq("provider", "google-drive")
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("Unable to load Google Drive connection", error);
    throw new Error("Unable to load Google Drive connection.");
  }

  return (data ?? null) as GoogleDriveConnection | null;
}

export async function getGoogleDriveAccessTokenForUser(userId: string) {
  const refreshToken = await getGoogleDriveRefreshToken(userId);
  if (!refreshToken) return null;

  try {
    return await refreshGoogleDriveAccessToken(refreshToken);
  } catch (error) {
    if (isGoogleDriveReconnectError(error)) {
      await markGoogleDriveReconnectRequired(userId);
    }

    throw error;
  }
}

export async function markGoogleDriveReconnectRequired(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_drive_connections")
    .update({ status: "reconnect_required", folder_status: "unknown" })
    .eq("user_id", userId)
    .eq("provider", "google-drive");

  if (error) {
    console.error("Unable to mark Google Drive reconnect required", error);
  }
}

export async function updateGoogleDriveFolder(userId: string, folderId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_drive_connections")
    .update({ folder_id: folderId, folder_status: "available", status: "active" })
    .eq("user_id", userId)
    .eq("provider", "google-drive");

  if (error) {
    console.error("Unable to update Google Drive folder", error);
    throw new Error("Unable to update Google Drive folder.");
  }
}

export async function updateGoogleDriveCanvasFolder(userId: string, folderId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_drive_connections")
    .update({
      canvas_folder_id: folderId,
      canvas_folder_name: googleDriveCanvasFolderName,
      canvas_folder_status: "available",
      status: "active",
    })
    .eq("user_id", userId)
    .eq("provider", "google-drive");

  if (error) {
    console.error("Unable to update Google Drive canvas folder", error);
    throw new Error("Unable to update Google Drive canvas folder.");
  }
}

export async function markGoogleDriveCanvasFolderMissing(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_drive_connections")
    .update({ canvas_folder_status: "missing" })
    .eq("user_id", userId)
    .eq("provider", "google-drive");

  if (error) {
    console.error("Unable to mark Google Drive canvas folder missing", error);
  }
}

export async function markGoogleDriveFolderMissing(userId: string) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("user_drive_connections")
    .update({ folder_status: "missing" })
    .eq("user_id", userId)
    .eq("provider", "google-drive");

  if (error) {
    console.error("Unable to mark Google Drive folder missing", error);
  }
}

export function parseImageDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;

  return {
    mimeType: match[1],
    buffer: Buffer.from(match[2], "base64"),
  };
}

export function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "png";
}
