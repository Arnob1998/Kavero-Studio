import { generateKeyPairSync, randomUUID, createPrivateKey } from 'node:crypto';
import { connectOrigin, claimMessage, deviceMessage, signConnect, digest, publicIdentity } from '../../../src/modules/model-providers/local/connect/protocol.ts';

const keys=()=>{
  const {publicKey,privateKey}=generateKeyPairSync('ed25519');
  return {publicKey:publicKey.export({format:'der',type:'spki'}).toString('base64url'),privateKey:privateKey.export({format:'pem',type:'pkcs8'}).toString()};
};
const validId=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export class ConnectClient {
  constructor({origin,store,allowLoopback=false,fetchImpl=fetch}) {
    this.origin=connectOrigin(origin,allowLoopback);this.store=store;this.fetch=fetchImpl;this.epoch=randomUUID();
    this.identity=store.load();
    if(this.identity) {
      if(this.identity.origin!==this.origin)throw Error('connect-origin-mismatch');
      if(this.identity.version!==1||!validId(this.identity.installationId))throw Error('connect-identity-invalid');
      publicIdentity(this.identity.publicKey);createPrivateKey(this.identity.privateKey);
    }
  }
  async request(endpoint,body,headers={},responseLimit=8192) {
    if(![8192,32768].includes(responseLimit))throw Error('connect-response-limit-invalid');
    const response=await this.fetch(this.origin+endpoint,{method:'POST',headers:{'content-type':'application/json',...headers},body,
      redirect:'error',credentials:'omit',signal:AbortSignal.timeout(10000)});
    const reader=response.body?.getReader();if(!reader)throw Error('connect-response-invalid');
    let size=0;const chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>responseLimit){await reader.cancel();throw Error('connect-response-too-large');}chunks.push(value);}}finally{reader.releaseLock();}
    let result;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw Error('connect-response-invalid');}
    if(!response.ok){const error=Error(response.status===401?'connect-authorization-failed':response.status===429?'connect-rate-limited':'connect-request-rejected');error.status=response.status;throw error;}
    if(result?.version!==1)throw Error('connect-version-unsupported');
    return result;
  }
  persist(){this.store.save(this.identity);}
  async pair(code) {
    if(!/^[a-f0-9]{24}$/.test(code))throw Error('connect-code-invalid');
    if(!this.identity){this.identity={version:1,origin:this.origin,installationId:randomUUID(),...keys()};this.persist();}
    if(this.identity.deviceId && !this.identity.unpaired && !this.identity.pendingPairing)throw Error('connect-already-paired');
    if(this.identity.pendingCodeHash!==digest(code)){
      this.identity.deviceId=randomUUID();this.identity.pendingCodeHash=digest(code);this.identity.pendingPairing=true;this.identity.unpaired=false;this.persist();
    }
    const {installationId,publicKey,privateKey}=this.identity;
    const deviceId=this.identity.deviceId;
    const proof=signConnect(claimMessage(this.origin,code,installationId,publicKey,deviceId),privateKey);
    const result=await this.request('/api/connect/claim',JSON.stringify({code,installationId,deviceId,publicKey,proof}));
    if(result.deviceId!==deviceId||!validId(result.pairingId)||result.fingerprint!==digest(publicKey))throw Error('connect-claim-invalid');
    this.identity.deviceId=result.deviceId;this.identity.pairingId=result.pairingId;this.identity.unpaired=false;this.persist();
    return {origin:this.origin,installationId,fingerprint:result.fingerprint,pairingId:result.pairingId,deviceId:result.deviceId};
  }
  async action(input,key=this.identity?.privateKey) {
    if(!this.identity?.deviceId||!key)throw Error('connect-not-paired');
    const body=JSON.stringify(input),timestamp=String(Date.now()),nonce=randomUUID(),device=this.identity.deviceId;
    const signature=signConnect(deviceMessage(this.origin,device,timestamp,nonce,body),key);
    const result=await this.request('/api/connect/device',body,{'x-kavero-connect-device':device,'x-kavero-connect-time':timestamp,'x-kavero-connect-nonce':nonce,'x-kavero-connect-signature':signature},['delivery-poll','delivery-checkpoint','execution-poll','execution-checkpoint','setup-poll','setup-checkpoint'].includes(input.action)?32768:8192);
    if(result.deviceId!==device||result.origin!==this.origin||result.generationEnabled!==['execution-poll','execution-checkpoint'].includes(input.action))throw Error('connect-device-response-invalid');
    return result;
  }
  async status(report) {
    if(this.identity?.pendingKey) await this.recoverRotation(report);
    const result=await this.action({action:'status',epoch:this.epoch,report});
    if(this.identity.pendingPairing){delete this.identity.pendingPairing;delete this.identity.pendingCodeHash;this.persist();}
    return result;
  }
  async recoverRotation(report) {
    const pending=this.identity.pendingKey;
    try { await this.action({action:'status',epoch:this.epoch,report},pending.privateKey); }
    catch(error) {
      if(error.status!==401)throw error;
      await this.action({action:'rotate',publicKey:pending.publicKey});
      await this.action({action:'status',epoch:this.epoch,report},pending.privateKey);
    }
    Object.assign(this.identity,pending);delete this.identity.pendingKey;this.persist();
  }
  async rotate(report) {
    if(!this.identity?.deviceId)throw Error('connect-not-paired');
    if(!this.identity.pendingKey){this.identity.pendingKey=keys();this.persist();}
    await this.recoverRotation(report);
    return {rotated:true};
  }
  async unpair() {
    const result=await this.action({action:'unpair'});this.identity.unpaired=true;this.persist();return result;
  }
  async forgetRevoked() {
    // Explicit local reset for an already revoked/expired identity. Never revoke
    // another device, delete model files, or silently choose a different origin.
    if(this.identity){delete this.identity.deviceId;delete this.identity.pairingId;delete this.identity.pendingKey;delete this.identity.pendingPairing;delete this.identity.pendingCodeHash;this.identity.unpaired=true;this.persist();}
  }
}

export function monitorDelay(failures,random=Math.random) {
  return Math.min(900000,60000*2**Math.min(failures,4) + Math.floor(random()*5000));
}
