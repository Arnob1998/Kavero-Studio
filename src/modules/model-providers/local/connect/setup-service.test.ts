// @vitest-environment node
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupsPOST } from './setup-service';
import { devicePOST } from './service';
import { deviceMessage, signConnect } from './protocol';
import {digest} from './protocol';
import {canonicalSnapshot} from '../job-snapshot';
import {setupIntent} from './setup-contract';
// @ts-expect-error Native companion transport is tested directly and has no TypeScript declarations.
import { ConnectClient } from '../../../../../scripts/local-generation/connect/client.mjs';
// @ts-expect-error Native companion transport is tested directly and has no TypeScript declarations.
import { SetupClient } from '../../../../../scripts/local-generation/connect/setup.mjs';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), lookup: vi.fn(), admin: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => {
  mocks.admin(); const query = { eq: () => query, maybeSingle: mocks.lookup };
  return { rpc: mocks.rpc, from: () => ({ select: () => query }) };
} }));
const origin = 'https://kavero.example', owner = randomUUID(), id = randomUUID(), installationId = randomUUID();
const profile = 'qwen-image-2.1-q4-evaluation', session = randomUUID();
const pair = generateKeyPairSync('ed25519'), publicKey = pair.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
function browser(body: unknown, headers: Record<string,string> = { origin }) {
  return new Request(origin + '/api/connect/setups', { method: 'POST', headers, body: JSON.stringify(body) });
}
function signed(body: unknown, overrides: Record<string,string> = {}) {
  const text = JSON.stringify(body), timestamp = String(Date.now()), nonce = randomUUID();
  return new Request(origin + '/api/connect/device', { method: 'POST', body: text, headers: {
    'x-kavero-connect-device': id, 'x-kavero-connect-time': timestamp, 'x-kavero-connect-nonce': nonce,
    'x-kavero-connect-signature': signConnect(deviceMessage(origin,id,timestamp,nonce,text),pair.privateKey), ...overrides,
  } });
}
const poll = { action: 'setup-poll', setupProtocol: 1, session, approvedOwner: owner, profiles: [profile] };
function prepared(raw:unknown){const intent=setupIntent.parse(raw),intentHash=digest(canonicalSnapshot(intent));return {capable:true,seenAt:new Date().toISOString(),deviceName:'Studio PC',active:null,assessment:{id:randomUUID(),deviceId:id,key:randomUUID(),kind:'assess',intent,intentHash,state:'assessed',cancelRequested:false,processedBytes:0,operationId:null,reason:null,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),version:1,evidence:{capturedAt:new Date().toISOString(),manifestHash:intent.manifestHash,compatibility:'eligible',totalVramMiB:8192,freeVramMiB:8000,totalRamBytes:32*1024**3,freeRamBytes:30*1024**3,freeDiskBytes:100*1024**3,requiredFreeBytes:25*1024**3,installed:false}}};}
beforeEach(() => {
  vi.clearAllMocks();
  for (const flag of ['ENABLED','SETUP_ENABLED','DELIVERY_ENABLED','EXECUTION_ENABLED','RESULTS_ENABLED']) vi.stubEnv('KAVERO_CONNECT_' + flag,'1');
  vi.stubEnv('KAVERO_CONNECT_ORIGIN',origin); vi.stubEnv('KAVERO_STORAGE_PROVIDER','kavero-managed'); vi.stubEnv('KAVERO_MANAGED_STORAGE_BACKEND','supabase-storage');
  mocks.getUser.mockResolvedValue({ data: { user: { id: owner } }, error: null });
  mocks.lookup.mockResolvedValue({ data: { id, installation_id: installationId, key_version: 2, public_key: publicKey, revoked_at: null, expires_at: new Date(Date.now()+600000).toISOString() }, error: null });
  mocks.rpc.mockImplementation(async(_name:string,params:{p_action?:string;p_input?:{intent?:unknown}})=>({data:params.p_action==='prepare'?prepared(params.p_input?.intent):params.p_action==='recover'?{error:'not-found'}:{request:null},error:null}));
});
afterEach(() => vi.unstubAllEnvs());

