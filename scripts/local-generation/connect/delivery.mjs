// Versioned Connect transport only. Deliberately imports no native executor.
import {canonicalSnapshot,jobRequestHash,validateSnapshotIntent} from '../../../src/modules/model-providers/local/job-snapshot.ts';
import {digest} from '../../../src/modules/model-providers/local/connect/protocol.ts';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const states=['delivered','accepted','running','submission-unknown','generated-unvalidated','failed','cancelled','rejected'];
export class DeliveryClient {
 constructor(client,{execution=false}={}){this.client=client;this.session=client.epoch;this.execution=execution;}
 validate(result){
  if(result.protocolOnly!==!this.execution||result.generationEnabled!==this.execution)throw Error('connect-delivery-mode-invalid');
  const job=result.job;
  if(job){
   if(!uuid(job.id)||!uuid(job.owner)||!uuid(job.key)||!uuid(job.token)||job.deviceId!==this.client.identity.deviceId
    ||!Number.isSafeInteger(job.attempt)||job.attempt<1||!Number.isSafeInteger(job.sequence)||job.sequence<0
    ||!Number.isSafeInteger(job.version)||job.version<1||job.reconcile!==true||!states.includes(job.state))throw Error('connect-delivery-invalid');
   const {intent,recipeSnapshot,hash}=job.payload??{};
   if(!intent||Object.keys(intent).sort().join(',')!=='count,height,profile,prompt,width'||typeof intent.prompt!=='string'||!intent.prompt.trim()||intent.prompt.length>1000)throw Error('connect-delivery-intent-invalid');
   validateSnapshotIntent(intent,recipeSnapshot,recipeSnapshot?.packageFingerprint);
   if(jobRequestHash(intent,recipeSnapshot)!==hash||job.payload.key!==job.key||job.payload.deviceId!==job.deviceId
    ||job.payload.bindingHash!==digest(canonicalSnapshot(job.binding))||canonicalSnapshot(job.binding.recipeSnapshot)!==canonicalSnapshot(recipeSnapshot))throw Error('connect-delivery-identity-invalid');
  }
  return result;
 }
 async poll(binding=null){return this.validate(await this.client.action({action:this.execution?'execution-poll':'delivery-poll',session:this.session,binding}));}
 async checkpoint(job,state,sequence=job.sequence+1,reason){
  return this.validate(await this.client.action({action:this.execution?'execution-checkpoint':'delivery-checkpoint',session:this.session,id:job.id,token:job.token,attempt:job.attempt,sequence,state,...(reason?{reason}:{})}));
 }
}
