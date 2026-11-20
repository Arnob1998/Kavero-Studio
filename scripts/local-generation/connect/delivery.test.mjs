// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {DeliveryClient} from './delivery.mjs';
import {existingJobSnapshot,jobRequestHash,canonicalSnapshot} from '../../../src/modules/model-providers/local/job-snapshot.ts';
import {digest} from '../../../src/modules/model-providers/local/connect/protocol.ts';
function fixture(){
 const recipeSnapshot=existingJobSnapshot(),deviceId=randomUUID(),key=randomUUID();
 const intent={profile:recipeSnapshot.profile,prompt:'A quiet room',width:512,height:512,count:1};
 const binding={profile:recipeSnapshot.profile,workerEpoch:randomUUID(),ledgerIdentity:randomUUID(),executionDevice:'a'.repeat(64),permission:true,maintenance:false,recipeSnapshot};
 return {protocolOnly:true,generationEnabled:false,job:{id:randomUUID(),owner:randomUUID(),deviceId,key,token:randomUUID(),attempt:1,sequence:0,version:2,state:'delivered',reconcile:true,binding,
 payload:{deviceId,key,intent,recipeSnapshot,hash:jobRequestHash(intent,recipeSnapshot),bindingHash:digest(canonicalSnapshot(binding))}}};
}
function client(value){const action=vi.fn().mockResolvedValue(value);return {delivery:new DeliveryClient({epoch:randomUUID(),identity:{deviceId:value.job.deviceId},action}),action};}
describe('Connect delivery transport without executor',()=>{
 it('requires reconciliation and fixed native request identity',async()=>{
  const f=fixture(),{delivery,action}=client(f);const r=await delivery.poll(null);expect(r.job.id).toBe(f.job.id);
  expect(action).toHaveBeenCalledWith({action:'delivery-poll',session:delivery.session,binding:null});
  await delivery.checkpoint(r.job,'accepted');expect(action).toHaveBeenLastCalledWith({action:'delivery-checkpoint',session:delivery.session,id:f.job.id,token:f.job.token,attempt:1,sequence:1,state:'accepted'});
 });
 it.each(['mode','device','reconcile','hash','recipe','binding','sequence','prompt'])('rejects corrupted or unauthorized %s response',async change=>{
  const f=fixture(),{delivery}=client(f);
  if(change==='mode')f.generationEnabled=true;
  if(change==='device')f.job.deviceId=randomUUID();
  if(change==='reconcile')f.job.reconcile=false;
  if(change==='hash')f.job.payload.intent.prompt='injected';
  if(change==='recipe')f.job.payload.recipeSnapshot.settings.steps=1;
  if(change==='binding')f.job.binding.ledgerIdentity=randomUUID();
  if(change==='sequence')f.job.sequence=-1;
  if(change==='prompt')f.job.payload.intent.prompt=' '.repeat(2);
  await expect(delivery.poll()).rejects.toThrow();
 });
 it('propagates authorization failure without auto-retry or execution',async()=>{
  const {delivery,action}=client(fixture());action.mockRejectedValue(Object.assign(Error('revoked'),{status:401}));
  await expect(delivery.poll()).rejects.toMatchObject({status:401});expect(action).toHaveBeenCalledOnce();
 });
});
