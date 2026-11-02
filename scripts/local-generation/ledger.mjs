import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateLocalFailure } from '../../src/modules/model-providers/local/failure.ts';
import {jobRequestHash,validateSnapshotIntent,canonicalSnapshot} from '../../src/modules/model-providers/local/job-snapshot.ts';

export const outstanding = ['queued','dispatching','running','cancel-requested','submission-unknown'];
export const STAGING_RESERVATION = 64 * 1024 * 1024;
export const STAGING_CAPACITY = 1024 * 1024 * 1024;
export const OUTPUT_LEASE_MS = 60000;
export const intentHash = jobRequestHash;
export function validateIntent(intent) {
  if (!intent || Object.keys(intent).sort().join(',') !== 'count,height,profile,prompt,width'
    || !['qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation'].includes(intent.profile) || typeof intent.prompt !== 'string'
    || !intent.prompt.trim() || intent.prompt.length > 1000 || intent.width !== 512 || intent.height !== 512 || intent.count !== 1) throw Error('unsupported-intent');
}
export class Ledger {
  constructor(filename) {
    mkdirSync(path.dirname(filename), { recursive:true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,claim TEXT,epoch TEXT,pid INTEGER,heartbeat INTEGER,exit_code INTEGER,UNIQUE(owner,key));
      CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS identity(id TEXT PRIMARY KEY)');
    this.identity=this.atomic(()=>{
      const found=this.db.prepare('SELECT id FROM identity LIMIT 1').get();if(found)return found.id;
      const id=randomUUID();this.db.prepare('INSERT INTO identity VALUES(?)').run(id);return id;
    });
    this.atomic(()=>{
      const columns = this.db.prepare('PRAGMA table_info(jobs)').all().map(column=>column.name);
      for(const [name,type] of Object.entries({process_creation_identity:'TEXT',finished_at:'INTEGER',
        reserved_bytes:`INTEGER NOT NULL DEFAULT ${STAGING_RESERVATION}`,
        output_state:"TEXT NOT NULL DEFAULT 'pending'",output_descriptor:'TEXT',saved_at:'INTEGER',failure_receipt:'TEXT'})) {
        if(!columns.includes(name)) this.db.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
      }
      this.db.exec(`CREATE TABLE IF NOT EXISTS output_leases(token TEXT PRIMARY KEY,job_id TEXT NOT NULL,owner TEXT NOT NULL,expires INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS output_leases_job ON output_leases(job_id,expires);`);
      this.db.exec('CREATE TABLE IF NOT EXISTS lifecycle(slot INTEGER PRIMARY KEY CHECK(slot=1),token TEXT NOT NULL,purpose TEXT NOT NULL)');
      this.db.exec(`CREATE TRIGGER IF NOT EXISTS immutable_versioned_job BEFORE UPDATE ON jobs WHEN
       (json_extract(OLD.payload,'$.recipeSnapshot') IS NOT NULL OR json_extract(NEW.payload,'$.recipeSnapshot') IS NOT NULL)
       AND (OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.key IS NOT NEW.key OR OLD.hash IS NOT NEW.hash OR OLD.payload IS NOT NEW.payload OR OLD.created IS NOT NEW.created)
       BEGIN SELECT RAISE(ABORT,'immutable-job-identity'); END;`);
      this.db.exec(`UPDATE jobs SET finished_at=coalesce(heartbeat,created) WHERE finished_at IS NULL AND state IN ('generated-unvalidated','failed','cancelled')`);
    });
  }
  atomic(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const result=fn();this.db.exec('COMMIT');return result; } catch(error){this.db.exec('ROLLBACK');throw error;} }
  nonce(nonce, now) { return this.atomic(()=>{this.db.prepare('DELETE FROM nonces WHERE expires < ?').run(now);this.db.prepare('INSERT INTO nonces VALUES(?,?)').run(nonce,now+120000);}); }
  get(owner,id) { return this.db.prepare('SELECT * FROM jobs WHERE owner=? AND id=?').get(owner,id); }
  reservedBytes() { return this.db.prepare('SELECT coalesce(sum(reserved_bytes),0) n FROM jobs').get().n; }
  submit(payload,availableBytes=Infinity) {
    validateIntent(payload.intent);
    if(payload.intent.profile==='qwen-image-2.1-q3-evaluation'&&!payload.recipeSnapshot)throw Error('job-recipe-required');
    if(payload.recipeSnapshot)validateSnapshotIntent(payload.intent,payload.recipeSnapshot,payload.fingerprint);
    if (intentHash(payload.intent,payload.recipeSnapshot)!==payload.hash) throw Error('intent-hash-mismatch');
    return this.atomic(()=>{
      const found=this.db.prepare('SELECT * FROM jobs WHERE owner=? AND key=?').get(payload.owner,payload.key);
      if(found){if(found.hash!==payload.hash || found.id!==payload.id || JSON.parse(found.payload).fingerprint!==payload.fingerprint || JSON.parse(found.payload).device!==payload.device || canonicalSnapshot(JSON.parse(found.payload).recipeSnapshot??null)!==canonicalSnapshot(payload.recipeSnapshot??null))throw Error('idempotency-conflict');return found;}
      if(this.maintenance())throw Error('worker-maintenance');
      // Reserve before a job can be claimed, not after lengthy inference.
      const reserved=this.reservedBytes();
      if(reserved+STAGING_RESERVATION>STAGING_CAPACITY || availableBytes<reserved+STAGING_RESERVATION+256*1024*1024)throw Error('staging-full');
      if(this.db.prepare(`SELECT count(*) AS n FROM jobs WHERE state IN ('queued','dispatching','running','cancel-requested','submission-unknown')`).get().n>=5 || this.db.prepare(`SELECT count(*) AS n FROM jobs WHERE owner=? AND state IN ('queued','dispatching','running','cancel-requested','submission-unknown')`).get(payload.owner).n>=2)throw Error('queue-full');
      this.db.prepare('INSERT INTO jobs(id,owner,key,hash,payload,state,created) VALUES(?,?,?,?,?,?,?)').run(payload.id,payload.owner,payload.key,payload.hash,JSON.stringify(payload),'queued',Date.now());
      return this.get(payload.owner,payload.id);
    });
  }
  claimNext(epoch,token) { return this.atomic(()=>{
    if(this.db.prepare(`SELECT id FROM jobs WHERE state IN ('dispatching','running','cancel-requested','submission-unknown') LIMIT 1`).get())return null;
    const row=this.db.prepare(`SELECT * FROM jobs WHERE state='queued' ORDER BY created,id LIMIT 1`).get();if(!row)return null;
    this.db.prepare(`UPDATE jobs SET state='dispatching',claim=?,epoch=?,heartbeat=? WHERE id=? AND state='queued'`).run(token,epoch,Date.now(),row.id);
    return {...row,state:'dispatching',claim:token,epoch};
  }); }
  maintenance() {return this.db.prepare('SELECT token,purpose FROM lifecycle WHERE slot=1').get()??null;}
  beginMaintenance(token,purpose='update') {return this.atomic(()=>{
    if(!/^[a-f0-9-]{36}$/.test(token)||!['update','shutdown'].includes(purpose))throw Error('invalid-maintenance');
    const active=this.maintenance();if(active){if(active.token!==token||active.purpose!==purpose)throw Error('worker-maintenance-busy');return active;}
    this.db.prepare('INSERT INTO lifecycle VALUES(1,?,?)').run(token,purpose);return this.maintenance();
  });}
  endMaintenance(token) {return this.atomic(()=>{
    const active=this.maintenance();if(!active||active.token!==token)throw Error('worker-maintenance-conflict');
    this.db.prepare('DELETE FROM lifecycle WHERE token=?').run(token);return true;
  });}
  outstandingCount() {return this.db.prepare("SELECT count(*) n FROM jobs WHERE state IN ('queued','dispatching','running','cancel-requested','submission-unknown')").get().n;}
  assertQuiescent(token) {return this.atomic(()=>{
    if(this.maintenance()?.token!==token)throw Error('worker-maintenance-conflict');
    if(this.outstandingCount())throw Error('worker-jobs-outstanding');return true;
  });}
  supervisorStart(id,token,epoch,pid,creationIdentity) { return this.atomic(()=>{
    if(!creationIdentity)throw Error('process-creation-identity-required');
    const result=this.db.prepare(`UPDATE jobs SET state='running',pid=?,process_creation_identity=?,heartbeat=? WHERE id=? AND claim=? AND epoch=? AND state='dispatching'`).run(pid,creationIdentity,Date.now(),id,token,epoch);
    return result.changes===1;
  }); }
  heartbeat(id,token) { this.db.prepare(`UPDATE jobs SET heartbeat=? WHERE id=? AND claim=? AND state IN ('running','cancel-requested','submission-unknown')`).run(Date.now(),id,token); }
  finish(id,token,state,code,failure=null) {
    const now=Date.now();
    const receipt=failure?JSON.stringify(validateLocalFailure(failure)):null;
    this.db.prepare(`UPDATE jobs SET state=CASE WHEN state='cancel-requested' THEN 'cancelled' ELSE ? END,exit_code=?,heartbeat=?,finished_at=?,failure_receipt=CASE WHEN state='cancel-requested' OR ? IN ('generated-unvalidated','cancelled') THEN NULL ELSE coalesce(failure_receipt,?) END WHERE id=? AND claim=? AND state IN ('running','cancel-requested','submission-unknown')`).run(state,code,now,now,state,receipt,id,token);
  }
  unknown(id,token,failure=null) { const receipt=failure?JSON.stringify(validateLocalFailure(failure)):null;this.db.prepare(`UPDATE jobs SET state='submission-unknown',failure_receipt=coalesce(failure_receipt,?) WHERE id=? AND claim=? AND state IN ('dispatching','running','cancel-requested')`).run(receipt,id,token); }
  stale(now=Date.now()) { this.db.prepare(`UPDATE jobs SET state='submission-unknown' WHERE state IN ('dispatching','running','cancel-requested') AND heartbeat < ?`).run(now-30000); }
  cancel(owner,id) {
    this.db.prepare(`UPDATE jobs SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE 'cancel-requested' END WHERE owner=? AND id=? AND state IN ('queued','running')`).run(owner,id);
    return this.get(owner,id);
  }
  acquireOutputLease(owner,id,now=Date.now()) { return this.atomic(()=>{
    const row=this.get(owner,id);
    if(!row)throw Error('output-not-found');
    if(row.output_state==='expired')throw Error('output-expired');
    if(row.output_state!=='generated' || !row.output_descriptor)throw Error('output-not-ready');
    const descriptor=JSON.parse(row.output_descriptor);
    if(Date.parse(descriptor.expiresAt)<=now)throw Error('output-expired');
    const token=randomUUID();
    this.db.prepare('INSERT INTO output_leases VALUES(?,?,?,?)').run(token,id,owner,now+OUTPUT_LEASE_MS);
    return {token,expiresAt:new Date(now+OUTPUT_LEASE_MS).toISOString(),descriptor};
  }); }
  renewOutputLease(owner,id,token,now=Date.now()) {
    const changed=this.db.prepare('UPDATE output_leases SET expires=? WHERE token=? AND job_id=? AND owner=? AND expires>?').run(now+OUTPUT_LEASE_MS,token,id,owner,now);
    if(changed.changes!==1)throw Error('output-lease-expired');
    return {token,expiresAt:new Date(now+OUTPUT_LEASE_MS).toISOString()};
  }
  releaseOutputLease(owner,id,token) { this.db.prepare('DELETE FROM output_leases WHERE token=? AND job_id=? AND owner=?').run(token,id,owner); }
  assertOutputLease(owner,id,token,now=Date.now()) {
    if(!this.db.prepare('SELECT token FROM output_leases WHERE token=? AND job_id=? AND owner=? AND expires>?').get(token,id,owner,now))throw Error('output-lease-expired');
  }
  markOutputSaved(owner,id,sha256) { return this.atomic(()=>{
    const row=this.get(owner,id);
    if(!row)throw Error('output-not-found');
    const descriptor=row.output_descriptor?JSON.parse(row.output_descriptor):null;
    if(!descriptor || descriptor.sha256!==sha256)throw Error('staged-output-changed');
    this.db.prepare('UPDATE jobs SET saved_at=coalesce(saved_at,?) WHERE id=? AND owner=?').run(Date.now(),id,owner);
  }); }
  close() { this.db.close(); }
}


