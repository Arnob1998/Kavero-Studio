// @vitest-environment node
import {it,expect,afterEach,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {HostImports} from './imports.mjs';import {InstallFiles} from '../install/filesystem.mjs';
import {ModelImportStore,ModelImportService} from '../model-imports.mjs';import {normalizeModelLink} from '../model-discovery.mjs';
const contexts=[];
afterEach(async()=>{for(const c of contexts.splice(0)){await Promise.allSettled([...c.host.service.inflight.values()]);c.host.close();rmSync(c.root,{recursive:true,force:true});}});
function fixture(discover){
 const root=mkdtempSync(path.join(os.tmpdir(),'kavero-import-host-')),config={root,instanceId:randomUUID()},files=new InstallFiles(root,config.instanceId,{protect:()=>{}}),store=new ModelImportStore(files);
 const service=new ModelImportService(store,{discover}),host=new HostImports(config,{store,service});
 const c={root,config,files,host,owner:randomUUID(),other:randomUUID(),key:randomUUID(),model:{id:'example',source:'https://huggingface.co/owner/model'}};contexts.push(c);return c;
}
const snapshot=input=>({...normalizeModelLink(input),schemaVersion:1,sourceValidity:'valid',recipeSupport:'unsupported-runtime',revision:'a'.repeat(40),installable:false,ready:false,license:{identifier:'mit',sourceUrl:null,text:null,status:'declared-only'}});
it('acknowledges before discovery, deduplicates and conceals other-owner records',async()=>{
 let resolve;const discover=vi.fn(input=>new Promise(done=>{resolve=()=>done(snapshot(input));})),c=fixture(discover);
 const body={owner:c.owner,key:c.key,model:c.model},first=c.host.handle('/host/models/import',body);
 expect(first.status).toBe(202);expect(discover).not.toHaveBeenCalled();expect(first.body.model.state).toBe('inspecting');
 expect(c.host.handle('/host/models/import',body).body.model.id).toBe(first.body.model.id);
 expect(c.host.handle('/host/models/detail',{owner:c.other,id:first.body.model.id}).status).toBe(404);
 expect(c.host.handle('/host/models/license',{owner:c.other,id:first.body.model.id,component:'model'}).status).toBe(404);
 expect(c.host.handle('/host/models/list',{owner:c.other,offset:0}).body.models).toEqual([]);
 await Promise.resolve();resolve();await Promise.all([...c.host.service.inflight.values()]);
 expect(c.host.handle('/host/models/import',body).status).toBe(200);expect(discover).toHaveBeenCalledOnce();
});
it('reports pending imports as retry-required after restart and reuses their ID',async()=>{
 const c=fixture(async()=>{throw Error('transport-failed');}),body={owner:c.owner,key:c.key,model:c.model};
 const first=c.host.handle('/host/models/import',body);await Promise.allSettled([...c.host.service.inflight.values()]);await Promise.resolve();
 c.host.close();const store=new ModelImportStore(c.files);c.host=new HostImports(c.config,{store,service:new ModelImportService(store,{discover:async input=>snapshot(input)})});
 expect(c.host.handle('/host/models/detail',{owner:c.owner,id:first.body.model.id}).body.model.state).toBe('retry-required');
 expect(c.host.handle('/host/models/detail',{owner:c.owner,id:first.body.model.id}).body.model.key).toBe(c.key);
 expect(c.host.handle('/host/models/import',body).body.model.id).toBe(first.body.model.id);await Promise.all([...c.host.service.inflight.values()]);
 expect(c.host.handle('/host/models/detail',{owner:c.owner,id:first.body.model.id}).body.model.state).toBe('inspected');
});
it('paginates independent seeds/imports and rejects extra fields or invalid IDs',()=>{
 const c=fixture(async input=>snapshot(input));c.host.seeds=Array.from({length:8},(_,i)=>({id:'seed-'+i,source:c.model.source}));
 const first=c.host.handle('/host/models/list',{owner:c.owner,offset:0}).body,next=c.host.handle('/host/models/list',{owner:c.owner,offset:5}).body;
 expect(first.seeds).toHaveLength(5);expect(first.nextOffset).toBe(5);expect(next.seeds).toHaveLength(3);expect(next.nextOffset).toBeNull();
 for(const body of [{owner:c.owner,offset:-1},{owner:c.owner,offset:0,url:'evil'},{owner:'invalid',offset:0}])expect(()=>c.host.handle('/host/models/list',body)).toThrow();
 expect(()=>c.host.handle('/host/models/import',{owner:c.owner,key:c.key,model:c.model,snapshot:{ready:true}})).toThrow();
});
it('refuses close while an inspection is active and keeps one service-wide limit',async()=>{
 const resolves=[],c=fixture(input=>new Promise(resolve=>resolves.push(()=>resolve(snapshot(input)))));
 const first=c.host.handle('/host/models/import',{owner:c.owner,key:c.key,model:c.model});
 c.host.handle('/host/models/import',{owner:c.other,key:randomUUID(),model:c.model});
 expect(()=>c.host.close()).toThrow('model-discovery-busy');
 expect(()=>c.host.handle('/host/models/import',{owner:c.owner,key:randomUUID(),model:c.model})).toThrow('model-discovery-busy');
 await Promise.resolve();resolves.forEach(resolve=>resolve());await Promise.all([...c.host.service.inflight.values()]);expect(first.body.model.ready).toBe(false);
});
