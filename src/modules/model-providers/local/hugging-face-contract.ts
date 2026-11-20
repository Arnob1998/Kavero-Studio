import { z } from 'zod';

export const huggingFaceModel = z.object({
  id: z.string().regex(/^[\w-]+\/[\w.-]+$/).max(180),
  author: z.string().max(100), name: z.string().max(180),
  downloads: z.number().int().nonnegative(), likes: z.number().int().nonnegative(),
  task: z.enum(['text-to-image', 'image-to-image']),
  format: z.enum(['GGUF', 'Diffusers', 'Safetensors', 'Model']),
  license: z.string().max(100).nullable(), gated: z.boolean(),
});
export const huggingFacePage = z.object({
  models: z.array(huggingFaceModel).max(12), nextCursor: z.string().max(2048).nullable(),
});
export type HuggingFaceModel = z.infer<typeof huggingFaceModel>;
