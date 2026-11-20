// @vitest-environment node
import {randomUUID} from "node:crypto";
import {beforeEach,afterEach,it,expect,vi} from "vitest";
import {connectSavePOST,connectSaveGET,type ConnectSave} from "./save-service";
import {digest} from "./protocol";
// @ts-expect-error Native fixture shared with Node tests.
import {pngFixture} from "../../../../../scripts/local-generation/png-fixture.mjs";
const m=vi.hoisted(()=>({rpc:vi.fn(),user:vi.fn(),resolve:vi.fn(),read:vi.fn(),ensure:vi.fn(),source:vi.fn()}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:()=>({rpc:m.rpc})}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({auth:{getUser:m.user}})}));
vi.mock("@/modules/generation/local/save-storage",()=>({resolveLocalSaveDestination:m.resolve,readLocalSaveObject:m.read,ensureLocalSaveObject:m.ensure}));
vi.mock("./result-storage",async original=>({...await original<object>(),readResultObject:m.source}));
const origin="https://kavero.test",owner=randomUUID(),id=randomUUID(),bytes=pngFixture(),destination={provider:"kavero-managed" as const,backendId:"supabase-storage" as const,location:"https://storage.test"};
let save:ConnectSave|null,saved=false,failFinish=false,expireSource=false,concurrent=false;
function request(body="{}",method="POST"){return new Request(origin+`/api/connect/results/${id}/save`,{method,...(method==="POST"?{body,headers:{origin}}:{})});}
beforeEach(()=>{
 vi.clearAllMocks();saved=false;failFinish=false;expireSource=false;concurrent=false;save=null;
 for(const f of ["ENABLED","DELIVERY_ENABLED","EXECUTION_ENABLED","RESULTS_ENABLED"])vi.stubEnv("KAVERO_CONNECT_"+f,"1");vi.stubEnv("KAVERO_CONNECT_ORIGIN",origin);vi.stubEnv("KAVERO_STORAGE_PROVIDER","kavero-managed");vi.stubEnv("KAVERO_MANAGED_STORAGE_BACKEND","supabase-storage");
 m.user.mockResolvedValue({data:{user:{id:owner}}});m.resolve.mockResolvedValue({destination});m.source.mockResolvedValue(bytes);m.read.mockResolvedValue(null);m.ensure.mockResolvedValue(undefined);
 m.rpc.mockImplementation(async(_name:string,a:{p_action:string;p_token:string;p_mapping:ConnectSave["object_mapping"]})=>{
  if(a.p_action==="claim")save={job_id:id,owner_id:owner,origin,generation_id:randomUUID(),image_id:randomUUID(),sha256:digest(bytes),destination,object_mapping:null,state:"saving",attempt_token:concurrent?randomUUID():a.p_token,lease_until:new Date(Date.now()+120000).toISOString(),created_at:new Date().toISOString(),descriptor:{role:"final",sha256:digest(bytes),sizeBytes:bytes.length,width:512,height:512,mimeType:"image/png",ledgerIdentity:randomUUID(),requestHash:"a".repeat(64),packageFingerprint:"b".repeat(64),executionDevice:"c".repeat(64),generatedAt:new Date().toISOString(),localExpiresAt:new Date(Date.now()+86400000).toISOString()},payload:{intent:{prompt:"A test image",profile:"test"},recipeSnapshot:{recipeId:"recipe",label:"Recipe",settings:{width:512,height:512}}}};
  if(a.p_action==="source"&&expireSource)return {data:{error:"expired"}};
  if(a.p_action==="mapping")save={...save!,object_mapping:a.p_mapping};
  if(a.p_action==="finish"){save={...save!,state:"saved"};saved=true;if(failFinish)throw Error("lost-commit-ack");}
  if(a.p_action==="fail"&&!saved)save={...save!,state:"save-failed"};
  return {data:{save,result:save?{descriptor:save.descriptor}:null,...(saved?{historyRemoved:true}:{})}};
 });
});
afterEach(()=>vi.unstubAllEnvs());
it("publishes exact final bytes through a frozen mapping and hides storage identities",async()=>{const r=await connectSavePOST(request(),id);expect(r.status).toBe(200);const text=await r.text();expect(text).not.toContain(destination.location);expect(text).not.toContain(owner);expect(m.ensure.mock.calls[0][3]).toEqual(bytes);expect(save?.object_mapping?.imageRef.objectKey).toContain(`/connect-generated/${save?.generation_id}/`);expect(JSON.parse(save!.object_mapping!.metadataBody)).toMatchObject({connectJobId:id,sha256:digest(bytes)});});
it("returns an existing saved tombstone without storage writes",async()=>{await connectSavePOST(request(),id);m.ensure.mockClear();const r=await connectSavePOST(request(),id);expect((await r.json()).save.historyRemoved).toBe(true);expect(m.ensure).not.toHaveBeenCalled();});
it("reconciles a lost database finish acknowledgement",async()=>{failFinish=true;const r=await connectSavePOST(request(),id);expect(r.status).toBe(200);expect((await r.json()).save.state).toBe("saved");expect(m.rpc.mock.calls.some(c=>c[1].p_action==="fail")).toBe(false);});
it("returns queued status for a concurrent save without uploading",async()=>{concurrent=true;expect((await connectSavePOST(request(),id)).status).toBe(202);expect(m.ensure).not.toHaveBeenCalled();});
it("recovers from existing permanent bytes without accessing expired staging",async()=>{expireSource=true;m.read.mockResolvedValue(bytes);expect((await connectSavePOST(request(),id)).status).toBe(200);expect(m.source).not.toHaveBeenCalled();});
it("retains a failed save when staging is expired and no permanent image exists",async()=>{expireSource=true;expect((await connectSavePOST(request(),id)).status).toBe(410);expect(save?.state).toBe("save-failed");expect(m.ensure).not.toHaveBeenCalled();});
it("does not publish when metadata storage fails",async()=>{m.ensure.mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error("storage-full"));expect((await connectSavePOST(request(),id)).status).toBe(503);expect(m.rpc.mock.calls.some(c=>c[1].p_action==="finish")).toBe(false);expect(save?.state).toBe("save-failed");});
it("rejects a changed destination before publication",async()=>{m.resolve.mockResolvedValueOnce({destination}).mockResolvedValueOnce({destination:{...destination,location:"https://other.test"}});expect((await connectSavePOST(request(),id)).status).toBe(409);expect(saved).toBe(false);});
it("rejects malformed save inputs and missing browser Origin",async()=>{expect((await connectSavePOST(request('{"destination":"other"}'),id)).status).toBe(400);const r=request();r.headers.delete("origin");expect((await connectSavePOST(r,id)).status).toBe(403);expect(m.rpc).not.toHaveBeenCalled();});
it("requires verified owner and keeps Connect gates closed",async()=>{m.user.mockResolvedValue({data:{user:null}});expect((await connectSaveGET(request("","GET"),id)).status).toBe(401);vi.stubEnv("KAVERO_CONNECT_RESULTS_ENABLED","0");expect((await connectSavePOST(request(),id)).status).toBe(404);expect(m.rpc).not.toHaveBeenCalled();});
it("never publishes corrupt final objects",async()=>{m.read.mockResolvedValue(Buffer.from("corrupt"));expect((await connectSavePOST(request(),id)).status).toBe(503);expect(m.ensure).not.toHaveBeenCalled();});
