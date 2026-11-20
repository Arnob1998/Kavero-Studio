import { getServerSupabaseUrl } from "@/lib/supabase/url";
import { RESULT_BUCKET, type ResultRow } from "./result-contract";
import { LOCAL_IMAGE_MAX_BYTES, validateLocalPNG } from "../png";
export async function boundedResultBody(body:ReadableStream<Uint8Array>|null,max:number,timeout=45000){
 if(!body)throw Error("result-body-missing");const reader=body.getReader();let size=0;const chunks:Uint8Array[]=[];
 let timer:ReturnType<typeof setTimeout>|undefined;
 const expiry=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{reject(Error("result-read-timeout"));void reader.cancel().catch(()=>{});},timeout);});
 try{while(true){const {done,value}=await Promise.race([reader.read(),expiry]);if(done)break;size+=value.length;if(size>max)throw Error("result-too-large");chunks.push(value);}return Buffer.concat(chunks);}
 finally{clearTimeout(timer);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function endpoint(key?:string){
 const base=getServerSupabaseUrl(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!base||!secret)throw Error("result-storage-unconfigured");
 if(key&&!/^connect-results\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/final\.png$/.test(key))throw Error("result-key-invalid");
 return {url:base.replace(/\/$/,"")+"/storage/v1/object/"+RESULT_BUCKET+(key?"/"+key:""),headers:{authorization:`Bearer ${secret}`,apikey:secret}};
}
export async function readResultObject(row:ResultRow){
 const {url,headers}=endpoint(row.object_key);const r=await fetch(url,{headers,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(15000)});
 if(!r.ok){const text=await r.text();if(r.status===404||(r.status===400&&text.length<4096&&/"(?:statusCode|status)"\s*:\s*"?404/.test(text)))return null;throw Error("result-storage-unavailable");}
 return boundedResultBody(r.body,LOCAL_IMAGE_MAX_BYTES,15000);
}
export function verifyResultBytes(bytes:Uint8Array,row:ResultRow){const info=validateLocalPNG(bytes);if(info.sha256!==row.descriptor.sha256||info.sizeBytes!==row.descriptor.sizeBytes)throw Error("result-object-conflict");return info;}
export async function ensureResultObject(row:ResultRow,bytes:Buffer){
 let prior=await readResultObject(row);if(prior){verifyResultBytes(prior,row);return;}
 const {url,headers}=endpoint(row.object_key);
 try{const r=await fetch(url,{method:"POST",headers:{...headers,"content-type":"image/png","x-upsert":"false"},body:new Uint8Array(bytes),redirect:"error",signal:AbortSignal.timeout(15000)});await r.body?.cancel();}catch{/* Reconcile a possibly committed upload, never overwrite/delete. */}
 prior=await readResultObject(row);if(!prior)throw Error("result-storage-unconfirmed");verifyResultBytes(prior,row);
}
export async function removeResultObject(row:ResultRow){
 const {url,headers}=endpoint();const r=await fetch(url,{method:"DELETE",headers:{...headers,"content-type":"application/json"},body:JSON.stringify({prefixes:[row.object_key]}),redirect:"error",signal:AbortSignal.timeout(15000)});await r.body?.cancel();
 if(!r.ok||await readResultObject(row))throw Error("result-cleanup-unconfirmed");
}
