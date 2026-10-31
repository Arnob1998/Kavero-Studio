// @vitest-environment node
import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {qwenResearchDelivery} from './qwen-delivery.mjs';
import {validateManifest,sha} from './manifest.mjs';
describe('Pinned research delivery recipe',()=>{
  it('contains every original inference file, full terms and immutable metadata without changing the worker recipe',()=>{
    const manifest=qwenResearchDelivery(),verified=validateManifest(manifest,'internal-evaluation');
    const pinned=JSON.parse(readFileSync(new URL('../profile.json',import.meta.url)));
    for(const file of pinned.files)expect(verified.files).toContainEqual(file);
    expect(manifest.artifacts.map(a=>a.role)).toEqual(['engine','image-weights','text-encoder','vae']);
    const metadata=manifest.bundledFiles.find(f=>f.role==='recipe-metadata');expect(sha(Buffer.from(metadata.dataBase64,'base64'))).toBe('a1a8dca181f17f960657f6d606510287ea8199368c9c1294ae4f2cebf5862c9f');
    expect(manifest.bundledFiles.some(f=>f.path==='notices/Notice.txt')).toBe(true);expect(verified.files).toHaveLength(55);
    expect(verified.totalBytes).toBe(19935070277);expect(()=>validateManifest(manifest)).toThrow('package-not-approved');
  });
  it('returns independent manifests and binds bundled notice changes to installation identity',()=>{const first=qwenResearchDelivery(),second=qwenResearchDelivery();first.bundledFiles.pop();expect(second.bundledFiles).toHaveLength(30);expect(validateManifest(first,'internal-evaluation').hash).not.toBe(validateManifest(second,'internal-evaluation').hash);});
});
