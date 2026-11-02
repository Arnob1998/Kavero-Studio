// @vitest-environment node
import { describe,it,expect,vi,beforeEach,afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { LocalJobRecord } from "./contracts";
import type { LocalSaveRecord,LocalSaveDestination } from "./save-contract";
import type { ManagedStorageBackend } from "@/modules/storage/managed/kavero-managed-storage";
import { StorageError } from "@/modules/storage/storage-provider";
import { validateLocalPNG } from "@/modules/model-providers/local/png";
// @ts-expect-error Native test fixture has no declarations.
import { pngFixture } from "../../../../scripts/local-generation/png-fixture.mjs";
const mock=vi.hoisted(()=>({enabled:true,owner:"",job:null as LocalJobRecord|null,save:null as LocalSaveRecord|null,
  runtime:null as unknown,admin:vi.fn(),retrieve:vi.fn(),acquire:vi.fn(),lease:vi.fn(),ack:vi.fn(),resolve:vi.fn(),
  objects:new Map<string,Buffer>(),published:false,finishFault:"",finishCalls:0,uploadCalls:0,failMetadata:false,afterImageAck:false}));
vi.mock("./service",()=>({context:async()=>!mock.enabled?{response:Response.json({}, {status:404})}:!mock.owner?{response:Response.json({}, {status:401})}:{owner:mock.owner},
  load:async(owner:string,id:string)=>mock.job?.owner_id===owner&&mock.job.id===id?mock.job:null,
  inspectAndCheckpoint:async(job:LocalJobRecord)=>job}));
vi.mock("@/lib/supabase/admin",()=>({createAdminClient:mock.admin}));
vi.mock("@/modules/model-providers/local/bridge",()=>({acquireLocalOutputLease:mock.acquire,manageLocalOutputLease:mock.lease,retrieveLocalOutput:mock.retrieve,acknowledgeLocalOutputSaved:mock.ack}));
vi.mock("./save-storage",async importOriginal=>({...await importOriginal<typeof import("./save-storage")>(),resolveLocalSaveDestination:mock.resolve}));
import { saveLocalOutput,getLocalSave } from "./save-service";
import { sameLocalSaveDestination } from "./save-contract";
import {existingJobSnapshot,jobRequestHash} from '@/modules/model-providers/local/job-snapshot';
const owner="11111111-1111-4111-8111-111111111111",id="22222222-2222-4222-8222-222222222222",bytes=pngFixture();
const destination:LocalSaveDestination={provider:"kavero-managed",backendId:"local-filesystem",location:"frozen-root"};
const post=()=>saveLocalOutput(id,new Request("http://localhost",{method:"POST"}));
beforeEach(()=>{
  vi.clearAllMocks();mock.enabled=true;mock.owner=owner;mock.save=null;mock.objects.clear();mock.published=false;mock.finishFault="";mock.finishCalls=0;mock.uploadCalls=0;mock.failMetadata=false;mock.afterImageAck=false;
  mock.job={id,owner_id:owner,submission_key:id,request_hash:"a".repeat(64),package_fingerprint:"b".repeat(64),device_id:"gpu",worker_identity:"33333333-3333-4333-8333-333333333333",
    intent:{profile:"qwen-image-2.1-q4-evaluation",prompt:"A vase",width:512,height:512,count:1},state:"generated-unvalidated",created_at:new Date().toISOString()};
  mock.job.output_descriptor={...validateLocalPNG(bytes),jobId:id,ownerId:owner,ledgerIdentity:mock.job.worker_identity,requestHash:mock.job.request_hash,packageFingerprint:mock.job.package_fingerprint,deviceId:"gpu",
    generatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  const backend={id:"local-filesystem",readObject:async({ref}:{ref:{objectKey:string}})=>{
    const data=mock.objects.get(ref.objectKey);if(!data)throw new StorageError("missing",{code:"missing",providerId:"kavero-managed"});return {data,mimeType:"image/png"};
  },uploadObject:async(input:{metadata:{objectKey:string};purpose:string;data:Uint8Array})=>{
    mock.uploadCalls++;if(mock.failMetadata&&input.purpose==="generated-metadata")throw new Error("disk full");
    const key=input.metadata.objectKey;if(mock.objects.has(key))throw new Error("exists");mock.objects.set(key,Buffer.from(input.data));
    if(mock.afterImageAck){mock.afterImageAck=false;throw new Error("lost ack");}return {};
  }} as unknown as ManagedStorageBackend;
  mock.runtime={destination,backend};mock.resolve.mockImplementation(async()=>mock.runtime);
  mock.retrieve.mockResolvedValue(bytes);mock.acquire.mockResolvedValue({token:randomUUID()});mock.lease.mockResolvedValue({});mock.ack.mockResolvedValue({});
  mock.admin.mockImplementation(()=>({from:(table:string)=>{
    const filters:Record<string,unknown>={};const chain={select:()=>chain,eq:(key:string,value:unknown)=>{filters[key]=value;return chain;},maybeSingle:async()=>({data:table==="generated_images"?(mock.published?{id:mock.save!.image_id}:null):(mock.save&&mock.save.owner_id===filters.owner_id&&mock.save.job_id===filters.job_id?mock.save:null),error:null})};return chain;
  },rpc:async(name:string,p:Record<string,unknown>)=>{
    if(name==="claim_local_generation_save"){
      if(mock.save){if(!sameLocalSaveDestination(mock.save.destination,p.p_destination as LocalSaveDestination))return {data:null,error:{message:"local-save-destination-changed"}};
        if(mock.save.state==="saved"||(mock.save.state==="saving"&&Date.parse(mock.save.lease_until)>Date.now()))return {data:mock.save,error:null};
        mock.save={...mock.save,state:"saving",attempt_token:String(p.p_token),lease_until:new Date(Date.now()+120000).toISOString()};
      }else mock.save={job_id:id,owner_id:owner,generation_id:randomUUID(),image_id:randomUUID(),sha256:mock.job!.output_descriptor!.sha256,
        destination:Object.fromEntries(Object.entries(p.p_destination as LocalSaveDestination).sort(([a],[b])=>a.localeCompare(b))) as LocalSaveDestination,object_mapping:null,state:"saving",attempt_token:String(p.p_token),lease_until:new Date(Date.now()+120000).toISOString(),created_at:new Date().toISOString()};
      return {data:mock.save,error:null};
    }
    const s=mock.save!;if(s.state==="saved")return {data:s,error:null};
    if(s.attempt_token!==p.p_token||Date.parse(s.lease_until)<=Date.now()||s.state!=="saving")return {data:null,error:{message:"local-save-attempt-expired"}};
    if(p.p_action==="mapping")mock.save={...s,object_mapping:p.p_mapping as LocalSaveRecord["object_mapping"]};
    if(p.p_action==="renew")mock.save={...s,lease_until:new Date(Date.now()+120000).toISOString()};
    if(p.p_action==="fail")mock.save={...s,state:"save-failed"};
    if(p.p_action==="finish"){
      mock.finishCalls++;if(mock.finishFault==="before")return {data:null,error:{message:"database disconnected"}};
      mock.save={...s,state:"saved"};mock.published=true;if(mock.finishFault==="after")return {data:null,error:{message:"lost commit ack"}};
    }
    return {data:mock.save,error:null};
  }}));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe("Recoverable local save transaction",()=>{
  it('recovers versioned metadata after storage failure without generating or changing save IDs',async()=>{
    const snapshot=existingJobSnapshot();mock.job={...mock.job!,recipe_snapshot:snapshot,package_fingerprint:snapshot.packageFingerprint,request_hash:jobRequestHash(mock.job!.intent,snapshot)};
    mock.job.output_descriptor={...mock.job.output_descriptor!,recipeSnapshot:snapshot,packageFingerprint:snapshot.packageFingerprint,requestHash:mock.job.request_hash};
    mock.failMetadata=true;expect((await post()).status).toBe(503);const mapping=mock.save!.object_mapping!,generation=mock.save!.generation_id;
    expect(JSON.parse(mapping.metadataBody).recipeSnapshot).toEqual(snapshot);
    mock.failMetadata=false;expect((await post()).status).toBe(200);expect(mock.save!.generation_id).toBe(generation);expect(mock.save!.object_mapping).toEqual(mapping);
    const readCount=mock.retrieve.mock.calls.length;expect((await post()).status).toBe(200);expect(mock.retrieve).toHaveBeenCalledTimes(readCount);expect(mock.finishCalls).toBe(1);
  });
  it("blocks unverified Drive writes in the normal Local release before claiming or uploading",async()=>{
    vi.stubEnv("KAVERO_LOCAL_GENERATION_ENABLED","1");vi.stubEnv("KAVERO_LOCAL_GENERATION_DRIVE_EVALUATION","0");
    mock.resolve.mockResolvedValue({destination:{provider:"google-drive",connectionId:id,email:null,folderId:"isolated-folder"}});
    expect((await post()).status).toBe(503);expect(mock.save).toBeNull();expect(mock.acquire).not.toHaveBeenCalled();expect(mock.uploadCalls).toBe(0);
  });
  it("rejects disabled/anonymous/other owners and forged save options",async()=>{
    mock.enabled=false;expect((await post()).status).toBe(404);mock.enabled=true;mock.owner="";expect((await post()).status).toBe(401);
    mock.owner=randomUUID();expect((await post()).status).toBe(404);mock.owner=owner;
    expect((await saveLocalOutput(id,new Request("http://localhost",{method:"POST",body:JSON.stringify({owner:randomUUID(),destination:"other"})}))).status).toBe(400);
    expect(mock.acquire).not.toHaveBeenCalled();expect(mock.uploadCalls).toBe(0);
  });
  it("publishes once and replays stable IDs without reading the native source again",async()=>{
    const first=await post(),summary=(await first.json()).save;expect(first.status).toBe(200);
    const second=await post();expect((await second.json()).save).toEqual(summary);
    expect(mock.retrieve).toHaveBeenCalledTimes(1);expect(mock.uploadCalls).toBe(2);expect(mock.finishCalls).toBe(1);
    expect(mock.lease).toHaveBeenCalledWith(mock.job,expect.any(String),true);
  });
  it("returns a durable saving handle to competing requests",async()=>{
    let resolve!:()=>void;const gate=new Promise<void>(r=>{resolve=r;});mock.retrieve.mockImplementation(async()=>{await gate;return bytes;});
    const first=post();for(let i=0;i<30&&!mock.retrieve.mock.calls.length;i++)await Promise.resolve();
    const second=await post();expect(second.status).toBe(202);expect(mock.acquire).toHaveBeenCalledTimes(1);
    resolve();expect((await first).status).toBe(200);expect(mock.finishCalls).toBe(1);
  });
  it("preserves partial uploads after a metadata failure and resumes without inference",async()=>{
    mock.failMetadata=true;const first=await post();expect(first.status).toBe(503);expect(mock.objects.size).toBe(1);const stable=mock.save!.image_id;
    mock.failMetadata=false;mock.acquire.mockRejectedValue(new Error("local-output-expired"));mock.retrieve.mockRejectedValue(new Error("should not read source"));
    expect((await post()).status).toBe(200);expect(mock.save!.image_id).toBe(stable);expect(mock.objects.size).toBe(2);expect(mock.retrieve).toHaveBeenCalledTimes(1);
  });
  it("recovers after database publication failure using already confirmed objects",async()=>{
    mock.finishFault="before";expect((await post()).status).toBe(503);expect(mock.save!.state).toBe("save-failed");expect(mock.objects.size).toBe(2);
    const stable=mock.save!.generation_id;mock.finishFault="";mock.acquire.mockRejectedValue(new Error("host disconnected"));
    expect((await post()).status).toBe(200);expect(mock.save!.generation_id).toBe(stable);expect(mock.uploadCalls).toBe(2);expect(mock.retrieve).toHaveBeenCalledTimes(1);
  });
  it("reconciles lost upload and transaction acknowledgements without duplicates",async()=>{
    mock.afterImageAck=true;mock.finishFault="after";expect((await post()).status).toBe(200);expect((await post()).status).toBe(200);
    expect(mock.finishCalls).toBe(1);expect(mock.objects.size).toBe(2);expect(mock.uploadCalls).toBe(2);
  });
  it("fails closed when the frozen destination changes before retry or publication",async()=>{
    mock.finishFault="before";await post();mock.finishFault="";mock.runtime={...(mock.runtime as object),destination:{...destination,location:"new-root"}};
    expect((await post()).status).toBe(409);expect(mock.finishCalls).toBe(1);expect(mock.objects.size).toBe(2);
  });
  it("never resurrects deleted Gallery history on saved replay",async()=>{
    await post();mock.published=false;mock.objects.clear();const response=await post();expect(response.status).toBe(200);
    expect((await response.json()).save.historyRemoved).toBe(true);expect(mock.objects.size).toBe(0);expect(mock.finishCalls).toBe(1);
    expect((await getLocalSave(id)).status).toBe(200);
  });
  it("reports expired source and preserves the same save identity for a later explicit retry",async()=>{
    mock.acquire.mockRejectedValue(new Error("local-output-expired"));expect((await post()).status).toBe(410);const stable=mock.save!.image_id;
    expect((await post()).status).toBe(410);expect(mock.save!.image_id).toBe(stable);expect(mock.objects.size).toBe(0);
  });
  it("fences a hung attempt after its deadline while another retry completes",async()=>{
    vi.useFakeTimers();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
    mock.retrieve.mockImplementationOnce(async()=>{await gate;return bytes;});const first=post();
    for(let i=0;i<40&&!mock.retrieve.mock.calls.length;i++)await Promise.resolve();
    await vi.advanceTimersByTimeAsync(201000);expect((await post()).status).toBe(200);release();
    expect((await first).status).toBe(200);expect(mock.finishCalls).toBe(1);expect(mock.objects.size).toBe(2);
  });
});
