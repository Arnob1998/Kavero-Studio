// @vitest-environment node
import { expect,it } from 'vitest';
import { modelSelectionMode,evaluationEnabled } from './selection.mjs';
import { qwenResearchDelivery } from '../install/qwen-delivery.mjs';
import { validateManifest } from '../install/manifest.mjs';
it('keeps user-selected research distinct from disabled and internal modes',()=>{
  expect(modelSelectionMode({userSelectedModels:true})).toBe('user-selected');
  expect(evaluationEnabled({userSelectedModels:true})).toBe(true);
  expect(modelSelectionMode({internalEvaluation:true})).toBe('internal-evaluation');
  expect(evaluationEnabled({})).toBe(false);
});
it('allows only the pinned direct-upstream research delivery without claiming redistribution approval',()=>{
  const manifest=qwenResearchDelivery();
  expect(validateManifest(manifest,'user-selected').hash).toBe('35086bb8307f51d101eb4826b466300d49f0bea72957765efd6816498e7c9822');
  expect(()=>validateManifest(manifest,'public')).toThrow('package-not-approved');
  const changed=structuredClone(manifest);changed.artifacts[1].url=changed.artifacts[1].url.replace('Abiray','another-owner');
  expect(()=>validateManifest(changed,'user-selected')).toThrow('user-selected-package-rejected');
  expect(()=>validateManifest({...manifest,purpose:'commercial'},'user-selected')).toThrow('user-selected-package-rejected');
});
