import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { canonicalJson } from '@lucid-fin/target-contracts';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from '../../../storage/src/schema-sql.js';
import { openTargetStore } from '../kernel/store.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import {
  legacySkillDatabaseFingerprint,
  planLegacySkillMigration,
  createLegacySkillRowClassifier,
} from './legacy-skill-migration.js';
import {
  LEGACY_BROWSER_STATE_KEYS,
  captureLegacyBrowserState,
  createLegacyBrowserStateSnapshot,
} from './legacy-browser-state.js';
import { preflightLegacyInputs } from './legacy-preflight.js';
import { buildLegacyMigrationReadinessReport } from './migration-readiness.js';
import { buildLegacyMigrationPlan } from './legacy-migration-plan.js';
import { classifyLegacyPhaseOne } from './phase-one-classification.js';
import {
  rehearseDisposableLegacyMigration,
  type LegacyMigrationFaultPoint,
} from './legacy-migration-rehearsal.js';

const temporaryDirectories: string[] = [];
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const MEDIA_HASH = createHash('sha256').update(PNG_BYTES).digest('hex');
const CREATED_AT = 1_700_000_000_000;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i7-empty-migration-'));
  temporaryDirectories.push(directory);
  const mainDatabasePath = join(directory, 'legacy.sqlite');
  const promptsDatabasePath = join(directory, 'prompts.sqlite');
  const assetsRoot = join(directory, 'legacy-assets');
  const targetRootPath = join(directory, 'disposable-target');
  await mkdir(assetsRoot);
  const sourceMediaPath = join(assetsRoot, 'image', MEDIA_HASH.slice(0, 2), `${MEDIA_HASH}.png`);
  await mkdir(dirname(sourceMediaPath), { recursive: true });
  await writeFile(sourceMediaPath, PNG_BYTES);
  const main = new DatabaseSync(mainDatabasePath);
  main.exec(SCHEMA_SQL);
  main
    .prepare(
      `INSERT INTO asset_contents (hash, type, format, created_at, file_size)
       VALUES (?, 'image', 'png', ?, ?)`,
    )
    .run(MEDIA_HASH, CREATED_AT, PNG_BYTES.byteLength);
  main.close();
  const prompts = new DatabaseSync(promptsDatabasePath);
  prompts.exec(`
    CREATE TABLE process_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      process_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      default_value TEXT NOT NULL,
      custom_value TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE t_prompt_overrides (
      code TEXT PRIMARY KEY,
      customValue TEXT NOT NULL
    );
  `);
  prompts.close();
  const rawJson = canonicalJson({ builtInCustoms: {}, builtInNames: {}, customSkills: [] });
  const emptyRows = {
    presetOverrides: [],
    customShotTemplates: [],
    processPromptOverrides: [],
    promptTemplateOverrides: [],
  };
  const skillBundle = {
    schema: 'lucid-fin.legacy-skill-migration-bundle/v1' as const,
    cutoverAt: '1970-01-01T00:00:00.000Z',
    databaseFingerprint: legacySkillDatabaseFingerprint(emptyRows),
    rendererExport: {
      storageKey: 'lucid-skills-v2' as const,
      rawJson,
      rawHash: createHash('sha256').update(rawJson).digest('hex'),
    },
    ...emptyRows,
  };
  const skillPlan = planLegacySkillMigration(skillBundle, []);
  const browserValues = Object.fromEntries(
    LEGACY_BROWSER_STATE_KEYS.map((key) => [key, key === 'lucid-skills-v2' ? rawJson : null]),
  ) as Readonly<Record<(typeof LEGACY_BROWSER_STATE_KEYS)[number], string | null>>;
  const browserState = createLegacyBrowserStateSnapshot(
    captureLegacyBrowserState(
      {
        captureRunId: 'rehearsal-run-1',
        captureSessionId: 'rehearsal-session-1',
        chromiumProfile: { platform: 'win32', path: 'C:/Lucid/Profile 1' },
        origin: 'opaque:file',
        challenge: 'A'.repeat(43),
        capturedAt: '2026-08-25T12:00:00.000Z',
      },
      (key) => browserValues[key],
    ),
  );
  const paths = { mainDatabasePath, promptsDatabasePath, assetsRoot };
  const preflight = await preflightLegacyInputs(paths);
  const mainRead = new DatabaseSync(mainDatabasePath, { readOnly: true });
  const promptsRead = new DatabaseSync(promptsDatabasePath, { readOnly: true });
  let phaseOne: ReturnType<typeof classifyLegacyPhaseOne>;
  try {
    if (preflight.media.status !== 'checked') throw new Error('Fixture media preflight skipped');
    phaseOne = classifyLegacyPhaseOne(
      { main: mainRead, prompts: promptsRead },
      I0_LEGACY_SOURCE_SCHEMAS,
      preflight.media.report,
      { root: { classifyLegacySkillRows: createLegacySkillRowClassifier(skillPlan) } },
    );
  } finally {
    promptsRead.close();
    mainRead.close();
  }
  const readiness = buildLegacyMigrationReadinessReport({ preflight, phaseOne });
  const plan = buildLegacyMigrationPlan({ readiness, phaseOne });
  return {
    directory,
    paths,
    targetRootPath,
    readiness,
    plan,
    skillBundle,
    builtInSkills: [],
    skillPlan,
    browserState,
    media: { hash: MEDIA_HASH, sourceMediaPath },
  };
}

