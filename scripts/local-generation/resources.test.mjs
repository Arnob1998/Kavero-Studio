// @vitest-environment node
import { describe,it,expect,vi,beforeEach,afterEach } from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
const values=vi.hoisted(()=>({freeGpu:7956,freeRam:12*1024**3,nativeCode:1}));
vi.mock('node:child_process',()=>({execFile:(file,args,options,callback)=>file.endsWith('sd-cli.exe')?callback(Object.assign(Error('probe exit'),{code:values.nativeCode,stdout:'',stderr:'ggml_vulkan: Found 1 Vulkan devices:\nggml_vulkan: 0 = NVIDIA GeForce RTX 4060 Laptop GPU (NVIDIA) | uma: 0 | fp16: 1 | bf16: 1\ncannot inspect model source'})):callback(null,{stdout:file==='nvidia-smi'?`GPU-e8ae63fd-5ffc-236b-7293-d32ad39dff47, 591.74, NVIDIA GeForce RTX 4060 Laptop GPU, 8188, ${values.freeGpu}`:'Intel(R) UHD Graphics|NVIDIA GeForce RTX 4060 Laptop GPU'})}));
vi.mock('node:fs/promises',()=>({statfs:async()=>({bavail:100000,bsize:65536})}));
vi.mock('node:os',()=>({default:{tmpdir:()=>process.env.TEMP,freemem:()=>values.freeRam,totalmem:()=>32*1024**3}}));
import { inspectHost } from './profile.mjs';
const original=Object.getOwnPropertyDescriptor(process,'platform');
beforeEach(()=>{Object.defineProperty(process,'platform',{value:'win32',configurable:true});values.freeGpu=7956;values.freeRam=12*1024**3;values.nativeCode=1;});
afterEach(()=>Object.defineProperty(process,'platform',original));
describe('Resource-pressure checks (simulated hardware readings)',()=>{
 it('blocks dispatch with low GPU memory then permits unchanged-profile recovery',async()=>{values.freeGpu=1000;await expect(inspectHost('.')).rejects.toThrow('device-or-staging-busy');values.freeGpu=7956;await expect(inspectHost('.')).resolves.toMatchObject({deviceId:'GPU-e8ae63fd-5ffc-236b-7293-d32ad39dff47'});});
 it('keeps identity/reconnect available while device memory is busy',async()=>{values.freeGpu=1000;await expect(inspectHost('.',false)).resolves.toMatchObject({freeVramMiB:1000});});
 it('blocks dispatch when system memory is insufficient',async()=>{values.freeRam=2*1024**3;await expect(inspectHost('.')).rejects.toThrow('device-or-staging-busy');});
});

it('reads the native enumeration on stderr and rejects an unexpected native exit',async()=>{const root=mkdtempSync(path.join(os.tmpdir(),'kavero-probe-test-'));try{mkdirSync(path.join(root,'engine'));writeFileSync(path.join(root,'engine/sd-cli.exe'),'fixture');expect(await inspectHost(root,false,root)).toMatchObject({backendIndex:0});values.nativeCode=2;await expect(inspectHost(root,false,root)).rejects.toThrow('backend-mapping-unknown');}finally{rmSync(root,{recursive:true,force:true});}});

