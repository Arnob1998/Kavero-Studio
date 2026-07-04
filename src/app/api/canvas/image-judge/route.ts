import { handleImageJudgeRequest } from "@/modules/canvas/ai/image-judge/handle-image-judge-request";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleImageJudgeRequest(request);
}
