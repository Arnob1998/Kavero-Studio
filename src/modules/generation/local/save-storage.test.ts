// @vitest-environment node
import { describe,it,expect,afterEach,vi } from "vitest";
import { mkdtemp,mkdir,rm,writeFile } from "node:fs/promises";
import os from "node:os"; import path from "node:path";
import { createLocalFilesystemStorageBackend } from "@/modules/storage/backends/local-filesystem/local-filesystem-backend";
import { createSupabaseStorageBackend } from "@/modules/storage/backends/supabase-storage/supabase-storage-backend";
import { createLocalSaveMapping,ensureLocalSaveObject,readLocalSaveObject,objectSHA } from "./save-storage";
import type { LocalSaveRecord } from "./save-contract";
import type { LocalJobRecord } from "./contracts";
const roots: string[]=[];
afterEach(async()=>{vi.unstubAllGlobals();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const save: LocalSaveRecord={job_id:"11111111-1111-4111-8111-111111111111",owner_id:"22222222-2222-4222-8222-222222222222",
  generation_id:"33333333-3333-4333-8333-333333333333",image_id:"44444444-4444-4444-8444-444444444444",sha256:"a".repeat(64),
  destination:{provider:"kavero-managed",backendId:"local-filesystem",location:"test"},object_mapping:null,state:"saving",
  attempt_token:"55555555-5555-4555-8555-555555555555",lease_until:"2099-01-01T00:00:00.000Z",created_at:"2026-10-03T00:00:00.000Z"};
const job={id:save.job_id,intent:{prompt:"A vase",profile:"qwen-image-2.1-q4-evaluation"},package_fingerprint:"b".repeat(64)} as LocalJobRecord;
describe("Create-only local save object recovery",()=>{
  it("reconciles a real filesystem create whose acknowledgement is lost",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"kavero-save-"));roots.push(root);
    const backend=createLocalFilesystemStorageBackend({root}),runtime={destination:save.destination,backend};
    const mapping=await createLocalSaveMapping(save,job,runtime),data=Buffer.from("immutable bytes");
    const original=backend.uploadObject.bind(backend);let uploads=0;
    backend.uploadObject=async input=>{uploads++;await original(input);throw new Error("lost acknowledgement");};
    await ensureLocalSaveObject(runtime,save,mapping.imageRef,data,()=>{});
    await ensureLocalSaveObject(runtime,save,mapping.imageRef,data,()=>{});
    expect(uploads).toBe(1);expect(await readLocalSaveObject(runtime,save,mapping.imageRef,objectSHA(data),data.length)).toEqual(data);
  });
  it("rejects an existing corrupt object and never overwrites it",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"kavero-save-"));roots.push(root);
    const backend=createLocalFilesystemStorageBackend({root}),runtime={destination:save.destination,backend},mapping=await createLocalSaveMapping(save,job,runtime);
    const filename=path.join(root,mapping.imageRef.objectKey);await mkdir(path.dirname(filename),{recursive:true});await writeFile(filename,"bad");
    await expect(ensureLocalSaveObject(runtime,save,mapping.imageRef,Buffer.from("good"),()=>{})).rejects.toThrow("local-save-object-conflict");
  });
  it("reconciles create-only Supabase Storage uploads and interrupted image/metadata pairs",async()=>{
    const objects=new Map<string,Buffer>();let uploads=0;let failMetadata=true;
    const backend=createSupabaseStorageBackend({client:{storage:{from:bucket=>({
      upload:async(key,data,options)=>{
        expect(options.upsert).toBe(false);uploads++;const full=bucket+"/"+key;
        if(bucket.includes("metadata")&&failMetadata)return {data:null,error:{message:"disk full",status:507}};
        if(objects.has(full))return {data:null,error:{message:"exists",status:409}};
        objects.set(full,Buffer.from(data as Uint8Array));return {data:null,error:{message:"lost upload ack",status:500}};
      },download:async key=>({data:objects.get(bucket+"/"+key)??null,error:objects.has(bucket+"/"+key)?null:{message:"not found",status:404}}),remove:async()=>({data:null,error:null}),
    })}}});
    const record={...save,destination:{provider:"kavero-managed" as const,backendId:"supabase-storage" as const,location:"test"}},runtime={destination:record.destination,backend},mapping=await createLocalSaveMapping(record,job,runtime);
    await ensureLocalSaveObject(runtime,record,mapping.imageRef,Buffer.from("image"),()=>{});
    await expect(ensureLocalSaveObject(runtime,record,mapping.metadataRef,Buffer.from(mapping.metadataBody),()=>{})).rejects.toThrow();
    failMetadata=false;
    await ensureLocalSaveObject(runtime,record,mapping.imageRef,Buffer.from("image"),()=>{});
    await ensureLocalSaveObject(runtime,record,mapping.metadataRef,Buffer.from(mapping.metadataBody),()=>{});
    expect(objects.size).toBe(2);expect(uploads).toBe(3);
  });
  it("stops before upload when its attempt loses ownership",async()=>{
    const root=await mkdtemp(path.join(os.tmpdir(),"kavero-save-"));roots.push(root);const backend=createLocalFilesystemStorageBackend({root});
    const runtime={destination:save.destination,backend},mapping=await createLocalSaveMapping(save,job,runtime),upload=vi.spyOn(backend,"uploadObject");
    await expect(ensureLocalSaveObject(runtime,save,mapping.imageRef,Buffer.from("image"),()=>{throw new Error("attempt expired");})).rejects.toThrow("attempt expired");expect(upload).not.toHaveBeenCalled();
  });
});

