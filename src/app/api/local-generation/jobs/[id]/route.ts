import { manageLocalJob } from "@/modules/generation/local/service";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return manageLocalJob((await context.params).id);
}
export async function DELETE(_request: Request, context: Context) {
  return manageLocalJob((await context.params).id, true);
}
