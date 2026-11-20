// @vitest-environment node
import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {generateKeyPairSync,constants,sign} from 'node:crypto';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';import path from 'node:path';
import {compile,publisherSource,DESKTOP_SOURCES} from './build.mjs';
import {releaseKeyId} from '../package/manifest.mjs';
import {HOST_RUNTIME} from '../../host/runtime.mjs';
import {canonical} from '../../install/manifest.mjs';
describe.skipIf(process.platform!=='win32'||process.arch!=='x64')('native pre-execution publisher verifier',()=>{
 let root,exe,privateKey,publicKey,id;
 const payload=()=>({schema:1,product:'kavero-connect',version:'0.1.0-dev.2',protocol:1,minimumLauncher:1,platform:'win32',arch:'x64',channel:'developer',origin:'http://127.0.0.1:3051',files:[...HOST_RUNTIME.artifacts.map(f=>({path:f.destination,bytes:f.bytes,sha256:f.sha256})),...['LICENSE','scripts/local-generation/connect/package/diagnose.mjs','scripts/local-generation/connect/package/installed.mjs'].map(path=>({path,bytes:1,sha256:'a'.repeat(64)}))].sort((a,b)=>a.path.toLowerCase()<b.path.toLowerCase()?-1:1)});
 const envelope=p=>{const bytes=Buffer.from(canonical(p));return {keyId:id,payload:bytes.toString('base64url'),signature:sign('sha256',Buffer.concat([Buffer.from('kavero-connect-release-v1\n'),bytes]),{key:privateKey,padding:constants.RSA_PKCS1_PSS_PADDING,saltLength:32}).toString('base64url')};};
 const check=value=>{const file=path.join(root,'manifest.json');writeFileSync(file,typeof value==='string'?value:canonical(value));return spawnSync(exe,['envelope',file],{windowsHide:true,encoding:'utf8',timeout:10000});};
 beforeAll(()=>{root=mkdtempSync(path.join(tmpdir(),'kc-desktop-unit-'));({privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:3072}));id=releaseKeyId(privateKey);const generated=path.join(root,'Publisher.cs');writeFileSync(generated,publisherSource({keyId:id,publicKey:publicKey.export({type:'spki',format:'pem'}),channel:'developer',origin:payload().origin}));exe=path.join(root,'Verifier.exe');compile({destination:exe,sources:[generated,path.resolve('scripts/local-generation/connect/desktop/TrustedPackage.cs'),path.resolve('scripts/local-generation/connect/desktop/VerifierHarness.cs')]});},30000);
 afterAll(()=>{if(root){if(!path.resolve(root).startsWith(path.resolve(tmpdir())+path.sep)||!path.basename(root).startsWith('kc-desktop-unit-'))throw Error('unsafe-test-cleanup');rmSync(root,{recursive:true,force:true});}});
 it('verifies Node canonical RSA-PSS metadata using the externally compiled root',()=>expect(check(envelope(payload())).status).toBe(0));
 it.each([{schema:2},{product:'other'},{version:'../bad'},{minimumLauncher:2},{protocol:2},{platform:'linux'},{arch:'arm64'},{channel:'release'},{origin:'https://elsewhere.test'},{unknown:true}])('rejects signed incompatible metadata %j',changes=>expect(check(envelope({...payload(),...changes})).status).toBe(2));
 it.each(['../outside','CON.txt','a\\b','a//b','.env.local','models/a.gguf','node_modules/a.js','scripts/cleanup-results.mjs'])('rejects signed unsafe/private path %s',name=>{const p=payload();p.files.push({path:name,bytes:1,sha256:'a'.repeat(64)});p.files.sort((a,b)=>a.path.toLowerCase()<b.path.toLowerCase()?-1:1);expect(check(envelope(p)).status).toBe(2);});
 it('rejects changed signature and untrusted key identifiers',()=>{const s=envelope(payload());expect(check({...s,signature:'a'.repeat(512)}).status).toBe(2);expect(check({...s,keyId:'b'.repeat(64)}).status).toBe(2);});
 it('rejects altered runtime pin even when signed',()=>{const p=payload();p.files.find(f=>f.path==='runtime/node.exe').sha256='a'.repeat(64);expect(check(envelope(p)).status).toBe(2);});
 it('rejects noncanonical/duplicate JSON envelope fields',()=>{const s=envelope(payload());expect(check(JSON.stringify(s,null,2)).status).toBe(2);expect(check(canonical(s).replace('{','{"keyId":"wrong",')).status).toBe(2);});
 it('rejects noncanonical payload, duplicate destinations and oversized manifest',()=>{const p=payload(),s=envelope(p);expect(check({...s,payload:Buffer.from(JSON.stringify(p,null,2)).toString('base64url')}).status).toBe(2);p.files.push({...p.files[0]});expect(check(envelope(p)).status).toBe(2);expect(check(' '.repeat(65537)).status).toBe(2);});
 it('excludes build and verification test harness from the shipped shell',()=>{expect(DESKTOP_SOURCES).toEqual(['TrustedPackage.cs','Installation.cs','ControllerSession.cs','CompanionForm.cs','Program.cs']);expect(DESKTOP_SOURCES).not.toContain('VerifierHarness.cs');});
});
