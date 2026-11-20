// Only the trusted desktop launcher invokes this bounded one-shot entrypoint.
// It never starts a host, pairs an account, downloads a model or runs inference.
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {diagnose} from './diagnose.mjs';
import {openInstalledState} from './installation.mjs';
import {verifyPackage} from './manifest.mjs';
export async function installedDiagnostic(input){
 if(!input||Object.keys(input).sort().join(',')!=='channel,config,localAppData,trust')throw Error('connect-installed-input-invalid');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../..');
 const release=await verifyPackage(root,input.trust,{channel:input.channel});
 const system=process.env.SystemRoot;if(!system||!path.isAbsolute(system))throw Error('connect-installed-system-unavailable');
 const protect=directory=>{
  const account=execFileSync(path.join(system,'System32/whoami.exe'),[],{encoding:'utf8',windowsHide:true}).trim();
  execFileSync(path.join(system,'System32/icacls.exe'),[directory,'/inheritance:r','/grant:r',`${account}:(OI)(CI)F`],{stdio:'ignore',windowsHide:true});
 };
 openInstalledState(input.localAppData,input.config,release,{protect});
 return {...await diagnose({...input,root}),installed:true};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==2)throw Error('connect-installed-usage');let bytes=0;const chunks=[];for await(const chunk of process.stdin){bytes+=chunk.length;if(bytes>16384)throw Error('connect-installed-input-limit');chunks.push(chunk);}console.log(JSON.stringify(await installedDiagnostic(JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.concat(chunks))))));}
 catch{console.error('connect-installed-diagnostic-failed');process.exitCode=1;}
}
