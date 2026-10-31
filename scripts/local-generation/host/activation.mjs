import { evaluationEnabled,modelSelectionMode } from './selection.mjs';
import { randomUUID } from 'node:crypto';
import { InstallFiles } from '../install/filesystem.mjs';
import { Ledger } from '../ledger.mjs';
import { startWorker } from '../worker.mjs';
import { verifyModel,EVALUATION_PACKAGE,MODEL_RECEIPT_HASH } from './model-package.mjs';
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const view=row=>row?{id:row.id,packageId:row.package_id,state:row.state,error:row.error}:null;
export class ActivationManager {
  constructor(config,db,{files,verify=verifyModel,start=startWorker,ledgerFactory=filename=>new Ledger(filename)}={}) {
    this.config=config;this.db=db;this.files=files??new InstallFiles(config.root,config.instanceId);this.verify=verify;this.start=start;this.ledgerFactory=ledgerFactory;this.worker=null;this.state='awaiting-package';this.busy=false;this.stopping=false;
    db.exec(`CREATE TABLE IF NOT EXISTS activations(id TEXT PRIMARY KEY,owner TEXT NOT NULL,submission_key TEXT NOT NULL,package_id TEXT NOT NULL,receipt TEXT NOT NULL,state TEXT NOT NULL,error TEXT,cancel INTEGER NOT NULL DEFAULT 0,UNIQUE(owner,submission_key));
      CREATE TABLE IF NOT EXISTS active_worker(slot INTEGER PRIMARY KEY CHECK(slot=1),package_id TEXT NOT NULL,receipt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS activation_guard(slot INTEGER PRIMARY KEY CHECK(slot=1),token TEXT NOT NULL,purpose TEXT NOT NULL,operation TEXT,owner TEXT);
      CREATE TRIGGER IF NOT EXISTS frozen_activation BEFORE UPDATE ON activations WHEN OLD.id IS NOT NEW.id OR OLD.owner IS NOT NEW.owner OR OLD.submission_key IS NOT NEW.submission_key OR OLD.package_id IS NOT NEW.package_id OR OLD.receipt IS NOT NEW.receipt BEGIN SELECT RAISE(ABORT,'activation-identity-immutable'); END;`);
    this.files.directory('generation');for(const suffix of ['','-wal','-shm'])this.files.resolve('generation/ledger.sqlite'+suffix);
  }
  status(){return {state:this.state,inferenceReady:!!this.worker&&!this.worker.ledger.maintenance()&&!this.busy&&!this.stopping,evaluationEnabled:evaluationEnabled(this.config),selectionMode:modelSelectionMode(this.config)};}
  get(owner,id){return view(this.db.prepare('SELECT * FROM activations WHERE owner=? AND id=?').get(owner,id));}
  admit({owner,key,packageId}) {
    if(!uuid(owner)||!uuid(key))throw Error('invalid-activation');
    if(!evaluationEnabled(this.config)||packageId!==EVALUATION_PACKAGE)throw Error('activation-package-unavailable');
    if(this.stopping)throw Error('activation-busy');
    const old=this.db.prepare('SELECT * FROM activations WHERE owner=? AND submission_key=?').get(owner,key);
    if(old){if(old.package_id!==packageId||old.receipt!==MODEL_RECEIPT_HASH)throw Error('activation-idempotency-conflict');return view(old);}
    if(this.db.prepare('SELECT count(*) n FROM activations').get().n>=128)throw Error('activation-journal-full');
    if(this.busy||this.db.prepare("SELECT id FROM activations WHERE state IN ('admitted','verifying','starting')").get())throw Error('activation-busy');
    const id=randomUUID();this.db.prepare('INSERT INTO activations(id,owner,submission_key,package_id,receipt,state) VALUES(?,?,?,?,?,?)').run(id,owner,key,packageId,MODEL_RECEIPT_HASH,'admitted');return this.get(owner,id);
  }
  cancel(owner,id){const row=this.db.prepare('SELECT * FROM activations WHERE owner=? AND id=?').get(owner,id);if(!row)return null;
    if(['installed','cancelled','failed','interrupted'].includes(row.state))return view(row);
    this.db.prepare("UPDATE activations SET cancel=1,state=CASE WHEN state='admitted' THEN 'cancelled' ELSE state END WHERE owner=? AND id=?").run(owner,id);return this.get(owner,id);
  }
  checkpoint(id,state,error=null){this.db.prepare('UPDATE activations SET state=?,error=? WHERE id=?').run(state,error,id);}
  workerConfig(model){return {stateRoot:this.files.directory('generation'),packageRoot:model.packageRoot,port:8791,secret:this.config.secret};}
  async launch(model){this.files.atomicJSON('generation/worker-config.json',this.workerConfig(model));const worker=await this.start(this.files.resolve('generation/worker-config.json'));this.model=model;return worker;}
  async restore(){
    // Agent binding/ownership is established by bootstrap before restore. A
    // second live agent cannot listen; there is no time-based process takeover.
    this.db.prepare("UPDATE activations SET state='interrupted',error='activation-interrupted' WHERE state IN ('admitted','verifying','starting')").run();
    const active=this.db.prepare('SELECT * FROM active_worker WHERE slot=1').get();
    if(!active)return;
    if(!evaluationEnabled(this.config)){this.state='evaluation-disabled';return;}
    this.busy=true;this.state='recovering';
    try {
      if(active.package_id!==EVALUATION_PACKAGE||active.receipt!==MODEL_RECEIPT_HASH)throw Error('active-package-changed');
      const model=await this.verify(this.files);this.worker=await this.launch(model);
      // Do not silently lift a persisted maintenance barrier. Its owning
      // activation is reconciled only on an explicit new/retried request.
      const paused=this.worker.ledger.maintenance(),owned=this.db.prepare('SELECT * FROM activation_guard WHERE slot=1').get();
      if(paused&&owned?.token===paused.token&&owned.purpose==='shutdown'&&this.worker.ledger.outstandingCount()===0){this.worker.ledger.endMaintenance(paused.token);this.db.prepare('DELETE FROM activation_guard WHERE slot=1').run();}
      this.state=this.worker.ledger.maintenance()?'maintenance':'ready';
    }catch{this.state='recovery-required';}finally{this.busy=false;}
  }
  async run(owner,id){
    const row=this.db.prepare('SELECT * FROM activations WHERE owner=? AND id=?').get(owner,id);if(!row)throw Error('activation-not-found');
    if(row.state==='installed'&&this.worker){const paused=this.worker.ledger.maintenance(),owned=this.db.prepare('SELECT * FROM activation_guard WHERE slot=1').get();if(paused&&owned?.token===paused.token&&owned.operation===row.id&&owned.owner===row.owner){this.worker.ledger.assertQuiescent(paused.token);this.worker.ledger.endMaintenance(paused.token);this.db.prepare('DELETE FROM activation_guard WHERE slot=1').run();this.state='ready';}return view(row);}
    if(row.state==='cancelled')return view(row);
    if(this.busy||this.stopping)throw Error('activation-busy');this.busy=true;this.state='activating';
    let guard=null,token=null,previousModel=null,previousStopped=false,newWorker=null,committed=false;
    const check=()=>{if(this.db.prepare('SELECT cancel FROM activations WHERE id=?').get(id).cancel)throw Error('activation-cancelled');};
    try {
      check();this.checkpoint(id,'verifying');const model=await this.verify(this.files,{check});check();
      guard=this.worker?.ledger??this.ledgerFactory(this.files.resolve('generation/ledger.sqlite'));
      // A previous operation's barrier has no age-based takeover. Since this
      // agent owns the listener, retain its token and require quiescence;
      // uncertain/queued jobs still prevent activation regardless of token.
      const owned=this.db.prepare('SELECT * FROM activation_guard WHERE slot=1').get();
      if(guard.maintenance()&&owned?.token!==guard.maintenance().token)throw Error('worker-maintenance-conflict');
      if(owned?.purpose==='update'&&owned.owner!==owner)throw Error('worker-maintenance-conflict');
      token=owned?.token??randomUUID();this.db.prepare("INSERT OR REPLACE INTO activation_guard VALUES(1,?,'update',?,?)").run(token,id,owner);
      if(!guard.maintenance())guard.beginMaintenance(token,'update');guard.assertQuiescent(token);check();
      if(this.worker){previousModel=this.model??model;await this.worker.close({token});this.worker=null;previousStopped=true;guard=null;}
      else {guard.close();guard=null;}
      this.checkpoint(id,'starting');check();newWorker=await this.launch(model);check();
      newWorker.ledger.assertQuiescent(token);
      // Pointer and activation acknowledgement are one durable transaction;
      // an interrupted acknowledgement never redefines a user's request.
      this.db.exec('BEGIN IMMEDIATE');try{
        check();this.db.prepare('INSERT OR REPLACE INTO active_worker VALUES(1,?,?)').run(row.package_id,row.receipt);
        this.checkpoint(id,'installed');this.db.exec('COMMIT');committed=true;
      }catch(error){this.db.exec('ROLLBACK');throw error;}
      newWorker.ledger.endMaintenance(token);this.db.prepare('DELETE FROM activation_guard WHERE slot=1').run();this.worker=newWorker;newWorker=null;this.state='ready';return this.get(owner,id);
    }catch(error){
      if(newWorker){try{await newWorker.close({token});}catch{}newWorker=null;}
      if(previousStopped&&previousModel){try{this.worker=await this.launch(previousModel);if(this.worker.ledger.maintenance()?.token===token){this.worker.ledger.endMaintenance(token);this.db.prepare('DELETE FROM activation_guard WHERE slot=1').run();}}catch{this.worker=null;}}
      // Preserve outstanding-work barriers. Never undo a guard because an
      // update timed out; a live worker can continue draining admitted jobs.
      if(guard){if(!this.worker)guard.close();}
      if(!committed)this.checkpoint(id,error.message==='activation-cancelled'?'cancelled':'failed',['worker-jobs-outstanding','activation-cancelled'].includes(error.message)?error.message:'activation-failed');
      this.state=this.worker?(this.worker.ledger.maintenance()?'maintenance':'ready'):'recovery-required';return this.get(owner,id);
    }finally{this.busy=false;}
  }
  async shutdown(){
    if(this.busy)throw Error('activation-busy');this.stopping=true;
    try{if(this.worker){const owned=this.db.prepare('SELECT * FROM activation_guard WHERE slot=1').get(),paused=this.worker.ledger.maintenance();if(paused&&owned?.token!==paused.token)throw Error('worker-maintenance-conflict');const token=paused?.token??randomUUID();this.db.prepare("INSERT OR REPLACE INTO activation_guard VALUES(1,?,'shutdown',NULL,NULL)").run(token);if(!paused)this.worker.ledger.beginMaintenance(token,'shutdown');this.worker.ledger.assertQuiescent(token);await this.worker.close({token});this.worker=null;}this.state='stopping';}
    catch(error){this.stopping=false;throw error;}
  }
}
