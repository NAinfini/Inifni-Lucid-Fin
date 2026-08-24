import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_DELIVERY_MEDIA_PATHS,
  preflightLegacyDelivery,
  type LegacyDeliveryPreflightBlocker,
} from './delivery-preflight.js';

const VIDEO_A = createHash('sha256').update('delivery-video-a').digest('hex');
const VIDEO_B = createHash('sha256').update('delivery-video-b').digest('hex');
const IMAGE = createHash('sha256').update('delivery-image').digest('hex');
const NO_DURATION = createHash('sha256').update('delivery-no-duration').digest('hex');
const SHORT_VIDEO = createHash('sha256').update('delivery-short-video').digest('hex');
const EXTRA_VIDEO = createHash('sha256').update('delivery-extra-video').digest('hex');
const MISSING_VIDEO = createHash('sha256').update('delivery-missing-video').digest('hex');
const temporaryDirectories: string[] = [];

interface CanvasInput {
  readonly id: string;
  readonly sequenceJson: unknown;
  readonly revision: unknown;
  readonly archivedAt?: number | null;
  readonly refs?: readonly string[];
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-delivery-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE asset_contents (
        hash TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        duration REAL,
        has_audio INTEGER
      );
      CREATE TABLE canvases (
        id TEXT PRIMARY KEY,
        archived_at INTEGER,
        delivery_sequence_json TEXT,
        delivery_sequence_revision INTEGER
      );
      CREATE TABLE delivery_asset_refs (
        canvas_id TEXT NOT NULL,
        asset_hash TEXT NOT NULL,
        PRIMARY KEY (canvas_id, asset_hash)
      ) WITHOUT ROWID;
    `);
  } finally {
    database.close();
  }
  return databasePath;
}

function insertAsset(
  databasePath: string,
  hash: string,
  type: string,
  duration: unknown,
  hasAudio: unknown,
): void {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare('INSERT INTO asset_contents (hash, type, duration, has_audio) VALUES (?, ?, ?, ?)')
      .run(hash, type, duration, hasAudio);
  } finally {
    database.close();
  }
}

function insertCanvas(databasePath: string, input: CanvasInput): void {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare(
        `INSERT INTO canvases (
           id, archived_at, delivery_sequence_json, delivery_sequence_revision
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(input.id, input.archivedAt ?? null, input.sequenceJson, input.revision);
    const insertRef = database.prepare(
      'INSERT INTO delivery_asset_refs (canvas_id, asset_hash) VALUES (?, ?)',
    );
    for (const hash of input.refs ?? []) insertRef.run(input.id, hash);
  } finally {
    database.close();
  }
}

function report(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return preflightLegacyDelivery(database);
  } finally {
    database.close();
  }
}

