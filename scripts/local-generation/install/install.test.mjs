// @vitest-environment node
import { describe,it,expect,afterEach } from 'vitest';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,readdirSync,symlinkSync } from 'node:fs';
import path from 'node:path';import os from 'node:os';import { randomUUID } from 'node:crypto';
import { zipSync } from 'fflate';
import { PackageInstaller } from './transaction.mjs';
import { validateManifest,sha,relativePath } from './manifest.mjs';
import { publicAddress } from './download.mjs';
import { inspectZIP } from './archive.mjs';
const roots=[],installers=[];
afterEach(()=>{for(const installer of installers.splice(0))installer.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture({archive=false}={}) {
  const body=Buffer.from('pinned fixture bytes'),members={'bin/engine.dll':body};
  const data=archive?Buffer.from(zipSync(members)):body;
  const artifact={id:'fixture',role:'test-fixture',revision:'a'.repeat(40),url:'https://artifacts.example.com/pinned/fixture',hosts:['artifacts.example.com'],bytes:data.length,sha256:sha(data),
    ...(archive?{archive:'zip',entries:[{member:'bin/engine.dll',path:'engine/engine.dll',bytes:body.length,sha256:sha(body)}]}:{destination:'weights/model.gguf'})};
  return {data,body,manifest:{schema:1,id:'test-package-v1',publicApproved:false,noticesVerified:true,termsDigest:sha('fixture terms'),artifacts:[artifact]}};
}
function transport(data,{status=200,headers={},chunks,failAfter}={}) {
  return async(url,request)=>({status,headers:{etag:'"fixed"',...headers},body:(async function*(){let index=0;for(const chunk of chunks??[data]){yield chunk;if(++index===failAfter)throw Error('disconnected');}})(),dispose(){}});
}
function create(f=fixture(),deps={},options={}) {
  const root=mkdtempSync(path.join(os.tmpdir(),'kavero-install-'));roots.push(root);
  const installer=new PackageInstaller({root,instanceId:randomUUID(),catalog:[f.manifest],purpose:'internal-evaluation',dependencies:{protect:()=>{},transport:transport(f.data),inspectProcess:async pid=>({pid,creation:'1'}),...deps},...options});installers.push(installer);
  const owner=randomUUID(),key=randomUUID(),op=installer.admit({owner,key,packageId:f.manifest.id});return {installer,root,owner,key,op,f};
}
describe('Managed package transaction',()=>{
  it('yields buffered downloads to status/cancel handlers while retaining the operation tombstone',async()=>{
    const f=fixture(),data=Buffer.alloc(2*1024**2,1);f.data=data;f.manifest.artifacts[0].bytes=data.length;f.manifest.artifacts[0].sha256=sha(data);
    let ctx,scheduled=false;const chunks=Array.from({length:4096},()=>data.subarray(0,512));
    ctx=create(f,{transport:async()=>({status:200,headers:{etag:'"fixture"'},body:(async function*(){for(const chunk of chunks){if(!scheduled){scheduled=true;setImmediate(()=>ctx.installer.cancel(ctx.owner,ctx.op.id));}yield chunk;}})(),dispose(){}})});
    await expect(ctx.installer.run(ctx.owner,ctx.op.id)).rejects.toThrow('install-cancelled');expect(ctx.installer.status(ctx.owner,ctx.op.id).state).toBe('cancelled');expect((await ctx.installer.run(ctx.owner,ctx.op.id)).state).toBe('cancelled');
  });
  it('recovers a failed notice write under the same operation without redownloading or publishing an incomplete version',async()=>{
    const f=fixture(),bytes=Buffer.from('notice');f.manifest.bundledFiles=[{path:'notices/License.txt',role:'notice',bytes:bytes.length,sha256:sha(bytes),dataBase64:bytes.toString('base64')}];let downloads=0;
    const ctx=create(f,{transport:async(...args)=>{downloads++;return transport(f.data)(...args);}}),write=ctx.installer.files.write.bind(ctx.installer.files);ctx.installer.files.write=(name,...args)=>{if(name.endsWith('/License.txt'))throw Error('disk disconnected');return write(name,...args);};
    await expect(ctx.installer.run(ctx.owner,ctx.op.id)).rejects.toThrow('disk disconnected');expect(ctx.installer.status(ctx.owner,ctx.op.id).state).toBe('failed');expect(readdirSync(path.join(ctx.root,'versions'))).toHaveLength(0);
    ctx.installer.files.write=write;expect((await ctx.installer.run(ctx.owner,ctx.op.id)).id).toBe(ctx.op.id);expect(downloads).toBe(1);
  });
  it('reserves notice and retained archive space before initiating network traffic',async()=>{
    const f=fixture({archive:true}),bytes=Buffer.from('notice');f.manifest.artifacts[0].retainAs='downloads/engine.zip';f.manifest.bundledFiles=[{path:'notices/License.txt',role:'notice',bytes:bytes.length,sha256:sha(bytes),dataBase64:bytes.toString('base64')}];const expected=validateManifest(f.manifest,'internal-evaluation');let free=expected.totalBytes+1024**3-1,downloads=0;
    const ctx=create(f,{freeBytes:()=>free,transport:async(...args)=>{downloads++;return transport(f.data)(...args);}});await expect(ctx.installer.run(ctx.owner,ctx.op.id)).rejects.toThrow('install-disk-full');expect(downloads).toBe(0);free++;expect((await ctx.installer.run(ctx.owner,ctx.op.id)).state).toBe('installed');
  });
  it('installs retained archive and bundled notices under one receipt and includes both in progress/disk accounting',async()=>{
    const f=fixture({archive:true});f.manifest.artifacts[0].retainAs='downloads/engine.zip';const bytes=Buffer.from('Full license notice');f.manifest.bundledFiles=[{path:'notices/License.txt',role:'notice',bytes:bytes.length,sha256:sha(bytes),dataBase64:bytes.toString('base64')}];
    const expected=validateManifest(f.manifest,'internal-evaluation');expect(expected.totalBytes).toBe(f.data.length*2+f.body.length+bytes.length);
    const ctx=create(f);const installed=await ctx.installer.run(ctx.owner,ctx.op.id);expect(installed.processedBytes).toBe(expected.totalBytes);
    const version=path.join(ctx.root,'versions',expected.hash);expect(readFileSync(path.join(version,'downloads/engine.zip'))).toEqual(f.data);expect(readFileSync(path.join(version,'notices/License.txt'))).toEqual(bytes);
    expect((await ctx.installer.run(ctx.owner,ctx.op.id)).id).toBe(installed.id);writeFileSync(path.join(version,'notices/License.txt'),'tampered');await expect(ctx.installer.run(ctx.owner,ctx.op.id)).rejects.toThrow('installed-package-changed');
  });
  it('rejects bundled data corruption, binary content, unsafe paths, executable roles and collisions before installation',()=>{
    const f=fixture();const bytes=Buffer.from('license');const file={path:'notices/License.txt',role:'notice',bytes:bytes.length,sha256:sha(bytes),dataBase64:bytes.toString('base64')};
    for(const change of [{dataBase64:'bad'},{path:'../escape'},{role:'engine'},{path:'weights/model.gguf'},{dataBase64:'AA==',bytes:1,sha256:sha(Buffer.from([0]))}])expect(()=>validateManifest({...f.manifest,bundledFiles:[{...file,...change}]},'internal-evaluation')).toThrow();
    expect(()=>validateManifest({...f.manifest,bundledFiles:Array(65).fill(file)},'internal-evaluation')).toThrow('invalid-bundled-files');
    expect(()=>validateManifest({...f.manifest,artifacts:[{...f.manifest.artifacts[0],retainAs:'downloads/raw'}]},'internal-evaluation')).toThrow('invalid-install-archive');
  });
  it('refuses retained archive output collisions and unsafe paths before any disk changes',()=>{const f=fixture({archive:true});for(const retainAs of ['engine/engine.dll','../engine.zip'])expect(()=>validateManifest({...f.manifest,artifacts:[{...f.manifest.artifacts[0],retainAs}]},'internal-evaluation')).toThrow();});
  it('closes a response when admission is cancelled after receiving headers',async()=>{
    let disposed=false;const f=fixture();let ctx;
    ctx=create(f,{transport:async()=>{ctx.installer.cancel(ctx.owner,ctx.op.id);return {...await transport(f.data)(),dispose(){disposed=true;}};}});
    await expect(ctx.installer.run(ctx.owner,ctx.op.id)).rejects.toThrow('install-cancelled');expect(disposed).toBe(true);
  });
  it('closes a response when writing resume metadata fails and permits repair',async()=>{
    let disposed=false;const f=fixture(),ctx=create(f,{transport:async()=>({...await transport(f.data)(),dispose(){disposed=true;}})});
    const original=ctx.installer.files.atomicJSON.bind(ctx.installer.files);ctx.installer.files.atomicJSON=()=>{throw Error('disk disconnected');};
    await expect(ctx.installer.run(ctx.owner,ctx.op.id)).rejects.toThrow('disk disconnected');expect(disposed).toBe(true);
    ctx.installer.files.atomicJSON=original;expect((await ctx.installer.run(ctx.owner,ctx.op.id)).state).toBe('installed');
  });
  it('rejects mutated installed bytes without overwriting them',async()=>{
    const ctx=create();await ctx.installer.run(ctx.owner,ctx.op.id);const hash=validateManifest(ctx.f.manifest,'internal-evaluation').hash;
    const target=path.join(ctx.root,'versions',hash,'weights/model.gguf');writeFileSync(target,'mutated');
    await expect(ctx.installer.run(ctx.owner,ctx.op.id)).rejects.toThrow('installed-package-changed');expect(readFileSync(target,'utf8')).toBe('mutated');
  });
  it('bounds empty directory trees as well as files',()=>{
    const ctx=create();ctx.installer.files.directory('staging/tree/a');ctx.installer.files.directory('staging/tree/b');
    expect(()=>ctx.installer.files.listTree('staging/tree',1)).toThrow('install-tree-limit');
  });
  it('installs a verified immutable receipt, replays and never invokes inference',async()=>{
    let downloads=0;const f=fixture(),ctx=create(f,{transport:async(...args)=>{downloads++;return transport(f.data)(...args);}});
    const result=await ctx.installer.run(ctx.owner,ctx.op.id);expect(result.state).toBe('installed');
    expect(await ctx.installer.run(ctx.owner,ctx.op.id)).toEqual(result);expect(downloads).toBe(1);
    expect(ctx.installer.admit({owner:ctx.owner,key:ctx.key,packageId:f.manifest.id}).id).toBe(ctx.op.id);
    const hash=validateManifest(f.manifest,'internal-evaluation').hash;expect(readFileSync(path.join(ctx.root,'versions',hash,'weights/model.gguf'))).toEqual(f.data);
    expect(readdirSync(path.join(ctx.root,'versions'))).toHaveLength(1);
  });
  it('rejects public approval before creating any files',()=>{
    const root=path.join(os.tmpdir(),'kavero-rejected-'+randomUUID());
    expect(()=>new PackageInstaller({root,instanceId:randomUUID(),catalog:[fixture().manifest]})).toThrow('package-not-approved');
    expect(()=>readdirSync(root)).toThrow();
  });
  it('isolates owners and freezes submission identity',async()=>{
    const {installer,owner,key,op,f}=create();expect(installer.status(randomUUID(),op.id)).toBeNull();expect(installer.cancel(randomUUID(),op.id)).toBeNull();
    await expect(installer.run(randomUUID(),op.id)).rejects.toThrow('install-not-found');
    installer.catalog.set(f.manifest.id,validateManifest({...f.manifest,termsDigest:sha('different')},'internal-evaluation'));
    expect(()=>installer.admit({owner,key,packageId:f.manifest.id})).toThrow('install-idempotency-conflict');await expect(installer.run(owner,op.id)).rejects.toThrow('install-manifest-changed');
  });
  it('serializes concurrent writers across separate SQLite connections',async()=>{
    let unblock;const hold=new Promise(resolve=>unblock=resolve),f=fixture();
    const {installer,root,owner,op}=create(f,{transport:async(...args)=>{await hold;return transport(f.data)(...args);}});
    const second=new PackageInstaller({root,instanceId:installer.files.instanceId,catalog:[f.manifest],purpose:'internal-evaluation',dependencies:{protect:()=>{},transport:transport(f.data),inspectProcess:async pid=>({pid,creation:'1'})}});installers.push(second);
    const running=installer.run(owner,op.id);await new Promise(r=>setTimeout(r,10));await expect(second.run(owner,op.id)).rejects.toThrow('install-destination-busy');unblock();expect((await running).state).toBe('installed');
  });
  it('reconciles an atomic directory commit whose database acknowledgement was lost',async()=>{
    let fault=true,downloads=0;const f=fixture(),{installer,owner,op,root}=create(f,{transport:async(...args)=>{downloads++;return transport(f.data)(...args);},afterRename:()=>{if(fault){fault=false;throw Error('lost commit ack');}}});
    await expect(installer.run(owner,op.id)).rejects.toThrow('lost commit ack');expect(installer.status(owner,op.id).state).toBe('failed');
    expect((await installer.run(owner,op.id)).state).toBe('installed');expect(downloads).toBe(1);expect(readdirSync(path.join(root,'versions'))).toHaveLength(1);
  });
  it('rejects low destination space before fetching and preserves existing versions',async()=>{
    let calls=0;const f=fixture(),{installer,owner,op,root}=create(f,{freeBytes:()=>1,transport:async()=>{calls++;throw Error('unexpected network');}});
    mkdirSync(path.join(root,'versions','existing'));writeFileSync(path.join(root,'versions','existing','keep'),'user evidence');
    await expect(installer.run(owner,op.id)).rejects.toThrow('install-disk-full');expect(calls).toBe(0);expect(readFileSync(path.join(root,'versions','existing','keep'),'utf8')).toBe('user evidence');
  });
  it('counts both cached/raw package copies in destination disk accounting',async()=>{
    const f=fixture(),{installer,owner,op}=create(f,{freeBytes:()=>1024**3+f.data.length});
    await expect(installer.run(owner,op.id)).rejects.toThrow('install-disk-full');
  });
  it('cancels an active stream and never resumes a cancellation tombstone',async()=>{
    let ctx,downloads=0;const f=fixture();
    ctx=create(f,{transport:async()=>{downloads++;return {status:200,headers:{etag:'"fixed"'},body:(async function*(){yield f.data.subarray(0,4);ctx.installer.cancel(ctx.owner,ctx.op.id);yield f.data.subarray(4);})(),dispose(){}};}});
    await expect(ctx.installer.run(ctx.owner,ctx.op.id)).rejects.toThrow('install-cancelled');expect(ctx.installer.status(ctx.owner,ctx.op.id).state).toBe('cancelled');
    expect((await ctx.installer.run(ctx.owner,ctx.op.id)).state).toBe('cancelled');expect(downloads).toBe(1);expect(readdirSync(path.join(ctx.root,'versions'))).toHaveLength(0);
  });
  it('cancels queued installs without acquiring a writer',async()=>{const {installer,owner,op}=create();expect(installer.cancel(owner,op.id).state).toBe('cancelled');expect((await installer.run(owner,op.id)).state).toBe('cancelled');});
  it('validates strong-etag partial recovery and exact range before appending',async()=>{
    let attempt=0,seen;const f=fixture(),{installer,owner,op}=create(f,{transport:async(url,request)=>{
      if(++attempt===1)return transport(f.data,{chunks:[f.data.subarray(0,5)],failAfter:1})(url,request);
      seen=request.headers;return transport(f.data.subarray(5),{status:206,headers:{'content-range':`bytes 5-${f.data.length-1}/${f.data.length}`,'content-length':String(f.data.length-5)}})(url,request);
    }});
    await expect(installer.run(owner,op.id)).rejects.toThrow('disconnected');expect((await installer.run(owner,op.id)).state).toBe('installed');expect(seen.range).toBe('bytes=5-');expect(seen['if-range']).toBe('"fixed"');
  });
  it('never appends stale or ignored ranges; restarts the owned partial once',async()=>{
    let attempt=0;const f=fixture(),{installer,owner,op}=create(f,{transport:async(url,request)=>{
      attempt++;if(attempt===1)return transport(f.data,{chunks:[f.data.subarray(0,5)],failAfter:1})(url,request);
      if(attempt===2){expect(request.headers.range).toBe('bytes=5-');return transport(f.data)(url,request);}
      expect(request.headers.range).toBeUndefined();return transport(f.data)(url,request);
    }});
    await expect(installer.run(owner,op.id)).rejects.toThrow();expect((await installer.run(owner,op.id)).state).toBe('installed');expect(attempt).toBe(3);
  });
  it.each(['short','oversized','checksum'])('rejects %s download without creating a version',async kind=>{
    const f=fixture(),data=kind==='short'?f.data.subarray(1):kind==='oversized'?Buffer.concat([f.data,Buffer.from('x')]):Buffer.alloc(f.data.length);
    const {installer,owner,op,root}=create(f,{transport:transport(data)});await expect(installer.run(owner,op.id)).rejects.toThrow();expect(readdirSync(path.join(root,'versions'))).toHaveLength(0);
  });
  it('rehashes corrupt cache and refuses changed installed bytes/extra executables',async()=>{
    const f=fixture(),{installer,root,owner,op}=create(f);writeFileSync(path.join(root,'cache',f.manifest.artifacts[0].sha256),'corrupt');await installer.run(owner,op.id);
    const version=path.join(root,'versions',validateManifest(f.manifest,'internal-evaluation').hash);writeFileSync(path.join(version,'extra.exe'),'unlisted');await expect(installer.run(owner,op.id)).rejects.toThrow('installed-package-changed');
  });
  it('extracts only manifest-listed archive members with exact checksums',async()=>{const f=fixture({archive:true}),{installer,owner,op,root}=create(f);expect((await installer.run(owner,op.id)).state).toBe('installed');expect(readFileSync(path.join(root,'versions',validateManifest(f.manifest,'internal-evaluation').hash,'engine/engine.dll'))).toEqual(f.body);});
  it('refuses live/unknown abandoned claims; recovers only two verified absent observations',async()=>{
    const {installer,owner,op}=create();const token=installer.store.claim(owner,op.id,{pid:123,creation:'456'});
    await expect(installer.store.recover(async pid=>({pid,creation:'456'}))).rejects.toThrow('install-writer-still-alive');
    await expect(installer.store.recover(async()=>undefined)).rejects.toThrow('install-process-inspection-unavailable');
    await expect(installer.store.recover(async()=>{throw Error('OS unavailable');})).rejects.toThrow('OS unavailable');
    expect(await installer.store.recover(async()=>null)).toBe(true);expect(installer.status(owner,op.id).state).toBe('interrupted');
    expect(()=>installer.store.assert(owner,op.id,token)).toThrow('install-claim-lost');expect((await installer.run(owner,op.id)).state).toBe('installed');
  });
  it('will not adopt a user-owned nonempty root',()=>{const root=mkdtempSync(path.join(os.tmpdir(),'kavero-existing-'));roots.push(root);writeFileSync(path.join(root,'user-file'),'keep');expect(()=>new PackageInstaller({root,instanceId:randomUUID(),catalog:[]})).toThrow('install-root-not-owned');expect(readFileSync(path.join(root,'user-file'),'utf8')).toBe('keep');});
  it('rejects a staging junction to unrelated files without deleting its target',async()=>{
    const {installer,root,owner,op}=create();const outside=mkdtempSync(path.join(os.tmpdir(),'kavero-outside-'));roots.push(outside);writeFileSync(path.join(outside,'keep'),'keep');
    symlinkSync(outside,path.join(root,'staging',op.id),'junction');await expect(installer.run(owner,op.id)).rejects.toThrow('unsafe-install-link');expect(readFileSync(path.join(outside,'keep'),'utf8')).toBe('keep');
  });
});
describe('Manifest/network/archive security',()=>{
  it.each(['../outside','/absolute','C:/windows','a\\b','a:ads','CON.txt','a/../b','a./b','a//b'])('rejects path %s',value=>expect(()=>relativePath(value)).toThrow());
  it.each(['https://127.0.0.1/file','http://artifacts.example.com/file','https://user:secret@artifacts.example.com/file','https://unapproved.example.com/file'])('rejects source %s',url=>{const f=fixture();f.manifest.artifacts[0].url=url;expect(()=>validateManifest(f.manifest,'internal-evaluation')).toThrow();});
  it('rejects redirects to another origin before a second network call',async()=>{
    let count=0;const {installer,owner,op}=create(fixture(),{transport:async()=>{count++;return {status:302,headers:{location:'https://127.0.0.1/file'},dispose(){}};}});await expect(installer.run(owner,op.id)).rejects.toThrow('install-source-rejected');expect(count).toBe(1);
  });
  it.each(['127.0.0.1','10.1.2.3','172.16.0.1','192.168.1.1','169.254.1.1','100.64.0.1','0.0.0.0','::1','::ffff:127.0.0.1','fe80::1','fc00::1','2001:db8::1'])('rejects private/special address %s',address=>expect(publicAddress(address)).toBe(false));
  it('allows ordinary public addresses',()=>{expect(publicAddress('8.8.8.8')).toBe(true);expect(publicAddress('2606:4700:4700::1111')).toBe(true);});
  it.each(['../escape','C:/escape','safe:ads','CON.txt'])('rejects archive member %s before decompression',name=>{
    const data=Buffer.from(zipSync({[name]:Buffer.from('x')}));expect(()=>inspectZIP(data,[])).toThrow();
  });
  it('rejects unexpected members, case collisions, links and inflated size declarations',()=>{
    const f=fixture({archive:true});expect(()=>inspectZIP(Buffer.from(zipSync({'extra.exe':Buffer.from('x')})),f.manifest.artifacts[0].entries)).toThrow('install-archive-unexpected');
    const entries=[{member:'A',path:'A',bytes:1,sha256:sha('x')},{member:'a',path:'a',bytes:1,sha256:sha('x')}];expect(()=>inspectZIP(Buffer.from(zipSync({A:Buffer.from('x'),a:Buffer.from('x')})),entries)).toThrow('install-archive-collision');
    const link=Buffer.from(f.data),central=link.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));link.writeUInt32LE(0xa1ff0000,central+38);expect(()=>inspectZIP(link,f.manifest.artifacts[0].entries)).toThrow('install-archive-link');
    const bomb=Buffer.from(f.data);bomb.writeUInt32LE(0x7fffffff,central+24);expect(()=>inspectZIP(bomb,f.manifest.artifacts[0].entries)).toThrow('install-archive-unexpected');
  });
});
