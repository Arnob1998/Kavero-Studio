// Trusted desktop child: one private stdio channel, fixed commands, no listener.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createReadStream} from 'node:fs';
import {verifyPackage} from './manifest.mjs';
import {openInstalledState} from './installation.mjs';
import {DesktopController} from '../controller.mjs';
import {ConnectClient} from '../client.mjs';
import {CredentialStore} from '../credentials.mjs';
import {DeliveryClient} from '../delivery.mjs';
import {SetupClient} from '../setup.mjs';
import {ExecutionJournal,NativeAdapter,NativeExecutor,ExecutionRunner} from '../native.mjs';
import {ResultTransfer} from '../results.mjs';
import {noticesForSetup} from '../approval.mjs';
import {prepareManagedHost} from '../../host/bootstrap.mjs';
import {acquireHostMutex} from '../../host/mutex.mjs';
import {hostControl} from '../../host/control.mjs';
import {HOST_RUNTIME} from '../../host/runtime.mjs';
export async function installedController(input){
 if(process.platform!=='win32'||process.arch!=='x64'||process.versions.node!=='24.11.1')throw Error('connect-package-runtime-unsupported');
 if(!input||Object.keys(input).sort().join(',')!=='channel,config,localAppData,trust')throw Error('connect-installed-input-invalid');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..'),release=await verifyPackage(root,input.trust,{channel:input.channel});
 const {layout,files}=openInstalledState(input.localAppData,input.config,release);
 const originDir=path.relative(layout.root,layout.originRoot).split(path.sep).join('/');files.directory(originDir);
 const stateFile=originDir+'/desktop.json',credentialFile=originDir+'/identity.dpapi';
 const store=new CredentialStore(files.resolve(credentialFile));
 const checkedStore={load(){files.resolve(credentialFile);return store.load();},save(value){files.resolve(credentialFile);store.save(value);files.resolve(credentialFile);}};
 const client=new ConnectClient({origin:input.config.origin,allowLoopback:input.channel==='developer',store:checkedStore});
 const delivery=new DeliveryClient(client,{execution:true});
 const executionLock=await acquireHostMutex(path.join(layout.hostRoot,'connect-execution'));
 let released=false;
 let controller;try{controller=new DesktopController({client,delivery,setupTransport:new SetupClient(client),state:files.exists(stateFile)?JSON.parse(files.read(stateFile)):null,save:value=>files.atomicJSON(stateFile,value),
  openNative:async owner=>{
   // Copy the signed bundled runtime through the existing checksum installer,
   // rather than fetching Node a second time or finding a system installation.
   const transport=async(url,{headers})=>{
    const artifact=HOST_RUNTIME.artifacts.find(a=>a.url===url.href);if(!artifact||headers.range)throw Error('connect-runtime-source-invalid');
    return {status:200,headers:{'content-length':String(artifact.bytes)},body:createReadStream(path.join(root,artifact.destination)),dispose(){this.body.destroy();}};
   };
   const host=await prepareManagedHost({cwd:root,root:layout.hostRoot,userSelectedModels:true,dependencies:{transport}});
   let journal;
   try{
    files.resolve(originDir+'/execution.sqlite');journal=new ExecutionJournal(layout.journal);
    const adapter=new NativeAdapter(path.join(layout.hostRoot,'agent-config.json')),executor=new NativeExecutor({owner,adapter,journal});
    const run=(route,body)=>hostControl(adapter.config,route,{owner,...body});
    return {adapter,executor,runner:new ExecutionRunner({delivery,executor}),transfer:new ResultTransfer({client,adapter,journal,owner}),
     assert(){executionLock.assert();host.assert();},
     async setup(profile){return (await run('/host/setup',{profile})).setup;},
     async setupReceipt(key){return (await run('/host/setup/receipt',{key})).operation;},
     notices(setup,profile){return noticesForSetup(setup,profile).bundledFiles.filter(f=>f.role==='notice').map(f=>({name:f.path,text:Buffer.from(f.dataBase64,'base64').toString('utf8')}));},
     install(s){return run('/host/setup/install',{key:s.key,manifest:s.manifest,termsDigest:s.termsDigest,purpose:s.purpose,consentToken:s.consentToken,accepted:true});},
     cancelSetup(id){return run('/host/setup/cancel',{id});},
     pending(){return journal.outstanding().length>0||!!journal.db.prepare("select 1 from execution where owner=? and state='generated-unvalidated' and transferred=0 limit 1").get(owner);},
     async close(){try{await host.close();}finally{journal.close();}},
     async abandon(){try{await host.close();}catch{/* Original ledger/host retained when shutdown is unsafe. */}finally{journal.close();}},
    };
   }catch(error){journal?.close();try{await host.close();}catch{}throw error;}
  }});}catch(error){await executionLock.release();throw error;}
 controller.release=async()=>{if(!released){released=true;await executionLock.release();}};return controller;
}
export async function serveDesktop({input,output,create=installedController}){
 let controller,buffer=Buffer.alloc(0),timer,ticking=false,ended=false;
 const send=value=>{const line=JSON.stringify(value);if(Buffer.byteLength(line)>1024*1024)throw Error('connect-ipc-output-limit');if(!ended)output.write(line+'\n');};
 const onEnd=()=>{ended=true;if(controller){controller.parentLost=true;controller.pause();}};input.once('end',onEnd);
 try{
  for await(const chunk of input){
   buffer=Buffer.concat([buffer,Buffer.from(chunk)]);if(buffer.length>32768)throw Error('connect-ipc-input-limit');
   let at;while((at=buffer.indexOf(10))>=0){
    const line=buffer.subarray(0,at);buffer=buffer.subarray(at+1);const request=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(line));
    if(!controller){controller=await create(request);send({id:0,ok:true,value:controller.view()});timer=setInterval(()=>{if(ticking||controller.closed)return;ticking=true;controller.serial(()=>controller.tick()).catch(()=>{}).finally(()=>{ticking=false;});},5000);continue;}
    if(!request||Object.keys(request).sort().join(',')!=='id,input'||!Number.isSafeInteger(request.id)||request.id<1)throw Error('connect-ipc-request-invalid');
    try{const value=await controller.command(request.input);send({id:request.id,ok:true,value});}
    catch(error){send({id:request.id,ok:false,error:safeControllerError(error)});}
    if(controller.closed)return;
   }
  }
  if(buffer.length)throw Error('connect-ipc-incomplete');
 }finally{clearInterval(timer);input.removeListener('end',onEnd);if(controller){if(!controller.closed)await controller.lostParent();await controller.release?.();}}
}
export function safeControllerError(error){
 if(error.message==='connect-revoke-first')return error.message;
 const known=['connect-code-invalid','connect-already-paired','connect-not-paired','connect-request-rejected','connect-authorization-failed','connect-local-owner-approval-required','connect-approved-owner-mismatch','connect-approval-stale','connect-model-changed','connect-model-not-ready','connect-model-switch-unavailable','connect-drain-pending','connect-setup-busy','connect-setup-unavailable','connect-setup-invalid','connect-recovery-required','connect-profile-unsupported','connect-command-invalid','connect-runtime-source-invalid','connect-disconnect-first','connect-pause-first','host-response-invalid','host-already-running'];
 return known.includes(error.message)?error.message:'connect-operation-failed';
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)process.exitCode=1;
 else serveDesktop({input:process.stdin,output:process.stdout}).catch(()=>{process.stderr.write('connect-desktop-controller-failed\n');process.exitCode=1;});
}
