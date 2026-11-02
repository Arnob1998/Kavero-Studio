// Private host persistence for metadata imports. Not an installer or API route.
import {DatabaseSync} from 'node:sqlite';
import {constants,closeSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {canonical} from './install/manifest.mjs';
import {normalizeModelLink,discoverModel,discoveryDigest} from './model-discovery.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const checkOwner=owner=>{if(!uuid(owner))throw Error('invalid-model-import-owner');};
export class ModelImportStore{
 constructor(files){
  if(process.versions.node!=='24.11.1')throw Error('install-runtime-not-verified');
  this.files=files;
  for(const filename of ['model-imports.sqlite','model-imports.sqlite-wal','model-imports.sqlite-shm'])files.resolve(filename);
  if(!files.exists('model-imports.sqlite'))closeSync(files.open('model-imports.sqlite',constants.O_CREAT|constants.O_EXCL|constants.O_RDWR));
  this.db=new DatabaseSync(files.resolve('model-imports.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS model_imports(id TEXT PRIMARY KEY,owner TEXT NOT NULL,submission_key TEXT NOT NULL,request_hash TEXT NOT NULL,request_json TEXT NOT NULL,snapshot_json TEXT,snapshot_hash TEXT,created INTEGER NOT NULL,UNIQUE(owner,submission_key));
   CREATE TRIGGER IF NOT EXISTS model_import_identity BEFORE UPDATE ON model_imports WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.submission_key IS NOT NEW.submission_key OR OLD.request_hash IS NOT NEW.request_hash OR OLD.request_json IS NOT NEW.request_json OR OLD.created IS NOT NEW.created OR OLD.snapshot_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'model-import-immutable');END;`);
 }
 view(row){
  if(!row)return null;
  const snapshot=row.snapshot_json?JSON.parse(row.snapshot_json):null;
  if(snapshot&&discoveryDigest(snapshot)!==row.snapshot_hash)throw Error('model-import-integrity-failed');
  return {id:row.id,submissionKey:row.submission_key,createdAt:row.created,state:snapshot?'inspected':'inspecting',request:JSON.parse(row.request_json),snapshot,digest:row.snapshot_hash};
 }
 get(owner,id){checkOwner(owner);if(!uuid(id))throw Error('invalid-model-import-id');this.files.check();return this.view(this.db.prepare('SELECT * FROM model_imports WHERE owner=? AND id=?').get(owner,id));}
 list(owner){checkOwner(owner);this.files.check();return this.db.prepare('SELECT * FROM model_imports WHERE owner=? ORDER BY created DESC,id LIMIT 100').all(owner).map(row=>this.view(row));}
 byKey(owner,key,input){
  checkOwner(owner);if(!uuid(key))throw Error('invalid-model-import-key');this.files.check();
  const row=this.db.prepare('SELECT * FROM model_imports WHERE owner=? AND submission_key=?').get(owner,key);
  if(row&&row.request_hash!==discoveryDigest(normalizeModelLink(input)))throw Error('model-import-idempotency-conflict');
  return this.view(row);
 }
 reserve(owner,key,input){
  checkOwner(owner);if(!uuid(key))throw Error('invalid-model-import-key');this.files.check();
  const request=normalizeModelLink(input),encoded=canonical(request),requestHash=discoveryDigest(request);
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const existing=this.db.prepare('SELECT * FROM model_imports WHERE owner=? AND submission_key=?').get(owner,key);
   if(existing){if(existing.request_hash!==requestHash)throw Error('model-import-idempotency-conflict');this.db.exec('COMMIT');return this.view(existing);}
   if(this.db.prepare('SELECT count(*) n FROM model_imports WHERE owner=?').get(owner).n>=100||this.db.prepare('SELECT count(*) n FROM model_imports').get().n>=1000)throw Error('model-import-limit');
   const id=randomUUID();this.db.prepare('INSERT INTO model_imports(id,owner,submission_key,request_hash,request_json,created) VALUES(?,?,?,?,?,?)').run(id,owner,key,requestHash,encoded,Date.now());
   const result=this.get(owner,id);this.db.exec('COMMIT');return result;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 finish(owner,id,snapshot){
  const row=this.get(owner,id);if(!row)throw Error('model-import-not-found');if(row.snapshot)return row;
  // The caller is the host discovery service. Never accept a browser-provided
  // snapshot as proof. These invariants also prevent accidental runtime grants.
  if(snapshot?.schemaVersion!==1||snapshot.installable!==false||snapshot.ready!==false||canonical(snapshot.source)!==canonical(row.request.source)||snapshot.requestedRevision!==row.request.requestedRevision)throw Error('invalid-model-import-snapshot');
  const encoded=canonical(snapshot);if(Buffer.byteLength(encoded)>2*1024**2)throw Error('model-import-snapshot-too-large');
  this.db.prepare('UPDATE model_imports SET snapshot_json=?,snapshot_hash=? WHERE owner=? AND id=? AND snapshot_json IS NULL').run(encoded,discoveryDigest(snapshot),owner,id);
  return this.get(owner,id);
 }
 close(){this.db.close();}
}

export class ModelImportService{
 constructor(store,{discover=discoverModel,now=Date.now}={}){this.store=store;this.discover=discover;this.now=now;this.inflight=new Map();this.windows=new Map();}
 async import(owner,key,input){return this.begin(owner,key,input).pending;}
 begin(owner,key,input){
  checkOwner(owner);
  // Capture validated primitives before deferring discovery; callers may reuse
  // or mutate their request object while the inspection is pending.
  normalizeModelLink(input);input={...input};
  // Check admission before reserving to avoid filling persistence with pending
  // work when this host is saturated. Completed key replay is handled first.
  const previous=this.store.byKey(owner,key,input);if(previous?.snapshot)return {row:previous,pending:Promise.resolve(previous)};
  const token=owner+':'+key;
  if(this.inflight.has(token)){
   const row=this.store.reserve(owner,key,input);return {row,pending:this.inflight.get(token)};
  }
  const window=this.windows.get(owner),time=this.now();
  const current=window&&time-window.started<60000?window:{started:time,count:0};
  if(current.count>=6||this.inflight.size>=2)throw Error('model-discovery-busy');
  if(this.windows.size>=256&&!this.windows.has(owner)){
   for(const [id,entry]of this.windows)if(time-entry.started>=60000)this.windows.delete(id);
   if(this.windows.size>=256)throw Error('model-discovery-busy');
  }
  const row=this.store.reserve(owner,key,input);if(row.snapshot)return {row,pending:Promise.resolve(row)};
  current.count++;this.windows.set(owner,current);
  // Deferring the call also ensures synchronous resolver failures cannot leave
  // a rejected promise stranded in the in-flight map.
  const pending=Promise.resolve().then(()=>this.discover(input))
   .then(snapshot=>this.store.finish(owner,row.id,snapshot)).finally(()=>this.inflight.delete(token));
  this.inflight.set(token,pending);return {row,pending};
 }
}
