import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SCHEMA_SQL } from '../../../storage/src/schema-sql.js';
import { preflightLegacyInputs } from './legacy-preflight.js';
import { I0_LEGACY_SOURCE_SCHEMAS } from './legacy-source-schema.js';

const MEDIA_BYTES = Buffer.from('coordinated-legacy-media');
const MEDIA_HASH = createHash('sha256').update(MEDIA_BYTES).digest('hex');
const MEDIA_RELATIVE_PATH = `image/${MEDIA_HASH.slice(0, 2)}/${MEDIA_HASH}.png`;
const VIDEO_BYTES = Buffer.from('coordinated-legacy-delivery-video');
const VIDEO_HASH = createHash('sha256').update(VIDEO_BYTES).digest('hex');
const temporaryDirectories: string[] = [];
const SNAPSHOT_TABLES = [
  'canvases',
  'characters',
  'equipment',
  'locations',
  'scripts',
  'preset_overrides',
] as const;
type SnapshotTable = (typeof SNAPSHOT_TABLES)[number];

interface LegacyFixture {
  readonly directory: string;
  readonly mainDatabasePath: string;
  readonly promptsDatabasePath: string;
  readonly assetsRoot: string;
}

function snapshotRow(
  table: SnapshotTable,
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  const definition = I0_LEGACY_SOURCE_SCHEMAS.main.tables.find(
    (candidate) => candidate.name === table,
  );
  if (!definition) throw new Error(`Missing source schema for ${table}`);
  return Object.fromEntries(
    definition.columns.map((column) => [column, overrides[column] ?? null]),
  );
}

