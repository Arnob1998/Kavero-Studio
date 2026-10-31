import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync,readFileSync,writeFileSync,lstatSync } from 'node:fs';
import { spawn,execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ledger } from './ledger.mjs';
import { verifyRequest } from './protocol.mjs';
import { verifyPackage,assertVerifiedPackageUnchanged,inspectHost,engineCommand,FINGERPRINT } from './profile.mjs';
import { assertHardwareBinding } from './hardware.mjs';
import { createJobDirectory,availableStagingBytes,inspectStagedOutput,readLeasedOutput,cleanupStaging,createBoundedLog } from './staging.mjs';
import { failureReceipt,validateLocalFailure } from '../../src/modules/model-providers/local/failure.ts';
const script=fileURLToPath(import.meta.url);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const summary=(ledger,root,row)=>({id:row.id,state:row.state,ledgerIdentity:ledger.identity,output:inspectStagedOutput(ledger,root,row.owner,row.id),...(row.failure_receipt?{failure:validateLocalFailure(JSON.parse(row.failure_receipt))}:{})});

async function supervisor(configPath,id,token,epoch) {
  const config=JSON.parse(readFileSync(configPath,'utf8'));
  const ledger=new Ledger(path.join(config.stateRoot,'ledger.sqlite'));
  const {stdout:creationIdentity}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-CimInstance Win32_Process -Filter 'ProcessId = ${process.pid}').CreationDate.ToUniversalTime().Ticks.ToString()`],{windowsHide:true,timeout:10000});
  if(!ledger.supervisorStart(id,token,epoch,process.pid,creationIdentity.trim())){ledger.close();return;}
  const row=ledger.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);
  const heartbeat=setInterval(()=>ledger.heartbeat(id,token),2000);
  let nativeStarted=false,ownedChild=null,cancelRequested=false,log=null,watch=null,ioFailure=false,stage='staging';
  const cancellation=setInterval(()=>{
    const current=ledger.db.prepare('SELECT state FROM jobs WHERE id=? AND claim=?').get(id,token);
    if(current?.state==='cancel-requested'){
      cancelRequested=true;
      if(ownedChild && ownedChild.exitCode===null)ownedChild.kill();
    }
  },500);
  try {
    const dir=createJobDirectory(config.stateRoot,id);
    stage='package';await verifyPackage(config.packageRoot);stage='hardware';const hardware=await inspectHost(config.stateRoot,true,config.packageRoot);
    stage='intent';
    const payload=JSON.parse(row.payload);
    if(payload.fingerprint!==FINGERPRINT)throw Error('identity-changed');assertHardwareBinding(payload,hardware);
    if(cancelRequested){ledger.finish(id,token,'cancelled',null);return;}
    stage='input';writeFileSync(path.join(dir,'prompt.txt'),payload.intent.prompt,{encoding:'utf8',mode:0o600});
    stage='launch';
    const {file,args}=engineCommand(config.packageRoot,dir,hardware.backendIndex);
    log=createBoundedLog(path.join(dir,'engine.log'),()=>{ioFailure=true;if(ownedChild?.exitCode===null)ownedChild.kill();});
    const child=spawn(file,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});nativeStarted=true;ownedChild=child;stage='inference';
    const append=chunk=>{try{log.append(chunk);}catch{ioFailure=true;if(child.exitCode===null)child.kill();}};
    child.stdout.on('data',append);child.stderr.on('data',append);
    watch=setInterval(()=>{
      try{const stat=lstatSync(path.join(dir,'final.png'));if(stat.size>32*1024*1024 || stat.isSymbolicLink()){ioFailure=true;if(child.exitCode===null)child.kill();}}
      catch(error){if(error.code!=='ENOENT'){ioFailure=true;if(child.exitCode===null)child.kill();}}
    },250);
    // Wait for close, including all stdout/stderr, before terminal publication.
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});log.close();
    ledger.finish(id,token,cancelRequested?'cancelled':code===0&&!ioFailure?'generated-unvalidated':'failed',code);
    if(!cancelRequested && code===0 && !ioFailure)inspectStagedOutput(ledger,config.stateRoot,row.owner,id);
  } catch(error) {
    const failure=failureReceipt(stage,error);
    if(nativeStarted)ledger.unknown(id,token,failure);
    else ledger.finish(id,token,'failed',-1,failure);
  } finally {if(watch)clearInterval(watch);log?.close();clearInterval(heartbeat);clearInterval(cancellation);ledger.close();}
}

export async function startWorker(configPath) {
  if(process.versions.node!=='24.11.1')throw Error('worker-node-version-not-verified');
  const config=JSON.parse(readFileSync(configPath,'utf8'));
  if(typeof config.secret!=='string'||config.secret.length<64||!path.isAbsolute(config.packageRoot)||!path.isAbsolute(config.stateRoot))throw Error('invalid-worker-config');
  if(config.port!==8791)throw Error('invalid-worker-port');
  mkdirSync(config.stateRoot,{recursive:true});
  const ledger=new Ledger(path.join(config.stateRoot,'ledger.sqlite')),epoch=randomUUID();
  let selected;
  try{await verifyPackage(config.packageRoot);selected=await inspectHost(config.stateRoot,false,config.packageRoot);}catch(error){ledger.close();throw error;}
  const checkDevice=hardware=>{if(JSON.stringify(hardware.identity)!==JSON.stringify(selected.identity))throw Error('device-identity-changed');return {...hardware,binding:selected.binding,backendIndex:selected.backendIndex};};
  let closing=false;
  const server=createServer(async(req,res)=>{
    const reply=(status,body)=>{const encoded=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(encoded);};
    try {
      if(req.method!=='POST'||!['/ready','/submit','/status','/cancel','/output','/lease','/lease/renew','/lease/release','/saved','/lifecycle/pause','/lifecycle/resume','/lifecycle/status','/lifecycle/stop'].includes(req.url))return reply(404,{error:'not-found'});
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>8192){reply(413,{error:'body-too-large'});req.destroy();return;}chunks.push(chunk);}
      const encoded=Buffer.concat(chunks).toString('utf8');
      verifyRequest(ledger,config.secret,req.method,req.url,req.headers,encoded);
      const body=JSON.parse(encoded);
      if(req.url.startsWith('/lifecycle/')) {
        if(closing)throw Error('worker-maintenance-busy');
        if(Object.keys(body).sort().join(',')!=='epoch,ledgerIdentity,purpose,token'||body.epoch!==epoch||body.ledgerIdentity!==ledger.identity)throw Error('lifecycle-identity-changed');
        if(req.url==='/lifecycle/pause')ledger.beginMaintenance(body.token,body.purpose);
        else if(req.url==='/lifecycle/resume')ledger.endMaintenance(body.token);
        else if(ledger.maintenance()?.token!==body.token)throw Error('worker-maintenance-conflict');
        if(req.url==='/lifecycle/stop'){ledger.assertQuiescent(body.token);closing=true;}
        reply(200,{epoch,ledgerIdentity:ledger.identity,maintenance:!!ledger.maintenance(),outstanding:ledger.outstandingCount(),stopping:closing});
        if(req.url==='/lifecycle/stop')setImmediate(()=>close({token:body.token}).catch(()=>{}));return;
      }
      if(req.url==='/ready'){
        if(ledger.maintenance())return reply(503,{error:'worker-maintenance'});
        assertVerifiedPackageUnchanged(config.packageRoot);
        const hardware=checkDevice(await inspectHost(config.stateRoot,false));
        return reply(200,{ready:true,epoch,ledgerIdentity:ledger.identity,packageFingerprint:FINGERPRINT,deviceId:selected.deviceId,hardware});
      }
      if(!uuid(body.id)||!uuid(body.owner))return reply(400,{error:'invalid-job'});
      if(req.url==='/submit'){
        if(!uuid(body.key)||body.epoch!==epoch||body.ledgerIdentity!==ledger.identity||body.fingerprint!==FINGERPRINT||body.device!==selected.deviceId) return reply(409,{error:'identity-changed'});
        const existing=ledger.get(body.owner,body.id);
        if(!existing){assertVerifiedPackageUnchanged(config.packageRoot);checkDevice(await inspectHost(config.stateRoot,false));}
        return reply(200,summary(ledger,config.stateRoot,ledger.submit({...body,hardwareBinding:selected.binding,backendIndex:selected.backendIndex},availableStagingBytes(config.stateRoot))));
      }
      if(req.url.startsWith('/lease') || req.url==='/output' || req.url==='/saved') {
        // Explicit durable identity prevents reading a replaced ledger's data.
        if(body.ledgerIdentity!==ledger.identity)return reply(409,{error:'ledger-identity-changed'});
        if(Object.keys(body).some(key=>!(req.url==='/saved'?['id','owner','ledgerIdentity','sha256']:['id','owner','ledgerIdentity','token']).includes(key)))return reply(400,{error:'invalid-output-request'});
        const row=ledger.get(body.owner,body.id);if(!row)return reply(404,{error:'not-found'});
        inspectStagedOutput(ledger,config.stateRoot,body.owner,body.id);
        if(req.url==='/saved'){ledger.markOutputSaved(body.owner,body.id,body.sha256);return reply(200,{saved:true});}
        if(req.url==='/lease')return reply(200,ledger.acquireOutputLease(body.owner,body.id));
        if(req.url==='/lease/renew' || req.url==='/lease/release') {
          if(!uuid(body.token))return reply(400,{error:'invalid-lease'});
          if(req.url==='/lease/renew')return reply(200,ledger.renewOutputLease(body.owner,body.id,body.token));
          ledger.releaseOutputLease(body.owner,body.id,body.token);return reply(200,{released:true});
        }
        // A buffered validated read lets us release the file lease before slow
        // network delivery. Future saves can explicitly hold/renew their lease.
        const acquired=body.token?null:ledger.acquireOutputLease(body.owner,body.id);
        try {
          const {bytes,descriptor}=readLeasedOutput(ledger,config.stateRoot,body.owner,body.id,body.token??acquired.token);
          res.writeHead(200,{'content-type':'image/png','content-length':bytes.length,'cache-control':'no-store','x-kavero-sha256':descriptor.sha256});res.end(bytes);return;
        }finally{if(acquired)ledger.releaseOutputLease(body.owner,body.id,acquired.token);}
      }
      const row=req.url==='/cancel'?ledger.cancel(body.owner,body.id):ledger.get(body.owner,body.id);
      if(!row)return reply(404,{error:'not-found'});
      // Running cancellation is deliberately not represented as cancelled:
      // no PID-only kill or global interrupt is safe here.
      if(req.url==='/cancel'&&!['cancel-requested','cancelled','failed','generated-unvalidated'].includes(row.state))return reply(409,{error:'cancellation-not-confirmed'});
      return reply(200,summary(ledger,config.stateRoot,row));
    } catch(error){
      const status={'worker-maintenance':503,'worker-maintenance-busy':409,'worker-maintenance-conflict':409,'worker-jobs-outstanding':409,'queue-full':429,'staging-full':507,'output-not-found':404,'output-expired':410,'output-not-ready':409,'output-lease-expired':409,'invalid-local-image':422,'staged-output-changed':422}[error.message];
      reply(status??401,{error:status?error.message:'request-rejected'});
    }
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});}catch(error){ledger.close();throw error;}
  let ticking=false;
  const tick=setInterval(async()=>{
    if(ticking)return;ticking=true;
    try {
      ledger.stale();
      // Bring completed LG-2A records through the same validation gate after
      // upgrade/restart, even when their browser never reconnects.
      for(const completed of ledger.db.prepare("SELECT id,owner FROM jobs WHERE state='generated-unvalidated' AND output_state='pending' LIMIT 16").all()) {
        inspectStagedOutput(ledger,config.stateRoot,completed.owner,completed.id);
      }
      cleanupStaging(ledger,config.stateRoot);
      checkDevice(await inspectHost(config.stateRoot));
      const row=ledger.claimNext(epoch,randomUUID());
      if(row){
        const child=spawn(process.execPath,[script,'supervisor',configPath,row.id,row.claim,epoch],{detached:true,windowsHide:true,stdio:'ignore'});
        child.once('error',()=>ledger.unknown(row.id,row.claim));child.unref();
      }
    }catch{/* Fail closed: do not claim or retry uncertain native work. */}
    finally{ticking=false;}
  },1000);
  let closed=false,closePromise=null;
  async function close({token=randomUUID()}={}) {
    if(closePromise)return closePromise;
    if(closed)return;
    if(!ledger.maintenance())ledger.beginMaintenance(token,'shutdown');
    ledger.assertQuiescent(token);closing=true;clearInterval(tick);
    closePromise=(async()=>{
      while(ticking)await new Promise(resolve=>setTimeout(resolve,20));
      ledger.assertQuiescent(token);
      await new Promise(resolve=>{server.close(resolve);server.closeIdleConnections();});ledger.close();closed=true;
    })();return closePromise;
  }
  return {epoch,server,ledger,close};
}
if(process.argv[1]&&path.resolve(process.argv[1])===script){
  if(process.argv[2]==='supervisor')await supervisor(...process.argv.slice(3));
  else if(process.argv[2]==='serve'){
    const worker=await startWorker(path.resolve(process.argv[3]));
    console.log('Kavero internal local worker listening on loopback:8791');
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{try{await worker.close();process.exit(0);}catch{console.error('Worker retained: outstanding work requires reconciliation.');}});
  }else throw Error('Usage: node scripts/local-generation/worker.mjs serve <private-config.json>');
}

