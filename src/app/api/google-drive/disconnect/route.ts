import { NextResponse } from "next/server";
import { getGoogleDriveRefreshToken, revokeGoogleOAuthToken } from "@/lib/google-drive";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const refreshToken = await getGoogleDriveRefreshToken(user.id).catch((tokenError) => {
    console.error("Unable to load Google Drive token before disconnect", tokenError);
    return null;
  });

  if (refreshToken) {
    await revokeGoogleOAuthToken(refreshToken).catch((revokeError) => {
      console.error("Unable to revoke Google OAuth token", revokeError);
    });
  }

  const { error: disconnectError } = await admin.rpc("disconnect_google_drive", {
    p_user_id: user.id,
  });

  if (disconnectError) {
    console.error("Unable to disconnect Google Drive", disconnectError);
    return NextResponse.json({ error: "Unable to disconnect Google Drive." }, { status: 500 });
  }

  return NextResponse.json({ connected: false });
}
