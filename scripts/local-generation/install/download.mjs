import https from 'node:https';
import dns from 'node:dns';
import { isIP } from 'node:net';
import { constants,writeSync,closeSync,fsyncSync } from 'node:fs';
import { allowedURL } from './manifest.mjs';
export function publicAddress(address) {
  if(isIP(address)===4) {const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&[0,168].includes(b)||a===100&&b>=64&&b<=127||a===198&&[18,19,51].includes(b)||a===203&&b===0);}
  // Use globally routable unicast only; reject mapped/compatible IPv4, local,
  // multicast and documentation ranges rather than trying to normalize them.
  return isIP(address)===6&&/^2[0-9a-f]{3}:/i.test(address)&&!/^2001:(?:db8|0):/i.test(address);
}
export function secureLookup(host,options,callback) {
  dns.lookup(host,{all:true,verbatim:true},(error,addresses)=>{
    if(error)return callback(error);
    if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))return callback(Error('install-private-address'));
    if(options?.all)return callback(null,addresses);
    const first=addresses.find(row=>!options?.family||options.family===row.family);if(!first)return callback(Error('install-address-unavailable'));callback(null,first.address,first.family);
  });
}
export function httpsTransport(url,{headers,signal}) {
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{headers,signal,lookup:secureLookup,agent:false},response=>{
      // Destroy the request on body errors/idle timeout, not just the headers.
      response.on('error',()=>{});resolve({status:response.statusCode,headers:response.headers,body:response,dispose:()=>response.destroy()});
    });
    request.setTimeout(30000,()=>request.destroy(Error('install-download-timeout')));request.on('error',reject);
  });
}
export async function downloadArtifact(files,artifact,{transport=httpsTransport,check=()=>{},signal,onProgress=()=>{}}={}) {
  const part=`parts/${artifact.sha256}.part`,meta=`parts/${artifact.sha256}.json`,cache=`cache/${artifact.sha256}`;
  if(await files.matches(cache,artifact))return cache;
  if(files.exists(cache))files.remove(cache); // Owned corrupt cache, never active packages.
  let prior=null;try{prior=JSON.parse(files.read(meta,2048));}catch(e){if(e.code!=='ENOENT') {if(files.exists(meta))files.remove(meta);}}
  let offset=files.exists(part)?files.size(part):0;
  if(offset>artifact.bytes||prior?.sha256!==artifact.sha256||prior?.url!==artifact.url||prior?.bytes!==artifact.bytes||!strongETag(prior?.etag)) {
    if(files.exists(part))files.remove(part);offset=0;prior=null;
  }
  if(offset===artifact.bytes) {
    if(await files.matches(part,artifact)){check();files.rename(part,cache);return cache;}
    files.remove(part);offset=0;prior=null;
  }
  let response,etag,complete=false;
  // A rejected/stale range gets one clean attempt. It never appends a 200 body.
  for(let attempt=0;attempt<2;attempt++) {
    check();let url=allowedURL(artifact.url,artifact.hosts);
    for(let redirects=0;redirects<=3;redirects++) {
      response=await transport(url,{signal,headers:{'accept-encoding':'identity',...(offset?{'range':`bytes=${offset}-`,'if-range':prior.etag}:{})}});try{check();}catch(error){response.dispose();throw error;}
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.location;response.dispose();if(redirects===3||typeof location!=='string')throw Error('install-redirect-rejected');
      url=allowedURL(new URL(location,url).href,artifact.hosts);
    }
    etag=response.headers.etag;
    if(offset&&(response.status!==206||etag!==prior.etag||response.headers['content-range']!==`bytes ${offset}-${artifact.bytes-1}/${artifact.bytes}`)) {
      response.dispose();files.remove(part);if(files.exists(meta))files.remove(meta);offset=0;prior=null;continue;
    }
    if(response.status!==(offset?206:200)||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity') {response.dispose();throw Error('install-download-rejected');}
    const length=response.headers['content-length'];if(length!==undefined&&(!/^\d+$/.test(String(length))||Number(length)!==artifact.bytes-offset)){response.dispose();throw Error('install-download-size');}
    complete=true;break;
  }
  if(!complete)throw Error('install-range-rejected');
  let fd;let received=offset,lastYield=Date.now();
  try {
    files.atomicJSON(meta,{sha256:artifact.sha256,url:artifact.url,bytes:artifact.bytes,etag:strongETag(etag)?etag:null});
    fd=files.open(part,constants.O_WRONLY|constants.O_CREAT|(offset?constants.O_APPEND:constants.O_EXCL));
    for await(const chunk of bufferedWrites(response.body)) {
      check();if(signal?.aborted)throw Error('install-cancelled');
      if(received+chunk.length>artifact.bytes)throw Error('install-download-size');
      let written=0;while(written<chunk.length)written+=writeSync(fd,chunk,written,chunk.length-written);
      received+=chunk.length;onProgress(received);files.resolve(part);
      // Buffered stream promises can otherwise monopolize the host thread.
      // Yield without relaxing claim/path checks so status and cancel can run.
      if(Date.now()-lastYield>=25){await new Promise(resolve=>setImmediate(resolve));lastYield=Date.now();}
    }
    fsyncSync(fd);if(received!==artifact.bytes)throw Error('install-download-size');
  }finally{try{if(fd!==undefined){try{fsyncSync(fd);}finally{closeSync(fd);}}}finally{response.dispose();}}
  check();if(!await files.matches(part,artifact)){files.remove(part);throw Error('install-download-checksum');}
  check();files.rename(part,cache);files.syncParent(cache);return cache;
}
function strongETag(value) {return typeof value==='string'&&/^"[^"\r\n]{1,200}"$/.test(value);}
// TLS packet boundaries are not filesystem transaction boundaries. Coalesce
// into bounded writes, checking the owner/claim and path before every write;
// final length/hash validation remains authoritative. Pending output is bounded to 256 KiB plus the transport chunk.
async function* bufferedWrites(body) {
  const limit=256*1024;let parts=[],size=0,lastYield=Date.now();
  try{for await(const incoming of body){
    const bytes=Buffer.from(incoming.buffer,incoming.byteOffset,incoming.byteLength);
    for(let offset=0;offset<bytes.length;){const count=Math.min(limit-size,bytes.length-offset);parts.push(bytes.subarray(offset,offset+count));size+=count;offset+=count;
      if(size===limit){yield Buffer.concat(parts,size);parts=[];size=0;}}
    if(Date.now()-lastYield>=25){await new Promise(resolve=>setImmediate(resolve));lastYield=Date.now();}
  }}catch(error){if(size)yield Buffer.concat(parts,size);throw error;}
  if(size)yield Buffer.concat(parts,size);
}
