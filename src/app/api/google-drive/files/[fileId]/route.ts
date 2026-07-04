import { NextResponse } from "next/server";
import { getGoogleDriveAccessTokenForUser, markGoogleDriveReconnectRequired } from "@/lib/google-drive";
import { createClient } from "@/lib/supabase/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: record, error: recordError } = await supabase
    .from("generated_images")
    .select("id, drive_file_id, mime_type, drive_status")
    .eq("user_id", user.id)
    .eq("drive_file_id", fileId)
    .maybeSingle();

  if (recordError) {
    console.error("Unable to verify Drive file ownership", recordError);
    return NextResponse.json({ error: "Unable to load image." }, { status: 500 });
  }

  if (!record) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let accessToken: string | null = null;
  try {
    accessToken = await getGoogleDriveAccessTokenForUser(user.id);
  } catch {
    return NextResponse.json({ error: "Google Drive needs to be reconnected." }, { status: 409 });
  }

  if (!accessToken) {
    return NextResponse.json({ error: "Google Drive is not connected." }, { status: 409 });
  }

  const driveResponse = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!driveResponse.ok || !driveResponse.body) {
    if (driveResponse.status === 404) {
      await supabase
        .from("generated_images")
        .update({ drive_status: "missing" })
        .eq("id", record.id)
        .eq("user_id", user.id);

      return NextResponse.json({ error: "Image is missing in Google Drive." }, { status: 404 });
    }

    if (driveResponse.status === 401 || driveResponse.status === 403) {
      await markGoogleDriveReconnectRequired(user.id);
      return NextResponse.json({ error: "Google Drive needs to be reconnected." }, { status: 409 });
    }

    return NextResponse.json({ error: "Unable to stream Drive image." }, { status: 502 });
  }

  return new Response(driveResponse.body, {
    status: 200,
    headers: {
      "Content-Type": record.mime_type || driveResponse.headers.get("Content-Type") || "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
