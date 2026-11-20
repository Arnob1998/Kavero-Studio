import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { owner, RequestError } from "./service";
import { enabled } from "./result-service";
import { uuid } from "./contracts";
import { boundedResultBody, readResultObject, verifyResultBytes } from "./result-storage";
import type { ResultRow } from "./result-contract";
import { sameLocalSaveDestination, localSaveSummary, type LocalSaveRecord, type LocalSaveMapping } from "@/modules/generation/local/save-contract";
import { resolveLocalSaveDestination, readLocalSaveObject, ensureLocalSaveObject } from "@/modules/generation/local/save-storage";
import type { StoredObjectRef } from "@/modules/storage/storage-provider";
export type ConnectSave = LocalSaveRecord & { origin:string; descriptor:ResultRow["descriptor"]; payload:{intent:{prompt:string;profile:string};recipeSnapshot:{recipeId:string;label:string;settings:Record<string,unknown>}} };
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"private, no-store"}});
async function action(user:string,origin:string,id:string,name:string,token?:string,destination?:LocalSaveRecord["destination"],mapping?:LocalSaveMapping){
 const {data,error}=await createAdminClient().rpc("connect_save_owner",{p_owner:user,p_origin:origin,p_job:id,p_action:name,p_token:token??null,p_destination:destination??null,p_mapping:mapping??null});
 if(error||!data)throw Error("connect-save-database-unavailable");
 if(data.error)throw new RequestError(data.error==="not-found"?404:data.error==="expired"?410:409,data.error);
 if(data.save&&(data.save.owner_id!==user||data.save.job_id!==id||data.save.origin!==origin))throw Error("connect-save-identity-invalid");
 return data as {save:ConnectSave|null;result?:ResultRow;historyRemoved?:boolean};
}
export function connectSaveMapping(save:ConnectSave):LocalSaveMapping {
 const ref=(image:boolean):StoredObjectRef=>{const name=save.image_id+(image?".png":".json"),key=`users/${save.owner_id}/connect-generated/${save.generation_id}/${name}`;
  return {providerId:"kavero-managed",kind:"managed",purpose:image?"generated-image":"generated-metadata",objectKey:key,path:key,bucket:image?"kavero-generated-images":"kavero-generated-metadata",externalId:null,externalUrl:null,status:"available",version:1,
   metadata:{backendProviderId:"supabase-storage",name,contentType:image?"image/png":"application/json"}};};
 const imageRef=ref(true),metadataRef=ref(false);
 return {imageRef,metadataRef,metadataBody:JSON.stringify({version:2,connectJobId:save.job_id,generationId:save.generation_id,imageId:save.image_id,prompt:save.payload.intent.prompt,model:save.payload.recipeSnapshot.recipeId,recipeSnapshot:save.payload.recipeSnapshot,variant:1,mimeType:"image/png",width:512,height:512,sha256:save.sha256,packageFingerprint:save.descriptor.packageFingerprint,imageObjectKey:imageRef.objectKey,createdAt:save.created_at})};
}
function summary(reply:{save:ConnectSave|null;historyRemoved?:boolean}){return {save:reply.save?{...localSaveSummary(reply.save),...(reply.save.state==="saved"?{historyRemoved:reply.historyRemoved===true}:{})}:{state:"available"}};}
function failure(e:unknown){return json({error:e instanceof RequestError?e.message:"Saving could not be confirmed. Retry this save without generating again."},e instanceof RequestError?e.status:e instanceof z.ZodError||e instanceof SyntaxError?400:503);}
export async function connectSaveGET(request:Request,id:string){try{const origin=enabled(request),user=await owner(request,origin);uuid.parse(id);return json(summary(await action(user,origin,id,"inspect")));}catch(e){return failure(e);}}
export async function connectSavePOST(request:Request,id:string){
 let save:ConnectSave|null=null,user="",origin="",timer:ReturnType<typeof setInterval>|undefined,lost=false,renewing=false;
 const deadline=Date.now()+90000,assertActive=()=>{if(lost||Date.now()>=deadline)throw new RequestError(409,"lease-expired");};
 try{
  origin=enabled(request);user=await owner(request,origin);uuid.parse(id);
  const body=await boundedResultBody(request.body,128,5000);z.object({}).strict().parse(JSON.parse(body.toString("utf8")));
  const prior=await action(user,origin,id,"inspect");if(prior.save?.state==="saved")return json(summary(prior));
  const runtime=await resolveLocalSaveDestination(user,createAdminClient());assertActive();
  if(runtime.destination.provider!=="kavero-managed"||runtime.destination.backendId!=="supabase-storage")throw new RequestError(503,"Connect requires managed Supabase Storage.");
  const token=randomUUID(),claimed=await action(user,origin,id,"claim",token,runtime.destination);save=claimed.save;
  if(!save)throw Error("connect-save-missing");if(save.state==="saved")return json(summary(claimed));
  if(save.attempt_token!==token)return json(summary(claimed),202);
  timer=setInterval(async()=>{if(renewing||Date.now()>=deadline)return;renewing=true;try{await action(user,origin,id,"renew",token);}catch{lost=true;}finally{renewing=false;}},15000);
  if(!save.object_mapping){save=(await action(user,origin,id,"mapping",token,undefined,connectSaveMapping(save))).save!;assertActive();}
  const mapping=save.object_mapping!;
  let bytes=await readLocalSaveObject(runtime,save,mapping.imageRef,save.sha256,save.descriptor.sizeBytes);assertActive();
  if(!bytes){
   const source=await action(user,origin,id,"source",token);assertActive();
   if(!source.result)throw Error("connect-source-missing");bytes=await readResultObject(source.result);assertActive();
   if(!bytes)throw Error("connect-source-unavailable");verifyResultBytes(bytes,source.result);
  }
  verifyResultBytes(bytes,{descriptor:save.descriptor} as ResultRow);
  await ensureLocalSaveObject(runtime,save,mapping.imageRef,bytes,assertActive);
  await ensureLocalSaveObject(runtime,save,mapping.metadataRef,Buffer.from(mapping.metadataBody,"utf8"),assertActive);
  const current=await resolveLocalSaveDestination(user,createAdminClient());assertActive();
  if(!sameLocalSaveDestination(current.destination,save.destination))throw new RequestError(409,"destination-changed");
  return json(summary(await action(user,origin,id,"finish",token,current.destination)));
 }catch(e){
  if(save){try{const latest=await action(user,origin,id,"inspect");if(latest.save?.state==="saved")return json(summary(latest));}catch{/* Preserve uncertain commit. */}
   try{await action(user,origin,id,"fail",save.attempt_token);}catch{/* A different/current attempt owns receipt. */}}
  return failure(e);
 }finally{if(timer)clearInterval(timer);}
}