function snapshotData(
  overrides: Partial<Record<SnapshotTable, readonly unknown[]>> = {},
): Record<SnapshotTable, readonly unknown[]> {
  return Object.fromEntries(
    SNAPSHOT_TABLES.map((table) => [table, overrides[table] ?? []]),
  ) as Record<SnapshotTable, readonly unknown[]>;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<LegacyFixture> {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2-legacy-preflight-'));
  temporaryDirectories.push(directory);
  const mainDatabasePath = join(directory, 'lucid-fin.db');
  const promptsDatabasePath = join(directory, 'prompts.db');
  const assetsRoot = join(directory, 'assets');
  await mkdir(assetsRoot);

  const main = new DatabaseSync(mainDatabasePath);
  try {
    main.exec(SCHEMA_SQL);
  } finally {
    main.close();
  }
  const prompts = new DatabaseSync(promptsDatabasePath);
  try {
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
  } finally {
    prompts.close();
  }
  return { directory, mainDatabasePath, promptsDatabasePath, assetsRoot };
}

function insertAsset(source: LegacyFixture, generationMetadata?: string): void {
  const database = new DatabaseSync(source.mainDatabasePath);
  try {
    database
      .prepare(
        `INSERT INTO asset_contents (
           hash, type, format, created_at, file_size, generation_metadata
         ) VALUES (?, 'image', 'png', 1, ?, ?)`,
      )
      .run(MEDIA_HASH, MEDIA_BYTES.byteLength, generationMetadata ?? null);
  } finally {
    database.close();
  }
}

async function writeAsset(source: LegacyFixture): Promise<{ media: string; sidecar: string }> {
  const directory = join(source.assetsRoot, 'image', MEDIA_HASH.slice(0, 2));
  await mkdir(directory, { recursive: true });
  const media = join(directory, `${MEDIA_HASH}.png`);
  const sidecar = join(directory, `${MEDIA_HASH}.meta.json`);
  await Promise.all([writeFile(media, MEDIA_BYTES), writeFile(sidecar, '{}')]);
  return { media, sidecar };
}

function insertDeliveryVideo(source: LegacyFixture): void {
  const database = new DatabaseSync(source.mainDatabasePath);
  try {
    database
      .prepare(
        `INSERT INTO asset_contents (
           hash, type, format, created_at, file_size, duration, has_audio
         ) VALUES (?, 'video', 'mp4', 1, ?, 2, 0)`,
      )
      .run(VIDEO_HASH, VIDEO_BYTES.byteLength);
  } finally {
    database.close();
  }
}

async function writeDeliveryVideo(
  source: LegacyFixture,
): Promise<{ media: string; sidecar: string }> {
  const directory = join(source.assetsRoot, 'video', VIDEO_HASH.slice(0, 2));
  await mkdir(directory, { recursive: true });
  const media = join(directory, `${VIDEO_HASH}.mp4`);
  const sidecar = join(directory, `${VIDEO_HASH}.meta.json`);
  await Promise.all([writeFile(media, VIDEO_BYTES), writeFile(sidecar, '{}')]);
  return { media, sidecar };
}

async function fileFingerprint(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function sourceFingerprints(source: LegacyFixture, media?: string, sidecar?: string) {
  return {
    main: await fileFingerprint(source.mainDatabasePath),
    prompts: await fileFingerprint(source.promptsDatabasePath),
    media: media ? await fileFingerprint(media) : null,
    sidecar: sidecar ? await fileFingerprint(sidecar) : null,
  };
}

describe('Legacy input preflight coordinator', () => {
  it('returns one stable path-free report and leaves every valid input unchanged', async () => {
    const source = await fixture();
    insertAsset(source);
    const assetPaths = await writeAsset(source);
    const before = await sourceFingerprints(source, assetPaths.media, assetPaths.sidecar);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first).toMatchObject({
      source: { ok: true, blockers: [] },
      media: { status: 'checked', report: { ok: true, blockers: [] } },
      scalarMedia: { status: 'checked', report: { ok: true, blockers: [] } },
      generationMetadata: { status: 'checked', report: { ok: true, blockers: [] } },
      entityReferenceImages: { status: 'checked', report: { ok: true, blockers: [] } },
      delivery: { status: 'checked', report: { ok: true, blockers: [] } },
      canvasNodeMedia: { status: 'checked', report: { ok: true, blockers: [] } },
      productionMediaAttempt: { status: 'checked', report: { ok: true, blockers: [] } },
      taskEvaluationMedia: { status: 'checked', report: { ok: true, blockers: [] } },
      snapshotMedia: { status: 'checked', report: { ok: true, blockers: [] } },
      blockers: [],
      ok: true,
    });
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source, assetPaths.media, assetPaths.sidecar)).toEqual(before);
  });

  it('skips media inspection when the complete source preflight is blocked', async () => {
    const source = await fixture();
    const database = new DatabaseSync(source.mainDatabasePath);
    try {
      database.exec('PRAGMA foreign_keys = OFF;');
      database
        .prepare(
          `INSERT INTO asset_entries (id, asset_hash, display_name, tags, created_at)
           VALUES ('orphan-entry', ?, 'Orphan', '[]', 1)`,
        )
        .run(MEDIA_HASH);
    } finally {
      database.close();
    }
    const before = await sourceFingerprints(source);

    const result = await preflightLegacyInputs(source);

    expect(result.source.ok).toBe(false);
    expect(result.media).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.scalarMedia).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.generationMetadata).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.entityReferenceImages).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.delivery).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.canvasNodeMedia).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.productionMediaAttempt).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.taskEvaluationMedia).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'source_preflight_blocked',
    });
    expect(result.blockers).toEqual([
      {
        source: 'main',
        blocker: {
          kind: 'foreign_key_violation',
          table: 'asset_entries',
          rowId: '1',
          parentTable: 'asset_contents',
          foreignKeyId: expect.any(Number),
        },
      },
    ]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(source.directory);
    expect(await sourceFingerprints(source)).toEqual(before);
  });

  it('keeps a valid source report when exact CAS bytes are missing', async () => {
    const source = await fixture();
    insertAsset(source);
    const before = await sourceFingerprints(source);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: false } });
    expect(first.scalarMedia).toEqual({
      status: 'skipped',
      reason: 'media_preflight_blocked',
    });
    expect(first.generationMetadata).toEqual({
      status: 'skipped',
      reason: 'media_preflight_blocked',
    });
    expect(first.entityReferenceImages).toEqual({
      status: 'skipped',
      reason: 'media_preflight_blocked',
    });
    expect(first.delivery).toEqual({
      status: 'skipped',
      reason: 'media_preflight_blocked',
    });
    expect(first.canvasNodeMedia).toEqual({
      status: 'skipped',
      reason: 'media_preflight_blocked',
    });
    expect(first.productionMediaAttempt).toEqual({
      status: 'skipped',
      reason: 'media_preflight_blocked',
    });
    expect(first.taskEvaluationMedia).toEqual({
      status: 'skipped',
      reason: 'media_preflight_blocked',
    });
    expect(first.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'media_preflight_blocked',
    });
    expect(first.blockers).toEqual([
      {
        source: 'media',
        blocker: {
          kind: 'missing_media_bytes',
          hash: MEDIA_HASH,
          expectedRelativePath: MEDIA_RELATIVE_PATH,
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source)).toEqual(before);
  });

  it('blocks a scalar media reference whose asset_contents target is absent', async () => {
    const source = await fixture();
    const missingHash = createHash('sha256').update('missing-style-source').digest('hex');
    const database = new DatabaseSync(source.mainDatabasePath);
    try {
      database
        .prepare(
          `INSERT INTO color_styles (
             id, name, source_type, source_asset, palette, gradients,
             exposure, tags, created_at, updated_at
           ) VALUES ('style-missing', 'Missing', 'manual', ?, '[]', '[]', '{}', '[]', 1, 1)`,
        )
        .run(missingHash);
    } finally {
      database.close();
    }
    const before = await sourceFingerprints(source);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.scalarMedia).toMatchObject({ status: 'checked', report: { ok: false } });
    expect(first.generationMetadata).toEqual({
      status: 'skipped',
      reason: 'scalar_media_preflight_blocked',
    });
    expect(first.entityReferenceImages).toEqual({
      status: 'skipped',
      reason: 'scalar_media_preflight_blocked',
    });
    expect(first.delivery).toEqual({
      status: 'skipped',
      reason: 'scalar_media_preflight_blocked',
    });
    expect(first.canvasNodeMedia).toEqual({
      status: 'skipped',
      reason: 'scalar_media_preflight_blocked',
    });
    expect(first.productionMediaAttempt).toEqual({
      status: 'skipped',
      reason: 'scalar_media_preflight_blocked',
    });
    expect(first.taskEvaluationMedia).toEqual({
      status: 'skipped',
      reason: 'scalar_media_preflight_blocked',
    });
    expect(first.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'scalar_media_preflight_blocked',
    });
    expect(first.blockers).toEqual([
      {
        source: 'scalar-media',
        blocker: {
          kind: 'missing_media_reference_target',
          table: 'color_styles',
          column: 'source_asset',
          rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
          hash: missingHash,
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source)).toEqual(before);
  });

  it('blocks a generation metadata reference whose asset_contents target is absent', async () => {
    const source = await fixture();
    const missingHash = createHash('sha256').update('missing-generation-source').digest('hex');
    insertAsset(source, JSON.stringify({ sourceImageHash: missingHash }));
    const assetPaths = await writeAsset(source);
    const before = await sourceFingerprints(source, assetPaths.media, assetPaths.sidecar);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.scalarMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.generationMetadata).toMatchObject({ status: 'checked', report: { ok: false } });
    expect(first.entityReferenceImages).toEqual({
      status: 'skipped',
      reason: 'generation_metadata_preflight_blocked',
    });
    expect(first.delivery).toEqual({
      status: 'skipped',
      reason: 'generation_metadata_preflight_blocked',
    });
    expect(first.canvasNodeMedia).toEqual({
      status: 'skipped',
      reason: 'generation_metadata_preflight_blocked',
    });
    expect(first.productionMediaAttempt).toEqual({
      status: 'skipped',
      reason: 'generation_metadata_preflight_blocked',
    });
    expect(first.taskEvaluationMedia).toEqual({
      status: 'skipped',
      reason: 'generation_metadata_preflight_blocked',
    });
    expect(first.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'generation_metadata_preflight_blocked',
    });
    expect(first.blockers).toEqual([
      {
        source: 'generation-metadata',
        blocker: {
          kind: 'missing_generation_metadata_target',
          table: 'asset_contents',
          column: 'generation_metadata',
          rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
          path: '$.sourceImageHash',
          hash: missingHash,
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source, assetPaths.media, assetPaths.sidecar)).toEqual(before);
  });

  it('blocks an entity reference image whose asset_contents target is absent', async () => {
    const source = await fixture();
    const missingHash = createHash('sha256').update('missing-entity-reference').digest('hex');
    const database = new DatabaseSync(source.mainDatabasePath);
    try {
      database
        .prepare(
          `INSERT INTO characters (
             id, name, reference_images, created_at, updated_at
           ) VALUES ('character-missing', 'Missing', ?, 1, 1)`,
        )
        .run(JSON.stringify([{ slot: 'main', assetHash: missingHash }]));
    } finally {
      database.close();
    }
    const before = await sourceFingerprints(source);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.scalarMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.generationMetadata).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.entityReferenceImages).toMatchObject({ status: 'checked', report: { ok: false } });
    expect(first.delivery).toEqual({
      status: 'skipped',
      reason: 'entity_reference_images_preflight_blocked',
    });
    expect(first.canvasNodeMedia).toEqual({
      status: 'skipped',
      reason: 'entity_reference_images_preflight_blocked',
    });
    expect(first.productionMediaAttempt).toEqual({
      status: 'skipped',
      reason: 'entity_reference_images_preflight_blocked',
    });
    expect(first.taskEvaluationMedia).toEqual({
      status: 'skipped',
      reason: 'entity_reference_images_preflight_blocked',
    });
    expect(first.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'entity_reference_images_preflight_blocked',
    });
    expect(first.blockers).toEqual([
      {
        source: 'entity-reference-images',
        blocker: {
          kind: 'missing_entity_reference_image_target',
          table: 'characters',
          column: 'reference_images',
          lifecycle: 'active',
          rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
          path: '$[0].assetHash',
          hash: missingHash,
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source)).toEqual(before);
  });

  it('runs Delivery last and reports exact mirror drift without mutating inputs', async () => {
    const source = await fixture();
    insertDeliveryVideo(source);
    const assetPaths = await writeDeliveryVideo(source);
    const database = new DatabaseSync(source.mainDatabasePath);
    try {
      database
        .prepare(
          `INSERT INTO canvases (
             id, name, delivery_sequence_json, delivery_sequence_revision, created_at, updated_at
           ) VALUES ('delivery-canvas', 'Delivery', ?, 1, 1, 1)`,
        )
        .run(
          JSON.stringify({
            revision: 1,
            items: [
              {
                shotId: 'shot-1',
                selectedVideoHash: VIDEO_HASH,
                trimInMs: 0,
                trimOutMs: 1_000,
                embeddedAudioEnabled: false,
              },
            ],
            updatedAt: 1,
          }),
        );
    } finally {
      database.close();
    }
    const before = await sourceFingerprints(source, assetPaths.media, assetPaths.sidecar);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.scalarMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.generationMetadata).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.entityReferenceImages).toMatchObject({
      status: 'checked',
      report: { ok: true },
    });
    expect(first.delivery).toMatchObject({
      status: 'checked',
      report: {
        canvasCount: 1,
        validDocumentCount: 1,
        referenceCount: 1,
        distinctHashCount: 1,
        ok: false,
      },
    });
    expect(first.canvasNodeMedia).toEqual({
      status: 'skipped',
      reason: 'delivery_preflight_blocked',
    });
    expect(first.productionMediaAttempt).toEqual({
      status: 'skipped',
      reason: 'delivery_preflight_blocked',
    });
    expect(first.taskEvaluationMedia).toEqual({
      status: 'skipped',
      reason: 'delivery_preflight_blocked',
    });
    expect(first.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'delivery_preflight_blocked',
    });
    expect(first.blockers).toEqual([
      {
        source: 'delivery',
        blocker: {
          kind: 'delivery_asset_ref_set_mismatch',
          table: 'canvases',
          column: 'delivery_sequence_json',
          rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
          missingFromMirror: [VIDEO_HASH],
          extraInMirror: [],
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source, assetPaths.media, assetPaths.sidecar)).toEqual(before);
  });

  it('runs Canvas-node media last and reports a missing JSON target without mutation', async () => {
    const source = await fixture();
    const missingHash = createHash('sha256').update('missing-canvas-node-media').digest('hex');
    const database = new DatabaseSync(source.mainDatabasePath);
    try {
      database
        .prepare(
          `INSERT INTO canvases (
             id, name, delivery_sequence_revision, created_at, updated_at
           ) VALUES ('node-canvas', 'Node media', 0, 1, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO canvas_nodes (
             id, canvas_id, type, data_json
           ) VALUES ('node-missing', 'node-canvas', 'image', ?)`,
        )
        .run(JSON.stringify({ assetHash: missingHash }));
    } finally {
      database.close();
    }
    const before = await sourceFingerprints(source);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.scalarMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.generationMetadata).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.entityReferenceImages).toMatchObject({
      status: 'checked',
      report: { ok: true },
    });
    expect(first.delivery).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.canvasNodeMedia).toMatchObject({
      status: 'checked',
      report: {
        nodeCount: 1,
        documentCount: 1,
        referenceCount: 1,
        distinctHashCount: 1,
        ok: false,
      },
    });
    expect(first.productionMediaAttempt).toEqual({
      status: 'skipped',
      reason: 'canvas_node_media_preflight_blocked',
    });
    expect(first.taskEvaluationMedia).toEqual({
      status: 'skipped',
      reason: 'canvas_node_media_preflight_blocked',
    });
    expect(first.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'canvas_node_media_preflight_blocked',
    });
    expect(first.blockers).toEqual([
      {
        source: 'canvas-node-media',
        blocker: {
          kind: 'missing_canvas_node_media_target',
          table: 'canvas_nodes',
          column: 'data_json',
          rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
          lifecycle: 'active',
          nodeKind: 'image',
          path: '$.assetHash',
          hash: missingHash,
          expectedType: 'image',
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source)).toEqual(before);
  });

  it('runs production-media attempt JSON after Canvas nodes and reports a missing image target', async () => {
    const source = await fixture();
    const missingHash = createHash('sha256').update('missing-attempt-reference').digest('hex');
    const database = new DatabaseSync(source.mainDatabasePath);
    try {
      database
        .prepare(
          `INSERT INTO canvases (
             id, name, delivery_sequence_revision, created_at, updated_at
           ) VALUES ('attempt-canvas', 'Attempt media', 0, 1, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO task_lists (
             id, task_list_type, entity_type, entity_id, trigger_source,
             status, created_at, updated_at
           ) VALUES ('attempt-list', 'media.generation.v1', 'canvas',
                     'attempt-canvas', 'commander', 'running', 1, 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO tasks (
             id, task_list_id, phase_key, phase_name, phase_order,
             task_key, name, kind, status, updated_at
           ) VALUES ('attempt-task', 'attempt-list', 'generation', 'Generation', 0,
                     'generate', 'Generate', 'adapter_generation', 'running', 1)`,
        )
        .run();
      database
        .prepare(
          `INSERT INTO task_attempts (
             id, task_list_id, task_id, kind, idempotency_key, status,
             canvas_id, node_id, scope, submission_purpose, spec_hash,
             generation_spec_json, media_type, provider_id, model, prompt,
             prompt_hash, estimated_cost_usd, created_at, updated_at
           ) VALUES (
             'attempt-missing', 'attempt-list', 'attempt-task', 'production_media',
             'attempt-idempotency', 'reserved', 'attempt-canvas', 'node-1',
             'canvas', 'initial', 'spec-hash', ?, 'image', 'provider', 'model',
             'prompt', 'prompt-hash', 0, 1, 1
           )`,
        )
        .run(
          JSON.stringify({
            specVersion: 3,
            mediaType: 'image',
            referenceEvidence: [{ assetHash: missingHash }],
            request: { type: 'image' },
          }),
        );
    } finally {
      database.close();
    }
    const before = await sourceFingerprints(source);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.scalarMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.generationMetadata).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.entityReferenceImages).toMatchObject({
      status: 'checked',
      report: { ok: true },
    });
    expect(first.delivery).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.canvasNodeMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.productionMediaAttempt).toMatchObject({
      status: 'checked',
      report: {
        attemptCount: 1,
        productionMediaAttemptCount: 1,
        documentCount: 1,
        referenceCount: 1,
        distinctHashCount: 1,
        ok: false,
      },
    });
    expect(first.taskEvaluationMedia).toEqual({
      status: 'skipped',
      reason: 'production_media_attempt_preflight_blocked',
    });
    expect(first.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'production_media_attempt_preflight_blocked',
    });
    expect(first.blockers).toEqual([
      {
        source: 'production-media-attempt',
        blocker: {
          kind: 'missing_production_media_attempt_media_target',
          table: 'task_attempts',
          column: 'generation_spec_json',
          rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
          path: '$.referenceEvidence[0].assetHash',
          hash: missingHash,
          expectedType: 'image',
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source)).toEqual(before);
  });

  it('runs Task evaluation frame media after attempts and reports a missing extracted frame', async () => {
    const source = await fixture();
    const missingFrameHash = createHash('sha256').update('missing-evaluation-frame').digest('hex');
    insertDeliveryVideo(source);
    const assetPaths = await writeDeliveryVideo(source);
    const database = new DatabaseSync(source.mainDatabasePath);
    try {
      database.exec(`
        INSERT INTO canvases (
          id, name, delivery_sequence_revision, created_at, updated_at
        ) VALUES ('evaluation-canvas', 'Evaluation media', 0, 1, 1);

        INSERT INTO task_lists (
          id, task_list_type, entity_type, entity_id, trigger_source,
          status, created_at, updated_at
        ) VALUES ('evaluation-list', 'media.generation.v1', 'canvas',
                  'evaluation-canvas', 'commander', 'completed', 1, 1);

        INSERT INTO tasks (
          id, task_list_id, phase_key, phase_name, phase_order,
          task_key, name, kind, status, updated_at
        ) VALUES ('evaluation-task', 'evaluation-list', 'generation', 'Generation', 0,
                  'generate', 'Generate', 'adapter_generation', 'completed', 1);
      `);
      database
        .prepare(
          `INSERT INTO task_attempts (
             id, task_list_id, task_id, kind, idempotency_key, status,
             canvas_id, node_id, scope, submission_purpose, spec_hash,
             generation_spec_json, media_type, provider_id, model, prompt,
             prompt_hash, estimated_cost_usd, asset_hash, created_at, updated_at
           ) VALUES (
             'evaluation-attempt', 'evaluation-list', 'evaluation-task', 'production_media',
             'evaluation-idempotency', 'accepted', 'evaluation-canvas', 'node-1',
             'canvas', 'initial', 'spec-hash', ?, 'video', 'provider', 'model',
             'prompt', 'prompt-hash', 0, ?, 1, 1
           )`,
        )
        .run(
          JSON.stringify({
            specVersion: 3,
            mediaType: 'video',
            referenceEvidence: [],
            request: { type: 'video' },
          }),
          VIDEO_HASH,
        );
      database
        .prepare(
          `INSERT INTO task_artifacts (
             id, task_list_id, task_id, attempt_id, artifact_type,
             asset_hash, metadata_json, created_at
           ) VALUES (
             'evaluation-artifact', 'evaluation-list', 'evaluation-task',
             'evaluation-attempt', 'media_output', ?, '{}', 1
           )`,
        )
        .run(VIDEO_HASH);
      database
        .prepare(
          `INSERT INTO task_evaluations (
             id, attempt_id, task_list_id, task_id, kind, canvas_id, node_id,
             artifact_id, asset_hash, media_type, profile, source_prompt_hash,
             rubric_version, evaluator_provider_id, scores_json, total, verdict,
             strengths_json, risks_json, evidence_json, metadata_json,
             frame_evidence_json, created_at
           ) VALUES (
             'evaluation-missing-frame', 'evaluation-attempt', 'evaluation-list',
             'evaluation-task', 'production_media', 'evaluation-canvas', 'node-1',
             'evaluation-artifact', ?, 'video', 'canvas_media.v1', 'prompt-hash',
             'rubric-v1', 'vision-provider', '{}', 90, 'pass', '[]', '[]', '[]',
             '{}', ?, 1
           )`,
        )
        .run(VIDEO_HASH, JSON.stringify([{ timestampSeconds: 0.5, assetHash: missingFrameHash }]));
    } finally {
      database.close();
    }
    const before = await sourceFingerprints(source, assetPaths.media, assetPaths.sidecar);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.scalarMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.generationMetadata).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.entityReferenceImages).toMatchObject({
      status: 'checked',
      report: { ok: true },
    });
    expect(first.delivery).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.canvasNodeMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.productionMediaAttempt).toMatchObject({
      status: 'checked',
      report: { ok: true },
    });
    expect(first.taskEvaluationMedia).toMatchObject({
      status: 'checked',
      report: {
        evaluationCount: 1,
        videoEvaluationCount: 1,
        documentCount: 1,
        frameCount: 1,
        referenceCount: 1,
        distinctHashCount: 1,
        ok: false,
      },
    });
    expect(first.snapshotMedia).toEqual({
      status: 'skipped',
      reason: 'task_evaluation_media_preflight_blocked',
    });
    expect(first.blockers).toEqual([
      {
        source: 'task-evaluation-media',
        blocker: {
          kind: 'missing_task_evaluation_media_target',
          table: 'task_evaluations',
          column: 'frame_evidence_json',
          rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
          path: '$[0].assetHash',
          hash: missingFrameHash,
          expectedType: 'image',
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source, assetPaths.media, assetPaths.sidecar)).toEqual(before);
  });

  it('runs Snapshot media last and reports a missing historical image without mutation', async () => {
    const source = await fixture();
    const missingSnapshotHash = createHash('sha256').update('missing-snapshot-image').digest('hex');
    const database = new DatabaseSync(source.mainDatabasePath);
    try {
      database.exec(`
        INSERT INTO commander_sessions (id, created_at, updated_at)
        VALUES ('snapshot-session', 1, 1);
      `);
      database
        .prepare(
          `INSERT INTO snapshots (
             id, session_id, label, trigger, schema_version, data, created_at
           ) VALUES ('snapshot-missing-image', 'snapshot-session', 'Missing image',
                     'manual', 1, ?, 1)`,
        )
        .run(
          JSON.stringify(
            snapshotData({
              characters: [
                snapshotRow('characters', {
                  id: 'historical-character',
                  ref_image: missingSnapshotHash,
                }),
              ],
            }),
          ),
        );
    } finally {
      database.close();
    }
    const before = await sourceFingerprints(source);

    const first = await preflightLegacyInputs(source);
    const second = await preflightLegacyInputs(source);

    expect(first.source.ok).toBe(true);
    expect(first.media).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.scalarMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.generationMetadata).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.entityReferenceImages).toMatchObject({
      status: 'checked',
      report: { ok: true },
    });
    expect(first.delivery).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.canvasNodeMedia).toMatchObject({ status: 'checked', report: { ok: true } });
    expect(first.productionMediaAttempt).toMatchObject({
      status: 'checked',
      report: { ok: true },
    });
    expect(first.taskEvaluationMedia).toMatchObject({
      status: 'checked',
      report: { ok: true },
    });
    expect(first.snapshotMedia).toMatchObject({
      status: 'checked',
      report: {
        snapshotCount: 1,
        snapshotDocumentCount: 1,
        tableOccurrenceCount: 6,
        rowCount: 1,
        referenceCount: 1,
        distinctHashCount: 1,
        ok: false,
      },
    });
    expect(first.blockers).toEqual([
      {
        source: 'snapshot-media',
        blocker: {
          kind: 'missing_snapshot_media_target',
          table: 'snapshots',
          column: 'data',
          rowKey: expect.stringMatching(/^[0-9a-f]{64}$/),
          snapshotTable: 'characters',
          embeddedColumn: 'ref_image',
          path: '$.characters[0].ref_image',
          hash: missingSnapshotHash,
          expectedType: 'image',
        },
      },
    ]);
    expect(first.ok).toBe(false);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain(source.directory);
    expect(await sourceFingerprints(source)).toEqual(before);
  });
});
