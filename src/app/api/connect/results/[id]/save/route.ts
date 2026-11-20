import {connectSaveGET,connectSavePOST} from "@/modules/model-providers/local/connect/save-service";
export const runtime="nodejs";
export const maxDuration=120;
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){return connectSaveGET(request,(await params).id);}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){return connectSavePOST(request,(await params).id);}
