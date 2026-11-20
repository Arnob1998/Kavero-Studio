import {z} from 'zod';
import {createAdminClient} from '@/lib/supabase/admin';
import {context} from '@/modules/generation/local/service';
import {localUIEnabled} from '@/modules/generation/local/readiness-service';
import {localHostRequest} from './host-bridge';
import {localProfiles} from './browser-profiles';
import {removalUUID,removalPackage,removalDigest,removalReviewSchema,nativeRemovalSchema,type RemovalOperation} from './removal-contract';

const record=z.object({id:removalUUID,owner_id:removalUUID,submission_key:removalUUID,instance_id:removalUUID,package_id:removalPackage,manifest:removalDigest,state:z.enum(['pending','removed','refused']),host_operation:removalUUID.nullable()});
type Row=z.infer<typeof record>;
const mutation=z.object({key:removalUUID,instanceId:removalUUID,packageId:removalPackage,manifest:removalDigest,confirmed:z.literal(true)}).strict();
class RemovalError extends Error{constructor(readonly status:number,message:string){super(message);}}
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
async function rpc(name:string,args:Record<string,unknown>):Promise<Row|null>{
 const {data,error}=await createAdminClient().rpc(name,args);
 if(error)throw new RemovalError(/local-runtime-|local-jobs-outstanding|local-removal-idempotency/.test(error.message)?409:503,/local-runtime-|local-jobs-outstanding/.test(error.message)?'Local jobs or another model operation need to finish or recover before removal.':'Removal storage is unavailable. Retry the same operation.');
 const value=Array.isArray(data)?data[0]:data;return !value||value.id==null?null:record.parse(value);
}
function verifyRow(row:Row,owner:string,fields:{key?:string;instanceId:string;packageId:string;manifest:string}){
 if(row.owner_id!==owner||row.instance_id!==fields.instanceId||row.package_id!==fields.packageId||row.manifest!==fields.manifest||fields.key&&row.submission_key!==fields.key)throw new RemovalError(503,'Removal identity changed.');
}
const hostBody=(owner:string,row:Row)=>({owner,key:row.submission_key,instanceId:row.instance_id,packageId:row.package_id,manifest:row.manifest,appFence:row.id});
function waiting(row:Row):RemovalOperation{return {accountOnly:false,id:row.id,key:row.submission_key,instanceId:row.instance_id,packageId:row.package_id,manifest:row.manifest,state:row.state==='removed'?'removed':row.state==='refused'?'refused':'awaiting-retry',reclaimedBytes:0,retainedBytes:0,error:row.state==='pending'?'Removal acknowledgement is incomplete. Retry this removal to recover it.':null};}
async function reconcile(owner:string,row:Row,value:unknown):Promise<RemovalOperation>{
 const op=nativeRemovalSchema.parse(value);
 if(op.id!==row.host_operation&&row.host_operation!==null||op.appFence!==row.id||op.key!==row.submission_key||op.instanceId!==row.instance_id||op.packageId!==row.package_id||op.manifest!==row.manifest)throw new RemovalError(503,'Removal identity changed.');
 if(op.complete&&op.state!=='removed')throw new RemovalError(503,'Invalid removal completion.');
 const settled=await rpc(op.accountOnly&&op.complete?'settle_local_model_account_removal':'settle_local_model_removal',{p_owner:owner,p_id:row.id,p_host:op.id,p_removed:op.complete});
 if(!settled)throw new RemovalError(503,'Removal storage is unavailable.');verifyRow(settled,owner,{key:row.submission_key,instanceId:row.instance_id,packageId:row.package_id,manifest:row.manifest});
 return {...waiting(settled),accountOnly:op.accountOnly,state:op.state==='removed'&&!op.complete?'interrupted':op.state,reclaimedBytes:op.reclaimedBytes,retainedBytes:op.retainedBytes,
  error:op.error?'Removal needs recovery. Finish any local jobs, then retry the same removal.':op.state==='removed'&&!op.complete?'Native cleanup needs recovery. Retry this removal.':null};
}
async function status(owner:string,row:Row){
 const result=await localHostRequest('/host/removal/status',hostBody(owner,row));
 if(result.status===404&&!row.host_operation)return waiting(row);
 if(result.status!==200)throw new RemovalError(503,'The model computer is unavailable. Start the same Kavero host and retry.');
 return reconcile(owner,row,(result.body as {operation:unknown}).operation);
}
export async function localRemovalGET(request:Request){
 if(!localUIEnabled())return reply({error:'Local generation is not enabled.'},404);
 const ctx=await context();if(ctx.response)return ctx.response;
 const query=new URL(request.url).searchParams,profile=localProfiles.find(p=>p.profile===query.get('profile'));
 if(!profile||query.getAll('profile').length!==1||[...query.keys()].some(k=>k!=='profile'))return reply({error:'Invalid removal request.'},400);
 try{
  const host=await localHostRequest('/host/status',{});if(host.status!==200)throw Error('host-unavailable');
  const instanceId=removalUUID.parse((host.body as {instanceId:unknown}).instanceId);
  const fields={instanceId,packageId:profile.packageId,manifest:profile.manifest};
  const result=await localHostRequest('/host/removal/review',{owner:ctx.owner,...fields});if(result.status!==200)throw Error('review-unavailable');
  const review=removalReviewSchema.parse((result.body as {review:unknown}).review);
  if(review.instanceId!==instanceId||review.packageId!==profile.packageId||review.manifest!==profile.manifest)throw Error('review-identity-changed');
  const row=await rpc('read_local_model_removal',{p_owner:ctx.owner,p_key:null,p_instance:instanceId,p_package:profile.packageId});
  if(row)verifyRow(row,ctx.owner!,fields);
  return reply({ownerId:ctx.owner,review,operation:row?await status(ctx.owner!,row):null});
 }catch(error){return reply({error:error instanceof RemovalError?error.message:'Removal review is unavailable. Start the same Kavero host and retry.'},error instanceof RemovalError?error.status:503);}
}
export async function localRemovalPOST(request:Request){
 if(!localUIEnabled())return reply({error:'Local generation is not enabled.'},404);
 const ctx=await context();if(ctx.response)return ctx.response;
 let body:z.infer<typeof mutation>;
 try{
  const reader=request.body?.getReader();let bytes=Buffer.alloc(0);
  if(reader)try{while(true){const chunk=await reader.read();if(chunk.done)break;if(bytes.length+chunk.value.length>1024){await reader.cancel();return reply({error:'Removal request too large.'},413);}bytes=Buffer.concat([bytes,chunk.value]);}}finally{reader.releaseLock();}
  body=mutation.parse(JSON.parse(bytes.toString('utf8')));
  if(!localProfiles.some(p=>p.packageId===body.packageId&&p.manifest===body.manifest))throw Error('unverified-package');
 }catch{return reply({error:'Invalid removal request.'},400);}
 try{
  let row=await rpc('begin_local_model_removal',{p_owner:ctx.owner,p_key:body.key,p_instance:body.instanceId,p_package:body.packageId,p_manifest:body.manifest});
  if(!row)throw Error('missing-removal');verifyRow(row,ctx.owner!,body);
  if(row.state==='removed')return reply({ownerId:ctx.owner,operation:await status(ctx.owner!,row)});
  const result=await localHostRequest('/host/removal/start',hostBody(ctx.owner!,row));
  if(result.status===409&&(result.body as {instanceId?:unknown;rejected?:unknown}).rejected===true&&(result.body as {instanceId?:unknown}).instanceId===row.instance_id){
   row=await rpc('refuse_local_model_removal',{p_owner:ctx.owner,p_id:row.id});if(!row)throw Error('missing-removal');
   return reply({error:'Removal was refused. Finish local setup or jobs, and check whether another account uses this model.',ownerId:ctx.owner,operation:waiting(row)},409);
  }
  if(![200,202].includes(result.status))throw new RemovalError(503,'Removal could not be confirmed. Retry the same operation; its admission guard remains active.');
  return reply({ownerId:ctx.owner,operation:await reconcile(ctx.owner!,row,(result.body as {operation:unknown}).operation)},result.status);
 }catch(error){return reply({error:error instanceof RemovalError?error.message:'Removal acknowledgement is incomplete. Retry the same operation.'},error instanceof RemovalError?error.status:503);}
}
