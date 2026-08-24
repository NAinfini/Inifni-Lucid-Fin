import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_PRODUCTION_MEDIA_ATTEMPT_COVERAGE,
  preflightLegacyProductionMediaAttempts,
  type LegacyProductionMediaAttemptPreflightBlocker,
} from './production-media-attempt-preflight.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const EVIDENCE_HASH = hash('attempt-evidence');
const SOURCE_HASH = hash('attempt-source');
const REFERENCE_HASH = hash('attempt-reference');
const FIRST_FRAME_HASH = hash('attempt-first-frame');
const LAST_FRAME_HASH = hash('attempt-last-frame');
const ARCHIVED_HASH = hash('attempt-archived');
const VIDEO_TARGET_HASH = hash('attempt-video-target');
const MISSING_HASH = hash('attempt-missing');
const temporaryDirectories: string[] = [];

interface AttemptInput {
  readonly id: string;
  readonly canvasId?: string | null;
  readonly kind: unknown;
  readonly mediaType?: unknown;
  readonly generationSpecJson?: unknown;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-production-attempt-media-'));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, 'legacy.sqlite');
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      CREATE TABLE asset_contents (
        hash TEXT PRIMARY KEY,
        type TEXT NOT NULL
      );
      CREATE TABLE canvases (
        id TEXT PRIMARY KEY,
        archived_at INTEGER
      );
      CREATE TABLE task_attempts (
        id TEXT PRIMARY KEY,
        canvas_id TEXT,
        kind,
        media_type,
        generation_spec_json
      );
    `);
    database.prepare('INSERT INTO canvases (id, archived_at) VALUES (?, ?)').run('active', null);
    database.prepare('INSERT INTO canvases (id, archived_at) VALUES (?, ?)').run('archived', 1);
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

function insertAttempt(databasePath: string, input: AttemptInput): void {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare(
        `INSERT INTO task_attempts (
           id, canvas_id, kind, media_type, generation_spec_json
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.canvasId ?? null,
        input.kind,
        input.mediaType ?? null,
        input.generationSpecJson ?? null,
      );
  } finally {
    database.close();
  }
}

function report(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return preflightLegacyProductionMediaAttempts(database);
  } finally {
    database.close();
  }
}

function expectBlocker(
  blockers: readonly LegacyProductionMediaAttemptPreflightBlocker[],
  expected: Record<string, unknown>,
): void {
  expect(blockers).toContainEqual(expect.objectContaining(expected));
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

function generationSpec(input: {
  readonly mediaType: 'image' | 'video';
  readonly evidence: readonly string[];
  readonly source?: string;
  readonly references?: readonly string[];
  readonly first?: string;
  readonly last?: string;
  readonly extraRequest?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    specVersion: 3,
    mediaType: input.mediaType,
    referenceEvidence: input.evidence.map((assetHash) => ({ assetHash, roles: [] })),
    request: {
      type: input.mediaType,
      ...(input.source ? { sourceImageHash: input.source } : {}),
      ...(input.references ? { referenceImages: [...input.references] } : {}),
      ...(input.first || input.last
        ? {
            frameReferenceImages: {
              ...(input.first ? { first: input.first } : {}),
              ...(input.last ? { last: input.last } : {}),
            },
          }
        : {}),
      ...input.extraRequest,
    },
    unknown: { assetHash: MISSING_HASH, referenceImages: [MISSING_HASH] },
  });
}

