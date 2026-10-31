// @vitest-environment node
import { describe,it,expect,afterEach } from 'vitest';
import { mkdtempSync,rmSync,writeFileSync,readFileSync } from 'node:fs';
import { randomUUID,createHmac } from 'node:crypto';
import { EventEmitter } from 'node:events';
import path from 'node:path';import os from 'node:os';
import { initializeHost,hostRoot } from './bootstrap.mjs';
import { hostControl,signControl } from './control.mjs';
import { acquireHostMutex } from './mutex.mjs';
import { sha } from '../install/manifest.mjs';
const roots=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function root(){const value=mkdtempSync(path.join(os.tmpdir(),'kavero-host-'));roots.push(value);return value;}
describe('Host bootstrap private identity',()=>{
  it('reuses instance, runtime submission and secret across restart',()=>{
    const location=root(),first=initializeHost(location,{protect:()=>{}}),second=initializeHost(location,{protect:()=>{}});
    expect(second.config).toEqual(first.config);expect(second.config.secret).toHaveLength(64);
  });
  it('refuses corrupt config without rotating the durable secret',()=>{
    const location=root(),first=initializeHost(location,{protect:()=>{}});first.files.write('bootstrap-config.json',Buffer.from('{broken'));
    expect(()=>initializeHost(location,{protect:()=>{}})).toThrow();expect(readFileSync(path.join(location,'bootstrap-config.json'),'utf8')).toBe('{broken');
  });
  it('never adopts user-owned files',()=>{
    const location=root();writeFileSync(path.join(location,'user-model'),'keep');expect(()=>initializeHost(location,{protect:()=>{}})).toThrow('install-root-not-owned');expect(readFileSync(path.join(location,'user-model'),'utf8')).toBe('keep');
  });
  it('never recreates a lost config over durable host identity',()=>{
    const location=root(),first=initializeHost(location,{protect:()=>{}});first.files.remove('bootstrap-config.json');
    expect(()=>initializeHost(location,{protect:()=>{}})).toThrow('host-config-missing');
  });
  it('rejects a syntactically valid changed secret or runtime submission key',()=>{
    const location=root(),first=initializeHost(location,{protect:()=>{}});first.files.write('bootstrap-config.json',Buffer.from(JSON.stringify({...first.config,secret:'f'.repeat(64),runtimeKey:randomUUID()})));
    expect(()=>initializeHost(location,{protect:()=>{}})).toThrow('host-config-identity-changed');
  });
  it('derives an instance-specific private root rather than the repository proof folder',()=>{
    const env={LOCALAPPDATA:os.tmpdir()};expect(hostRoot('C:/repo',env)).not.toBe(hostRoot('C:/other',env));expect(hostRoot('C:/repo',env).startsWith(os.tmpdir())).toBe(true);
    expect(()=>hostRoot('C:/repo',{})).toThrow('host-private-directory-unavailable');
  });
});
describe('Host signed control',()=>{
  const config={secret:'a'.repeat(64),instanceId:randomUUID(),port:8792};
  function responder(body,change={}) {return async(url,request)=>{const encoded=JSON.stringify(body);return new Response(encoded,{headers:{'x-kavero-response':createHmac('sha256',config.secret).update(request.headers['x-kavero-nonce']+'\n'+sha(encoded)).digest('hex'),...change}});};}
  it('binds status to the exact request nonce and private instance',async()=>{const body={instanceId:config.instanceId,state:'awaiting-package'};expect(await hostControl(config,'/host/status',{},responder(body))).toEqual(body);});
  it('refuses forged/unsigned status instead of treating an occupied port as owned',async()=>{await expect(hostControl(config,'/host/status',{},async()=>new Response('{}'))).rejects.toThrow('host-response-invalid');});
  it('rejects a valid signature from the wrong instance',async()=>{await expect(hostControl(config,'/host/status',{},responder({instanceId:randomUUID()}))).rejects.toThrow('host-instance-changed');});
  it('bounds even an authenticated response',async()=>{await expect(hostControl(config,'/host/status',{},responder({instanceId:config.instanceId,data:'x'.repeat(8192)}))).rejects.toThrow('host-response-invalid');});
  it('creates fresh nonces for retries',()=>{expect(signControl(config.secret,'/host/status','{}')['x-kavero-nonce']).not.toBe(signControl(config.secret,'/host/status','{}')['x-kavero-nonce']);});
});
describe('Host kernel writer ownership',()=>{
  it('excludes concurrent launchers and allows a new launcher after release',async()=>{
    const location=root(),first=await acquireHostMutex(location);try {await expect(acquireHostMutex(location)).rejects.toThrow('host-already-running');first.assert();}finally{await first.release();}
    const second=await acquireHostMutex(location);await second.release();
  },20000);
  it('fences work when its owned lock helper exits',async()=>{
    let child;const spawnImpl=()=>{child=new EventEmitter();child.exitCode=null;child.signalCode=null;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin={end(){child.exitCode=0;child.emit('exit',0);}};setImmediate(()=>child.stdout.emit('data',Buffer.from('READY\n')));return child;};
    const lock=await acquireHostMutex(root(),{spawnImpl});child.exitCode=1;child.emit('exit',1);expect(()=>lock.assert()).toThrow('host-lock-lost');await lock.release();
  });
});
