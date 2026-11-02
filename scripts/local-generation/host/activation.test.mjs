// @vitest-environment node
import { describe,it,expect,afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';import os from 'node:os';import path from 'node:path';
import { initializeHost } from './bootstrap.mjs';
import { ActivationManager } from './activation.mjs';
import { EVALUATION_PACKAGE,MODEL_RECEIPT_HASH,MODEL_RECEIPT,MODEL_VERSION,verifyModel,managedPackageIdentity } from './model-package.mjs';
import { Ledger,intentHash } from '../ledger.mjs';
import { packageWorker } from './bundle.mjs';
const contexts=[];
afterEach(()=>{for(const ctx of contexts.splice(0)){try{ctx.manager.worker?.ledger.close();}catch{}ctx.db.close();rmSync(ctx.root,{recursive:true,force:true});}});
function make(overrides={},evaluation=true){
  const root=mkdtempSync(path.join(os.tmpdir(),'kavero-activation-')),base=initializeHost(root,{protect:()=>{}}),config={...base.config,internalEvaluation:evaluation};
  const db=new DatabaseSync(':memory:');let launches=0;
  const verify=async()=>({...managedPackageIdentity(EVALUATION_PACKAGE),packageRoot:root});
  const start=async configPath=>{launches++;const workerConfig=JSON.parse(readFileSync(configPath,'utf8')),ledger=new Ledger(path.join(workerConfig.stateRoot,'ledger.sqlite'));return {epoch:randomUUID(),ledger,async close({token}){ledger.assertQuiescent(token);ledger.close();}};};
  const manager=new ActivationManager(config,db,{files:base.files,verify,start,...overrides}),ctx={root,files:base.files,config,db,manager,owner:randomUUID(),key:randomUUID(),launches:()=>launches};contexts.push(ctx);return ctx;
}
const admit=ctx=>ctx.manager.admit({owner:ctx.owner,key:ctx.key,packageId:EVALUATION_PACKAGE});
const job=()=>{const intent={profile:'qwen-image-2.1-q4-evaluation',prompt:'Test',width:512,height:512,count:1};return {id:randomUUID(),owner:randomUUID(),key:randomUUID(),intent,hash:intentHash(intent),fingerprint:'a'.repeat(64),device:'device'};};
describe('Managed activation identity and rollback',()=>{
  it('activates user-selected research without an internal flag',async()=>{const ctx=make({},false);ctx.config.userSelectedModels=true;const op=admit(ctx);expect((await ctx.manager.run(ctx.owner,op.id)).state).toBe('installed');expect(ctx.manager.status().selectionMode).toBe('user-selected');});
  it('has no public/evaluation package without an explicit internal policy',()=>{const ctx=make({},false);expect(()=>admit(ctx)).toThrow('activation-package-unavailable');expect(ctx.manager.status().inferenceReady).toBe(false);});
  it('deduplicates same-key submission and installed replay with one startup',async()=>{const ctx=make(),op=admit(ctx);expect(admit(ctx).id).toBe(op.id);expect((await ctx.manager.run(ctx.owner,op.id)).state).toBe('installed');expect((await ctx.manager.run(ctx.owner,op.id)).state).toBe('installed');expect(ctx.launches()).toBe(1);expect(ctx.manager.status().inferenceReady).toBe(true);});
  it('isolates reads, cancellations and activation work by owner',async()=>{const ctx=make(),op=admit(ctx),other=randomUUID();expect(ctx.manager.get(other,op.id)).toBeNull();expect(ctx.manager.cancel(other,op.id)).toBeNull();await expect(ctx.manager.run(other,op.id)).rejects.toThrow('activation-not-found');});
  it('never resumes a queued cancellation tombstone',async()=>{const ctx=make(),op=admit(ctx);expect(ctx.manager.cancel(ctx.owner,op.id).state).toBe('cancelled');expect((await ctx.manager.run(ctx.owner,op.id)).state).toBe('cancelled');expect(ctx.launches()).toBe(0);});
  it('serializes competing requests and honours active cancellation before stop',async()=>{
    let release;const held=new Promise(resolve=>release=resolve),ctx=make({verify:async()=>{await held;return {packageRoot:'fixture'};}}),op=admit(ctx);
    const running=ctx.manager.run(ctx.owner,op.id);expect(()=>ctx.manager.admit({owner:ctx.owner,key:randomUUID(),packageId:EVALUATION_PACKAGE})).toThrow('activation-busy');ctx.manager.cancel(ctx.owner,op.id);release();expect((await running).state).toBe('cancelled');expect(ctx.launches()).toBe(0);
  });
  it.each(['queued','running','submission-unknown'])('preserves %s jobs and the current worker instead of updating',async state=>{
    const ctx=make(),first=admit(ctx);await ctx.manager.run(ctx.owner,first.id);const ledger=ctx.manager.worker.ledger,payload=job();ledger.submit(payload);
    if(state!=='queued'){const claim=ledger.claimNext(randomUUID(),randomUUID());ledger.supervisorStart(claim.id,claim.claim,claim.epoch,123,'fixture');if(state==='submission-unknown')ledger.stale(Date.now()+31000);}
    ctx.key=randomUUID();const next=admit(ctx),result=await ctx.manager.run(ctx.owner,next.id);expect(result.error).toBe('worker-jobs-outstanding');expect(ctx.launches()).toBe(1);expect(ledger.get(payload.owner,payload.id).state).toBe(state);expect(ctx.manager.status().inferenceReady).toBe(false);
  });
  it('restores the previous worker after a failed candidate startup, then retries the same operation',async()=>{
    const ctx=make(),first=admit(ctx);await ctx.manager.run(ctx.owner,first.id);const original=ctx.manager.start;let fail=true;
    ctx.manager.start=async config=>{if(fail){fail=false;throw Error('candidate startup failed');}return original(config);};ctx.key=randomUUID();const next=admit(ctx);
    expect((await ctx.manager.run(ctx.owner,next.id)).state).toBe('failed');expect(ctx.manager.status().inferenceReady).toBe(true);expect(ctx.db.prepare('SELECT receipt FROM active_worker').get().receipt).toBe(MODEL_RECEIPT_HASH);
    expect((await ctx.manager.run(ctx.owner,next.id)).state).toBe('installed');expect(ctx.db.prepare('SELECT count(*) n FROM activations').get().n).toBe(2);
  });
  it('refuses unowned maintenance even on an idle worker',async()=>{const ctx=make(),first=admit(ctx);await ctx.manager.run(ctx.owner,first.id);const token=randomUUID();ctx.manager.worker.ledger.beginMaintenance(token);ctx.key=randomUUID();const next=admit(ctx);expect((await ctx.manager.run(ctx.owner,next.id)).state).toBe('failed');expect(ctx.manager.worker.ledger.maintenance().token).toBe(token);});
  it('restores stable ledger identity after graceful owned shutdown',async()=>{
    const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);const identity=ctx.manager.worker.ledger.identity;await ctx.manager.shutdown();
    const restored=new ActivationManager(ctx.config,ctx.db,{files:ctx.files,verify:ctx.manager.verify,start:ctx.manager.start});ctx.manager=restored;await restored.restore();expect(restored.worker.ledger.identity).toBe(identity);expect(restored.status().inferenceReady).toBe(true);
  });
  it('allows explicit same-key recovery after startup restore fails',async()=>{
    const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);await ctx.manager.shutdown();
    let broken=true;const originalVerify=ctx.manager.verify,restored=new ActivationManager(ctx.config,ctx.db,{files:ctx.files,start:ctx.manager.start,verify:async()=>{if(broken)throw Error('verification failure');return originalVerify();}});ctx.manager=restored;
    await restored.restore();expect(restored.status().state).toBe('recovery-required');broken=false;expect(admit(ctx).id).toBe(op.id);expect((await restored.run(ctx.owner,op.id)).state).toBe('installed');expect(restored.status().inferenceReady).toBe(true);
  });
  it('leaves an existing worker running when candidate verification fails',async()=>{const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);ctx.manager.verify=async()=>{throw Error('model-receipt-changed');};ctx.key=randomUUID();const next=admit(ctx);expect((await ctx.manager.run(ctx.owner,next.id)).state).toBe('failed');expect(ctx.launches()).toBe(1);expect(ctx.manager.status().inferenceReady).toBe(true);});
  it('does not allow another owner to take over a failed update barrier',async()=>{const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);ctx.manager.worker.ledger.submit(job());ctx.key=randomUUID();const next=admit(ctx);await ctx.manager.run(ctx.owner,next.id);const token=ctx.manager.worker.ledger.maintenance().token;const other=randomUUID(),attempt=ctx.manager.admit({owner:other,key:randomUUID(),packageId:EVALUATION_PACKAGE});await ctx.manager.run(other,attempt.id);expect(ctx.manager.worker.ledger.maintenance().token).toBe(token);expect(ctx.db.prepare('SELECT owner FROM activation_guard').get().owner).toBe(ctx.owner);});
  it('reconciles a committed acknowledgement with a retained barrier on explicit owner replay',async()=>{const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);const token=randomUUID();ctx.manager.worker.ledger.beginMaintenance(token,'update');ctx.db.prepare("INSERT INTO activation_guard VALUES(1,?,'update',?,?)").run(token,op.id,ctx.owner);ctx.manager.worker.ledger.close();ctx.manager.worker=null;await ctx.manager.restore();expect(ctx.manager.status().state).toBe('maintenance');expect((await ctx.manager.run(ctx.owner,op.id)).state).toBe('installed');expect(ctx.manager.status().inferenceReady).toBe(true);expect(ctx.db.prepare('SELECT count(*) n FROM activations').get().n).toBe(1);});
  it('keeps the previous pointer and closed admission when candidate and rollback startup both fail',async()=>{const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);ctx.manager.start=async()=>{throw Error('runtime unavailable');};ctx.key=randomUUID();const next=admit(ctx);expect((await ctx.manager.run(ctx.owner,next.id)).state).toBe('failed');expect(ctx.manager.status().state).toBe('recovery-required');expect(ctx.manager.status().inferenceReady).toBe(false);expect(ctx.db.prepare('SELECT receipt FROM active_worker').get().receipt).toBe(MODEL_RECEIPT_HASH);const ledger=new Ledger(ctx.files.resolve('generation/ledger.sqlite'));expect(ledger.maintenance()).not.toBeNull();ledger.close();});
  it.each(['packageId','receipt','profile'])('rejects a verifier returning the wrong %s before stopping the active worker',async field=>{
    const ctx=make(),first=admit(ctx);await ctx.manager.run(ctx.owner,first.id);const worker=ctx.manager.worker;
    ctx.manager.verify=async()=>({...managedPackageIdentity(EVALUATION_PACKAGE),packageRoot:ctx.root,[field]:'different'});
    ctx.key=randomUUID();const candidate=admit(ctx);expect((await ctx.manager.run(ctx.owner,candidate.id)).state).toBe('failed');
    expect(ctx.manager.worker).toBe(worker);expect(ctx.launches()).toBe(1);expect(ctx.manager.status().inferenceReady).toBe(true);expect(worker.ledger.maintenance()).toBeNull();
  });
  it('rejects an unknown package before admitting a journal entry or reading files',async()=>{
    const ctx=make();expect(()=>ctx.manager.admit({owner:ctx.owner,key:ctx.key,packageId:'unverified-link'})).toThrow('activation-package-unavailable');
    expect(ctx.db.prepare('SELECT count(*) n FROM activations').get().n).toBe(0);
    await expect(verifyModel(ctx.files,{packageId:'unverified-link'})).rejects.toThrow('activation-package-unavailable');
  });
  it.each([false,true])('refuses historical activation replay after another package became active (worker stopped: %s)',async stopped=>{
    const ctx=make(),first=admit(ctx);await ctx.manager.run(ctx.owner,first.id);
    // Synthetic second identity exercises switching semantics only. Production
    // registry still contains just the physically verified Q4 package.
    const second={packageId:'fixture-second-profile',receipt:'b'.repeat(64),profile:'c'.repeat(64)};
    ctx.manager.identity=id=>id===second.packageId?second:managedPackageIdentity(id);
    ctx.manager.verify=async(_files,{packageId})=>({...ctx.manager.identity(packageId),packageRoot:ctx.root});
    const appFence={id:randomUUID(),from:ctx.manager.model.profile,target:second.profile,ledgerIdentity:ctx.manager.worker.ledger.identity};
    const next=ctx.manager.admit({owner:ctx.owner,key:randomUUID(),packageId:second.packageId,appFence});expect((await ctx.manager.run(ctx.owner,next.id)).state).toBe('installed');
    const token=randomUUID();ctx.manager.worker.ledger.beginMaintenance(token,'update');ctx.db.prepare("INSERT INTO activation_guard VALUES(1,?,'update',?,?)").run(token,next.id,ctx.owner);
    if(stopped){await ctx.manager.worker.close({token});ctx.manager.worker=null;}
    await expect(ctx.manager.run(ctx.owner,first.id)).rejects.toThrow('activation-no-longer-active');
    expect(ctx.launches()).toBe(2);expect(ctx.manager.active().package_id).toBe(second.packageId);expect(ctx.db.prepare('SELECT token FROM activation_guard').get().token).toBe(token);
    if(!stopped)expect(ctx.manager.worker.ledger.maintenance().token).toBe(token);
  });
  it.each([false,true])('keeps the committed worker when maintenance cleanup fails (barrier already removed: %s)',async removed=>{
    const ctx=make(),original=ctx.manager.start;ctx.manager.start=async config=>{
      const worker=await original(config),end=worker.ledger.endMaintenance.bind(worker.ledger);let fail=true;
      worker.ledger.endMaintenance=token=>{if(fail){fail=false;if(removed)end(token);throw Error('cleanup failure');}return end(token);};return worker;
    };
    const op=admit(ctx);expect((await ctx.manager.run(ctx.owner,op.id)).state).toBe('installed');
    expect(ctx.manager.worker).not.toBeNull();expect(ctx.launches()).toBe(1);expect(ctx.manager.active().receipt).toBe(MODEL_RECEIPT_HASH);
    expect(ctx.manager.status().inferenceReady).toBe(removed);expect(ctx.db.prepare('SELECT count(*) n FROM activation_guard').get().n).toBe(1);
    expect((await ctx.manager.run(ctx.owner,op.id)).state).toBe('installed');expect(ctx.manager.status().inferenceReady).toBe(true);
    expect(ctx.db.prepare('SELECT count(*) n FROM activation_guard').get().n).toBe(0);expect(ctx.launches()).toBe(1);
  });
  it('does not restore a verifier result that differs from the durable package',async()=>{
    const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);await ctx.manager.shutdown();
    const restored=new ActivationManager(ctx.config,ctx.db,{files:ctx.files,start:ctx.manager.start,verify:async()=>({...managedPackageIdentity(EVALUATION_PACKAGE),profile:'wrong',packageRoot:ctx.root})});ctx.manager=restored;
    await restored.restore();expect(restored.status().state).toBe('recovery-required');expect(restored.status().inferenceReady).toBe(false);expect(ctx.launches()).toBe(1);
  });
  it('reports readiness false when the durable pointer differs from the loaded package',async()=>{
    const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);ctx.db.prepare('UPDATE active_worker SET receipt=?').run('b'.repeat(64));
    expect(ctx.manager.status().inferenceReady).toBe(false);await expect(ctx.manager.run(ctx.owner,op.id)).rejects.toThrow('activation-no-longer-active');
  });
  it('requires and freezes an app fence before a different package can stop the worker',async()=>{
    const ctx=make(),op=admit(ctx);await ctx.manager.run(ctx.owner,op.id);
    const second={packageId:'fixture-second',receipt:'b'.repeat(64),profile:'c'.repeat(64)},original=managedPackageIdentity(EVALUATION_PACKAGE);
    ctx.manager.identity=id=>id===second.packageId?second:managedPackageIdentity(id);
    const body={owner:ctx.owner,key:randomUUID(),packageId:second.packageId};
    expect(()=>ctx.manager.admit(body)).toThrow('activation-app-fence-required');expect(ctx.launches()).toBe(1);
    const appFence={id:randomUUID(),from:original.profile,target:second.profile,ledgerIdentity:ctx.manager.worker.ledger.identity};
    expect(()=>ctx.manager.admit({...body,appFence:{...appFence,ledgerIdentity:randomUUID()}})).toThrow('activation-app-fence-changed');
    const accepted=ctx.manager.admit({...body,appFence});expect(ctx.manager.admit({...body,appFence}).id).toBe(accepted.id);
    expect(()=>ctx.manager.admit({...body,appFence:{...appFence,id:randomUUID()}})).toThrow('activation-idempotency-conflict');
    expect(()=>ctx.db.prepare('UPDATE activations SET app_fence=null WHERE id=?').run(accepted.id)).toThrow('activation-identity-immutable');
    ctx.manager.verify=async()=>({...second,packageRoot:ctx.root});
    // Recheck the fence immediately before stopping: admission is not readiness.
    ctx.manager.model={...ctx.manager.model,profile:'d'.repeat(64)};
    expect((await ctx.manager.run(ctx.owner,accepted.id)).state).toBe('failed');expect(ctx.launches()).toBe(1);
  });
  it('acknowledges a same-key failed retry as admitted before asynchronous execution begins',async()=>{
    const ctx=make(),op=admit(ctx);ctx.manager.verify=async()=>{throw Error('fixture failure');};
    expect((await ctx.manager.run(ctx.owner,op.id)).state).toBe('failed');
    expect(admit(ctx)).toMatchObject({id:op.id,state:'admitted',error:null});
    expect(ctx.db.prepare('SELECT count(*) n FROM activations').get().n).toBe(1);
  });
});
describe('Self-contained immutable worker bundle',()=>{
  it('includes the decoder and rejects additional executable content',()=>{
    const ctx=make(),bundle=packageWorker(ctx.files);expect(ctx.files.exists(`code/${bundle.fingerprint}/src/modules/model-providers/local/png.ts`)).toBe(true);
    expect(packageWorker(ctx.files).fingerprint).toBe(bundle.fingerprint);ctx.files.write(`code/${bundle.fingerprint}/unexpected.mjs`,Buffer.from('unexpected'),true);expect(()=>packageWorker(ctx.files)).toThrow('host-code-changed');
  },20000);
  it('rejects a changed model receipt before starting inference',async()=>{const ctx=make();ctx.files.directory(MODEL_VERSION);ctx.files.atomicJSON(`${MODEL_VERSION}/.receipt.json`,{...MODEL_RECEIPT,publicApproved:true});await expect(verifyModel(ctx.files)).rejects.toThrow('model-receipt-changed');},20000);
  it('rejects extra executable content and missing model components',async()=>{const ctx=make();ctx.files.directory(MODEL_VERSION);ctx.files.atomicJSON(`${MODEL_VERSION}/.receipt.json`,MODEL_RECEIPT);ctx.files.write(`${MODEL_VERSION}/unexpected.exe`,Buffer.from('unexpected'),true);await expect(verifyModel(ctx.files)).rejects.toThrow('model-package-changed');},20000);
  it('checks actual component bytes rather than trusting a matching receipt',async()=>{const ctx=make();ctx.files.directory(MODEL_VERSION);ctx.files.atomicJSON(`${MODEL_VERSION}/.receipt.json`,MODEL_RECEIPT);for(const entry of MODEL_RECEIPT.files){ctx.files.directory(`${MODEL_VERSION}/${path.posix.dirname(entry.path)}`);ctx.files.write(`${MODEL_VERSION}/${entry.path}`,Buffer.from('corrupt'),true);}await expect(verifyModel(ctx.files)).rejects.toThrow('model-package-changed');},20000);
});
