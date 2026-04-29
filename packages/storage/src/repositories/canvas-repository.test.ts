import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import type { Canvas, CanvasId } from '@lucid-fin/contracts';
import { setDegradeReporter, type DegradeReporter } from '@lucid-fin/contracts-parse';
import { CanvasRepository } from './canvas-repository.js';

const SCHEMA = `
CREATE TABLE canvases (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  nodes                TEXT NOT NULL DEFAULT '[]',
  edges                TEXT NOT NULL DEFAULT '[]',
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
  aspect_ratio         TEXT,
  llm_provider_id      TEXT,
  image_provider_id    TEXT,
  video_provider_id    TEXT,
  audio_provider_id    TEXT,
  created_at           INTEGER NOT NULL,
  updated_at           INTEGER NOT NULL
);
`;

function openDb(): BetterSqlite3.Database {
  const db = new BetterSqlite3(':memory:');
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
    repo = new CanvasRepository(db);
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

  it('delete removes the row', () => {
    repo.upsert(mkCanvas('c1'));
    repo.delete('c1' as CanvasId);
    expect(repo.get('c1' as CanvasId)).toBeUndefined();
  });

  it('fault injection: get skips malformed canvas (invalid viewport JSON) + reports degrade', () => {
    repo.upsert(mkCanvas('good'));
    // Inject a row with an invalid viewport JSON payload.
    db.prepare(
      `INSERT INTO canvases (id, name, nodes, edges, viewport, notes, created_at, updated_at)
       VALUES (?, 'bad', '[]', '[]', ?, '[]', 1, 1)`,
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
      `INSERT INTO canvases (id, name, nodes, edges, viewport, notes, created_at, updated_at)
       VALUES (?, ?, '[]', '[]', ?, '[]', ?, ?)`,
    ).run('schema-bad', 'canvas bad', '{"x":"nope","y":0,"zoom":1}', 1, 1);
    const { rows, degradedCount } = repo.listFull();
    expect(degradedCount).toBe(1);
    expect(rows.map((r) => r.id)).toEqual(['good']);
    expect(reports.some((r) => r.schema === 'Canvas')).toBe(true);
  });

  it('tolerates legacy empty-string body columns', () => {
    // Pre-default-value rows may have '' for body columns instead of valid JSON.
    db.prepare(
      `INSERT INTO canvases (id, name, nodes, edges, viewport, notes, created_at, updated_at)
       VALUES (?, 'legacy', '', '', '', '', ?, ?)`,
    ).run('legacy', 1, 1);
    const got = repo.get('legacy' as CanvasId);
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
         (id, name, nodes, edges, viewport, notes, aspect_ratio, created_at, updated_at)
       VALUES ('legacy-ar', 'legacy', '[]', '[]', '{"x":0,"y":0,"zoom":1}', '[]', '5:4', 1, 1)`,
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
});
