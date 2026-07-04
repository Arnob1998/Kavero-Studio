import { NextResponse } from "next/server";
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

  const [{ data: connection }, { data: metadata }, { count }] = await Promise.all([
    supabase
      .from("user_drive_connections")
      .select("google_email, folder_id, folder_name, scope, status, folder_status, connected_at, updated_at")
      .eq("user_id", user.id)
      .eq("provider", "google-drive")
      .maybeSingle(),
    supabase.from("user_metadata").select("plan").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("generation_runs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);
  const plan = normalizeUserPlan(metadata?.plan);

  return NextResponse.json({
    connected: connection?.status === "active",
    reconnectRequired: connection?.status === "reconnect_required",
    plan,
    usage: {
      used: count ?? 0,
      limit: getGenerationLimit(plan),
    },
    connection: connection
      ? {
          googleEmail: connection.google_email,
          folderId: connection.folder_id,
          folderName: connection.folder_name,
          scope: connection.scope,
          status: connection.status,
          folderStatus: connection.folder_status,
          connectedAt: connection.connected_at,
          updatedAt: connection.updated_at,
        }
      : null,
  });
}
