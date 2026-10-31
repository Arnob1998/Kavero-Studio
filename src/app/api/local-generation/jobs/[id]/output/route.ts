import { downloadLocalOutput } from "@/modules/generation/local/service";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return downloadLocalOutput((await context.params).id);
}
