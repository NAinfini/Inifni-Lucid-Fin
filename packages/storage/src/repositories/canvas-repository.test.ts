import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { Canvas, CanvasId } from '@lucid-fin/contracts';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import { CanvasEdgeRepository } from './canvas-edge-repository.js';
import { CanvasNodeRepository } from './canvas-node-repository.js';
import { CanvasRepository } from './canvas-repository.js';

const SCHEMA = `
CREATE TABLE asset_contents (
  hash TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  format TEXT NOT NULL,
  duration REAL,
  has_audio INTEGER
);
CREATE TABLE canvases (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  viewport             TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
  notes                TEXT NOT NULL DEFAULT '[]',
  style_plate          TEXT,
  negative_prompt      TEXT,
  default_width        INTEGER,
  default_height       INTEGER,
  publish_width        INTEGER,
  publish_height       INTEGER,
  publish_video_width  INTEGER,
  publish_video_height INTEGER,
  resolution_policy_json TEXT,
  visual_style_policy_json TEXT,
  aspect_ratio         TEXT,
  llm_provider_id      TEXT,
  image_provider_id    TEXT,
  video_provider_id    TEXT,
  audio_provider_id    TEXT,
  delivery_sequence_json TEXT,
  delivery_sequence_revision INTEGER NOT NULL DEFAULT 0 CHECK (delivery_sequence_revision >= 0),
  archived_at          INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
CREATE TABLE canvas_nodes (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  width REAL,
  height REAL,
  data_json TEXT NOT NULL DEFAULT '{}',
  z_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE canvas_edges (
  id TEXT PRIMARY KEY,
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  source_handle TEXT,
  target_handle TEXT,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  auto_label INTEGER NOT NULL DEFAULT 0,
  z_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE delivery_asset_refs (
  canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  asset_hash TEXT NOT NULL REFERENCES asset_contents(hash) ON DELETE RESTRICT,
  PRIMARY KEY (canvas_id, asset_hash)
);
CREATE TABLE task_lists (
  id TEXT PRIMARY KEY,
  task_list_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  progress REAL NOT NULL DEFAULT 0,
  completed_phases INTEGER NOT NULL DEFAULT 0,
  total_phases INTEGER NOT NULL DEFAULT 0,
  completed_tasks INTEGER NOT NULL DEFAULT 0,
  total_tasks INTEGER NOT NULL DEFAULT 0,
  current_phase_key TEXT,
  current_task_id TEXT,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 0,
  current_gate TEXT
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  task_list_id TEXT NOT NULL,
  phase_key TEXT NOT NULL,
  phase_name TEXT NOT NULL,
  phase_order INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  dependency_ids_json TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 0,
  input_json TEXT NOT NULL DEFAULT '{}',
  output_json TEXT NOT NULL DEFAULT '{}',
  error_text TEXT,
  progress REAL NOT NULL DEFAULT 0,
  current_step TEXT,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE TABLE plan_approvals (
  id TEXT PRIMARY KEY,
  task_list_id TEXT NOT NULL,
  gate_key TEXT NOT NULL,
  subject_revision INTEGER NOT NULL,
  subject_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE TABLE task_attempts (
  id TEXT PRIMARY KEY,
  task_list_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL
);
CREATE TABLE task_events (
  task_list_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  event_id TEXT NOT NULL UNIQUE,
  actor TEXT NOT NULL,
  correlation_id TEXT,
  causation_id TEXT,
  payload_json TEXT NOT NULL,
  event_timestamp INTEGER NOT NULL,
  UNIQUE (task_list_id, seq)
);
CREATE TABLE task_artifacts (
  id TEXT PRIMARY KEY,
  task_list_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  attempt_id TEXT,
  artifact_type TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE commander_sessions (
  id TEXT PRIMARY KEY,
  default_canvas_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  messages TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE commander_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES commander_sessions(id) ON DELETE CASCADE,
  default_canvas_id TEXT,
  intent TEXT NOT NULL,
  status TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  last_seq INTEGER NOT NULL DEFAULT 0,
  error_text TEXT
);
CREATE TABLE commander_run_canvases (
  run_id TEXT NOT NULL REFERENCES commander_runs(id) ON DELETE CASCADE,
  canvas_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  released_at INTEGER,
  PRIMARY KEY (run_id, canvas_id)
);
`;

