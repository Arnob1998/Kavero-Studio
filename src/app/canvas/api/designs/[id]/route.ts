import { NextResponse } from "next/server";
import {
  designPayloadSchema,
  getCanvasUser,
  jsonError,
  mapDesign,
  mapPage,
  requireCanvasAccess,
  requireCanvasAdmin,
} from "@/lib/canvas/api";

interface DesignRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: DesignRouteContext) {
  void request;
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { id } = await params;
  const { data: design, error } = await admin
    .from("canvas_designs")
    .select("id, name, canvas_json, width, height, thumbnail_url, metadata, created_at, updated_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) return jsonError("Unable to load design.", 500);
  if (!design) return jsonError("Not found", 404);

  const { data: pages, error: pagesError } = await admin
    .from("canvas_pages")
    .select("id, design_id, title, canvas_json, sort_order, metadata, created_at, updated_at")
    .eq("design_id", id)
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true });

  if (pagesError) return jsonError("Unable to load pages.", 500);
  return NextResponse.json({ ...mapDesign(design), pages: (pages ?? []).map(mapPage) });
}

export async function PUT(request: Request, { params }: DesignRouteContext) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const parsed = designPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid design payload.", 400);

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { id } = await params;
  const updatePayload: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updatePayload.name = parsed.data.name;
  if (parsed.data.canvas_json !== undefined) updatePayload.canvas_json = parsed.data.canvas_json;
  if (parsed.data.width !== undefined) updatePayload.width = parsed.data.width;
  if (parsed.data.height !== undefined) updatePayload.height = parsed.data.height;
  if (parsed.data.thumbnail_url !== undefined) updatePayload.thumbnail_url = parsed.data.thumbnail_url;
  if (parsed.data.metadata !== undefined) updatePayload.metadata = parsed.data.metadata;

  const { data, error } = await admin
    .from("canvas_designs")
    .update(updatePayload)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, name, canvas_json, width, height, thumbnail_url, metadata, created_at, updated_at")
    .maybeSingle();

  if (error) return jsonError("Unable to update design.", 500);
  if (!data) return jsonError("Not found", 404);
  return NextResponse.json(mapDesign(data));
}

export async function DELETE(request: Request, { params }: DesignRouteContext) {
  void request;
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { id } = await params;
  const { error } = await admin.from("canvas_designs").delete().eq("id", id).eq("user_id", user.id);
  if (error) return jsonError("Unable to delete design.", 500);
  return NextResponse.json({ ok: true });
}
