import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_GENERATION_METADATA_MEDIA_PATHS,
  preflightLegacyGenerationMetadata,
} from './generation-metadata-preflight.js';

const OWNER_HASH = createHash('sha256').update('generation-metadata-owner').digest('hex');
const TARGET_HASHES = Array.from({ length: 8 }, (_, index) =>
  createHash('sha256').update(`generation-metadata-target-${index}`).digest('hex'),
);
const MISSING_HASH = createHash('sha256').update('generation-metadata-missing').digest('hex');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-generation-metadata-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE asset_contents (
        hash TEXT PRIMARY KEY,
        generation_metadata TEXT
      );
    `);
  } finally {
    database.close();
  }
  return databasePath;
}

function insert(databasePath: string, hash: string, metadata: unknown = null): void {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare('INSERT INTO asset_contents (hash, generation_metadata) VALUES (?, ?)')
      .run(hash, metadata);
  } finally {
    database.close();
  }
}

function report(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return preflightLegacyGenerationMetadata(database);
  } finally {
    database.close();
  }
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe('Legacy asset generation metadata preflight', () => {
  it('audits every declared path, counts duplicates, ignores unknown fields, and does not mutate', async () => {
    const databasePath = await fixture();
    TARGET_HASHES.forEach((hash) => insert(databasePath, hash));
    insert(databasePath, 'e'.repeat(64), '');
    insert(
      databasePath,
      OWNER_HASH,
      JSON.stringify({
        sourceImageHash: TARGET_HASHES[0],
        referenceAssetHashes: [TARGET_HASHES[1], TARGET_HASHES[1]],
        sourceVideoHash: TARGET_HASHES[2],
        frameReferenceHashes: { first: TARGET_HASHES[3], last: TARGET_HASHES[4] },
        characterRefs: [{ entityId: 'character-1', imageHashes: [TARGET_HASHES[5]] }],
        equipmentRefs: [{ entityId: 'equipment-1', imageHashes: [TARGET_HASHES[6]] }],
        locationRefs: [{ entityId: 'location-1', imageHashes: [TARGET_HASHES[7]] }],
        unknown: {
          assetHash: MISSING_HASH,
          hash: MISSING_HASH,
          variants: [MISSING_HASH],
        },
      }),
    );
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      coverage: {
        source: 'asset_contents.generation_metadata',
        paths: LEGACY_GENERATION_METADATA_MEDIA_PATHS,
      },
      documentCount: 1,
      referenceCount: 9,
      distinctHashCount: 8,
      blockers: [],
      ok: true,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });

  it('blocks non-text, invalid JSON, and non-object roots deterministically', async () => {
    const databasePath = await fixture();
    insert(databasePath, '1'.repeat(64), Buffer.from('{}'));
    insert(databasePath, '2'.repeat(64), '{');
    insert(databasePath, '3'.repeat(64), '[]');
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first.blockers).toEqual([
      {
        kind: 'invalid_generation_metadata_document',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$',
        reason: 'not_text',
      },
      {
        kind: 'invalid_generation_metadata_document',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$',
        reason: 'invalid_json',
      },
      {
        kind: 'invalid_generation_metadata_document',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$',
        reason: 'not_object',
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });

  it('blocks known shape, hash, and target failures without scanning unknown fields', async () => {
    const databasePath = await fixture();
    insert(databasePath, TARGET_HASHES[0]);
    insert(
      databasePath,
      OWNER_HASH,
      JSON.stringify({
        sourceImageHash: 42,
        referenceAssetHashes: 'not-an-array',
        sourceVideoHash: TARGET_HASHES[0].toUpperCase(),
        frameReferenceHashes: [],
        characterRefs: 'not-an-array',
        equipmentRefs: [null],
        locationRefs: [{ entityId: 'location-without-images' }],
        unknownHash: TARGET_HASHES[0],
        unknownMissingHash: MISSING_HASH,
      }),
    );
    insert(databasePath, 'f'.repeat(64), JSON.stringify({ referenceAssetHashes: [MISSING_HASH] }));
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first.referenceCount).toBe(3);
    expect(first.distinctHashCount).toBe(1);
    expect(first.blockers).toEqual([
      {
        kind: 'invalid_generation_metadata_shape',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$.sourceImageHash',
        expected: 'string',
        actual: 'number',
      },
      {
        kind: 'invalid_generation_metadata_shape',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$.referenceAssetHashes',
        expected: 'array',
        actual: 'string',
      },
      {
        kind: 'invalid_generation_metadata_hash',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$.sourceVideoHash',
        value: TARGET_HASHES[0].toUpperCase(),
        reason: 'not_lowercase_sha256',
      },
      {
        kind: 'invalid_generation_metadata_shape',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$.frameReferenceHashes',
        expected: 'object',
        actual: 'array',
      },
      {
        kind: 'invalid_generation_metadata_shape',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$.characterRefs',
        expected: 'array',
        actual: 'string',
      },
      {
        kind: 'invalid_generation_metadata_shape',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$.equipmentRefs[0]',
        expected: 'object',
        actual: 'null',
      },
      {
        kind: 'invalid_generation_metadata_shape',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$.locationRefs[0].imageHashes',
        expected: 'array',
        actual: 'missing',
      },
      {
        kind: 'missing_generation_metadata_target',
        table: 'asset_contents',
        column: 'generation_metadata',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$.referenceAssetHashes[0]',
        hash: MISSING_HASH,
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });
});
