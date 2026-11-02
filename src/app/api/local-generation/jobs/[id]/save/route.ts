import { getLocalSave, saveLocalOutput } from "@/modules/generation/local/save-service";
export const runtime = "nodejs";
export const maxDuration = 120;
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) { return getLocalSave((await context.params).id); }
export async function POST(request: Request, context: Context) { return saveLocalOutput((await context.params).id, request); }
