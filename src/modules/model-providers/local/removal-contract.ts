import {z} from 'zod';
export const removalUUID=z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i);
export const removalPackage=z.enum(['qwen-2-1-internal-evaluation','qwen-2-1-q3-internal-evaluation']);
export const removalDigest=z.string().regex(/^[a-f0-9]{64}$/);
const bytes=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const removalReviewSchema=z.object({instanceId:removalUUID,packageId:removalPackage,manifest:removalDigest,scope:z.literal('managed-delivery'),accountOnly:z.boolean().default(false),canRemove:z.boolean(),reclaimableBytes:bytes,retainedBytes:bytes,reason:z.string().max(80).nullable()}).strict();
export const nativeRemovalSchema=z.object({id:removalUUID,key:removalUUID,appFence:removalUUID,instanceId:removalUUID,packageId:removalPackage,manifest:removalDigest,
 accountOnly:z.boolean().default(false),state:z.enum(['admitted','removing','failed','interrupted','removed']),reclaimedBytes:bytes,retainedBytes:bytes,retainedFiles:z.number().int().nonnegative(),error:z.string().max(80).nullable(),scope:z.literal('managed-delivery'),complete:z.boolean()}).strict();
export const removalOperationSchema=z.object({id:removalUUID,key:removalUUID,instanceId:removalUUID,packageId:removalPackage,manifest:removalDigest,
 accountOnly:z.boolean().default(false),state:z.enum(['awaiting-retry','admitted','removing','failed','interrupted','removed','refused']),reclaimedBytes:bytes,retainedBytes:bytes,error:z.string().max(300).nullable()}).strict();
export type RemovalReview=z.infer<typeof removalReviewSchema>;
export type RemovalOperation=z.infer<typeof removalOperationSchema>;
