const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const REMOVAL_PATHS=['/host/removal/review','/host/removal/start','/host/removal/status'];
export class RemovalWire {
 constructor(native){
  this.native=native;this.db=native.db;
  this.db.exec(`CREATE TABLE IF NOT EXISTS removal_requests(id TEXT PRIMARY KEY,owner TEXT NOT NULL,submission_key TEXT NOT NULL,package_id TEXT NOT NULL,manifest TEXT NOT NULL,instance_id TEXT NOT NULL,app_fence TEXT NOT NULL,UNIQUE(owner,submission_key));
   CREATE TRIGGER IF NOT EXISTS frozen_removal_request BEFORE UPDATE ON removal_requests BEGIN SELECT RAISE(ABORT,'removal-request-immutable'); END;`);
 }
 validate(body,fields){
  if(!body||Object.keys(body).sort().join(',')!==fields||!uuid(body.owner)||!uuid(body.instanceId)||body.instanceId!==this.native.config.instanceId||!digest(body.manifest))throw Error('invalid-removal-request');
  const manager=this.native.manager(body.packageId);if(manager.verified.hash!==body.manifest)throw Error('removal-manifest-changed');return manager;
 }
 status(binding,{pendingStart=false}={}){
  const result=this.native.remover.status(binding.owner,binding.id);if(!result)throw Error('removal-not-found');
  const guard=this.db.prepare("SELECT operation FROM activation_guard WHERE slot=1 AND purpose='removal'").get();
  const idle=!this.native.busy&&!this.native.remover.store.db.prepare('SELECT operation FROM writer WHERE slot=1').get();
  return {...result,state:!pendingStart&&idle&&['admitted','removing'].includes(result.state)?'interrupted':result.state,packageId:binding.package_id,instanceId:binding.instance_id,appFence:binding.app_fence,key:binding.submission_key,
   complete:result.state==='removed'&&guard?.operation!==binding.id};
 }
 async handle(url,body){
  const start=url==='/host/removal/start',status=url==='/host/removal/status';
  this.validate(body,start||status?'appFence,instanceId,key,manifest,owner,packageId':'instanceId,manifest,owner,packageId');
  if(!start&&!status){
   let canRemove=false,reclaimableBytes=0,retainedBytes=0,reason=null,accountOnly=false;
   try{this.native.assertIdle();if(this.native.blocking)throw Error('removal-native-busy');
    const manager=this.native.manager(body.packageId),plan=await this.native.remover.plan(body.owner,manager.verified,()=>this.native.remover.files.check(),{verifyBytes:false});
    reclaimableBytes=plan.files.reduce((n,f)=>n+f.bytes,0);retainedBytes=plan.retained.reduce((n,f)=>n+f.bytes,0);accountOnly=plan.accountOnly===true;canRemove=true;
   }catch(error){reason=['removal-not-owned','removal-other-owner'].includes(error.message)?error.message:'removal-busy-or-changed';}
   return {status:200,body:{review:{instanceId:body.instanceId,packageId:body.packageId,manifest:body.manifest,scope:'managed-delivery',canRemove,reclaimableBytes,retainedBytes,accountOnly,reason}}};
  }
  if(!uuid(body.key)||!uuid(body.appFence))throw Error('invalid-removal-request');
  let binding=this.db.prepare('SELECT * FROM removal_requests WHERE owner=? AND submission_key=?').get(body.owner,body.key);
  if(binding&&(binding.package_id!==body.packageId||binding.manifest!==body.manifest||binding.instance_id!==body.instanceId||binding.app_fence!==body.appFence))throw Error('removal-idempotency-conflict');
  if(status)return binding?{status:200,body:{operation:this.status(binding)}}:{status:404,body:{error:'removal-not-found'}};
  try{
   // No awaiting between admission and immutable request binding. A crash in
   // between is recovered by the same owner/key on explicit retry.
   const op=this.native.admit({owner:body.owner,key:body.key,packageId:body.packageId});
   if(!binding){this.db.prepare('INSERT INTO removal_requests VALUES(?,?,?,?,?,?,?)').run(op.id,body.owner,body.key,body.packageId,body.manifest,body.instanceId,body.appFence);binding=this.db.prepare('SELECT * FROM removal_requests WHERE id=?').get(op.id);}
   const operation=this.status(binding,{pendingStart:true});
   // Always reconcile native guard cleanup, including terminal lost-ack replay.
   setImmediate(()=>this.native.run(body.owner,op.id).catch(()=>{}));
   return {status:202,body:{operation}};
  }catch(error){
   const admitted=this.native.remover.store.db.prepare('SELECT id FROM removals WHERE owner=? AND submission_key=?').get(body.owner,body.key);
   if(!admitted&&['removal-native-busy','removal-not-owned','removal-other-owner','install-destination-busy','install-removal-pending','worker-maintenance-conflict','removal-journal-full'].includes(error.message))return {status:409,body:{rejected:true,error:error.message}};
   throw error;
  }
 }
}
