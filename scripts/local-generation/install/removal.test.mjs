// @vitest-environment node
import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync,renameSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {PackageInstaller} from './transaction.mjs';
import {PackageRemoval} from './removal.mjs';
import {sha} from './manifest.mjs';

const contexts=[];
afterEach(()=>{for(const c of contexts.splice(0)){c.installer.close();rmSync(c.root,{recursive:true,force:true});if(c.moved)rmSync(c.moved,{recursive:true,force:true});}});
function make({dependencies={},shared=false,realProcess=false}={}){
  const data=Buffer.from('disposable native removal package'),root=mkdtempSync(path.join(os.tmpdir(),'kavero-removal-'));
  const artifact={id:'fixture',role:'test-fixture',revision:'a'.repeat(40),url:'https://artifacts.example.com/pinned/fixture',hosts:['artifacts.example.com'],bytes:data.length,sha256:sha(data),destination:'weights/model.gguf'};
  const manifest={schema:1,id:'removal-fixture-v1',publicApproved:false,noticesVerified:true,termsDigest:sha('fixture terms'),artifacts:[artifact]};
  const catalog=[manifest,...shared?[{...manifest,id:'other-fixture-v1',termsDigest:sha('other terms')}]:[]];
  let downloads=0;
  const options={root,instanceId:randomUUID(),catalog,purpose:'internal-evaluation',dependencies:{transport:async()=>{downloads++;return {status:200,headers:{etag:'"fixed"'},body:(async function*(){yield data;})(),dispose(){}};},...realProcess?{}:{protect:()=>{},inspectProcess:async pid=>({pid,creation:'1'})}}};
  const installer=new PackageInstaller(options),owner=randomUUID(),op=installer.admit({owner,key:randomUUID(),packageId:manifest.id});
  const remover=new PackageRemoval(installer,{dependencies}),ctx={root,options,installer,remover,owner,op,manifest,artifact,downloads:()=>downloads};contexts.push(ctx);return ctx;
}
const admit=c=>c.remover.admit({owner:c.owner,key:randomUUID(),packageId:c.manifest.id});

