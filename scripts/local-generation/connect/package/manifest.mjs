import {createHash,createPublicKey,sign,verify,constants} from 'node:crypto';
import {createReadStream,lstatSync,readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {canonical,relativePath} from '../../install/manifest.mjs';
import {HOST_RUNTIME} from '../../host/runtime.mjs';
import {connectOrigin} from '../../../../src/modules/model-providers/local/connect/protocol.ts';

export const RELEASE_FILE='release.json';
const fail=()=>{throw Error('connect-package-invalid');};
const keys=(v,names)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...names].sort().join(',');
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const releaseKeyId=key=>hash(createPublicKey(key).export({type:'spki',format:'der'}));
const message=payload=>Buffer.from('kavero-connect-release-v1\n'+canonical(payload));
const rsaKey=key=>key.asymmetricKeyType==='rsa'&&key.asymmetricKeyDetails.modulusLength>=3072&&key.asymmetricKeyDetails.modulusLength<=4096;
export function validateRelease(p){
 if(!keys(p,['schema','product','version','protocol','minimumLauncher','platform','arch','channel','origin','files'])||p.schema!==1||p.product!=='kavero-connect'||p.protocol!==1||p.minimumLauncher!==1||p.platform!=='win32'||p.arch!=='x64'||!['developer','release'].includes(p.channel)||typeof p.version!=='string'||p.version.length>32||!/^\d{1,5}\.\d{1,5}\.\d{1,5}(?:-(?:dev|rc)\.\d{1,5})?$/.test(p.version))fail();
 if(connectOrigin(p.origin,p.channel==='developer')!==p.origin)fail();
 if(!Array.isArray(p.files)||p.files.length<4||p.files.length>256)fail();
 let total=0,previous='';
 for(const f of p.files){
  if(!keys(f,['path','bytes','sha256'])||!Number.isSafeInteger(f.bytes)||f.bytes<1||f.bytes>96*1024**2||!/^[a-f0-9]{64}$/.test(f.sha256))fail();
  relativePath(f.path);if(f.path.toLowerCase()<=previous||f.path===RELEASE_FILE||/(?:^|\/)(?:node_modules|\.env[^/]*|cleanup-results\.mjs)(?:\/|$)|\.(?:test\.[^/]+|gguf|safetensors|sqlite|pem|key|dpapi)$/i.test(f.path))fail();previous=f.path.toLowerCase();total+=f.bytes;
 }
 if(total>128*1024**2)fail();
 for(const artifact of HOST_RUNTIME.artifacts){const entry=p.files.find(f=>f.path===artifact.destination);if(!entry||entry.bytes!==artifact.bytes||entry.sha256!==artifact.sha256)fail();}
 for(const name of ['LICENSE','scripts/local-generation/connect/package/diagnose.mjs'])if(!p.files.some(f=>f.path===name))fail();
 return p;
}
export function signRelease(payload,privateKey){
 validateRelease(payload);if(privateKey.type!=='private'||!rsaKey(privateKey))throw Error('connect-package-signing-key-invalid');
 return {payload:Buffer.from(canonical(payload)).toString('base64url'),keyId:releaseKeyId(privateKey),signature:sign('sha256',message(payload),{key:privateKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64url')};
}
// Trust is supplied by the installer/build operator OUTSIDE the package. Never
// promote an embedded public key or a device identity to publisher authority.
export function verifyEnvelope(envelope,trust,{channel='release',origin}={}){
 if(!keys(envelope,['payload','keyId','signature'])||!/^[a-f0-9]{64}$/.test(envelope.keyId)||typeof envelope.payload!=='string'||envelope.payload.length>60000||!/^[A-Za-z0-9_-]{512,683}$/.test(envelope.signature))fail();
 const bytes=Buffer.from(envelope.payload,'base64url');if(bytes.toString('base64url')!==envelope.payload)fail();const p=validateRelease(JSON.parse(bytes.toString('utf8')));if(canonical(p)!==bytes.toString('utf8'))fail();const key=trust.find(k=>k.id===envelope.keyId&&k.channel===channel);
 if(p.channel!==channel||origin&&p.origin!==origin||!key)throw Error('connect-package-untrusted');
 const pub=createPublicKey(key.publicKey);if(!rsaKey(pub)||hash(pub.export({type:'spki',format:'der'}))!==key.id||!verify('sha256',message(p),{key:pub,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32},Buffer.from(envelope.signature,'base64url')))throw Error('connect-package-signature-invalid');return p;
}
export function safeFile(root,relative){
 relativePath(relative);const absolute=path.resolve(root);let cursor=absolute;
 while(true){const info=lstatSync(cursor);if(!info.isDirectory()||info.isSymbolicLink())throw Error('connect-package-link');const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
 cursor=absolute;const parts=relative.split('/');for(const [index,part] of parts.entries()){cursor=path.join(cursor,part);const info=lstatSync(cursor);if(info.isSymbolicLink()||(index<parts.length-1?!info.isDirectory():!info.isFile()||info.nlink!==1))throw Error('connect-package-link');}return cursor;
}
export async function fileIdentity(root,name){const file=safeFile(root,name),before=lstatSync(file),h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);const after=lstatSync(safeFile(root,name));if(before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw Error('connect-package-changed');return {path:name,bytes:after.size,sha256:h.digest('hex')};}
export async function verifyPackage(root,trust,options){
 const file=safeFile(root,RELEASE_FILE);if(lstatSync(file).size>65536)fail();const payload=verifyEnvelope(JSON.parse(readFileSync(file,'utf8')),trust,options);
 const expected=new Set([...payload.files.map(f=>f.path),RELEASE_FILE]),found=[];let count=0;
 const walk=(dir='',depth=0)=>{if(depth>20)fail();for(const name of readdirSync(path.join(root,dir))){if(++count>1024)fail();const rel=dir?dir+'/'+name:name;relativePath(rel);const info=lstatSync(path.join(root,rel));if(info.isSymbolicLink())throw Error('connect-package-link');if(info.isDirectory()){if(![...expected].some(f=>f.startsWith(rel+'/')))throw Error('connect-package-extra-file');walk(rel,depth+1);}else{safeFile(root,rel);found.push(rel);}}};walk();
 if(found.length!==expected.size||found.some(f=>!expected.has(f)))throw Error('connect-package-extra-file');
 for(const f of payload.files){const actual=await fileIdentity(root,f.path);if(actual.bytes!==f.bytes||actual.sha256!==f.sha256)throw Error('connect-package-content-changed');}return payload;
}
