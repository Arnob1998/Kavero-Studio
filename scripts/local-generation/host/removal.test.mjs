// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import os from 'node:os';import path from 'node:path';
import {initializeHost} from './bootstrap.mjs';
import {ActivationManager} from './activation.mjs';
import {NativeRemovalManager} from './removal.mjs';
import {SetupManager} from './setup.mjs';
import {SetupHub} from './setup-hub.mjs';
import {PackageInstaller} from '../install/transaction.mjs';
import {sha} from '../install/manifest.mjs';
import {Ledger,intentHash} from '../ledger.mjs';
import {EVALUATION_PACKAGE} from './model-package.mjs';
import {RemovalWire} from './removal-wire.mjs';
const contexts=[];
afterEach(()=>{for(const c of contexts.splice(0)){c.activation.worker?.ledger.close();for(const m of c.setup.managers.values())m.installer.close();c.db.close();rmSync(c.root,{recursive:true,force:true});}});
async function make({active=true,dependencies={}}={}){
  const root=mkdtempSync(path.join(os.tmpdir(),'kavero-native-removal-')),base=initializeHost(root,{protect:()=>{}}),config={...base.config,internalEvaluation:true},db=new DatabaseSync(':memory:');
  const manifests=new Map(),identity=id=>({packageId:id,receipt:sha(id),profile:'a'.repeat(64)});
  const activation=new ActivationManager(config,db,{files:base.files,identity,verify:async(_files,{packageId})=>({...identity(packageId),deliveryManifest:setup.manager().verified.hash,packageRoot:root}),start:async()=>{const ledger=new Ledger(base.files.resolve('generation/ledger.sqlite'));return {ledger,async close({token}){ledger.assertQuiescent(token);ledger.close();}};}});
  const setup=new SetupHub(config,db,activation,{factory:packageId=>{
    const data=Buffer.from(packageId),manifest={schema:1,id:packageId,publicApproved:false,noticesVerified:true,termsDigest:sha('terms'),artifacts:[{id:'fixture',role:'test-fixture',revision:'b'.repeat(40),url:'https://example.com/model',hosts:['example.com'],bytes:data.length,sha256:sha(data),destination:'weights/model.gguf'}]};manifests.set(packageId,manifest);
    const installer=new PackageInstaller({root:path.join(root,'delivery'),instanceId:config.instanceId,catalog:[manifest],purpose:'internal-evaluation',dependencies:{protect:()=>{},inspectProcess:async pid=>({pid,creation:'1'}),transport:async()=>({status:200,headers:{etag:'"fixture"'},body:(async function*(){yield data;})(),dispose(){}})}});
    const manager=new SetupManager(config,db,activation,{packageId,installer,manifest,hardware:async()=>({freeVramMiB:8000,freeRamBytes:16*1024**3})});manager.initializing=false;return manager;
  }});
  const native=new NativeRemovalManager(config,db,activation,setup),manager=setup.manager(),owner=randomUUID(),body={owner,key:randomUUID(),accepted:true,purpose:'research-evaluation',manifest:manager.verified.hash,termsDigest:manager.verified.manifest.termsDigest,consentToken:manager.consentToken(owner)};
  native.remover.dependencies=dependencies;
  const c={root,config,db,activation,setup,native,manager,owner,body};contexts.push(c);
  const op=await setup.admit(body);if(active)await setup.run(owner,op.id);else {manager.pending=null;await manager.installer.run(owner,op.id);}c.op=op;return c;
}
const admit=c=>c.native.admit({owner:c.owner,key:randomUUID(),packageId:EVALUATION_PACKAGE});
function submit(ledger,state){const intent={profile:'qwen-image-2.1-q4-evaluation',prompt:'Preserve job',width:512,height:512,count:1},job={id:randomUUID(),owner:randomUUID(),key:randomUUID(),intent,hash:intentHash(intent),fingerprint:'a'.repeat(64),device:'fixture'};ledger.submit(job);if(state!=='queued'){const claim=ledger.claimNext(randomUUID(),randomUUID());ledger.supervisorStart(claim.id,claim.claim,claim.epoch,123,'fixture');if(state==='submission-unknown')ledger.stale(Date.now()+31000);}return job;}

