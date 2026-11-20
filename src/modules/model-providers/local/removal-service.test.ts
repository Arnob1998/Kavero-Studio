// @vitest-environment node
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const m=vi.hoisted(()=>({ctx:vi.fn(),rpc:vi.fn(),host:vi.fn(),enabled:vi.fn()}));
vi.mock('@/modules/generation/local/service',()=>({context:m.ctx}));
vi.mock('@/modules/generation/local/readiness-service',()=>({localUIEnabled:m.enabled}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:m.rpc})}));
vi.mock('./host-bridge',()=>({localHostRequest:m.host}));
import {localRemovalGET,localRemovalPOST} from './removal-service';
import {localProfiles} from './browser-profiles';
const owner='110fce0e-22ba-4a44-a68a-6619b477ca1b',key='44697489-d22b-432b-818b-155f201cc52d',id='ca422864-c89d-4432-88c9-fb3a69b64704',hostId='01971fe6-0e8d-47c5-970c-c8d4a4b3230b',p=localProfiles[0];
const fields={instanceId:hostId,packageId:p.packageId,manifest:p.manifest},body={...fields,key,confirmed:true};
const row={id,owner_id:owner,submission_key:key,instance_id:hostId,package_id:p.packageId,manifest:p.manifest,state:'pending',host_operation:null};
const op={...fields,id:key,key,appFence:id,state:'admitted',reclaimedBytes:0,retainedBytes:0,retainedFiles:0,error:null,scope:'managed-delivery',complete:false};
const get=()=>new Request('http://localhost/api/local-generation/removals?profile='+p.profile);
const post=(v:unknown=body)=>new Request('http://localhost/api/local-generation/removals',{method:'POST',body:JSON.stringify(v)});
beforeEach(()=>{vi.resetAllMocks();m.enabled.mockReturnValue(true);m.ctx.mockResolvedValue({owner});m.rpc.mockImplementation(async(name:string)=>({data:name==='read_local_model_removal'?null:name==='settle_local_model_removal'?{...row,host_operation:key}:row}));m.host.mockImplementation(async(path:string)=>path==='/host/status'?{status:200,body:{instanceId:hostId}}:path==='/host/removal/review'?{status:200,body:{review:{...fields,scope:'managed-delivery',canRemove:true,reclaimableBytes:100,retainedBytes:0,reason:null}}}:{status:202,body:{instanceId:hostId,operation:op}});});
afterEach(()=>vi.restoreAllMocks());
it('gates and authenticates before native or database access',async()=>{
 m.enabled.mockReturnValue(false);expect((await localRemovalPOST(post())).status).toBe(404);expect(m.ctx).not.toHaveBeenCalled();
 m.enabled.mockReturnValue(true);m.ctx.mockResolvedValue({response:Response.json({error:'Sign in'},{status:401})});expect((await localRemovalGET(get())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();expect(m.host).not.toHaveBeenCalled();
});
it('rejects unconfirmed, oversized, unverified and browser-owned fields before reservation',async()=>{
 for(const v of [{...body,accountOnly:true},{...body,confirmed:false},{...body,owner},{...body,manifest:'a'.repeat(64)},{...body,appFence:id},{...body,path:'C:\\models'},{...body,instanceId:'bad'}])expect((await localRemovalPOST(post(v))).status).toBe(400);
 expect((await localRemovalPOST(post({padding:'a'.repeat(2000)}))).status).toBe(413);expect(m.rpc).not.toHaveBeenCalled();expect(m.host).not.toHaveBeenCalled();
});
it('reserves app admission before native mutation and freezes authenticated owner/host/package identity',async()=>{
 expect((await localRemovalPOST(post())).status).toBe(202);
 expect(m.rpc.mock.calls[0]).toEqual(['begin_local_model_removal',{p_owner:owner,p_key:key,p_instance:hostId,p_package:p.packageId,p_manifest:p.manifest}]);
 expect(m.rpc.mock.invocationCallOrder[0]).toBeLessThan(m.host.mock.invocationCallOrder[0]);
 expect(m.host).toHaveBeenCalledWith('/host/removal/start',{owner,key,...fields,appFence:id});
 expect(m.rpc).toHaveBeenLastCalledWith('settle_local_model_removal',{p_owner:owner,p_id:id,p_host:key,p_removed:false});
});
it('preserves the fence and original key on lost acknowledgement',async()=>{
 m.host.mockRejectedValueOnce(Error('lost ack'));expect((await localRemovalPOST(post())).status).toBe(503);expect(m.rpc).toHaveBeenCalledTimes(1);
 expect((await localRemovalPOST(post())).status).toBe(202);expect(m.host.mock.calls[0][1]).toEqual(m.host.mock.calls[1][1]);
});
it('blocks pending/unknown jobs or competing model operations before contacting native',async()=>{
 m.rpc.mockResolvedValue({error:{message:'local-jobs-outstanding'}});expect((await localRemovalPOST(post())).status).toBe(409);expect(m.host).not.toHaveBeenCalled();
});
it('settles successful removal without demanding an active model or ready worker',async()=>{
 m.host.mockResolvedValue({status:202,body:{operation:{...op,state:'removed',complete:true,reclaimedBytes:100}}});m.rpc.mockImplementation(async(name:string)=>({data:name==='settle_local_model_removal'?{...row,state:'removed',host_operation:key}:row}));
 const response=await localRemovalPOST(post());expect(response.status).toBe(202);expect((await response.json()).operation).toMatchObject({state:'removed',reclaimedBytes:100});
 expect(m.rpc).toHaveBeenLastCalledWith('settle_local_model_removal',{p_owner:owner,p_id:id,p_host:key,p_removed:true});
});
it('settles signed account-only completion without clearing the shared runtime',async()=>{
 m.host.mockResolvedValue({status:202,body:{operation:{...op,state:'removed',complete:true,accountOnly:true,retainedBytes:100}}});
 m.rpc.mockImplementation(async(name:string)=>({data:name==='settle_local_model_account_removal'?{...row,state:'removed',host_operation:key}:row}));
 const response=await localRemovalPOST(post());expect(response.status).toBe(202);
 expect((await response.json()).operation).toMatchObject({state:'removed',accountOnly:true,retainedBytes:100});
 expect(m.rpc).toHaveBeenLastCalledWith('settle_local_model_account_removal',{p_owner:owner,p_id:id,p_host:key,p_removed:true});
 expect(m.rpc.mock.calls.some(([name])=>name==='settle_local_model_removal')).toBe(false);
});
it('never releases admission for a removed package with incomplete native guard cleanup',async()=>{
 m.host.mockResolvedValue({status:202,body:{operation:{...op,state:'removed',complete:false}}});const res=await localRemovalPOST(post());expect((await res.json()).operation.state).toBe('interrupted');
 expect(m.rpc).toHaveBeenLastCalledWith('settle_local_model_removal',{p_owner:owner,p_id:id,p_host:key,p_removed:false});
});
it.each(['instanceId','manifest','packageId','appFence','key'])('rejects a native %s mismatch without completing app admission',async field=>{
 m.host.mockResolvedValue({status:202,body:{operation:{...op,[field]:field==='manifest'?'f'.repeat(64):field==='packageId'?localProfiles[1].packageId:id}}});
 if(field==='appFence')m.host.mockResolvedValue({status:202,body:{operation:{...op,appFence:key}}});
 expect((await localRemovalPOST(post())).status).toBe(503);expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('releases only an explicit signed native no-admission refusal',async()=>{
 m.host.mockResolvedValue({status:409,body:{instanceId:hostId,rejected:true}});m.rpc.mockImplementation(async(name:string)=>({data:name==='refuse_local_model_removal'?{...row,state:'refused'}:row}));
 expect((await localRemovalPOST(post())).status).toBe(409);expect(m.rpc).toHaveBeenLastCalledWith('refuse_local_model_removal',{p_owner:owner,p_id:id});
 m.rpc.mockClear();m.host.mockResolvedValue({status:409,body:{instanceId:hostId}});expect((await localRemovalPOST(post())).status).toBe(503);expect(m.rpc).toHaveBeenCalledTimes(1);
});
it('recovers a durable operation on read-only refresh with no native POST admission',async()=>{
 m.rpc.mockImplementation(async()=>({data:{...row,host_operation:key}}));const previous=m.host.getMockImplementation()!;m.host.mockImplementation(async(path:string,...args:unknown[])=>path==='/host/removal/status'?{status:200,body:{operation:op}}:previous(path,...args));
 const response=await localRemovalGET(get());expect(response.status).toBe(200);expect((await response.json()).operation.key).toBe(key);expect(m.host.mock.calls.some(c=>c[0]==='/host/removal/start')).toBe(false);
});
