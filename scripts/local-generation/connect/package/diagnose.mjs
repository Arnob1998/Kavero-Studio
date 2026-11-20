// Private staging diagnostic, NOT a trusted installer/bootstrap. KC-5B must
// verify publisher signature + bytes before executing any staged code/runtime.
import {readFileSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {verifyPackage,hash} from './manifest.mjs';
import {installationConfiguration,installedPaths} from './installation.mjs';
import {packageWorker} from '../../host/bundle.mjs';
import {prepareManagedHost} from '../../host/bootstrap.mjs';
import {ConnectClient} from '../client.mjs';
import {CredentialStore} from '../credentials.mjs';
import {DeliveryClient} from '../delivery.mjs';
import {NativeAdapter,NativeExecutor,ExecutionJournal,ExecutionRunner} from '../native.mjs';
import {ResultTransfer} from '../results.mjs';
import {noticesForSetup} from '../approval.mjs';
import {SetupClient,RemoteSetup} from '../setup.mjs';
function readJSON(file){if(!path.isAbsolute(file)||lstatSync(file).size>16384)throw Error('connect-diagnostic-config-invalid');return JSON.parse(readFileSync(file,'utf8'));}
export async function diagnose({root,trust,config,channel,localAppData}){
 if(process.platform!=='win32'||process.arch!=='x64'||process.versions.node!=='24.11.1')throw Error('connect-package-runtime-unsupported');
 const release=await verifyPackage(root,trust,{channel});installationConfiguration(config,release);const layout=installedPaths(localAppData,config);
 const database=new DatabaseSync(':memory:');try{database.exec('create table smoke(id integer);insert into smoke values(1)');if(database.prepare('select id from smoke').get().id!==1)throw Error('connect-package-sqlite-unavailable');}finally{database.close();}
 // Exercise the original worker source/data bundle without writes or execution.
 const memory=new Map(),files={directory:()=>{},exists:name=>memory.has(name),read:name=>memory.get(name),write:(name,bytes)=>memory.set(name,Buffer.from(bytes)),resolve:name=>name,listTree:prefix=>[...memory.keys()].filter(n=>n.startsWith(prefix+'/')).map(n=>n.slice(prefix.length+1))};
 const bundle=packageWorker(files);
 const readOnlyImports=[prepareManagedHost,ConnectClient,CredentialStore,DeliveryClient,SetupClient,RemoteSetup,NativeAdapter,NativeExecutor,ExecutionJournal,ExecutionRunner,ResultTransfer,noticesForSetup];if(readOnlyImports.some(v=>typeof v!=='function'))throw Error('connect-package-import-unavailable');
 return {schema:1,version:release.version,channel:release.channel,protocol:release.protocol,files:release.files.length,payloadBytes:release.files.reduce((n,f)=>n+f.bytes,0),workerFingerprint:bundle.fingerprint,installedIdentity:hash(layout.root.toLowerCase()),sqlite:true,imports:true,hostStarted:false,modelDownloads:0,inference:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==6)throw Error('connect-diagnostic-usage');const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');console.log(JSON.stringify(await diagnose({root,trust:readJSON(process.argv[2]),config:readJSON(process.argv[3]),channel:process.argv[4],localAppData:process.argv[5]})));}
 catch(error){console.error(error.message?.startsWith('connect-')?error.message:'connect-package-diagnostic-failed');process.exitCode=1;}
}
