// @vitest-environment node
import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';import os from 'node:os';
import {InstallFiles} from './install/filesystem.mjs';
import {ModelImportStore,ModelImportService} from './model-imports.mjs';
import {normalizeModelLink} from './model-discovery.mjs';
const contexts=[];
afterEach(()=>{for(const ctx of contexts.splice(0)){ctx.store.close();rmSync(ctx.root,{recursive:true,force:true});}});
function fixture(){
 const root=mkdtempSync(path.join(os.tmpdir(),'kavero-model-import-')),files=new InstallFiles(root,randomUUID(),{protect:()=>{}}),store=new ModelImportStore(files);
 const ctx={root,files,store,owner:randomUUID(),other:randomUUID(),key:randomUUID(),input:{id:'model',source:'https://huggingface.co/owner/model'}};
 contexts.push(ctx);return ctx;
}
function snapshot(input,extra={}){const request=normalizeModelLink(input);return {schemaVersion:1,source:request.source,requestedRevision:request.requestedRevision,revision:'a'.repeat(40),installable:false,ready:false,recipeSupport:'unsupported-runtime',...extra};}
describe('Owner-bound immutable model imports',()=>{
 it('captures the submitted link before deferred discovery',async()=>{
  const c=fixture(),original={...c.input},service=new ModelImportService(c.store,{discover:async input=>snapshot(input)});
  const pending=service.import(c.owner,c.key,c.input);c.input.source='https://huggingface.co/other/model';
  expect((await pending).snapshot.source.source).toBe(original.source);
 });
 it('isolates read/list/finish and permits independent owner submission keys',()=>{
  const c=fixture(),row=c.store.reserve(c.owner,c.key,c.input);
  expect(c.store.get(c.other,row.id)).toBeNull();expect(c.store.list(c.other)).toEqual([]);
  expect(()=>c.store.finish(c.other,row.id,snapshot(c.input))).toThrow('model-import-not-found');
  const b=c.store.reserve(c.other,c.key,c.input);expect(b.id).not.toBe(row.id);
  expect(c.store.list(c.owner).map(r=>r.id)).toEqual([row.id]);
 });
 it('deduplicates same-key replay and rejects changed source/model/variant before discovery',async()=>{
  const c=fixture(),discover=vi.fn(async input=>snapshot(input)),service=new ModelImportService(c.store,{discover});
  const first=await service.import(c.owner,c.key,c.input),replay=await service.import(c.owner,c.key,c.input);expect(replay).toEqual(first);expect(discover).toHaveBeenCalledOnce();
  await expect(service.import(c.owner,c.key,{...c.input,preferredFile:'other.gguf'})).rejects.toThrow('model-import-idempotency-conflict');
  expect(discover).toHaveBeenCalledOnce();
 });
 it('keeps immutable snapshots across refresh, restart and same-key retry',async()=>{
  const c=fixture();let revision='a'.repeat(40);const service=new ModelImportService(c.store,{discover:async input=>snapshot(input,{revision})});
  const first=await service.import(c.owner,c.key,c.input);revision='b'.repeat(40);
  const second=await service.import(c.owner,randomUUID(),c.input);expect(second.snapshot.revision).not.toBe(first.snapshot.revision);
  c.store.close();c.store=new ModelImportStore(c.files);
  expect(c.store.get(c.owner,first.id)).toEqual(first);
  const rerun=new ModelImportService(c.store,{discover:()=>{throw Error('must not inspect again');}});
  expect(await rerun.import(c.owner,c.key,c.input)).toEqual(first);
  expect(()=>c.store.db.prepare('UPDATE model_imports SET snapshot_json=? WHERE id=?').run('{}',first.id)).toThrow('model-import-immutable');
 });
 it('fences concurrent duplicate imports and limits competing inspections',async()=>{
  const c=fixture(),resolvers=[];const discover=vi.fn(input=>new Promise(resolve=>resolvers.push(()=>resolve(snapshot(input)))));
  const service=new ModelImportService(c.store,{discover});
  const first=service.import(c.owner,c.key,c.input),duplicate=service.import(c.owner,c.key,c.input),other=service.import(c.other,randomUUID(),c.input);
  await expect(service.import(c.owner,randomUUID(),c.input)).rejects.toThrow('model-discovery-busy');
  await Promise.resolve();expect(discover).toHaveBeenCalledTimes(2);for(const resolve of resolvers)resolve();
  expect(await duplicate).toEqual(await first);await other;expect(service.inflight.size).toBe(0);
 });
 it('recovers pending read-only inspection and clears synchronous failures',async()=>{
  const c=fixture();const row=c.store.reserve(c.owner,c.key,c.input);c.store.close();c.store=new ModelImportStore(c.files);
  const discover=vi.fn().mockImplementationOnce(()=>{throw Error('disconnected');}).mockImplementation(async input=>snapshot(input));
  const service=new ModelImportService(c.store,{discover});await expect(service.import(c.owner,c.key,c.input)).rejects.toThrow('disconnected');expect(service.inflight.size).toBe(0);
  expect((await service.import(c.owner,c.key,c.input)).id).toBe(row.id);expect(c.store.list(c.owner)).toHaveLength(1);
 });
 it('enforces per-owner rate limits while allowing completed retry replay',async()=>{
  const c=fixture();let time=0;const service=new ModelImportService(c.store,{discover:async input=>snapshot(input),now:()=>time});
  const first=await service.import(c.owner,c.key,c.input);for(let i=0;i<5;i++)await service.import(c.owner,randomUUID(),c.input);
  await expect(service.import(c.owner,randomUUID(),c.input)).rejects.toThrow('model-discovery-busy');
  expect(await service.import(c.owner,c.key,c.input)).toEqual(first);time=60001;await expect(service.import(c.owner,randomUUID(),c.input)).resolves.toBeDefined();
 });
 it('refuses oversized, mismatched and accidentally runnable snapshots',()=>{
  const c=fixture(),row=c.store.reserve(c.owner,c.key,c.input);
  for(const extra of [{installable:true},{ready:true},{source:{...c.input,id:'other'}},{requestedRevision:'other'},{readme:'x'.repeat(2*1024**2)}])expect(()=>c.store.finish(c.owner,row.id,snapshot(c.input,extra))).toThrow();
  expect(c.store.get(c.owner,row.id).state).toBe('inspecting');
 });
 it('enforces owner storage quotas and rejects invalid owner/key identifiers',()=>{
  const c=fixture();for(let i=0;i<100;i++)c.store.reserve(c.owner,randomUUID(),c.input);
  expect(()=>c.store.reserve(c.owner,randomUUID(),c.input)).toThrow('model-import-limit');
  expect(()=>c.store.list('bad-owner')).toThrow();expect(()=>c.store.reserve(c.owner,'bad-key',c.input)).toThrow();
 });
});
