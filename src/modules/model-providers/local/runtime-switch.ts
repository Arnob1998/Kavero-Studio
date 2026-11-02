import {createAdminClient} from "@/lib/supabase/admin";
import {getLocalReadiness} from "./bridge";
import {localHostRequest} from "./host-bridge";
import {existingJobSnapshot,q3JobSnapshot} from "./job-snapshot";
import {z} from "zod";

const digest=z.string().regex(/^[a-f0-9]{64}$/);
const nativeUUID=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
const identity=z.object({packageFingerprint:digest,deviceId:z.string().min(1).max(256),ledgerIdentity:z.string().uuid()}).strict();
const operation=z.object({id:z.string().uuid(),packageId:z.string(),state:z.enum(["admitted","verifying","starting","installed","cancelled","failed","interrupted"]),error:z.string().nullable()});
export type ManagedActivation=z.infer<typeof operation>;
const record=z.object({id:z.string().uuid(),owner_id:z.string().uuid(),submission_key:z.string().uuid(),target_package_id:z.string(),target_fingerprint:digest,
 original_identity:identity,state:z.enum(["pending","installed","rolled-back"]),host_operation:z.string().uuid().nullable()});
type SwitchRecord=z.infer<typeof record>;
const pinnedPackage="qwen-2-1-internal-evaluation";
export class LocalSwitchError extends Error {
 constructor(readonly status:number,message:string){super(message);}
}
async function rpc(name:string,args:Record<string,unknown>,nullable=false):Promise<SwitchRecord|null>{
 const {data,error}=await createAdminClient().rpc(name,args);
 if(error){
  if(/local-runtime-switching|local-jobs-outstanding|local-runtime-identity-changed|local-switch-idempotency-conflict/.test(error.message))throw new LocalSwitchError(409,"Local jobs or another switch require recovery. Retry the same operation.");
  throw new LocalSwitchError(503,"Local switch storage is unavailable.");
 }
 const value=Array.isArray(data)?data[0]:data;
 // PostgreSQL nullable composite results may encode as an all-null object.
 if(nullable&&(!value||value.id==null))return null;
 return record.parse(value);
}
async function observed(){const ready=await getLocalReadiness();return identity.parse({packageFingerprint:ready.packageFingerprint,deviceId:ready.deviceId,ledgerIdentity:ready.ledgerIdentity});}
async function settle(owner:string,row:SwitchRecord,op:ManagedActivation){
 if(row.owner_id!==owner||row.target_package_id!==op.packageId||row.host_operation!==op.id)throw new LocalSwitchError(503,"Local switch identity changed.");
 if(row.state!=="pending"||!["installed","cancelled","failed","interrupted"].includes(op.state))return;
 // A failure/timeout alone never releases the fence. The actual restored or
 // installed runtime must be ready with the expected package, device and ledger.
 const current=await observed();
 await rpc("finish_local_runtime_switch",{p_owner:owner,p_switch:row.id,p_outcome:op.state==="installed"?"installed":"rolled-back",p_observed:current});
}
export async function reconcileLocalSwitch(owner:string,value:unknown){
 const op=operation.parse(value);
 const row=await rpc("read_local_runtime_switch",{p_owner:owner,p_key:null,p_host:op.id},true);
 if(row)await settle(owner,row,op);
 return op;
}
export async function switchManagedLocalPackage(owner:string,key:string,packageId:string){
 nativeUUID.parse(owner);nativeUUID.parse(key);
 const q3=packageId==='qwen-2-1-q3-internal-evaluation';
 if(!q3&&packageId!==pinnedPackage)throw new LocalSwitchError(403,"This package has no verified runtime recipe.");
 const target=(q3?q3JobSnapshot():existingJobSnapshot()).packageFingerprint;
 const permission=await localHostRequest('/host/setup/permission',{owner,packageId});
 if(permission.status!==200||(permission.body as {allowed?:boolean}).allowed!==true)throw new LocalSwitchError(403,"Accept this model's terms and finish its installation before switching.");
 let row=await rpc("read_local_runtime_switch",{p_owner:owner,p_key:key,p_host:null},true);
 if(row&&(row.owner_id!==owner||row.submission_key!==key||row.target_package_id!==packageId||row.target_fingerprint!==target))throw new LocalSwitchError(409,"Switch key already used for another package.");
 if(row?.state==="installed"){
  if(!row.host_operation)throw new LocalSwitchError(503,"Local switch identity changed.");
  const result=await localHostRequest("/host/activation",{owner,id:row.host_operation});
  if(result.status!==200)throw new LocalSwitchError(503,"Local switch is unavailable.");
  const op=operation.parse((result.body as {operation:unknown}).operation);
  if(op.id!==row.host_operation||op.packageId!==packageId)throw new LocalSwitchError(503,"Local switch identity changed.");
  return {status:200,body:{operation:op}};
 }
 // Retry a pending fence from its original identity even while native readiness
 // is paused. A rolled-back operation must reacquire against current readiness.
 const current=row?.state==="pending"?row.original_identity:await observed();
 row=(await rpc("begin_local_runtime_switch",{p_owner:owner,p_key:key,p_target_id:packageId,p_target:target,p_current:current}))!;
 if(row.owner_id!==owner||row.submission_key!==key||row.target_package_id!==packageId||row.target_fingerprint!==target||JSON.stringify(row.original_identity)!==JSON.stringify(current)||row.state!=="pending")throw new LocalSwitchError(503,"Local switch identity changed.");
 const appFence={id:row.id,from:row.original_identity.packageFingerprint,target:row.target_fingerprint,ledgerIdentity:row.original_identity.ledgerIdentity};
 const result=await localHostRequest("/host/activate",{owner,key,packageId,appFence});
 if(![200,202].includes(result.status)){
  // Signed rejection before admission is definite; a network/acknowledgement
  // failure throws above and intentionally keeps the durable fence for retry.
  if([400,403,409,429].includes(result.status))await rpc("finish_local_runtime_switch",{p_owner:owner,p_switch:row.id,p_outcome:"rolled-back",p_observed:await observed()});
  throw new LocalSwitchError([403,409,429].includes(result.status)?result.status:503,"Local runtime could not accept this switch. Retry the same operation.");
 }
 const op=operation.parse((result.body as {operation:unknown}).operation);
 if(op.packageId!==packageId)throw new LocalSwitchError(503,"Local switch identity changed.");
 row=(await rpc("bind_local_runtime_switch",{p_owner:owner,p_switch:row.id,p_host:op.id}))!;
 await settle(owner,row,op);
 return {status:result.status,body:{operation:op}};
}
