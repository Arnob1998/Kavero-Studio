import { NextResponse } from "next/server";
import { getGoogleDriveAccessTokenForUser } from "@/lib/google-drive";
import { getGenerationLimit, normalizeUserPlan } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [{ data: metadata }, { count }, { data: connection }] = await Promise.all([
    supabase.from("user_metadata").select("plan").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("generation_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("user_drive_connections")
      .select("status, folder_status")
      .eq("user_id", user.id)
      .eq("provider", "google-drive")
      .maybeSingle(),
  ]);

  const plan = normalizeUserPlan(metadata?.plan);
  const generationLimit = getGenerationLimit(plan);
  const used = count ?? 0;
  const quotaFull = generationLimit !== null && used >= generationLimit;
  if (!connection || connection.status === "revoked") {
    return NextResponse.json({
      canSave: false,
      connected: false,
      reconnectRequired: false,
      quotaFull,
      usage: { used, limit: generationLimit },
      warning:
        "Google Drive is not connected. This generation will not be saved to Gallery, so download any images you want to keep.",
    });
  }

  if (connection.status === "reconnect_required") {
    return NextResponse.json({
      canSave: false,
      connected: true,
      reconnectRequired: true,
      quotaFull,
      usage: { used, limit: generationLimit },
      warning:
        "Google Drive needs to be reconnected. This generation will not be saved to Gallery unless Drive is reconnected first.",
    });
  }

  try {
    await getGoogleDriveAccessTokenForUser(user.id);
  } catch {
    return NextResponse.json({
      canSave: false,
      connected: true,
      reconnectRequired: true,
      quotaFull,
      usage: { used, limit: generationLimit },
      warning:
        "Google Drive needs to be reconnected. This generation will not be saved to Gallery unless Drive is reconnected first.",
    });
  }

  if (quotaFull) {
    return NextResponse.json({
      canSave: false,
      connected: true,
      reconnectRequired: false,
      quotaFull: true,
      usage: { used, limit: generationLimit },
      warning: `Free plan Gallery storage is full (${used}/${generationLimit} generations). This generation will not be saved unless you free a folder first.`,
    });
  }

  return NextResponse.json({
    canSave: true,
    connected: true,
    reconnectRequired: false,
    quotaFull: false,
    usage: { used, limit: generationLimit },
    warning: null,
  });
}