function stagingRootFor(source: Awaited<ReturnType<typeof fixture>>): string {
  return join(
    dirname(source.targetRootPath),
    `.${basename(source.targetRootPath)}.${source.plan.batchId}.staging`,
  );
}

async function sourceTree(path: string): Promise<readonly string[]> {
  return [...(await readdir(path, { recursive: true }))].sort();
}

describe('disposable Legacy migration rehearsal', () => {
  it('stages, reconciles, reopens, and atomically renames a complete empty source', async () => {
    const source = await fixture();
    const report = await rehearseDisposableLegacyMigration(source);

    expect(report).toMatchObject({
      schema: 'lucid-fin.disposable-legacy-migration-rehearsal/v1',
      mediaObjectCount: 1,
      atomicRenameVerified: true,
      targetRootName: basename(source.targetRootPath),
      ok: true,
    });
    expect(report.firstReconciliationFingerprint).toBe(report.reopenedReconciliationFingerprint);
    expect(report.reopenedReconciliationFingerprint).toBe(report.finalReconciliationFingerprint);
    expect(report.browserState).toMatchObject({
      snapshotFingerprint: source.browserState.fingerprint,
    });
    const reopened = await openTargetStore(join(source.targetRootPath, 'target.sqlite'));
    reopened.close();
    const evidence = JSON.parse(
      await readFile(join(source.targetRootPath, 'migration-reconciliation.json'), 'utf8'),
    ) as { ok: boolean; expectationHash: string };
    expect(evidence).toMatchObject({
      ok: true,
      expectationHash: report.reconciliationExpectationHash,
    });
    expect(
      JSON.parse(await readFile(join(source.targetRootPath, 'legacy-browser-state.json'), 'utf8')),
    ).toEqual(source.browserState);
    expect(
      await readFile(
        join(
          source.targetRootPath,
          'media',
          'sha256',
          source.media.hash.slice(0, 2),
          source.media.hash,
        ),
      ),
    ).toEqual(PNG_BYTES);
    expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
  });

  it.each([
    'after_staging_created',
    'after_media_copy',
    'inside_transaction',
    'after_transaction',
    'after_reopen',
    'before_atomic_rename',
  ] satisfies readonly LegacyMigrationFaultPoint[])(
    'removes only its exact staging root after %s failure without modifying non-empty Legacy media',
    async (faultAt) => {
      const source = await fixture();
      const stagingRoot = stagingRootFor(source);

      await expect(rehearseDisposableLegacyMigration({ ...source, faultAt })).rejects.toThrow(
        `Injected Legacy migration fault: ${faultAt}`,
      );
      await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await access(source.paths.mainDatabasePath).then(() => true)).toBe(true);
      expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
    },
  );

  it('rejects a same-count Target row mutation during full-database reconciliation', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 4) {
          const database = new DatabaseSync(join(stagingRoot, 'target.sqlite'));
          try {
            const result = database
              .prepare('UPDATE media_blobs SET mime_type = ?')
              .run('image/gif');
            if (result.changes !== 1) throw new Error('Expected one media row to tamper');
          } finally {
            database.close();
          }
        }
        return undefined;
      },
    };

    await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
      'Disposable Target content differs from migration materialization',
    );
    expect(faultChecks).toBe(4);
    await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
  });

  it('rejects a direct Target database mutation after reconciliation and before publish', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 6) {
          const database = new DatabaseSync(join(stagingRoot, 'target.sqlite'));
          try {
            database.prepare('UPDATE media_blobs SET mime_type = ?').run('image/gif');
          } finally {
            database.close();
          }
        }
        return undefined;
      },
    };

    await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
      'Disposable Target database changed after final reconciliation',
    );
    expect(faultChecks).toBe(6);
    await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
  });

  it('reconciles again after the reopen fault boundary before accepting its database baseline', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 5) {
          const database = new DatabaseSync(join(stagingRoot, 'target.sqlite'));
          try {
            database.prepare('UPDATE media_blobs SET mime_type = ?').run('image/gif');
          } finally {
            database.close();
          }
        }
        return undefined;
      },
    };

    await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
      'Disposable Target content differs from migration materialization',
    );
    expect(faultChecks).toBe(5);
    await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
  });

  it('revalidates the canonical Target schema after the reopen fault boundary', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 5) {
          const database = new DatabaseSync(join(stagingRoot, 'target.sqlite'));
          try {
            database.exec('CREATE INDEX migration_schema_tamper ON media_blobs(mime_type)');
          } finally {
            database.close();
          }
        }
        return undefined;
      },
    };

    await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(/schema/i);
    expect(faultChecks).toBe(5);
    await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
  });

  it('does not follow a staging media junction created after staging-root creation', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    const stagingMediaRoot = join(stagingRoot, 'media');
    const beforeTree = await sourceTree(source.paths.assetsRoot);
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 1) {
          symlinkSync(resolve(source.paths.assetsRoot), stagingMediaRoot, 'junction');
        }
        return undefined;
      },
    };

    await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
      'Disposable staging media directory must be a newly created directory',
    );
    expect(await sourceTree(source.paths.assetsRoot)).toEqual(beforeTree);
    expect(faultChecks).toBe(1);
    expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
    await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not write through a staging-root junction installed after media copy', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    const displacedStagingRoot = join(source.directory, 'displaced-after-media-copy');
    const beforeTree = await sourceTree(source.paths.assetsRoot);
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 2) {
          renameSync(stagingRoot, displacedStagingRoot);
          symlinkSync(resolve(source.paths.assetsRoot), stagingRoot, 'junction');
        }
        return undefined;
      },
    };

    try {
      await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
        /symbolic link|junction|reparse/i,
      );
      expect(faultChecks).toBe(2);
      expect(await sourceTree(source.paths.assetsRoot)).toEqual(beforeTree);
      expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
      await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
      await rm(displacedStagingRoot, { recursive: true, force: true });
    }
  });

  it('rejects an unmanifested staging output created immediately before publish', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    const beforeTree = await sourceTree(source.paths.assetsRoot);
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 6) {
          writeFileSync(join(stagingRoot, 'unexpected-output.txt'), 'unexpected');
        }
        return undefined;
      },
    };

    await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
      'Disposable staging root output tree does not match the migration manifest',
    );
    expect(faultChecks).toBe(6);
    await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await sourceTree(source.paths.assetsRoot)).toEqual(beforeTree);
  });

  it('rejects a valid SQLite WAL sidecar injected immediately before publish', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    const sidecarPath = join(stagingRoot, 'target.sqlite-wal');
    const beforeTree = await sourceTree(source.paths.assetsRoot);
    let faultChecks = 0;
    let injectedDatabase: DatabaseSync | undefined;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 6) {
          injectedDatabase = new DatabaseSync(join(stagingRoot, 'target.sqlite'));
          injectedDatabase.exec('PRAGMA journal_mode = WAL');
          injectedDatabase.prepare('UPDATE media_blobs SET mime_type = ?').run('image/gif');
        }
        return undefined;
      },
    };

    try {
      await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
        'Disposable staging root output tree does not match the migration manifest',
      );
      expect(faultChecks).toBe(6);
      expect(await access(sidecarPath).then(() => true)).toBe(true);
      await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await sourceTree(source.paths.assetsRoot)).toEqual(beforeTree);
    } finally {
      injectedDatabase?.close();
    }
  });

  it('canonicalizes Legacy source aliases before rejecting target and staging roots inside the real media source', async () => {
    const source = await fixture();
    const sourceAlias = join(
      dirname(source.directory),
      `${basename(source.directory)}-source-alias`,
    );
    await symlink(resolve(source.directory), sourceAlias, 'junction');
    try {
      const targetRootPath = join(source.paths.assetsRoot, 'inside-legacy-assets');
      const stagingRoot = join(
        source.paths.assetsRoot,
        `.${basename(targetRootPath)}.${source.plan.batchId}.staging`,
      );
      await expect(
        rehearseDisposableLegacyMigration({
          ...source,
          paths: {
            mainDatabasePath: join(sourceAlias, basename(source.paths.mainDatabasePath)),
            promptsDatabasePath: join(sourceAlias, basename(source.paths.promptsDatabasePath)),
            assetsRoot: join(sourceAlias, basename(source.paths.assetsRoot)),
          },
          targetRootPath,
        }),
      ).rejects.toThrow('Disposable Target root must be separate from every Legacy source');
      await expect(access(targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
    } finally {
      await rm(sourceAlias, { recursive: true, force: true });
    }
  });

  it('rejects target and staging roots behind a junction ancestor before creating either root', async () => {
    const source = await fixture();
    const realParent = join(source.directory, 'real-target-parent');
    const aliasParent = join(source.directory, 'target-parent-alias');
    await mkdir(realParent);
    await symlink(resolve(realParent), aliasParent, 'junction');
    const targetRootPath = join(aliasParent, 'disposable-target');
    const stagingRoot = join(
      realParent,
      `.${basename(targetRootPath)}.${source.plan.batchId}.staging`,
    );

    await expect(rehearseDisposableLegacyMigration({ ...source, targetRootPath })).rejects.toThrow(
      /symbolic link|junction|reparse/i,
    );
    await expect(access(join(realParent, 'disposable-target'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not clobber a destination that appears immediately before publish', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    const sentinelPath = join(source.targetRootPath, 'keep.txt');
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 6) {
          mkdirSync(source.targetRootPath);
          writeFileSync(sentinelPath, 'keep');
        }
        return undefined;
      },
    };

    await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
      'Disposable Target root must be absent before publish',
    );
    expect(faultChecks).toBe(6);
    expect(await readFile(sentinelPath, 'utf8')).toBe('keep');
    await expect(access(stagingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(source.media.sourceMediaPath)).toEqual(PNG_BYTES);
  });

  it('refuses cleanup when a staging root is replaced after creation', async () => {
    const source = await fixture();
    const stagingRoot = stagingRootFor(source);
    const displacedStagingRoot = join(source.directory, 'displaced-staging-root');
    const replacementSentinel = join(stagingRoot, 'keep.txt');
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): LegacyMigrationFaultPoint {
        if (++faultChecks === 1) {
          renameSync(stagingRoot, displacedStagingRoot);
          mkdirSync(stagingRoot);
          writeFileSync(replacementSentinel, 'keep');
        }
        return 'after_staging_created';
      },
    };

    const failure = await rehearseDisposableLegacyMigration(input).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toHaveLength(2);
    expect((failure as AggregateError).errors[0]).toMatchObject({
      message: 'Injected Legacy migration fault: after_staging_created',
    });
    expect((failure as AggregateError).errors[1]).toMatchObject({
      message: expect.stringMatching(/Disposable staging root changed|directory/),
    });
    expect(faultChecks).toBe(1);
    expect(await readFile(replacementSentinel, 'utf8')).toBe('keep');
    expect(await access(displacedStagingRoot).then(() => true)).toBe(true);
  });

  it('refuses publish and cleanup when the target parent identity changes', async () => {
    const source = await fixture();
    const displacedParent = `${source.directory}-displaced`;
    const stagingRoot = stagingRootFor(source);
    const displacedStagingRoot = join(displacedParent, basename(stagingRoot));
    temporaryDirectories.push(displacedParent);
    let faultChecks = 0;
    const input = {
      ...source,
      get faultAt(): undefined {
        if (++faultChecks === 6) {
          renameSync(source.directory, displacedParent);
          mkdirSync(source.directory);
        }
        return undefined;
      },
    };

    await expect(rehearseDisposableLegacyMigration(input)).rejects.toThrow(
      'Disposable Target parent changed before publish',
    );
    expect(faultChecks).toBe(6);
    expect(await access(displacedStagingRoot).then(() => true)).toBe(true);
    await expect(access(source.targetRootPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
