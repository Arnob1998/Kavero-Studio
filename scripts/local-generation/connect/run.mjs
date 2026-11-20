#!/usr/bin/env node
// Private development entrypoint; normal installer/UI are KC-4/KC-5.
import path from 'node:path';
import {mkdirSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {hostRoot} from '../host/bootstrap.mjs';
import {acquireHostMutex} from '../host/mutex.mjs';
import {CredentialStore} from './credentials.mjs';
import {ConnectClient,monitorDelay} from './client.mjs';
import {DeliveryClient} from './delivery.mjs';
import {NativeAdapter,NativeExecutor,ExecutionJournal,ExecutionRunner} from './native.mjs';
import {digest,connectOrigin} from '../../../src/modules/model-providers/local/connect/protocol.ts';
import {hostControl} from '../host/control.mjs';
import {noticesForSetup} from './approval.mjs';
import {ResultTransfer} from './results.mjs';
async function main(){
 if(process.platform!=='win32'||process.arch!=='x64'||process.versions.node!=='24.11.1')throw Error('connect-execution-requires-pinned-windows-runtime');
 const command=process.argv[2];if(!['approve','setup','once','run','transfer'].includes(command))throw Error('connect-usage-approve-setup-once-run-transfer');
 const origin=connectOrigin(process.env.KAVERO_CONNECT_ORIGIN??'',process.env.KAVERO_CONNECT_ALLOW_LOOPBACK==='1'&&process.env.NODE_ENV!=='production');
 if(!process.env.APPDATA)throw Error('connect-appdata-unavailable');
 const root=path.join(process.env.APPDATA,'Kavero','Connect',digest(origin));mkdirSync(root,{recursive:true});
 // Across origins and processes: all Connect execution shares this host and worker.
 const localRoot=hostRoot(),lock=await acquireHostMutex(path.join(localRoot,'connect-execution'));
 let journal;
 try{
  const client=new ConnectClient({origin,allowLoopback:process.env.KAVERO_CONNECT_ALLOW_LOOPBACK==='1'&&process.env.NODE_ENV!=='production',store:new CredentialStore(path.join(root,'identity.dpapi'))});
  const delivery=new DeliveryClient(client,{execution:true});
  if(command==='approve'){
   const response=await delivery.poll(null),io=createInterface({input:stdin,output:stdout});
   try{console.log(`Allow this paired account ${response.ownerId} at ${origin} to use this computer? Model permission remains separate.`);
    if(await io.question('Type ALLOW: ')==='ALLOW'){client.identity.approvedOwner=response.ownerId;client.identity.approvedDeviceId=client.identity.deviceId;client.persist();}
   }finally{io.close();}return;
  }
  const owner=client.identity?.approvedOwner;if(!owner||client.identity.approvedDeviceId!==client.identity.deviceId)throw Error('connect-local-owner-approval-required');
  const identity=await delivery.poll(null);if(identity.ownerId!==owner)throw Error('connect-approved-owner-mismatch');
  const adapter=new NativeAdapter(path.join(localRoot,'agent-config.json'));
  if(command==='setup'){
   const profile=process.argv[3]??'qwen-image-2.1-q4-evaluation';
   if(!['qwen-image-2.1-q4-evaluation','qwen-image-2.1-q3-evaluation'].includes(profile))throw Error('connect-profile-unsupported');
   const {setup}=await hostControl(adapter.config,'/host/setup',{owner,profile});
   const manifest=noticesForSetup(setup,profile);
   console.log(`Owner ${owner}; ${profile}; purpose ${setup.purpose}; manifest ${setup.manifest}; terms ${setup.termsDigest}`);
   for(const file of manifest.bundledFiles.filter(f=>f.role==='notice'))console.log(Buffer.from(file.dataBase64,'base64').toString('utf8'));
   const io=createInterface({input:stdin,output:stdout});
   try{if(await io.question('To accept these model/component terms for research/evaluation and start managed setup, type ACCEPT RESEARCH TERMS: ')!=='ACCEPT RESEARCH TERMS')return;}
   finally{io.close();}
   const result=await hostControl(adapter.config,'/host/setup/install',{owner,key:crypto.randomUUID(),manifest:setup.manifest,termsDigest:setup.termsDigest,purpose:setup.purpose,consentToken:setup.consentToken,accepted:true});
   console.log(JSON.stringify({operation:result.operation?.id,state:result.operation?.state}));return;
  }
  journal=new ExecutionJournal(path.join(root,'execution.sqlite'));
  const transfer=new ResultTransfer({client,adapter,journal,owner});
  if(command==='transfer'){console.log(JSON.stringify({result:await transfer.tick(),saved:await transfer.acknowledge()}));return;}
  const executor=new NativeExecutor({owner,adapter,journal}),runner=new ExecutionRunner({delivery,executor});
  let stopped=false,failures=0,timer,wake;
  const stop=()=>{stopped=true;clearTimeout(timer);wake?.();};process.once('SIGINT',stop);process.once('SIGTERM',stop);
  do{
   let reply;
   try{lock.assert();reply=await runner.tick();if(process.env.KAVERO_CONNECT_TRANSFER_RESULTS==='1'){await transfer.tick();await transfer.acknowledge();}failures=0;console.log(JSON.stringify({job:reply.job?.id??null,state:reply.job?.state??'idle',reason:reply.job?.failureCode??null}));}
   catch(error){if(['host-lock-lost','connect-approved-owner-mismatch'].includes(error.message))throw error;failures++;console.error(error.status===401?'connect-authorization-failed':error.status===429?'connect-rate-limited':'connect-execution-retrying');}
   if(command==='once'||stopped)break;
   const delay=failures?monitorDelay(failures):reply?.job?5000:monitorDelay(0);
   await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,delay);});wake=null;
  }while(!stopped);
 }finally{journal?.close();await lock.release();}
}
main().catch(error=>{console.error(String(error.message).startsWith('connect-')?error.message:'connect-execution-failed');process.exitCode=1;});
