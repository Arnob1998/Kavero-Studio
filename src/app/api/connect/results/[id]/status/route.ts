import { resultGET } from "@/modules/model-providers/local/connect/result-service";
export const runtime="nodejs";
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return resultGET(request,(await params).id,true);}
