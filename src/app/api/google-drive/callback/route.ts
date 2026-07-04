import { type NextRequest, NextResponse } from "next/server";
import {
  createGoogleDriveFolder,
  exchangeGoogleDriveCode,
  getGoogleUserEmail,
  googleDriveFolderName,
  googleDriveScope,
} from "@/lib/google-drive";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("kavero_google_drive_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return redirectWithStatus(request.url, "error");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.redirect(new URL("/auth/login?next=/settings/storage", request.url));
  }

  try {
    const token = await exchangeGoogleDriveCode(code, request.url);
    if (!token.refresh_token) {
      throw new Error("Google did not return offline Drive access. Try connecting again.");
    }

    const [folder, googleEmail] = await Promise.all([
      createGoogleDriveFolder(token.access_token!),
      getGoogleUserEmail(token.access_token!).catch(() => null),
    ]);

    const admin = createAdminClient();
    const { error: upsertError } = await admin.rpc("upsert_google_drive_connection", {
      p_user_id: user.id,
      p_refresh_token: token.refresh_token,
      p_google_email: googleEmail,
      p_folder_id: folder.id,
      p_folder_name: googleDriveFolderName,
      p_scope: token.scope || googleDriveScope,
    });

    if (upsertError) {
      console.error("Unable to save Google Drive connection", upsertError);
      throw new Error("Unable to save Google Drive connection.");
    }

    return redirectWithStatus(request.url, "connected");
  } catch (connectError) {
    console.error("Google Drive callback failed", connectError);
    return redirectWithStatus(request.url, "error");
  }
}

function redirectWithStatus(requestUrl: string, status: "connected" | "error") {
  const response = NextResponse.redirect(new URL(`/settings/storage?drive=${status}`, requestUrl));
  response.cookies.delete("kavero_google_drive_state");
  return response;
}
