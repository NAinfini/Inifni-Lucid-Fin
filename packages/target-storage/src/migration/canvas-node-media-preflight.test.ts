import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LEGACY_CANVAS_NODE_MEDIA_COVERAGE,
  preflightLegacyCanvasNodeMedia,
  type LegacyCanvasNodeMediaPreflightBlocker,
} from './canvas-node-media-preflight.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

const IMAGE_ROOT = hash('canvas-node-image-root');
const IMAGE_VARIANT = hash('canvas-node-image-variant');
const IMAGE_SOURCE = hash('canvas-node-image-source');
const IMAGE_CHARACTER = hash('canvas-node-image-character');
const IMAGE_EQUIPMENT = hash('canvas-node-image-equipment');
const IMAGE_LOCATION = hash('canvas-node-image-location');
const IMAGE_HISTORY = hash('canvas-node-image-history');
const IMAGE_HISTORY_SOURCE = hash('canvas-node-image-history-source');
const IMAGE_HISTORY_FIRST = hash('canvas-node-image-history-first');
const IMAGE_HISTORY_LAST = hash('canvas-node-image-history-last');
const IMAGE_HISTORY_CHARACTER = hash('canvas-node-image-history-character');
const IMAGE_HISTORY_EQUIPMENT = hash('canvas-node-image-history-equipment');
const IMAGE_HISTORY_LOCATION = hash('canvas-node-image-history-location');
const IMAGE_ARCHIVED = hash('canvas-node-image-archived');
const VIDEO_ROOT = hash('canvas-node-video-root');
const VIDEO_VARIANT = hash('canvas-node-video-variant');
const VIDEO_HISTORY = hash('canvas-node-video-history');
const AUDIO_ROOT = hash('canvas-node-audio-root');
const AUDIO_VARIANT = hash('canvas-node-audio-variant');
const AUDIO_HISTORY = hash('canvas-node-audio-history');
const MISSING_HASH = hash('canvas-node-missing');
const temporaryDirectories: string[] = [];

