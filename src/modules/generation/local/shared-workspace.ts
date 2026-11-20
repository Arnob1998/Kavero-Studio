import type { GenerationRun } from '../types';
import type { LocalGenerationRuntime } from './local-generation-panel';

/** Present a validated local result in the same workspace; keep job/save identity local. */
export function localWorkspaceRun(runtime: Pick<LocalGenerationRuntime, 'job'|'model'|'imageURL'|'requestPrompt'>): GenerationRun | null {
  if (!runtime.job || !runtime.model || !runtime.imageURL) return null;
  return {
    id: runtime.job.id, prompt: runtime.requestPrompt, model: `local:${runtime.model.profile}`, modelLabel: runtime.model.label,
    kind: 'image', images: [{id: runtime.job.id, dataUrl: runtime.imageURL, mimeType: 'image/png', variant: 1}],
    text: '', referenceImages: [], createdAt: runtime.job.createdAt, warnings: [],
    settings: {model:runtime.model.profile,count:'1',aspect:'1:1',quality:'512',thinking:'off',providerQuality:'auto',background:'opaque'},
  };
}
