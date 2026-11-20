// @vitest-environment node
import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { popularImageModels, popularCatalogSchema, localPublisherLogo } from './popular-image-models';
import attribution from '../../../../public/models/catalog/attribution.json';

it('rejects executable policy, unsafe logo paths and misleading official publisher identities', () => {
  const source = popularImageModels.families[0];
  for (const change of [{ logo: 'https://example.com/logo.svg' }, { logo: '/models/catalog/../../bad.svg' }, { command: 'execute' }, { repositories: [{ id: 'someone/model', label: 'Model', kind: 'official' }] }])
    expect(popularCatalogSchema.safeParse({ ...popularImageModels, families: [{ ...source, ...change }] }).success).toBe(false);
  expect(popularCatalogSchema.safeParse({ ...popularImageModels, families: [source, source] }).success).toBe(false);
});
it('bundles the exact upstream logo bytes with provenance for each default publisher', () => {
  for (const family of popularImageModels.families) {
    const asset = attribution.assets.find(asset => asset.path === family.logo);
    expect(asset?.publisher).toBe(family.publisher);
    const bytes = readFileSync(path.join(process.cwd(), 'public', family.logo));
    expect(bytes.length).toBe(asset!.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(asset!.sha256);
    expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
    expect(bytes.subarray(8, 12).toString()).toBe('WEBP');
  }
  expect(localPublisherLogo('qwen')).toBe('/models/catalog/qwen.webp');
  expect(localPublisherLogo('unknown-publisher')).toBeUndefined();
});
