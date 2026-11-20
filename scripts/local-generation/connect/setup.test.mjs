// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {RemoteSetup,SetupClient,validateSetupRequest,SETUP_PROFILES} from './setup.mjs';
import {DesktopController} from './controller.mjs';
import {canonicalSnapshot,jobSnapshotForProfile} from '../../../src/modules/model-providers/local/job-snapshot.ts';
import {digest} from '../../../src/modules/model-providers/local/connect/protocol.ts';
import {managedPackageDelivery} from '../host/model-package.mjs';
const clone=structuredClone;
function fixture({kind='install'}={}){
 const owner=randomUUID(),device=randomUUID(),installationId=randomUUID(),profile=SETUP_PROFILES[0];
 const client={origin:'https://setup.example',epoch:randomUUID(),identity:{deviceId:device,installationId,approvedOwner:owner,approvedDeviceId:device,publicKey:'fixture-key'}};
 const recipe=jobSnapshotForProfile(profile),manifest=managedPackageDelivery('qwen-2-1-internal-evaluation');
 const intent={setupProtocol:1,ownerId:owner,origin:client.origin,deviceId:device,installationId,keyVersion:1,profile,manifestHash:recipe.manifestHash,termsDigest:manifest.termsDigest,purpose:'research-evaluation',recipeHash:digest(canonicalSnapshot(recipe))};
 let request={id:randomUUID(),deviceId:device,key:randomUUID(),kind,intent,intentHash:digest(canonicalSnapshot(intent)),state:'delivered',cancelRequested:false,processedBytes:0,operationId:null,evidence:null,reason:null,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),version:1,ownerId:owner,session:client.epoch,token:randomUUID(),attempt:1,sequence:0,phase:0,leaseUntil:new Date(Date.now()+45000).toISOString(),reconcile:true};
 const writes=[],receipts=new Map();let saved=null;
 const transport={poll:vi.fn(async()=>clone(request)),checkpoint:vi.fn(async input=>{
  // Emulate only durable acknowledgement; real transition authority is covered by SQL proof.
  if(input.sequence>request.sequence){request={...request,state:input.state,sequence:input.sequence,version:request.version+1,processedBytes:input.processedBytes,operationId:input.operationId??request.operationId,evidence:input.evidence??request.evidence};
   request.phase=Math.max(request.phase,({approved:2,admitted:3,downloading:4,verifying:5,'activation-needed':6,ready:7})[input.state]??request.phase);
  }
  return clone(request);
 })};
 const setup={manifest:intent.manifestHash,termsDigest:intent.termsDigest,purpose:'research-evaluation',available:true,supported:true,switchRequired:false,ready:false,installed:false,compatibility:'eligible',freeBytes:9000000,requiredFreeBytes:8000000,hardware:{freeVramMiB:3000},consentToken:'local-only'};
 const native={setup:vi.fn(async()=>clone(setup)),setupReceipt:vi.fn(async key=>clone(receipts.get(key)??null)),pending:vi.fn(()=>false),
  install:vi.fn(async s=>{const op=receipts.get(s.key)??{id:randomUUID(),packageId:manifest.id,state:'downloading',processedBytes:10};receipts.set(s.key,op);return {operation:clone(op)};}),
  cancelSetup:vi.fn(async id=>{const op=[...receipts.values()].find(o=>o.id===id);op.state='cancelled';}),
  adapter:{readiness:vi.fn(async()=>({ready:{},binding:{profile,permission:true}}))},assert:vi.fn(),notices:vi.fn(()=>[{name:'pinned',text:'Complete fixture notice'}]),
  runner:{tick:vi.fn(async()=>({job:null}))},transfer:{tick:vi.fn(),acknowledge:vi.fn()},executor:{stopOwned:vi.fn()},abandon:vi.fn(),close:vi.fn()};
 const save=s=>{saved=clone(s);writes.push(clone(s));};
 let remote=new RemoteSetup({transport,client,save});
 const tick=()=>remote.tick(native),approve=()=>remote.approve(request.id,request.intentHash);
 return {client,transport,native,setup,receipts,writes,tick,approve,save,get request(){return request;},set request(r){request=r;},get remote(){return remote;},get saved(){return saved;},restart(){client.epoch=randomUUID();request={...request,session:client.epoch,token:randomUUID(),attempt:request.attempt+1,sequence:0};remote=new RemoteSetup({transport,client,state:saved,save});return remote;}};
}
async function admitted(f){await f.tick();f.approve();await f.tick();await f.tick();}
describe('Remote setup authority and consent',()=>{
 it('validates pinned identity, recipe and terms, rejecting arbitrary fields and mismatched authority',()=>{
  const f=fixture();expect(validateSetupRequest(f.request,f.client)).toEqual(f.request);
  for(const change of [{ownerId:randomUUID()},{deviceId:randomUUID()},{path:'C:/secret'},{intentHash:'a'.repeat(64)},{phase:8}])expect(()=>validateSetupRequest({...f.request,...change},f.client)).toThrow();
  for(const change of [{origin:'https://other.example'},{installationId:randomUUID()},{profile:'unverified'},{manifestHash:'b'.repeat(64)},{termsDigest:'b'.repeat(64)},{recipeHash:'b'.repeat(64)}]){
   const intent={...f.request.intent,...change};expect(()=>validateSetupRequest({...f.request,intent,intentHash:digest(canonicalSnapshot(intent))},f.client)).toThrow();
  }
 });
 it('never installs or asserts approval merely because the website delivered a request',async()=>{
  const f=fixture();await f.tick();await f.tick();expect(f.request.state).toBe('awaiting-approval');expect(f.native.install).not.toHaveBeenCalled();
  expect(f.transport.checkpoint.mock.calls.flat().some(c=>c.approval)).toBe(false);expect(f.remote.view().needsApproval).toBe(true);
 });
 it('sends only native allowlisted assessment fields, preserving unknown totals as null',async()=>{
  const f=fixture({kind:'assess'});f.setup.hardware.path='C:/private';await f.tick();expect(f.request.state).toBe('assessed');
  expect(f.request.evidence).toMatchObject({freeVramMiB:3000,totalVramMiB:null,totalRamBytes:null,freeDiskBytes:9000000});expect(JSON.stringify(f.transport.checkpoint.mock.calls)).not.toContain('C:/private');expect(f.native.install).not.toHaveBeenCalled();
 });
 it('persists consent and original key before native admission, and verifies final actual binding',async()=>{
  const f=fixture();f.native.install.mockImplementationOnce(async s=>{expect(f.saved.key).toBe(s.key);expect(f.saved.approved).toBe(true);const op={id:randomUUID(),packageId:managedPackageDelivery('qwen-2-1-internal-evaluation').id,state:'installed',processedBytes:20};f.receipts.set(s.key,op);return {operation:op};});
  await admitted(f);expect(f.request.state).toBe('admitted');f.setup.ready=true;await f.tick();expect(f.request.state).toBe('ready');expect(f.native.adapter.readiness).toHaveBeenCalledWith(f.request.ownerId);expect(f.native.install).toHaveBeenCalledOnce();
 });
 it('refuses switching and busy-worker admission',async()=>{
  const f=fixture();await f.tick();f.approve();await f.tick();f.native.pending.mockReturnValue(true);await f.tick();expect(f.native.install).not.toHaveBeenCalled();
  f.native.pending.mockReturnValue(false);f.setup.switchRequired=true;await f.tick();expect(f.request.state).toBe('rejected');expect(f.native.install).not.toHaveBeenCalled();
 });
 it('keeps already downloaded work at activation-needed without forcing a model switch',async()=>{
  const f=fixture();await admitted(f);f.setup.switchRequired=true;f.receipts.get(f.saved.key).state='activation-needed';
  await f.tick();await f.tick();await f.tick();expect(f.request.state).toBe('activation-needed');expect(f.native.install).toHaveBeenCalledOnce();expect(f.native.adapter.readiness).not.toHaveBeenCalled();
 });
 it('rejects model changes and identity rotation without granting fresh permission',async()=>{
  const f=fixture();await f.tick();f.approve();f.setup.manifest='d'.repeat(64);await expect(f.tick()).rejects.toThrow('model-changed');expect(f.native.install).not.toHaveBeenCalled();
  f.client.identity.publicKey='rotated';await expect(f.tick()).rejects.toThrow('approval-stale');
 });
 it('ignores default-off old servers while idle, but retains active work when setup is disabled',async()=>{
  const f=fixture();f.transport.poll.mockRejectedValueOnce(Object.assign(Error('disabled'),{status:404}));await f.tick();expect(f.remote.available).toBe(false);
  await f.tick();f.transport.poll.mockRejectedValueOnce(Object.assign(Error('disabled'),{status:404}));await expect(f.tick()).rejects.toMatchObject({status:404});expect(f.remote.active()).toBe(true);
 });
});
describe('Remote setup failure recovery and cancellation',()=>{
 it('recovers a lost native admission acknowledgement after restart using the exact original key',async()=>{
  const f=fixture();await f.tick();f.approve();await f.tick();const install=f.native.install.getMockImplementation();
  f.native.install.mockImplementationOnce(async s=>{await install(s);throw Error('lost-native-ack');});await expect(f.tick()).rejects.toThrow('lost-native-ack');
  const key=f.saved.key,operation=f.receipts.get(key).id;f.restart();await f.tick();expect(f.request.operationId).toBe(operation);expect(f.saved.key).toBe(key);expect(f.native.install).toHaveBeenCalledOnce();
 });
 it('restarts paused before admission and requires fresh explicit continuation if no native receipt exists',async()=>{
  const f=fixture();await f.tick();f.approve();await f.tick();f.restart();await f.tick();expect(f.native.install).not.toHaveBeenCalled();expect(f.remote.view().needsApproval).toBe(true);
  f.approve();await f.tick();expect(f.native.install).toHaveBeenCalledOnce();
 });
 it('retries the identical checkpoint after a lost acknowledgement, without repeating installation',async()=>{
  const f=fixture();await admitted(f);const real=f.transport.checkpoint.getMockImplementation();
  f.transport.checkpoint.mockImplementationOnce(async input=>{await real(input);throw Error('lost-web-ack');});await expect(f.tick()).rejects.toThrow('lost-web-ack');const pending=clone(f.saved.pending);
  await f.tick();expect(f.transport.checkpoint).toHaveBeenLastCalledWith(pending);expect(f.native.install).toHaveBeenCalledOnce();expect(f.saved.pending).toBeNull();
 });
 it('recovers a lost terminal acknowledgement through a new session without duplicate native work',async()=>{
  const f=fixture();await admitted(f);f.setup.ready=true;f.receipts.get(f.saved.key).state='installed';const real=f.transport.checkpoint.getMockImplementation();
  f.transport.checkpoint.mockImplementationOnce(async input=>{await real(input);throw Error('lost-final-ack');});await expect(f.tick()).rejects.toThrow();f.restart();await f.tick();
  expect(f.remote.view().settled).toBe(true);expect(f.native.install).toHaveBeenCalledOnce();expect(f.transport.poll).toHaveBeenLastCalledWith(f.request.id);
 });
 it('cancels before local approval without ever invoking the installer',async()=>{
  const f=fixture();await f.tick();f.request={...f.request,cancelRequested:true,state:'cancelling'};await f.tick();expect(f.request.state).toBe('cancelled');expect(f.native.install).not.toHaveBeenCalled();
 });
 it('reconciles cancellation of the original native operation after a lost admission acknowledgement',async()=>{
  const f=fixture();await f.tick();f.approve();await f.tick();const install=f.native.install.getMockImplementation();
  f.native.install.mockImplementationOnce(async s=>{await install(s);throw Error('lost');});await expect(f.tick()).rejects.toThrow();
  const op=f.receipts.get(f.saved.key);f.request={...f.request,cancelRequested:true,state:'cancelling'};f.restart();await f.tick();expect(f.native.cancelSetup).toHaveBeenCalledWith(op.id);expect(f.request.state).toBe('cancelling');
  await f.tick();expect(f.request.state).toBe('cancelled');expect(f.request.operationId).toBe(op.id);
 });
 it('does not claim cancellation succeeded when native cancellation is offline or already too late',async()=>{
  const f=fixture();await admitted(f);f.remote.cancel();f.native.cancelSetup.mockRejectedValueOnce(Error('offline'));await expect(f.tick()).rejects.toThrow('offline');expect(f.request.state).toBe('admitted');
  f.receipts.get(f.saved.key).state='installed';await f.tick();expect(f.request.state).toBe('failed');expect(f.transport.checkpoint.mock.calls.at(-1)[0].reason).toBe('cancel-unconfirmed');
 });
 it('fails closed when an admitted server request has lost its local mapping',async()=>{
  const f=fixture();f.request={...f.request,state:'admitted',phase:3,operationId:randomUUID()};await expect(f.tick()).rejects.toThrow('recovery-required');expect(f.native.install).not.toHaveBeenCalled();
 });
 it('honors pause/parent loss immediately before native admission',async()=>{
  const f=fixture();await f.tick();f.approve();await f.tick();await f.remote.tick(f.native,{canAdmit:()=>false});expect(f.native.install).not.toHaveBeenCalled();
  f.remote.hold();await f.tick();expect(f.native.install).not.toHaveBeenCalled();
 });
 it('rejects a changed final execution binding, preserving the original receipt',async()=>{
  const f=fixture();await admitted(f);f.setup.ready=true;f.receipts.get(f.saved.key).state='installed';f.native.adapter.readiness.mockResolvedValueOnce({ready:{},binding:{profile:SETUP_PROFILES[1],permission:true}});
  await expect(f.tick()).rejects.toThrow('not-ready');expect(f.remote.active()).toBe(true);expect(f.native.install).toHaveBeenCalledOnce();
 });
 it('retries interrupted native work only after explicit continuation using its original key and operation',async()=>{
  const f=fixture();await admitted(f);await f.tick();const key=f.saved.key,op=f.receipts.get(key);op.state='interrupted';await f.tick();expect(f.request.state).toBe('interrupted');expect(f.remote.view().needsApproval).toBe(true);
  await f.tick();expect(f.native.install).toHaveBeenCalledOnce();f.approve();await f.tick();expect(f.native.install).toHaveBeenLastCalledWith(expect.objectContaining({key}));expect(f.saved.operationId).toBe(op.id);
  op.state='downloading';op.processedBytes=15;await f.tick();expect(f.request.state).toBe('downloading');
 });
});
describe('Desktop remote request handoff',()=>{
 it('displays the remote account/model/terms and requires the specific local consent command',async()=>{
  const f=fixture();let state;const c=new DesktopController({client:f.client,delivery:{poll:async()=>({ownerId:f.request.ownerId})},setupTransport:f.transport,save:s=>{state=clone(s);},openNative:async()=>f.native});
  await c.tick();const reviewed=await c.command({command:'review-remote-setup'});expect(reviewed.terms.remote).toMatchObject({id:f.request.id,origin:f.client.origin,owner:f.request.ownerId});expect(reviewed.terms.notices[0].text).toContain('Complete');
  await expect(c.command({command:'accept-model',token:reviewed.terms.token})).rejects.toThrow('setup-busy');
  await c.command({command:'accept-remote-setup',token:reviewed.terms.token});expect(state.remoteSetup.approved).toBe(true);expect(f.native.install).not.toHaveBeenCalled();
  await c.command({command:'pause'});expect(state.remoteSetup.hold).toBe(true);
 });
 it('binds transport capability to approved account and requests terminal receipt recovery explicitly',async()=>{
  const f=fixture();f.client.action=vi.fn(async()=>({version:1,origin:f.client.origin,generationEnabled:false,deviceId:f.request.deviceId,setupProtocol:1,request:clone(f.request)}));
  const t=new SetupClient(f.client);await t.poll(f.request.id);expect(f.client.action).toHaveBeenCalledWith(expect.objectContaining({setupProtocol:1,approvedOwner:f.request.ownerId,recoverId:f.request.id,profiles:SETUP_PROFILES}));
  f.client.action.mockResolvedValueOnce({version:1,setupProtocol:1,request:null,deviceId:f.request.deviceId,origin:'https://wrong.example',generationEnabled:false});await expect(t.poll()).rejects.toThrow('invalid');
 });
});
