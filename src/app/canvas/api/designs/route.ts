import { NextResponse } from "next/server";
import {
  CANVAS_LIMITS,
  designPayloadSchema,
  getCanvasUser,
  jsonError,
  mapDesign,
  normalizeCanvasJson,
  requireCanvasAccess,
  requireCanvasAdmin,
} from "@/lib/canvas/api";

export async function GET() {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { data, error } = await admin
    .from("canvas_designs")
    .select("id, name, canvas_json, width, height, thumbnail_url, metadata, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) return jsonError("Unable to load designs.", 500);
  return NextResponse.json((data ?? []).map(mapDesign));
}

export async function POST(request: Request) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);
  const access = await requireCanvasAccess(user.id);
  if (access.response) return access.response;

  const parsed = designPayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid design payload.", 400);

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { count, error: countError } = await admin
    .from("canvas_designs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);

  if (countError) return jsonError("Unable to check design quota.", 500);
  if ((count ?? 0) >= CANVAS_LIMITS.designsPerUser) {
    return jsonError(`Canvas design limit reached (${CANVAS_LIMITS.designsPerUser}).`, 409);
  }

  const canvasJson = normalizeCanvasJson(parsed.data.canvas_json);
  const { data: design, error: designError } = await admin
    .from("canvas_designs")
    .insert({
      user_id: user.id,
      name: parsed.data.name ?? "Untitled Design",
      canvas_json: canvasJson,
      width: parsed.data.width ?? 1080,
      height: parsed.data.height ?? 1080,
      thumbnail_url: parsed.data.thumbnail_url ?? null,
      metadata: parsed.data.metadata ?? {},
    })
    .select("id, name, canvas_json, width, height, thumbnail_url, metadata, created_at, updated_at")
    .single();

  if (designError || !design) return jsonError("Unable to create design.", 500);

  const { error: pageError } = await admin.from("canvas_pages").insert({
    user_id: user.id,
    design_id: design.id,
    title: "Page 1",
    canvas_json: canvasJson,
    metadata: parsed.data.metadata ?? {},
    sort_order: 0,
  });

  if (pageError) {
    await admin.from("canvas_designs").delete().eq("id", design.id).eq("user_id", user.id);
    return jsonError("Unable to create design page.", 500);
  }

  return NextResponse.json(mapDesign(design));
}
