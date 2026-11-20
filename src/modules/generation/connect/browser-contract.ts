import { z } from "zod";
import { profile } from "@/modules/model-providers/local/connect/contracts";

export const submission = z.object({action:z.literal("create"),deviceId:z.string().uuid(),key:z.string().uuid(),bindingHash:z.string().regex(/^[a-f0-9]{64}$/),profile,execute:z.literal(true),prompt:z.string().min(1).max(1000).refine(v=>!!v.trim())}).strict();
export const receipt = z.object({version:z.literal(1),owner:z.string().uuid(),origin:z.string().url(),computerName:z.string().max(60),modelLabel:z.string().max(120),submission,jobId:z.string().uuid().optional(),notAdmitted:z.boolean().optional()}).strict();
export type Receipt=z.infer<typeof receipt>;
export const browserJob=z.object({id:z.string().uuid(),deviceId:z.string().uuid(),key:z.string().uuid(),state:z.enum(["waiting","delivered","accepted","running","submission-unknown","generated-unvalidated","failed","cancelled","rejected","expired"]),cancelRequested:z.boolean(),version:z.number().int(),payload:z.object({intent:z.object({prompt:z.string(),profile}),execute:z.literal(true)}).passthrough()}).passthrough();
export type BrowserJob=z.infer<typeof browserJob>;
export const browserResult=z.object({jobId:z.string().uuid(),state:z.enum(["pending","uploading","available","deleting","expired"]),expiresAt:z.string().datetime({offset:true}),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().positive().max(32*1024*1024),width:z.literal(512),height:z.literal(512),mimeType:z.literal("image/png")}).strict();
export const browserSave=z.object({state:z.enum(["available","saving","save-failed","saved"]),generationId:z.string().uuid().optional(),imageId:z.string().uuid().optional(),historyRemoved:z.boolean().optional(),storageProvider:z.string().optional(),storageBackend:z.string().optional()}).strict();
export type BrowserResult=z.infer<typeof browserResult>;
export type BrowserSave=z.infer<typeof browserSave>;
export function readReceipt(storage:Storage,key:string,owner:string,origin:string):Receipt|null {
 const text=storage.getItem(key);if(!text)return null;
 if(text.length>8192)throw Error("The saved request is invalid. Keep this browser data while checking your computer's jobs.");
 const r=receipt.parse(JSON.parse(text));if(r.owner!==owner||r.origin!==origin)throw Error("The saved request belongs to a different account or website.");return r;
}
export function verifyJob(value:unknown,r:Receipt):BrowserJob {
 const job=browserJob.parse(value);
 if(job.key!==r.submission.key||job.deviceId!==r.submission.deviceId||job.payload.intent.prompt!==r.submission.prompt||job.payload.intent.profile!==r.submission.profile||(r.jobId&&job.id!==r.jobId))throw Error("The job identity changed. Reconnect to the original request.");return job;
}
export function canFinish(job:BrowserJob|null,result:BrowserResult|null,save:BrowserSave|null){return save?.state==="saved"||["failed","cancelled","rejected","expired"].includes(job?.state??"")||result?.state==="expired";}
export function statusMessage(job:BrowserJob|null,result:BrowserResult|null,save:BrowserSave|null,uncertain:boolean){
 if(save?.state==="saved")return save.historyRemoved?"Saved previously · removed from Gallery.":"Saved to Gallery.";
 if(uncertain)return "Reconnecting to the original job. Retry checks the same request.";
 if(save?.state==="saving")return "Saving to managed storage…";
 if(result?.state==="expired"||job?.state==="expired")return "The retained image or job has expired.";
 if(result?.state==="available")return save?.state==="save-failed"?"Image available. Saving failed; download or retry saving.":"Image available to download or save.";
 if(result?.state==="deleting")return "The retained image is being removed.";
 if(result)return "Transferring and validating the image…";
 if(job?.cancelRequested&&!canFinish(job,result,save))return "Cancellation requested. The computer may still be finishing accepted work.";
 if(job?.state==="generated-unvalidated")return "Generated on your computer. Waiting for validated transfer.";
 if(job?.state==="submission-unknown")return "The computer is reconciling the original job.";
 if(job?.state==="waiting")return "Queued · waiting for your computer.";
 if(["failed","cancelled","rejected"].includes(job?.state??""))return `Generation ${job!.state}.`;
 return job?"Creating on your computer… You can return later.":"Ready to create.";
}
