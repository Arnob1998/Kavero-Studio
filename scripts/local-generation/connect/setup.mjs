// Setup is separate from inference. Only pinned recipes and explicit local consent.
import {randomUUID} from 'node:crypto';
import {canonicalSnapshot,jobSnapshotForProfile} from '../../../src/modules/model-providers/local/job-snapshot.ts';
import {digest} from '../../../src/modules/model-providers/local/connect/protocol.ts';
import {noticesForSetup} from './approval.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const number=v=>Number.isSafeInteger(v)&&v>=0&&v<=2**50;
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===names.split(',').sort().join(',');
const terminal=new Set(['ready','assessed','cancelled','failed','rejected','expired']);
const states=['requested','delivered','awaiting-approval','approved','admitted','downloading','verifying','activation-needed',...terminal,'cancelling','interrupted'];
export const SETUP_PROFILES=['qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation'];
export function validateSetupRequest(r,client){
 const i=r?.intent;
 if(!keys(r,'id,deviceId,key,kind,intent,intentHash,state,cancelRequested,processedBytes,operationId,evidence,reason,createdAt,expiresAt,version,ownerId,session,token,attempt,sequence,phase,leaseUntil,reconcile')
  ||!keys(i,'setupProtocol,ownerId,origin,deviceId,installationId,keyVersion,profile,manifestHash,termsDigest,purpose,recipeHash')
  ||![r.id,r.deviceId,r.key,r.ownerId,r.session,r.token,i.installationId].every(uuid)||!['assess','install'].includes(r.kind)
  ||!states.includes(r.state)||typeof r.cancelRequested!=='boolean'||!number(r.processedBytes)||r.operationId!==null&&!uuid(r.operationId)
  ||r.reconcile!==true||![r.version,r.attempt].every(v=>Number.isSafeInteger(v)&&v>0)||!Number.isSafeInteger(r.sequence)||r.sequence<0||!Number.isInteger(r.phase)||r.phase<0||r.phase>7
  ||![r.createdAt,r.expiresAt,r.leaseUntil].every(v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v)))
  ||r.reason!==null&&(typeof r.reason!=='string'||r.reason.length>80)
  ||i.setupProtocol!==1||!Number.isSafeInteger(i.keyVersion)||i.keyVersion<1||!SETUP_PROFILES.includes(i.profile)
  ||i.ownerId!==r.ownerId||i.deviceId!==r.deviceId||r.ownerId!==client.identity?.approvedOwner||r.deviceId!==client.identity?.deviceId
  ||client.identity?.approvedDeviceId!==r.deviceId||i.installationId!==client.identity?.installationId||i.origin!==client.origin
  ||!hash(r.intentHash)||digest(canonicalSnapshot(i))!==r.intentHash)throw Error('connect-setup-invalid');
 const recipe=jobSnapshotForProfile(i.profile);
 if(i.manifestHash!==recipe.manifestHash||i.recipeHash!==digest(canonicalSnapshot(recipe)))throw Error('connect-model-changed');
 noticesForSetup({manifest:i.manifestHash,termsDigest:i.termsDigest,purpose:i.purpose},i.profile);
 if(r.evidence!==null){
  const e=r.evidence;
  if(!keys(e,'capturedAt,manifestHash,compatibility,totalVramMiB,freeVramMiB,totalRamBytes,freeRamBytes,freeDiskBytes,requiredFreeBytes,installed')
   ||e.manifestHash!==i.manifestHash||typeof e.capturedAt!=='string'||e.capturedAt.length>40||!Number.isFinite(Date.parse(e.capturedAt))
   ||!['eligible','windows-only','multiple-gpus','gpu-unverified','gpu-too-small','ram-too-small','check-unavailable'].includes(e.compatibility)
   ||!['totalVramMiB','freeVramMiB','totalRamBytes','freeRamBytes','freeDiskBytes','requiredFreeBytes'].every(k=>e[k]===null||number(e[k]))
   ||e.installed!==null&&typeof e.installed!=='boolean')throw Error('connect-setup-invalid');
 }
 return r;
}
export class SetupClient {
 constructor(client){this.client=client;this.session=client.epoch;}
 validate(reply){
  if(reply.version!==1||reply.setupProtocol!==1||reply.deviceId!==this.client.identity?.deviceId||reply.origin!==this.client.origin||reply.generationEnabled!==false)throw Error('connect-setup-invalid');
  if(reply.request!==null)validateSetupRequest(reply.request,this.client);return reply.request;
 }
 async poll(recoverId){return this.validate(await this.client.action({action:'setup-poll',setupProtocol:1,session:this.session,approvedOwner:this.client.identity.approvedOwner,profiles:SETUP_PROFILES,...(recoverId?{recoverId}:{})}));}
 async checkpoint(input){
  const allowed=new Set('action,setupProtocol,session,id,token,attempt,sequence,intentHash,state,processedBytes,operationId,evidence,approval,reason'.split(','));
  if(!input||input.action!=='setup-checkpoint'||input.setupProtocol!==1||Object.keys(input).some(k=>!allowed.has(k))||![input.session,input.id,input.token].every(uuid)
   ||!hash(input.intentHash)||!['attempt','sequence'].every(k=>Number.isSafeInteger(input[k])&&input[k]>0)||!number(input.processedBytes)||!states.includes(input.state)
   ||Buffer.byteLength(JSON.stringify(input))>8192)throw Error('connect-setup-invalid');
  return this.validate(await this.client.action(input));
 }
}
export class RemoteSetup {
 constructor({transport,client,state=null,save,now=Date.now}){
  Object.assign(this,{transport,client,save,now});this.available=false;
  if(state&&(!keys(state,'schema,request,key,publicKeyHash,approved,operationId,pending,hold,localCancel,settled')||state.schema!==1||!uuid(state.key)||!hash(state.publicKeyHash)
   ||!['approved','hold','localCancel','settled'].every(k=>typeof state[k]==='boolean')||state.operationId!==null&&!uuid(state.operationId)
   ||!state.request||!hash(state.request.intentHash)))throw Error('connect-controller-state-invalid');
  this.state=state?structuredClone(state):null;
  // Restart pauses fresh admission, but keeps already accepted native work recoverable.
  if(this.state){this.state.hold=true;this.persist();}
 }
 persist(){this.save(this.state?structuredClone(this.state):null);}
 active(){return !!this.state&&!this.state.settled;}
 hold(){if(this.active()){this.state.hold=true;this.persist();}}
 view(){if(!this.state)return null;const s=this.state,r=s.request;return {id:r.id,origin:r.intent.origin,owner:r.ownerId,profile:r.intent.profile,state:r.state,processedBytes:r.processedBytes,cancelRequested:r.cancelRequested||s.localCancel,operationId:s.operationId,needsApproval:!s.settled&&(!s.approved||s.hold)&&(!s.operationId||r.state==='interrupted'),settled:s.settled};}
 verify(r){validateSetupRequest(r,this.client);if(this.active()&&this.state.publicKeyHash!==digest(this.client.identity.publicKey))throw Error('connect-approval-stale');}
 async review(n){
  if(!this.active())throw Error('connect-setup-unavailable');const r=this.state.request;this.verify(r);
  const setup=await n.setup(r.intent.profile);this.checkModel(setup,r);return {requestId:r.id,intentHash:r.intentHash,profile:r.intent.profile,setup};
 }
 approve(id,intentHash){
  const s=this.state;if(!this.active()||s.request.id!==id||s.request.intentHash!==intentHash||s.request.cancelRequested||s.localCancel)throw Error('connect-approval-stale');
  this.verify(s.request);s.approved=true;s.hold=false;this.persist();
 }
 cancel(){if(this.active()){this.state.localCancel=true;this.state.hold=true;this.persist();}}
 checkModel(setup,r){if(setup.manifest!==r.intent.manifestHash||setup.termsDigest!==r.intent.termsDigest||setup.purpose!==r.intent.purpose)throw Error('connect-model-changed');}
 async send(state,extra={}){
  const s=this.state,r=s.request;
  s.pending={action:'setup-checkpoint',setupProtocol:1,session:r.session,id:r.id,token:r.token,attempt:r.attempt,sequence:r.sequence+1,intentHash:r.intentHash,state,processedBytes:Math.max(r.processedBytes,extra.processedBytes??0),...(s.operationId?{operationId:s.operationId}:{}),...extra};
  this.persist();return this.flush();
 }
 async flush(){
  const s=this.state,p=s.pending;
  if(!p||p.action!=='setup-checkpoint'||p.id!==s.request.id||p.intentHash!==s.request.intentHash||p.token!==s.request.token||p.attempt!==s.request.attempt
   ||p.session!==s.request.session||p.operationId!==undefined&&p.operationId!==s.operationId)throw Error('connect-controller-state-invalid');
  const r=await this.transport.checkpoint(p);this.verify(r);if(r.id!==s.request.id||r.intentHash!==s.request.intentHash)throw Error('connect-setup-invalid');s.request=r;s.pending=null;s.settled=terminal.has(r.state);this.persist();return r;
 }
 async tick(n,{canAdmit=()=>true}={}){
  let r;try{r=await this.transport.poll(this.active()?this.state.request.id:undefined);this.available=true;}catch(error){if(error.status===404&&!this.active()){this.available=false;return;}throw error;}
  if(!r){
   // A lost terminal acknowledgement can leave a local pending checkpoint.
   // Retry it only if it was terminal; never infer native cancellation from silence.
   if(this.active()&&this.state.pending&&terminal.has(this.state.pending.state)){await this.flush();}
   else if(this.active())throw Error('connect-recovery-required');return;
  }
  this.verify(r);
  if(this.active()&&(this.state.request.id!==r.id||this.state.request.intentHash!==r.intentHash))throw Error('connect-recovery-required');
  if(!this.active()){
   if(r.phase>=2||r.operationId)throw Error('connect-recovery-required');
   this.state={schema:1,request:r,key:randomUUID(),publicKeyHash:digest(this.client.identity.publicKey),approved:false,operationId:null,pending:null,hold:true,localCancel:false,settled:false};this.persist();
  }
  const s=this.state,old=s.request;s.request=r;
  if(terminal.has(r.state)){s.pending=null;s.settled=true;this.persist();return;}
  if(s.pending&&(old.token!==r.token||old.attempt!==r.attempt||r.cancelRequested&&!['cancelling','cancelled','failed','interrupted'].includes(s.pending.state)))s.pending=null;
  this.persist();if(s.pending){await this.flush();return;}
  // Always resolve the original key before any new admission or cancellation.
  const receipt=await n.setupReceipt(s.key);
  if(receipt){if(!uuid(receipt.id)||s.operationId&&s.operationId!==receipt.id||r.operationId&&r.operationId!==receipt.id)throw Error('connect-recovery-required');s.operationId=receipt.id;this.persist();}
  if(s.operationId&&!receipt)throw Error('connect-recovery-required');
  const setup=await n.setup(r.intent.profile);this.checkModel(setup,r);
  if(receipt&&receipt.packageId!==noticesForSetup(setup,r.intent.profile).id)throw Error('connect-model-changed');
  if(r.cancelRequested||s.localCancel){
   if(!receipt){await this.send('cancelled');return;}
   if(receipt.state==='cancelled'){await this.send('cancelled');return;}
   if(['installed','activation-needed','activation-failed','activating'].includes(receipt.state)){await this.send('failed',{reason:'cancel-unconfirmed'});return;}
   await n.cancelSetup(receipt.id);await this.send('cancelling');return;
  }
  if(r.kind==='assess'){
   const h=setup.hardware??{},nullable=v=>number(v)?v:null;
   await this.send('assessed',{evidence:{capturedAt:new Date(this.now()).toISOString(),manifestHash:setup.manifest,compatibility:setup.compatibility??'check-unavailable',totalVramMiB:nullable(h.totalVramMiB),freeVramMiB:nullable(h.freeVramMiB),totalRamBytes:nullable(h.totalRamBytes),freeRamBytes:nullable(h.freeRamBytes),freeDiskBytes:nullable(setup.freeBytes),requiredFreeBytes:nullable(setup.requiredFreeBytes),installed:typeof setup.installed==='boolean'?setup.installed:null}});return;
  }
  if(setup.switchRequired&&!receipt){await this.send('rejected',{reason:'unsupported-runtime'});return;}
  if(!s.approved){if(r.state==='delivered')await this.send('awaiting-approval');return;}
  if(r.state==='delivered'){await this.send('awaiting-approval');return;}
  if(r.state==='awaiting-approval'){
   await this.send('approved',{approval:{ownerId:r.ownerId,deviceId:r.deviceId,intentHash:r.intentHash,manifestHash:r.intent.manifestHash,termsDigest:r.intent.termsDigest,accepted:true}});return;
  }
  if(!receipt){
   if(s.hold||!canAdmit()||n.pending())return;
   // Mapping and approval are durable BEFORE the existing installer receives this key.
   if(!setup.available||!setup.supported)return;
   const result=await n.install({...setup,key:s.key});const admitted=result?.operation;
   if(!admitted||!uuid(admitted.id)||admitted.packageId!==noticesForSetup(setup,r.intent.profile).id)throw Error('connect-recovery-required');
   s.operationId=admitted.id;this.persist();await this.send('admitted');return;
  }
  if(r.state==='approved'){await this.send('admitted');return;}
  if(['failed','activation-failed'].includes(receipt.state)){await this.send('failed',{reason:'setup-failed'});return;}
  if(receipt.state==='cancelled'){await this.send('cancelled');return;}
  if(receipt.state==='cancelling'){await this.send('cancelling');return;}
  if(receipt.state==='interrupted'){
   if(r.state!=='interrupted'){s.hold=true;this.persist();await this.send('interrupted');return;}
   if(!s.hold&&canAdmit()&&!n.pending()){
    const retry=await n.install({...setup,key:s.key});if(retry?.operation?.id!==s.operationId)throw Error('connect-recovery-required');
   }
   return;
  }
  if(receipt.state==='installed'&&setup.ready){
   const ready=await n.adapter.readiness(r.ownerId);
   if(!ready.ready||ready.binding?.permission!==true||ready.binding.profile!==r.intent.profile)throw Error('connect-model-not-ready');
   await this.send('ready',{processedBytes:Math.max(r.processedBytes,receipt.processedBytes??0)});return;
  }
  // Publish monotonically through phases even when native work finishes between polls.
  const phase=['admitted','downloading','verifying','activation-needed'];const index=r.state==='interrupted'?Math.min(3,r.phase-3):phase.indexOf(r.state);
  if(index<0)throw Error('connect-recovery-required');
  const desired=['activation-needed','activating','staged','installed'].includes(receipt.state)?3:receipt.state==='verifying'?2:receipt.state==='downloading'?1:0;
  const next=Math.min(index+1,Math.max(index,desired));
  await this.send(phase[next],{processedBytes:Math.max(r.processedBytes,receipt.processedBytes??0)});
 }
}