interface NodeInput {
  readonly id: string;
  readonly canvasId?: string;
  readonly type: string;
  readonly dataJson: unknown;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-canvas-node-media-'));
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
      CREATE TABLE canvas_nodes (
        id TEXT PRIMARY KEY,
        canvas_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data_json
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

function insertNode(databasePath: string, input: NodeInput): void {
  const database = new DatabaseSync(databasePath);
  try {
    database
      .prepare('INSERT INTO canvas_nodes (id, canvas_id, type, data_json) VALUES (?, ?, ?, ?)')
      .run(input.id, input.canvasId ?? 'active', input.type, input.dataJson);
  } finally {
    database.close();
  }
}

function report(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return preflightLegacyCanvasNodeMedia(database);
  } finally {
    database.close();
  }
}

function expectBlocker(
  blockers: readonly LegacyCanvasNodeMediaPreflightBlocker[],
  expected: Record<string, unknown>,
): void {
  expect(blockers).toContainEqual(expect.objectContaining(expected));
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

describe('Legacy canvas-node media preflight', () => {
  it('audits active and archived media nodes, history, duplicates, and only declared paths', async () => {
    const databasePath = await fixture();
    [
      IMAGE_ROOT,
      IMAGE_VARIANT,
      IMAGE_SOURCE,
      IMAGE_CHARACTER,
      IMAGE_EQUIPMENT,
      IMAGE_LOCATION,
      IMAGE_HISTORY,
      IMAGE_HISTORY_SOURCE,
      IMAGE_HISTORY_FIRST,
      IMAGE_HISTORY_LAST,
      IMAGE_HISTORY_CHARACTER,
      IMAGE_HISTORY_EQUIPMENT,
      IMAGE_HISTORY_LOCATION,
      IMAGE_ARCHIVED,
    ].forEach((hashValue) => insertAsset(databasePath, hashValue, 'image'));
    [VIDEO_ROOT, VIDEO_VARIANT, VIDEO_HISTORY].forEach((hashValue) =>
      insertAsset(databasePath, hashValue, 'video'),
    );
    [AUDIO_ROOT, AUDIO_VARIANT, AUDIO_HISTORY].forEach((hashValue) =>
      insertAsset(databasePath, hashValue, 'audio'),
    );

    insertNode(databasePath, {
      id: 'image',
      type: 'image',
      dataJson: JSON.stringify({
        assetHash: IMAGE_ROOT,
        variants: [IMAGE_VARIANT, IMAGE_ROOT],
        sourceImageHash: IMAGE_SOURCE,
        characterRefs: [{ referenceImageHash: IMAGE_CHARACTER }],
        equipmentRefs: [{ referenceImageHash: IMAGE_EQUIPMENT }],
        locationRefs: [{ referenceImageHash: IMAGE_LOCATION }],
        generationHistory: [
          {
            assetHash: IMAGE_HISTORY,
            sourceImageHash: IMAGE_HISTORY_SOURCE,
            frameReferenceHashes: {
              first: IMAGE_HISTORY_FIRST,
              last: IMAGE_HISTORY_LAST,
            },
            characterRefs: [{ imageHashes: [IMAGE_HISTORY_CHARACTER, IMAGE_HISTORY_CHARACTER] }],
            equipmentRefs: [{ imageHashes: [IMAGE_HISTORY_EQUIPMENT] }],
            locationRefs: [{ imageHashes: [IMAGE_HISTORY_LOCATION] }],
          },
        ],
        unknown: {
          assetHash: MISSING_HASH,
          variants: [MISSING_HASH],
          nested: { sourceImageHash: MISSING_HASH },
        },
      }),
    });
    insertNode(databasePath, {
      id: 'video',
      type: 'video',
      dataJson: JSON.stringify({
        assetHash: VIDEO_ROOT,
        variants: [VIDEO_VARIANT, VIDEO_ROOT],
        sourceImageHash: IMAGE_SOURCE,
        characterRefs: [{ referenceImageHash: IMAGE_CHARACTER }],
        equipmentRefs: [{ referenceImageHash: IMAGE_EQUIPMENT }],
        locationRefs: [{ referenceImageHash: IMAGE_LOCATION }],
        firstFrameAssetHash: IMAGE_HISTORY_FIRST,
        lastFrameAssetHash: IMAGE_HISTORY_LAST,
        generationHistory: [
          {
            assetHash: VIDEO_HISTORY,
            sourceImageHash: IMAGE_HISTORY_SOURCE,
            frameReferenceHashes: {
              first: IMAGE_HISTORY_FIRST,
              last: IMAGE_HISTORY_LAST,
            },
            characterRefs: [{ imageHashes: [IMAGE_HISTORY_CHARACTER] }],
            equipmentRefs: [{ imageHashes: [IMAGE_HISTORY_EQUIPMENT] }],
            locationRefs: [{ imageHashes: [IMAGE_HISTORY_LOCATION] }],
          },
        ],
      }),
    });
    insertNode(databasePath, {
      id: 'audio',
      type: 'audio',
      dataJson: JSON.stringify({
        assetHash: AUDIO_ROOT,
        variants: [AUDIO_VARIANT, AUDIO_ROOT],
        generationHistory: [
          {
            assetHash: AUDIO_HISTORY,
            sourceImageHash: IMAGE_HISTORY_SOURCE,
            frameReferenceHashes: {
              first: IMAGE_HISTORY_FIRST,
              last: IMAGE_HISTORY_LAST,
            },
            characterRefs: [{ imageHashes: [IMAGE_HISTORY_CHARACTER] }],
            equipmentRefs: [{ imageHashes: [IMAGE_HISTORY_EQUIPMENT] }],
            locationRefs: [{ imageHashes: [IMAGE_HISTORY_LOCATION] }],
          },
        ],
      }),
    });
    insertNode(databasePath, {
      id: 'text',
      type: 'text',
      dataJson: JSON.stringify({ content: 'copy' }),
    });
    insertNode(databasePath, {
      id: 'backdrop',
      type: 'backdrop',
      dataJson: JSON.stringify({ color: '#111' }),
    });
    insertNode(databasePath, {
      id: 'archived-image',
      canvasId: 'archived',
      type: 'image',
      dataJson: JSON.stringify({ assetHash: IMAGE_ARCHIVED, variants: [IMAGE_ARCHIVED] }),
    });
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      coverage: LEGACY_CANVAS_NODE_MEDIA_COVERAGE,
      nodeCount: 6,
      archivedNodeCount: 1,
      documentCount: 6,
      referenceCount: 43,
      distinctHashCount: 20,
      unsupportedNodeCount: 0,
      blockers: [],
      ok: true,
    });
    expect(first.byNodeKind).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nodeKind: 'image',
          active: expect.objectContaining({
            rowCount: 1,
            documentCount: 1,
            referenceCount: 15,
            distinctHashCount: 13,
          }),
          archived: expect.objectContaining({
            rowCount: 1,
            documentCount: 1,
            referenceCount: 2,
            distinctHashCount: 1,
          }),
        }),
        expect.objectContaining({
          nodeKind: 'video',
          active: expect.objectContaining({
            rowCount: 1,
            documentCount: 1,
            referenceCount: 16,
            distinctHashCount: 13,
          }),
          archived: expect.objectContaining({ rowCount: 0, referenceCount: 0 }),
        }),
        expect.objectContaining({
          nodeKind: 'audio',
          active: expect.objectContaining({
            rowCount: 1,
            documentCount: 1,
            referenceCount: 10,
            distinctHashCount: 9,
          }),
          archived: expect.objectContaining({ rowCount: 0, referenceCount: 0 }),
        }),
        expect.objectContaining({
          nodeKind: 'text',
          active: expect.objectContaining({ rowCount: 1, documentCount: 1, referenceCount: 0 }),
        }),
        expect.objectContaining({
          nodeKind: 'backdrop',
          active: expect.objectContaining({ rowCount: 1, documentCount: 1, referenceCount: 0 }),
        }),
      ]),
    );
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });

  it('blocks unsupported types, invalid documents and shapes, invalid or missing targets, and forbidden paths', async () => {
    const databasePath = await fixture();
    insertAsset(databasePath, IMAGE_ROOT, 'image');
    insertAsset(databasePath, VIDEO_ROOT, 'video');
    insertAsset(databasePath, AUDIO_ROOT, 'audio');
    insertNode(databasePath, { id: 'unsupported', type: 'llm', dataJson: '{}' });
    insertNode(databasePath, { id: 'null', type: 'image', dataJson: null });
    insertNode(databasePath, { id: 'empty', type: 'image', dataJson: '' });
    insertNode(databasePath, { id: 'blob', type: 'image', dataJson: Buffer.from('{}') });
    insertNode(databasePath, { id: 'json', type: 'image', dataJson: '{' });
    insertNode(databasePath, { id: 'root', type: 'image', dataJson: '[]' });
    insertNode(databasePath, {
      id: 'shapes',
      type: 'image',
      dataJson: JSON.stringify({
        variants: 'not-an-array',
        characterRefs: {},
        generationHistory: [
          {
            assetHash: 1,
            frameReferenceHashes: [],
            characterRefs: {},
            equipmentRefs: [null],
            locationRefs: [{ imageHashes: 'not-an-array' }],
          },
        ],
      }),
    });
    insertNode(databasePath, {
      id: 'hash',
      type: 'image',
      dataJson: JSON.stringify({ assetHash: IMAGE_ROOT.toUpperCase() }),
    });
    insertNode(databasePath, {
      id: 'missing',
      type: 'audio',
      dataJson: JSON.stringify({ assetHash: MISSING_HASH }),
    });
    insertNode(databasePath, {
      id: 'wrong-type',
      type: 'video',
      dataJson: JSON.stringify({ assetHash: IMAGE_ROOT }),
    });
    insertNode(databasePath, {
      id: 'text-media',
      type: 'text',
      dataJson: JSON.stringify({ assetHash: IMAGE_ROOT }),
    });
    insertNode(databasePath, {
      id: 'backdrop-media',
      type: 'backdrop',
      dataJson: JSON.stringify({ variants: [IMAGE_ROOT] }),
    });
    const before = await fileFingerprint(databasePath);

    const first = report(databasePath);
    const second = report(databasePath);

    expect(first).toMatchObject({
      nodeCount: 12,
      archivedNodeCount: 0,
      unsupportedNodeCount: 1,
      ok: false,
    });
    expectBlocker(first.blockers, {
      kind: 'unsupported_canvas_node_type',
      table: 'canvas_nodes',
      column: 'type',
      lifecycle: 'active',
      path: '$column.type',
    });
    for (const reason of [
      'null_document',
      'empty_document',
      'not_text',
      'invalid_json',
      'not_object',
    ]) {
      expectBlocker(first.blockers, {
        kind: 'invalid_canvas_node_media_document',
        table: 'canvas_nodes',
        column: 'data_json',
        nodeKind: 'image',
        lifecycle: 'active',
        path: '$',
        reason,
      });
    }
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_shape',
      nodeKind: 'image',
      path: '$.variants',
      expected: 'array',
      actual: 'string',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_shape',
      nodeKind: 'image',
      path: '$.characterRefs',
      expected: 'array',
      actual: 'object',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_shape',
      nodeKind: 'image',
      path: '$.generationHistory[0].assetHash',
      expected: 'string',
      actual: 'number',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_shape',
      nodeKind: 'image',
      path: '$.generationHistory[0].frameReferenceHashes',
      expected: 'object',
      actual: 'array',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_shape',
      nodeKind: 'image',
      path: '$.generationHistory[0].characterRefs',
      expected: 'array',
      actual: 'object',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_shape',
      nodeKind: 'image',
      path: '$.generationHistory[0].equipmentRefs[0]',
      expected: 'object',
      actual: 'null',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_shape',
      nodeKind: 'image',
      path: '$.generationHistory[0].locationRefs[0].imageHashes',
      expected: 'array',
      actual: 'string',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_hash',
      nodeKind: 'image',
      path: '$.assetHash',
      value: IMAGE_ROOT.toUpperCase(),
      reason: 'not_lowercase_sha256',
    });
    expectBlocker(first.blockers, {
      kind: 'missing_canvas_node_media_target',
      nodeKind: 'audio',
      path: '$.assetHash',
      hash: MISSING_HASH,
      expectedType: 'audio',
    });
    expectBlocker(first.blockers, {
      kind: 'invalid_canvas_node_media_target',
      nodeKind: 'video',
      path: '$.assetHash',
      hash: IMAGE_ROOT,
      expectedType: 'video',
      actualType: 'image',
    });
    expectBlocker(first.blockers, {
      kind: 'canvas_node_media_path_not_allowed',
      nodeKind: 'text',
      path: '$.assetHash',
    });
    expectBlocker(first.blockers, {
      kind: 'canvas_node_media_path_not_allowed',
      nodeKind: 'backdrop',
      path: '$.variants',
    });
    expect(first).toEqual(second);
    expect(await fileFingerprint(databasePath)).toBe(before);
  });
});
