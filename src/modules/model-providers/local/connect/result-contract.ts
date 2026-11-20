import { z } from "zod";
import { uuid, fingerprint } from "./contracts";
export const RESULT_BUCKET = "kavero-connect-results";
export { RESULT_CONTROL, RESULT_UPLOAD, resultProof } from "./result-protocol";
export const resultDescriptor = z.object({
 role:z.literal("final"),sha256:fingerprint,sizeBytes:z.number().int().positive().max(32*1024*1024),
 width:z.literal(512),height:z.literal(512),mimeType:z.literal("image/png"),
 ledgerIdentity:uuid,requestHash:fingerprint,packageFingerprint:fingerprint,executionDevice:fingerprint,
 generatedAt:z.string().datetime(),localExpiresAt:z.string().datetime(),
}).strict().refine(d=>Date.parse(d.localExpiresAt)-Date.parse(d.generatedAt)===86400000 && Date.parse(d.generatedAt)<=Date.now()+60000);
export const resultOffer=z.object({action:z.literal("offer"),jobId:uuid,attempt:z.number().int().positive().max(2147483647),descriptor:resultDescriptor}).strict();
export const resultUpload=z.object({jobId:uuid,attempt:z.number().int().positive().max(2147483647),token:uuid,sha256:fingerprint,sizeBytes:z.number().int().positive().max(32*1024*1024)}).strict();
export type ResultRow={job_id:string;owner_id:string;device_id:string;origin:string;attempt:number;descriptor:z.infer<typeof resultDescriptor>;
 object_key:string;state:"pending"|"uploading"|"available"|"deleting"|"expired";token:string;lease_until:string;expires_at:string;cleanup_token:string};
export function resultSummary(r:ResultRow){return {jobId:r.job_id,state:r.state,expiresAt:r.expires_at,sha256:r.descriptor.sha256,sizeBytes:r.descriptor.sizeBytes,width:512,height:512,mimeType:"image/png"};}
