import { NextResponse } from "next/server";
import {
  getCanvasUser,
  jsonError,
  mapPage,
  pagePayloadSchema,
  requireCanvasAccess,
  requireCanvasAdmin,
} from "@/lib/canvas/api";

interface PageRouteContext {
  params: Promise<{ pageId: string }>;
}

export async function PUT(request: Request, { params }: PageRouteContext) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const parsed = pagePayloadSchema.omit({ after_sort_order: true }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid page payload.", 400);

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { pageId } = await params;
  const updatePayload: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updatePayload.title = parsed.data.title;
  if (parsed.data.canvas_json !== undefined) updatePayload.canvas_json = parsed.data.canvas_json;
  if (parsed.data.metadata !== undefined) updatePayload.metadata = parsed.data.metadata;

  const { data, error } = await admin
    .from("canvas_pages")
    .update(updatePayload)
    .eq("id", pageId)
    .eq("user_id", user.id)
    .select("id, design_id, title, canvas_json, sort_order, metadata, created_at, updated_at")
    .maybeSingle();

  if (error) return jsonError("Unable to update page.", 500);
  if (!data) return jsonError("Not found", 404);
  return NextResponse.json(mapPage(data));
}

export async function DELETE(request: Request, { params }: PageRouteContext) {
  void request;
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { pageId } = await params;
  const { data: page, error: pageError } = await admin
    .from("canvas_pages")
    .select("id, design_id")
    .eq("id", pageId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (pageError) return jsonError("Unable to check page.", 500);
  if (!page) return NextResponse.json({ ok: true });

  const { count, error: countError } = await admin
    .from("canvas_pages")
    .select("id", { count: "exact", head: true })
    .eq("design_id", page.design_id)
    .eq("user_id", user.id);

  if (countError) return jsonError("Unable to check page count.", 500);
  if ((count ?? 0) <= 1) return jsonError("Cannot delete the last page", 400);

  const { error } = await admin.from("canvas_pages").delete().eq("id", pageId).eq("user_id", user.id);
  if (error) return jsonError("Unable to delete page.", 500);
  return NextResponse.json({ ok: true });
}
