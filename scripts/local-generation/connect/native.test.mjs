// @vitest-environment node
import {describe,it,expect,vi,afterEach} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Ledger} from '../ledger.mjs';
import {NativeExecutor,ExecutionJournal,ExecutionRunner} from './native.mjs';
import {existingJobSnapshot,jobRequestHash} from '../../../src/modules/model-providers/local/job-snapshot.ts';
import {digest} from '../../../src/modules/model-providers/local/connect/protocol.ts';
const cleanups=[];afterEach(()=>{for(const fn of cleanups.splice(0).reverse())fn();});
function fixture(){
 const root=mkdtempSync(path.join(tmpdir(),'kc2b-unit-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}));
 const ledger=new Ledger(path.join(root,'native.sqlite')),journal=new ExecutionJournal(path.join(root,'connect.sqlite'));cleanups.push(()=>ledger.close(),()=>journal.close());
 const owner=randomUUID(),epoch=randomUUID(),device='GPU-private-uuid',recipeSnapshot=existingJobSnapshot();
 const intent={profile:recipeSnapshot.profile,prompt:'A still life',width:512,height:512,count:1};
 const binding={profile:intent.profile,workerEpoch:epoch,ledgerIdentity:ledger.identity,executionDevice:digest(device),permission:true,maintenance:false};
 const job={id:randomUUID(),owner,key:randomUUID(),attempt:1,state:'delivered',sequence:0,binding:{...binding,recipeSnapshot,execute:true},payload:{execute:true,intent,recipeSnapshot,hash:jobRequestHash(intent,recipeSnapshot)}};
 const summary=row=>({id:row.id,state:row.state,ledgerIdentity:ledger.identity,requestHash:row.hash,submissionKey:row.key,packageFingerprint:JSON.parse(row.payload).fingerprint,executionDevice:JSON.parse(row.payload).device});
 const adapter={readiness:vi.fn(async()=>({binding:{...binding},ready:{epoch,ledgerIdentity:ledger.identity,deviceId:device}})),worker:vi.fn(async(route,body)=>{
  if(route==='/submit'){let row;try{row=ledger.submit(body);}catch(error){if(error.message==='queue-full')error.status=429;throw error;}return summary(row);}
  const row=route==='/cancel'?ledger.cancel(body.owner,body.id):ledger.get(body.owner,body.id);if(!row)throw Object.assign(Error('not-found'),{status:404});return summary(row);
 })};
 const executor=new NativeExecutor({owner,adapter,journal});return {root,ledger,journal,owner,epoch,job,adapter,executor};
}
describe('Connect execution on existing native ledger',()=>{
 it('recovers lost submit ack after companion reconstruction without a second submission',async()=>{
  const f=fixture(),real=f.adapter.worker.getMockImplementation();let lost=true;f.adapter.worker.mockImplementation(async(...args)=>{const r=await real(...args);if(args[0]==='/submit'&&lost){lost=false;throw Error('lost-ack');}return r;});
  expect(await f.executor.execute(f.job)).toBe('submission-unknown');
  const restored=new NativeExecutor({owner:f.owner,adapter:f.adapter,journal:f.journal});expect(await restored.execute({...f.job,attempt:2})).toBe('accepted');
  expect(f.ledger.db.prepare('select count(*) n from jobs').get().n).toBe(1);expect(f.adapter.worker.mock.calls.filter(c=>c[0]==='/submit')).toHaveLength(1);
 });
 it('does not recreate work when the journal is missing after an ambiguous delivery',async()=>{
  const f=fixture();expect(await f.executor.execute({...f.job,attempt:2})).toBe('submission-unknown');expect(f.adapter.worker).not.toHaveBeenCalled();
 });
 it('rejects another owner or a protocol fixture',async()=>{
  const f=fixture();await expect(f.executor.execute({...f.job,owner:randomUUID()})).rejects.toThrow('mismatch');f.job.payload.execute=false;await expect(f.executor.execute(f.job)).rejects.toThrow('mismatch');expect(f.adapter.worker).not.toHaveBeenCalled();
 });
 it.each(['permission','workerEpoch','ledgerIdentity','executionDevice'])('revalidates changed %s before first submit',async field=>{
  const f=fixture(),value=await f.adapter.readiness();value.binding[field]=field==='permission'?false:randomUUID();f.adapter.readiness.mockResolvedValue(value);
  expect(await f.executor.execute(f.job)).toBe('rejected');expect(f.adapter.worker.mock.calls.some(c=>c[0]==='/submit')).toBe(false);
 });
 it('shares queue admission and single active slot with local jobs',async()=>{
  const f=fixture();const local={id:randomUUID(),owner:f.owner,key:randomUUID(),hash:f.job.payload.hash,intent:f.job.payload.intent,recipeSnapshot:f.job.payload.recipeSnapshot,fingerprint:f.job.payload.recipeSnapshot.packageFingerprint,device:'GPU-private-uuid'};f.ledger.submit(local);
  expect(await f.executor.execute(f.job)).toBe('accepted');const active=f.ledger.claimNext(f.epoch,randomUUID());expect(active).not.toBeNull();expect(f.ledger.claimNext(f.epoch,randomUUID())).toBeNull();
  const another={...f.job,id:randomUUID(),key:randomUUID()};expect(await f.executor.execute(another)).toBe('rejected');expect(f.executor.reason).toBe('queue-full');
  f.adapter.worker.mockClear();expect(await f.executor.execute(another)).toBe('rejected');expect(f.executor.reason).toBe('queue-full');expect(f.adapter.worker).not.toHaveBeenCalled();
 });
 it('respects the shared five-job device capacity across owners',async()=>{
  const f=fixture();for(let i=0;i<5;i++)f.ledger.submit({id:randomUUID(),owner:randomUUID(),key:randomUUID(),...f.job.payload,fingerprint:f.job.payload.recipeSnapshot.packageFingerprint,device:'GPU-private-uuid'});
  expect(await f.executor.execute(f.job)).toBe('rejected');expect(f.executor.reason).toBe('queue-full');expect(f.ledger.outstandingCount()).toBe(5);
 });
 it('recovers after a simulated native failure without changing recipe settings',async()=>{
  const f=fixture();await f.executor.execute(f.job);const active=f.ledger.claimNext(f.epoch,randomUUID());f.ledger.supervisorStart(active.id,active.claim,f.epoch,123,'creation');f.ledger.finish(active.id,active.claim,'failed',1);expect(await f.executor.execute(f.job)).toBe('failed');
  const next={...f.job,id:randomUUID(),key:randomUUID()};expect(await f.executor.execute(next)).toBe('accepted');expect(JSON.parse(f.ledger.get(f.owner,next.id).payload).recipeSnapshot).toEqual(f.job.payload.recipeSnapshot);
 });
 it('preserves uncertain work across runtime epoch and ledger changes',async()=>{
  const f=fixture();f.journal.prepare(f.job);f.journal.attempted(f.job.id);const readiness=await f.adapter.readiness();readiness.binding.workerEpoch=randomUUID();f.adapter.readiness.mockResolvedValue(readiness);expect(await f.executor.execute(f.job)).toBe('submission-unknown');
  f.adapter.worker.mockResolvedValue({id:f.job.id,state:'queued',ledgerIdentity:randomUUID()});expect(await f.executor.execute(f.job)).toBe('submission-unknown');
 });
 it('does not adopt a different native intent with a colliding job ID',async()=>{const f=fixture();f.adapter.worker.mockResolvedValue({id:f.job.id,ledgerIdentity:f.job.binding.ledgerIdentity,state:'generated-unvalidated',requestHash:'0'.repeat(64)});expect(await f.executor.execute(f.job)).toBe('submission-unknown');expect(f.adapter.worker).toHaveBeenCalledOnce();});
 it('cancels queued work but never claims ambiguous missing work stopped',async()=>{
  const f=fixture();expect(await f.executor.execute(f.job)).toBe('accepted');expect(await f.executor.execute({...f.job,cancelRequested:true})).toBe('cancelled');
  const other={...f.job,id:randomUUID(),key:randomUUID()};f.journal.prepare(other);f.journal.attempted(other.id);expect(await f.executor.execute({...other,cancelRequested:true})).toBe('submission-unknown');
 });
 it('retries dispatching cancellation and retains late completion',async()=>{
  const f=fixture();await f.executor.execute(f.job);const active=f.ledger.claimNext(f.epoch,randomUUID());expect(await f.executor.execute({...f.job,cancelRequested:true})).toBe('submission-unknown');
  f.ledger.supervisorStart(active.id,active.claim,f.epoch,123,'creation');f.ledger.finish(active.id,active.claim,'generated-unvalidated',0);expect(await f.executor.execute({...f.job,cancelRequested:true})).toBe('generated-unvalidated');
 });
 it('does not submit a delivered job while paused, but resumes its original identity',async()=>{
  const f=fixture(),delivery={execution:true,poll:vi.fn(async()=>({ownerId:f.owner,job:f.job})),checkpoint:vi.fn(async()=>({ownerId:f.owner,job:null}))};
  const runner=new ExecutionRunner({delivery,executor:f.executor});await runner.tick({admit:false});expect(delivery.poll).toHaveBeenCalledWith(null);expect(delivery.checkpoint).not.toHaveBeenCalled();expect(f.journal.get(f.job.id).attempted).toBe(0);expect(f.adapter.worker.mock.calls.some(c=>c[0]==='/submit')).toBe(false);
  await runner.tick();expect(f.journal.get(f.job.id).attempted).toBe(1);expect(f.ledger.get(f.owner,f.job.id).key).toBe(f.job.key);
 });
 it('honors pause arriving during the network poll before native submission',async()=>{
  const f=fixture();let allowed=true;const runner=new ExecutionRunner({delivery:{execution:true,poll:vi.fn(async()=>{allowed=false;return {ownerId:f.owner,job:f.job};}),checkpoint:vi.fn()},executor:f.executor});await runner.tick({canAdmit:()=>allowed});expect(f.journal.get(f.job.id).attempted).toBe(0);expect(f.adapter.worker.mock.calls.some(c=>c[0]==='/submit')).toBe(false);
 });
 it('honors pause arriving during final readiness revalidation',async()=>{
  const f=fixture();let allowed=true;const prior=await f.adapter.readiness();f.adapter.readiness.mockImplementation(async()=>{allowed=false;return prior;});await f.executor.execute(f.job,{canAdmit:()=>allowed});expect(f.journal.get(f.job.id).attempted).toBe(0);expect(f.adapter.worker.mock.calls.some(c=>c[0]==='/submit')).toBe(false);
 });
 it('reconciles native completion while paused without resubmitting',async()=>{
  const f=fixture();await f.executor.execute(f.job);const active=f.ledger.claimNext(f.epoch,randomUUID());f.ledger.supervisorStart(active.id,active.claim,f.epoch,123,'creation');f.ledger.finish(active.id,active.claim,'generated-unvalidated',0);f.adapter.worker.mockClear();expect(await f.executor.execute({...f.job,state:'running'},{admit:false})).toBe('generated-unvalidated');expect(f.adapter.worker.mock.calls.some(c=>c[0]==='/submit')).toBe(false);
 });
 it('stops only owned jobs on remote authorization loss',async()=>{
  const f=fixture();await f.executor.execute(f.job);const local={...f.job,id:randomUUID(),key:randomUUID()};await f.adapter.worker('/submit',{...local,...local.payload,fingerprint:local.payload.recipeSnapshot.packageFingerprint,device:'GPU-private-uuid'});
  const delivery={execution:true,poll:vi.fn().mockRejectedValue(Object.assign(Error('revoked'),{status:401}))};const runner=new ExecutionRunner({delivery,executor:f.executor});await expect(runner.tick()).rejects.toMatchObject({status:401});expect(f.ledger.get(f.owner,f.job.id).state).toBe('cancelled');expect(f.ledger.get(f.owner,local.id).state).toBe('queued');
 });
});
