import { localSetupGET, localSetupPOST } from "@/modules/generation/local/setup-service";
export const runtime = "nodejs";
export const maxDuration = 30;
export const GET = localSetupGET;
export const POST = localSetupPOST;
