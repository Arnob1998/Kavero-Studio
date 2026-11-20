import { z } from 'zod';
import catalog from './popular-image-models.json';

// Discovery references only. This editable catalog cannot authorize installation.
export const popularCatalogSchema = z.object({
  schemaVersion: z.literal(1), reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  families: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/), name: z.string().min(1).max(100),
    publisher: z.string().regex(/^[\w-]{1,100}$/),
    logo: z.string().regex(/^\/models\/catalog\/[a-z0-9-]+\.(webp|png|jpg|svg)$/),
    description: z.string().max(250),
    repositories: z.array(z.object({ id: z.string().regex(/^[\w-]+\/[\w.-]+$/).max(180), label: z.string().max(100), kind: z.enum(['official', 'community']) }).strict()).min(1).max(10),
  }).strict()).min(1).max(24),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.families.map(family => family.id)).size !== value.families.length)
    ctx.addIssue({ code: 'custom', message: 'Duplicate family identity.' });
  for (const family of value.families) {
    if (new Set(family.repositories.map(repo => repo.id)).size !== family.repositories.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate repository identity.' });
    if (family.repositories.some(repo => repo.kind === 'official' && repo.id.split('/')[0].toLowerCase() !== family.publisher.toLowerCase()))
      ctx.addIssue({ code: 'custom', message: 'Official repository publisher mismatch.' });
  }
});
export const popularImageModels = popularCatalogSchema.parse(catalog);
export type PopularImageFamily = typeof popularImageModels.families[number];
export function localPublisherLogo(publisher: string) {
  return popularImageModels.families.find(family => family.publisher.toLowerCase() === publisher.toLowerCase())?.logo;
}
