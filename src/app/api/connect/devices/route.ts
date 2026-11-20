import { devicesGET, devicesPOST } from "@/modules/model-providers/local/connect/service";
export const runtime = "nodejs";
export const GET = devicesGET;
export const POST = devicesPOST;
