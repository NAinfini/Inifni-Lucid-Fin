import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { preflightLegacyScalarMediaReferences } from './scalar-media-preflight.js';

const TARGET_HASH = createHash('sha256').update('scalar-media-target').digest('hex');
const MISSING_HASH = createHash('sha256').update('missing-scalar-media-target').digest('hex');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-scalar-media-preflight-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE asset_contents (hash TEXT PRIMARY KEY);
      CREATE TABLE asset_entries (id TEXT PRIMARY KEY, asset_hash TEXT NOT NULL);
      CREATE TABLE delivery_asset_refs (
        canvas_id TEXT NOT NULL,
        asset_hash TEXT NOT NULL,
        PRIMARY KEY (canvas_id, asset_hash)
      ) WITHOUT ROWID;
      CREATE TABLE commander_run_attachments (
        run_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        PRIMARY KEY (run_id, ordinal)
      );
      CREATE TABLE task_artifacts (
        id TEXT PRIMARY KEY,
        artifact_type TEXT NOT NULL,
        asset_hash TEXT
      );
      CREATE TABLE task_attempts (id TEXT PRIMARY KEY, kind TEXT NOT NULL, asset_hash TEXT);
      CREATE TABLE task_evaluations (
        id TEXT PRIMARY KEY,
        media_type TEXT NOT NULL,
        asset_hash TEXT NOT NULL
      );
      CREATE TABLE prompt_assemblies (id TEXT PRIMARY KEY, source_asset_hash TEXT);
      CREATE TABLE characters (id TEXT PRIMARY KEY, ref_image TEXT);
      CREATE TABLE color_styles (id TEXT PRIMARY KEY, source_asset TEXT);
    `);
  } finally {
    database.close();
  }
  return databasePath;
}

function edit(databasePath: string, sql: string, ...parameters: unknown[]): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare(sql).run(...parameters);
  } finally {
    database.close();
  }
}

function report(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return preflightLegacyScalarMediaReferences(database);
  } finally {
    database.close();
  }
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe('Legacy scalar media reference preflight', () => {
  it('audits all nine explicit sources deterministically without changing the database', async () => {
    const databasePath = await fixture();
    edit(databasePath, 'INSERT INTO asset_contents (hash) VALUES (?)', TARGET_HASH);
    edit(databasePath, 'INSERT INTO asset_entries VALUES (?, ?)', 'entry-1', TARGET_HASH);
    edit(databasePath, 'INSERT INTO delivery_asset_refs VALUES (?, ?)', 'canvas-1', TARGET_HASH);
    edit(
      databasePath,
      'INSERT INTO commander_run_attachments VALUES (?, ?, ?)',
      'run-1',
      0,
      TARGET_HASH,
    );
    edit(
      databasePath,
      'INSERT INTO task_artifacts VALUES (?, ?, ?)',
      'artifact-1',
      'audio',
      TARGET_HASH,
    );
    edit(
      databasePath,
      'INSERT INTO task_attempts VALUES (?, ?, ?)',
      'attempt-1',
      'production_media',
      TARGET_HASH,
    );
    edit(
      databasePath,
      'INSERT INTO task_evaluations VALUES (?, ?, ?)',
      'evaluation-1',
      'image',
      TARGET_HASH,
    );
    edit(databasePath, 'INSERT INTO prompt_assemblies VALUES (?, ?)', 'assembly-1', TARGET_HASH);
    edit(databasePath, 'INSERT INTO characters VALUES (?, ?)', 'character-1', TARGET_HASH);
    edit(databasePath, 'INSERT INTO color_styles VALUES (?, ?)', 'style-1', TARGET_HASH);
    edit(databasePath, 'INSERT INTO task_artifacts VALUES (?, ?, NULL)', 'artifact-null', 'log');
    edit(databasePath, 'INSERT INTO task_attempts VALUES (?, ?, NULL)', 'attempt-null', 'task');
    edit(databasePath, 'INSERT INTO prompt_assemblies VALUES (?, NULL)', 'assembly-null');
    edit(databasePath, 'INSERT INTO characters VALUES (?, NULL)', 'character-null');
    edit(databasePath, 'INSERT INTO color_styles VALUES (?, NULL)', 'style-null');
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      referenceCount: 9,
      distinctHashCount: 1,
      blockers: [],
      ok: true,
    });
    expect(first.bySource).toHaveLength(9);
    expect(
      first.bySource.map(({ table, column, occurrenceCount, distinctHashCount }) => ({
        table,
        column,
        occurrenceCount,
        distinctHashCount,
      })),
    ).toEqual([
      { table: 'asset_entries', column: 'asset_hash', occurrenceCount: 1, distinctHashCount: 1 },
      {
        table: 'delivery_asset_refs',
        column: 'asset_hash',
        occurrenceCount: 1,
        distinctHashCount: 1,
      },
      {
        table: 'commander_run_attachments',
        column: 'content_hash',
        occurrenceCount: 1,
        distinctHashCount: 1,
      },
      { table: 'task_artifacts', column: 'asset_hash', occurrenceCount: 1, distinctHashCount: 1 },
      { table: 'task_attempts', column: 'asset_hash', occurrenceCount: 1, distinctHashCount: 1 },
      {
        table: 'task_evaluations',
        column: 'asset_hash',
        occurrenceCount: 1,
        distinctHashCount: 1,
      },
      {
        table: 'prompt_assemblies',
        column: 'source_asset_hash',
        occurrenceCount: 1,
        distinctHashCount: 1,
      },
      { table: 'characters', column: 'ref_image', occurrenceCount: 1, distinctHashCount: 1 },
      { table: 'color_styles', column: 'source_asset', occurrenceCount: 1, distinctHashCount: 1 },
    ]);
    expect(first.bySource[3]).toMatchObject({ discriminatorColumn: 'artifact_type' });
    expect(first.bySource[4]).toMatchObject({ discriminatorColumn: 'kind' });
    expect(first.bySource[5]).toMatchObject({ discriminatorColumn: 'media_type' });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });

  it('blocks malformed and missing targets while retaining discriminator evidence', async () => {
    const databasePath = await fixture();
    edit(databasePath, 'INSERT INTO asset_contents (hash) VALUES (?)', TARGET_HASH);
    edit(
      databasePath,
      'INSERT INTO task_artifacts VALUES (?, ?, ?)',
      'artifact-invalid',
      'audio',
      TARGET_HASH.toUpperCase(),
    );
    edit(
      databasePath,
      'INSERT INTO task_attempts VALUES (?, ?, ?)',
      'attempt-invalid',
      'task',
      'not-a-hash',
    );
    edit(databasePath, 'INSERT INTO color_styles VALUES (?, ?)', 'style-missing', MISSING_HASH);
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first.referenceCount).toBe(3);
    expect(first.distinctHashCount).toBe(1);
    expect(first.blockers).toEqual([
      {
        kind: 'invalid_media_reference_hash',
        table: 'task_artifacts',
        column: 'asset_hash',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        value: TARGET_HASH.toUpperCase(),
        reason: 'not_lowercase_sha256',
        discriminator: 'audio',
      },
      {
        kind: 'invalid_media_reference_hash',
        table: 'task_attempts',
        column: 'asset_hash',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        value: 'not-a-hash',
        reason: 'not_lowercase_sha256',
        discriminator: 'task',
      },
      {
        kind: 'missing_media_reference_target',
        table: 'color_styles',
        column: 'source_asset',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        hash: MISSING_HASH,
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });
});
