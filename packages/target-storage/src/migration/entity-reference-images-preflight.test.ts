import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_ENTITY_REFERENCE_IMAGE_COVERAGE,
  preflightLegacyEntityReferenceImages,
} from './entity-reference-images-preflight.js';

const TARGET_A = createHash('sha256').update('entity-reference-target-a').digest('hex');
const TARGET_B = createHash('sha256').update('entity-reference-target-b').digest('hex');
const MISSING_HASH = createHash('sha256').update('entity-reference-missing').digest('hex');
const temporaryDirectories: string[] = [];

type EntityTable = 'characters' | 'equipment' | 'locations';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-entity-reference-images-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE asset_contents (hash TEXT PRIMARY KEY);
      CREATE TABLE characters (id TEXT PRIMARY KEY, reference_images TEXT, deleted_at TEXT);
      CREATE TABLE equipment (id TEXT PRIMARY KEY, reference_images TEXT, deleted_at TEXT);
      CREATE TABLE locations (id TEXT PRIMARY KEY, reference_images TEXT, deleted_at TEXT);
    `);
  } finally {
    database.close();
  }
  return databasePath;
}

function insertAsset(databasePath: string, hash: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare('INSERT INTO asset_contents (hash) VALUES (?)').run(hash);
  } finally {
    database.close();
  }
}

function insertEntity(
  databasePath: string,
  table: EntityTable,
  id: string,
  referenceImages: unknown,
  deletedAt: string | null = null,
): void {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare(`INSERT INTO "${table}" (id, reference_images, deleted_at) VALUES (?, ?, ?)`)
      .run(id, referenceImages, deletedAt);
  } finally {
    database.close();
  }
}

function report(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return preflightLegacyEntityReferenceImages(database);
  } finally {
    database.close();
  }
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe('Legacy entity reference images preflight', () => {
  it('audits all active and soft-deleted rows without scanning unknown keys or mutating', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, TARGET_A);
    insertAsset(databasePath, TARGET_B);
    insertEntity(
      databasePath,
      'characters',
      'character-active',
      JSON.stringify([
        {
          slot: 'main',
          assetHash: TARGET_A,
          variants: [TARGET_A, TARGET_B],
          unknownHash: MISSING_HASH,
        },
      ]),
    );
    insertEntity(databasePath, 'characters', 'character-null', null);
    insertEntity(
      databasePath,
      'characters',
      'character-deleted',
      JSON.stringify([{ assetHash: TARGET_B }]),
      '2026-01-01',
    );
    insertEntity(databasePath, 'characters', 'character-empty', '', '2026-01-02');
    insertEntity(
      databasePath,
      'equipment',
      'equipment-active',
      JSON.stringify([{ variants: [TARGET_A] }]),
    );
    insertEntity(
      databasePath,
      'equipment',
      'equipment-deleted',
      JSON.stringify([{ assetHash: TARGET_A }]),
      '2026-01-03',
    );
    insertEntity(
      databasePath,
      'locations',
      'location-active',
      JSON.stringify([{ assetHash: TARGET_B, hash: MISSING_HASH }]),
    );
    insertEntity(databasePath, 'locations', 'location-deleted', '[]', '2026-01-04');
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      coverage: LEGACY_ENTITY_REFERENCE_IMAGE_COVERAGE,
      referenceCount: 7,
      distinctHashCount: 2,
      blockers: [],
      ok: true,
    });
    expect(first.bySource).toEqual([
      {
        table: 'characters',
        column: 'reference_images',
        active: {
          rowCount: 2,
          documentCount: 1,
          referenceCount: 3,
          distinctHashCount: 2,
          nullValueCount: 1,
          emptyValueCount: 0,
        },
        softDeleted: {
          rowCount: 2,
          documentCount: 1,
          referenceCount: 1,
          distinctHashCount: 1,
          nullValueCount: 0,
          emptyValueCount: 1,
        },
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      {
        table: 'equipment',
        column: 'reference_images',
        active: {
          rowCount: 1,
          documentCount: 1,
          referenceCount: 1,
          distinctHashCount: 1,
          nullValueCount: 0,
          emptyValueCount: 0,
        },
        softDeleted: {
          rowCount: 1,
          documentCount: 1,
          referenceCount: 1,
          distinctHashCount: 1,
          nullValueCount: 0,
          emptyValueCount: 0,
        },
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      {
        table: 'locations',
        column: 'reference_images',
        active: {
          rowCount: 1,
          documentCount: 1,
          referenceCount: 1,
          distinctHashCount: 1,
          nullValueCount: 0,
          emptyValueCount: 0,
        },
        softDeleted: {
          rowCount: 1,
          documentCount: 1,
          referenceCount: 0,
          distinctHashCount: 0,
          nullValueCount: 0,
          emptyValueCount: 0,
        },
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });

  it('blocks malformed documents, shapes, hashes, and missing targets deterministically', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, TARGET_A);
    insertEntity(databasePath, 'characters', 'character-invalid-json', '{');
    insertEntity(databasePath, 'characters', 'character-wrong-root', '{}');
    insertEntity(databasePath, 'equipment', 'equipment-blob', Buffer.from('[]'));
    insertEntity(databasePath, 'equipment', 'equipment-item', '[null]', '2026-02-01');
    insertEntity(
      databasePath,
      'locations',
      'location-shapes',
      JSON.stringify([{ assetHash: 42, variants: 'not-an-array' }]),
    );
    insertEntity(
      databasePath,
      'locations',
      'location-targets',
      JSON.stringify([{ assetHash: TARGET_A.toUpperCase(), variants: [MISSING_HASH] }]),
      '2026-02-02',
    );
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first.referenceCount).toBe(3);
    expect(first.distinctHashCount).toBe(1);
    expect(first.blockers).toEqual([
      {
        kind: 'invalid_entity_reference_images_document',
        table: 'characters',
        column: 'reference_images',
        lifecycle: 'active',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$',
        reason: 'invalid_json',
      },
      {
        kind: 'invalid_entity_reference_images_document',
        table: 'characters',
        column: 'reference_images',
        lifecycle: 'active',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$',
        reason: 'not_array',
      },
      {
        kind: 'invalid_entity_reference_images_document',
        table: 'equipment',
        column: 'reference_images',
        lifecycle: 'active',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$',
        reason: 'not_text',
      },
      {
        kind: 'invalid_entity_reference_images_shape',
        table: 'equipment',
        column: 'reference_images',
        lifecycle: 'soft_deleted',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$[0]',
        expected: 'object',
        actual: 'null',
      },
      {
        kind: 'invalid_entity_reference_images_shape',
        table: 'locations',
        column: 'reference_images',
        lifecycle: 'active',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$[0].assetHash',
        expected: 'string',
        actual: 'number',
      },
      {
        kind: 'invalid_entity_reference_images_shape',
        table: 'locations',
        column: 'reference_images',
        lifecycle: 'active',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$[0].variants',
        expected: 'array',
        actual: 'string',
      },
      {
        kind: 'invalid_entity_reference_image_hash',
        table: 'locations',
        column: 'reference_images',
        lifecycle: 'soft_deleted',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$[0].assetHash',
        value: TARGET_A.toUpperCase(),
        reason: 'not_lowercase_sha256',
      },
      {
        kind: 'missing_entity_reference_image_target',
        table: 'locations',
        column: 'reference_images',
        lifecycle: 'soft_deleted',
        rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: '$[0].variants[0]',
        hash: MISSING_HASH,
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });
});
