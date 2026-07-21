import { handleAutoSegmentRequest } from "@/modules/canvas/ai/auto-segment/handle-auto-segment-request";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  return handleAutoSegmentRequest(request);
}
