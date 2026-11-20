// Noninteractive desktop policy. All native execution uses the existing ledger.
import {randomUUID} from 'node:crypto';
import {digest} from '../../../src/modules/model-providers/local/connect/protocol.ts';
import {RemoteSetup} from './setup.mjs';
export const DESKTOP_PROFILES=['qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation'];
const fields={status:[],pair:['code'],'inspect-account':[],'approve-owner':['token'],model:['profile'],'accept-model':['token'],'review-remote-setup':[],'accept-remote-setup':['token'],'cancel-setup':[],pause:[],resume:[],disconnect:[],'reset-connection':[],quit:[]};
export function validateCommand(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(fields,input.command)||Object.keys(input).sort().join(',')!==['command',...fields[input.command]].sort().join(','))throw Error('connect-command-invalid');
 if(Object.values(input).some(v=>typeof v!=='string'||v.length>100))throw Error('connect-command-invalid');
 if(input.command==='pair'&&!/^[a-f0-9]{24}$/.test(input.code))throw Error('connect-code-invalid');
 if(input.profile&&!DESKTOP_PROFILES.includes(input.profile))throw Error('connect-profile-unsupported');
 return input;
}
export class DesktopController {
 constructor({client,delivery,setupTransport,state,save,openNative,now=Date.now}){
  Object.assign(this,{client,delivery,save,openNative,now});
  if(state&&(state.schema!==1||typeof state.paused!=='boolean'||state.setup!==null&&state.setup!==undefined&&(!DESKTOP_PROFILES.includes(state.setup.profile)||!['owner','key'].every(k=>typeof state.setup[k]==='string'&&/^[a-f0-9-]{36}$/i.test(state.setup[k]))||!['manifest','termsDigest'].every(k=>/^[a-f0-9]{64}$/.test(state.setup[k])))))throw Error('connect-controller-state-invalid');
  this.state={schema:1,paused:true,setup:state?.setup??null,remoteSetup:state?.remoteSetup??null};this.save(this.state);
  this.remote=setupTransport?new RemoteSetup({transport:setupTransport,client,state:this.state.remoteSetup,save:value=>{this.state.remoteSetup=value;this.save(this.state);},now}):null;
  this.native=null;this.account=null;this.terms=null;this.error=null;this.job=null;this.closed=false;this.parentLost=false;this.tail=Promise.resolve();
 }
 serial(action){const result=this.tail.then(action);this.tail=result.catch(()=>{});return result;}
 approved(){const i=this.client.identity;return !!i?.approvedOwner&&i.approvedDeviceId===i.deviceId&&!i.unpaired;}
 pause(){this.state.paused=true;this.remote?.hold();this.save(this.state);}
 view(){const i=this.client.identity;return {origin:this.client.origin,paired:!!i?.deviceId&&!i.unpaired,approved:this.approved(),paused:this.state.paused,
  fingerprint:i?.publicKey?digest(i.publicKey):null,owner:this.approved()?i.approvedOwner:null,account:this.account?{owner:this.account.owner,token:this.account.token}:null,
  model:this.modelView??null,remoteSetup:this.remote?.view()??null,job:this.job,error:this.error,closed:this.closed};}
 async ensureNative(){
  if(!this.approved())throw Error('connect-local-owner-approval-required');
  if(!this.native)this.native=await this.openNative(this.client.identity.approvedOwner);
  this.native.assert();return this.native;
 }
 async inspectAccount(){
  if(this.state.paused!==true)throw Error('connect-pause-first');
  await this.client.status({platform:'win32',arch:'x64',node:'24.11.1',ramMiB:0,gpus:[]});
  const reply=await this.delivery.poll(null);
  if(this.approved()&&reply.ownerId!==this.client.identity.approvedOwner)throw Error('connect-approved-owner-mismatch');
  this.account={owner:reply.ownerId,device:this.client.identity.deviceId,token:randomUUID(),until:this.now()+600000};
 }
 async model(profile){
  if(this.remote?.active())throw Error('connect-setup-busy');
  const n=await this.ensureNative(),setup=await n.setup(profile),notices=n.notices(setup,profile);
  this.terms={token:randomUUID(),until:this.now()+600000,profile,setup,owner:this.client.identity.approvedOwner,device:this.client.identity.deviceId};
  // Full pinned notices only; no runtime paths, credentials or user prompts.
  this.updateModel(profile,setup);
  return {token:this.terms.token,purpose:setup.purpose,manifest:setup.manifest,termsDigest:setup.termsDigest,model:this.modelView,notices};
 }
 updateModel(profile,setup){
  this.modelView={profile,available:setup.available,supported:setup.supported,ready:setup.ready,installed:setup.installed,switchRequired:setup.switchRequired===true,compatibility:setup.compatibility??'unknown',
   accepted:setup.accepted,downloadBytes:setup.downloadBytes,requiredFreeBytes:setup.requiredFreeBytes,freeBytes:setup.freeBytes,
   operation:setup.operation?{id:setup.operation.id,state:setup.operation.state,processedBytes:setup.operation.processedBytes,error:setup.operation.error}:null};
 }
 async tick(){
  if(this.closed||!this.approved())return this.view();
  try{
   const n=await this.ensureNative();
   const reply=await n.runner.tick({admit:!this.state.paused&&!this.parentLost,canAdmit:()=>!this.state.paused&&!this.parentLost});
   this.job=reply.job?{id:reply.job.id,state:reply.job.state}:null;
   await n.transfer.tick();await n.transfer.acknowledge();
   await this.remote?.tick(n,{canAdmit:()=>!this.parentLost});
   if(this.remote?.active()){const profile=this.remote.state.request.intent.profile;this.updateModel(profile,await n.setup(profile));}
   if(this.state.setup&&!this.remote?.active()){const s=await n.setup(this.state.setup.profile);this.updateModel(this.state.setup.profile,s);}this.error=null;
  }catch(error){
   if(error.status===401||error.message==='connect-approved-owner-mismatch'){this.pause();await this.native?.executor.stopOwned();}
   this.error=error.status===401?'connect-authorization-failed':'connect-recovery-required';
  }
  return this.view();
 }
 async drain(){
  this.pause();
  if(this.approved()){
   await this.tick();if(this.error)throw Error(this.error);
   const n=await this.ensureNative();
   // Even unsubmitted delivered jobs need a website cancellation receipt. They
   // must not disappear merely because the local native ledger is still empty.
   if(this.job||n.pending())throw Error('connect-drain-pending');
   if(this.remote?.active())throw Error('connect-setup-busy');
   const operation=(await n.setup(this.state.setup?.profile??DESKTOP_PROFILES[0])).operation;
   if(operation&&!['installed','activation-failed','interrupted','failed','cancelled'].includes(operation.state))throw Error('connect-setup-busy');
  }
 }
 async command(raw){
  const input=validateCommand(raw);if(this.closed)throw Error('connect-controller-closed');
  if(['pause','reset-connection','quit'].includes(input.command))this.pause(); // Persist before the next async operation.
  if(input.command==='quit')this.parentLost=true;
  return this.serial(async()=>{
   this.error=null;
   switch(input.command){
    case 'status':break;
    case 'pause':await this.tick();break;
    case 'pair':
     if(this.native)throw Error('connect-disconnect-first');
     this.pause();this.account=null;await this.client.pair(input.code);break;
    case 'inspect-account':await this.inspectAccount();break;
    case 'approve-owner':{
     const a=this.account;if(!a||a.token!==input.token||a.until<this.now()||a.device!==this.client.identity?.deviceId)throw Error('connect-approval-stale');
     const current=await this.delivery.poll(null);if(current.ownerId!==a.owner)throw Error('connect-approved-owner-mismatch');
     this.client.identity.approvedOwner=a.owner;this.client.identity.approvedDeviceId=a.device;this.client.persist();this.account=null;break;
    }
    case 'model':return {...this.view(),terms:await this.model(input.profile)};
    case 'review-remote-setup':{
     const n=await this.ensureNative(),review=await this.remote?.review(n);if(!review)throw Error('connect-setup-unavailable');
     this.terms={token:randomUUID(),until:this.now()+600000,owner:this.client.identity.approvedOwner,device:this.client.identity.deviceId,remote:review};
     this.updateModel(review.profile,review.setup);const r=this.remote.state.request;
     return {...this.view(),terms:{token:this.terms.token,purpose:review.setup.purpose,model:this.modelView,notices:n.notices(review.setup,review.profile),remote:{id:r.id,origin:r.intent.origin,owner:r.ownerId,profile:review.profile}}};
    }
    case 'accept-remote-setup':{
     const t=this.terms;if(!t?.remote||t.token!==input.token||t.until<this.now()||t.owner!==this.client.identity?.approvedOwner||t.device!==this.client.identity?.deviceId||this.parentLost)throw Error('connect-approval-stale');
     const n=await this.ensureNative(),fresh=await this.remote.review(n);if(fresh.intentHash!==t.remote.intentHash||fresh.requestId!==t.remote.requestId)throw Error('connect-approval-stale');
     if(fresh.setup.switchRequired)throw Error('connect-model-switch-unavailable');
     this.remote.approve(fresh.requestId,fresh.intentHash);this.terms=null;break;
    }
    case 'accept-model':{
     if(this.remote?.active()||this.terms?.remote)throw Error('connect-setup-busy');
     const t=this.terms;if(!t||t.token!==input.token||t.until<this.now()||t.owner!==this.client.identity?.approvedOwner||t.device!==this.client.identity?.deviceId)throw Error('connect-approval-stale');
     const n=await this.ensureNative(),fresh=await n.setup(t.profile);
     if(fresh.switchRequired)throw Error('connect-model-switch-unavailable');
     if(['manifest','termsDigest','purpose'].some(k=>fresh[k]!==t.setup[k]))throw Error('connect-model-changed');
     // Durable submission key precedes the host call. A lost acknowledgement
     // reuses the exact accepted snapshot/key, never another install attempt.
     const prior=this.state.setup;
     const key=prior&&prior.owner===this.client.identity.approvedOwner&&prior.profile===t.profile&&prior.manifest===fresh.manifest&&prior.termsDigest===fresh.termsDigest?prior.key:randomUUID();
     this.state.setup={owner:this.client.identity.approvedOwner,profile:t.profile,manifest:fresh.manifest,termsDigest:fresh.termsDigest,key};this.save(this.state);
     await n.install({...fresh,key});this.terms=null;await this.model(t.profile);break;
    }
    case 'cancel-setup':{
     if(this.remote?.active()){this.remote.cancel();break;}
     const n=await this.ensureNative(),s=await n.setup(this.state.setup?.profile??DESKTOP_PROFILES[0]);
     if(s.operation)await n.cancelSetup(s.operation.id);break;
    }
    case 'resume':{
     if(this.parentLost)throw Error('connect-parent-unavailable');
     const n=await this.ensureNative(),identity=await this.delivery.poll(null);
     if(identity.ownerId!==this.client.identity.approvedOwner)throw Error('connect-approved-owner-mismatch');
     const r=await n.adapter.readiness(this.client.identity.approvedOwner);if(!r.binding.permission||!r.ready)throw Error('connect-model-not-ready');
     this.state.paused=false;this.save(this.state);break;
    }
    case 'disconnect':await this.drain();if(this.native){const n=this.native;this.native=null;await n.close();}if(this.client.identity?.deviceId&&!this.client.identity.unpaired)await this.client.unpair();this.account=null;this.terms=null;this.modelView=null;break;
    case 'reset-connection':{
     if(this.remote?.active())throw Error('connect-setup-busy');
     // A local reset cannot substitute for revoking a live computer. Require an
     // actual authorization rejection; network failure never proves revocation.
     try{await this.client.status({platform:'win32',arch:'x64',node:'24.11.1',ramMiB:0,gpus:[]});throw Error('connect-revoke-first');}catch(error){if(error.status!==401)throw error;}
     if(this.approved()){
      const n=await this.ensureNative();await n.executor.stopOwned();if(n.pending())throw Error('connect-drain-pending');
      const op=(await n.setup(this.state.setup?.profile??DESKTOP_PROFILES[0])).operation;
      if(op&&!['installed','activation-failed','interrupted','failed','cancelled'].includes(op.state))throw Error('connect-setup-busy');
      this.native=null;await n.close();
     }
     await this.client.forgetRevoked();this.account=null;this.terms=null;this.modelView=null;this.job=null;break;
    }
    case 'quit':await this.finish();break;
   }
   return this.view();
  });
 }
 // Quit/EOF ends the companion, not accepted inference or remote authorization.
 // The host refuses unsafe shutdown; its ledger and setup remain recoverable.
 async finish(){try{await this.native?.abandon();}finally{this.native=null;this.closed=true;}}
 async lostParent(){this.parentLost=true;this.pause();await this.serial(()=>this.finish());}
}
