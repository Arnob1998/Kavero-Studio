// Operator-only Windows build. No signing private key or runtime config is
// accepted by the resulting app; the publisher public root is compiled in.
import {createPublicKey} from 'node:crypto';
import {mkdtempSync,existsSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {verifyPackage,hash} from '../package/manifest.mjs';
import {HOST_RUNTIME} from '../../host/runtime.mjs';
const source=path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP_SOURCES=['TrustedPackage.cs','Installation.cs','ControllerSession.cs','CompanionForm.cs','Program.cs'];
export function publisherSource({keyId,publicKey,channel,origin}){
 const pub=createPublicKey(publicKey),jwk=pub.export({format:'jwk'});
 if(pub.asymmetricKeyType!=='rsa'||pub.asymmetricKeyDetails.modulusLength<3072||pub.asymmetricKeyDetails.modulusLength>4096||hash(pub.export({type:'spki',format:'der'}))!==keyId||!['developer','release'].includes(channel))throw Error('connect-desktop-publisher-invalid');
 const literal=JSON.stringify;
 return `namespace Kavero.Connect { internal static class Publisher {
 internal const string KeyId=${literal(keyId)},Modulus=${literal(jwk.n)},Exponent=${literal(jwk.e)},Channel=${literal(channel)},Origin=${literal(origin)},Pem=${literal(pub.export({type:'spki',format:'pem'}))};
 internal const long NodeBytes=${HOST_RUNTIME.artifacts[0].bytes},NoticeBytes=${HOST_RUNTIME.artifacts[1].bytes};
 internal const string NodeHash=${literal(HOST_RUNTIME.artifacts[0].sha256)},NoticeHash=${literal(HOST_RUNTIME.artifacts[1].sha256)};
 }}\n`;
}
export function compiler(){
 if(process.platform!=='win32'||process.arch!=='x64'||!process.env.SystemRoot||!path.isAbsolute(process.env.SystemRoot))throw Error('connect-desktop-build-platform');
 const file=path.join(process.env.SystemRoot,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');if(!existsSync(file))throw Error('connect-desktop-compiler-unavailable');return file;
}
export function compile({destination,sources,resources=[]}){
 if(!path.isAbsolute(destination)||existsSync(destination))throw Error('connect-desktop-build-destination');
 execFileSync(compiler(),['/nologo','/target:winexe','/platform:x64','/optimize+',`/win32manifest:${path.join(source,'app.manifest')}`,'/reference:System.Windows.Forms.dll','/reference:System.Drawing.dll','/reference:System.Web.Extensions.dll','/reference:System.IO.Compression.dll','/reference:System.IO.Compression.FileSystem.dll',`/out:${destination}`,...resources.map(r=>`/resource:${r.path},${r.name}`),...sources],{windowsHide:true,timeout:60000,maxBuffer:32768,encoding:'utf8'});
}
export async function buildInstaller({packageRoot,destination,trust,channel='release',origin}){
 if(!path.isAbsolute(destination)||existsSync(destination))throw Error('connect-desktop-build-destination');
 const release=await verifyPackage(packageRoot,trust,{channel,origin});
 if(!release.files.some(f=>f.path==='scripts/local-generation/connect/package/installed.mjs'))throw Error('connect-desktop-installed-entry-missing');
 if(!release.files.some(f=>f.path==='scripts/local-generation/connect/package/controller.mjs'))throw Error('connect-desktop-controller-entry-missing');
 const keyId=JSON.parse(readFileSync(path.join(packageRoot,'release.json'),'utf8')).keyId,key=trust.find(k=>k.channel===channel&&k.id===keyId);
 const work=mkdtempSync(path.join(tmpdir(),'kavero-desktop-build-')),generated=path.join(work,'Publisher.cs'),zip=path.join(work,'payload.zip'),pack=path.join(work,'Pack.exe');
 writeFileSync(generated,publisherSource({keyId:key.id,publicKey:key.publicKey,channel,origin:release.origin}),{flag:'wx'});
 compile({destination:pack,sources:[path.join(source,'Pack.cs')]});execFileSync(pack,[packageRoot,zip],{windowsHide:true,timeout:60000,maxBuffer:4096});
 // Detect source changes during packing before publishing an executable.
 const after=await verifyPackage(packageRoot,trust,{channel,origin:release.origin});if(JSON.stringify(after)!==JSON.stringify(release))throw Error('connect-desktop-build-changed');
 compile({destination,sources:[generated,...DESKTOP_SOURCES.map(f=>path.join(source,f))],resources:[{path:zip,name:'KaveroPayload.zip'}]});
 execFileSync(destination,['--check-bundle'],{windowsHide:true,timeout:60000,maxBuffer:4096});
 return {version:release.version,channel,origin:release.origin,files:release.files.length,work,publicRelease:false};
}
