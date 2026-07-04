import { NextResponse } from "next/server";
import { jsonError, requireCanvasAdmin } from "@/lib/canvas/api";

export async function GET() {
  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { data, error } = await admin
    .from("canvas_templates")
    .select("id, name, category, canvas_json, width, height, thumbnail_url, metadata, sort_order")
    .order("sort_order", { ascending: true });

  if (error) return jsonError("Unable to load templates.", 500);
  return NextResponse.json(data ?? []);
}
