import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { randomUUID,createHmac,createHash } from 'node:crypto';
import { verifyRequest } from '../protocol.mjs';
import { ActivationManager } from './activation.mjs';
import { SetupManager } from './setup.mjs';
if(process.versions.node!=='24.11.1'||process.platform!=='win32')throw Error('host-runtime-unverified');
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
if(config.port!==8792||!/^[a-f0-9]{64}$/.test(config.secret)||!/^[a-f0-9-]{36}$/.test(config.instanceId))throw Error('host-config-invalid');
const db=new DatabaseSync(config.database);db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS nonces(nonce TEXT PRIMARY KEY,expires INTEGER NOT NULL)');
const epoch=randomUUID(),ledger={nonce(nonce,now){db.prepare('DELETE FROM nonces WHERE expires<?').run(now);if(db.prepare('SELECT count(*) n FROM nonces').get().n>=1024)throw Error('nonce-limit');db.prepare('INSERT INTO nonces VALUES(?,?)').run(nonce,now+60000);}};
const manager=new ActivationManager(config,db);
const setup=new SetupManager(config,db,manager);
let stopping=false;
const server=createServer(async(req,res)=>{
  const reply=(status,body,signed=false)=>{const encoded=JSON.stringify(body);res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',...(signed?{'x-kavero-response':createHmac('sha256',config.secret).update(req.headers['x-kavero-nonce']+'\n'+createHash('sha256').update(encoded).digest('hex')).digest('hex')}:{})});res.end(encoded);};
  try {
    if(req.method!=='POST'||!['/host/status','/host/shutdown','/host/activate','/host/activation','/host/activation/cancel','/host/setup','/host/setup/terms','/host/setup/install','/host/setup/status','/host/setup/cancel','/host/setup/access'].includes(req.url))return reply(404,{error:'not-found'});
    let encoded='';for await(const chunk of req){encoded+=chunk.toString();if(Buffer.byteLength(encoded)>1024){reply(413,{error:'body-too-large'});req.destroy();return;}}
    verifyRequest(ledger,config.secret,'POST',req.url,req.headers,encoded);const body=JSON.parse(encoded);
    if(req.url.startsWith('/host/setup')){
      if(req.url==='/host/setup/install'){const operation=await setup.admit(body);reply(202,{instanceId:config.instanceId,operation},true);setImmediate(()=>setup.run(body.owner,operation.id).catch(()=>{}));return;}
      const expected=['/host/setup/status','/host/setup/cancel'].includes(req.url)?'id,owner':'owner';
      const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
      if(Object.keys(body).sort().join(',')!==expected||!uuid(body.owner)||(expected==='id,owner'&&!uuid(body.id)))throw Error('invalid-setup');
      if(req.url==='/host/setup')return reply(200,{instanceId:config.instanceId,setup:await setup.snapshot(body.owner)},true);
      if(req.url==='/host/setup/terms')return reply(200,{instanceId:config.instanceId,terms:setup.terms()},true);
      if(req.url==='/host/setup/access')return reply(200,{instanceId:config.instanceId,allowed:setup.access(body.owner)},true);
      const operation=req.url.endsWith('/cancel')?setup.cancel(body.owner,body.id):setup.operation(body.owner,body.id);return reply(operation?200:404,{instanceId:config.instanceId,operation},true);
    }
    if(req.url==='/host/status') {
      if(Object.keys(body).length)throw Error('invalid-body');
      return reply(200,{instanceId:config.instanceId,epoch,pid:process.pid,node:process.versions.node,code:config.code,runtime:config.runtime,...manager.status(),...(stopping?{state:'stopping'}:{})},true);
    }
    if(req.url==='/host/activate'){
      if(Object.keys(body).sort().join(',')!=='key,owner,packageId')throw Error('invalid-activation');
      const operation=manager.admit(body);reply(202,{instanceId:config.instanceId,operation},true);
      setImmediate(()=>manager.run(body.owner,operation.id).catch(()=>{}));return;
    }
    if(req.url==='/host/activation'||req.url==='/host/activation/cancel'){
      if(Object.keys(body).sort().join(',')!=='id,owner')throw Error('invalid-activation');
      const operation=req.url.endsWith('/cancel')?manager.cancel(body.owner,body.id):manager.get(body.owner,body.id);
      return reply(operation?200:404,{instanceId:config.instanceId,operation},true);
    }
    if(Object.keys(body).join(',')!=='epoch'||body.epoch!==epoch)throw Error('epoch-changed');
    if(setup.busy||setup.initializing||setup.admitting||setup.pending)throw Error('setup-busy');await manager.shutdown();stopping=true;reply(200,{instanceId:config.instanceId,stopping:true},true);setImmediate(()=>close());
  }catch(error){const status=['activation-busy','worker-jobs-outstanding','worker-maintenance-conflict','setup-busy','setup-terms-changed','setup-cancel-too-late'].includes(error.message)?409:['activation-package-unavailable','setup-unavailable','setup-hardware-unsupported'].includes(error.message)?403:error.message==='setup-journal-full'?429:401;reply(status,{instanceId:config.instanceId,error:status===401?'request-rejected':error.message},status!==401);}
});
server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=32;
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});
void (async()=>{await setup.recover();await manager.restore();setup.initializing=false;})().catch(()=>{manager.state='recovery-required';});
function close(){server.close(()=>{setup.close();db.close();process.exit(0);});server.closeIdleConnections();}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{try{if(setup.busy||setup.initializing||setup.admitting||setup.pending)return;await manager.shutdown();close();}catch{/* Retain owned native work; no global process interruption. */}});