describe('Remote setup owner admission', () => {
  it.each(['SETUP','DELIVERY','EXECUTION','RESULTS'])('requires the %s gate before auth/storage', async flag => {
    vi.stubEnv(`KAVERO_CONNECT_${flag}_ENABLED`,'0');
    expect((await setupsPOST(browser({action:'inspect',id}))).status).toBe(404);
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
  });
  it('rejects wrong storage, origin, changed account and unauthenticated callers', async () => {
    vi.stubEnv('KAVERO_MANAGED_STORAGE_BACKEND','local-filesystem');
    expect((await setupsPOST(browser({action:'inspect',id}))).status).toBe(503);
    vi.stubEnv('KAVERO_MANAGED_STORAGE_BACKEND','supabase-storage');
    expect((await setupsPOST(browser({action:'inspect',id},{}))).status).toBe(403);
    expect((await setupsPOST(browser({action:'inspect',id},{origin,'x-kavero-connect-owner':randomUUID()}))).status).toBe(409);
    mocks.getUser.mockResolvedValueOnce({data:{user:null},error:null});
    expect((await setupsPOST(browser({action:'inspect',id}))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('derives a pinned account/device/key/recipe review without admitting work', async () => {
    const response = await setupsPOST(browser({action:'review',deviceId:id,profile}));
    expect(response.status).toBe(200); const review = await response.json();
    expect(review.intent).toMatchObject({ownerId:owner,origin,deviceId:id,installationId,keyVersion:2,profile,purpose:'research-evaluation'});
    for (const key of ['intentHash']) expect(review[key]).toMatch(/^[a-f0-9]{64}$/);
    for (const key of ['manifestHash','termsDigest','recipeHash']) expect(review.intent[key]).toMatch(/^[a-f0-9]{64}$/);
    expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('requires explicit exact-review acceptance and passes only server-derived intent', async () => {
    const review = await (await setupsPOST(browser({action:'review',deviceId:id,profile}))).json();
    const command = {action:'create',deviceId:id,profile,kind:'install',key:randomUUID()};
    expect((await setupsPOST(browser(command))).status).toBe(400);
    expect((await setupsPOST(browser({...command,reviewHash:'b'.repeat(64),accepted:true}))).status).toBe(409);
    const base=mocks.rpc.getMockImplementation()!;
    mocks.rpc.mockImplementation(async(name,params)=>params.p_action==='create'?{data:{error:'setup-unavailable'},error:null}:base(name,params));
    expect((await setupsPOST(browser({...command,reviewHash:review.intentHash,accepted:true}))).status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledWith('connect_setup_owner',expect.objectContaining({p_owner:owner,p_origin:origin,p_action:'create',p_input:expect.objectContaining({intent:review.intent,intentHash:review.intentHash,acceptedTerms:true})}));
  });
  it('requires fresh advertised capability and measured resources before installation',async()=>{
    const review=await (await setupsPOST(browser({action:'review',deviceId:id,profile}))).json();
    for(const condition of ['old-client','stale','unknown-memory','low-disk','unsupported','busy']){
      mocks.rpc.mockImplementation(async(_name,params)=>{if(params.p_action==='recover')return {data:{error:'not-found'},error:null};const value=prepared(params.p_input.intent);if(condition==='old-client')value.capable=false;if(condition==='stale')value.assessment.evidence.capturedAt='2020-01-01T00:00:00.000Z';if(condition==='unknown-memory')Object.assign(value.assessment.evidence,{freeVramMiB:null});if(condition==='low-disk')value.assessment.evidence.freeDiskBytes=1;if(condition==='unsupported')value.assessment.evidence.compatibility='gpu-too-small';if(condition==='busy')Object.assign(value,{active:{...value.assessment,kind:'install',state:'awaiting-approval'}});return {data:value,error:null};});
      const response=await setupsPOST(browser({action:'create',key:randomUUID(),deviceId:id,profile,kind:'install',reviewHash:review.intentHash,accepted:true}));expect(response.status).toBe(409);expect((await response.json()).notSubmitted).toBe(true);
    }
    expect(mocks.rpc.mock.calls.every(call=>call[1].p_action!=='create')).toBe(true);
  });
  it('returns the same receipt before fresh capability checks and rejects changed same-key intent',async()=>{
    const reviewed=await (await setupsPOST(browser({action:'review',deviceId:id,profile}))).json(),receipt={...prepared(reviewed.intent).assessment,kind:'install',state:'downloading'};
    mocks.rpc.mockResolvedValue({data:{request:receipt},error:null});mocks.lookup.mockResolvedValue({data:null,error:null});const command={action:'create',key:receipt.key,deviceId:id,profile,kind:'install',reviewHash:reviewed.intentHash,accepted:true};
    const response=await setupsPOST(browser(command));expect(response.status).toBe(200);expect((await response.json()).request.id).toBe(receipt.id);expect(mocks.rpc.mock.calls.every(call=>call[1].p_action==='recover')).toBe(true);
    expect((await setupsPOST(browser({...command,reviewHash:'d'.repeat(64)}))).status).toBe(409);
  });
  it('returns bounded preparation notices and recovers only the authenticated owner key',async()=>{
    const response=await setupsPOST(browser({action:'prepare',deviceId:id,profile}));expect(response.status).toBe(200);const value=await response.json();expect(value.installable).toBe(true);expect(value.notices.length).toBeGreaterThan(0);expect(value).not.toHaveProperty('consentToken');
    const key=randomUUID();mocks.rpc.mockResolvedValueOnce({data:{error:'not-found'},error:null});expect((await setupsPOST(browser({action:'recover',key}))).status).toBe(404);expect(mocks.rpc).toHaveBeenLastCalledWith('connect_setup_owner',expect.objectContaining({p_owner:owner,p_origin:origin,p_action:'recover',p_input:{action:'recover',key}}));
  });
  it('bounds input and disallows arbitrary profiles, ownership, paths or recipes', async () => {
    for (const extra of [{ownerId:owner},{profile:'flux'},{path:'C:/secret'},{intent:{}},{accepted:true}]) {
      expect((await setupsPOST(browser({action:'review',deviceId:id,profile,...extra}))).status).toBe(400);
    }
    expect((await setupsPOST(new Request(origin+'/api/connect/setups',{method:'POST',headers:{origin},body:'x'.repeat(8193)}))).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('denies unavailable identity and hides database failure details', async () => {
    mocks.lookup.mockResolvedValueOnce({data:null,error:null});
    expect((await setupsPOST(browser({action:'review',deviceId:id,profile}))).status).toBe(404);
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'private-database-path'}});
    const response=await setupsPOST(browser({action:'inspect',id}));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-database-path');
  });
  it('bounds database error replies as well as normal request envelopes', async () => {
    mocks.rpc.mockResolvedValueOnce({data:{error:'x'.repeat(32769)},error:null});
    const response=await setupsPOST(browser({action:'inspect',id}));
    expect(response.status).toBe(503); expect((await response.text()).length).toBeLessThan(100);
  });
});

describe('Remote setup signed device channel', () => {
  it('round-trips a real companion proof through the device service and transport envelope',async()=>{
    const identity={version:1,origin,deviceId:id,installationId,approvedOwner:owner,approvedDeviceId:id,publicKey,privateKey:pair.privateKey.export({format:'pem',type:'pkcs8'}).toString()};
    const client=new ConnectClient({origin,store:{load:()=>identity,save:vi.fn()},fetchImpl:async(url: string,init: RequestInit)=>devicePOST(new Request(url,init))});
    expect(await new SetupClient(client).poll()).toBeNull();
    expect(mocks.rpc).toHaveBeenLastCalledWith('connect_setup_device',expect.objectContaining({p_action:'setup-poll'}));
  });
  it('uses the existing exact-byte signature and separate atomic setup RPC', async () => {
    const request=signed(poll), response=await devicePOST(request);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({setupProtocol:1,deviceId:id,request:null});
    expect(mocks.rpc).toHaveBeenCalledWith('connect_setup_device',expect.objectContaining({p_id:id,p_origin:origin,p_public_key:publicKey,p_nonce:request.headers.get('x-kavero-connect-nonce'),p_action:'setup-poll',p_input:poll}));
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it('rejects browser origin, forged proof, stale timestamps and disabled setup', async () => {
    expect((await devicePOST(signed(poll,{origin}))).status).toBe(403);
    expect((await devicePOST(signed(poll,{'x-kavero-connect-signature':'a'.repeat(86)}))).status).toBe(401);
    expect((await devicePOST(signed(poll,{'x-kavero-connect-time':String(Date.now()-120000)}))).status).toBe(401);
    vi.stubEnv('KAVERO_CONNECT_SETUP_ENABLED','0');
    expect((await devicePOST(signed(poll))).status).toBe(404); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects unsupported capability, duplicate profiles, unbounded progress and unknown fields', async () => {
    for (const body of [{...poll,profiles:['flux']},{...poll,profiles:[profile,profile]},{...poll,command:'install'},
      {action:'setup-checkpoint',setupProtocol:1,session,id,token:randomUUID(),attempt:1,sequence:1,intentHash:'a'.repeat(64),state:'downloading',processedBytes:2**51}]) {
      expect((await devicePOST(signed(body))).status).toBe(400);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('fails closed on malformed database requests rather than forwarding private fields', async () => {
    mocks.rpc.mockResolvedValueOnce({data:{request:{token:randomUUID(),path:'C:/secret'}},error:null});
    const response=await devicePOST(signed(poll));
    expect(response.status).toBe(400); expect(await response.text()).not.toContain('C:/secret');
  });
});
