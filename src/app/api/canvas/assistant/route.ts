import { handleAssistantRequest } from "@/modules/canvas/ai/copilot/handle-assistant-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleAssistantRequest(request);
}
