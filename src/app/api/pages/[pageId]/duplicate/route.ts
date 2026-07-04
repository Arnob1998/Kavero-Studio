import { NextResponse } from "next/server";
import { CANVAS_LIMITS, getCanvasUser, jsonError, mapPage, requireCanvasAccess, requireCanvasAdmin } from "@/lib/canvas/api";

interface DuplicatePageRouteContext {
  params: Promise<{ pageId: string }>;
}

export async function POST(request: Request, { params }: DuplicatePageRouteContext) {
  void request;
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { pageId } = await params;
  const { data: original, error: originalError } = await admin
    .from("canvas_pages")
    .select("id, design_id, title, canvas_json, sort_order, metadata")
    .eq("id", pageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (originalError) return jsonError("Unable to load page.", 500);
  if (!original) return jsonError("Not found", 404);

  const { count, error: countError } = await admin
    .from("canvas_pages")
    .select("id", { count: "exact", head: true })
    .eq("design_id", original.design_id)
    .eq("user_id", user.id);

  if (countError) return jsonError("Unable to check page quota.", 500);
  if ((count ?? 0) >= CANVAS_LIMITS.pagesPerDesign) {
    return jsonError(`Canvas page limit reached (${CANVAS_LIMITS.pagesPerDesign}).`, 409);
  }

  const { error: shiftError } = await admin.rpc("shift_canvas_pages_after", {
    p_design_id: original.design_id,
    p_user_id: user.id,
    p_after_sort_order: original.sort_order,
  });
  if (shiftError) return jsonError("Unable to reorder pages.", 500);

  const { data: page, error } = await admin
    .from("canvas_pages")
    .insert({
      user_id: user.id,
      design_id: original.design_id,
      title: `${original.title} (copy)`,
      canvas_json: original.canvas_json,
      metadata: original.metadata,
      sort_order: original.sort_order + 1,
    })
    .select("id, design_id, title, canvas_json, sort_order, metadata, created_at, updated_at")
    .single();

  if (error || !page) return jsonError("Unable to duplicate page.", 500);
  return NextResponse.json(mapPage(page));
}
