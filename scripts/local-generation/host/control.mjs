import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { sha } from '../install/manifest.mjs';
export function signControl(secret,url,body) {
  const stamp=String(Date.now()),nonce=randomUUID();
  return {'x-kavero-time':stamp,'x-kavero-nonce':nonce,'x-kavero-signature':createHmac('sha256',secret).update(['kavero-local-v1','POST',url,stamp,nonce,sha(body)].join('\n')).digest('hex')};
}
export async function hostControl(config,url,body={},fetchImpl=fetch) {
  const encoded=JSON.stringify(body),headers=signControl(config.secret,url,encoded);
  const response=await fetchImpl(`http://127.0.0.1:${config.port}${url}`,{method:'POST',headers:{'content-type':'application/json',...headers},body:encoded,signal:AbortSignal.timeout(5000),redirect:'error'});
  let data=Buffer.alloc(0);for await(const chunk of response.body){if(data.length+chunk.length>4096){await response.body.cancel?.().catch(()=>{});throw Error('host-response-invalid');}data=Buffer.concat([data,chunk]);}
  const signature=response.headers.get('x-kavero-response')??'';
  const expected=createHmac('sha256',config.secret).update(headers['x-kavero-nonce']+'\n'+sha(data)).digest();
  if(!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(expected,Buffer.from(signature,'hex'))||!response.ok)throw Error('host-response-invalid');
  const parsed=JSON.parse(data);if(parsed.instanceId!==config.instanceId)throw Error('host-instance-changed');return parsed;
}
