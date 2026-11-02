import { lstatSync,realpathSync,openSync,closeSync,fstatSync,readSync,readdirSync,unlinkSync,rmdirSync,statfsSync,mkdirSync,writeSync } from 'node:fs';
import path from 'node:path';
import { validateLocalPNG,LOCAL_IMAGE_MAX_BYTES } from '../../src/modules/model-providers/local/png.ts';
import { FINGERPRINT } from './profile.mjs';
import { validJobHardware } from './hardware.mjs';
import { intentHash } from './ledger.mjs';
import {validateSnapshotIntent} from '../../src/modules/model-providers/local/job-snapshot.ts';

export const OUTPUT_RETENTION_MS=24*60*60*1000;
export const LOG_MAX_BYTES=4*1024*1024;
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const names=new Set(['final.png','prompt.txt','engine.log']);

function safeDirectory(root,id,create=false) {
  if(!uuid(id))throw Error('unsafe-staging-path');
  const base=realpathSync(root);
  let current=base;
  for(const segment of ['jobs',id]) {
    current=path.join(current,segment);
    if(create) { try{mkdirSync(current,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;} }
    const stat=lstatSync(current);
    if(stat.isSymbolicLink() || !stat.isDirectory() || realpathSync(current)!==current)throw Error('unsafe-staging-path');
  }
  return current;
}
export function createJobDirectory(root,id) { return safeDirectory(root,id,true); }
export function availableStagingBytes(root) { const stat=statfsSync(root);return stat.bavail*stat.bsize; }

function readFinal(root,row) {
  const dir=safeDirectory(root,row.id),filename=path.join(dir,'final.png');
  const stat=lstatSync(filename);
  if(stat.isSymbolicLink() || !stat.isFile() || stat.nlink!==1 || stat.size<=0 || stat.size>LOCAL_IMAGE_MAX_BYTES || stat.birthtimeMs<row.created
    || realpathSync(filename)!==filename)throw Error('invalid-local-image');
  const fd=openSync(filename,'r');
  try {
    const before=fstatSync(fd);
    if(before.ino!==stat.ino || before.dev!==stat.dev || before.size!==stat.size)throw Error('staged-output-changed');
    const bytes=Buffer.alloc(stat.size);
    let read=0;
    while(read<bytes.length){const n=readSync(fd,bytes,read,bytes.length-read,read);if(!n)throw Error('staged-output-changed');read+=n;}
    const after=fstatSync(fd),mapped=lstatSync(filename);
    if(after.size!==before.size || after.mtimeMs!==before.mtimeMs || after.ctimeMs!==before.ctimeMs
      || mapped.ino!==before.ino || mapped.dev!==before.dev || mapped.isSymbolicLink())throw Error('staged-output-changed');
    return {bytes,info:validateLocalPNG(bytes)};
  }finally{closeSync(fd);}
}

// Short synchronous validation under SQLite's global write lock serializes it
// with cleanup and publication by another coordinator. No network IO in here.
export function inspectStagedOutput(ledger,root,owner,id,now=Date.now()) {
 realpathSync(root);
 return ledger.atomic(()=>{
  const row=ledger.get(owner,id);
  if(!row)throw Error('output-not-found');
  if(row.output_state==='pending' && row.state==='generated-unvalidated') {
    try {
      const payload=JSON.parse(row.payload);
      if(payload.recipeSnapshot)validateSnapshotIntent(payload.intent,payload.recipeSnapshot,payload.fingerprint);
      if((!payload.recipeSnapshot&&(payload.fingerprint!==FINGERPRINT||payload.intent.profile!=='qwen-image-2.1-q4-evaluation')) || !validJobHardware(payload) || intentHash(payload.intent,payload.recipeSnapshot)!==row.hash
        || payload.intent.count!==1 || payload.intent.width!==512 || payload.intent.height!==512 || !row.finished_at)throw Error('output-identity-changed');
      const {info}=readFinal(root,row),generatedAt=new Date(row.finished_at).toISOString();
      const descriptor={...info,jobId:id,ownerId:owner,ledgerIdentity:ledger.identity,requestHash:row.hash,
        packageFingerprint:payload.fingerprint,deviceId:payload.device,generatedAt,expiresAt:new Date(row.finished_at+OUTPUT_RETENTION_MS).toISOString(),...(payload.recipeSnapshot?{recipeSnapshot:payload.recipeSnapshot}:{})};
      ledger.db.prepare("UPDATE jobs SET output_state='generated',output_descriptor=? WHERE id=? AND output_state='pending'").run(JSON.stringify(descriptor),id);
    } catch {
      ledger.db.prepare("UPDATE jobs SET output_state='invalid' WHERE id=? AND output_state='pending'").run(id);
    }
  }
  const current=ledger.get(owner,id),descriptor=current.output_descriptor?JSON.parse(current.output_descriptor):null;
  const state=current.output_state==='generated' && Date.parse(descriptor.expiresAt)<=now?'expired':current.output_state;
  return {state,descriptor};
 });
}

export function readLeasedOutput(ledger,root,owner,id,token,now=Date.now()) {
 realpathSync(root);
 const result=ledger.atomic(()=>{
  ledger.assertOutputLease(owner,id,token,now);
  const row=ledger.get(owner,id);
  if(!row || row.output_state!=='generated')throw Error('output-not-ready');
  const descriptor=JSON.parse(row.output_descriptor);
  try {
    const result=readFinal(root,row);
    if(result.info.sha256!==descriptor.sha256 || result.info.sizeBytes!==descriptor.sizeBytes)throw Error('staged-output-changed');
    return {...result,descriptor};
  }catch(error){ledger.db.prepare("UPDATE jobs SET output_state='invalid' WHERE id=?").run(id);return {error:Error(error.message==='staged-output-changed'?'staged-output-changed':'invalid-local-image')};}
 });
 // Persist invalidation before throwing; throwing inside atomic would roll it back.
 if(result.error)throw result.error;
 return result;
}

export function cleanupStaging(ledger,root,now=Date.now()) { return ledger.atomic(()=>{
  // A disconnected/missing root is not evidence that its job files are gone.
  realpathSync(root);
  ledger.db.prepare('DELETE FROM output_leases WHERE expires<=?').run(now);
  let cleaned=0;
  const rows=ledger.db.prepare(`SELECT * FROM jobs WHERE reserved_bytes>0 AND state IN ('generated-unvalidated','failed','cancelled')`).all();
  for(const row of rows) {
    const descriptor=row.output_descriptor?JSON.parse(row.output_descriptor):null;
    const expired=descriptor && Date.parse(descriptor.expiresAt)<=now;
    if(row.state==='generated-unvalidated' && row.output_state!=='invalid' && !expired && !row.saved_at && row.output_state!=='expired')continue;
    if(ledger.db.prepare('SELECT token FROM output_leases WHERE job_id=? AND expires>? LIMIT 1').get(row.id,now))continue;
    // Unknown/running work is never eligible. Terminal receipts are published
    // only after the native child has stopped (or explicit OS recovery).
    try {
      let dir;
      try{dir=safeDirectory(root,row.id);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(dir) {
        const files=readdirSync(dir);
        if(files.some(name=>!names.has(name)))throw Error('unmapped-staged-file');
        for(const name of files) {
          const filename=path.join(dir,name),stat=lstatSync(filename);
          if(stat.isSymbolicLink() || !stat.isFile() || realpathSync(filename)!==filename)throw Error('unsafe-staging-path');
        }
        // Exact mapped files only; never recursively delete a computed path.
        for(const name of files)unlinkSync(path.join(dir,name));
        rmdirSync(dir);
      }
      ledger.db.prepare("UPDATE jobs SET reserved_bytes=0,output_state=? WHERE id=?").run(expired||row.saved_at||row.output_state==='expired'?'expired':'invalid',row.id);
      cleaned++;
    }catch{/* Preserve the reservation/tombstone and retry cleanup later. */}
  }
  return cleaned;
}); }

export function createBoundedLog(filename,onLimit) {
  const fd=openSync(filename,'wx',0o600);let bytes=0,closed=false,limited=false;
  return {
    append(chunk) {
      if(closed || limited)return;
      const remaining=LOG_MAX_BYTES-bytes;
      if(remaining) { const part=chunk.subarray(0,remaining);writeSync(fd,part);bytes+=part.length; }
      if(chunk.length>remaining){limited=true;onLimit();}
    },
    get limited(){return limited;},
    close(){if(!closed){closed=true;closeSync(fd);}}
  };
}
