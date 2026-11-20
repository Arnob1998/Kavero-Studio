import {randomUUID} from 'node:crypto';
import {digest,signConnect} from '../../../src/modules/model-providers/local/connect/protocol.ts';
import {RESULT_CONTROL,RESULT_UPLOAD,resultProof} from '../../../src/modules/model-providers/local/connect/result-protocol.ts';
import {validateLocalPNG} from '../../../src/modules/model-providers/local/png.ts';
export class ResultClient {
 constructor(client){this.client=client;}
 async request(path,body,metadata=''){
  const c=this.client,{deviceId:device,privateKey}=c.identity??{};if(!device||!privateKey)throw Error('connect-not-paired');
  const time=String(Date.now()),nonce=randomUUID(),sha=digest(body);
  const r=await c.fetch(c.origin+path,{method:'POST',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(100000),body,
   headers:{'content-type':path===RESULT_UPLOAD?'image/png':'application/json','x-kavero-connect-device':device,'x-kavero-connect-time':time,'x-kavero-connect-nonce':nonce,'x-kavero-body-sha256':sha,...(metadata?{'x-kavero-result':metadata}:{}),
    'x-kavero-connect-signature':signConnect(resultProof(c.origin,path,device,time,nonce,metadata,sha),privateKey)}});
  let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>8192)throw Error('connect-result-response-limit');chunks.push(chunk);}
  if(!r.ok){const error=Error('connect-result-retry-original');error.status=r.status;throw error;}
  const reply=JSON.parse(Buffer.concat(chunks));if(reply.version!==1||!reply.result)throw Error('connect-result-response-invalid');return reply;
 }
 saved(jobId,sha256){return this.request(RESULT_CONTROL,JSON.stringify({action:'saved',jobId,sha256}));}
 offer(jobId,attempt,descriptor){return this.request(RESULT_CONTROL,JSON.stringify({action:'offer',jobId,attempt,descriptor}));}
 upload(input,bytes){return this.request(RESULT_UPLOAD,bytes,Buffer.from(JSON.stringify(input)).toString('base64url'));}
}
export class ResultTransfer {
 constructor({client,adapter,journal,owner}){Object.assign(this,{client:new ResultClient(client),adapter,journal,owner});}
 async acknowledge(){
  const row=this.journal.db.prepare("select * from execution where owner=? and transferred=1 and saved=0 and transfer_after<=? order by transfer_after,rowid limit 1").get(this.owner,Date.now());if(!row)return null;
  this.journal.db.prepare('update execution set transfer_after=? where id=?').run(Date.now()+60000,row.id);
  const job=JSON.parse(row.frozen);if(job.owner!==this.owner||job.payload.execute!==true)throw Error('connect-result-owner-mismatch');
  const s=await this.adapter.worker('/status',{id:row.id,owner:this.owner});
  if(s.ledgerIdentity!==job.binding.ledgerIdentity||s.requestHash!==job.payload.hash||s.packageFingerprint!==job.payload.recipeSnapshot.packageFingerprint||s.submissionKey!==job.key||digest(s.executionDevice??'')!==job.binding.executionDevice||!s.output?.descriptor?.sha256)throw Error('connect-result-native-identity-changed');
  const hash=s.output.descriptor.sha256,reply=await this.client.saved(row.id,hash);
  if(reply.result.jobId!==row.id||reply.result.sha256!==hash||typeof reply.result.saved!=='boolean')throw Error('connect-save-receipt-invalid');
  if(!reply.result.saved)return null;
  const acknowledged=await this.adapter.worker('/saved',{owner:this.owner,id:row.id,ledgerIdentity:job.binding.ledgerIdentity,sha256:hash});
  if(acknowledged.saved!==true)throw Error('connect-save-ack-unconfirmed');
  this.journal.db.prepare('update execution set saved=1 where id=? and owner=?').run(row.id,this.owner);return reply.result;
 }
 async tick(){
  const row=this.journal.db.prepare("select * from execution where owner=? and state='generated-unvalidated' and transferred=0 and transfer_after<=? order by transfer_after,rowid limit 1").get(this.owner,Date.now());if(!row)return null;
  this.journal.db.prepare('update execution set transfer_after=? where id=?').run(Date.now()+60000,row.id);
  const job=JSON.parse(row.frozen),binding=job.binding;
  if(job.owner!==this.owner||job.payload.execute!==true)throw Error('connect-result-owner-mismatch');
  const s=await this.adapter.worker('/status',{id:row.id,owner:this.owner});
  if(s.state!=='generated-unvalidated'||s.ledgerIdentity!==binding.ledgerIdentity||s.requestHash!==job.payload.hash||s.submissionKey!==job.key||s.packageFingerprint!==job.payload.recipeSnapshot.packageFingerprint||digest(s.executionDevice??'')!==binding.executionDevice||s.output?.state!=='generated')throw Error('connect-result-native-identity-changed');
  const args={id:row.id,owner:this.owner,ledgerIdentity:binding.ledgerIdentity};const lease=await this.adapter.worker('/lease',args);let lost=false,renewing=false;
  const timer=setInterval(async()=>{if(renewing)return;renewing=true;try{await this.adapter.worker('/lease/renew',{...args,token:lease.token});}catch{lost=true;}finally{renewing=false;}},15000);
  try{
   const d=lease.descriptor;
   if(!d||d.jobId!==row.id||d.ownerId!==this.owner||d.ledgerIdentity!==binding.ledgerIdentity||d.requestHash!==job.payload.hash||d.packageFingerprint!==job.payload.recipeSnapshot.packageFingerprint||digest(d.deviceId)!==binding.executionDevice||JSON.stringify(d)!==JSON.stringify(s.output.descriptor))throw Error('connect-result-descriptor-changed');
   const descriptor={role:'final',sha256:d.sha256,sizeBytes:d.sizeBytes,width:d.width,height:d.height,mimeType:d.mimeType,ledgerIdentity:d.ledgerIdentity,requestHash:d.requestHash,packageFingerprint:d.packageFingerprint,executionDevice:binding.executionDevice,generatedAt:d.generatedAt,localExpiresAt:d.expiresAt};
   let reply=await this.client.offer(row.id,row.attempt,descriptor);
   if(reply.result.jobId!==row.id||reply.result.sha256!==d.sha256||reply.result.sizeBytes!==d.sizeBytes)throw Error('connect-result-reply-changed');
   if(reply.result.state!=='available'){
    if(reply.result.state!=='pending'||!reply.token)throw Error('connect-result-not-uploadable');
    const bytes=await this.adapter.output(this.owner,row.id,binding.ledgerIdentity,lease.token);const info=validateLocalPNG(bytes);
    if(lost||info.sha256!==d.sha256||info.sizeBytes!==d.sizeBytes)throw Error('connect-result-native-output-changed');
    reply=await this.client.upload({jobId:row.id,attempt:row.attempt,token:reply.token,sha256:d.sha256,sizeBytes:d.sizeBytes},bytes);
   }
   if(reply.result.jobId!==row.id||reply.result.state!=='available'||reply.result.sha256!==d.sha256||reply.result.sizeBytes!==d.sizeBytes)throw Error('connect-result-not-confirmed');
   this.journal.db.prepare('update execution set transferred=1 where id=? and owner=?').run(row.id,this.owner);return reply.result;
  }finally{clearInterval(timer);try{await this.adapter.worker('/lease/release',{...args,token:lease.token});}catch{/* Native lease expires; uploading never marks saved. */}}
 }
}