describe('Native removal lifecycle',()=>{
  it('removes only one account while keeping the shared worker/files, supports re-add, then reclaims on last removal',async()=>{
    const c=await make(),other=randomUUID(),body={...c.body,owner:other,key:randomUUID(),consentToken:c.manager.consentToken(other)};
    const second=await c.setup.admit(body);await c.setup.run(other,second.id);
    expect(c.manager.access(other)).toBe(true);
    const worker=c.activation.worker,active=c.activation.active(),version=`versions/${c.manager.verified.hash}`;
    const wire=new RemovalWire(c.native),fields={owner:c.owner,instanceId:c.config.instanceId,packageId:EVALUATION_PACKAGE,manifest:c.manager.verified.hash};
    expect((await wire.handle('/host/removal/review',fields)).body.review).toMatchObject({canRemove:true,accountOnly:true,reclaimableBytes:0});
    const op=admit(c),result=await c.native.run(c.owner,op.id);
    expect(result).toMatchObject({state:'removed',accountOnly:true,reclaimedBytes:0});
    expect(result.retainedBytes).toBeGreaterThan(0);expect(c.activation.worker).toBe(worker);expect(c.activation.active()).toEqual(active);
    expect(worker.ledger.maintenance()).toBeNull();expect(c.manager.access(other)).toBe(true);expect(c.manager.access(c.owner)).toBe(false);
    expect(await c.manager.snapshot(c.owner)).toMatchObject({installed:false,active:false,ready:false});
    expect(await c.manager.installer.verifyVersion(version,c.manager.verified)).toBe(true);
    await c.activation.shutdown();c.activation.stopping=false;await c.activation.restore();expect(c.manager.access(other)).toBe(true);expect(c.manager.access(c.owner)).toBe(false);
    const fresh=await c.setup.admit({...c.body,key:randomUUID()});await c.setup.run(c.owner,fresh.id);expect(c.manager.access(c.owner)).toBe(true);
    expect((await c.native.run(c.owner,op.id)).accountOnly).toBe(true);expect(c.manager.access(c.owner)).toBe(true);
    await c.native.run(c.owner,admit(c).id);
    const last=c.native.admit({owner:other,key:randomUUID(),packageId:EVALUATION_PACKAGE});
    expect(await c.native.run(other,last.id)).toMatchObject({state:'removed',accountOnly:false});
    expect(c.activation.worker).toBeNull();expect(c.manager.installer.files.exists(version)).toBe(false);
    expect((await c.native.run(c.owner,op.id)).accountOnly).toBe(true);
  });
  it('binds wire removal to installation, manifest, app fence and original key; recovers GET status and reinstalls',async()=>{
    const c=await make(),wire=new RemovalWire(c.native),fields={owner:c.owner,instanceId:c.config.instanceId,packageId:EVALUATION_PACKAGE,manifest:c.manager.verified.hash};
    const review=await wire.handle('/host/removal/review',fields);expect(review.body.review.canRemove).toBe(true);expect(review.body.review.reclaimableBytes).toBeGreaterThan(0);
    const body={...fields,key:randomUUID(),appFence:randomUUID()};
    const originalRun=c.native.run.bind(c.native);c.native.run=async()=>{};
    expect((await wire.handle('/host/removal/start',body)).status).toBe(202);
    await new Promise(resolve=>setImmediate(resolve));
    expect((await wire.handle('/host/removal/status',body)).body.operation.state).toBe('interrupted');
    c.native.run=originalRun;expect((await wire.handle('/host/removal/start',body)).status).toBe(202);
    await vi.waitFor(async()=>{expect((await wire.handle('/host/removal/status',body)).body.operation.complete).toBe(true);});
    const completed=(await wire.handle('/host/removal/status',body)).body.operation;
    expect(completed).toMatchObject({state:'removed',appFence:body.appFence,key:body.key,instanceId:c.config.instanceId,manifest:fields.manifest});
    await expect(wire.handle('/host/removal/start',{...body,appFence:randomUUID()})).rejects.toThrow('removal-idempotency-conflict');
    const fresh=await c.setup.admit({...c.body,key:randomUUID()});await c.setup.run(c.owner,fresh.id);expect(c.manager.access(c.owner)).toBe(true);
    expect((await wire.handle('/host/removal/status',body)).body.operation).toEqual(completed);
  });
  it('rejects wire owner/root/manifest/field overrides and reports definite busy refusal without admission',async()=>{
    const c=await make(),wire=new RemovalWire(c.native),body={owner:c.owner,instanceId:c.config.instanceId,packageId:EVALUATION_PACKAGE,manifest:c.manager.verified.hash,key:randomUUID(),appFence:randomUUID()};
    for(const change of [{instanceId:randomUUID()},{manifest:'f'.repeat(64)},{path:'../weights'},{appFence:null}])await expect(wire.handle('/host/removal/start',{...body,...change})).rejects.toThrow();
    expect((await wire.handle('/host/removal/status',{...body,owner:randomUUID()})).status).toBe(404);
    c.manager.busy=true;expect(await wire.handle('/host/removal/start',body)).toMatchObject({status:409,body:{rejected:true}});c.manager.busy=false;
    expect(c.native.remover.store.db.prepare('SELECT count(*) n FROM removals').get().n).toBe(0);
  });
  it('removes an idle active package and reinstalls under a fresh consent operation',async()=>{
    const c=await make(),op=admit(c);expect(c.manager.access(c.owner)).toBe(false);
    expect((await c.native.run(c.owner,op.id)).state).toBe('removed');expect(c.activation.worker).toBeNull();expect(c.activation.active()).toBeUndefined();expect(c.native.blocking).toBe(false);
    expect(await c.manager.snapshot(c.owner)).toMatchObject({installed:false,active:false,ready:false,accepted:true});
    expect(()=>c.activation.admit({owner:c.owner,key:randomUUID(),packageId:EVALUATION_PACKAGE})).toThrow('activation-package-unavailable');
    const body={...c.body,key:randomUUID()},fresh=await c.setup.admit(body);await c.setup.run(c.owner,fresh.id);
    expect(c.manager.access(c.owner)).toBe(true);expect(c.db.prepare('SELECT count(*) n FROM setup_consents').get().n).toBe(2);
    expect((await c.native.run(c.owner,op.id)).state).toBe('removed');expect(c.manager.access(c.owner)).toBe(true);
  });
  it.each(['queued','running','submission-unknown'])('refuses %s work without deleting files or stranding the queue',async state=>{
    const c=await make(),ledger=c.activation.worker.ledger,job=submit(ledger,state),op=admit(c);
    await expect(c.native.run(c.owner,op.id)).rejects.toThrow('worker-jobs-outstanding');
    expect(ledger.maintenance()).toBeNull();expect(ledger.get(job.owner,job.id).state).toBe(state);expect(c.manager.installer.status(c.owner,c.op.id).state).toBe('installed');
    expect(await c.manager.installer.verifyVersion(`versions/${c.manager.verified.hash}`,c.manager.verified)).toBe(true);
  });
  it.each(['busy','initializing','admitting','pending'])('refuses setup %s before admitting removal',async flag=>{
    const c=await make();c.manager[flag]=flag==='pending'?randomUUID():true;expect(()=>admit(c)).toThrow('removal-native-busy');c.manager[flag]=flag==='pending'?null:false;
  });
  it('refuses activation races and another operation maintenance token',async()=>{
    const c=await make();c.activation.busy=true;expect(()=>admit(c)).toThrow('removal-native-busy');c.activation.busy=false;
    const token=randomUUID();c.activation.worker.ledger.beginMaintenance(token,'update');const op=admit(c);
    await expect(c.native.run(c.owner,op.id)).rejects.toThrow('worker-maintenance-conflict');expect(c.activation.worker.ledger.maintenance().token).toBe(token);expect(c.db.prepare('SELECT * FROM activation_guard').get()).toBeUndefined();
  });
  it('keeps incomplete removal fenced across restart and resumes only on explicit same-operation retry',async()=>{
    let fail=true;const c=await make({dependencies:{afterUnlink(){if(fail){fail=false;throw Error('native interruption');}}}}),op=admit(c);
    await expect(c.native.run(c.owner,op.id)).rejects.toThrow('native interruption');expect(c.native.blocking).toBe(true);
    await expect(c.setup.admit({...c.body,key:randomUUID()})).rejects.toThrow('setup-busy');expect(()=>c.activation.admit({owner:c.owner,key:randomUUID(),packageId:EVALUATION_PACKAGE})).toThrow('activation-busy');
    await c.activation.shutdown();expect(c.db.prepare('SELECT purpose FROM activation_guard').get().purpose).toBe('removal');
    c.activation.stopping=false;await c.activation.restore();expect(c.activation.state).toBe('removal-recovery');expect(c.activation.worker).toBeNull();
    expect((await c.native.run(c.owner,op.id)).state).toBe('removed');expect(c.native.blocking).toBe(false);
  });
  it('cleans a retained barrier after committed removal acknowledgement was lost',async()=>{
    const c=await make(),op=admit(c);await c.native.run(c.owner,op.id);const token=randomUUID(),ledger=new Ledger(c.activation.files.resolve('generation/ledger.sqlite'));
    ledger.beginMaintenance(token,'removal');ledger.close();c.db.prepare("INSERT INTO activation_guard VALUES(1,?,'removal',?,?)").run(token,op.id,c.owner);
    await c.activation.restore();expect(c.activation.state).toBe('removal-recovery');await c.native.run(c.owner,op.id);expect(c.native.blocking).toBe(false);
  });
  it('allows normal shutdown after admission and restores with removal still paused',async()=>{
    const c=await make(),op=admit(c);await c.activation.shutdown();expect(c.activation.worker).toBeNull();
    c.activation.stopping=false;await c.activation.restore();expect(c.activation.state).toBe('removal-recovery');
    expect((await c.native.run(c.owner,op.id)).state).toBe('removed');
  });
  it('preserves another active model when removing an inactive package',async()=>{
    const c=await make({active:false});const other='other-active',ledger=new Ledger(c.activation.files.resolve('generation/ledger.sqlite'));
    c.activation.model={packageId:other,receipt:sha(other)};c.db.prepare('INSERT INTO active_worker VALUES(1,?,?)').run(other,sha(other));c.activation.worker={ledger,close(){throw Error('must preserve worker');}};
    const op=admit(c);await c.native.run(c.owner,op.id);expect(c.activation.active().package_id).toBe(other);expect(ledger.maintenance()).toBeNull();expect(c.activation.worker).not.toBeNull();
  });
  it('requires this owner consent before admitting any removal',async()=>{
    const c=await make();expect(()=>c.native.admit({owner:randomUUID(),key:randomUUID(),packageId:EVALUATION_PACKAGE})).toThrow('removal-not-owned');
  });
});
