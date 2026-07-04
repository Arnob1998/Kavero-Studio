import { getCanvasUser, jsonError, requireCanvasAdmin } from "@/lib/canvas/api";

interface UploadRouteContext {
  params: Promise<{ filename: string }>;
}

export async function GET(_request: Request, { params }: UploadRouteContext) {
  const user = await getCanvasUser();
  if (!user) return jsonError("Unauthorized", 401);

  const { admin, response } = requireCanvasAdmin();
  if (!admin) return response;

  const { filename } = await params;
  const { data, error } = await admin
    .from("canvas_assets")
    .select("public_url")
    .eq("user_id", user.id)
    .ilike("storage_path", `%/${filename}`)
    .maybeSingle();

  if (error) return jsonError("Unable to load upload.", 500);
  if (!data?.public_url) return jsonError("Not found", 404);

  return Response.redirect(data.public_url, 302);
}
