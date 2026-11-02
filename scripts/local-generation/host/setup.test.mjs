// @vitest-environment node
import { it,expect,afterEach,vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync,rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import os from 'node:os';import path from 'node:path';
import { SetupManager } from './setup.mjs';
import { PackageInstaller } from '../install/transaction.mjs';
import { sha } from '../install/manifest.mjs';
const contexts=[];

it('installs alongside a different active package without bypassing fenced switching',async()=>{
 const c=fixture();c.activation.model={deliveryManifest:'other-manifest',profile:'different-active-profile'};
 const operation=await c.manager.admit(c.body);await c.manager.run(c.owner,operation.id);
 expect(c.manager.installer.status(c.owner,operation.id).state).toBe('installed');
 expect(c.activation.admit).not.toHaveBeenCalled();expect(c.activation.model.deliveryManifest).toBe('other-manifest');expect(c.manager.access(c.owner)).toBe(false);
 expect(await c.manager.snapshot(c.owner)).toMatchObject({installed:true,active:false,switchRequired:true,ready:false,accepted:true});
 expect(await c.manager.snapshot(randomUUID())).toMatchObject({installed:false,ready:false,accepted:false});
});
afterEach(()=>{for(const ctx of contexts.splice(0)){ctx.manager.initializing=false;ctx.manager.pending=null;ctx.manager.close();ctx.db.close();rmSync(ctx.root,{recursive:true,force:true});}});
function fixture(){
  const data=Buffer.from('fixture model'),manifest={schema:1,id:'qwen-2-1-research-delivery-v1',publicApproved:false,noticesVerified:true,termsDigest:sha('terms'),artifacts:[{id:'model',role:'test-fixture',revision:'a'.repeat(40),url:'https://example.com/model',hosts:['example.com'],bytes:data.length,sha256:sha(data),destination:'weights/model.gguf'}]};
  const root=mkdtempSync(path.join(os.tmpdir(),'kavero-setup-')),db=new DatabaseSync(':memory:');db.exec('CREATE TABLE activations(owner TEXT,submission_key TEXT,state TEXT,error TEXT)');
  const transport=vi.fn(async()=>({status:200,headers:{etag:'"fixture"'},body:(async function*(){yield data;})(),dispose(){}}));
  const installer=new PackageInstaller({root,instanceId:randomUUID(),catalog:[manifest],purpose:'internal-evaluation',dependencies:{protect:()=>{},transport,inspectProcess:async pid=>({pid,creation:'1'})}});
  const activation={model:null,status:()=>({inferenceReady:!!activation.model}),admit:vi.fn(()=>({id:randomUUID()})),run:vi.fn(async()=>{activation.model={deliveryManifest:manager.verified.hash};})};
  const hardware=vi.fn(async()=>({freeVramMiB:7000,freeRamBytes:12*1024**3})),manager=new SetupManager({root,instanceId:installer.files.instanceId,secret:'a'.repeat(64),internalEvaluation:true},db,activation,{installer,manifest,hardware});manager.initializing=false;
  const owner=randomUUID(),body={owner,key:randomUUID(),accepted:true,purpose:'research-evaluation',manifest:manager.verified.hash,termsDigest:manifest.termsDigest,consentToken:manager.consentToken(owner)};
  const ctx={root,db,manager,activation,hardware,transport,owner,body};contexts.push(ctx);return ctx;
}
it('rejects missing consent, changed terms, other-owner tokens and unknown wire fields before network or consent recording',async()=>{
  const c=fixture();for(const change of [{accepted:false},{purpose:'commercial'},{termsDigest:'b'.repeat(64)},{consentToken:c.manager.consentToken(randomUUID())},{url:'https://example.com'}])await expect(c.manager.admit({...c.body,...change})).rejects.toThrow();
  expect(c.transport).not.toHaveBeenCalled();expect(c.db.prepare('SELECT count(*) n FROM setup_consents').get().n).toBe(0);
});
it('checks supported hardware before persisting consent and refuses policy-disabled setup',async()=>{
  const c=fixture();c.hardware.mockRejectedValue(Error('unsupported'));await expect(c.manager.admit(c.body)).rejects.toThrow('setup-hardware-unsupported');expect(c.db.prepare('SELECT count(*) n FROM setup_consents').get().n).toBe(0);
  c.manager.config.internalEvaluation=false;await expect(c.manager.admit(c.body)).rejects.toThrow('setup-unavailable');expect(c.transport).not.toHaveBeenCalled();
});
it('deduplicates lost admission acknowledgements, fences shutdown and isolates status/cancel/access by owner',async()=>{
  const c=fixture(),op=await c.manager.admit(c.body);expect((await c.manager.admit(c.body)).id).toBe(op.id);expect(()=>c.manager.close()).toThrow('setup-busy');
  const other=randomUUID();expect(c.manager.operation(other,op.id)).toBeNull();expect(c.manager.cancel(other,op.id)).toBeNull();expect(c.manager.access(other)).toBe(false);
  await c.manager.run(c.owner,op.id);expect(c.manager.access(c.owner)).toBe(true);expect(c.manager.access(other)).toBe(false);
  expect((await c.manager.admit(c.body)).id).toBe(op.id);await c.manager.run(c.owner,op.id);expect(c.transport).toHaveBeenCalledTimes(1);expect(c.activation.run).toHaveBeenCalledTimes(1);
});
it('requires separate second-owner consent while reusing a verified installed version without restarting inference',async()=>{
  const c=fixture(),op=await c.manager.admit(c.body);await c.manager.run(c.owner,op.id);const owner=randomUUID();
  const second=await c.manager.admit({...c.body,owner,key:randomUUID(),consentToken:c.manager.consentToken(owner)});await c.manager.run(owner,second.id);
  expect(c.manager.access(owner)).toBe(true);expect(c.transport).toHaveBeenCalledTimes(1);expect(c.activation.run).toHaveBeenCalledTimes(1);
});
it('keeps cancelled submissions as tombstones and never restarts their download',async()=>{
  const c=fixture(),op=await c.manager.admit(c.body);expect(c.manager.cancel(c.owner,op.id).state).toBe('cancelled');await c.manager.run(c.owner,op.id);
  expect((await c.manager.admit(c.body)).state).toBe('cancelled');await c.manager.run(c.owner,op.id);expect(c.transport).not.toHaveBeenCalled();expect(c.activation.run).not.toHaveBeenCalled();
});
it('requires explicit same-key retry after failure and rejects stale tokens for new acknowledgements',async()=>{
  const c=fixture();await expect(c.manager.admit({...c.body,consentToken:c.manager.consentToken(c.owner,Date.now()-21*60*1000)})).rejects.toThrow('setup-terms-changed');
  c.transport.mockRejectedValueOnce(Error('disconnect'));const op=await c.manager.admit(c.body);await expect(c.manager.run(c.owner,op.id)).rejects.toThrow();expect(c.manager.operation(c.owner,op.id).state).toBe('failed');
  expect((await c.manager.admit({...c.body,consentToken:'expired'})).id).toBe(op.id);await c.manager.run(c.owner,op.id);expect(c.manager.access(c.owner)).toBe(true);
});
it('does not turn a legacy worker into consent-backed delivery access',async()=>{const c=fixture();c.activation.model={deliveryManifest:'legacy'};const op=await c.manager.admit(c.body);expect(c.manager.access(c.owner)).toBe(false);await c.manager.run(c.owner,op.id);expect(c.manager.access(c.owner)).toBe(true);});
it('fences parallel hardware admission and never records a competing acknowledgement while another install is pending',async()=>{
 const c=fixture();let release;c.hardware.mockImplementationOnce(()=>new Promise(resolve=>release=resolve));const admitting=c.manager.admit(c.body),other=randomUUID(),second={...c.body,owner:other,key:randomUUID(),consentToken:c.manager.consentToken(other)};
 await expect(c.manager.admit(second)).rejects.toThrow('setup-busy');expect(()=>c.manager.close()).toThrow('setup-busy');release({});const op=await admitting;
 await expect(c.manager.admit(second)).rejects.toThrow('setup-busy');expect(c.db.prepare('SELECT count(*) n FROM setup_consents').get().n).toBe(1);await c.manager.run(c.owner,op.id);
});
it('does not clear another owner\'s pending install when replaying an already usable operation',async()=>{
 const c=fixture(),first=await c.manager.admit(c.body);await c.manager.run(c.owner,first.id);const owner=randomUUID(),second=await c.manager.admit({...c.body,owner,key:randomUUID(),consentToken:c.manager.consentToken(owner)});
 await c.manager.run(c.owner,first.id);expect(c.manager.pending).toBe(second.id);expect(()=>c.manager.close()).toThrow('setup-busy');await c.manager.run(owner,second.id);expect(c.manager.access(owner)).toBe(true);
});
it('returns fixed compatibility reasons and sanitized detected hardware before download',async()=>{
 const c=fixture();c.hardware.mockRejectedValueOnce(Object.assign(Error('private-path'),{compatibility:'gpu-too-small'}));expect(await c.manager.snapshot(c.owner)).toMatchObject({supported:false,available:false,compatibility:'gpu-too-small'});
 c.hardware.mockResolvedValueOnce({name:'NVIDIA GeForce RTX 4070',totalVramMiB:12288,totalRamBytes:32*1024**3,freeVramMiB:11000,freeRamBytes:12*1024**3,confidence:'unbenchmarked',identity:{private:'hidden'},binding:'secret-device-binding'});const snapshot=await c.manager.snapshot(c.owner);expect(snapshot).toMatchObject({supported:true,compatibility:'eligible',hardware:{gpuName:'NVIDIA GeForce RTX 4070',confidence:'unbenchmarked'}});expect(snapshot.hardware.identity).toBeUndefined();expect(snapshot.hardware.binding).toBeUndefined();expect(c.transport).not.toHaveBeenCalled();
});
