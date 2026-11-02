// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {inspectGGUF} from './gguf.mjs';
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
const u64=n=>{const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt(n));return b;};
const str=s=>Buffer.concat([u64(Buffer.byteLength(s)),Buffer.from(s)]);
const header=(count=1,entries=0)=>Buffer.concat([Buffer.from('GGUF'),u32(3),u64(count),u64(entries)]);
const tensor=(name='weight',dims=[8,8])=>Buffer.concat([str(name),u32(dims.length),...dims.map(u64),u32(1),u64(0)]);
function inspect(bytes){const dir=mkdtempSync(path.join(os.tmpdir(),'kavero-gguf-'));try{const file=path.join(dir,'model.gguf');writeFileSync(file,bytes);return inspectGGUF(file);}finally{rmSync(dir,{recursive:true,force:true});}}
it('reads bounded architecture and fingerprints tensor layout independently of order',()=>{
 const meta=Buffer.concat([str('general.architecture'),u32(8),str('qwen_image')]);
 const a=inspect(Buffer.concat([header(2,1),meta,tensor('a'),tensor('b'),Buffer.alloc(64)]));
 const b=inspect(Buffer.concat([header(2,1),meta,tensor('b'),tensor('a'),Buffer.alloc(64)]));
 expect(a.architecture).toBe('qwen_image');expect(a.tensorCount).toBe(2);expect(a.tensorLayoutSha256).toBe(b.tensorLayoutSha256);
});
it('rejects truncation, oversized counts and unsafe 64-bit lengths',()=>{
 for(const bytes of [Buffer.from('GG'),header(8193),Buffer.concat([header(),u64(2n**63n)]),Buffer.concat([header(),str('x'),u32(4)])])expect(()=>inspect(bytes)).toThrow();
});
it('rejects duplicate tensor/metadata names and invalid dimensions',()=>{
 const meta=Buffer.concat([str('same'),u32(8),str('x')]);
 for(const bytes of [Buffer.concat([header(2),tensor(),tensor()]),Buffer.concat([header(1,2),meta,meta,tensor()]),Buffer.concat([header(),tensor('bad',[0])])])expect(()=>inspect(bytes)).toThrow('invalid-gguf');
});
it('rejects recursive metadata arrays before exhausting the header budget',()=>{
 const nested=Buffer.concat([u32(9),u64(1),u32(9),u64(1),u32(9),u64(1),u32(9),u64(1),u32(8),u64(1),str('x')]);
 expect(()=>inspect(Buffer.concat([header(1,1),str('array'),u32(9),nested,tensor()]))).toThrow('gguf-header-limit');
});
