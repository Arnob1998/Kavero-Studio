import { z } from "zod";
export const computerStatus=z.enum(["ready","busy","offline","not-ready","permission-needed","maintenance","revoked","expired"]);
export const computer=z.object({id:z.string().uuid(),name:z.string().max(60),status:computerStatus,lastSeenAt:z.string().nullable(),
 model:z.object({profile:z.string(),label:z.string()}).nullable(),
 capability:z.object({bindingHash:z.string().regex(/^[a-f0-9]{64}$/),width:z.literal(512),height:z.literal(512),count:z.literal(1),promptLimit:z.literal(1000)}).nullable(),
 outstanding:z.number().int().nonnegative(),hardware:z.object({ramMiB:z.number(),gpus:z.array(z.object({label:z.string(),vramMiB:z.number()}))}).nullable()}).strict();
export const computerList=z.object({version:z.literal(1),serverTime:z.string().datetime(),computers:z.array(computer).max(50),ownerOutstanding:z.number().int().nonnegative()}).strict();
export type Computer=z.infer<typeof computer>;
export const pairing=z.object({id:z.string().uuid(),name:z.string(),origin:z.string(),state:z.enum(["pending","claimed","confirmed","cancelled"]),expiresAt:z.string(),installationId:z.string().uuid().nullable(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/).nullable(),deviceId:z.string().uuid().nullable()});
export type Pairing=z.infer<typeof pairing>;
export const computerLabels:Record<Computer["status"],string>={ready:"Ready",busy:"Busy",offline:"Offline","not-ready":"Not ready","permission-needed":"Permission needed",maintenance:"Maintenance",revoked:"Disconnected",expired:"Connection expired"};
