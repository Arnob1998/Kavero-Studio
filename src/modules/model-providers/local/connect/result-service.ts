import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { context,owner,RequestError } from "./service";
import { uuid } from "./contracts";
import { digest,verifyConnect } from "./protocol";
import { resultOffer,resultUpload,resultProof,resultSummary,RESULT_CONTROL,RESULT_UPLOAD,type ResultRow } from "./result-contract";
import { boundedResultBody,ensureResultObject,readResultObject,removeResultObject,verifyResultBytes } from "./result-storage";
class ResultError extends RequestError {}
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}});
function errorResponse(e:unknown){if(e instanceof Error&&e.message==='result-too-large')return json({error:'Result exceeds its byte limit.'},413);if(e instanceof Error&&e.message==='result-read-timeout')return json({error:'Result upload timed out. Retry the original result.'},408);return json({error:e instanceof ResultError||e instanceof RequestError?e.message:"Result transfer is unavailable. Retry the original result."},e instanceof ResultError||e instanceof RequestError?e.status:e instanceof z.ZodError||e instanceof SyntaxError?400:503);}
export function enabled(request:Request){const origin=context(request);for(const flag of ["DELIVERY","EXECUTION","RESULTS"])if(process.env[`KAVERO_CONNECT_${flag}_ENABLED`]!=="1")throw new ResultError(404,"Result transfer is not enabled.");
 if(process.env.KAVERO_STORAGE_PROVIDER!=="kavero-managed"||process.env.KAVERO_MANAGED_STORAGE_BACKEND!=="supabase-storage")throw new ResultError(503,"Connect results require managed Supabase Storage.");return origin;}
