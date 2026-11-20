// @vitest-environment node
import { describe,it,expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ConnectClient,monitorDelay } from './client.mjs';
import { deviceMessage,verifyConnect } from '../../../src/modules/model-providers/local/connect/protocol.ts';
import { CredentialStore,protectWindows } from './credentials.mjs';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const report={platform:'win32',arch:'x64',node:'24.11.1',ramMiB:16384,gpus:[]};
function fixture(){
 let saved=null,key=null,revoked=false,loseRotationAck=false;let device=randomUUID();const origin='https://kavero.example';const seen=new Set();
 const store={load:()=>saved?structuredClone(saved):null,save:value=>{saved=structuredClone(value);}};
 const fetchImpl=async(url,init)=>{
  const body=JSON.parse(init.body);let response;
  if(url.endsWith('/claim')){device=body.deviceId;key=body.publicKey;response={deviceId:device,pairingId:randomUUID(),fingerprint:(await import('../../../src/modules/model-providers/local/connect/protocol.ts')).digest(key)};}
  else{
   const h=init.headers,nonce=h['x-kavero-connect-nonce'];
   if(revoked||seen.has(nonce)||!verifyConnect(deviceMessage(origin,device,h['x-kavero-connect-time'],nonce,init.body),h['x-kavero-connect-signature'],key))return Response.json({error:'unauthorized'},{status:401});
   seen.add(nonce);if(body.action==='rotate'){key=body.publicKey;if(loseRotationAck){loseRotationAck=false;throw Error('lost-ack');}}
   if(body.action==='unpair')revoked=true;
   response={deviceId:device,origin,generationEnabled:false};
  }
  return Response.json({version:1,...response});
 };
 return {store,fetchImpl,origin,get device(){return device;},setLose:()=>{loseRotationAck=true;},saved:()=>saved};
}
describe('Connect development companion',()=>{
 it('keeps the candidate device identity across a lost claim acknowledgement',async()=>{
  const f=fixture(),client=new ConnectClient(f),actual=client.fetch;let drop=true;
  client.fetch=async(url,init)=>{const response=await actual(url,init);if(drop&&url.endsWith('/claim')){drop=false;throw Error('lost-claim-ack');}return response;};
  await expect(client.pair('a'.repeat(24))).rejects.toThrow('lost-claim-ack');
  const candidate=f.saved().deviceId;expect(candidate).toBeTruthy();
  const restarted=new ConnectClient(f);const claimed=await restarted.pair('a'.repeat(24));expect(claimed.deviceId).toBe(candidate);
 });
 it('persists a stable installation key and restricts credential origin',async()=>{
  const f=fixture(),client=new ConnectClient(f);await client.pair('a'.repeat(24));
  const first=f.saved();const next=new ConnectClient(f);expect(next.identity.installationId).toBe(first.installationId);
  expect(first).not.toHaveProperty('code');expect(JSON.stringify(first)).not.toContain('service_role');
  expect(()=>new ConnectClient({...f,origin:'https://other.example'})).toThrow('connect-origin-mismatch');
  expect((await next.status(report)).generationEnabled).toBe(false);
 });
 it('recovers a rotated key after lost acknowledgement and restart',async()=>{
  const f=fixture(),client=new ConnectClient(f);await client.pair('a'.repeat(24));const original=client.identity.publicKey;
  f.setLose();await expect(client.rotate(report)).rejects.toThrow('lost-ack');
  expect(f.saved().pendingKey).toBeTruthy();const restarted=new ConnectClient(f);
  await restarted.status(report);expect(restarted.identity.publicKey).not.toBe(original);expect(f.saved().pendingKey).toBeUndefined();
  await expect(client.action({action:'status',epoch:randomUUID(),report},client.identity.privateKey)).rejects.toMatchObject({status:401});
 });
 it('unpairs explicitly and refuses further authorization',async()=>{
  const f=fixture(),client=new ConnectClient(f);await client.pair('a'.repeat(24));await client.unpair();
  await expect(client.status(report)).rejects.toMatchObject({status:401});expect(f.saved().unpaired).toBe(true);
 });
 it('bounds response size and refuses server-provided generation enablement',async()=>{
  const f=fixture(),client=new ConnectClient(f);await client.pair('a'.repeat(24));
  client.fetch=async()=>new Response('x'.repeat(8193));await expect(client.status(report)).rejects.toThrow('connect-response-too-large');
  client.fetch=async()=>Response.json({version:1,deviceId:f.device,origin:f.origin,generationEnabled:true});await expect(client.status(report)).rejects.toThrow('connect-device-response-invalid');
 });
 it('uses bounded idle backoff with jitter',()=>{
  expect(monitorDelay(0,()=>0)).toBe(60000);expect(monitorDelay(1,()=>.5)).toBe(122500);
  expect(monitorDelay(20,()=>1)).toBe(900000);
 });
 it.skipIf(process.platform!=='win32')('encrypts private credentials with actual Windows CurrentUser DPAPI',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'kavero-connect-'));
  try{const store=new CredentialStore(path.join(root,'identity.dpapi'));const value={privateKey:'private-key-fixture',installationId:randomUUID()};store.save(value);
   expect(readFileSync(store.file).includes(Buffer.from(value.privateKey))).toBe(false);expect(store.load()).toEqual(value);
   expect(()=>protectWindows(Buffer.from('tampered'),true)).toThrow('connect-credential-protection-failed');
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
