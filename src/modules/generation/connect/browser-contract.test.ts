import {describe,it,expect} from "vitest";
import {receipt,readReceipt,verifyJob,statusMessage,canFinish,browserResult,type Receipt} from "./browser-contract";
const owner="11111111-1111-4111-8111-111111111111",device="22222222-2222-4222-8222-222222222222",key="33333333-3333-4333-8333-333333333333",id="44444444-4444-4444-8444-444444444444";
const r:Receipt={version:1,owner,origin:"https://example.test",computerName:"PC",modelLabel:"Q4",submission:{action:"create",deviceId:device,key,bindingHash:"a".repeat(64),profile:"qwen-image-2.1-q4-evaluation",execute:true,prompt:"A vase"}};
const job={id,deviceId:device,key,state:"running",cancelRequested:false,version:2,payload:{execute:true,intent:{prompt:r.submission.prompt,profile:r.submission.profile}}};
describe("Connect browser identity and states",()=>{
 it("accepts the database UTC offset in retained result expiry",()=>{expect(browserResult.safeParse({jobId:id,state:"available",expiresAt:"2026-11-04T10:20:30.123456+00:00",sha256:"a".repeat(64),sizeBytes:100,width:512,height:512,mimeType:"image/png"}).success).toBe(true);});
 it("bounds and scopes stored intent",()=>{localStorage.clear();localStorage.setItem("r",JSON.stringify(r));expect(readReceipt(localStorage,"r",owner,r.origin)).toEqual(r);expect(()=>readReceipt(localStorage,"r",device,r.origin)).toThrow();expect(()=>readReceipt(localStorage,"r",owner,"https://other.test")).toThrow();localStorage.setItem("r","x".repeat(8193));expect(()=>readReceipt(localStorage,"r",owner,r.origin)).toThrow();});
 it("rejects changed payload and unsupported prompt without truncation",()=>{expect(receipt.safeParse({...r,submission:{...r.submission,prompt:"x".repeat(1001)}}).success).toBe(false);expect(receipt.safeParse({...r,submission:{...r.submission,width:1024}}).success).toBe(false);});
 it.each(["key","deviceId","id"])("checks immutable %s",field=>{expect(()=>verifyJob({...job,[field]:owner},{...r,jobId:id})).toThrow();});
 it("checks original prompt and profile",()=>{expect(()=>verifyJob({...job,payload:{execute:true,intent:{prompt:"changed",profile:r.submission.profile}}},r)).toThrow();expect(verifyJob(job,r).id).toBe(id);});
 it("does not equate generated with available",()=>{expect(statusMessage({...job,state:"generated-unvalidated"} as never,null,null,false)).toMatch(/validated transfer/);expect(canFinish(job as never,null,null)).toBe(false);});
 it("preserves tombstones and uncertainty",()=>{expect(statusMessage(job as never,null,{state:"saved",historyRemoved:true},true)).toMatch(/removed from Gallery/);expect(statusMessage(job as never,null,null,true)).toMatch(/original job/);expect(canFinish(job as never,null,{state:"saved"})).toBe(true);});
});
