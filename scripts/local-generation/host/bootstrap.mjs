import { evaluationEnabled,modelSelectionMode } from './selection.mjs';
import { readFileSync,lstatSync,existsSync,constants,copyFileSync } from 'node:fs';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes,randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { InstallFiles } from '../install/filesystem.mjs';
import { downloadArtifact } from '../install/download.mjs';
import { sha,validateManifest } from '../install/manifest.mjs';
import { acquireHostMutex } from './mutex.mjs';
import { HOST_RUNTIME } from './runtime.mjs';
import { hostControl } from './control.mjs';
import { packageWorker } from './bundle.mjs';
// No SQLite import here: bootstrap tooling need not be the worker Node version.
const directory=path.dirname(fileURLToPath(import.meta.url));
export function hostRoot(cwd=process.cwd(),env=process.env) {
  if(!env.LOCALAPPDATA||!path.isAbsolute(env.LOCALAPPDATA))throw Error('host-private-directory-unavailable');
  return path.join(env.LOCALAPPDATA,'Kavero','hosts',sha(path.resolve(cwd).toLowerCase()).slice(0,24));
}
function existingInstance(root) {
  let ancestor=path.resolve(root);while(true){if(existsSync(ancestor)&&lstatSync(ancestor).isSymbolicLink())throw Error('unsafe-install-link');const next=path.dirname(ancestor);if(next===ancestor)break;ancestor=next;}
  const marker=path.join(root,'.instance.json');if(!existsSync(marker))return randomUUID();
  const info=lstatSync(marker);if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>1024)throw Error('host-instance-invalid');
  const record=JSON.parse(readFileSync(marker,'utf8'));if(record.schema!==1)throw Error('host-instance-invalid');return record.instanceId;
}
export async function inspectHostProcess(pid) {
  if(!Number.isInteger(pid)||pid<1)throw Error('host-process-invalid');
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,@{Name='Creation';Expression={$_.CreationDate.ToUniversalTime().Ticks.ToString()}} | ConvertTo-Json -Compress`],{windowsHide:true,timeout:10000,maxBuffer:4096});
  if(!stdout.trim())return null;const data=JSON.parse(stdout);if(data.ProcessId!==pid||!/^\d+$/.test(data.Creation))throw Error('host-process-inspection-unavailable');return {pid,creation:data.Creation};
}
export function initializeHost(root,{protect}={}) {
  const files=new InstallFiles(root,existingInstance(root),{protect});
  if(!files.exists('bootstrap-config.json')) {
    if(['host-identity.json','install.sqlite','agent.sqlite','agent-config.json','agent-process.json'].some(name=>files.exists(name)))throw Error('host-config-missing');
    files.write('bootstrap-config.json',Buffer.from(JSON.stringify({schema:1,root:files.root,instanceId:files.instanceId,secret:randomBytes(32).toString('hex'),runtimeKey:randomUUID(),port:8792})),true);
  }
  const config=JSON.parse(files.read('bootstrap-config.json',4096));
  if(config.schema!==1||config.root!==files.root||config.instanceId!==files.instanceId||config.port!==8792||!/^[a-f0-9]{64}$/.test(config.secret)||!/^[a-f0-9-]{36}$/.test(config.runtimeKey))throw Error('host-config-invalid');
  const identity={instanceId:config.instanceId,runtimeKey:config.runtimeKey,secretDigest:sha(config.secret)};
  if(files.exists('host-identity.json')){if(JSON.stringify(JSON.parse(files.read('host-identity.json',2048)))!==JSON.stringify(identity))throw Error('host-config-identity-changed');}
  else files.write('host-identity.json',Buffer.from(JSON.stringify(identity)),true);
  return {files,config};
}
async function ensureRuntime(files,config,lock,{transport,runFile=promisify(execFile)}={}) {
  const verified=validateManifest(HOST_RUNTIME),executable=HOST_RUNTIME.artifacts[0];
  const installed=`versions/${verified.hash}/runtime/node.exe`;
  if(!await files.matches(installed,executable)) {
    if(files.exists(installed))throw Error('host-runtime-changed');
    if(files.freeBytes()<verified.totalBytes+executable.bytes+1024**3)throw Error('install-disk-full');
    const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),2*60*60*1000);
    try {
      // The exact Node executable is the only pre-SQLite seed. Verify and ship
      // its full license before executing it; all final publication uses B.
      await downloadArtifact(files,HOST_RUNTIME.artifacts[1],{transport,signal:controller.signal,check:()=>lock.assert()});
      const cache=await downloadArtifact(files,executable,{transport,signal:controller.signal,check:()=>lock.assert()});
      files.directory('bootstrap');const seed=`bootstrap/${executable.sha256}.exe`;
      if(!await files.matches(seed,executable)){if(files.exists(seed))files.remove(seed);copyFileSync(files.resolve(cache),files.resolve(seed),constants.COPYFILE_EXCL);}
      if(!await files.matches(seed,executable))throw Error('host-runtime-changed');lock.assert();
      await runFile(files.resolve(seed),[path.join(directory,'install-runtime.mjs'),files.resolve('bootstrap-config.json')],{windowsHide:true,timeout:2*60*60*1000,maxBuffer:4096});
      files.remove(seed); // Mapped bootstrap copy only; installed version survives.
    }finally{clearTimeout(deadline);controller.abort();}
  }
  // Final receipt/files are reverified even when the executable already exists.
  await runFile(files.resolve(installed),[path.join(directory,'install-runtime.mjs'),files.resolve('bootstrap-config.json')],{windowsHide:true,timeout:2*60*60*1000,maxBuffer:4096});
  lock.assert();return {file:files.resolve(installed),fingerprint:verified.hash};
}
async function ownedStatus(files,config,expected,request=hostControl) {
  const status=await request(config,'/host/status');
  if(status.code!==expected.code)throw Error('host-code-update-required: Stop Kavero with the original launcher after local jobs and model inspections finish, then run pnpm setup:run again. Installed models and history are retained.');
  if(status.runtime!==expected.runtime||status.node!=='24.11.1'||typeof status.inferenceReady!=='boolean'||status.evaluationEnabled!==expected.evaluationEnabled||status.selectionMode!==expected.selectionMode||!['awaiting-package','recovering','recovery-required','evaluation-disabled','maintenance','activating','ready'].includes(status.state))throw Error('host-identity-changed');
  const record=JSON.parse(files.read('agent-process.json',2048));
  const identity=await inspectHostProcess(status.pid);
  if(!identity||record.pid!==status.pid||record.creation!==identity.creation||(record.epoch!==null&&record.epoch!==status.epoch))throw Error('host-process-changed');
  if(record.epoch===null)files.atomicJSON('agent-process.json',{...identity,epoch:status.epoch});
  return status;
}
export async function prepareManagedHost({cwd=process.cwd(),root=hostRoot(cwd),dependencies={},userSelectedModels=false}={}) {
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('host-platform-unsupported');
  const lock=await (dependencies.acquireMutex??acquireHostMutex)(root);
  try {
    const {files,config}=initializeHost(root,{protect:dependencies.protect});
    const runtime=await ensureRuntime(files,config,lock,dependencies);
    const bundle=packageWorker(files),code=bundle.fingerprint;
    const policy={userSelectedModels,internalEvaluation:dependencies.internalEvaluation===true};
    const expected={code,runtime:runtime.fingerprint,evaluationEnabled:evaluationEnabled(policy),selectionMode:modelSelectionMode(policy)};
    let status;
    try {status=await ownedStatus(files,config,expected);}
    catch(error) {
      // A responsive unknown port, bad signature or identity drift is not ours
      // to replace. Only confirmed refusal allows attempting a new listener.
      if(error.cause?.code!=='ECONNREFUSED')throw error;
      const active={...config,...expected,...policy,database:files.resolve('agent.sqlite')};
      for(const suffix of ['','-wal','-shm'])files.resolve('agent.sqlite'+suffix);
      files.atomicJSON('agent-config.json',active);lock.assert();
      const child=(dependencies.spawnImpl??spawn)(runtime.file,[bundle.entry,files.resolve('agent-config.json')],{detached:true,windowsHide:true,stdio:'ignore'});child.unref();
      let spawnError=null;child.once('error',error=>{spawnError=error;});
      const identity=await inspectHostProcess(child.pid);if(!identity)throw Error('host-start-failed');
      files.atomicJSON('agent-process.json',{...identity,epoch:null});
      for(let attempt=0;attempt<30;attempt++) {
        lock.assert();if(spawnError||child.exitCode!==null)throw Error('host-start-failed');
        try {status=await hostControl(config,'/host/status');break;}catch(error){if(error.cause?.code!=='ECONNREFUSED')throw error;}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!status||status.pid!==identity.pid||status.code!==code||status.runtime!==runtime.fingerprint)throw Error('host-start-failed');
      files.atomicJSON('agent-process.json',{...identity,epoch:status.epoch});
      status=await ownedStatus(files,config,expected);
    }
    // Keep secrets in this private overlay, never env files, browser or argv.
    files.atomicJSON('compose-host.json',{services:{app:{environment:{...(userSelectedModels?{KAVERO_LOCAL_GENERATION_ENABLED:'1'}:dependencies.internalEvaluation===true?{}:{KAVERO_LOCAL_GENERATION_ENABLED:'0'}),KAVERO_LOCAL_HOST_URL:'http://host.docker.internal:8792',KAVERO_LOCAL_HOST_SECRET:config.secret,KAVERO_LOCAL_BRIDGE_URL:'http://host.docker.internal:8791',KAVERO_LOCAL_BRIDGE_SECRET:config.secret}}}});
    return {overlay:files.resolve('compose-host.json'),status,async close(){try{const current=await ownedStatus(files,config,expected);await hostControl(config,'/host/shutdown',{epoch:current.epoch});let gone=false;for(let attempt=0;attempt<50;attempt++){const identity=await inspectHostProcess(current.pid);if(!identity||identity.creation!==JSON.parse(files.read('agent-process.json',2048)).creation){gone=true;break;}await new Promise(resolve=>setTimeout(resolve,100));}if(!gone)throw Error('host-shutdown-unconfirmed');}finally{await lock.release();}},assert:()=>lock.assert()};
  }catch(error){await lock.release();throw error;}
}
