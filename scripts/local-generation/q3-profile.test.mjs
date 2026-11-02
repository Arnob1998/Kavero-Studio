// @vitest-environment node
import {it,expect} from 'vitest';import {readFileSync} from 'node:fs';
import {Q3_FINGERPRINT,Q4_FINGERPRINT,nativeProfile} from './profiles.mjs';
import {qwenQ3Recipe,inspectConfiguredModel,readModelConfig,existingQwenRecipe} from './model-catalog.mjs';
import {qwenQ3Delivery,qwenResearchDelivery} from './install/qwen-delivery.mjs';
import {validateManifest} from './install/manifest.mjs';
import {q3JobSnapshot,existingJobSnapshot,validateJobSnapshot,validateSnapshotIntent,canonicalSnapshot} from '../../src/modules/model-providers/local/job-snapshot.ts';
import {managedPackageIdentity,Q3_PACKAGE} from './host/model-package.mjs';
it('pins a distinct complete package, snapshot and seed while preserving shared components',()=>{
 const q3=qwenQ3Recipe(),q4=existingQwenRecipe(),delivery=qwenQ3Delivery();
 expect(Q3_FINGERPRINT).not.toBe(Q4_FINGERPRINT);expect(q3.legacy.packageFingerprint).toBe(Q3_FINGERPRINT);
 expect(managedPackageIdentity(Q3_PACKAGE).receipt).toBe('2e8ac2fe9f5b35da19e2a190d4249beb406251c25230dc87929857b3810c0d1c');
 expect(validateManifest(delivery,'user-selected').hash).toBe(q3.legacy.manifestHash);
 expect(q3.components.filter(c=>c.role!=='image-weights')).toEqual(q4.components.filter(c=>c.role!=='image-weights'));
 expect(delivery.bundledFiles.filter(f=>f.path.startsWith('notices/'))).toEqual(qwenResearchDelivery().bundledFiles.filter(f=>f.path.startsWith('notices/')));
 expect(inspectConfiguredModel(readModelConfig().models[1]).recipe).toEqual(q3);
 expect(nativeProfile(Q3_FINGERPRINT).diffusion).toBe('downloads/qwen_image_2.1_Q3_K_M.gguf');expect(()=>nativeProfile('f'.repeat(64))).toThrow();
});
it('rejects mixed profile/package/settings snapshots and exactly matches the SQL registry',()=>{
 const snapshot=q3JobSnapshot(),intent={profile:snapshot.profile,prompt:'A vase',width:512,height:512,count:1};
 expect(validateSnapshotIntent(intent,snapshot,Q3_FINGERPRINT)).toEqual(snapshot);
 for(const changed of [{...snapshot,packageFingerprint:Q4_FINGERPRINT},{...snapshot,profile:existingJobSnapshot().profile},{...snapshot,settings:{...snapshot.settings,seed:43}}])expect(()=>validateJobSnapshot(changed)).toThrow('unsupported-job-recipe');
 expect(()=>validateSnapshotIntent(intent,snapshot,Q4_FINGERPRINT)).toThrow('job-recipe-identity-mismatch');
 const sql=readFileSync('supabase/migrations/202611010003_local_generation_q3_recipe.sql','utf8');
 const literal=sql.match(/as \$snapshot\$ select '(.*?)'::jsonb \$snapshot\$/)[1];expect(canonicalSnapshot(JSON.parse(literal))).toBe(canonicalSnapshot(snapshot));
});