describe('Trusted native package removal',()=>{
  it('reclaims real Windows files with actual process identity and ACL, replays and reinstalls',async()=>{
    const c=make({realProcess:true});await c.installer.run(c.owner,c.op.id);
    const verified=c.installer.catalog.get(c.manifest.id),version=`versions/${verified.hash}`;
    c.installer.files.write('generation/history.json',Buffer.from('preserved'));
    c.installer.files.write('model-versions/legacy/keep',Buffer.from('legacy retained'));
    const removal=admit(c),result=await c.remover.run(c.owner,removal.id);
    expect(result).toMatchObject({state:'removed',scope:'managed-delivery',retainedBytes:0});expect(result.reclaimedBytes).toBeGreaterThan(c.artifact.bytes*2);
    expect(c.installer.files.exists(version)).toBe(false);expect(c.installer.files.exists(`cache/${c.artifact.sha256}`)).toBe(false);
    expect(c.installer.files.read('generation/history.json').toString()).toBe('preserved');expect(c.installer.files.exists('model-versions/legacy/keep')).toBe(true);
    expect(await c.remover.run(c.owner,removal.id)).toEqual(result);await expect(c.installer.run(c.owner,c.op.id)).rejects.toThrow('install-removed');
    const fresh=c.installer.admit({owner:c.owner,key:randomUUID(),packageId:c.manifest.id});expect((await c.installer.run(c.owner,fresh.id)).state).toBe('installed');expect(c.downloads()).toBe(2);
    expect(await c.remover.run(c.owner,removal.id)).toEqual(result);expect(await c.installer.verifyVersion(version,verified)).toBe(true);
  },20000);
  it.each(['admitted','installed'])('retains cache needed by another %s package',async state=>{
    const c=make({shared:true});await c.installer.run(c.owner,c.op.id);
    const other=c.installer.admit({owner:randomUUID(),key:randomUUID(),packageId:'other-fixture-v1'});if(state==='installed')await c.installer.run(c.installer.store.db.prepare('SELECT owner FROM installs WHERE id=?').get(other.id).owner,other.id);
    const result=await c.remover.run(c.owner,admit(c).id);expect(result.retainedBytes).toBeGreaterThanOrEqual(c.artifact.bytes);expect(c.installer.files.exists(`cache/${c.artifact.sha256}`)).toBe(true);
    expect(c.installer.status(c.owner,c.op.id).state).toBe('removed');
  });
  it('deletes owned partial/staged bytes while reporting unknown files retained',async()=>{
    const c=make(),files=c.installer.files;
    files.write(`staging/${c.op.id}/weights/model.gguf`,Buffer.from('partial'));
    files.write(`staging/${c.op.id}/unknown.txt`,Buffer.from('retain'));
    files.write(`parts/${c.artifact.sha256}.part`,Buffer.from('partial'));
    files.atomicJSON(`parts/${c.artifact.sha256}.json`,{...c.artifact,etag:'"fixed"'});
    const result=await c.remover.run(c.owner,admit(c).id);expect(result).toMatchObject({state:'removed',retainedFiles:1,retainedBytes:6});
    expect(files.exists(`parts/${c.artifact.sha256}.part`)).toBe(false);expect(files.exists(`staging/${c.op.id}/weights`)).toBe(false);expect(files.exists(`staging/${c.op.id}/unknown.txt`)).toBe(true);
  });
  it('recovers unlink-before-checkpoint after reopening the journal and blocks competing install',async()=>{
    let fail=true;const c=make({dependencies:{afterUnlink(){if(fail){fail=false;throw Error('lost unlink acknowledgement');}}}});await c.installer.run(c.owner,c.op.id);const removal=admit(c);
    await expect(c.remover.run(c.owner,removal.id)).rejects.toThrow('lost unlink acknowledgement');
    expect(()=>c.installer.admit({owner:c.owner,key:randomUUID(),packageId:c.manifest.id})).toThrow('install-removal-pending');
    c.installer.close();c.installer=new PackageInstaller(c.options);c.remover=new PackageRemoval(c.installer);
    expect((await c.remover.run(c.owner,removal.id)).state).toBe('removed');
  });
  it('recovers only a proven dead removal writer and preserves unknown/live writers',async()=>{
    const c=make(),removal=admit(c);await c.remover.claim(c.owner,removal.id);
    await expect(c.installer.store.recover(async()=>undefined)).rejects.toThrow('install-process-inspection-unavailable');
    await expect(c.installer.store.recover(async()=>({pid:process.pid,creation:'1'}))).rejects.toThrow('install-writer-still-alive');
    expect(await c.installer.store.recover(async()=>null)).toBe(true);
    expect(c.remover.status(c.owner,removal.id).state).toBe('interrupted');expect((await c.remover.run(c.owner,removal.id)).state).toBe('removed');
  });
  it('recovers an actual child-process crash between unlink and journal checkpoint',async()=>{
    const c=make({realProcess:true});await c.installer.run(c.owner,c.op.id);const op=admit(c);
    const script=`import {PackageInstaller} from './scripts/local-generation/install/transaction.mjs';
      import {PackageRemoval} from './scripts/local-generation/install/removal.mjs';
      const args=JSON.parse(process.argv[1]);const installer=new PackageInstaller(args.options);
      await new PackageRemoval(installer,{dependencies:{afterUnlink(){process.exit(71);}}}).run(args.owner,args.id);`;
    const result=spawnSync(process.execPath,['--input-type=module','--eval',script,JSON.stringify({options:{root:c.root,instanceId:c.options.instanceId,catalog:c.options.catalog,purpose:'internal-evaluation'},owner:c.owner,id:op.id})],{windowsHide:true,encoding:'utf8',timeout:20000});
    expect(result.status,result.stderr).toBe(71);expect(c.remover.status(c.owner,op.id).state).toBe('removing');
    expect(await c.installer.recover()).toBe(true);expect(c.remover.status(c.owner,op.id).state).toBe('interrupted');
    expect((await c.remover.run(c.owner,op.id)).state).toBe('removed');
    const fresh=c.installer.admit({owner:c.owner,key:randomUUID(),packageId:c.manifest.id});expect((await c.installer.run(c.owner,fresh.id)).state).toBe('installed');
  },30000);
  it('isolates owners and freezes account-only removal when another account references the package',async()=>{
    const c=make(),key=randomUUID(),body={owner:c.owner,key,packageId:c.manifest.id},removal=c.remover.admit(body);
    expect(c.remover.admit(body).id).toBe(removal.id);expect(c.remover.status(randomUUID(),removal.id)).toBeNull();
    await expect(c.remover.run(randomUUID(),removal.id)).rejects.toThrow('removal-not-found');
    expect(()=>c.installer.store.db.prepare('UPDATE removals SET owner=?').run(randomUUID())).toThrow('removal-identity-immutable');
    await c.remover.run(c.owner,removal.id);
    c.installer.admit({owner:c.owner,key:randomUUID(),packageId:c.manifest.id});const other=randomUUID(),otherInstall=c.installer.admit({owner:other,key:randomUUID(),packageId:c.manifest.id});
    const shared=admit(c),result=await c.remover.run(c.owner,shared.id);expect(result).toMatchObject({state:'removed',accountOnly:true,reclaimedBytes:0});
    expect(c.installer.status(other,otherInstall.id).state).toBe('admitted');
    const last=c.remover.admit({owner:other,key:randomUUID(),packageId:c.manifest.id});expect((await c.remover.run(other,last.id)).accountOnly).toBe(false);
    expect((await c.remover.run(c.owner,shared.id)).accountOnly).toBe(true);
  });
  it('refuses removal while an installation writer is held',async()=>{
    const c=make();c.installer.store.claim(c.owner,c.op.id,{pid:process.pid,creation:'1'});expect(()=>admit(c)).toThrow('install-destination-busy');
  });
  it.each(['changed','extra','junction'])('rejects %s package content before deleting any file',async mode=>{
    const c=make();await c.installer.run(c.owner,c.op.id);const version=`versions/${c.installer.catalog.get(c.manifest.id).hash}`,files=c.installer.files;
    if(mode==='changed')files.write(`${version}/weights/model.gguf`,Buffer.from('changed'));
    if(mode==='extra')files.write(`${version}/unknown`,Buffer.from('keep'));
    if(mode==='junction'){const old=files.resolve(`${version}/weights`),dest=path.join(c.root,'external');renameSync(old,dest);symlinkSync(dest,old,'junction');}
    await expect(c.remover.run(c.owner,admit(c).id)).rejects.toThrow();expect(files.exists(`cache/${c.artifact.sha256}`)).toBe(true);
  });
  it('rejects replaced files on retry, even with a persisted deletion plan',async()=>{
    const c=make();await c.installer.run(c.owner,c.op.id);const removal=admit(c);
    await expect(c.remover.run(c.owner,removal.id,{beforeDelete:()=>{throw Error('interrupted');}})).rejects.toThrow('interrupted');
    const plan=JSON.parse(c.remover.row(c.owner,removal.id).plan);c.installer.files.write(plan.files[0].path,Buffer.from('replacement'));
    await expect(c.remover.run(c.owner,removal.id)).rejects.toThrow('removal-file-changed');
  });
  it('rejects path escapes and a replaced root before unlinking',async()=>{
    const c=make();expect(()=>c.installer.files.removeChecked('../outside',{})).toThrow();
    c.installer.close();c.installer.close=()=>{};
    c.moved=c.root+'-moved';renameSync(c.root,c.moved);mkdirSync(c.root);
    await expect(c.remover.run(c.owner,randomUUID())).rejects.toThrow();
    rmSync(c.root,{recursive:true});renameSync(c.moved,c.root);c.moved=null;
  });
});
