import { describe,it,expect,vi,beforeEach } from 'vitest';
const mock=vi.hoisted(()=>({enabled:false,user:null as null|{id:string},admin:vi.fn(),submit:vi.fn(),host:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({auth:{getUser:async()=>({data:{user:mock.user},error:null})}})}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:mock.admin}));
vi.mock('@/modules/model-providers/local/bridge',()=>({localBridgeConfigured:()=>mock.enabled,getLocalReadiness:vi.fn(),inspectLocalBridgeJob:vi.fn(),submitLocalBridgeJob:mock.submit}));
vi.mock('@/modules/model-providers/local/host-bridge',()=>({localHostRequest:mock.host}));
import { submitLocalJob,manageLocalJob,inspectAndCheckpoint } from './service';
import { inspectLocalBridgeJob } from '@/modules/model-providers/local/bridge';
import { localJobSummary, type LocalJobRecord } from './contracts';
beforeEach(()=>{mock.enabled=false;mock.user=null;vi.clearAllMocks();});
describe('Internal local job route safety',()=>{
 it.each(['failed','generated-unvalidated'] as const)('returns a bounded diagnosis only when its checkpoint state wins: %s',async finalState=>{
  const job={id:'id',owner_id:'owner',state:'running',created_at:'2026-10-03T00:00:00.000Z'} as LocalJobRecord;
  const failure={stage:'hardware' as const,code:'gpu-memory-low' as const,recordedAt:'2026-10-03T00:00:01.000Z'};
  vi.mocked(inspectLocalBridgeJob).mockResolvedValueOnce({id:'id',state:'failed',failure} as Awaited<ReturnType<typeof inspectLocalBridgeJob>>);
  const update=vi.fn(),chain={eq:vi.fn(),select:vi.fn(),maybeSingle:vi.fn(async()=>({data:{...job,state:finalState},error:null}))};
  chain.eq.mockReturnValue(chain);chain.select.mockReturnValue(chain);update.mockReturnValue(chain);mock.admin.mockReturnValue({from:()=>({update})});
  const summary=localJobSummary(await inspectAndCheckpoint(job));
  if(finalState==='failed') expect(summary.failure).toEqual({...failure,message:expect.stringContaining('GPU memory')});
  else expect(summary.failure).toBeUndefined();
  expect(Object.keys(summary).sort()).toEqual(finalState==='failed'?['createdAt','failure','id','state']:['createdAt','id','state']);
  expect(update).toHaveBeenCalledWith({state:'failed',updated_at:expect.any(String)});
  expect(chain.eq).toHaveBeenCalledWith('owner_id','owner');
 });
 it('stays disabled by default before auth/database or bridge traffic',async()=>{expect((await submitLocalJob(new Request('http://localhost',{method:'POST',body:'{}'}))).status).toBe(404);expect(mock.admin).not.toHaveBeenCalled();expect(mock.submit).not.toHaveBeenCalled();});
 it('requires application authentication',async()=>{mock.enabled=true;expect((await manageLocalJob('11111111-1111-4111-8111-111111111111')).status).toBe(401);expect(mock.admin).not.toHaveBeenCalled();});
 it('rejects forged owners and unsupported options before storage/dispatch',async()=>{mock.enabled=true;mock.user={id:'owner'};const response=await submitLocalJob(new Request('http://localhost',{method:'POST',body:JSON.stringify({idempotencyKey:'11111111-1111-4111-8111-111111111111',owner:'spoofed',intent:{profile:'qwen-image-2.1-q4-evaluation',prompt:'A vase',width:512,height:512,count:1}})}));expect(response.status).toBe(400);expect(mock.admin).not.toHaveBeenCalled();expect(mock.submit).not.toHaveBeenCalled();});
 it('caps the streamed admission body',async()=>{mock.enabled=true;mock.user={id:'owner'};expect((await submitLocalJob(new Request('http://localhost',{method:'POST',body:'x'.repeat(8193)}))).status).toBe(413);expect(mock.admin).not.toHaveBeenCalled();});
 it('does not accept non-UUID job paths',async()=>{mock.enabled=true;mock.user={id:'owner'};expect((await manageLocalJob('../../runtime/file')).status).toBe(404);expect(mock.admin).not.toHaveBeenCalled();});
 it('rejects new inference without owner-bound installed-model consent before quota admission or dispatch',async()=>{
  mock.enabled=true;mock.user={id:'110fce0e-22ba-4a44-a68a-6619b477ca1b'};const rpc=vi.fn(),chain={select:vi.fn(),eq:vi.fn(),maybeSingle:vi.fn(async()=>({data:null,error:null}))};chain.select.mockReturnValue(chain);chain.eq.mockReturnValue(chain);mock.admin.mockReturnValue({from:()=>chain,rpc});mock.host.mockResolvedValue({status:200,body:{allowed:false}});
  const request=new Request('http://localhost',{method:'POST',body:JSON.stringify({idempotencyKey:'11111111-1111-4111-8111-111111111111',intent:{profile:'qwen-image-2.1-q4-evaluation',prompt:'A vase',width:512,height:512,count:1}})});
  expect((await submitLocalJob(request)).status).toBe(403);expect(mock.host).toHaveBeenCalledWith('/host/setup/access',{owner:mock.user.id});expect(rpc).not.toHaveBeenCalled();expect(mock.submit).not.toHaveBeenCalled();
 });
});
