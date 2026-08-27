import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import { assertTargetCompositionStartup } from '../../../../tests/i7/target-startup-composition-harness.js';

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.();
});

async function startupFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-target-composition-'));
  cleanups.push(() => rm(directory, { force: true, recursive: true }));
  return { databasePath: join(directory, 'project.sqlite') };
}

describe('target desktop composition startup barrier', () => {
  it('runs the reusable full startup composition harness on a fresh install', async () => {
    const fixture = await startupFixture();
    await assertTargetCompositionStartup({
      databasePath: fixture.databasePath,
      expectedDatabaseCreated: true,
      expectedProjectIds: [],
    });
  });
});
