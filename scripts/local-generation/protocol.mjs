import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
export function verifyRequest(ledger,secret,method,url,headers,body,now=Date.now()) {
  const stamp=headers['x-kavero-time'],nonce=headers['x-kavero-nonce'],signature=headers['x-kavero-signature'];
  if(!/^\d{13}$/.test(stamp??'') || Math.abs(now-Number(stamp))>60000 || !/^[a-f0-9-]{36}$/.test(nonce??'') || !/^[a-f0-9]{64}$/.test(signature??''))throw Error('unauthorized');
  const digest=createHash('sha256').update(body).digest('hex');
  const expected=createHmac('sha256',secret).update(['kavero-local-v1',method,url,stamp,nonce,digest].join('\n')).digest();
  if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))throw Error('unauthorized');
  ledger.nonce(nonce,now);
}
