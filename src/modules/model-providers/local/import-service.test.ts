// @vitest-environment node
import {it,expect,beforeEach,afterEach,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getUser:vi.fn(),host:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock('./host-bridge',()=>({localHostRequest:mocks.host}));
import {modelImportsGET,modelImportsPOST} from './import-service';
const owner='110fce0e-22ba-4a44-a68a-6619b477ca1b',key='44697489-d22b-432b-818b-155f201cc52d';
const source={id:'example',source:'https://huggingface.co/owner/model'},summary={id:key,key,createdAt:1,state:'inspecting',source,requestedRevision:'main',revision:null,sourceValidity:'unverified',recipeSupport:'unverified',license:null,ready:false,installable:false};
const get=(query='')=>new Request('http://localhost/api/local-generation/models'+query),post=(body:unknown)=>new Request(get(),{method:'POST',body:JSON.stringify(body)});
beforeEach(()=>{vi.stubEnv('KAVERO_LOCAL_GENERATION_ENABLED','1');mocks.getUser.mockResolvedValue({data:{user:{id:owner}},error:null});mocks.host.mockResolvedValue({status:202,body:{model:summary,secret:'private'}});});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it('gates before auth and rejects anonymous imports before host access',async()=>{
 vi.stubEnv('KAVERO_LOCAL_GENERATION_ENABLED','0');expect((await modelImportsGET(get())).status).toBe(404);expect(mocks.getUser).not.toHaveBeenCalled();
 vi.stubEnv('KAVERO_LOCAL_GENERATION_ENABLED','1');mocks.getUser.mockResolvedValue({data:{user:null},error:null});expect((await modelImportsPOST(post({key,model:source}))).status).toBe(401);expect(mocks.host).not.toHaveBeenCalled();
});
it('derives owner from auth, preserves key and strips private reply fields',async()=>{
 const response=await modelImportsPOST(post({key,model:source}));expect(response.status).toBe(202);expect(await response.json()).toEqual({model:summary});expect(mocks.host).toHaveBeenCalledWith('/host/models/import',{key,model:source,owner});
});
it('rejects browser owners, snapshots, commands and oversized bodies',async()=>{
 for(const change of [{owner},{snapshot:{}},{model:{...source,command:'evil'}}])expect((await modelImportsPOST(post({key,model:source,...change}))).status).toBe(400);
 expect((await modelImportsPOST(post({key,model:{...source,source:'x'.repeat(5000)}}))).status).toBe(413);expect(mocks.host).not.toHaveBeenCalled();
});
it('validates query modes and forwards owner-bound license/detail requests',async()=>{
 mocks.host.mockResolvedValue({status:404,body:{private:'secret'}});
 expect((await modelImportsGET(get('?id='+key))).status).toBe(404);expect(mocks.host).toHaveBeenLastCalledWith('/host/models/detail',{owner,id:key});
 await modelImportsGET(get('?id='+key+'&component=engine'));expect(mocks.host).toHaveBeenLastCalledWith('/host/models/license',{owner,id:key,component:'engine'});
 mocks.host.mockClear();for(const query of ['?id=no','?component=model','?id='+key+'&offset=0','?offset=101','?offset=0&offset=1','?owner='+owner,'?id='+key+'&component=evil'])expect((await modelImportsGET(get(query))).status).toBe(400);expect(mocks.host).not.toHaveBeenCalled();
});
it('preserves safe busy/conflict responses and hides exceptions or invalid host data',async()=>{
 for(const status of [409,429]){mocks.host.mockResolvedValue({status,body:{error:'private-path'}});const response=await modelImportsPOST(post({key,model:source}));expect(response.status).toBe(status);expect(await response.text()).not.toContain('private-path');}
 mocks.host.mockResolvedValue({status:200,body:{model:{...summary,ready:true}}});expect((await modelImportsPOST(post({key,model:source}))).status).toBe(503);
 mocks.host.mockRejectedValue(Error('secret'));const response=await modelImportsGET(get());expect(response.status).toBe(503);expect(await response.text()).not.toContain('secret');
});
it('returns bounded inert license text while removing host-only properties',async()=>{
 const license={identifier:'mit',text:{content:'<script>inert text</script>',bytes:26,sha256:'a'.repeat(64)},sourceUrl:'https://huggingface.co/owner/model/raw/'+ 'b'.repeat(40)+'/LICENSE',status:'cached-upstream-text'};
 mocks.host.mockResolvedValue({status:200,body:{license:{...license,privatePath:'hidden'},secret:'hidden'}});
 const response=await modelImportsGET(get('?id='+key+'&component=model'));expect(response.status).toBe(200);expect(await response.json()).toEqual({license});
});
