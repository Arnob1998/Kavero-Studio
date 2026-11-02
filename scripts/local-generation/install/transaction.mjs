import { createReadStream,constants,writeSync,fsyncSync,closeSync } from 'node:fs';
import { InstallFiles } from './filesystem.mjs';
import { InstallStore,processIdentity } from './store.mjs';
import { validateManifest,canonical } from './manifest.mjs';
import { downloadArtifact } from './download.mjs';
import { extractZIP } from './archive.mjs';
const HEADROOM=1024**3; // Preserve output staging and journal headroom on this volume.
const safeErrors=new Set(['install-cancelled','install-disk-full','install-download-size','install-download-checksum','install-extracted-checksum','install-download-rejected','install-redirect-rejected','install-source-rejected','unsafe-install-link','install-archive-invalid','install-archive-unexpected','install-archive-missing','install-archive-collision','install-archive-link','install-claim-lost']);
export class PackageInstaller {
  constructor({root,instanceId,catalog,purpose='public',dependencies={}}) {
    // catalog/dependencies are host-owned code/configuration, never wire input.
    this.catalog=new Map();this.dependencies=dependencies;
    if((catalog??[]).length>32)throw Error('install-catalog-limit');
    for(const manifest of catalog??[]) {const verified=validateManifest(manifest,purpose);if(this.catalog.has(manifest.id))throw Error('duplicate-install-package');this.catalog.set(manifest.id,verified);}
    this.files=new InstallFiles(root,instanceId,{protect:dependencies.protect});
    this.store=new InstallStore(this.files);
  }
  admit({owner,key,packageId}) {const verified=this.catalog.get(packageId);if(!verified)throw Error('install-package-unavailable');return publicInstall(this.store.admit(owner,key,verified));}
  status(owner,id) {const row=this.store.get(owner,id);return row?publicInstall(row):null;}
  cancel(owner,id) {const row=this.store.cancel(owner,id);return row?publicInstall(row):null;}
  recover() {return this.store.recover(this.dependencies.inspectProcess??processIdentity);}
  async run(owner,id) {
    const row=this.store.get(owner,id);if(!row)throw Error('install-not-found');
    const verified=this.catalog.get(row.package_id);if(!verified||verified.hash!==row.manifest)throw Error('install-manifest-changed');
    if(row.state==='cancelled')return publicInstall(row);
    const version=`versions/${verified.hash}`,stage=`staging/${row.id}`;
    if(row.state==='installed') {if(!await this.verifyVersion(version,verified))throw Error('installed-package-changed');return publicInstall(row);}
    const identity=await (this.dependencies.inspectProcess??processIdentity)(process.pid);
    const token=this.store.claim(owner,id,identity);if(!token)return publicInstall(this.store.get(owner,id));
    let progress=0;const check=()=>this.store.assert(owner,id,token),controller=new AbortController();
    const timer=setInterval(()=>{try{check();}catch{controller.abort();}},500);
    const deadline=setTimeout(()=>controller.abort(),2*60*60*1000);
    try {
      check();
      if(await this.verifyVersion(version,verified)) {check();return publicInstall(this.store.commit(owner,id,token,verified.totalBytes));}
      if(this.files.exists(version))throw Error('installed-package-changed');
      let remaining=0;
      for(const artifact of verified.manifest.artifacts) {
        check();const cached=await this.files.matches(`cache/${artifact.sha256}`,artifact);
        let partBytes=0;
        try {const meta=JSON.parse(this.files.read(`parts/${artifact.sha256}.json`,2048));if(meta.sha256===artifact.sha256&&meta.url===artifact.url&&meta.bytes===artifact.bytes&&/^"[^"\r\n]{1,200}"$/.test(meta.etag)&&this.files.exists(`parts/${artifact.sha256}.part`))partBytes=Math.min(artifact.bytes,this.files.size(`parts/${artifact.sha256}.part`));}catch{}
        remaining+=cached?0:artifact.bytes-partBytes;
      }
      for(const file of verified.files) {check();if(!await this.files.matches(`${stage}/${file.path}`,file))remaining+=file.bytes;}
      // Raw files are copied from cache into immutable packages; both copies are
      // included. Existing rollback versions already reduce real free space.
      const free=(this.dependencies.freeBytes??(()=>this.files.freeBytes()))();
      if(!Number.isFinite(free)||free<remaining+HEADROOM)throw Error('install-disk-full');
      this.files.directory(stage);this.store.checkpoint(owner,id,token,'downloading',progress);
      for(const artifact of verified.manifest.artifacts) {
        check();const before=progress;let lastCheckpoint=0;
        const cache=await downloadArtifact(this.files,artifact,{transport:this.dependencies.transport,signal:controller.signal,check,onProgress:received=>{
          progress=before+received;
          if(Date.now()-lastCheckpoint>=250){this.store.checkpoint(owner,id,token,'downloading',progress);lastCheckpoint=Date.now();}
        }});
        progress=before+artifact.bytes;check();this.store.checkpoint(owner,id,token,'verifying',progress);
        if(artifact.archive){await extractZIP(this.files,cache,artifact,stage,{check});if(artifact.retainAs)await this.copy(cache,`${stage}/${artifact.retainAs}`,artifact,check);}
        else await this.copy(cache,`${stage}/${artifact.destination}`,artifact,check);
        progress+=artifact.archive?artifact.entries.reduce((n,f)=>n+f.bytes,0)+(artifact.retainAs?artifact.bytes:0):artifact.bytes;
      }
      for(const file of verified.manifest.bundledFiles??[]){
        check();const target=`${stage}/${file.path}`;
        if(!await this.files.matches(target,file)){
          if(this.files.exists(target))this.files.remove(target);
          this.files.write(target,Buffer.from(file.dataBase64,'base64'),true);
          const fd=this.files.open(target,constants.O_RDWR);try{fsyncSync(fd);}finally{closeSync(fd);}
        }
        progress+=file.bytes;this.store.checkpoint(owner,id,token,'verifying',progress);
      }
      check();for(const file of verified.files)if(!await this.files.matches(`${stage}/${file.path}`,file))throw Error('install-extracted-checksum');
      // Only interrupted, owned receipt temporaries may be removed. Unknown
      // staged files are not an excuse to recursively delete a directory.
      for(const filename of this.files.listTree(stage)) {
        if(/^\.receipt\.json\.[a-f0-9-]{36}\.tmp$/.test(filename))this.files.remove(`${stage}/${filename}`);
        else if(filename!=='.receipt.json'&&!verified.files.some(file=>file.path===filename))throw Error('installed-package-changed');
      }
      const receipt={schema:1,manifest:verified.hash,packageId:verified.manifest.id,files:verified.files};
      this.files.atomicJSON(`${stage}/.receipt.json`,receipt);check();this.store.checkpoint(owner,id,token,'staged',progress);
      // Atomic rename creates a new immutable version; never changes active
      // worker configuration or removes/replaces a referenced package.
      this.files.rename(stage,version);this.files.syncParent(version);
      await this.dependencies.afterRename?.(); // Failure-injection hook for trusted host tests.
      check();if(!await this.verifyVersion(version,verified))throw Error('installed-package-changed');
      return publicInstall(this.store.commit(owner,id,token,progress));
    }catch(error) {
      const current=this.store.get(owner,id),cancelled=current?.cancel===1;
      this.store.checkpoint(owner,id,token,cancelled?'cancelled':'failed',progress,cancelled?null:safeErrors.has(error.message)?error.message:'install-failed');
      throw error;
    }finally{clearInterval(timer);clearTimeout(deadline);controller.abort();this.store.release(id,token);}
  }
  async verifyVersion(version,verified) {
    if(!this.files.exists(`${version}/.receipt.json`))return false;
    const receipt=JSON.parse(this.files.read(`${version}/.receipt.json`,128*1024));
    if(canonical(receipt)!==canonical({schema:1,manifest:verified.hash,packageId:verified.manifest.id,files:verified.files}))throw Error('installed-package-changed');
    const actual=this.files.listTree(version);
    if(actual.length!==verified.files.length+1||actual.some(name=>name!=='.receipt.json'&&!verified.files.some(file=>file.path===name)))throw Error('installed-package-changed');
    for(const file of verified.files)if(!await this.files.matches(`${version}/${file.path}`,file))throw Error('installed-package-changed');return true;
  }
  async copy(source,target,expected,check) {
    if(await this.files.matches(target,expected))return;
    if(this.files.exists(target))this.files.remove(target);
    const parent=target.slice(0,target.lastIndexOf('/'));this.files.directory(parent);
    const input=this.files.open(source,constants.O_RDONLY);let output;
    try {output=this.files.open(target,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL);let lastYield=Date.now();for await(const chunk of createReadStream('',{fd:input,autoClose:false,highWaterMark:1024*1024})){check();let offset=0;while(offset<chunk.length)offset+=writeSync(output,chunk,offset,chunk.length-offset);if(Date.now()-lastYield>=25){await new Promise(resolve=>setImmediate(resolve));lastYield=Date.now();}}fsyncSync(output);}
    finally {closeSync(input);if(output!==undefined)closeSync(output);}
  }
  close(){this.store.close();}
}
export function publicInstall(row) {return {id:row.id,packageId:row.package_id,state:row.state,processedBytes:row.progress,error:row.error,createdAt:new Date(row.created).toISOString()};}
