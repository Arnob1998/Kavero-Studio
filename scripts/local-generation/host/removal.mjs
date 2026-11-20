import { randomUUID } from 'node:crypto';
import { PackageRemoval } from '../install/removal.mjs';
import { evaluationEnabled } from './selection.mjs';

/** Native lifecycle; removal-wire binds the authenticated app admission fence. */
export class NativeRemovalManager {
  constructor(config,db,activation,setup,{remover}={}) {
    this.config=config;this.db=db;this.activation=activation;this.setup=setup;this.busy=false;
    const managers=[...setup.managers.values()];
    this.remover=remover??new PackageRemoval(managers[0].installer,{catalog:managers.map(m=>m.verified.manifest),purpose:config.userSelectedModels?'user-selected':'internal-evaluation'});
    setup.removal=this;activation.removal=this;
  }
  get blocking(){return this.busy||!!this.remover.store.db.prepare("SELECT id FROM removals WHERE state NOT IN ('removed','cancelled')").get()||this.db.prepare('SELECT purpose FROM activation_guard WHERE slot=1').get()?.purpose==='removal';}
  manager(packageId){const m=[...this.setup.managers.values()].find(m=>m.packageId===packageId);if(!m)throw Error('removal-package-unavailable');return m;}
  removed(packageId){
    const m=[...this.setup.managers.values()].find(m=>m.packageId===packageId);if(!m)return false;
    return !!this.remover.store.db.prepare("SELECT id FROM removals WHERE manifest=? AND state='removed'").get(m.verified.hash)
      &&!this.remover.store.db.prepare("SELECT id FROM installs WHERE manifest=? AND state='installed'").get(m.verified.hash);
  }
  assertIdle(){
    if(this.setup.busy||this.setup.initializing||this.setup.admitting||this.setup.pending||this.activation.busy||this.activation.stopping
      ||this.db.prepare("SELECT id FROM activations WHERE state IN ('admitted','verifying','starting')").get())throw Error('removal-native-busy');
  }
  admit({owner,key,packageId}) {
    if(this.busy)throw Error('removal-native-busy');this.assertIdle();
    if(!evaluationEnabled(this.config))throw Error('removal-package-unavailable');const manager=this.manager(packageId);
    const consent=this.db.prepare('SELECT operation FROM setup_consents WHERE owner=? AND manifest=? AND operation IS NOT NULL').get(owner,manager.verified.hash);
    if(!consent)throw Error('removal-not-owned');
    const guard=this.db.prepare('SELECT * FROM activation_guard WHERE slot=1').get();
    if(guard&&guard.purpose!=='removal')throw Error('worker-maintenance-conflict');
    return this.remover.admit({owner,key,packageId:manager.verified.manifest.id});
  }
  async run(owner,id) {
    if(this.busy)throw Error('removal-native-busy');this.assertIdle();
    const row=this.remover.row(owner,id);if(!row)throw Error('removal-not-found');
    const manager=[...this.setup.managers.values()].find(m=>m.verified.hash===row.manifest);if(!manager)throw Error('removal-package-unavailable');
    this.busy=true;let ledger=null;
    try {
      const acquire=async(plan)=>{
        if(plan.accountOnly)return;
        const active=this.activation.active(),loaded=this.activation.model;
        if(this.activation.worker&&!this.activation.matches(loaded,active))throw Error('removal-runtime-changed');
        ledger=this.activation.worker?.ledger??this.activation.ledgerFactory(this.activation.files.resolve('generation/ledger.sqlite'));
        const guard=this.db.prepare('SELECT * FROM activation_guard WHERE slot=1').get(),paused=ledger.maintenance();
        if(guard&&(guard.purpose!=='removal'||guard.operation!==id||guard.owner!==owner)||paused&&(!guard||guard.token!==paused.token||paused.purpose!=='removal'))throw Error('worker-maintenance-conflict');
        const token=guard?.token??randomUUID();
        this.db.prepare("INSERT OR REPLACE INTO activation_guard VALUES(1,?,'removal',?,?)").run(token,id,owner);
        // A refusal must leave queued jobs able to finish. Acquire and check
        // together so another process cannot enqueue between the two steps.
        ledger.beginMaintenance(token,'removal',{quiescent:true});
        if(active?.package_id===manager.packageId){
          if(this.activation.worker){await this.activation.worker.close({token});this.activation.worker=null;ledger=null;}
          this.db.prepare('DELETE FROM active_worker WHERE slot=1 AND package_id=?').run(manager.packageId);
          this.activation.model=null;this.activation.state='removal-recovery';
        }
      };
      const afterDelete=async(plan)=>{
        if(plan.accountOnly)this.db.prepare("UPDATE activations SET state='removed',error=NULL WHERE package_id=? AND owner=?").run(manager.packageId,owner);
        else this.db.prepare("UPDATE activations SET state='removed',error=NULL WHERE package_id=?").run(manager.packageId);
      };
      const result=await this.remover.run(owner,id,{beforeDelete:acquire,afterDelete});
      // A crash after the delivery commit retains the native guard; owner replay
      // also finishes this cleanup when the package transaction is terminal.
      const guard=this.db.prepare('SELECT * FROM activation_guard WHERE slot=1').get();
      if(guard){
        if(guard.purpose!=='removal'||guard.operation!==id||guard.owner!==owner)throw Error('worker-maintenance-conflict');
        ledger??=this.activation.worker?.ledger??this.activation.ledgerFactory(this.activation.files.resolve('generation/ledger.sqlite'));
        const paused=ledger.maintenance();if(paused){if(paused.token!==guard.token||paused.purpose!=='removal')throw Error('worker-maintenance-conflict');ledger.assertQuiescent(guard.token);ledger.endMaintenance(guard.token);}
        this.db.prepare('DELETE FROM activation_guard WHERE slot=1 AND token=?').run(guard.token);
      }
      this.activation.state=this.activation.worker?'ready':'awaiting-package';return result;
    }finally{if(ledger&&ledger!==this.activation.worker?.ledger)ledger.close();this.busy=false;}
  }
  async shutdown(){
    if(this.busy)throw Error('activation-busy');
    // Preserve a removal-owned barrier across normal shutdown/restart.
    if(this.activation.worker){
      let guard=this.db.prepare('SELECT * FROM activation_guard WHERE slot=1').get();
      if(!guard){
        const pending=this.remover.store.db.prepare("SELECT id,owner FROM removals WHERE state NOT IN ('removed','cancelled')").get();
        if(!pending)throw Error('worker-maintenance-conflict');
        guard={token:randomUUID(),purpose:'removal',operation:pending.id,owner:pending.owner};
        this.db.prepare("INSERT INTO activation_guard VALUES(1,?,'removal',?,?)").run(guard.token,guard.operation,guard.owner);
      }
      if(guard.purpose!=='removal')throw Error('worker-maintenance-conflict');
      const ledger=this.activation.worker.ledger;
      ledger.beginMaintenance(guard.token,'removal',{quiescent:true});
      await this.activation.worker.close({token:guard.token});this.activation.worker=null;
    }
    this.activation.stopping=true;this.activation.state='stopping';
  }
}