function blockerDetails(blocker: LegacyDeliveryPreflightBlocker) {
  const { rowKey, ...details } = blocker;
  void rowKey;
  return details;
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe('Legacy Delivery preflight', () => {
  it('audits active, archived, repeated, and null Delivery state without mutation', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, VIDEO_A, 'video', 5, 1);
    insertAsset(databasePath, VIDEO_B, 'video', 10, 0);
    const items = [
      {
        shotId: 'shot-a',
        selectedVideoHash: VIDEO_A,
        trimInMs: 0,
        trimOutMs: 1_000,
        embeddedAudioEnabled: true,
      },
      {
        shotId: 'shot-a-repeat',
        selectedVideoHash: VIDEO_A,
        trimInMs: 1_000,
        trimOutMs: 2_000,
        embeddedAudioEnabled: false,
      },
      {
        shotId: 'shot-b',
        selectedVideoHash: VIDEO_B,
        trimInMs: 0,
        trimOutMs: 5_000,
        embeddedAudioEnabled: false,
      },
    ];
    insertCanvas(databasePath, {
      id: 'active',
      sequenceJson: JSON.stringify({ revision: 2, items, updatedAt: 20 }),
      revision: 2,
      refs: [VIDEO_A, VIDEO_B],
    });
    insertCanvas(databasePath, {
      id: 'archived',
      sequenceJson: JSON.stringify({ revision: 1, items: [], updatedAt: 10 }),
      revision: 1,
      archivedAt: 30,
    });
    insertCanvas(databasePath, { id: 'never-set', sequenceJson: null, revision: 0 });
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      coverage: {
        source: 'canvases.delivery_sequence_json',
        paths: LEGACY_DELIVERY_MEDIA_PATHS,
        mirror: 'delivery_asset_refs.asset_hash',
        includesArchivedCanvases: true,
      },
      canvasCount: 3,
      archivedCanvasCount: 1,
      documentCount: 2,
      validDocumentCount: 2,
      nullDocumentCount: 1,
      emptyValueCount: 0,
      itemCount: 3,
      referenceCount: 3,
      distinctHashCount: 2,
      blockers: [],
      ok: true,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);

    const database = new DatabaseSync(databasePath);
    try {
      database
        .prepare('UPDATE canvases SET delivery_sequence_json = ? WHERE id = ?')
        .run(JSON.stringify({ revision: 2, items: [...items].reverse(), updatedAt: 20 }), 'active');
    } finally {
      database.close();
    }
    expect(report(databasePath).fingerprint).not.toBe(first.fingerprint);
  });

  it('blocks invalid storage, JSON, revision, and null-mirror states deterministically', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, VIDEO_A, 'video', 5, 1);
    insertCanvas(databasePath, { id: '01-empty', sequenceJson: '', revision: 0 });
    insertCanvas(databasePath, { id: '02-whitespace', sequenceJson: '   ', revision: 0 });
    insertCanvas(databasePath, {
      id: '03-blob',
      sequenceJson: Buffer.from('{}'),
      revision: 0,
    });
    insertCanvas(databasePath, { id: '04-broken', sequenceJson: '{', revision: 1 });
    insertCanvas(databasePath, { id: '05-root', sequenceJson: '[]', revision: 1 });
    insertCanvas(databasePath, { id: '06-null-valid', sequenceJson: null, revision: 0 });
    insertCanvas(databasePath, {
      id: '07-null-extra-ref',
      sequenceJson: null,
      revision: 0,
      refs: [VIDEO_A],
    });
    insertCanvas(databasePath, { id: '08-null-positive', sequenceJson: null, revision: 1 });
    insertCanvas(databasePath, { id: '09-null-invalid', sequenceJson: null, revision: 'bad' });
    insertCanvas(databasePath, {
      id: '10-revision-mismatch',
      sequenceJson: JSON.stringify({ revision: 2, items: [], updatedAt: 1 }),
      revision: 1,
    });
    insertCanvas(databasePath, {
      id: '11-document-invalid-revision',
      sequenceJson: JSON.stringify({ revision: 1, items: [], updatedAt: 1 }),
      revision: 'bad',
    });

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      canvasCount: 11,
      documentCount: 7,
      validDocumentCount: 0,
      nullDocumentCount: 4,
      emptyValueCount: 1,
      itemCount: 0,
      referenceCount: 0,
      distinctHashCount: 0,
      ok: false,
    });
    expect(first.blockers.map(blockerDetails)).toEqual([
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$',
        reason: 'empty_document',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$',
        reason: 'invalid_json',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$',
        reason: 'not_text',
        actual: 'blob',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$',
        reason: 'invalid_json',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$',
        reason: 'not_object',
        actual: 'array',
      },
      {
        kind: 'delivery_asset_ref_set_mismatch',
        table: 'canvases',
        column: 'delivery_sequence_json',
        missingFromMirror: [],
        extraInMirror: [VIDEO_A],
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.revision',
        reason: 'null_revision_mismatch',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$column.delivery_sequence_revision',
        reason: 'column_revision_invalid',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.revision',
        reason: 'revision_mismatch',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$column.delivery_sequence_revision',
        reason: 'column_revision_invalid',
      },
    ]);
    expect(first).toEqual(second);
  });

  it('blocks every strict root and item shape violation using exact paths', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, VIDEO_A, 'video', 5, 1);
    insertCanvas(databasePath, {
      id: 'shape',
      revision: 1,
      sequenceJson: JSON.stringify({
        extraRoot: true,
        revision: 1,
        updatedAt: -1,
        items: [
          {
            extraItem: true,
            shotId: 'same',
            selectedVideoHash: VIDEO_A.toUpperCase(),
            trimInMs: -1,
            trimOutMs: 0.5,
            embeddedAudioEnabled: 'yes',
          },
          {
            shotId: ' same ',
            selectedVideoHash: VIDEO_A,
            trimInMs: 10,
            trimOutMs: 10,
            embeddedAudioEnabled: false,
          },
          {},
          null,
          {
            shotId: '   ',
            selectedVideoHash: VIDEO_A,
            trimInMs: 0,
            trimOutMs: 1,
            embeddedAudioEnabled: false,
          },
        ],
      }),
    });

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      documentCount: 1,
      validDocumentCount: 0,
      itemCount: 0,
      referenceCount: 0,
      distinctHashCount: 0,
      ok: false,
    });
    expect(first.blockers.map(blockerDetails)).toEqual([
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.extraRoot',
        reason: 'unexpected_field',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.updatedAt',
        reason: 'not_nonnegative_integer',
        actual: 'number',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[0].extraItem',
        reason: 'unexpected_field',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[0].selectedVideoHash',
        reason: 'not_lowercase_sha256',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[0].trimInMs',
        reason: 'not_nonnegative_integer',
        actual: 'number',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[0].trimOutMs',
        reason: 'not_nonnegative_integer',
        actual: 'number',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[0].embeddedAudioEnabled',
        reason: 'not_boolean',
        actual: 'string',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[1].shotId',
        reason: 'duplicate_shot_id',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[1].trimOutMs',
        reason: 'trim_not_increasing',
      },
      ...['shotId', 'selectedVideoHash', 'trimInMs', 'trimOutMs', 'embeddedAudioEnabled'].map(
        (field) => ({
          kind: 'invalid_delivery_sequence' as const,
          table: 'canvases' as const,
          column: 'delivery_sequence_json' as const,
          path: `$.items[2].${field}`,
          reason: 'missing_field' as const,
        }),
      ),
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[3]',
        reason: 'not_object',
        actual: 'null',
      },
      {
        kind: 'invalid_delivery_sequence',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[4].shotId',
        reason: 'blank_string',
      },
    ]);
    expect(first).toEqual(second);
  });

  it('blocks missing or invalid video facts and exact mirror-set drift', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, IMAGE, 'image', 1, 1);
    insertAsset(databasePath, NO_DURATION, 'video', null, 1);
    insertAsset(databasePath, SHORT_VIDEO, 'video', 1, 0);
    insertAsset(databasePath, EXTRA_VIDEO, 'video', 5, 1);
    const items = [
      {
        shotId: 'image',
        selectedVideoHash: IMAGE,
        trimInMs: 0,
        trimOutMs: 500,
        embeddedAudioEnabled: false,
      },
      {
        shotId: 'missing',
        selectedVideoHash: MISSING_VIDEO,
        trimInMs: 0,
        trimOutMs: 500,
        embeddedAudioEnabled: false,
      },
      {
        shotId: 'no-duration',
        selectedVideoHash: NO_DURATION,
        trimInMs: 0,
        trimOutMs: 500,
        embeddedAudioEnabled: true,
      },
      {
        shotId: 'short',
        selectedVideoHash: SHORT_VIDEO,
        trimInMs: 0,
        trimOutMs: 2_000,
        embeddedAudioEnabled: true,
      },
    ];
    insertCanvas(databasePath, {
      id: 'technical',
      sequenceJson: JSON.stringify({ revision: 1, items, updatedAt: 1 }),
      revision: 1,
      refs: [IMAGE, NO_DURATION, SHORT_VIDEO, EXTRA_VIDEO],
    });

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      validDocumentCount: 1,
      itemCount: 4,
      referenceCount: 4,
      distinctHashCount: 4,
      ok: false,
    });
    expect(first.blockers.map(blockerDetails)).toEqual([
      {
        kind: 'invalid_delivery_video_target',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[0].selectedVideoHash',
        hash: IMAGE,
        reason: 'not_video',
      },
      {
        kind: 'missing_delivery_video_target',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[1].selectedVideoHash',
        hash: MISSING_VIDEO,
      },
      {
        kind: 'invalid_delivery_video_target',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[2].selectedVideoHash',
        hash: NO_DURATION,
        reason: 'duration_unavailable',
      },
      {
        kind: 'invalid_delivery_video_target',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[3].trimOutMs',
        hash: SHORT_VIDEO,
        reason: 'trim_exceeds_duration',
      },
      {
        kind: 'invalid_delivery_video_target',
        table: 'canvases',
        column: 'delivery_sequence_json',
        path: '$.items[3].embeddedAudioEnabled',
        hash: SHORT_VIDEO,
        reason: 'embedded_audio_unconfirmed',
      },
      {
        kind: 'delivery_asset_ref_set_mismatch',
        table: 'canvases',
        column: 'delivery_sequence_json',
        missingFromMirror: [MISSING_VIDEO],
        extraInMirror: [EXTRA_VIDEO],
      },
    ]);
    expect(first).toEqual(second);

    const database = new DatabaseSync(databasePath);
    try {
      database.prepare('UPDATE asset_contents SET duration = 1.5 WHERE hash = ?').run(SHORT_VIDEO);
    } finally {
      database.close();
    }
    const changedFacts = report(databasePath);
    expect(changedFacts.blockers).toEqual(first.blockers);
    expect(changedFacts.fingerprint).not.toBe(first.fingerprint);
  });
});
