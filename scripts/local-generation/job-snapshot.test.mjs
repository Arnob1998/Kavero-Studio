// @vitest-environment node
import {it,expect} from 'vitest';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import os from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {Ledger,intentHash} from './ledger.mjs';import {existingJobSnapshot,canonicalSnapshot} from '../../src/modules/model-providers/local/job-snapshot.ts';import {existingQwenRecipe} from './model-catalog.mjs';
import {createJobDirectory,inspectStagedOutput} from './staging.mjs';import {pngFixture} from './png-fixture.mjs';import {DEVICE} from './profile.mjs';
it('projects the existing verified recipe without changing package/settings',()=>{
 const snapshot=existingJobSnapshot(),recipe=existingQwenRecipe();expect(snapshot.packageFingerprint).toBe(recipe.legacy.packageFingerprint);expect(snapshot.manifestHash).toBe(recipe.legacy.manifestHash);
 expect(snapshot.source.revision).toBe(recipe.source.revision);expect(snapshot.runtime.revision).toBe(recipe.runtime.revision);expect(snapshot.settings).toEqual({...recipe.defaults,width:512,height:512,count:1});
});
it('replays old/new jobs across ledger restart, freezes new identity and binds final output',()=>{
 const root=mkdtempSync(path.join(os.tmpdir(),'kavero-versioned-job-'));let ledger=new Ledger(path.join(root,'ledger.sqlite'));
 try{
  const intent={profile:'qwen-image-2.1-q4-evaluation',prompt:'A vase',width:512,height:512,count:1},snapshot=existingJobSnapshot();
  const legacy={id:randomUUID(),owner:randomUUID(),key:randomUUID(),intent,hash:intentHash(intent),fingerprint:snapshot.packageFingerprint,device:DEVICE};
  ledger.submit(legacy);ledger.cancel(legacy.owner,legacy.id);
  const current={...legacy,id:randomUUID(),key:randomUUID(),recipeSnapshot:snapshot,hash:intentHash(intent,snapshot)};ledger.submit(current);
  const row=ledger.claimNext(randomUUID(),randomUUID());ledger.supervisorStart(row.id,row.claim,row.epoch,123,'fixture');
  const dir=createJobDirectory(root,current.id);writeFileSync(path.join(dir,'final.png'),pngFixture());ledger.finish(current.id,row.claim,'generated-unvalidated',0);
  const output=inspectStagedOutput(ledger,root,current.owner,current.id);expect(output.state).toBe('generated');expect(output.descriptor.recipeSnapshot).toEqual(snapshot);
  expect(()=>ledger.db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(canonicalSnapshot({...current,recipeSnapshot:{...snapshot,label:'wrong'}}),current.id)).toThrow('immutable-job-identity');
  ledger.close();ledger=new Ledger(path.join(root,'ledger.sqlite'));
  expect(ledger.submit(legacy).state).toBe('cancelled');expect(ledger.submit(current).id).toBe(current.id);expect(inspectStagedOutput(ledger,root,current.owner,current.id)).toEqual(output);
  expect(ledger.claimNext(randomUUID(),randomUUID())).toBeNull();expect(()=>ledger.submit({...current,recipeSnapshot:undefined})).toThrow('intent-hash-mismatch');
  expect(()=>inspectStagedOutput(ledger,root,randomUUID(),current.id)).toThrow('output-not-found');
 }finally{ledger.close();rmSync(root,{recursive:true,force:true});}
});
