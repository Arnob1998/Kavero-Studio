// Private Connect adapter to the ONE existing loopback host/worker. No process launch.
import {readFileSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {hostControl,signControl} from '../host/control.mjs';
import {digest} from '../../../src/modules/model-providers/local/connect/protocol.ts';
import {canonicalSnapshot,jobSnapshotForProfile} from '../../../src/modules/model-providers/local/job-snapshot.ts';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const terminal=new Set(['generated-unvalidated','failed','cancelled']);
function privateJSON(file){const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>8192)throw Error('connect-local-config-invalid');return JSON.parse(readFileSync(file,'utf8'));}
export class NativeAdapter {
 constructor(configFile,{fetchImpl=fetch}={}){
  this.config=privateJSON(configFile);this.fetch=fetchImpl;
  if(this.config.port!==8792||!uuid(this.config.instanceId)||!/^[a-f0-9]{64}$/.test(this.config.secret)||!path.isAbsolute(this.config.root))throw Error('connect-local-config-invalid');
 }
 async worker(route,body={}){
  if(!['/ready','/status','/submit','/cancel','/lease','/lease/renew','/lease/release','/saved'].includes(route))throw Error('connect-local-operation-invalid');
  const config=privateJSON(path.join(this.config.root,'generation','worker-config.json'));
  if(config.port!==8791||config.secret!==this.config.secret)throw Error('connect-local-config-invalid');
  const encoded=JSON.stringify(body),r=await this.fetch('http://127.0.0.1:8791'+route,{method:'POST',headers:{'content-type':'application/json',...signControl(config.secret,route,encoded)},body:encoded,redirect:'error',signal:AbortSignal.timeout(15000)});
  let bytes=Buffer.alloc(0);for await(const chunk of r.body){if(bytes.length+chunk.length>16384)throw Error('connect-local-response-limit');bytes=Buffer.concat([bytes,chunk]);}
  const result=JSON.parse(bytes);if(!r.ok){const error=Error(result.error??'connect-local-unavailable');error.status=r.status;throw error;}return result;
 }
 async permission(owner,profile){
  const packageId=profile==='qwen-image-2.1-q3-evaluation'?'qwen-2-1-q3-internal-evaluation':profile==='qwen-image-2.1-q4-evaluation'?'qwen-2-1-internal-evaluation':null;
  if(!uuid(owner)||!packageId)throw Error('connect-owner-invalid');
  return (await hostControl(this.config,'/host/setup/permission',{owner,packageId},this.fetch)).allowed===true;
 }
 async output(owner,id,ledgerIdentity,token){
  const encoded=JSON.stringify({owner,id,ledgerIdentity,token});
  const r=await this.fetch('http://127.0.0.1:8791/output',{method:'POST',body:encoded,headers:signControl(this.config.secret,'/output',encoded),redirect:'error',signal:AbortSignal.timeout(15000)});
  if(!r.ok||r.headers.get('content-type')!=='image/png'){await r.body?.cancel();throw Error('connect-native-output-unavailable');}
  const chunks=[];let size=0;for await(const chunk of r.body){size+=chunk.length;if(size>32*1024*1024)throw Error('connect-native-output-limit');chunks.push(chunk);}return Buffer.concat(chunks);
 }
 async readiness(owner){
  const status=await hostControl(this.config,'/host/status',{},this.fetch);
  if(status.code!==this.config.code)throw Error('connect-host-code-changed');
  if(!status.inferenceReady)throw Error('connect-native-not-ready');
  const ready=await this.worker('/ready');
  const profile=['qwen-image-2.1-q3-evaluation','qwen-image-2.1-q4-evaluation'].find(p=>jobSnapshotForProfile(p).packageFingerprint===ready.packageFingerprint);
  if(!profile||!uuid(ready.epoch)||!uuid(ready.ledgerIdentity)||typeof ready.deviceId!=='string')throw Error('connect-native-identity-invalid');
  return {ready,binding:{profile,workerEpoch:ready.epoch,ledgerIdentity:ready.ledgerIdentity,executionDevice:digest(ready.deviceId),permission:await this.permission(owner,profile),maintenance:false}};
 }
}
export class ExecutionJournal {
 constructor(filename){this.db=new DatabaseSync(filename);this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS execution(id TEXT PRIMARY KEY,owner TEXT NOT NULL,frozen TEXT NOT NULL,attempted INTEGER NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'prepared',reason TEXT)");
  const columns=this.db.prepare('pragma table_info(execution)').all().map(c=>c.name);if(!columns.includes('saved'))this.db.exec('ALTER TABLE execution ADD COLUMN saved INTEGER NOT NULL DEFAULT 0');if(!columns.includes('attempt'))this.db.exec('ALTER TABLE execution ADD COLUMN attempt INTEGER NOT NULL DEFAULT 1');if(!columns.includes('transferred'))this.db.exec('ALTER TABLE execution ADD COLUMN transferred INTEGER NOT NULL DEFAULT 0');if(!columns.includes('transfer_after'))this.db.exec('ALTER TABLE execution ADD COLUMN transfer_after INTEGER NOT NULL DEFAULT 0');}
 get(id){return this.db.prepare('SELECT * FROM execution WHERE id=?').get(id);}
 prepare(job){
  const frozen=canonicalSnapshot({owner:job.owner,key:job.key,payload:job.payload,binding:job.binding});
  this.db.prepare('INSERT OR IGNORE INTO execution(id,owner,frozen) VALUES(?,?,?)').run(job.id,job.owner,frozen);
  const row=this.get(job.id);if(row.owner!==job.owner||row.frozen!==frozen)throw Error('connect-local-intent-conflict');this.db.prepare('UPDATE execution SET attempt=max(attempt,?) WHERE id=?').run(job.attempt,job.id);return this.get(job.id);
 }
 attempted(id){this.db.prepare('UPDATE execution SET attempted=1 WHERE id=?').run(id);}
 state(id,state,reason=null){this.db.prepare('UPDATE execution SET state=?,reason=? WHERE id=?').run(state,reason,id);}
 outstanding(){return this.db.prepare("SELECT * FROM execution WHERE attempted=1 AND state NOT IN ('generated-unvalidated','failed','cancelled','rejected')").all();}
 close(){this.db.close();}
}
export class NativeExecutor {
 constructor({owner,adapter,journal}){if(!uuid(owner))throw Error('connect-owner-invalid');Object.assign(this,{owner,adapter,journal});}
 async execute(job,{admit=true,canAdmit=()=>true}={}){
  this.reason=null;
  if(job.owner!==this.owner||job.payload.execute!==true)throw Error('connect-owner-or-mode-mismatch');
  const prior=this.journal.get(job.id);
  // A lost local journal or a reinstalled PC must not recreate ambiguous work.
  if(!prior&&(job.attempt>1||job.state!=='delivered'))return 'submission-unknown';
  const row=this.journal.prepare(job);if(terminal.has(row.state)||row.state==='rejected'){this.reason=row.reason;return row.state;}let native;
  try{native=await this.adapter.worker('/status',{id:job.id,owner:this.owner});}
  catch(error){if(error.status!==404)return 'submission-unknown';}
  if(native){
   if(native.id!==job.id||native.ledgerIdentity!==job.binding.ledgerIdentity||native.requestHash!==job.payload.hash||native.submissionKey!==job.key||native.packageFingerprint!==job.payload.recipeSnapshot.packageFingerprint||digest(native.executionDevice??'')!==job.binding.executionDevice)return 'submission-unknown';
   if(job.cancelRequested&&!terminal.has(native.state)){
    try{native=await this.adapter.worker('/cancel',{id:job.id,owner:this.owner});}
    catch{return 'submission-unknown';}
    if(native.id!==job.id||native.ledgerIdentity!==job.binding.ledgerIdentity||native.requestHash!==job.payload.hash||native.submissionKey!==job.key||native.packageFingerprint!==job.payload.recipeSnapshot.packageFingerprint||digest(native.executionDevice??'')!==job.binding.executionDevice)return 'submission-unknown';
   }
   const state=terminal.has(native.state)?native.state:native.state==='running'?'running':native.state==='queued'?(job.state==='running'||row.state==='running'?'submission-unknown':'accepted'):'submission-unknown';
   this.journal.state(job.id,state);return state;
  }
  if(job.cancelRequested){if(row.attempted)return 'submission-unknown';this.journal.state(job.id,'cancelled');return 'cancelled';}
  // Pausing still reconciles existing native work above. A delivered job whose
  // submit has not started must wait for Resume, including a lost poll reply.
  if(!admit||!canAdmit())return row.attempted?'submission-unknown':job.state;
  let current;try{current=await this.adapter.readiness(this.owner);}catch{this.reason='worker-unavailable';if(!row.attempted)this.journal.state(job.id,'rejected',this.reason);return row.attempted?'submission-unknown':'rejected';}
  const {execute,...binding}=job.binding;
  if(canonicalSnapshot({...current.binding,recipeSnapshot:job.payload.recipeSnapshot})!==canonicalSnapshot(binding)){this.reason=current.binding.permission?'identity-changed':'permission-denied';if(!row.attempted)this.journal.state(job.id,'rejected',this.reason);return row.attempted?'submission-unknown':'rejected';}
  if(!current.binding.permission){this.reason='permission-denied';return row.attempted?'submission-unknown':'rejected';}
  // Persist BEFORE submit. A lost acknowledgement can only reconcile original ID/key.
  if(!canAdmit())return row.attempted?'submission-unknown':job.state;
  this.journal.attempted(job.id);
  try{
   native=await this.adapter.worker('/submit',{id:job.id,owner:this.owner,key:job.key,hash:job.payload.hash,intent:job.payload.intent,recipeSnapshot:job.payload.recipeSnapshot,
    epoch:current.ready.epoch,ledgerIdentity:job.binding.ledgerIdentity,fingerprint:job.payload.recipeSnapshot.packageFingerprint,device:current.ready.deviceId});
   if(native.id!==job.id||native.ledgerIdentity!==job.binding.ledgerIdentity||native.requestHash!==job.payload.hash||native.submissionKey!==job.key||native.packageFingerprint!==job.payload.recipeSnapshot.packageFingerprint||digest(native.executionDevice??'')!==job.binding.executionDevice)return 'submission-unknown';
   this.journal.state(job.id,terminal.has(native.state)?native.state:'accepted');return terminal.has(native.state)?native.state:'accepted';
  }catch(error){
   // Explicit queue/staging rejection proves no admission; transport errors do not.
   if([429,507].includes(error.status)){this.reason=error.status===429?'queue-full':'staging-full';this.journal.state(job.id,'rejected',this.reason);return 'rejected';}
   return 'submission-unknown';
  }
 }
 async stopOwned(){
  for(const row of this.journal.outstanding()){
   if(row.owner!==this.owner)continue;
   try{const job=JSON.parse(row.frozen),status=await this.adapter.worker('/status',{id:row.id,owner:row.owner});
    if(status.ledgerIdentity!==job.binding.ledgerIdentity||status.requestHash!==job.payload.hash||status.submissionKey!==job.key||digest(status.executionDevice??'')!==job.binding.executionDevice)continue;
    const result=terminal.has(status.state)?status:await this.adapter.worker('/cancel',{id:row.id,owner:row.owner});
    if(terminal.has(result.state))this.journal.state(row.id,result.state);
   }catch{/* Offline or dispatching: next bounded iteration retries, never global kill. */}
  }
 }
}
export class ExecutionRunner {
 constructor({delivery,executor}){if(!delivery.execution)throw Error('connect-execution-mode-required');Object.assign(this,{delivery,executor});}
 async tick({admit=true,canAdmit=()=>true}={}){
  let candidate=null;if(admit)try{candidate=(await this.executor.adapter.readiness(this.executor.owner)).binding;}catch{}
  if(!canAdmit())candidate=null;
  let reply;try{reply=await this.delivery.poll(candidate);}catch(error){if(error.status===401)await this.executor.stopOwned();throw error;}
  if(reply.ownerId!==this.executor.owner)throw Error('connect-approved-owner-mismatch');
  if(!reply.job)return reply;
  const state=await this.executor.execute(reply.job,{admit,canAdmit});
  if(state===reply.job.state)return reply;
  try{return await this.delivery.checkpoint(reply.job,state,reply.job.sequence+1,this.executor.reason);}catch(error){if(error.status===401)await this.executor.stopOwned();throw error;}
 }
}
