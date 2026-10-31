import { evaluationEnabled,modelSelectionMode } from './selection.mjs';
import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { PackageInstaller } from '../install/transaction.mjs';
import { qwenResearchDelivery } from '../install/qwen-delivery.mjs';
import { validateManifest } from '../install/manifest.mjs';
import { inspectHost } from '../profile.mjs';
import { EVALUATION_PACKAGE } from './model-package.mjs';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
export class SetupManager {
  constructor(config,db,activation,{installer,manifest=qwenResearchDelivery(),hardware=inspectHost}={}) {
    this.config=config;this.db=db;this.activation=activation;this.hardware=hardware;this.verified=validateManifest(manifest,modelSelectionMode(config)==='user-selected'?'user-selected':'internal-evaluation');this.busy=false;this.initializing=true;this.admitting=false;this.pending=null;
    this.installer=installer??new PackageInstaller({root:config.root+'/delivery',instanceId:config.instanceId,catalog:[manifest],purpose:modelSelectionMode(config)==='user-selected'?'user-selected':'internal-evaluation'});
    db.exec(`CREATE TABLE IF NOT EXISTS setup_consents(owner TEXT NOT NULL,submission_key TEXT NOT NULL,manifest TEXT NOT NULL,terms TEXT NOT NULL,purpose TEXT NOT NULL,accepted_at INTEGER NOT NULL,operation TEXT,PRIMARY KEY(owner,submission_key));
      CREATE TRIGGER IF NOT EXISTS frozen_setup_consent BEFORE UPDATE ON setup_consents WHEN OLD.owner IS NOT NEW.owner OR OLD.submission_key IS NOT NEW.submission_key OR OLD.manifest IS NOT NEW.manifest OR OLD.terms IS NOT NEW.terms OR OLD.purpose IS NOT NEW.purpose OR OLD.accepted_at IS NOT NEW.accepted_at BEGIN SELECT RAISE(ABORT,'setup-consent-immutable'); END;`);
  }
  async recover(){await this.installer.recover();}
  consentToken(owner,stamp=Date.now()){return `${stamp}.${createHmac('sha256',this.config.secret).update(['kavero-setup-consent-v1',owner,this.verified.hash,this.verified.manifest.termsDigest,'research-evaluation',stamp].join('\n')).digest('hex')}`;}
  validToken(owner,token){if(typeof token!=='string'||!/^\d{13}\.[a-f0-9]{64}$/.test(token))return false;const stamp=Number(token.split('.')[0]);return Math.abs(Date.now()-stamp)<=20*60*1000&&timingSafeEqual(Buffer.from(this.consentToken(owner,stamp)),Buffer.from(token));}
  terms(){return this.verified.manifest.bundledFiles.filter(f=>f.role==='notice').map(f=>({name:f.path.slice(8),text:Buffer.from(f.dataBase64,'base64').toString('utf8')}));}
  access(owner){return !!this.db.prepare('SELECT 1 FROM setup_consents WHERE owner=? AND manifest=? AND terms=? AND purpose=?').get(owner,this.verified.hash,this.verified.manifest.termsDigest,'research-evaluation')
    &&this.activation.model?.deliveryManifest===this.verified.hash&&this.activation.status().inferenceReady;}
  async snapshot(owner){
    if(!uuid(owner))throw Error('invalid-setup');
    let supported=false,hardware=null,compatibility='check-unavailable';try{hardware=await this.hardware(this.installer.files.root,false);supported=true;compatibility='eligible';}catch(error){if(['windows-only','multiple-gpus','gpu-unverified','gpu-too-small','ram-too-small'].includes(error.compatibility))compatibility=error.compatibility;}
    const row=this.db.prepare('SELECT * FROM setup_consents WHERE owner=? ORDER BY accepted_at DESC,rowid DESC LIMIT 1').get(owner);
    const accepted=!!this.db.prepare('SELECT 1 FROM setup_consents WHERE owner=? AND manifest=? AND terms=?').get(owner,this.verified.hash,this.verified.manifest.termsDigest);
    return {packageId:this.verified.manifest.id,manifest:this.verified.hash,termsDigest:this.verified.manifest.termsDigest,purpose:'research-evaluation',consentToken:this.consentToken(owner),accepted,
      available:evaluationEnabled(this.config)&&!this.initializing&&supported,supported,compatibility,ready:this.access(owner),
      installed:this.activation.model?.deliveryManifest===this.verified.hash,freeBytes:this.installer.files.freeBytes(),
      ...(hardware?{hardware:{freeVramMiB:hardware.freeVramMiB,freeRamBytes:hardware.freeRamBytes,...(hardware.name?{gpuName:hardware.name,totalVramMiB:hardware.totalVramMiB,totalRamBytes:hardware.totalRamBytes,confidence:hardware.confidence}:{})}}:{}),
      downloadBytes:this.verified.manifest.artifacts.reduce((n,a)=>n+a.bytes,0),workBytes:this.verified.totalBytes,requiredFreeBytes:this.verified.totalBytes+1024**3,
      operation:row?.operation?this.operation(owner,row.operation):null};
  }
  operation(owner,id){
    const row=this.db.prepare('SELECT * FROM setup_consents WHERE owner=? AND operation=?').get(owner,id);if(!row)return null;
    const op=this.installer.status(owner,id);if(!op)return null;
    const activation=this.db.prepare('SELECT state,error FROM activations WHERE owner=? AND submission_key=?').get(owner,this.activationKey(row));
    const state=op.state!=='installed'?op.state:this.access(owner)?'installed':activation?.state==='failed'?'activation-failed':activation?.state==='interrupted'?'interrupted':this.busy?'activating':'activation-needed';
    return {id:op.id,packageId:op.packageId,state,processedBytes:op.processedBytes,error:op.error??activation?.error??null};
  }
  activationKey(row){const h=createHash('sha256').update(row.owner+'\n'+row.submission_key+'\n'+row.manifest).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`;}
  async admit(body){
    if(Object.keys(body).sort().join(',')!=='accepted,consentToken,key,manifest,owner,purpose,termsDigest'||!uuid(body.owner)||!uuid(body.key)||body.accepted!==true||body.purpose!=='research-evaluation')throw Error('invalid-setup');
    if(!evaluationEnabled(this.config))throw Error('setup-unavailable');
    if(body.manifest!==this.verified.hash||body.termsDigest!==this.verified.manifest.termsDigest)throw Error('setup-terms-changed');
    const old=this.db.prepare('SELECT * FROM setup_consents WHERE owner=? AND submission_key=?').get(body.owner,body.key);
    if(old&&(old.manifest!==body.manifest||old.terms!==body.termsDigest))throw Error('setup-terms-changed');
    if(!old&&!this.validToken(body.owner,body.consentToken))throw Error('setup-terms-changed');
    if(old?.operation&&(this.busy||this.pending||this.access(body.owner)))return this.operation(body.owner,old.operation);
    if(this.initializing||this.busy||this.admitting||this.pending)throw Error('setup-busy');
    this.admitting=true;try{
    try{await this.hardware(this.installer.files.root,false);}catch{throw Error('setup-hardware-unsupported');}
    if(!old){if(this.db.prepare('SELECT count(*) n FROM setup_consents').get().n>=128)throw Error('setup-journal-full');
      this.db.prepare('INSERT INTO setup_consents VALUES(?,?,?,?,?,?,NULL)').run(body.owner,body.key,body.manifest,body.termsDigest,body.purpose,Date.now());}
    const op=this.installer.admit({owner:body.owner,key:body.key,packageId:this.verified.manifest.id});
    this.db.prepare('UPDATE setup_consents SET operation=? WHERE owner=? AND submission_key=?').run(op.id,body.owner,body.key);this.pending=op.id;return this.operation(body.owner,op.id);
    }finally{this.admitting=false;}
  }
  async run(owner,id){
    if(this.installer.status(owner,id)?.state==='installed'&&this.access(owner)){if(this.pending===id)this.pending=null;return;}
    if(this.busy||this.initializing||this.admitting||this.pending&&this.pending!==id)throw Error('setup-busy');this.pending=null;this.busy=true;
    try{await this.installer.run(owner,id);if(this.installer.status(owner,id)?.state!=='installed')return;
      if(this.activation.model?.deliveryManifest===this.verified.hash&&this.activation.status().inferenceReady)return;
      const row=this.db.prepare('SELECT * FROM setup_consents WHERE owner=? AND operation=?').get(owner,id);if(!row)throw Error('invalid-setup');
      const op=this.activation.admit({owner,key:this.activationKey(row),packageId:EVALUATION_PACKAGE});await this.activation.run(owner,op.id);
    }finally{this.busy=false;}
  }
  cancel(owner,id){const row=this.db.prepare('SELECT * FROM setup_consents WHERE owner=? AND operation=?').get(owner,id);if(!row)return null;
    const op=this.installer.status(owner,id);if(op?.state==='installed')throw Error('setup-cancel-too-late');this.installer.cancel(owner,id);return this.operation(owner,id);}
  close(){if(this.busy||this.initializing||this.admitting||this.pending)throw Error('setup-busy');this.installer.close();}
}
