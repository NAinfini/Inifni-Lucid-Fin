import { rm } from 'node:fs/promises';
import { describe, it } from 'vitest';
import { createJourneyFixture } from '../i2h/fixture.js';
import { runTargetNativeSyntheticReplay } from './target-native-synthetic-replay.fixture.js';

describe('I7 target-native synthetic replay', () => {
  it('runs the full target-native replay against a fresh canonical store', async () => {
    const fixture = await createJourneyFixture();
    try {
      await runTargetNativeSyntheticReplay(fixture);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);
});
