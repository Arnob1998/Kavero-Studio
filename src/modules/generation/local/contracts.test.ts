import { describe,it,expect } from 'vitest';
import { localIntentHash,localJobIntentSchema,localSubmissionSchema } from './contracts';
import { signLocalBridgeRequest } from '@/modules/model-providers/local/signature';
import { createHmac,createHash,randomUUID } from 'node:crypto';
const intent={profile:'qwen-image-2.1-q4-evaluation' as const,prompt:'A vase',width:512 as const,height:512 as const,count:1 as const};
describe('Local job admission contract',()=>{
 it('rejects cloud options and owner spoofing',()=>{expect(localJobIntentSchema.safeParse({...intent,reasoning:'high'}).success).toBe(false);expect(localSubmissionSchema.safeParse({idempotencyKey:randomUUID(),intent,owner:'other'}).success).toBe(false);});
 it('rejects references, extra counts and unsupported resolution',()=>{for(const value of [{...intent,referenceImages:[]},{...intent,count:2},{...intent,width:1024}])expect(localJobIntentSchema.safeParse(value).success).toBe(false);});
 it('keeps Unicode content exact and rejects blank/overlong input',()=>{expect(localJobIntentSchema.parse({...intent,prompt:'界'.repeat(1000)}).prompt).toHaveLength(1000);for(const prompt of ['','   ','a'.repeat(1001)])expect(localJobIntentSchema.safeParse({...intent,prompt}).success).toBe(false);});
 it('canonicalizes field order but distinguishes prompt changes',()=>{expect(localIntentHash({...intent})).toBe(localIntentHash({count:1,height:512,width:512,prompt:'A vase',profile:intent.profile}));expect(localIntentHash(intent)).not.toBe(localIntentHash({...intent,prompt:'A vase '}));});
 it('signs the exact method, route, timestamp, nonce and body digest',()=>{const body=JSON.stringify({owner:'owner',job:'job',identity:'package'}),secret='s'.repeat(64),headers=signLocalBridgeRequest(secret,'POST','/submit',body);expect(headers['x-kavero-signature']).toBe(createHmac('sha256',secret).update(['kavero-local-v1','POST','/submit',headers['x-kavero-time'],headers['x-kavero-nonce'],createHash('sha256').update(body).digest('hex')].join('\n')).digest('hex'));});
});
