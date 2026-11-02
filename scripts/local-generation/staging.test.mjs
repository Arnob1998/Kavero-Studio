// @vitest-environment node
import { describe,it,expect,afterEach } from 'vitest';
import { mkdtempSync,rmSync,writeFileSync,readFileSync,existsSync,statSync,symlinkSync,mkdirSync,linkSync } from 'node:fs';
import os from 'node:os';import path from 'node:path';import { randomUUID } from 'node:crypto';
import { Ledger,intentHash,STAGING_RESERVATION,STAGING_CAPACITY } from './ledger.mjs';
import { FINGERPRINT,DEVICE } from './profile.mjs';
import { createJobDirectory,inspectStagedOutput,readLeasedOutput,cleanupStaging,createBoundedLog,LOG_MAX_BYTES } from './staging.mjs';
import { pngFixture } from './png-fixture.mjs';
const roots=[],ledgers=[];
afterEach(()=>{for(const ledger of ledgers.splice(0))ledger.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function setup() {
  const root=mkdtempSync(path.join(os.tmpdir(),'kavero-staging-'));roots.push(root);
  const ledger=new Ledger(path.join(root,'ledger.sqlite'));ledgers.push(ledger);
  const intent={profile:'qwen-image-2.1-q4-evaluation',prompt:'A vase',width:512,height:512,count:1};
  const p={id:randomUUID(),owner:randomUUID(),key:randomUUID(),hash:intentHash(intent),intent,fingerprint:FINGERPRINT,device:DEVICE};
  ledger.submit(p);const row=ledger.claimNext(randomUUID(),randomUUID());ledger.supervisorStart(row.id,row.claim,row.epoch,123,'ticks');
  const dir=createJobDirectory(root,p.id);
  const finish=(bytes=pngFixture())=>{writeFileSync(path.join(dir,'final.png'),bytes);ledger.finish(p.id,row.claim,'generated-unvalidated',0);};
  return {root,ledger,p,row,dir,finish};
}
describe('Staged output lifecycle',()=>{
  it('saved acknowledgement waits for active leases before releasing staging, without losing tombstones',()=>{
    const s=setup();s.finish();const output=inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id),lease=s.ledger.acquireOutputLease(s.p.owner,s.p.id);
    expect(()=>s.ledger.markOutputSaved(randomUUID(),s.p.id,output.descriptor.sha256)).toThrow('output-not-found');
    expect(()=>s.ledger.markOutputSaved(s.p.owner,s.p.id,'f'.repeat(64))).toThrow('staged-output-changed');
    s.ledger.markOutputSaved(s.p.owner,s.p.id,output.descriptor.sha256);expect(cleanupStaging(s.ledger,s.root)).toBe(0);
    s.ledger.releaseOutputLease(s.p.owner,s.p.id,lease.token);expect(cleanupStaging(s.ledger,s.root)).toBe(1);
    expect(s.ledger.submit(s.p).id).toBe(s.p.id);expect(s.ledger.claimNext(randomUUID(),randomUUID())).toBeNull();
  });
  it('binds descriptor to owner/job/ledger/package and keeps it immutable across restart',()=>{
    const s=setup();s.finish();const first=inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id);
    expect(first.state).toBe('generated');expect(first.descriptor).toMatchObject({ownerId:s.p.owner,jobId:s.p.id,ledgerIdentity:s.ledger.identity,requestHash:s.p.hash,packageFingerprint:FINGERPRINT});
    const other=new Ledger(path.join(s.root,'ledger.sqlite'));ledgers.push(other);
    expect(inspectStagedOutput(other,s.root,s.p.owner,s.p.id)).toEqual(first);
    expect(()=>inspectStagedOutput(other,s.root,randomUUID(),s.p.id)).toThrow('output-not-found');
    expect(()=>other.acquireOutputLease(randomUUID(),s.p.id)).toThrow('output-not-found');
  });
  it('never accepts previews instead of final images',()=>{
    const s=setup();writeFileSync(path.join(s.dir,'preview.png'),pngFixture());s.ledger.finish(s.p.id,s.row.claim,'generated-unvalidated',0);
    expect(inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).state).toBe('invalid');
    expect(cleanupStaging(s.ledger,s.root)).toBe(0);expect(existsSync(path.join(s.dir,'preview.png'))).toBe(true);
  });
  it.each([Buffer.from('corrupt'),pngFixture({width:256}),Buffer.alloc(32*1024*1024+1)])('rejects corrupt/wrong-size/oversized files %#',bytes=>{
    const s=setup();s.finish(bytes);expect(inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).state).toBe('invalid');
  });
  it('does not expose output from ambiguous or cancelled inference',()=>{
    const s=setup();writeFileSync(path.join(s.dir,'final.png'),pngFixture());s.ledger.unknown(s.p.id,s.row.claim);
    expect(inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).state).toBe('pending');expect(cleanupStaging(s.ledger,s.root,Date.now()+999999999)).toBe(0);
    s.ledger.finish(s.p.id,s.row.claim,'cancelled',1);expect(cleanupStaging(s.ledger,s.root)).toBe(1);
    expect(existsSync(s.dir)).toBe(false);expect(s.ledger.submit(s.p).state).toBe('cancelled');
  });
  it('confirms a cancellation that races a successful engine receipt',()=>{
    const s=setup();s.ledger.cancel(s.p.owner,s.p.id);s.finish();
    expect(s.ledger.get(s.p.owner,s.p.id).state).toBe('cancelled');expect(inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).state).toBe('pending');
  });
  it('rejects changed bytes after verification, retaining the original checksum',()=>{
    const s=setup();s.finish();const output=inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id),lease=s.ledger.acquireOutputLease(s.p.owner,s.p.id);
    writeFileSync(path.join(s.dir,'final.png'),pngFixture({color:7}));
    expect(()=>readLeasedOutput(s.ledger,s.root,s.p.owner,s.p.id,lease.token)).toThrow('staged-output-changed');
    const after=inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id);expect(after.state).toBe('invalid');expect(after.descriptor).toEqual(output.descriptor);
  });
  it('leases block expiry cleanup across coordinators; renewal supports a later save',()=>{
    const s=setup();s.finish();const descriptor=inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).descriptor;
    const expires=Date.parse(descriptor.expiresAt),lease=s.ledger.acquireOutputLease(s.p.owner,s.p.id,expires-1000);
    const other=new Ledger(path.join(s.root,'ledger.sqlite'));ledgers.push(other);
    expect(cleanupStaging(other,s.root,expires+1000)).toBe(0);
    expect(()=>other.acquireOutputLease(s.p.owner,s.p.id,expires+1000)).toThrow('output-expired');
    expect(readLeasedOutput(other,s.root,s.p.owner,s.p.id,lease.token,expires+1000).info.sha256).toBe(descriptor.sha256);
    other.renewOutputLease(s.p.owner,s.p.id,lease.token,expires+1000);
    expect(cleanupStaging(s.ledger,s.root,expires+60000)).toBe(0);
    other.releaseOutputLease(s.p.owner,s.p.id,lease.token);
    expect(cleanupStaging(s.ledger,s.root,expires+60000)).toBe(1);
    expect(inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).state).toBe('expired');expect(s.ledger.submit(s.p).id).toBe(s.p.id);
    expect(s.ledger.get(s.p.owner,s.p.id).reserved_bytes).toBe(0);
  });
  it('cleans an abandoned expired lease after restart and never reruns the job',()=>{
    const s=setup();s.finish();const descriptor=inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).descriptor,expires=Date.parse(descriptor.expiresAt);
    s.ledger.acquireOutputLease(s.p.owner,s.p.id,expires-1000);
    const other=new Ledger(path.join(s.root,'ledger.sqlite'));ledgers.push(other);
    expect(cleanupStaging(other,s.root,expires+60000)).toBe(1);expect(other.submit(s.p).state).toBe('generated-unvalidated');expect(other.claimNext(randomUUID(),randomUUID())).toBeNull();
  });
  it('refuses unrelated files and directory links during cleanup',()=>{
    const s=setup();s.ledger.finish(s.p.id,s.row.claim,'failed',1);writeFileSync(path.join(s.dir,'unrelated.txt'),'keep');
    expect(cleanupStaging(s.ledger,s.root)).toBe(0);expect(readFileSync(path.join(s.dir,'unrelated.txt'),'utf8')).toBe('keep');
    const target=path.join(s.root,'unrelated');mkdirSync(target);writeFileSync(path.join(target,'keep'),'keep');rmSync(s.dir,{recursive:true});
    symlinkSync(target,s.dir,process.platform==='win32'?'junction':'dir');expect(cleanupStaging(s.ledger,s.root)).toBe(0);expect(existsSync(path.join(target,'keep'))).toBe(true);
  });
  it('rejects path traversal and hard-linked final images',()=>{
    const s=setup();expect(()=>createJobDirectory(s.root,'../outside')).toThrow('unsafe-staging-path');
    const outside=path.join(s.root,'other.png');writeFileSync(outside,pngFixture());
    linkSync(outside,path.join(s.dir,'final.png'));s.ledger.finish(s.p.id,s.row.claim,'generated-unvalidated',0);
    expect(inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).state).toBe('invalid');
  });
  it('reserves retained staging globally and rejects actual low disk before admission',()=>{
    const s=setup(),newPayload=()=>({...s.p,id:randomUUID(),owner:randomUUID(),key:randomUUID()});
    expect(()=>s.ledger.submit(newPayload(),1)).toThrow('staging-full');
    s.ledger.db.prepare('UPDATE jobs SET reserved_bytes=?,state=? WHERE id=?').run(STAGING_CAPACITY-STAGING_RESERVATION,'generated-unvalidated',s.p.id);
    const accepted=newPayload();s.ledger.submit(accepted,10*STAGING_CAPACITY);
    expect(s.ledger.reservedBytes()).toBe(STAGING_CAPACITY);expect(()=>s.ledger.submit(newPayload(),10*STAGING_CAPACITY)).toThrow('staging-full');
    expect(s.ledger.submit(accepted,0).id).toBe(accepted.id);
  });
  it('caps engine logs and signals termination once',()=>{
    const s=setup();let signals=0;const filename=path.join(s.dir,'engine.log'),log=createBoundedLog(filename,()=>signals++);
    log.append(Buffer.alloc(LOG_MAX_BYTES+100));log.append(Buffer.alloc(100));log.close();log.close();
    expect(statSync(filename).size).toBe(LOG_MAX_BYTES);expect(signals).toBe(1);
  });
});
it('validates output for a newly bound GPU and rejects an unbound replacement device',()=>{
 const s=setup(),device='GPU-11111111-2222-3333-4444-555555555555';s.ledger.db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify({...s.p,device,hardwareBinding:'a'.repeat(64),backendIndex:0}),s.p.id);s.finish();expect(inspectStagedOutput(s.ledger,s.root,s.p.owner,s.p.id).descriptor.deviceId).toBe(device);
 const unbound=setup();unbound.ledger.db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify({...unbound.p,device}),unbound.p.id);unbound.finish();expect(inspectStagedOutput(unbound.ledger,unbound.root,unbound.p.owner,unbound.p.id).state).toBe('invalid');
});
