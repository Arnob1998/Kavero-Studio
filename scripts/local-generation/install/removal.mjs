import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical,validateManifest } from './manifest.mjs';
import { processIdentity } from './store.mjs';

const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const terminal=new Set(['removed','cancelled']);

/** Trusted native API only. Catalog/root come from the host, never a request. */
export class PackageRemoval {
  constructor(installer,{catalog,purpose='internal-evaluation',dependencies={}}={}) {
    this.installer=installer;this.files=installer.files;this.store=installer.store;this.dependencies=dependencies;
    this.catalog=new Map((catalog??[...installer.catalog.values()].map(v=>v.manifest)).map(m=>{const v=validateManifest(m,purpose);return [v.hash,v];}));
    if(this.catalog.size>32)throw Error('removal-catalog-limit');
  }
  verified(packageId) {
    const v=[...this.catalog.values()].find(v=>v.manifest.id===packageId);if(!v)throw Error('removal-package-unavailable');return v;
  }
  row(owner,id) {this.files.check();return this.store.db.prepare('SELECT * FROM removals WHERE owner=? AND id=?').get(owner,id)??null;}
  status(owner,id) {
    const row=this.row(owner,id);if(!row)return null;const plan=row.plan?JSON.parse(row.plan):null;
    return {id:row.id,packageId:row.package_id,manifest:row.manifest,state:row.state,reclaimedBytes:row.deleted_bytes,
      retainedBytes:plan?.retained.reduce((n,f)=>n+f.bytes,0)??0,retainedFiles:plan?.retained.length??0,accountOnly:plan?.accountOnly===true,error:row.error,scope:'managed-delivery'};
  }
  assertOwnership(owner,verified) {
    const rows=this.store.db.prepare('SELECT * FROM installs WHERE manifest=? AND state!=?').all(verified.hash,'removed');
    if(!rows.some(row=>row.owner===owner&&row.package_id===verified.manifest.id))throw Error('removal-not-owned');
    return rows.filter(row=>row.owner===owner);
  }
  admit({owner,key,packageId}) {
    if(!uuid(owner)||!uuid(key))throw Error('invalid-removal');const verified=this.verified(packageId);
    return this.store.transaction(()=>{
      const old=this.store.db.prepare('SELECT * FROM removals WHERE owner=? AND submission_key=?').get(owner,key);
      if(old){if(old.manifest!==verified.hash||old.package_id!==packageId)throw Error('removal-idempotency-conflict');return this.status(owner,old.id);}
      this.store.assertNoRemoval();
      if(this.store.db.prepare('SELECT * FROM writer WHERE slot=1').get())throw Error('install-destination-busy');
      this.assertOwnership(owner,verified);
      if(this.store.db.prepare('SELECT count(*) n FROM removals').get().n>=128)throw Error('removal-journal-full');
      const id=randomUUID(),now=Date.now();
      this.store.db.prepare("INSERT INTO removals(id,owner,submission_key,package_id,manifest,state,created,updated) VALUES(?,?,?,?,?,'admitted',?,?)").run(id,owner,key,packageId,verified.hash,now,now);
      return this.status(owner,id);
    });
  }
  async claim(owner,id) {
    const identity=await (this.dependencies.inspectProcess??this.installer.dependencies.inspectProcess??processIdentity)(process.pid);
    if(!identity||identity.pid!==process.pid||!/^\d+$/.test(identity.creation))throw Error('install-process-inspection-unavailable');
    return this.store.transaction(()=>{
      const row=this.row(owner,id);if(!row)throw Error('removal-not-found');if(terminal.has(row.state))return null;
      if(this.store.db.prepare('SELECT * FROM writer WHERE slot=1').get())throw Error('install-destination-busy');
      const token=randomUUID();this.store.db.prepare('INSERT INTO writer VALUES(1,?,?,?,?)').run(id,token,identity.pid,identity.creation);return token;
    });
  }
  assert(owner,id,token) {
    this.files.check();const row=this.row(owner,id),writer=this.store.db.prepare('SELECT * FROM writer WHERE slot=1').get();
    if(!row||writer?.operation!==id||writer.token!==token)throw Error('install-claim-lost');return row;
  }
  async plan(owner,verified,check,{verifyBytes=true}={}) {
    const target=this.assertOwnership(owner,verified),all=this.store.db.prepare("SELECT * FROM installs WHERE state!='removed'").all();
    const accountOnly=all.some(row=>row.manifest===verified.hash&&row.owner!==owner);
    if(accountOnly)verifyBytes=false;
    const keep=new Set();
    for(const row of all){check();const v=this.catalog.get(row.manifest);if(!v||v.manifest.id!==row.package_id)throw Error('removal-dependency-unknown');
      if(row.manifest!==verified.hash)for(const a of v.manifest.artifacts)keep.add(a.sha256);}
    const files=[],retained=[],directories=new Set(),seen=new Set();
    const add=(relative)=>{check();if(seen.has(relative))return;seen.add(relative);const identity=this.files.describe(relative);if(!identity)return;
      files.push({path:relative,...identity});if(files.length>4096)throw Error('removal-plan-limit');};
    const retain=relative=>{const identity=this.files.describe(relative);if(identity)retained.push({path:relative,bytes:identity.bytes});};
    const receipt={schema:1,manifest:verified.hash,packageId:verified.manifest.id,files:verified.files};
    const collectDirectories=(relative,base)=>{let current=path.posix.dirname(relative);while(current===base||current.startsWith(base+'/')){directories.add(current);if(current===base)break;current=path.posix.dirname(current);}directories.add(base);};
    const version=`versions/${verified.hash}`;
    if(this.files.exists(version)) {
      const actual=this.files.listTree(version);
      if(!this.files.exists(`${version}/.receipt.json`)||canonical(JSON.parse(this.files.read(`${version}/.receipt.json`,128*1024)))!==canonical(receipt)
        ||actual.length!==verified.files.length+1||actual.some(n=>n!=='.receipt.json'&&!verified.files.some(f=>f.path===n)))throw Error('removal-package-changed');
      for(const file of verified.files){check();if(verifyBytes&&!await this.files.matches(`${version}/${file.path}`,file))throw Error('removal-package-changed');check();add(`${version}/${file.path}`);collectDirectories(`${version}/${file.path}`,version);}
      add(`${version}/.receipt.json`);directories.add(version);
    }
    for(const row of target){check();const stage=`staging/${row.id}`;if(!this.files.exists(stage))continue;directories.add(stage);
      for(const name of this.files.listTree(stage)) {
        const relative=`${stage}/${name}`;
        if(verified.files.some(file=>file.path===name)){add(relative);collectDirectories(relative,stage);}
        else if(name==='.receipt.json'||/^\.receipt\.json\.[a-f0-9-]{36}\.tmp$/.test(name)){
          let valid=false;try{valid=canonical(JSON.parse(this.files.read(relative,128*1024)))===canonical(receipt);}catch{}
          if(valid)add(relative);else retain(relative);
        }else retain(relative);
      }
    }
    for(const artifact of verified.manifest.artifacts){check();const cache=`cache/${artifact.sha256}`,meta=`parts/${artifact.sha256}.json`,part=`parts/${artifact.sha256}.part`;
      if(keep.has(artifact.sha256)){for(const relative of [cache,meta,part])retain(relative);continue;}
      if(this.files.exists(cache)){if(verifyBytes&&!await this.files.matches(cache,artifact))throw Error('removal-cache-changed');check();add(cache);}
      let owned=false;try{const data=JSON.parse(this.files.read(meta,2048));owned=data.sha256===artifact.sha256&&data.url===artifact.url&&data.bytes===artifact.bytes&&(data.etag===null||/^"[^"\r\n]{1,200}"$/.test(data.etag));}catch{}
      if(owned){if(this.files.exists(part)&&this.files.size(part)>artifact.bytes)throw Error('removal-part-changed');add(part);add(meta);}
      else {retain(part);retain(meta);}
    }
    // Ownership references are account-scoped. A frozen shared plan never
    // becomes a physical deletion plan on replay, even if other owners leave.
    return {schema:1,instanceId:this.files.instanceId,rootDevice:this.files.device,rootInode:this.files.inode,manifest:verified.hash,installIds:target.map(row=>row.id),accountOnly,
      files:accountOnly?[]:files,retained:accountOnly?[...retained,...files.map(({path,bytes})=>({path,bytes}))]:retained,directories:accountOnly?[]:[...directories].sort((a,b)=>b.length-a.length)};
  }
  async run(owner,id,{beforeDelete=async()=>{},afterDelete=async()=>{}}={}) {
    const original=this.row(owner,id);if(!original)throw Error('removal-not-found');if(terminal.has(original.state))return this.status(owner,id);
    const verified=this.verified(original.package_id);if(verified.hash!==original.manifest)throw Error('removal-manifest-changed');
    const token=await this.claim(owner,id);if(!token)return this.status(owner,id);
    const check=()=>this.assert(owner,id,token);
    try {
      let row=check(),plan=row.plan?JSON.parse(row.plan):await this.plan(owner,verified,check);check();
      if(plan.instanceId!==this.files.instanceId||plan.rootDevice!==this.files.device||plan.rootInode!==this.files.inode||plan.manifest!==verified.hash)throw Error('removal-manifest-changed');
      this.store.db.prepare("UPDATE removals SET plan=?,state='removing',error=NULL,updated=? WHERE id=?").run(canonical(plan),Date.now(),id);
      // Native coordinator holds its own maintenance barrier before any unlink.
      await beforeDelete(plan);check();
      let completed=JSON.parse(row.completed),bytes=row.deleted_bytes;
      for(const file of plan.files){check();if(completed.includes(file.path)){if(this.files.exists(file.path))throw Error('removal-file-reappeared');continue;}
        // Missing after a crash between unlink and checkpoint is recovered under
        // the frozen plan, without accepting a newly replaced file.
        this.files.removeChecked(file.path,file);await this.dependencies.afterUnlink?.(file.path);check();
        completed.push(file.path);bytes+=file.bytes;
        this.store.db.prepare('UPDATE removals SET completed=?,deleted_bytes=?,updated=? WHERE id=?').run(JSON.stringify(completed),bytes,Date.now(),id);
        await new Promise(resolve=>setImmediate(resolve));
      }
      for(const directory of plan.directories){check();this.files.removeEmptyDirectory(directory);}
      await afterDelete(plan);check();
      this.store.transaction(()=>{check();
        for(const install of plan.installIds)this.store.db.prepare("UPDATE installs SET state='removed',error=NULL,updated=? WHERE id=? AND owner=? AND manifest=?").run(Date.now(),install,owner,verified.hash);
        this.store.db.prepare("UPDATE removals SET state='removed',error=NULL,updated=? WHERE id=?").run(Date.now(),id);
      });
      return this.status(owner,id);
    }catch(error){
      check();this.store.db.prepare("UPDATE removals SET state='failed',error=?,updated=? WHERE id=?").run(['removal-package-changed','removal-cache-changed','removal-file-changed','removal-file-reappeared','unsafe-install-link','worker-jobs-outstanding','worker-maintenance-conflict'].includes(error.message)?error.message:'removal-needs-recovery',Date.now(),id);throw error;
    }finally{this.store.release(id,token);}
  }
}
