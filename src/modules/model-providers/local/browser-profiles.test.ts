// @vitest-environment node
import { expect, it } from 'vitest';
import { localProfiles, localImageLimits, localProfile } from './browser-profiles';
import { jobSnapshotForProfile } from './job-snapshot';

it('keeps browser selections and limits aligned with trusted server recipes', () => {
  for (const model of localProfiles) {
    const snapshot = jobSnapshotForProfile(model.profile);
    expect(model).toMatchObject({ recipeId: snapshot.recipeId, manifest: snapshot.manifestHash, file: snapshot.source.file });
    expect(localImageLimits).toMatchObject({ width: snapshot.settings.width, height: snapshot.settings.height, count: snapshot.settings.count });
    expect(localProfile(model.profile)).toBe(model);
  }
  expect(localProfile('arbitrary-import')).toBeUndefined();
});
