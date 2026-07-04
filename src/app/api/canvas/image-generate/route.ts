import { handleCanvasImageGenerateRequest } from "@/modules/canvas/ai/image-generation/handle-canvas-image-generate-request";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleCanvasImageGenerateRequest(request);
}
