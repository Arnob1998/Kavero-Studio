import { createHash } from 'node:crypto';
export const BASELINE_DEVICE='GPU-e8ae63fd-5ffc-236b-7293-d32ad39dff47';
export const BASELINE_DRIVER='591.74';
export const isDeviceId=value=>typeof value==='string'&&/^GPU-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function assessHardware({platform,arch,devices,totalRamBytes,controllers}) {
  if(platform!=='win32'||arch!=='x64')throw Object.assign(Error('host-not-verified'),{compatibility:'windows-only'});
  if(!Array.isArray(devices)||devices.length!==1)throw Object.assign(Error('backend-mapping-unknown'),{compatibility:devices?.length>1?'multiple-gpus':'gpu-unverified'});
  const [device]=devices;
  if(!isDeviceId(device.deviceId)||!/^\d{3}\.\d{2}$/.test(device.driver)||!/^NVIDIA GeForce RTX (?:30|40)\d{2}(?: Ti)?(?: SUPER)?(?: Laptop GPU)?$/.test(device.name)
    ||![device.totalVramMiB,device.freeVramMiB,totalRamBytes].every(v=>Number.isFinite(v)&&v>=0)||device.freeVramMiB>device.totalVramMiB
    ||!Array.isArray(controllers)||controllers.filter(name=>name===device.name).length!==1)throw Object.assign(Error('backend-mapping-unknown'),{compatibility:'gpu-unverified'});
  if(device.totalVramMiB<8000)throw Object.assign(Error('host-not-verified'),{compatibility:'gpu-too-small'});
  // Nominal 16 GB systems can expose slightly less RAM to the OS.
  if(totalRamBytes<15*1024**3)throw Object.assign(Error('host-not-verified'),{compatibility:'ram-too-small'});
  const identity={deviceId:device.deviceId,driver:device.driver,name:device.name,totalVramMiB:device.totalVramMiB,controllers:[...controllers].sort()};
  return {...device,totalRamBytes,identity,confidence:device.deviceId===BASELINE_DEVICE&&device.driver===BASELINE_DRIVER?'measured':'unbenchmarked'};
}
export function mapVulkan(hardware,output) {
  const found=/ggml_vulkan: Found (\d+) Vulkan devices:/.exec(output);
  const entries=[...output.matchAll(/ggml_vulkan: (\d+) = (.+?) \| uma: (\d) \| fp16: (\d) \| bf16: (\d)/g)];
  if(!found||Number(found[1])!==entries.length||entries.length>16||entries.map(entry=>Number(entry[1])).sort((a,b)=>a-b).some((value,index)=>value!==index))throw Error('backend-mapping-unknown');
  const selected=entries.filter(e=>e[2]===hardware.name+' (NVIDIA)');
  if(selected.length!==1||selected[0][3]!=='0'||selected[0][4]!=='1'||selected[0][5]!=='1')throw Error('backend-mapping-unknown');
  const backendIndex=Number(selected[0][1]);
  if(!Number.isInteger(backendIndex)||backendIndex<0||backendIndex>=16)throw Error('backend-mapping-unknown');
  const binding=createHash('sha256').update(JSON.stringify({...hardware.identity,backendIndex,inventory:entries.map(e=>e.slice(1))})).digest('hex');
  return {...hardware,backendIndex,binding};
}
export function assertHardwareBinding(payload,hardware) {
  if(payload.hardwareBinding===undefined&&payload.backendIndex===undefined&&payload.device===BASELINE_DEVICE&&hardware.deviceId===BASELINE_DEVICE&&hardware.driver===BASELINE_DRIVER&&hardware.backendIndex===1)return;
  if(payload.device!==hardware.deviceId||payload.hardwareBinding!==hardware.binding||payload.backendIndex!==hardware.backendIndex)throw Error('device-identity-changed');
}
export function validJobHardware(payload){return payload.hardwareBinding===undefined&&payload.backendIndex===undefined?payload.device===BASELINE_DEVICE:isDeviceId(payload.device)&&typeof payload.hardwareBinding==='string'&&/^[a-f0-9]{64}$/.test(payload.hardwareBinding)&&Number.isInteger(payload.backendIndex)&&payload.backendIndex>=0&&payload.backendIndex<16;}
