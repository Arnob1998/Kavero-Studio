// @vitest-environment node
import { describe,it,expect,afterEach } from 'vitest';
import { mkdtempSync,rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';import path from 'node:path';import os from 'node:os';
import { Ledger,intentHash } from './ledger.mjs';
const roots=[],ledgers=[];
afterEach(()=>{for(const ledger of ledgers.splice(0))ledger.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function make(){const root=mkdtempSync(path.join(os.tmpdir(),'kavero-lifecycle-'));roots.push(root);const filename=path.join(root,'ledger.sqlite'),ledger=new Ledger(filename);ledgers.push(ledger);return {ledger,filename};}
function payload(){const intent={profile:'qwen-image-2.1-q4-evaluation',prompt:'Test',width:512,height:512,count:1};return {id:randomUUID(),owner:randomUUID(),key:randomUUID(),intent,hash:intentHash(intent),fingerprint:'a'.repeat(64),device:'device'};}
describe('Durable lifecycle admission barrier',()=>{
  it('blocks new jobs across connections but reconciles admitted retry acknowledgements',()=>{
    const {ledger,filename}=make(),job=payload();ledger.submit(job);const token=randomUUID();ledger.beginMaintenance(token);
    const other=new Ledger(filename);ledgers.push(other);expect(()=>other.submit(payload())).toThrow('worker-maintenance');expect(other.submit(job).id).toBe(job.id);
    expect(other.db.prepare('SELECT count(*) n FROM jobs').get().n).toBe(1);
  });
  it('allows existing queued jobs to drain while refusing stop',()=>{
    const {ledger}=make(),job=payload(),token=randomUUID();ledger.submit(job);ledger.beginMaintenance(token);
    expect(()=>ledger.assertQuiescent(token)).toThrow('worker-jobs-outstanding');const row=ledger.claimNext(randomUUID(),randomUUID());expect(row.id).toBe(job.id);
    ledger.supervisorStart(row.id,row.claim,row.epoch,123,'creation');expect(()=>ledger.assertQuiescent(token)).toThrow('worker-jobs-outstanding');
    ledger.finish(row.id,row.claim,'generated-unvalidated',0);expect(ledger.assertQuiescent(token)).toBe(true);expect(ledger.submit(job).state).toBe('generated-unvalidated');
  });
  it.each(['dispatching','running','cancel-requested','submission-unknown'])('never treats %s work as safe to stop',state=>{
    const {ledger}=make(),job=payload(),token=randomUUID();ledger.submit(job);const row=ledger.claimNext(randomUUID(),randomUUID());
    if(state!=='dispatching')ledger.supervisorStart(row.id,row.claim,row.epoch,123,'creation');
    if(state==='cancel-requested')ledger.cancel(job.owner,job.id);if(state==='submission-unknown')ledger.stale(Date.now()+31000);
    ledger.beginMaintenance(token);expect(()=>ledger.assertQuiescent(token)).toThrow('worker-jobs-outstanding');expect(ledger.get(job.owner,job.id).state).toBe(state);
  });
  it('preserves the barrier across coordinator restart with no timeout takeover',()=>{
    const {ledger,filename}=make(),token=randomUUID();ledger.beginMaintenance(token,'shutdown');const other=new Ledger(filename);ledgers.push(other);
    other.stale(Date.now()+24*60*60*1000);expect(other.maintenance()).toEqual({token,purpose:'shutdown'});
    expect(()=>other.beginMaintenance(randomUUID(),'update')).toThrow('worker-maintenance-busy');expect(()=>other.endMaintenance(randomUUID())).toThrow('worker-maintenance-conflict');
    expect(()=>other.submit(payload())).toThrow('worker-maintenance');expect(other.endMaintenance(token)).toBe(true);expect(other.submit(payload()).state).toBe('queued');
  });
  it('cancellation resolves queued work without resubmitting inference',()=>{
    const {ledger}=make(),job=payload(),token=randomUUID();ledger.submit(job);ledger.beginMaintenance(token);expect(ledger.cancel(job.owner,job.id).state).toBe('cancelled');
    expect(ledger.assertQuiescent(token)).toBe(true);expect(ledger.submit(job).state).toBe('cancelled');expect(ledger.claimNext(randomUUID(),randomUUID())).toBeNull();
  });
  it('fences another lifecycle owner even on an empty ledger',()=>{
    const {ledger}=make(),token=randomUUID();ledger.beginMaintenance(token);expect(ledger.beginMaintenance(token)).toEqual({token,purpose:'update'});
    expect(()=>ledger.beginMaintenance(token,'shutdown')).toThrow('worker-maintenance-busy');expect(()=>ledger.assertQuiescent(randomUUID())).toThrow('worker-maintenance-conflict');
  });
});
