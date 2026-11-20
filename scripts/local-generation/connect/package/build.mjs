// Build operator only; deliberately excluded from staged companion packages.
import {copyFileSync,mkdirSync,existsSync,constants} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {writeFileSync} from 'node:fs';
import {WORKER_SOURCES} from '../../host/bundle.mjs';
import {HOST_RUNTIME} from '../../host/runtime.mjs';
import {canonical} from '../../install/manifest.mjs';
import {fileIdentity,safeFile,signRelease,verifyPackage,releaseKeyId} from './manifest.mjs';
export const COMPANION_SOURCES=[...new Set([...WORKER_SOURCES,
 'LICENSE','scripts/local-generation/host/bootstrap.mjs','scripts/local-generation/host/bundle.mjs','scripts/local-generation/host/runtime.mjs','scripts/local-generation/host/install-runtime.mjs','scripts/local-generation/host/mutex.mjs','scripts/local-generation/host/control.mjs',
 ...['client','credentials','delivery','native','results','approval','setup','cli','run','controller'].map(n=>`scripts/local-generation/connect/${n}.mjs`),
 'src/modules/model-providers/local/connect/protocol.ts','src/modules/model-providers/local/connect/result-protocol.ts',
 ...['manifest','installation','diagnose','installed','controller'].map(n=>`scripts/local-generation/connect/package/${n}.mjs`),
])].sort((a,b)=>a.toLowerCase()<b.toLowerCase()?-1:1);
export async function stageCompanion({destination,runtimeFile,runtimeNotice,version,origin,channel='developer',signingKey}){
 const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
 if(!path.isAbsolute(destination)||existsSync(destination))throw Error('connect-package-destination-exists');
 // Validate external runtime/notices before creating any artifact or executing it.
 for(const [index,input] of [runtimeFile,runtimeNotice].entries()){const f=await fileIdentity(path.dirname(input),path.basename(input)),pinned=HOST_RUNTIME.artifacts[index];if(f.sha256!==pinned.sha256||f.bytes!==pinned.bytes)throw Error('connect-package-runtime-changed');}
 mkdirSync(destination,{recursive:false});const entries=[];
 for(const name of COMPANION_SOURCES){const input=safeFile(sourceRoot,name),output=path.join(destination,name);mkdirSync(path.dirname(output),{recursive:true});copyFileSync(input,output,constants.COPYFILE_EXCL);entries.push(await fileIdentity(destination,name));}
 for(const [index,input] of [runtimeFile,runtimeNotice].entries()){const name=HOST_RUNTIME.artifacts[index].destination,output=path.join(destination,name);mkdirSync(path.dirname(output),{recursive:true});copyFileSync(input,output,constants.COPYFILE_EXCL);entries.push(await fileIdentity(destination,name));}
 entries.sort((a,b)=>a.path.toLowerCase()<b.path.toLowerCase()?-1:1);
 const payload={schema:1,product:'kavero-connect',version,protocol:1,minimumLauncher:1,platform:'win32',arch:'x64',channel,origin,files:entries};
 writeFileSync(path.join(destination,'release.json'),canonical(signRelease(payload,signingKey)),{flag:'wx'});
 const trust=[{id:releaseKeyId(signingKey),channel,publicKey:(await import('node:crypto')).createPublicKey(signingKey).export({type:'spki',format:'pem'})}];
 await verifyPackage(destination,trust,{channel,origin});return payload;
}
