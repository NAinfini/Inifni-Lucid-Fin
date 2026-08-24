import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_TASK_EVALUATION_MEDIA_COVERAGE,
  preflightLegacyTaskEvaluationMedia,
  type LegacyTaskEvaluationMediaPreflightBlocker,
} from './task-evaluation-media-preflight.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const FRAME_ONE_HASH = hash('evaluation-frame-one');
const FRAME_TWO_HASH = hash('evaluation-frame-two');
const VIDEO_TARGET_HASH = hash('evaluation-video-target');
const MISSING_HASH = hash('evaluation-missing-target');
const temporaryDirectories: string[] = [];

interface EvaluationInput {
  readonly id: string;
  readonly kind: unknown;
  readonly mediaType: unknown;
  readonly frameEvidenceJson: unknown;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-evaluation-media-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE asset_contents (
        hash TEXT PRIMARY KEY,
        type TEXT NOT NULL
      );
      CREATE TABLE task_evaluations (
        id TEXT PRIMARY KEY,
        kind,
        media_type,
        frame_evidence_json
      );
    `);
  } finally {
    database.close();
  }
  return databasePath;
}

function insertAsset(databasePath: string, hashValue: string, type: string): void {
  const database = new DatabaseSync(databasePath);
  try {
    database.prepare('INSERT INTO asset_contents (hash, type) VALUES (?, ?)').run(hashValue, type);
  } finally {
    database.close();
  }
}

function insertEvaluation(databasePath: string, input: EvaluationInput): void {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare(
        `INSERT INTO task_evaluations (
           id, kind, media_type, frame_evidence_json
         ) VALUES (?, ?, ?, ?)`,
      )
      .run(input.id, input.kind, input.mediaType, input.frameEvidenceJson);
  } finally {
    database.close();
  }
}

function report(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return preflightLegacyTaskEvaluationMedia(database);
  } finally {
    database.close();
  }
}

function expectBlocker(
  blockers: readonly LegacyTaskEvaluationMediaPreflightBlocker[],
  expected: Record<string, unknown>,
): void {
  expect(blockers).toContainEqual(expect.objectContaining(expected));
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe('Legacy Task evaluation media preflight', () => {
  it('accepts empty image evidence and audits video frames at only the declared path', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, FRAME_ONE_HASH, 'image');
    insertAsset(databasePath, FRAME_TWO_HASH, 'image');
    insertEvaluation(databasePath, {
      id: 'image-evaluation',
      kind: 'production_media',
      mediaType: 'image',
      frameEvidenceJson: '[]',
    });
    insertEvaluation(databasePath, {
      id: 'video-evaluation',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: JSON.stringify([
        {
          timestampSeconds: 0,
          assetHash: FRAME_ONE_HASH,
          unknown: { assetHash: MISSING_HASH },
        },
        { timestampSeconds: 1.25, assetHash: FRAME_TWO_HASH },
        { timestampSeconds: 2.5, assetHash: FRAME_ONE_HASH },
      ]),
    });
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      coverage: LEGACY_TASK_EVALUATION_MEDIA_COVERAGE,
      evaluationCount: 2,
      imageEvaluationCount: 1,
      videoEvaluationCount: 1,
      documentCount: 2,
      frameCount: 3,
      referenceCount: 3,
      distinctHashCount: 2,
      blockers: [],
      ok: true,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });

  it('blocks invalid discriminators/documents/items/timestamps and invalid image targets', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, FRAME_ONE_HASH, 'image');
    insertAsset(databasePath, VIDEO_TARGET_HASH, 'video');
    insertEvaluation(databasePath, {
      id: 'unknown-kind',
      kind: 'legacy',
      mediaType: 'video',
      frameEvidenceJson: '[]',
    });
    insertEvaluation(databasePath, {
      id: 'null-kind',
      kind: null,
      mediaType: 'video',
      frameEvidenceJson: '[]',
    });
    insertEvaluation(databasePath, {
      id: 'blob-kind',
      kind: Buffer.from('production_media'),
      mediaType: 'video',
      frameEvidenceJson: '[]',
    });
    insertEvaluation(databasePath, {
      id: 'bad-media',
      kind: 'production_media',
      mediaType: 'audio',
      frameEvidenceJson: '[]',
    });
    insertEvaluation(databasePath, {
      id: 'null-media',
      kind: 'production_media',
      mediaType: null,
      frameEvidenceJson: '[]',
    });
    insertEvaluation(databasePath, {
      id: 'blob-media',
      kind: 'production_media',
      mediaType: Buffer.from('video'),
      frameEvidenceJson: '[]',
    });
    insertEvaluation(databasePath, {
      id: 'null-document',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: null,
    });
    insertEvaluation(databasePath, {
      id: 'empty-document',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: '',
    });
    insertEvaluation(databasePath, {
      id: 'blob-document',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: Buffer.from('[]'),
    });
    insertEvaluation(databasePath, {
      id: 'bad-json',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: '[',
    });
    insertEvaluation(databasePath, {
      id: 'object-root',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: '{}',
    });
    insertEvaluation(databasePath, {
      id: 'invalid-items',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: JSON.stringify([
        null,
        { timestampSeconds: 0 },
        { assetHash: FRAME_ONE_HASH },
        { timestampSeconds: '1', assetHash: FRAME_ONE_HASH },
        { timestampSeconds: -1, assetHash: 1 },
      ]),
    });
    insertEvaluation(databasePath, {
      id: 'infinite-timestamp',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: `[{"timestampSeconds":1e400,"assetHash":"${FRAME_ONE_HASH}"}]`,
    });
    insertEvaluation(databasePath, {
      id: 'hashes-and-targets',
      kind: 'production_media',
      mediaType: 'video',
      frameEvidenceJson: JSON.stringify([
        { timestampSeconds: 0, assetHash: FRAME_ONE_HASH.toUpperCase() },
        { timestampSeconds: 1, assetHash: MISSING_HASH },
        { timestampSeconds: 2, assetHash: VIDEO_TARGET_HASH },
      ]),
    });
    insertEvaluation(databasePath, {
      id: 'image-with-frame',
      kind: 'production_media',
      mediaType: 'image',
      frameEvidenceJson: JSON.stringify([{ timestampSeconds: 0, assetHash: FRAME_ONE_HASH }]),
    });
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({ evaluationCount: 15, ok: false });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_kind',
      path: '$column.kind',
      reason: 'unsupported_kind',
      actual: 'legacy',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_kind',
      path: '$column.kind',
      reason: 'not_text',
      actual: 'null',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_kind',
      path: '$column.kind',
      reason: 'not_text',
      actual: 'blob',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_media_type',
      path: '$column.media_type',
      reason: 'unsupported_media_type',
      actual: 'audio',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_media_type',
      path: '$column.media_type',
      reason: 'not_text',
      actual: 'null',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_media_type',
      path: '$column.media_type',
      reason: 'not_text',
      actual: 'blob',
    });
    for (const reason of [
      'null_document',
      'empty_document',
      'not_text',
      'invalid_json',
      'not_array',
    ]) {
      expectBlocker(first.blockers, {
        kind: 'invalid_task_evaluation_frame_document',
        path: '$',
        reason,
      });
    }
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_frame_shape',
      path: '$[0]',
      expected: 'object',
      actual: 'null',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_frame_shape',
      path: '$[1].assetHash',
      expected: 'string',
      actual: 'missing',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_frame_shape',
      path: '$[2].timestampSeconds',
      expected: 'nonnegative_finite_number',
      actual: 'missing',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_frame_shape',
      path: '$[3].timestampSeconds',
      expected: 'nonnegative_finite_number',
      actual: 'string',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_frame_shape',
      path: '$[4].timestampSeconds',
      expected: 'nonnegative_finite_number',
      actual: 'negative_number',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_frame_shape',
      path: '$[0].timestampSeconds',
      expected: 'nonnegative_finite_number',
      actual: 'nonfinite_number',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_frame_shape',
      path: '$[4].assetHash',
      expected: 'string',
      actual: 'number',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_media_hash',
      path: '$[0].assetHash',
      value: FRAME_ONE_HASH.toUpperCase(),
    });
    expectBlocker(first.blockers, {
      kind: 'missing_task_evaluation_media_target',
      path: '$[1].assetHash',
      hash: MISSING_HASH,
      expectedType: 'image',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_task_evaluation_media_target',
      path: '$[2].assetHash',
      hash: VIDEO_TARGET_HASH,
      expectedType: 'image',
      actualType: 'video',
    });
    expectBlocker(first.blockers, {
      kind: 'task_evaluation_frame_evidence_not_allowed',
      mediaType: 'image',
      path: '$',
    });
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });
});
