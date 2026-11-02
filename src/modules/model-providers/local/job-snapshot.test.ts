// @vitest-environment node
import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {existingJobSnapshot,validateJobSnapshot,validateSnapshotIntent,jobRequestHash,canonicalSnapshot} from './job-snapshot';
import {localIntentHash} from '@/modules/generation/local/contracts';
const intent={profile:'qwen-image-2.1-q4-evaluation' as const,prompt:'A vase',width:512 as const,height:512 as const,count:1 as const};
it('preserves the legacy hash and binds new requests to registry settings',()=>{
 const snapshot=existingJobSnapshot();expect(jobRequestHash(intent)).toBe(localIntentHash(intent));expect(jobRequestHash(intent,snapshot)).not.toBe(localIntentHash(intent));
 expect(validateSnapshotIntent(intent,snapshot,snapshot.packageFingerprint)).toEqual(snapshot);
 expect(()=>validateSnapshotIntent(intent,snapshot,'b'.repeat(64))).toThrow('job-recipe-identity-mismatch');
 for(const change of [{label:'Another model'},{settings:{...snapshot.settings,seed:1}},{source:{...snapshot.source,revision:'a'.repeat(40)}},{extra:true}])expect(()=>validateJobSnapshot({...snapshot,...change})).toThrow('unsupported-job-recipe');
});
it('matches the forward migration registry exactly rather than trusting arbitrary metadata',()=>{
 const sql=readFileSync('supabase/migrations/202611010001_local_generation_recipe_snapshots.sql','utf8');
 const literal=sql.match(/as \$snapshot\$ select '(.*?)'::jsonb \$snapshot\$/)![1];expect(JSON.parse(literal)).toEqual(existingJobSnapshot());
 expect(canonicalSnapshot(JSON.parse(literal))).toBe(canonicalSnapshot(existingJobSnapshot()));
});
