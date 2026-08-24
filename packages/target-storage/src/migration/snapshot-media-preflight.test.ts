import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';
import { preflightLegacySnapshotMedia } from './snapshot-media-preflight.js';

const IMAGE_HASHES = ['image-a', 'image-b', 'image-c', 'image-d', 'image-e'].map((value) =>
  createHash('sha256').update(value).digest('hex'),
);
const [IMAGE_A, IMAGE_B, IMAGE_C, IMAGE_D, IMAGE_E] = IMAGE_HASHES as [
  string,
  string,
  string,
  string,
  string,
];
const VIDEO_HASH = createHash('sha256').update('video').digest('hex');
const MISSING_HASH = createHash('sha256').update('missing').digest('hex');
const databases: DatabaseSync[] = [];

const SNAPSHOT_TABLES = [
  'canvases',
  'characters',
  'equipment',
  'locations',
  'scripts',
  'preset_overrides',
] as const;
type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  database.exec(`
    CREATE TABLE asset_contents (
      hash TEXT PRIMARY KEY,
      type TEXT,
      duration REAL,
      has_audio INTEGER
    );
    CREATE TABLE snapshots (
      id TEXT PRIMARY KEY,
      schema_version INTEGER,
      data TEXT
    );
  `);
  return database;
}

function sourceColumns(table: SnapshotTable): readonly string[] {
  const definition = I0_LEGACY_SOURCE_SCHEMAS.main.tables.find(
    (candidate) => candidate.name === table,
  );
  if (!definition) throw new Error(`Missing source schema for ${table}`);
  return definition.columns;
}

function snapshotRow(
  table: SnapshotTable,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return Object.fromEntries(
    sourceColumns(table).map((column) => [column, overrides[column] ?? null]),
  );
}

function snapshotData(
  overrides: Partial<Record<SnapshotTable, readonly unknown[]>> = {},
): Record<SnapshotTable, readonly unknown[]> {
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table) => [table, overrides[table] ?? []]),
  ) as Record<SnapshotTable, readonly unknown[]>;
}

function insertSnapshot(
  database: DatabaseSync,
  id: string,
  data: unknown,
  schemaVersion: unknown = 1,
): void {
  database
    .prepare('INSERT INTO snapshots (id, schema_version, data) VALUES (?, ?, ?)')
    .run(
      id,
      schemaVersion,
      typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data),
    );
}

function insertAsset(
  database: DatabaseSync,
  hash: string,
  type: 'image' | 'video',
  duration: number | null = null,
  hasAudio: number | null = null,
): void {
  database
    .prepare('INSERT INTO asset_contents (hash, type, duration, has_audio) VALUES (?, ?, ?, ?)')
    .run(hash, type, duration, hasAudio);
}

function delivery(
  selectedVideoHash: string,
  overrides: Readonly<Record<string, unknown>> = {},
): string {
  return JSON.stringify({
    revision: 1,
    items: [
      {
        shotId: 'shot-1',
        selectedVideoHash,
        trimInMs: 0,
        trimOutMs: 1_000,
        embeddedAudioEnabled: false,
      },
    ],
    updatedAt: 1,
    ...overrides,
  });
}

function snapshotRows(database: DatabaseSync): readonly Record<string, unknown>[] {
  return database
    .prepare('SELECT id, schema_version, data FROM snapshots ORDER BY id')
    .all() as Record<string, unknown>[];
}