function unpack(data:unknown,error:unknown):ResultRow|null{
 if(error||!data||typeof data!=="object")throw Error("result-database-unavailable");const v=data as {error?:string;result:ResultRow|null};
 if(v.error)throw new ResultError(v.error==="unauthorized"?401:v.error==="not-found"?404:v.error==="expired"?410:v.error==="rate-limited"||v.error==="result-capacity"?429:409,v.error);
 return v.result;
}
async function proof(request:Request,path:string){
 const origin=enabled(request);if(request.headers.has("origin")||new URL(request.url).pathname!==path)throw new ResultError(403,"Device proof required.");
 const id=uuid.parse(request.headers.get("x-kavero-connect-device")),nonce=uuid.parse(request.headers.get("x-kavero-connect-nonce"));
 const time=request.headers.get("x-kavero-connect-time")??"",sha=request.headers.get("x-kavero-body-sha256")??"",metadata=request.headers.get("x-kavero-result")??"";
 if(!/^\d{13}$/.test(time)||Math.abs(Date.now()-Number(time))>60000||!/^[a-f0-9]{64}$/.test(sha)||metadata.length>2048)throw new ResultError(401,"Invalid result proof.");
 const admin=createAdminClient(),{data:d,error}=await admin.from("connect_devices").select("public_key,revoked_at,expires_at").eq("id",id).eq("origin",origin).maybeSingle();
 if(error)throw Error("result-device-unavailable");
 if(!d||d.revoked_at||Date.parse(d.expires_at)<=Date.now()||!verifyConnect(resultProof(origin,path,id,time,nonce,metadata,sha),request.headers.get("x-kavero-connect-signature")??"",d.public_key))throw new ResultError(401,"Device authorization failed.");
 const action=async(name:string,input:unknown)=>{const r=await admin.rpc("connect_result_device",{p_id:id,p_origin:origin,p_key:d.public_key,p_nonce:name==="finish"||name==="abort"?null:nonce,p_action:name,p_input:input});return unpack(r.data,r.error)!;};
 return {origin,id,sha,metadata,action,publicKey:d.public_key,nonce};
}
export async function cleanupConnectResult(){
 const admin=createAdminClient(),claimed=await admin.rpc("connect_result_cleanup",{}),row=unpack(claimed.data,claimed.error);if(!row)return false;
 await removeResultObject(row);const finished=await admin.rpc("connect_result_cleanup",{p_job:row.job_id,p_token:row.cleanup_token});unpack(finished.data,finished.error);return true;
}
export async function resultPOST(request:Request){try{
 const p=await proof(request,RESULT_CONTROL);if(p.metadata||request.headers.get("content-type")!=="application/json")throw new ResultError(400,"Invalid result request.");
 const bytes=await boundedResultBody(request.body,8192);if(digest(bytes)!==p.sha)throw new ResultError(400,"Result body changed.");
 const raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
 if(raw?.action==="saved"){
  const input=z.object({action:z.literal("saved"),jobId:uuid,sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(raw);
  const r=await createAdminClient().rpc("connect_save_device",{p_id:p.id,p_origin:p.origin,p_key:p.publicKey,p_nonce:p.nonce,p_job:input.jobId,p_hash:input.sha256});
  if(r.error||!r.data)throw Error("save-receipt-unavailable");
  if(r.data.error)throw new ResultError(r.data.error==="unauthorized"?401:r.data.error==="not-found"?404:r.data.error==="rate-limited"?429:409,r.data.error);
  return json({version:1,result:r.data.result});
 }
 const input=resultOffer.parse(raw);
 const row=await p.action("offer",input);
 // Only after the durable nonce/rate/authorization check succeeds.
 try{await cleanupConnectResult();}catch{/* Operator cleanup retries durable record. */}
 return json({version:1,result:resultSummary(row),...(row.state==="pending"?{token:row.token,leaseUntil:row.lease_until}: {})});
}catch(e){return errorResponse(e);}}
export async function resultUploadPOST(request:Request){try{
 const p=await proof(request,RESULT_UPLOAD);
 if(request.headers.get("content-type")!=="image/png"||!/^[A-Za-z0-9_-]+$/.test(p.metadata))throw new ResultError(400,"Invalid upload metadata.");
 const decoded=Buffer.from(p.metadata,"base64url");if(decoded.toString("base64url")!==p.metadata)throw new ResultError(400,"Invalid upload metadata.");
 const input=resultUpload.parse(JSON.parse(decoded.toString("utf8")));
 if(input.sha256!==p.sha||request.headers.get("content-length")!==String(input.sizeBytes))throw new ResultError(400,"Invalid upload length or digest.");
 let row=await p.action("begin",input);if(row.state==="available"){await request.body?.cancel();return json({version:1,result:resultSummary(row)});}
 let bytes:Buffer;
 try{
  bytes=await boundedResultBody(request.body,input.sizeBytes);
  if(digest(bytes)!==p.sha||bytes.length!==input.sizeBytes)throw new ResultError(422,"Invalid result bytes.");
  try{verifyResultBytes(bytes,row);}catch{throw new ResultError(422,"Invalid final PNG.");}
 }catch(e){try{await p.action('abort',input);}catch{/* Expiry/revocation remains authoritative. */}throw e;}
 await ensureResultObject(row,bytes);row=await p.action("finish",input);return json({version:1,result:resultSummary(row)});
}catch(e){return errorResponse(e);}}
export async function resultGET(request:Request,id:string,statusOnly=false){try{
 const origin=enabled(request),user=await owner(request,origin);uuid.parse(id);const admin=createAdminClient();
 const load=async()=>{const r=await admin.rpc("connect_result_owner",{p_owner:user,p_origin:origin,p_job:id});return unpack(r.data,r.error)!;};
 const row=await load();if(statusOnly)return json({result:resultSummary(row)});
 if(row.state!=="available")throw new ResultError(409,"The result is not available yet.");
 const bytes=await readResultObject(row);if(!bytes)throw new ResultError(503,"The retained result is temporarily unavailable.");verifyResultBytes(bytes,row);await load();
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"image/png","Content-Length":String(bytes.length),"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Disposition":`attachment; filename="kavero-${id}.png"`,"X-Kavero-SHA256":row.descriptor.sha256}});
}catch(e){return errorResponse(e);}}
export async function resultCancelPOST(request:Request,id:string){try{
 const origin=enabled(request),user=await owner(request,origin);uuid.parse(id);
 const bytes=await boundedResultBody(request.body,128);z.object({}).strict().parse(JSON.parse(bytes.toString('utf8')));
 const r=await createAdminClient().rpc('connect_result_cancel',{p_owner:user,p_origin:origin,p_job:id});unpack(r.data,r.error);return json({cancelRequested:true});
}catch(e){return errorResponse(e);}}