const VIDEO_HASH_1 = 'a'.repeat(64);
const VIDEO_HASH_2 = 'b'.repeat(64);

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

function mkCanvas(id: string, overrides: Partial<Canvas> = {}): Canvas {
  return {
    id,
    name: `canvas ${id}`,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    notes: [],
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('CanvasRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: CanvasRepository;
  const reports: Array<{ schema: string; context?: string }> = [];
  const reporter: DegradeReporter = (info) => {
    reports.push({ schema: info.schema, context: info.context });
  };

  beforeEach(() => {
    db = openDb();
    db.prepare(
      'INSERT INTO asset_contents (hash, type, format, duration, has_audio) VALUES (?, ?, ?, ?, ?)',
    ).run(VIDEO_HASH_1, 'video', 'mp4', 5, 1);
    db.prepare(
      'INSERT INTO asset_contents (hash, type, format, duration, has_audio) VALUES (?, ?, ?, ?, ?)',
    ).run(VIDEO_HASH_2, 'video', 'webm', 4, 0);
    repo = new CanvasRepository(db);
    repo.setGraphRepositories({
      nodes: new CanvasNodeRepository(db),
      edges: new CanvasEdgeRepository(db),
    });
    reports.length = 0;
    setDegradeReporter(reporter);
  });

  afterEach(() => {
    setDegradeReporter(null);
    db.close();
  });

  it('upsert inserts a new canvas', () => {
    repo.upsert(mkCanvas('c1', { name: 'first' }));
    const got = repo.get('c1' as CanvasId);
    expect(got).toBeDefined();
    expect(got!.name).toBe('first');
    expect(got!.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('upsert updates an existing canvas (createdAt preserved, updatedAt advances)', () => {
    repo.upsert(mkCanvas('c1', { name: 'v1', createdAt: 10, updatedAt: 10 }));
    repo.upsert(mkCanvas('c1', { name: 'v2', createdAt: 999, updatedAt: 20 }));
    const got = repo.get('c1' as CanvasId)!;
    expect(got.name).toBe('v2');
    expect(got.createdAt).toBe(10);
    expect(got.updatedAt).toBe(20);
  });

  it('get returns undefined on missing id', () => {
    expect(repo.get('missing' as CanvasId)).toBeUndefined();
  });

  it('list (summary) orders by updatedAt DESC and omits body', () => {
    repo.upsert(mkCanvas('old', { updatedAt: 1 }));
    repo.upsert(mkCanvas('middle', { updatedAt: 5 }));
    repo.upsert(mkCanvas('newest', { updatedAt: 9 }));
    const rows = repo.list();
    expect(rows.map((r) => r.id)).toEqual(['newest', 'middle', 'old']);
    expect(rows[0]).not.toHaveProperty('nodes');
  });

  it('listFull returns canvases with bodies ordered by updatedAt DESC', () => {
    repo.upsert(mkCanvas('a', { updatedAt: 1 }));
    repo.upsert(mkCanvas('b', { updatedAt: 9 }));
    const { rows, degradedCount } = repo.listFull();
    expect(degradedCount).toBe(0);
    expect(rows.map((r) => r.id)).toEqual(['b', 'a']);
    expect(rows[0].viewport).toBeDefined();
  });

  it('archives without deleting data, hides active reads, and restores the same Canvas', () => {
    repo.upsert(mkCanvas('c1'));
    db.prepare(
      `INSERT INTO canvas_nodes
         (id, canvas_id, type, position_x, position_y, data_json, z_index)
       VALUES ('node-1', 'c1', 'text', 0, 0, '{}', 0)`,
    ).run();

    repo.archive('c1' as CanvasId, 200);

    expect(repo.get('c1' as CanvasId)).toBeUndefined();
    expect(repo.getIncludingArchived('c1' as CanvasId)?.archivedAt).toBe(200);
    expect(repo.list()).toEqual([
      { id: 'c1', name: 'canvas c1', archivedAt: 200, updatedAt: 200 },
    ]);
    expect(repo.listFull().rows[0]?.archivedAt).toBe(200);
    expect(db.prepare('SELECT id FROM canvas_nodes WHERE canvas_id = ?').all('c1')).toEqual([
      { id: 'node-1' },
    ]);

    repo.restore('c1' as CanvasId, 300);

    expect(repo.get('c1' as CanvasId)).toMatchObject({ id: 'c1' });
    expect(repo.get('c1' as CanvasId)).not.toHaveProperty('archivedAt');
    expect(repo.getIncludingArchived('c1' as CanvasId)?.updatedAt).toBe(300);
  });

  it('rejects writes to an archived Canvas', () => {
    repo.upsert(mkCanvas('archived-write', { name: 'original' }));
    repo.archive('archived-write' as CanvasId, 200);

    expect(() =>
      repo.upsert(mkCanvas('archived-write', { name: 'should not persist', updatedAt: 300 })),
    ).toThrow(/archived/i);
    expect(repo.getIncludingArchived('archived-write' as CanvasId)?.name).toBe('original');
  });

  it.each(['default', 'run-scope'] as const)(
    'rejects archive transaction while an active Commander run references the Canvas by %s',
    (reference) => {
      repo.upsert(mkCanvas('busy-run'));
      seedCommanderSession(db, 'session-run', 'busy-run');
      db.prepare(
        `INSERT INTO commander_runs
           (id, session_id, default_canvas_id, intent, status, accepted_at)
         VALUES ('run-1', 'session-run', ?, 'edit', 'running', 1)`,
      ).run(reference === 'default' ? 'busy-run' : null);
      if (reference === 'run-scope') {
        db.prepare(
          `INSERT INTO commander_run_canvases (run_id, canvas_id, ordinal, released_at)
           VALUES ('run-1', 'busy-run', 0, NULL)`,
        ).run();
      }

      expect(() => repo.archive('busy-run' as CanvasId, 200)).toThrow(
        /active Commander run/i,
      );
      expect(repo.get('busy-run' as CanvasId)).toBeDefined();
    },
  );

  it.each(['canvas', 'session'] as const)(
    'rejects archive transaction while an unfinished Task List references the %s',
    (reference) => {
      repo.upsert(mkCanvas('busy-task'));
      seedCommanderSession(db, 'session-task', 'busy-task');
      seedTaskList(db, {
        id: 'task-list-1',
        entityType: reference === 'canvas' ? 'canvas' : 'project',
        entityId: reference === 'canvas' ? 'busy-task' : null,
        status: 'running',
        metadata:
          reference === 'session' ? { commanderSessionId: 'session-task' } : {},
      });

      expect(() => repo.archive('busy-task' as CanvasId, 200)).toThrow(
        /unfinished Task List/i,
      );
      expect(repo.get('busy-task' as CanvasId)).toBeDefined();
    },
  );

  it('permanently deletes only an archived Canvas, unassigns sessions, and preserves global Media', () => {
    repo.upsert(mkCanvas('purge'));
    db.prepare(
      `INSERT INTO canvas_nodes
         (id, canvas_id, type, position_x, position_y, data_json, z_index)
       VALUES ('purge-node', 'purge', 'text', 0, 0, '{}', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO canvas_edges
         (id, canvas_id, source, target, status, auto_label, z_index)
       VALUES ('purge-edge', 'purge', 'purge-node', 'purge-node', 'idle', 0, 0)`,
    ).run();
    db.prepare(
      'INSERT INTO delivery_asset_refs (canvas_id, asset_hash) VALUES (?, ?)',
    ).run('purge', VIDEO_HASH_1);
    seedCommanderSession(db, 'session-purge', 'purge');

    expect(() => repo.deletePermanent('purge' as CanvasId)).toThrow(/must be archived/i);
    repo.archive('purge' as CanvasId, 200);
    expect(
      db.prepare('SELECT default_canvas_id FROM commander_sessions WHERE id = ?').get('session-purge'),
    ).toEqual({ default_canvas_id: 'purge' });

    repo.deletePermanent('purge' as CanvasId);

    expect(repo.getIncludingArchived('purge' as CanvasId)).toBeUndefined();
    expect(db.prepare('SELECT id FROM canvas_nodes WHERE canvas_id = ?').all('purge')).toEqual([]);
    expect(db.prepare('SELECT id FROM canvas_edges WHERE canvas_id = ?').all('purge')).toEqual([]);
    expect(
      db.prepare('SELECT default_canvas_id FROM commander_sessions WHERE id = ?').get('session-purge'),
    ).toEqual({ default_canvas_id: null });
    expect(
      db.prepare('SELECT asset_hash FROM delivery_asset_refs WHERE canvas_id = ?').all('purge'),
    ).toEqual([]);
    expect(db.prepare('SELECT hash FROM asset_contents WHERE hash = ?').get(VIDEO_HASH_1)).toEqual({
      hash: VIDEO_HASH_1,
    });
  });

  it('rejects permanent deletion atomically when work starts after archive', () => {
    repo.upsert(mkCanvas('purge-busy'));
    seedCommanderSession(db, 'session-purge-busy', 'purge-busy');
    repo.archive('purge-busy' as CanvasId, 200);
    seedTaskList(db, {
      id: 'task-list-purge',
      entityType: 'canvas',
      entityId: 'purge-busy',
      status: 'awaiting_approval',
      metadata: {},
    });

    expect(() => repo.deletePermanent('purge-busy' as CanvasId)).toThrow(
      /unfinished Task List/i,
    );
    expect(repo.getIncludingArchived('purge-busy' as CanvasId)?.archivedAt).toBe(200);
    expect(
      db
        .prepare('SELECT default_canvas_id FROM commander_sessions WHERE id = ?')
        .get('session-purge-busy'),
    ).toEqual({ default_canvas_id: 'purge-busy' });
  });

  it('fault injection: get skips malformed canvas (invalid viewport JSON) + reports degrade', () => {
    repo.upsert(mkCanvas('good'));
    // Inject a row with an invalid viewport JSON payload.
    db.prepare(
      `INSERT INTO canvases (id, name, viewport, notes, created_at, updated_at)
       VALUES (?, 'bad', ?, '[]', 1, 1)`,
    ).run('bad', '{"broken":');
    // Missing id lookup returns undefined after degrade
    const { rows, degradedCount } = repo.listFull();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    // Telemetry parity with schema-mismatch path: reporter must fire.
    expect(reports.some((r) => r.schema === 'Canvas')).toBe(true);
  });

  it('fault injection: listFull reports degrade on schema mismatch', () => {
    repo.upsert(mkCanvas('good'));
    // Inject a row with a numeric viewport.zoom that parses JSON but fails the schema.
    db.prepare(
      `INSERT INTO canvases (id, name, viewport, notes, created_at, updated_at)
       VALUES (?, ?, ?, '[]', ?, ?)`,
    ).run('schema-bad', 'canvas bad', '{"x":"nope","y":0,"zoom":1}', 1, 1);
    const { rows, degradedCount } = repo.listFull();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'Canvas')).toBe(true);
  });

  it('tolerates empty-string document columns', () => {
    db.prepare(
      `INSERT INTO canvases (id, name, viewport, notes, created_at, updated_at)
       VALUES (?, 'empty-docs', '', '', ?, ?)`,
    ).run('empty-docs', 1, 1);
    const got = repo.get('empty-docs' as CanvasId);
    expect(got).toBeDefined();
    expect(got!.nodes).toEqual([]);
    expect(got!.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('upsert accepts a Tx argument', () => {
    const tx = db.transaction(() => {
      repo.upsert(mkCanvas('tx-canvas', { name: 'tx' }), db);
    });
    tx();
    expect(repo.get('tx-canvas' as CanvasId)?.name).toBe('tx');
  });

  it('round-trips canvas settings columns', () => {
    repo.upsert(
      mkCanvas('cs1', {
        settings: {
          stylePlate: 'neo-noir watercolor, muted teal palette',
          aspectRatio: '9:16',
          llmProviderId: 'anthropic',
          imageProviderId: 'gemini-3-pro-image-preview',
        },
      }),
    );
    const got = repo.get('cs1' as CanvasId);
    expect(got?.settings).toMatchObject({
      stylePlate: 'neo-noir watercolor, muted teal palette',
      aspectRatio: '9:16',
      llmProviderId: 'anthropic',
      imageProviderId: 'gemini-3-pro-image-preview',
    });
  });

  it('round-trips and clears the canonical Canvas visual-style policy', () => {
    const visualStylePolicy = {
      version: 1 as const,
      summary: 'hand-painted neo-noir animation',
      locked: { palette: 'muted teal and ochre', lighting: 'soft chiaroscuro' },
      allowedVariations: ['shot scale', 'weather intensity'],
      negativeConstraints: ['watermark', 'style drift'],
    };
    repo.upsert(mkCanvas('style-policy', { settings: { visualStylePolicy } }));

    expect(repo.get('style-policy' as CanvasId)?.settings?.visualStylePolicy).toEqual(
      visualStylePolicy,
    );

    repo.patchSettings('style-policy' as CanvasId, { visualStylePolicy: null } as never);
    expect(repo.get('style-policy' as CanvasId)?.settings?.visualStylePolicy).toBeUndefined();
  });

  it('patchSettings updates selected columns and ignores absent keys', () => {
    repo.upsert(
      mkCanvas('cs2', {
        settings: { aspectRatio: '16:9', llmProviderId: 'anthropic' },
      }),
    );
    const changed = repo.patchSettings('cs2' as CanvasId, { aspectRatio: '1:1' });
    expect(changed).toBe(1);
    const got = repo.get('cs2' as CanvasId);
    expect(got?.settings?.aspectRatio).toBe('1:1');
    expect(got?.settings?.llmProviderId).toBe('anthropic');
  });

  it('patchSettings with null clears a column', () => {
    repo.upsert(
      mkCanvas('cs3', {
        settings: { stylePlate: 'text-to-clear', aspectRatio: '2.39:1' },
      }),
    );
    repo.patchSettings('cs3' as CanvasId, { stylePlate: null } as never);
    const got = repo.get('cs3' as CanvasId);
    expect(got?.settings?.stylePlate).toBeUndefined();
    expect(got?.settings?.aspectRatio).toBe('2.39:1');
  });

  it('patchSettings returns 0 for an empty patch (no-op)', () => {
    repo.upsert(mkCanvas('cs4'));
    const changed = repo.patchSettings('cs4' as CanvasId, {});
    expect(changed).toBe(0);
  });

  it('ignores unknown aspect ratio values on read (type guard)', () => {
    // Legacy / drifted row with an unsupported aspect_ratio value should not
    // leak through — the rowToCanvas type guard should drop it.
    db.prepare(
      `INSERT INTO canvases
         (id, name, viewport, notes, aspect_ratio, created_at, updated_at)
       VALUES ('legacy-ar', 'legacy', '{"x":0,"y":0,"zoom":1}', '[]', '5:4', 1, 1)`,
    ).run();
    const got = repo.get('legacy-ar' as CanvasId);
    expect(got).toBeDefined();
    expect(got?.settings?.aspectRatio).toBeUndefined();
  });

  it('round-trips negativePrompt and refResolution', () => {
    repo.upsert(
      mkCanvas('cs5', {
        settings: {
          negativePrompt: 'text, watermark, blurry',
          refResolution: { width: 1536, height: 1536 },
        },
      }),
    );
    const got = repo.get('cs5' as CanvasId);
    expect(got?.settings?.negativePrompt).toBe('text, watermark, blurry');
    expect(got?.settings?.refResolution).toEqual({ width: 1536, height: 1536 });
  });

  it('patchSettings patches refResolution atomically (both columns change together)', () => {
    repo.upsert(mkCanvas('cs6'));
    repo.patchSettings('cs6' as CanvasId, { refResolution: { width: 2048, height: 1024 } });
    let got = repo.get('cs6' as CanvasId);
    expect(got?.settings?.refResolution).toEqual({ width: 2048, height: 1024 });
    // Clearing via null should drop both columns.
    repo.patchSettings('cs6' as CanvasId, { refResolution: null } as never);
    got = repo.get('cs6' as CanvasId);
    expect(got?.settings?.refResolution).toBeUndefined();
  });

  it('round-trips publishImageResolution independently of refResolution', () => {
    repo.upsert(
      mkCanvas('cs7', {
        settings: {
          refResolution: { width: 1024, height: 1024 },
          publishImageResolution: { width: 1920, height: 1080 },
          aspectRatio: '16:9',
        },
      }),
    );
    const got = repo.get('cs7' as CanvasId);
    expect(got?.settings?.refResolution).toEqual({ width: 1024, height: 1024 });
    expect(got?.settings?.publishImageResolution).toEqual({ width: 1920, height: 1080 });
    expect(got?.settings?.aspectRatio).toBe('16:9');
  });

  it('patchSettings clears publishImageResolution via null', () => {
    repo.upsert(
      mkCanvas('cs8', {
        settings: { publishImageResolution: { width: 3840, height: 2160 } },
      }),
    );
    repo.patchSettings('cs8' as CanvasId, { publishImageResolution: null } as never);
    const got = repo.get('cs8' as CanvasId);
    expect(got?.settings?.publishImageResolution).toBeUndefined();
  });

  it('round-trips publishVideoResolution independently of image resolution', () => {
    repo.upsert(
      mkCanvas('cs9', {
        settings: {
          publishImageResolution: { width: 3840, height: 2160 },
          publishVideoResolution: { width: 1920, height: 1080 },
        },
      }),
    );
    const got = repo.get('cs9' as CanvasId);
    expect(got?.settings?.publishImageResolution).toEqual({ width: 3840, height: 2160 });
    expect(got?.settings?.publishVideoResolution).toEqual({ width: 1920, height: 1080 });
  });

  it('round-trips and clears the canonical resolution policy JSON', () => {
    repo.upsert(
      mkCanvas('cs10', {
        settings: {
          resolutionPolicy: {
            referenceImage: { mode: 'provider-default' },
            image: { mode: 'exact', width: 2048, height: 2048 },
            video: { mode: 'tier', tier: '1080P', aspectRatio: '16:9' },
          },
        },
      }),
    );

    expect(repo.get('cs10' as CanvasId)?.settings?.resolutionPolicy).toEqual({
      referenceImage: { mode: 'provider-default' },
      image: { mode: 'exact', width: 2048, height: 2048 },
      video: { mode: 'tier', tier: '1080P', aspectRatio: '16:9' },
    });

    repo.patchSettings('cs10' as CanvasId, { resolutionPolicy: null } as never);
    expect(repo.get('cs10' as CanvasId)?.settings?.resolutionPolicy).toBeUndefined();
  });

  it('round-trips a delivery sequence and atomically replaces CAS roots', () => {
    repo.upsert(mkCanvas('delivery'));
    const first = makeDeliverySequence(1, VIDEO_HASH_1, true);
    repo.updateDeliverySequence('delivery' as CanvasId, 0, first);
    expect(repo.get('delivery' as CanvasId)?.deliverySequence).toEqual(first);
    expect(
      db.prepare('SELECT asset_hash FROM delivery_asset_refs WHERE canvas_id = ?').all('delivery'),
    ).toEqual([{ asset_hash: VIDEO_HASH_1 }]);

    const next = makeDeliverySequence(2, VIDEO_HASH_2, false);
    repo.updateDeliverySequence('delivery' as CanvasId, 1, next);
    expect(repo.get('delivery' as CanvasId)?.deliverySequence).toEqual(next);
    expect(
      db.prepare('SELECT asset_hash FROM delivery_asset_refs WHERE canvas_id = ?').all('delivery'),
    ).toEqual([{ asset_hash: VIDEO_HASH_2 }]);
  });

  it('enforces exact delivery CAS while generic Canvas saves preserve it', () => {
    repo.upsert(mkCanvas('delivery-cas'));
    const first = makeDeliverySequence(1, VIDEO_HASH_1, true);
    repo.updateDeliverySequence('delivery-cas' as CanvasId, 0, first);

    expect(() =>
      repo.updateDeliverySequence(
        'delivery-cas' as CanvasId,
        0,
        makeDeliverySequence(1, VIDEO_HASH_2, false),
      ),
    ).toThrow('revision conflict');
    expect(() =>
      repo.updateDeliverySequence(
        'delivery-cas' as CanvasId,
        1,
        makeDeliverySequence(3, VIDEO_HASH_2, false),
      ),
    ).toThrow('expectedRevision + 1');

    repo.upsert(
      mkCanvas('delivery-cas', {
        name: 'generic save',
        deliverySequence: makeDeliverySequence(99, VIDEO_HASH_2, false),
      }),
    );
    expect(repo.get('delivery-cas' as CanvasId)?.deliverySequence).toEqual(first);
  });

  it('rejects missing, non-video, and out-of-bounds delivery assets', () => {
    repo.upsert(mkCanvas('delivery-assets'));
    expect(() =>
      repo.updateDeliverySequence(
        'delivery-assets' as CanvasId,
        0,
        makeDeliverySequence(1, 'e'.repeat(64), false),
      ),
    ).toThrow('not owned by local CAS');

    db.prepare("UPDATE asset_contents SET type = 'audio' WHERE hash = ?").run(VIDEO_HASH_2);
    expect(() =>
      repo.updateDeliverySequence(
        'delivery-assets' as CanvasId,
        0,
        makeDeliverySequence(1, VIDEO_HASH_2, false),
      ),
    ).toThrow('not a video');

    const tooLong = makeDeliverySequence(1, VIDEO_HASH_1, true);
    tooLong.items[0].trimOutMs = 5_001;
    expect(() => repo.updateDeliverySequence('delivery-assets' as CanvasId, 0, tooLong)).toThrow(
      'exceeds video duration',
    );
  });

  it('only enables embedded audio when technical metadata confirms a track', () => {
    repo.upsert(mkCanvas('delivery-audio'));
    expect(() =>
      repo.updateDeliverySequence(
        'delivery-audio' as CanvasId,
        0,
        makeDeliverySequence(1, VIDEO_HASH_2, true),
      ),
    ).toThrow('no confirmed embedded audio');

    expect(() =>
      repo.updateDeliverySequence(
        'delivery-audio' as CanvasId,
        0,
        makeDeliverySequence(1, VIDEO_HASH_2, false),
      ),
    ).not.toThrow();
  });

  it('invalidates Delivery approval and reopens its completed task after a sequence edit', () => {
    repo.upsert(mkCanvas('delivery-approved'));
    repo.updateDeliverySequence(
      'delivery-approved' as CanvasId,
      0,
      makeDeliverySequence(1, VIDEO_HASH_1, true),
    );
    seedDeliveryWorkflow(db, 'delivery-approved', 'completed');

    repo.updateDeliverySequence(
      'delivery-approved' as CanvasId,
      1,
      makeDeliverySequence(2, VIDEO_HASH_2, false),
    );

    expect(db.prepare('SELECT status, decided_at FROM plan_approvals').get()).toEqual({
      status: 'invalidated',
      decided_at: 20,
    });
    expect(
      db
        .prepare(
          'SELECT status, output_json, progress, current_step, completed_at FROM tasks WHERE id = ?',
        )
        .get('delivery-task'),
    ).toEqual({
      status: 'ready',
      output_json: '{}',
      progress: 0,
      current_step: 'sequence_changed',
      completed_at: null,
    });
    expect(
      db
        .prepare(
          'SELECT status, current_gate, current_phase_key, current_task_id, completed_at, row_version FROM task_lists',
        )
        .get(),
    ).toEqual({
      status: 'ready',
      current_gate: null,
      current_phase_key: 'delivery',
      current_task_id: 'delivery-task',
      completed_at: null,
      row_version: 5,
    });
    const event = db.prepare('SELECT payload_json FROM task_events').get() as {
      payload_json: string;
    };
    expect(JSON.parse(event.payload_json)).toMatchObject({
      type: 'task_list.delivery.invalidated',
      canvasId: 'delivery-approved',
      deliverySequenceRevision: 2,
      deliverySequenceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(db.prepare('SELECT artifact_type FROM task_artifacts').all()).toEqual([
      { artifact_type: 'delivery_package' },
    ]);
  });

  it.each(['queued', 'running', 'ready_to_publish', 'recovery_required'])(
    'rejects a sequence edit while a %s batch export can still publish',
    (status) => {
      repo.upsert(mkCanvas('delivery-busy'));
      const first = makeDeliverySequence(1, VIDEO_HASH_1, true);
      repo.updateDeliverySequence('delivery-busy' as CanvasId, 0, first);
      seedDeliveryWorkflow(db, 'delivery-busy', status);

      expect(() =>
        repo.updateDeliverySequence(
          'delivery-busy' as CanvasId,
          1,
          makeDeliverySequence(2, VIDEO_HASH_2, false),
        ),
      ).toThrow(/batch export/i);
      expect(repo.get('delivery-busy' as CanvasId)?.deliverySequence).toEqual(first);
      expect(db.prepare('SELECT status FROM plan_approvals').get()).toEqual({ status: 'approved' });
    },
  );
});

function seedCommanderSession(
  db: BetterSqlite3.Database,
  sessionId: string,
  defaultCanvasId: string,
): void {
  db.prepare(
    `INSERT INTO commander_sessions
       (id, default_canvas_id, title, messages, created_at, updated_at)
     VALUES (?, ?, '', '[]', 1, 1)`,
  ).run(sessionId, defaultCanvasId);
}

function seedTaskList(
  db: BetterSqlite3.Database,
  input: {
    id: string;
    entityType: string;
    entityId: string | null;
    status: string;
    metadata: Record<string, unknown>;
  },
): void {
  db.prepare(
    `INSERT INTO task_lists
       (id, task_list_type, entity_type, entity_id, status, metadata_json, created_at, updated_at)
     VALUES (?, 'test', ?, ?, ?, ?, 1, 1)`,
  ).run(
    input.id,
    input.entityType,
    input.entityId,
    input.status,
    JSON.stringify(input.metadata),
  );
}

function seedDeliveryWorkflow(
  db: BetterSqlite3.Database,
  canvasId: string,
  attemptStatus: string,
): void {
  db.prepare(
    `INSERT INTO task_lists (
       id, task_list_type, entity_type, entity_id, status, summary, progress,
       completed_phases, total_phases, completed_tasks, total_tasks,
       current_phase_key, current_task_id, input_json, output_json, metadata_json,
       created_at, completed_at, updated_at, row_version, current_gate
     ) VALUES (?, 'movie.production.v2', 'canvas', ?, 'completed', 'done', 100,
               1, 1, 1, 1, NULL, NULL, '{}', '{"delivery":true}', '{}',
               1, 90, 90, 4, NULL)`,
  ).run('delivery-list', canvasId);
  db.prepare(
    `INSERT INTO tasks (
       id, task_list_id, phase_key, phase_name, phase_order, task_key, name, kind,
       status, input_json, output_json, progress, current_step, completed_at, updated_at
     ) VALUES ('delivery-task', 'delivery-list', 'delivery', 'Delivery', 1,
               'delivery', 'Prepare delivery', 'export', 'completed',
               '{"taskRole":"delivery"}', '{"manifestRevision":1}', 100, 'completed', 90, 90)`,
  ).run();
  db.prepare(
    `INSERT INTO plan_approvals VALUES (
       'delivery-approval', 'delivery-list', 'delivery', 1, ?, 'approved', 80, 80
     )`,
  ).run('c'.repeat(64));
  db.prepare(
    `INSERT INTO task_attempts VALUES (
       'delivery-attempt', 'delivery-list', 'batch_export', ?
     )`,
  ).run(attemptStatus);
  db.prepare(
    `INSERT INTO task_artifacts VALUES (
       'delivery-artifact', 'delivery-list', 'delivery-task', 'delivery-attempt',
       'delivery_package', '{}', 90
     )`,
  ).run();
}

function makeDeliverySequence(
  revision: number,
  videoHash: string,
  embeddedAudioEnabled: boolean,
): NonNullable<Canvas['deliverySequence']> {
  return {
    revision,
    items: [
      {
        shotId: 'shot-1',
        selectedVideoHash: videoHash,
        trimInMs: 0,
        trimOutMs: 1_000,
        embeddedAudioEnabled,
      },
    ],
    updatedAt: revision * 10,
  };
}
