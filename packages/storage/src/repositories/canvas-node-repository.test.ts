import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { CanvasNode, CanvasId } from '@lucid-fin/contracts';
import { CanvasNodeRepository } from './canvas-node-repository.js';
import { CanvasRepository } from './canvas-repository.js';

const CANVAS_SCHEMA = `
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
  delivery_sequence_revision INTEGER NOT NULL DEFAULT 0,
  archived_at          INTEGER,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);

CREATE TABLE task_lists (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  status TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE commander_sessions (
  id TEXT PRIMARY KEY,
  default_canvas_id TEXT
);

CREATE TABLE commander_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  default_canvas_id TEXT,
  status TEXT NOT NULL
);

CREATE TABLE commander_run_canvases (
  run_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  released_at INTEGER,
  PRIMARY KEY (run_id, canvas_id)
);

CREATE TABLE canvas_nodes (
  id         TEXT PRIMARY KEY,
  canvas_id  TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  position_x REAL NOT NULL DEFAULT 0,
  position_y REAL NOT NULL DEFAULT 0,
  width      REAL,
  height     REAL,
  data_json  TEXT NOT NULL DEFAULT '{}',
  z_index    INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_canvas_nodes_canvas_id ON canvas_nodes(canvas_id);
CREATE INDEX idx_canvas_nodes_type ON canvas_nodes(type);
CREATE INDEX idx_canvas_nodes_canvas_type ON canvas_nodes(canvas_id, type);

CREATE TABLE canvas_edges (
  id            TEXT PRIMARY KEY,
  canvas_id     TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  target        TEXT NOT NULL,
  source_handle TEXT,
  target_handle TEXT,
  label         TEXT,
  status        TEXT NOT NULL DEFAULT 'idle',
  auto_label    INTEGER NOT NULL DEFAULT 0,
  z_index       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(CANVAS_SCHEMA);
  return db;
}

function mkNode(id: string, overrides: Partial<CanvasNode> = {}): CanvasNode {
  return {
    id,
    type: 'image',
    position: { x: 100, y: 200 },
    data: {
      assetHash: undefined,
      status: 'empty',
      variants: [],
      selectedVariantIndex: 0,
    },
    title: `Node ${id}`,
    bypassed: false,
    locked: false,
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

function insertCanvas(db: BetterSqlite3.Database, id: string): void {
  db.prepare(`INSERT INTO canvases (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
    id,
    `Canvas ${id}`,
    100,
    100,
  );
}

describe('CanvasNodeRepository', () => {
  let db: BetterSqlite3.Database;
  let repo: CanvasNodeRepository;

  beforeEach(() => {
    db = openDb();
    repo = new CanvasNodeRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it('upsertMany inserts nodes and getByCanvasId retrieves them', () => {
    insertCanvas(db, 'c1');
    const nodes = [mkNode('n1'), mkNode('n2', { position: { x: 300, y: 400 } })];
    repo.upsertMany('c1', nodes);

    const result = repo.getByCanvasId('c1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('n1');
    expect(result[0].position).toEqual({ x: 100, y: 200 });
    expect(result[0].title).toBe('Node n1');
    expect(result[1].id).toBe('n2');
    expect(result[1].position).toEqual({ x: 300, y: 400 });
  });

  it('round-trips all CanvasNode properties', () => {
    insertCanvas(db, 'c1');
    const node = mkNode('n1', {
      type: 'video',
      position: { x: 42.5, y: -100.3 },
      width: 300,
      height: 200,
      title: 'Test Video',
      bypassed: true,
      locked: true,
      colorTag: 'red',
      tags: ['tag1', 'tag2'],
      groupId: 'g1',
      parentId: 'p1',
      createdAt: 5000,
      updatedAt: 6000,
    });
    repo.upsertMany('c1', [node]);

    const [result] = repo.getByCanvasId('c1');
    expect(result.id).toBe('n1');
    expect(result.type).toBe('video');
    expect(result.position.x).toBeCloseTo(42.5);
    expect(result.position.y).toBeCloseTo(-100.3);
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
    expect(result.title).toBe('Test Video');
    expect(result.bypassed).toBe(true);
    expect(result.locked).toBe(true);
    expect(result.colorTag).toBe('red');
    expect(result.tags).toEqual(['tag1', 'tag2']);
    expect(result.groupId).toBe('g1');
    expect(result.parentId).toBe('p1');
    expect(result.createdAt).toBe(5000);
    expect(result.updatedAt).toBe(6000);
  });

  it('upsertMany deletes orphaned nodes', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkNode('n1'), mkNode('n2'), mkNode('n3')]);
    expect(repo.getByCanvasId('c1')).toHaveLength(3);

    // Remove n2
    repo.upsertMany('c1', [mkNode('n1'), mkNode('n3')]);
    const result = repo.getByCanvasId('c1');
    expect(result).toHaveLength(2);
    expect(result.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('upsertMany with empty array clears all nodes', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkNode('n1'), mkNode('n2')]);
    repo.upsertMany('c1', []);
    expect(repo.getByCanvasId('c1')).toHaveLength(0);
  });

  it('upsertMany updates existing nodes', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkNode('n1', { position: { x: 0, y: 0 } })]);
    repo.upsertMany('c1', [mkNode('n1', { position: { x: 500, y: 600 } })]);
    const [result] = repo.getByCanvasId('c1');
    expect(result.position).toEqual({ x: 500, y: 600 });
  });

  it('deleteByCanvasId removes all nodes for a canvas', () => {
    insertCanvas(db, 'c1');
    insertCanvas(db, 'c2');
    repo.upsertMany('c1', [mkNode('n1'), mkNode('n2')]);
    repo.upsertMany('c2', [mkNode('n3')]);

    repo.deleteByCanvasId('c1');
    expect(repo.getByCanvasId('c1')).toHaveLength(0);
    expect(repo.getByCanvasId('c2')).toHaveLength(1);
  });

  it('deleteByIds removes specific nodes', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkNode('n1'), mkNode('n2'), mkNode('n3')]);

    repo.deleteByIds(['n1', 'n3']);
    const result = repo.getByCanvasId('c1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('n2');
  });

  it('deleteByIds with empty array is a no-op', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkNode('n1')]);
    repo.deleteByIds([]);
    expect(repo.getByCanvasId('c1')).toHaveLength(1);
  });

  it('getByType filters nodes by type', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [
      mkNode('n1', { type: 'image' }),
      mkNode('n2', { type: 'video' }),
      mkNode('n3', { type: 'image' }),
      mkNode('n4', { type: 'text' }),
    ]);

    const images = repo.getByType('c1', 'image');
    expect(images).toHaveLength(2);
    expect(images.map((n) => n.id).sort()).toEqual(['n1', 'n3']);

    const videos = repo.getByType('c1', 'video');
    expect(videos).toHaveLength(1);
    expect(videos[0].id).toBe('n2');
  });

  it('cascade delete: deleting a canvas deletes its nodes', () => {
    insertCanvas(db, 'c1');
    repo.upsertMany('c1', [mkNode('n1'), mkNode('n2')]);

    db.prepare('DELETE FROM canvases WHERE id = ?').run('c1');
    expect(repo.getByCanvasId('c1')).toHaveLength(0);
  });

  it('preserves z_index ordering', () => {
    insertCanvas(db, 'c1');
    // Insert in specific order — z_index is the array index
    repo.upsertMany('c1', [mkNode('back'), mkNode('middle'), mkNode('front')]);
    const result = repo.getByCanvasId('c1');
    expect(result.map((n) => n.id)).toEqual(['back', 'middle', 'front']);
  });
});

