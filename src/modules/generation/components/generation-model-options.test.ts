import { describe, expect, it } from 'vitest';
import { getBrowserImageModels } from '@/modules/model-providers/image-browser';
import { localProfiles } from '@/modules/model-providers/local/browser-profiles';
import { generationImageOptions } from './generation-model-options';

const base = { cloud: getBrowserImageModels('standalone-generate'), localEnabled: true, availableLocal: localProfiles.map(model=>model.profile), connectEnabled: false, references: 0, sequence: false, activeResult: false, generating: false };
describe('Central image model choices', () => {
  it('combines cloud and verified local image models without a source-tab step', () => {
    const options = generationImageOptions(base);
    expect(options.filter(option => option.value.startsWith('cloud:'))).toHaveLength(base.cloud.length);
    expect(options.filter(option => option.value.startsWith('local:'))).toHaveLength(2);
    expect(options.find(option => option.value === `local:${localProfiles[0].profile}`)).toMatchObject({location: 'This computer', disabledReason: undefined});
    expect(options.find(option => option.value.startsWith('local:'))?.description).toContain('Text to image only');
    expect(options.every(option => option.value.startsWith('local:') || base.cloud.some(model => option.value === `cloud:${model.modelAlias}`))).toBe(true);
  });
  it.each([
    [{references: 1}, /Remove reference images/],
    [{sequence: true}, /Turn off sequence/],
    [{activeResult: true}, /Close the current result/],
    [{generating: true}, /current generation to finish/],
  ])('explains unsupported local work without clearing it: %j', (changes, reason) => {
    const input = {...base, ...changes};
    const options = generationImageOptions(input);
    expect(options.filter(option => option.value.startsWith('local:')).every(option => reason.test(option.disabledReason ?? ''))).toBe(true);
    expect(input).toEqual({...base, ...changes});
  });
  it('does not expose local/Connect when deployment gates are off', () => {
    expect(generationImageOptions({...base, localEnabled: false}).every(option => option.value.startsWith('cloud:'))).toBe(true);
  });
  it('does not present computer discovery as an available image model', () => {
    expect(generationImageOptions({...base, connectEnabled: true}).some(option => option.value === 'connected')).toBe(false);
    expect(generationImageOptions({...base, availableLocal: []}).some(option => option.value.startsWith('local:'))).toBe(false);
  });
  it('blocks a cloud model when the current references exceed its supported count', () => {
    const options = generationImageOptions({...base, references: 100});
    expect(options.filter(option => option.value.startsWith('cloud:')).every(option => option.disabledReason?.includes('Remove references'))).toBe(true);
  });
});
