import { createHash,randomUUID } from 'node:crypto';
import { createReadStream,readFileSync,realpathSync,statSync } from 'node:fs';
import { statfs } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { assertLocalResources } from '../../src/modules/model-providers/local/failure.ts';
import { assessHardware,mapVulkan,BASELINE_DEVICE,BASELINE_DRIVER } from './hardware.mjs';
const exec = promisify(execFile);
export const DEVICE=BASELINE_DEVICE; // Historical receipts/tests, never runtime selection.
export const DRIVER=BASELINE_DRIVER;
export const FINGERPRINT='d9cd1dc7cc93a20c2ffc8cc780393a04cfc6043a5560ddf12f2924c3ea575f07';
const ENGINE='3f8527a46c54ecf4cb4ed6003da8e8982283c73c';
const snapshots=new Map();
export function resolvePackageFile(root,relative) {
  if(path.isAbsolute(relative))throw Error('unsafe-package-path');
  const actual=realpathSync(path.resolve(root,relative)),base=realpathSync(root);
  if(!actual.startsWith(base+path.sep) || !statSync(actual).isFile())throw Error('unsafe-package-path');
  return actual;
}
export async function verifyPackage(root) {
  const manifest=JSON.parse(readFileSync(path.join(root,'evidence/package-manifest.json'),'utf8'));
  if(manifest.fingerprint!==FINGERPRINT || manifest.engine_commit!==ENGINE || manifest.backend!=='diffusion=vulkan1,clip=cpu,vae=vulkan1')throw Error('package-identity-changed');
  // Do not trust a rewritten manifest to authorize changed executables.
  // Manifest digest serialization belongs to LG-1; pinned component hashes below
  // must be supplied through the committed profile rather than mutable metadata.
  const pinned=JSON.parse(readFileSync(new URL('./profile.json',import.meta.url),'utf8'));
  if(JSON.stringify(manifest.files)!==JSON.stringify(pinned.files))throw Error('package-manifest-changed');
  for(const component of pinned.files){
    const filename=resolvePackageFile(root,component.path);
    if(statSync(filename).size!==component.bytes)throw Error('package-component-changed');
    const hash=createHash('sha256');for await(const chunk of createReadStream(filename))hash.update(chunk);
    if(hash.digest('hex')!==component.sha256)throw Error('package-component-changed');
  }
  snapshots.set(realpathSync(root),pinned.files.map(component=>{
    const filename=resolvePackageFile(root,component.path),stat=statSync(filename);
    return {path:component.path,filename,size:stat.size,mtime:stat.mtimeMs,ctime:stat.ctimeMs};
  }));
  return FINGERPRINT;
}
export function assertVerifiedPackageUnchanged(root) {
  const files=snapshots.get(realpathSync(root));
  if(!files)throw Error('package-not-verified');
  for(const file of files){
    const filename=resolvePackageFile(root,file.path),stat=statSync(filename);
    if(filename!==file.filename||stat.size!==file.size||stat.mtimeMs!==file.mtime||stat.ctimeMs!==file.ctime)throw Error('package-readiness-stale');
  }
}
export async function inspectHost(root, requireResources=true,packageRoot=null) {
  if(process.platform!=='win32'||process.arch!=='x64')throw Object.assign(Error('host-not-verified'),{compatibility:'windows-only'});
  const {stdout}=await exec('nvidia-smi',['--query-gpu=uuid,driver_version,name,memory.total,memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000,maxBuffer:4096});
  const devices=stdout.trim().split(/\r?\n/).map(line=>{const [deviceId,driver,name,total,free,...extra]=line.split(',').map(v=>v.trim());if(extra.length)throw Error('backend-mapping-unknown');return {deviceId,driver,name,totalVramMiB:Number(total),freeVramMiB:Number(free)};});
  const controllers=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',"(Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name) -join '|'"],{windowsHide:true,timeout:10000,maxBuffer:4096});
  let hardware=assessHardware({platform:process.platform,arch:process.arch,devices,totalRamBytes:os.totalmem(),controllers:controllers.stdout.trim().split('|')});
  if(packageRoot){
    // This deliberately nonexistent input enumerates the verified native backend
    // without loading weights or generating an image. Never parse a user's logs.
    let output;try{await exec(resolvePackageFile(packageRoot,'engine/sd-cli.exe'),['--diffusion-model',path.join(root,'kavero-probe-nonexistent-'+randomUUID()+'.gguf')],{windowsHide:true,timeout:10000,maxBuffer:65536});throw Error('backend-mapping-unknown');}
    catch(error){output=String(error.stdout)+String(error.stderr);if(error.code!==1||error.killed||!output.includes('cannot inspect model source'))throw Error('backend-mapping-unknown');}
    hardware=mapVulkan(hardware,output);
  }
  const disk=await statfs(root);
  if(requireResources)assertLocalResources({freeVramMiB:hardware.freeVramMiB,freeRamBytes:os.freemem(),freeDiskBytes:disk.bavail*disk.bsize});
  return {...hardware,freeRamBytes:os.freemem()};
}
export function engineCommand(root,jobDir,backendIndex=1) {
  if(!Number.isInteger(backendIndex)||backendIndex<0||backendIndex>=16)throw Error('backend-mapping-unknown');
  return {file:resolvePackageFile(root,'engine/sd-cli.exe'),args:[
    '--diffusion-model',resolvePackageFile(root,'downloads/qwen_image_2.1_Q4_K_M.gguf'),
    '--llm',resolvePackageFile(root,'downloads/Qwen3VL-8B-Instruct-Q4_K_M.gguf'),
    '--vae',resolvePackageFile(root,'downloads/qwen_image_2.1_vae_bf16.safetensors'),
    '--backend',`diffusion=vulkan${backendIndex},clip=cpu,vae=vulkan${backendIndex}`,'--offload-to-cpu','--max-vram','6','--fa','--vae-tiling',
    '--prompt-file',path.join(jobDir,'prompt.txt'),'-W','512','-H','512','--steps','20','--cfg-scale','6','--sampling-method','euler','-s','42','-o',path.join(jobDir,'final.png')]};
}