describe('CanvasRepository with CanvasNodeRepository integration', () => {
  let db: BetterSqlite3.Database;
  let canvasRepo: CanvasRepository;
  let nodeRepo: CanvasNodeRepository;

  beforeEach(() => {
    db = openDb();
    canvasRepo = new CanvasRepository(db);
    nodeRepo = new CanvasNodeRepository(db);
    canvasRepo.setNodeRepository(nodeRepo);
  });

  afterEach(() => {
    db.close();
  });

  it('upsert saves nodes to canvas_nodes table, not JSON blob', () => {
    canvasRepo.upsert({
      id: 'c1',
      name: 'Test',
      nodes: [mkNode('n1'), mkNode('n2')],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 100,
      updatedAt: 100,
    });

    // Verify nodes are in the canvas_nodes table
    const rows = db.prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ?').all('c1');
    expect(rows).toHaveLength(2);

    const canvasCols = db.pragma('table_info(canvases)') as Array<{ name: string }>;
    expect(canvasCols.map((col) => col.name)).not.toContain('nodes');
  });

  it('get loads nodes from canvas_nodes table', () => {
    canvasRepo.upsert({
      id: 'c1',
      name: 'Test',
      nodes: [mkNode('n1', { title: 'First' }), mkNode('n2', { title: 'Second' })],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 100,
      updatedAt: 100,
    });

    const canvas = canvasRepo.get('c1' as CanvasId);
    expect(canvas).toBeDefined();
    expect(canvas!.nodes).toHaveLength(2);
    expect(canvas!.nodes[0].id).toBe('n1');
    expect(canvas!.nodes[0].title).toBe('First');
    expect(canvas!.nodes[1].id).toBe('n2');
    expect(canvas!.nodes[1].title).toBe('Second');
  });

  it('upsert with removed nodes deletes orphans', () => {
    canvasRepo.upsert({
      id: 'c1',
      name: 'Test',
      nodes: [mkNode('n1'), mkNode('n2'), mkNode('n3')],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 100,
      updatedAt: 100,
    });

    // Update: remove n2
    canvasRepo.upsert({
      id: 'c1',
      name: 'Test',
      nodes: [mkNode('n1'), mkNode('n3')],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 100,
      updatedAt: 200,
    });

    const canvas = canvasRepo.get('c1' as CanvasId);
    expect(canvas!.nodes).toHaveLength(2);
    expect(canvas!.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
  });

  it('archive preserves canvas_nodes and permanent delete removes them', () => {
    canvasRepo.upsert({
      id: 'c1',
      name: 'Test',
      nodes: [mkNode('n1'), mkNode('n2')],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 100,
      updatedAt: 100,
    });

    canvasRepo.archive('c1' as CanvasId, 200);
    expect(db.prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ?').all('c1')).toHaveLength(2);

    canvasRepo.deletePermanent('c1' as CanvasId);
    expect(db.prepare('SELECT * FROM canvas_nodes WHERE canvas_id = ?').all('c1')).toHaveLength(0);
  });

  it('listFull loads nodes from canvas_nodes table', () => {
    canvasRepo.upsert({
      id: 'c1',
      name: 'Canvas 1',
      nodes: [mkNode('n1')],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 100,
      updatedAt: 200,
    });
    canvasRepo.upsert({
      id: 'c2',
      name: 'Canvas 2',
      nodes: [mkNode('n2'), mkNode('n3')],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      notes: [],
      createdAt: 100,
      updatedAt: 100,
    });

    const { rows } = canvasRepo.listFull();
    expect(rows).toHaveLength(2);
    // Ordered by updatedAt DESC
    expect(rows[0].id).toBe('c1');
    expect(rows[0].nodes).toHaveLength(1);
    expect(rows[1].id).toBe('c2');
    expect(rows[1].nodes).toHaveLength(2);
  });
});
