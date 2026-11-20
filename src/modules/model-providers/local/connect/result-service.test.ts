// @vitest-environment node
import {randomUUID,generateKeyPairSync} from "node:crypto";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {resultPOST,resultUploadPOST,resultGET,resultCancelPOST} from "./result-service";
import {resultProof,RESULT_CONTROL,RESULT_UPLOAD,type ResultRow} from "./result-contract";
import {digest,signConnect} from "./protocol";
import {boundedResultBody,verifyResultBytes} from "./result-storage";
// @ts-expect-error Shared native PNG fixture.
import {pngFixture} from "../../../../../scripts/local-generation/png-fixture.mjs";
const m=vi.hoisted(()=>({rpc:vi.fn(),lookup:vi.fn(),user:vi.fn(),read:vi.fn(),ensure:vi.fn(),remove:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:m.user}})}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:m.rpc,from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:m.lookup})})})})})}));
vi.mock("./result-storage",async original=>({...await original<object>(),readResultObject:m.read,ensureResultObject:m.ensure,removeResultObject:m.remove}));
const origin="https://kavero.test",device=randomUUID(),owner=randomUUID(),id=randomUUID(),keys=generateKeyPairSync("ed25519"),publicKey=keys.publicKey.export({format:"der",type:"spki"}).toString("base64url"),bytes=pngFixture();
let row:ResultRow;
function signed(path:string,body:Buffer|string,metadata="",extra:Record<string,string>={}){
 const time=String(Date.now()),nonce=randomUUID(),sha=digest(body);return new Request(origin+path,{method:"POST",body:typeof body==="string"?body:new Uint8Array(body),headers:{"content-type":path===RESULT_UPLOAD?"image/png":"application/json","content-length":String(Buffer.byteLength(body)),"x-kavero-connect-device":device,"x-kavero-connect-time":time,"x-kavero-connect-nonce":nonce,"x-kavero-body-sha256":sha,...(metadata?{"x-kavero-result":metadata}:{}),"x-kavero-connect-signature":signConnect(resultProof(origin,path,device,time,nonce,metadata,sha),keys.privateKey),...extra}});
}
function upload(data=bytes,change={}){const meta=Buffer.from(JSON.stringify({jobId:id,attempt:1,token:row.token,sha256:digest(data),sizeBytes:data.length,...change})).toString("base64url");return signed(RESULT_UPLOAD,data,meta);}
beforeEach(()=>{
 vi.clearAllMocks();for(const flag of ["ENABLED","DELIVERY_ENABLED","EXECUTION_ENABLED","RESULTS_ENABLED"])vi.stubEnv("KAVERO_CONNECT_"+flag,"1");vi.stubEnv("KAVERO_CONNECT_ORIGIN",origin);vi.stubEnv("KAVERO_STORAGE_PROVIDER","kavero-managed");vi.stubEnv("KAVERO_MANAGED_STORAGE_BACKEND","supabase-storage");
 row={job_id:id,owner_id:owner,device_id:device,origin,attempt:1,object_key:`connect-results/${owner}/${id}/final.png`,state:"pending",token:randomUUID(),lease_until:new Date(Date.now()+120000).toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),cleanup_token:randomUUID(),descriptor:{role:"final",sha256:digest(bytes),sizeBytes:bytes.length,width:512,height:512,mimeType:"image/png",ledgerIdentity:randomUUID(),requestHash:"a".repeat(64),packageFingerprint:"b".repeat(64),executionDevice:"c".repeat(64),generatedAt:new Date().toISOString(),localExpiresAt:new Date(Date.now()+86400000).toISOString()}};
 m.lookup.mockResolvedValue({data:{public_key:publicKey,expires_at:row.expires_at,revoked_at:null},error:null});m.user.mockResolvedValue({data:{user:{id:owner}},error:null});
 m.rpc.mockImplementation(async(name:string,args:{p_action:string})=>({data:{result:name==="connect_result_cleanup"?null:args?.p_action==="finish"?{...row,state:"available"}:row},error:null}));m.read.mockResolvedValue(bytes);m.ensure.mockResolvedValue(undefined);
});
afterEach(()=>vi.unstubAllEnvs());
describe("private Connect result boundary",()=>{
 it.each(["ENABLED","DELIVERY_ENABLED","EXECUTION_ENABLED","RESULTS_ENABLED"])("fails closed with %s off",async flag=>{vi.stubEnv("KAVERO_CONNECT_"+flag,"0");expect((await resultPOST(signed(RESULT_CONTROL,"{}"))).status).toBe(404);expect(m.lookup).not.toHaveBeenCalled();});
 it("rejects unsupported storage rather than silently replacing it",async()=>{vi.stubEnv("KAVERO_STORAGE_PROVIDER","google-drive");expect((await resultPOST(signed(RESULT_CONTROL,"{}"))).status).toBe(503);expect(m.lookup).not.toHaveBeenCalled();});
 it("rejects Origin/cookie-only calls and wrong-path signatures",async()=>{
  expect((await resultPOST(signed(RESULT_CONTROL,"{}","",{origin}))).status).toBe(403);
  const r=signed(RESULT_UPLOAD,"{}");expect((await resultPOST(new Request(origin+RESULT_CONTROL,r))).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();
 });
 it("rejects stale proofs and revoked devices before reading bytes",async()=>{expect((await resultUploadPOST(signed(RESULT_UPLOAD,bytes,"",{"x-kavero-connect-time":"1000000000000"}))).status).toBe(401);m.lookup.mockResolvedValue({data:{public_key:publicKey,revoked_at:row.expires_at,expires_at:row.expires_at}});expect((await resultUploadPOST(upload())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();});
 it("offers a frozen final descriptor and returns no storage keys",async()=>{const r=await resultPOST(signed(RESULT_CONTROL,JSON.stringify({action:"offer",jobId:id,attempt:1,descriptor:row.descriptor})));expect(r.status).toBe(200);const text=await r.text();expect(text).not.toContain(row.object_key);expect(text).not.toContain(owner);expect(m.rpc.mock.calls[0][1]).toMatchObject({p_action:"offer",p_id:device});});
 it("queries saved receipts only with fresh device proof and original identity",async()=>{
  m.rpc.mockResolvedValueOnce({data:{result:{jobId:id,sha256:row.descriptor.sha256,saved:false}}});
  const r=await resultPOST(signed(RESULT_CONTROL,JSON.stringify({action:"saved",jobId:id,sha256:row.descriptor.sha256})));
  expect(r.status).toBe(200);expect((await r.json()).result.saved).toBe(false);
  expect(m.rpc.mock.calls[0]).toMatchObject(["connect_save_device",{p_id:device,p_origin:origin,p_key:publicKey,p_job:id,p_hash:row.descriptor.sha256}]);
  expect(m.ensure).not.toHaveBeenCalled();expect(m.remove).not.toHaveBeenCalled();
 });
 it("consumes durable replay/owner rejection without writing objects",async()=>{m.rpc.mockResolvedValue({data:{error:"replay"}});expect((await resultUploadPOST(upload())).status).toBe(409);expect(m.ensure).not.toHaveBeenCalled();});
 it("validates exact final bytes before storage and transactional commit",async()=>{const r=await resultUploadPOST(upload());expect(r.status).toBe(200);expect(m.ensure).toHaveBeenCalledOnce();expect(m.rpc.mock.calls.map(c=>c[1].p_action)).toEqual(["begin","finish"]);expect((await r.json()).result.state).toBe("available");});
 it("rejects malformed/truncated bytes and wrong declared lengths",async()=>{
  expect((await resultUploadPOST(upload(Buffer.from("not a PNG")))).status).toBe(422);
  const r=upload();r.headers.set("content-length","1");expect((await resultUploadPOST(r)).status).toBe(400);expect(m.ensure).not.toHaveBeenCalled();
 });
 it("rejects body digest tampering",async()=>{const r=upload(),body=Buffer.from(bytes);body[0]^=1;expect((await resultUploadPOST(new Request(r,{body:new Uint8Array(body)}))).status).toBe(422);expect(m.ensure).not.toHaveBeenCalled();});
 it("preserves rejected late commit without claiming availability",async()=>{m.rpc.mockImplementation(async(_n:string,args:{p_action:string})=>({data:args.p_action==="finish"?{error:"unauthorized"}:{result:row}}));expect((await resultUploadPOST(upload())).status).toBe(401);expect(m.ensure).toHaveBeenCalledOnce();});
 it("reconciles available upload acknowledgement without another write",async()=>{row.state="available";expect((await resultUploadPOST(upload())).status).toBe(200);expect(m.ensure).not.toHaveBeenCalled();});
 it("uses verified owner identity for download, validates and rechecks expiry",async()=>{row.state="available";const r=await resultGET(new Request(origin+RESULT_CONTROL+"/"+id),id);expect(r.status).toBe(200);expect(digest(new Uint8Array(await r.arrayBuffer()))).toBe(row.descriptor.sha256);expect(m.rpc.mock.calls).toHaveLength(2);expect(m.rpc.mock.calls[0][1]).toMatchObject({p_owner:owner,p_job:id});expect(r.headers.get("cache-control")).toBe("private, no-store");});
 it("never exposes pending, corrupted or cross-owner bytes",async()=>{expect((await resultGET(new Request(origin+RESULT_CONTROL+"/"+id),id)).status).toBe(409);row.state="available";m.read.mockResolvedValue(Buffer.from("bad"));expect((await resultGET(new Request(origin+RESULT_CONTROL+"/"+id),id)).status).toBe(503);m.rpc.mockResolvedValue({data:{error:"not-found"}});expect((await resultGET(new Request(origin+RESULT_CONTROL+"/"+id),id)).status).toBe(404);});
 it("maps missing browser session to 401",async()=>{m.user.mockResolvedValue({data:{user:null}});expect((await resultGET(new Request(origin+RESULT_CONTROL+"/"+id),id)).status).toBe(401);});
 it("rejects preview descriptors and unsupported dimensions",async()=>{for(const change of [{role:"preview"},{width:1024},{sizeBytes:33554433}]){const r=await resultPOST(signed(RESULT_CONTROL,JSON.stringify({action:"offer",jobId:id,attempt:1,descriptor:{...row.descriptor,...change}})));expect(r.status).toBe(400);}expect(m.rpc).not.toHaveBeenCalled();});
 it("cancels publication only through verified owner and same Origin",async()=>{const path=RESULT_CONTROL+"/"+id;expect((await resultCancelPOST(new Request(origin+path,{method:"POST",headers:{origin},body:"{}"}),id)).status).toBe(200);expect(m.rpc.mock.calls[0][1]).toMatchObject({p_owner:owner,p_job:id});expect((await resultCancelPOST(new Request(origin+path,{method:"POST",body:"{}"}),id)).status).toBe(403);});
});
describe("result resource bounds",()=>{
 it("bounds actual bytes even when headers lie",async()=>{await expect(boundedResultBody(new ReadableStream({start(c){c.enqueue(new Uint8Array(10));c.close();}}),9)).rejects.toThrow("result-too-large");});
 it("times out a stalled body",async()=>{await expect(boundedResultBody(new ReadableStream(),10,5)).rejects.toThrow("result-read-timeout");});
 it("does not accept a different final image with a valid PNG header",()=>{expect(()=>verifyResultBytes(pngFixture({filter:1}),row)).toThrow("result-object-conflict");});
});