describe('Legacy snapshot media preflight', () => {
  it('audits only the exact image and Delivery paths across every snapshot without mutation', () => {
    const database = fixture();
    IMAGE_HASHES.forEach((hash) => insertAsset(database, hash, 'image'));
    insertAsset(database, VIDEO_HASH, 'video', 2, 0);

    insertSnapshot(
      database,
      'snapshot-1',
      snapshotData({
        canvases: [
          snapshotRow('canvases', {
            id: 'canvas-1',
            delivery_sequence_revision: 1,
            delivery_sequence_json: delivery(VIDEO_HASH),
            style_plate: JSON.stringify({ assetHash: MISSING_HASH }),
            negative_prompt: MISSING_HASH,
            resolution_policy_json: JSON.stringify({ assetHash: MISSING_HASH }),
            visual_style_policy_json: JSON.stringify({ assetHash: MISSING_HASH }),
            viewport: JSON.stringify({ assetHash: MISSING_HASH }),
            notes: MISSING_HASH,
          }),
        ],
        characters: [
          snapshotRow('characters', {
            id: 'character-1',
            ref_image: IMAGE_A,
            reference_images: JSON.stringify([
              {
                assetHash: IMAGE_B,
                variants: [IMAGE_C, IMAGE_B],
                nested: { assetHash: MISSING_HASH },
              },
            ]),
          }),
        ],
        equipment: [
          snapshotRow('equipment', {
            id: 'equipment-1',
            reference_images: JSON.stringify([{ assetHash: IMAGE_D, variants: [IMAGE_C] }]),
          }),
        ],
        locations: [
          snapshotRow('locations', {
            id: 'location-1',
            reference_images: JSON.stringify([{ assetHash: IMAGE_E }]),
          }),
        ],
        scripts: [
          snapshotRow('scripts', {
            id: 'script-1',
            content: JSON.stringify({ assetHash: MISSING_HASH }),
          }),
        ],
        preset_overrides: [
          snapshotRow('preset_overrides', {
            id: 'preset-1',
            params: JSON.stringify({ assetHash: MISSING_HASH }),
            prompt: MISSING_HASH,
          }),
        ],
      }),
    );
    insertSnapshot(
      database,
      'snapshot-2',
      snapshotData({
        characters: [
          snapshotRow('characters', {
            id: 'character-2',
            ref_image: IMAGE_A,
            reference_images: null,
          }),
        ],
      }),
    );
    const before = snapshotRows(database);

    const first = preflightLegacySnapshotMedia(database);
    const second = preflightLegacySnapshotMedia(database);

    expect(first).toMatchObject({
      snapshotCount: 2,
      snapshotDocumentCount: 2,
      tableOccurrenceCount: 12,
      rowCount: 7,
      referenceCount: 9,
      distinctHashCount: 6,
      bySource: [
        { table: 'canvases', rowCount: 1, documentCount: 1, referenceCount: 1 },
        { table: 'characters', rowCount: 2, documentCount: 1, referenceCount: 5 },
        { table: 'equipment', rowCount: 1, documentCount: 1, referenceCount: 2 },
        { table: 'locations', rowCount: 1, documentCount: 1, referenceCount: 1 },
      ],
      blockers: [],
      ok: true,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(MISSING_HASH);
    expect(snapshotRows(database)).toEqual(before);
  });

  it('blocks unknown snapshot envelopes and rows instead of guessing their meaning', () => {
    const database = fixture();
    insertSnapshot(database, 'unsupported-version', snapshotData(), 2);
    insertSnapshot(database, 'non-integer-version', snapshotData(), 1.5);
    insertSnapshot(database, 'empty-document', '');
    insertSnapshot(database, 'invalid-json', '{');
    insertSnapshot(database, 'root-array', []);
    insertSnapshot(database, 'wrong-table-set', {
      ...snapshotData(),
      scripts: undefined,
      backup_canvases: [],
    });
    insertSnapshot(database, 'wrong-table-shape', {
      ...snapshotData(),
      characters: {},
    });
    const rowWithUnknownKey = snapshotRow('equipment', { id: 'equipment-unknown' });
    rowWithUnknownKey.future_media = MISSING_HASH;
    const rowMissingKey = snapshotRow('locations', { id: 'location-missing' });
    delete rowMissingKey.weather;
    insertSnapshot(
      database,
      'wrong-row-keys',
      snapshotData({ equipment: [rowWithUnknownKey], locations: [rowMissingKey] }),
    );
    insertSnapshot(database, 'wrong-row-shape', snapshotData({ canvases: [null] }));

    const first = preflightLegacySnapshotMedia(database);
    const second = preflightLegacySnapshotMedia(database);
    const kinds = first.blockers.map((blocker) => blocker.kind);

    expect(kinds).toEqual(
      expect.arrayContaining([
        'invalid_snapshot_schema_version',
        'invalid_snapshot_media_document',
        'invalid_snapshot_media_table_set',
        'invalid_snapshot_media_row_keys',
        'invalid_snapshot_media_row_shape',
      ]),
    );
    expect(first.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'invalid_snapshot_media_table_shape',
          snapshotTable: 'characters',
          path: '$.characters',
          expected: 'array',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_media_row_keys',
          snapshotTable: 'equipment',
          unexpectedFields: ['future_media'],
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_media_row_keys',
          snapshotTable: 'locations',
          missingFields: ['weather'],
        }),
      ]),
    );
    expect(first).toEqual(second);
    expect(first.ok).toBe(false);
  });

  it('validates embedded entity documents, hashes, and image target types', () => {
    const database = fixture();
    insertAsset(database, VIDEO_HASH, 'video', 2, 0);
    insertSnapshot(
      database,
      'entity-errors',
      snapshotData({
        characters: [
          snapshotRow('characters', {
            id: 'character-shape',
            ref_image: 42,
            reference_images: JSON.stringify([
              null,
              { assetHash: MISSING_HASH, variants: 'not-an-array' },
            ]),
          }),
          snapshotRow('characters', {
            id: 'character-wrong-type',
            ref_image: VIDEO_HASH,
            reference_images: '',
          }),
        ],
        equipment: [
          snapshotRow('equipment', {
            id: 'equipment-document',
            reference_images: '{}',
          }),
        ],
        locations: [
          snapshotRow('locations', {
            id: 'location-document',
            reference_images: 7,
          }),
        ],
      }),
    );

    const report = preflightLegacySnapshotMedia(database);

    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'invalid_snapshot_media_shape',
          snapshotTable: 'characters',
          embeddedColumn: 'ref_image',
          expected: 'string',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_media_shape',
          snapshotTable: 'characters',
          path: expect.stringContaining('reference_images::$[0]'),
          expected: 'object',
        }),
        expect.objectContaining({
          kind: 'missing_snapshot_media_target',
          hash: MISSING_HASH,
          expectedType: 'image',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_media_target',
          hash: VIDEO_HASH,
          reason: 'not_image',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_embedded_document',
          snapshotTable: 'equipment',
          reason: 'not_array',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_embedded_document',
          snapshotTable: 'locations',
          reason: 'not_text',
        }),
      ]),
    );
    expect(report.referenceCount).toBe(3);
    expect(report.distinctHashCount).toBe(2);
    expect(report.ok).toBe(false);
  });

  it('reuses strict Delivery validation and checks snapshot video facts without a live mirror', () => {
    const database = fixture();
    insertAsset(database, IMAGE_A, 'image');
    insertAsset(database, VIDEO_HASH, 'video', 1, 0);
    insertSnapshot(
      database,
      'delivery-errors',
      snapshotData({
        canvases: [
          snapshotRow('canvases', {
            id: 'unexpected-field',
            delivery_sequence_revision: 1,
            delivery_sequence_json: delivery(VIDEO_HASH, { future: true }),
          }),
          snapshotRow('canvases', {
            id: 'revision-mismatch',
            delivery_sequence_revision: 2,
            delivery_sequence_json: delivery(VIDEO_HASH),
          }),
          snapshotRow('canvases', {
            id: 'missing-video',
            delivery_sequence_revision: 1,
            delivery_sequence_json: delivery(MISSING_HASH),
          }),
          snapshotRow('canvases', {
            id: 'wrong-video-type',
            delivery_sequence_revision: 1,
            delivery_sequence_json: delivery(IMAGE_A),
          }),
          snapshotRow('canvases', {
            id: 'invalid-video-facts',
            delivery_sequence_revision: 1,
            delivery_sequence_json: delivery(VIDEO_HASH, {
              items: [
                {
                  shotId: 'shot-facts',
                  selectedVideoHash: VIDEO_HASH,
                  trimInMs: 0,
                  trimOutMs: 2_000,
                  embeddedAudioEnabled: true,
                },
              ],
            }),
          }),
        ],
      }),
    );

    const report = preflightLegacySnapshotMedia(database);

    expect(report.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'invalid_snapshot_delivery_sequence',
          path: expect.stringContaining('delivery_sequence_json::$.future'),
          reason: 'unexpected_field',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_delivery_sequence',
          path: expect.stringContaining('delivery_sequence_json::$.revision'),
          reason: 'revision_mismatch',
        }),
        expect.objectContaining({
          kind: 'missing_snapshot_media_target',
          hash: MISSING_HASH,
          expectedType: 'video',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_media_target',
          hash: IMAGE_A,
          reason: 'not_video',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_media_target',
          hash: VIDEO_HASH,
          reason: 'trim_exceeds_duration',
        }),
        expect.objectContaining({
          kind: 'invalid_snapshot_media_target',
          hash: VIDEO_HASH,
          reason: 'embedded_audio_unconfirmed',
        }),
      ]),
    );
    expect(report.referenceCount).toBe(3);
    expect(report.distinctHashCount).toBe(3);
    expect(report.ok).toBe(false);
  });
});
