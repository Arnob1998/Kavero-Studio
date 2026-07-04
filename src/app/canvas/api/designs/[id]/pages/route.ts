import { NextResponse } from "next/server";
import {
  CANVAS_LIMITS,
  getCanvasUser,
  jsonError,
  mapPage,
  pagePayloadSchema,
  requireCanvasAccess,
  requireCanvasAdmin,
} from "@/lib/canvas/api";

interface DesignPagesRouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, { params }: DesignPagesRouteContext) {
  const { id } = await params;
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const parsed = pagePayloadSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return jsonError("Invalid page payload.", 400);

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { data: design, error: designError } = await admin
    .from("canvas_designs")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (designError) return jsonError("Unable to check design.", 500);
  if (!design) return jsonError("Not found", 404);

  const { count, error: countError } = await admin
    .from("canvas_pages")
    .select("id", { count: "exact", head: true })
    .eq("design_id", id)
    .eq("user_id", user.id);

  if (countError) return jsonError("Unable to check page quota.", 500);
  const pageCount = count ?? 0;
  if (pageCount >= CANVAS_LIMITS.pagesPerDesign) {
    return jsonError(`Canvas page limit reached (${CANVAS_LIMITS.pagesPerDesign}).`, 409);
  }

  let insertOrder = pageCount;
  if (parsed.data.after_sort_order !== undefined) {
    insertOrder = parsed.data.after_sort_order + 1;
    const { error: shiftError } = await admin.rpc("shift_canvas_pages_after", {
      p_design_id: id,
      p_user_id: user.id,
      p_after_sort_order: parsed.data.after_sort_order,
    });
    if (shiftError) return jsonError("Unable to reorder pages.", 500);
  }

  const { data: page, error } = await admin
    .from("canvas_pages")
    .insert({
      user_id: user.id,
      design_id: id,
      title: parsed.data.title ?? `Page ${pageCount + 1}`,
      canvas_json: parsed.data.canvas_json ?? "{}",
      metadata: parsed.data.metadata ?? {},
      sort_order: insertOrder,
    })
    .select("id, design_id, title, canvas_json, sort_order, metadata, created_at, updated_at")
    .single();

  if (error || !page) return jsonError("Unable to add page.", 500);
  return NextResponse.json(mapPage(page));
}
