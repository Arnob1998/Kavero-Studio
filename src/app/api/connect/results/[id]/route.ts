import { resultGET,resultCancelPOST } from "@/modules/model-providers/local/connect/result-service";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return resultGET(request,(await params).id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return resultCancelPOST(request,(await params).id);}
