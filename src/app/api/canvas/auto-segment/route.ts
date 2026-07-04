import { handleAutoSegmentRequest } from "@/modules/canvas/ai/auto-segment/handle-auto-segment-request";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleAutoSegmentRequest(request);
}
