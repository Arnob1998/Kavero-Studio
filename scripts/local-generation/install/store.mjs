import { DatabaseSync } from 'node:sqlite';
import { constants,closeSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export async function processIdentity(pid=process.pid) {
  if(process.platform!=='win32'||!Number.isInteger(pid)||pid<1)throw Error('install-process-inspection-unavailable');
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,@{Name='CreationTicks';Expression={$_.CreationDate.ToUniversalTime().Ticks.ToString()}} | ConvertTo-Json -Compress`],{windowsHide:true,timeout:10000,maxBuffer:4096});
  if(!stdout.trim())return null;
  const data=JSON.parse(stdout);if(Number(data.ProcessId)!==pid||!/^\d+$/.test(data.CreationTicks))throw Error('install-process-inspection-unavailable');
  return {pid,creation:data.CreationTicks};
}
export class InstallStore {
  constructor(files) {
    if(process.versions.node!=='24.11.1')throw Error('install-runtime-not-verified');
    for(const filename of ['install.sqlite','install.sqlite-wal','install.sqlite-shm'])files.resolve(filename);
    if(!files.exists('install.sqlite'))closeSync(files.open('install.sqlite',constants.O_CREAT|constants.O_EXCL|constants.O_RDWR));
    this.files=files;this.db=new DatabaseSync(files.resolve('install.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS installs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,submission_key TEXT NOT NULL,package_id TEXT NOT NULL,manifest TEXT NOT NULL,state TEXT NOT NULL,progress INTEGER NOT NULL DEFAULT 0,cancel INTEGER NOT NULL DEFAULT 0,error TEXT,created INTEGER NOT NULL,updated INTEGER NOT NULL,UNIQUE(owner,submission_key));
      CREATE TABLE IF NOT EXISTS writer(slot INTEGER PRIMARY KEY CHECK(slot=1),operation TEXT NOT NULL,token TEXT NOT NULL,pid INTEGER NOT NULL,creation TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS frozen_install BEFORE UPDATE ON installs WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.submission_key IS NOT NEW.submission_key OR OLD.package_id IS NOT NEW.package_id OR OLD.manifest IS NOT NEW.manifest OR OLD.created IS NOT NEW.created BEGIN SELECT RAISE(ABORT,'install-identity-immutable');END;`);
  }
  admit(owner,key,verified) {
    if(!uuid(owner)||!uuid(key))throw Error('invalid-install-owner-key');
    return this.transaction(()=>{
      const old=this.db.prepare('SELECT * FROM installs WHERE owner=? AND submission_key=?').get(owner,key);
      if(old){if(old.manifest!==verified.hash)throw Error('install-idempotency-conflict');return old;}
      if(this.db.prepare('SELECT count(*) n FROM installs').get().n>=256)throw Error('install-journal-full');
      const now=Date.now(),id=randomUUID();this.db.prepare('INSERT INTO installs(id,owner,submission_key,package_id,manifest,state,created,updated) VALUES(?,?,?,?,?,?,?,?)').run(id,owner,key,verified.manifest.id,verified.hash,'admitted',now,now);return this.get(owner,id);
    });
  }
  get(owner,id) {this.files.check();return this.db.prepare('SELECT * FROM installs WHERE owner=? AND id=?').get(owner,id)??null;}
  claim(owner,id,identity) {
    if(!identity||!Number.isInteger(identity.pid)||identity.pid<1||!/^\d+$/.test(identity.creation))throw Error('install-process-inspection-unavailable');
    return this.transaction(()=>{
      const row=this.get(owner,id);if(!row)throw Error('install-not-found');if(['installed','cancelled'].includes(row.state))return null;
      if(this.db.prepare('SELECT * FROM writer WHERE slot=1').get())throw Error('install-destination-busy');
      const token=randomUUID();this.db.prepare('INSERT INTO writer VALUES(1,?,?,?,?)').run(id,token,identity.pid,identity.creation);return token;
    });
  }
  assert(owner,id,token) {
    this.files.check();const row=this.get(owner,id),writer=this.db.prepare('SELECT * FROM writer WHERE slot=1').get();
    if(!row||writer?.operation!==id||writer.token!==token)throw Error('install-claim-lost');if(row.cancel)throw Error('install-cancelled');return row;
  }
  checkpoint(owner,id,token,state,progress=0,error=null) {
    const writer=this.db.prepare('SELECT * FROM writer WHERE slot=1 AND operation=? AND token=?').get(id,token);if(!writer)throw Error('install-claim-lost');
    this.db.prepare('UPDATE installs SET state=?,progress=?,error=?,updated=? WHERE owner=? AND id=?').run(state,progress,error,Date.now(),owner,id);
    return this.get(owner,id);
  }
  cancel(owner,id) {
    return this.transaction(()=>{
      const row=this.get(owner,id);if(!row)return null;
      if(['installed','cancelled'].includes(row.state))return row;
      const writer=this.db.prepare('SELECT * FROM writer WHERE slot=1 AND operation=?').get(id);
      this.db.prepare('UPDATE installs SET cancel=1,state=?,updated=? WHERE owner=? AND id=?').run(writer?'cancelling':'cancelled',Date.now(),owner,id);return this.get(owner,id);
    });
  }
  commit(owner,id,token,progress) {
    return this.transaction(()=>{this.assert(owner,id,token);return this.checkpoint(owner,id,token,'installed',progress);});
  }
  release(id,token) {this.db.prepare('DELETE FROM writer WHERE slot=1 AND operation=? AND token=?').run(id,token);}
  async recover(inspect=processIdentity) {
    const before=this.db.prepare('SELECT * FROM writer WHERE slot=1').get();if(!before)return false;
    const identity=await inspect(before.pid);assertGone(identity);
    // Two complete OS observations, then transactional CAS. No heartbeat timeout
    // can authorize takeover. Unknown/failed inspection leaves the lock intact.
    const again=await inspect(before.pid);assertGone(again);
    return this.transaction(()=>{
      const current=this.db.prepare('SELECT * FROM writer WHERE slot=1').get();if(current?.token!==before.token)return false;
      this.db.prepare("UPDATE installs SET state=CASE WHEN cancel=1 THEN 'cancelled' ELSE 'interrupted' END,updated=? WHERE id=? AND state!='installed'").run(Date.now(),before.operation);
      this.release(before.operation,before.token);return true;
    });
    function assertGone(identity) {
      if(identity!==null&&(!identity||identity.pid!==before.pid||!/^\d+$/.test(identity.creation)))throw Error('install-process-inspection-unavailable');
      if(identity?.creation===before.creation)throw Error('install-writer-still-alive');
    }
  }
  transaction(fn) {this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
}