describe('Legacy production-media attempt preflight', () => {
  it('audits active and archived v3 attempts, duplicates, and only declared image paths', async () => {
    const databasePath = await fixture();
    [
      EVIDENCE_HASH,
      SOURCE_HASH,
      REFERENCE_HASH,
      FIRST_FRAME_HASH,
      LAST_FRAME_HASH,
      ARCHIVED_HASH,
    ].forEach((hashValue) => insertAsset(databasePath, hashValue, 'image'));

    insertAttempt(databasePath, {
      id: 'active-production',
      canvasId: 'active',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: generationSpec({
        mediaType: 'image',
        evidence: [EVIDENCE_HASH, SOURCE_HASH],
        source: SOURCE_HASH,
        references: [REFERENCE_HASH, EVIDENCE_HASH],
        first: FIRST_FRAME_HASH,
        last: LAST_FRAME_HASH,
        extraRequest: { params: { unrelatedAssetHash: MISSING_HASH } },
      }),
    });
    insertAttempt(databasePath, {
      id: 'archived-production',
      canvasId: 'archived',
      kind: 'production_media',
      mediaType: 'video',
      generationSpecJson: generationSpec({
        mediaType: 'video',
        evidence: [ARCHIVED_HASH],
        source: SOURCE_HASH,
        references: [ARCHIVED_HASH],
        first: FIRST_FRAME_HASH,
        last: LAST_FRAME_HASH,
      }),
    });
    insertAttempt(databasePath, { id: 'task', kind: 'task' });
    insertAttempt(databasePath, { id: 'batch', kind: 'batch_export' });
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      coverage: LEGACY_PRODUCTION_MEDIA_ATTEMPT_COVERAGE,
      attemptCount: 4,
      productionMediaAttemptCount: 2,
      archivedProductionMediaAttemptCount: 1,
      documentCount: 2,
      referenceCount: 12,
      distinctHashCount: 6,
      wrongKindDocumentCount: 0,
      blockers: [],
      ok: true,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });

  it('blocks invalid kinds/documents/versions/shapes, path identities, and invalid targets', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, EVIDENCE_HASH, 'image');
    insertAsset(databasePath, VIDEO_TARGET_HASH, 'video');
    insertAttempt(databasePath, { id: 'unknown-kind', kind: 'legacy' });
    insertAttempt(databasePath, { id: 'null-kind', kind: null });
    insertAttempt(databasePath, { id: 'blob-kind', kind: Buffer.from('task') });
    insertAttempt(databasePath, {
      id: 'wrong-kind-task',
      kind: 'task',
      generationSpecJson: '{}',
    });
    insertAttempt(databasePath, {
      id: 'wrong-kind-batch',
      kind: 'batch_export',
      generationSpecJson: Buffer.from('{}'),
    });
    insertAttempt(databasePath, {
      id: 'null-document',
      kind: 'production_media',
      mediaType: 'image',
    });
    insertAttempt(databasePath, {
      id: 'empty-document',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: '',
    });
    insertAttempt(databasePath, {
      id: 'blob-document',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: Buffer.from('{}'),
    });
    insertAttempt(databasePath, {
      id: 'bad-json',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: '{',
    });
    insertAttempt(databasePath, {
      id: 'root-array',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: '[]',
    });
    insertAttempt(databasePath, {
      id: 'missing-version',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: JSON.stringify({
        mediaType: 'image',
        referenceEvidence: [],
        request: { type: 'image' },
      }),
    });
    insertAttempt(databasePath, {
      id: 'wrong-version',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: JSON.stringify({
        specVersion: '3',
        mediaType: 'image',
        referenceEvidence: [],
        request: { type: 'image' },
      }),
    });
    insertAttempt(databasePath, {
      id: 'invalid-shapes',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: JSON.stringify({
        specVersion: 3,
        mediaType: 'image',
        referenceEvidence: [null, {}, { assetHash: 1 }],
        request: {
          type: 'image',
          sourceImageHash: EVIDENCE_HASH.toUpperCase(),
          referenceImages: {},
          frameReferenceImages: [],
        },
      }),
    });
    insertAttempt(databasePath, {
      id: 'identity-and-targets',
      kind: 'production_media',
      mediaType: 'image',
      generationSpecJson: JSON.stringify({
        specVersion: 3,
        mediaType: 'video',
        referenceEvidence: [{ assetHash: MISSING_HASH }],
        request: {
          type: 'video',
          referenceImages: [VIDEO_TARGET_HASH],
          sourceImagePath: 'C:/legacy/source.png',
          params: { sourceImagePath: 'C:/legacy/provider-source.png' },
        },
      }),
    });
    insertAttempt(databasePath, {
      id: 'bad-column-type',
      kind: 'production_media',
      mediaType: 'audio',
      generationSpecJson: generationSpec({ mediaType: 'image', evidence: [] }),
    });
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      attemptCount: 15,
      productionMediaAttemptCount: 10,
      archivedProductionMediaAttemptCount: 0,
      wrongKindDocumentCount: 2,
      ok: false,
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_attempt_kind',
      path: '$column.kind',
      reason: 'unsupported_kind',
      actual: 'legacy',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_attempt_kind',
      path: '$column.kind',
      reason: 'not_text',
      actual: 'null',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_attempt_kind',
      path: '$column.kind',
      reason: 'not_text',
      actual: 'blob',
    });
    expectBlocker(first.blockers, {
      kind: 'production_media_generation_spec_not_allowed',
      attemptKind: 'task',
      path: '$',
    });
    expectBlocker(first.blockers, {
      kind: 'production_media_generation_spec_not_allowed',
      attemptKind: 'batch_export',
      path: '$',
    });
    for (const reason of [
      'null_document',
      'empty_document',
      'not_text',
      'invalid_json',
      'not_object',
    ]) {
      expectBlocker(first.blockers, {
        kind: 'invalid_production_media_generation_spec_document',
        path: '$',
        reason,
      });
    }
    expectBlocker(first.blockers, {
      kind: 'unsupported_production_media_generation_spec_version',
      path: '$.specVersion',
      actual: 'missing',
    });
    expectBlocker(first.blockers, {
      kind: 'unsupported_production_media_generation_spec_version',
      path: '$.specVersion',
      actual: 'string',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_generation_spec_shape',
      path: '$.referenceEvidence[0]',
      expected: 'object',
      actual: 'null',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_generation_spec_shape',
      path: '$.referenceEvidence[1].assetHash',
      expected: 'string',
      actual: 'missing',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_generation_spec_shape',
      path: '$.request.referenceImages',
      expected: 'array',
      actual: 'object',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_generation_spec_shape',
      path: '$.request.frameReferenceImages',
      expected: 'object',
      actual: 'array',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_attempt_media_hash',
      path: '$.request.sourceImageHash',
      value: EVIDENCE_HASH.toUpperCase(),
    });
    expectBlocker(first.blockers, {
      kind: 'production_media_generation_spec_media_type_mismatch',
      columnMediaType: 'image',
      specMediaType: 'video',
      requestMediaType: 'video',
    });
    expectBlocker(first.blockers, {
      kind: 'missing_production_media_attempt_media_target',
      path: '$.referenceEvidence[0].assetHash',
      hash: MISSING_HASH,
      expectedType: 'image',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_attempt_media_target',
      path: '$.request.referenceImages[0]',
      hash: VIDEO_TARGET_HASH,
      expectedType: 'image',
      actualType: 'video',
    });
    expectBlocker(first.blockers, {
      kind: 'production_media_attempt_path_reference_not_allowed',
      path: '$.request.sourceImagePath',
    });
    expectBlocker(first.blockers, {
      kind: 'production_media_attempt_path_reference_not_allowed',
      path: '$.request.params.sourceImagePath',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_production_media_generation_spec_shape',
      path: '$column.media_type',
      expected: 'image_or_video',
      actual: 'audio',
    });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('C:/legacy');
    expect(await fileFingerprint(databasePath)).toBe(before);
  });
});
