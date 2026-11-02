// @vitest-environment node
import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn(),host:vi.fn(),ready:vi.fn(),permission:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>({rpc:mocks.rpc})}));
vi.mock('./host-bridge',()=>({localHostRequest:(path:string,body:unknown)=>path==='/host/setup/permission'?mocks.permission(path,body):mocks.host(path,body)}));
vi.mock('./bridge',()=>({getLocalReadiness:mocks.ready}));
import {switchManagedLocalPackage,reconcileLocalSwitch} from './runtime-switch';
import {existingJobSnapshot} from './job-snapshot';
const owner='110fce0e-22ba-4a44-a68a-6619b477ca1b',key='44697489-d22b-432b-818b-155f201cc52d',id='ca422864-c89d-4432-88c9-fb3a69b64704';
const packageId='qwen-2-1-internal-evaluation',snapshot=existingJobSnapshot();
const current={packageFingerprint:snapshot.packageFingerprint,deviceId:'gpu',ledgerIdentity:key};
const op={id:key,packageId,state:'admitted',error:null};
const row={id,owner_id:owner,submission_key:key,target_package_id:packageId,target_fingerprint:snapshot.packageFingerprint,original_identity:current,state:'pending',host_operation:null as string|null};
beforeEach(()=>{vi.resetAllMocks();mocks.permission.mockResolvedValue({status:200,body:{allowed:true}});mocks.ready.mockResolvedValue({...current,ready:true,epoch:key});mocks.host.mockResolvedValue({status:202,body:{operation:op}});});
describe('Durable managed switching',()=>{
 it('reserves before contacting native activation and binds a private fence to the owner/key',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:{...row,host_operation:key}});
  expect(await switchManagedLocalPackage(owner,key,packageId)).toEqual({status:202,body:{operation:op}});
  expect(mocks.rpc.mock.calls.map(c=>c[0])).toEqual(['read_local_runtime_switch','begin_local_runtime_switch','bind_local_runtime_switch']);
  expect(mocks.host).toHaveBeenCalledWith('/host/activate',{owner,key,packageId,appFence:{id,from:current.packageFingerprint,target:current.packageFingerprint,ledgerIdentity:key}});
  expect(mocks.rpc.mock.invocationCallOrder[1]).toBeLessThan(mocks.host.mock.invocationCallOrder[0]);
 });
 it('keeps the fence on a lost acknowledgement and retries with its original identity while readiness is paused',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:row});mocks.host.mockRejectedValueOnce(Error('ack lost'));
  await expect(switchManagedLocalPackage(owner,key,packageId)).rejects.toThrow('ack lost');expect(mocks.rpc).toHaveBeenCalledTimes(2);
  mocks.ready.mockRejectedValue(Error('paused'));mocks.rpc.mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:{...row,host_operation:key}});
  expect((await switchManagedLocalPackage(owner,key,packageId)).status).toBe(202);expect(mocks.ready).toHaveBeenCalledTimes(1);
 });
 it.each(['installed','failed','cancelled','interrupted'])('releases only after actual runtime verification for %s',async state=>{
  mocks.rpc.mockResolvedValueOnce({data:{...row,host_operation:key}}).mockResolvedValueOnce({data:{...row,state:state==='installed'?'installed':'rolled-back',host_operation:key}});
  expect((await reconcileLocalSwitch(owner,{...op,state})).state).toBe(state);
  expect(mocks.rpc).toHaveBeenLastCalledWith('finish_local_runtime_switch',{p_owner:owner,p_switch:id,p_outcome:state==='installed'?'installed':'rolled-back',p_observed:current});
 });
 it('does not release a failed switch if the runtime cannot confirm rollback',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{...row,host_operation:key}});mocks.ready.mockRejectedValue(Error('crashed'));
  await expect(reconcileLocalSwitch(owner,{...op,state:'failed'})).rejects.toThrow('crashed');expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it('rejects pending jobs/competing switch conflicts before native admission',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null}).mockResolvedValueOnce({error:{message:'local-jobs-outstanding'}});
  await expect(switchManagedLocalPackage(owner,key,packageId)).rejects.toMatchObject({status:409});expect(mocks.host).not.toHaveBeenCalled();
 });
 it('recovers an installed acknowledgement without scheduling another activation',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{...row,state:'installed',host_operation:key}});mocks.host.mockResolvedValueOnce({status:200,body:{operation:{...op,state:'installed'}}});
  expect((await switchManagedLocalPackage(owner,key,packageId)).status).toBe(200);expect(mocks.ready).not.toHaveBeenCalled();expect(mocks.host).toHaveBeenCalledWith('/host/activation',{owner,id:key});
 });
 it('does not allow another owner or mismatched host operation to settle the fence',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{...row,owner_id:key,host_operation:key}});
  await expect(reconcileLocalSwitch(owner,op)).rejects.toMatchObject({status:503});expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it('preserves legacy activation polling when there is no switch record',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null});expect(await reconcileLocalSwitch(owner,op)).toEqual(op);expect(mocks.ready).not.toHaveBeenCalled();
 });
 it('rejects unverified targets without discovery or activation',async()=>{
  await expect(switchManagedLocalPackage(owner,key,'unverified')).rejects.toMatchObject({status:403});expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.host).not.toHaveBeenCalled();
 });
 it('rejects a non-v4 native key before reserving a fence',async()=>{
  await expect(switchManagedLocalPackage(owner,'44697489-d22b-132b-818b-155f201cc52d',packageId)).rejects.toThrow();expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it('releases a definite signed rejection only after confirming the unchanged runtime',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:null}).mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:{...row,state:'rolled-back'}});
  mocks.host.mockResolvedValueOnce({status:409,body:{error:'activation-busy'}});
  await expect(switchManagedLocalPackage(owner,key,packageId)).rejects.toMatchObject({status:409});
  expect(mocks.rpc).toHaveBeenLastCalledWith('finish_local_runtime_switch',{p_owner:owner,p_switch:id,p_outcome:'rolled-back',p_observed:current});
 });
 it('keeps an installed acknowledgement fenced until readiness becomes available',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:row}).mockResolvedValueOnce({data:{...row,host_operation:key}});
  mocks.host.mockResolvedValueOnce({status:202,body:{operation:{...op,state:'installed'}}});mocks.ready.mockRejectedValueOnce(Error('maintenance'));
  await expect(switchManagedLocalPackage(owner,key,packageId)).rejects.toThrow('maintenance');
  expect(mocks.rpc.mock.calls.some(call=>call[0]==='finish_local_runtime_switch')).toBe(false);
 });
 it('denies switch permission before reserving the GPU for an unacknowledged model',async()=>{
  mocks.permission.mockResolvedValue({status:200,body:{allowed:false}});await expect(switchManagedLocalPackage(owner,key,packageId)).rejects.toMatchObject({status:403});expect(mocks.rpc).not.toHaveBeenCalled();expect(mocks.host).not.toHaveBeenCalled();
 });
});