describe("Reserved Drive ID recovery",()=>{
  function drive() {
    const objects=new Map<string,{meta:Record<string,unknown>;bytes:Buffer}>();let uploads=0,loseAck=true,hideExisting=false;
    vi.stubGlobal("fetch",vi.fn(async(urlValue: string,init: RequestInit)=>{
      const url=new URL(urlValue);
      if(url.pathname.endsWith("generateIds"))return Response.json({ids:["reserved_image_123","reserved_meta_123"]});
      if(init.method==="POST"){
        uploads++;const body=Buffer.from(init.body as Uint8Array),boundary=String((init.headers as Record<string,string>)["Content-Type"]).split("boundary=")[1];
        const first=body.indexOf("\r\n\r\n")+4,next=body.indexOf(`\r\n--${boundary}`,first),meta=JSON.parse(body.subarray(first,next).toString("utf8"));
        const start=body.indexOf("\r\n\r\n",next)+4,end=body.indexOf(`\r\n--${boundary}--`,start),bytes=body.subarray(start,end);
        if(objects.has(meta.id))return new Response(null,{status:409});
        objects.set(meta.id,{meta:{...meta,size:String(bytes.length),trashed:false},bytes});
        if(loseAck){loseAck=false;throw new Error("lost acknowledgement");}return Response.json({id:meta.id});
      }
      const id=decodeURIComponent(url.pathname.split("/").at(-1)!);const object=objects.get(id);
      if(!object || (hideExisting&&url.searchParams.has("fields"))){hideExisting=false;return new Response(null,{status:404});}
      return url.searchParams.get("alt")==="media"?new Response(new Uint8Array(object.bytes)):Response.json(object.meta);
    }));
    return {objects,get uploads(){return uploads;},hide(){hideExisting=true;}};
  }
  const record:LocalSaveRecord={...save,destination:{provider:"google-drive",connectionId:"connection",email:"test@example.local",folderId:"folder"}};
  it("persists exact multipart bytes with stable IDs despite lost acknowledgements",async()=>{
    const d=drive(),runtime={destination:record.destination,token:"test-token"},mapping=await createLocalSaveMapping(record,job,runtime),bytes=Buffer.from([0,255,13,10,128]);
    await ensureLocalSaveObject(runtime,record,mapping.imageRef,bytes,()=>{});
    await ensureLocalSaveObject(runtime,record,mapping.metadataRef,Buffer.from(mapping.metadataBody),()=>{});
    await ensureLocalSaveObject(runtime,record,mapping.imageRef,bytes,()=>{});
    expect(d.uploads).toBe(2);expect(d.objects.size).toBe(2);expect(d.objects.get("reserved_image_123")!.bytes).toEqual(bytes);
  });
  it("retries the same reserved ID on a transient missing read/409 create",async()=>{
    const d=drive(),runtime={destination:record.destination,token:"test-token"},mapping=await createLocalSaveMapping(record,job,runtime),bytes=Buffer.from("image");
    await ensureLocalSaveObject(runtime,record,mapping.imageRef,bytes,()=>{});d.hide();
    await ensureLocalSaveObject(runtime,record,mapping.imageRef,bytes,()=>{});expect(d.uploads).toBe(2);expect(d.objects.size).toBe(1);
  });
  it("rejects moved/unrelated Drive files without allocating replacements",async()=>{
    const d=drive(),runtime={destination:record.destination,token:"test-token"},mapping=await createLocalSaveMapping(record,job,runtime),bytes=Buffer.from("image");
    await ensureLocalSaveObject(runtime,record,mapping.imageRef,bytes,()=>{});d.objects.get("reserved_image_123")!.meta.parents=["other-folder"];
    await expect(ensureLocalSaveObject(runtime,record,mapping.imageRef,bytes,()=>{})).rejects.toThrow("local-save-object-conflict");expect(d.uploads).toBe(1);
  });
});
