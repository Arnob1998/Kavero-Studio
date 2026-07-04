import { NextResponse } from "next/server";
import { jsonError, requireCanvasAdmin } from "@/lib/canvas/api";

interface TemplateRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, { params }: TemplateRouteContext) {
  void request;
  const { id } = await params;
  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { data, error } = await admin
    .from("canvas_templates")
    .select("id, name, category, canvas_json, width, height, thumbnail_url, metadata, sort_order")
    .eq("id", id)
    .maybeSingle();

  if (error) return jsonError("Unable to load template.", 500);
  if (!data) return jsonError("Not found", 404);
  return NextResponse.json(data);
}
