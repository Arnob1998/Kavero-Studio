import {SetupManager} from './setup.mjs';
import {EVALUATION_PACKAGE,Q3_PACKAGE} from './model-package.mjs';
const entries=[['qwen-image-2.1-q4-evaluation',EVALUATION_PACKAGE],['qwen-image-2.1-q3-evaluation',Q3_PACKAGE]];
// One shared delivery root/journal/cache and one active install across profiles.
// Per-owner consent and versioned package identities remain independent.
export class SetupHub {
 constructor(config,db,activation,{factory=(id)=>new SetupManager(config,db,activation,{packageId:id})}={}){
  this.db=db;this.managers=new Map(entries.map(([profile,id])=>[profile,factory(id)]));this.admission=false;
 }
 get busy(){return [...this.managers.values()].some(m=>m.busy);}
 get initializing(){return [...this.managers.values()].some(m=>m.initializing);}
 set initializing(value){for(const m of this.managers.values())m.initializing=value;}
 get admitting(){return this.admission||[...this.managers.values()].some(m=>m.admitting);}
 get pending(){return [...this.managers.values()].find(m=>m.pending)?.pending??null;}
 manager(profile='qwen-image-2.1-q4-evaluation'){const manager=this.managers.get(profile);if(!manager)throw Error('invalid-setup');return manager;}
 forOperation(owner,id){const row=this.db.prepare('SELECT manifest FROM setup_consents WHERE owner=? AND operation=?').get(owner,id);
  return row?[...this.managers.values()].find(m=>m.verified.hash===row.manifest):null;}
 async recover(){for(const manager of this.managers.values())await manager.recover();}
 snapshot(owner,profile){return this.manager(profile).snapshot(owner);}
 terms(profile){return this.manager(profile).terms();}
 access(owner,profile){return this.manager(profile).access(owner);}
 permission(owner,packageId){const manager=[...this.managers.values()].find(m=>m.packageId===packageId);if(!manager)return false;
  const row=this.db.prepare('SELECT operation FROM setup_consents WHERE owner=? AND manifest=? AND terms=? AND purpose=? ORDER BY accepted_at DESC LIMIT 1').get(owner,manager.verified.hash,manager.verified.manifest.termsDigest,'research-evaluation');
  return !!row?.operation&&manager.installer.status(owner,row.operation)?.state==='installed';}
 async admit(body){
  const manager=[...this.managers.values()].find(m=>m.verified.hash===body.manifest);if(!manager)throw Error('setup-terms-changed');
  if(this.admission||[...this.managers.values()].some(m=>m!==manager&&(m.busy||m.admitting||m.pending)))throw Error('setup-busy');
  this.admission=true;try{return await manager.admit(body);}finally{this.admission=false;}
 }
 operation(owner,id){return this.forOperation(owner,id)?.operation(owner,id)??null;}
 async run(owner,id){const manager=this.forOperation(owner,id);if(!manager)throw Error('invalid-setup');
  if(this.admission||[...this.managers.values()].some(m=>m!==manager&&(m.busy||m.admitting||m.pending)))throw Error('setup-busy');return manager.run(owner,id);}
 cancel(owner,id){return this.forOperation(owner,id)?.cancel(owner,id)??null;}
 close(){if(this.busy||this.initializing||this.admitting||this.pending)throw Error('setup-busy');for(const manager of this.managers.values())manager.close();}
}
