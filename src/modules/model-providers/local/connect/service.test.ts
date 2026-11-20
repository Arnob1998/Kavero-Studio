// @vitest-environment node
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimPOST, devicePOST, jobsPOST, devicesGET, devicesPOST, pairingsGET, pairingsPOST } from "./service";
import { claimMessage, deviceMessage, signConnect } from "./protocol";

const mocks=vi.hoisted(()=>({ getUser:vi.fn(),rpc:vi.fn(),lookup:vi.fn(),admin:vi.fn() }));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:mocks.getUser}})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>{mocks.admin();return {rpc:mocks.rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:mocks.lookup})})})})};}}));
const origin="https://kavero.example",owner=randomUUID(),id=randomUUID(),installationId=randomUUID();
const pair=generateKeyPairSync("ed25519"),publicKey=pair.publicKey.export({format:"der",type:"spki"}).toString("base64url");
const req=(path:string,body:unknown,headers:Record<string,string>={origin})=>new Request(origin+"/api/connect/"+path,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body)});
const status={action:"status",epoch:randomUUID(),report:{platform:"win32",arch:"x64",node:"24.11.1",ramMiB:16384,gpus:[]}};
function signed(body:unknown=status,overrides:Record<string,string>={}) {
  const text=JSON.stringify(body),timestamp=String(Date.now()),nonce=randomUUID();
  return req("device",body,{"x-kavero-connect-device":id,"x-kavero-connect-time":timestamp,"x-kavero-connect-nonce":nonce,
    "x-kavero-connect-signature":signConnect(deviceMessage(origin,id,timestamp,nonce,text),pair.privateKey),...overrides});
}
beforeEach(()=>{
  vi.clearAllMocks();vi.stubEnv("KAVERO_CONNECT_ENABLED","1");vi.stubEnv("KAVERO_CONNECT_ORIGIN",origin);
  mocks.getUser.mockResolvedValue({data:{user:{id:owner}},error:null});
  mocks.rpc.mockResolvedValue({data:{ok:true},error:null});
  mocks.lookup.mockResolvedValue({data:{public_key:publicKey,revoked_at:null,expires_at:new Date(Date.now()+600000).toISOString()},error:null});
});
afterEach(()=>vi.unstubAllEnvs());
describe("Connect opt-in browser APIs",()=>{
  it("fences a changed browser account before database access",async()=>{
    vi.stubEnv("KAVERO_CONNECT_DELIVERY_ENABLED","1");
    const response=await jobsPOST(req("jobs",{action:"inspect",id},{origin,"x-kavero-connect-owner":randomUUID()}));
    expect(response.status).toBe(409);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("defaults off before authentication/storage",async()=>{
    vi.stubEnv("KAVERO_CONNECT_ENABLED","");expect((await pairingsPOST(req("pairings",{action:"create",name:"PC"}))).status).toBe(404);
    expect(mocks.getUser).not.toHaveBeenCalled();expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("rejects cross-origin and absent-origin mutations",async()=>{
    for(const headers of [{origin:"https://attacker.example"},{}] as Record<string,string>[])expect((await pairingsPOST(req("pairings",{action:"create",name:"PC"},headers))).status).toBe(403);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("requires a verified account and ignores caller-supplied owner fields",async()=>{
    mocks.getUser.mockResolvedValueOnce({data:{user:null},error:null});
    expect((await pairingsPOST(req("pairings",{action:"create",name:"PC"}))).status).toBe(401);
    expect((await pairingsPOST(req("pairings",{action:"create",name:"PC",owner:randomUUID()}))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("returns a one-time high-entropy code but stores only its hash",async()=>{
    const response=await pairingsPOST(req("pairings",{action:"create",name:"PC"}));const body=await response.json();
    expect(response.status).toBe(200);expect(body.code).toMatch(/^[a-f0-9]{24}$/);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({p_owner:owner,p_origin:origin,p_action:"create",p_input:{name:"PC"}});
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(body.code);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("filters inspection by authenticated owner and validates a single id query",async()=>{
    expect((await pairingsGET(new Request(origin+`/api/connect/pairings?id=${id}`))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenLastCalledWith("connect_owner",expect.objectContaining({p_owner:owner,p_action:"inspect",p_input:{id}}));
    for(const suffix of [`?id=${id}&id=${id}`,`?id=${id}&extra=1`,"?id=bad"])expect((await pairingsGET(new Request(origin+"/api/connect/pairings"+suffix))).status).toBe(400);
  });
  it("lists/renames/revokes only using verified ownership",async()=>{
    expect((await devicesGET(new Request(origin+"/api/connect/devices"))).status).toBe(200);
    for(const body of [{action:"rename",id,name:"Studio PC"},{action:"revoke",id}])expect((await devicesPOST(req("devices",body))).status).toBe(200);
    expect(mocks.rpc.mock.calls.every(call=>call[1].p_owner===owner)).toBe(true);
  });
  it("fails closed on storage errors and maps durable limit feedback",async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:"private-db-details"}});
    const response=await devicesGET(new Request(origin+"/api/connect/devices"));expect(response.status).toBe(503);expect(await response.text()).not.toContain("private-db-details");
    mocks.rpc.mockResolvedValueOnce({data:{error:"rate-limited"},error:null});expect((await devicesGET(new Request(origin+"/api/connect/devices"))).status).toBe(429);
  });
});
describe("Connect companion authentication",()=>{
  it("validates a self-signed claim and forwards only hash/public identity",async()=>{
    const code="ab".repeat(12),proof=signConnect(claimMessage(origin,code,installationId,publicKey,id),pair.privateKey);
    expect((await claimPOST(req("claim",{code,installationId,deviceId:id,publicKey,proof},{}))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][1].p_input).toMatchObject({installationId,publicKey});
    expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(code);
    expect((await claimPOST(req("claim",{code,installationId,deviceId:id,publicKey,proof:"a".repeat(86)},{}))).status).toBe(401);
  });
  it("rejects browser requests to device endpoints even with valid proofs",async()=>{
    expect((await devicePOST(signed(status,{origin}))).status).toBe(403);expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("validates signed bytes and passes current key/nonce to atomic database guard",async()=>{
    const request=signed();expect((await devicePOST(request)).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("connect_device_action",expect.objectContaining({p_id:id,p_origin:origin,p_public_key:publicKey,p_nonce:request.headers.get("x-kavero-connect-nonce"),p_action:"status"}));
  });
  it("rejects stale time, changed bytes and malformed/unknown operations",async()=>{
    expect((await devicePOST(signed(status,{"x-kavero-connect-time":String(Date.now()-120000)}))).status).toBe(401);
    expect((await devicePOST(signed(status,{"x-kavero-connect-signature":"a".repeat(86)}))).status).toBe(401);
    for(const body of [{action:"execute",command:"calc.exe"},{...status,owner},{...status,report:{...status.report,path:"C:/secret"}}])expect((await devicePOST(signed(body))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(["revoked","expired","missing"])("denies %s device before mutation",async state=>{
    mocks.lookup.mockResolvedValue({data:state==='missing'?null:{public_key:publicKey,revoked_at:state==='revoked'?new Date().toISOString():null,expires_at:state==='expired'?'2020-01-01':new Date(Date.now()+60000).toISOString()},error:null});
    expect((await devicePOST(signed())).status).toBe(401);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies, query strings and metadata",async()=>{
    expect((await claimPOST(new Request(origin+"/api/connect/claim",{method:"POST",body:'x'.repeat(8193)}))).status).toBe(413);
    expect((await devicesGET(new Request(origin+"/api/connect/devices?secret=value"))).status).toBe(400);
    expect((await devicePOST(signed({...status,report:{...status.report,gpus:Array(9).fill({label:"GPU",vramMiB:8000})}}))).status).toBe(400);
  });
  it("never permits HTTP production enrollment even with the development switch",async()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("KAVERO_CONNECT_ORIGIN","http://127.0.0.1:3049");vi.stubEnv("KAVERO_CONNECT_ALLOW_LOOPBACK","1");
    expect((await devicesGET(new Request("http://127.0.0.1:3049/api/connect/devices"))).status).toBe(503);expect(mocks.admin).not.toHaveBeenCalled();
  });
});

const binding={profile:"qwen-image-2.1-q4-evaluation",workerEpoch:randomUUID(),ledgerIdentity:randomUUID(),executionDevice:"a".repeat(64),permission:true,maintenance:false};
describe("Connect protocol-only delivery",()=>{
  it("requires a separate opt-in before storage access",async()=>{
    expect((await jobsPOST(req("jobs",{action:"inspect",id}))).status).toBe(404);
    expect((await devicePOST(signed({action:"delivery-poll",session:randomUUID(),binding}))).status).toBe(404);
    expect(mocks.admin).not.toHaveBeenCalled();
  });
  it("derives owner, supported recipe and native hash on the server",async()=>{
    vi.stubEnv("KAVERO_CONNECT_DELIVERY_ENABLED","1");
    const input={action:"create",deviceId:id,key:randomUUID(),bindingHash:"b".repeat(64),profile:binding.profile,prompt:"A glass vessel"};
    expect((await jobsPOST(req("jobs",input))).status).toBe(200);
    const [name,params]=mocks.rpc.mock.calls[0];
    expect(name).toBe("connect_job_owner");expect(params.p_owner).toBe(owner);
    expect(params.p_input).toMatchObject({...input,intent:{width:512,height:512,count:1},recipeSnapshot:{schemaVersion:1,profile:binding.profile}});
    expect(params.p_input.hash).toMatch(/^[a-f0-9]{64}$/);
    for(const extra of [{owner:id},{intent:{}},{recipeSnapshot:{}},{width:1024},{prompt:" ".repeat(3)},{prompt:"a".repeat(1001)}]) {
      expect((await jobsPOST(req("jobs",{...input,...extra}))).status).toBe(400);
    }
  });
  it("enforces browser auth/origin and no arbitrary query parameters",async()=>{
    vi.stubEnv("KAVERO_CONNECT_DELIVERY_ENABLED","1");
    expect((await jobsPOST(req("jobs",{action:"inspect",id},{}))).status).toBe(403);
    expect((await jobsPOST(req("jobs?owner="+owner,{action:"inspect",id}))).status).toBe(400);
    mocks.getUser.mockResolvedValueOnce({data:{user:null},error:null});
    expect((await jobsPOST(req("jobs",{action:"inspect",id}))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses signed delivery RPC with server-frozen candidate recipe",async()=>{
    vi.stubEnv("KAVERO_CONNECT_DELIVERY_ENABLED","1");
    const session=randomUUID();expect((await devicePOST(signed({action:"delivery-poll",session,binding}))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0]).toMatchObject(["connect_delivery_action",{p_id:id,p_input:{session,binding:{...binding,recipeSnapshot:{profile:binding.profile}},bindingHash:expect.stringMatching(/^[a-f0-9]{64}$/)}}]);
  });
  it("rejects extra owner/path/url fields and malformed checkpoint counters",async()=>{
    vi.stubEnv("KAVERO_CONNECT_DELIVERY_ENABLED","1");
    for(const body of [{action:"delivery-poll",session:randomUUID(),binding,owner},
      {action:"delivery-poll",session:randomUUID(),binding:{...binding,path:"C:/model"}},
      {action:"delivery-checkpoint",session:randomUUID(),id,token:randomUUID(),attempt:0,sequence:1,state:"running"}]) {
      expect((await devicePOST(signed(body))).status).toBe(400);
    }expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("Connect native execution opt-in",()=>{
 it("requires the additional execution gate before storage",async()=>{
  vi.stubEnv("KAVERO_CONNECT_DELIVERY_ENABLED","1");
  expect((await devicePOST(signed({action:"execution-poll",session:randomUUID(),binding}))).status).toBe(404);
  expect((await jobsPOST(req("jobs",{action:"create",execute:true,deviceId:id,key:randomUUID(),bindingHash:"a".repeat(64),profile:binding.profile,prompt:"Test"}))).status).toBe(404);
  expect(mocks.admin).not.toHaveBeenCalled();
 });
 it("binds explicit execution mode into signed candidate identity",async()=>{
  vi.stubEnv("KAVERO_CONNECT_DELIVERY_ENABLED","1");vi.stubEnv("KAVERO_CONNECT_EXECUTION_ENABLED","1");
  expect((await devicePOST(signed({action:"execution-poll",session:randomUUID(),binding}))).status).toBe(200);
  expect(mocks.rpc.mock.calls[0]).toMatchObject(["connect_delivery_action",{p_action:"delivery-poll",p_input:{execute:true,binding:{execute:true}}}]);
 });
});
