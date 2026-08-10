/**
 * Canvas load performance benchmarks.
 *
 * Measures SQL query time and deserialization time for canvas loading
 * at 200, 500, and 1000 node counts. Reports mean and p95 across 5
 * iterations per size.
 *
 * These machine-sensitive cases run only in the dedicated `pnpm run test:perf`
 * lane and are excluded from the default Vitest suite.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import BetterSqlite3 from 'better-sqlite3';
import { CanvasNodeRepository } from '../repositories/canvas-node-repository.js';
import { CanvasRepository } from '../repositories/canvas-repository.js';
import { generateSyntheticCanvas } from './canvas-perf-utils.js';
import type { CanvasId } from '@lucid-fin/contracts';

// ---------------------------------------------------------------------------
// Schema — mirrors canvas-node-repository.test.ts
// ---------------------------------------------------------------------------

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
`;

// ---------------------------------------------------------------------------
// Statistics helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(sorted.length * 0.95) - 1;
  return sorted[Math.max(0, idx)];
}

function formatMs(ms: number): string {
  return ms.toFixed(2) + 'ms';
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  sqlMean: number;
  sqlP95: number;
  deserMean: number;
  deserP95: number;
  totalMean: number;
  totalP95: number;
  nodeCount: number;
}

function runBenchmark(
  db: BetterSqlite3.Database,
  nodeCount: number,
  iterations: number,
): BenchmarkResult {
  const canvasRepo = new CanvasRepository(db);
  const nodeRepo = new CanvasNodeRepository(db);

  // Generate data once
  const { canvasId } = generateSyntheticCanvas(db, nodeCount);

  const sqlTimes: number[] = [];
  const deserTimes: number[] = [];
  const totalTimes: number[] = [];

  for (let i = 0; i < iterations; i++) {
    // --- Phase 1: SQL query time ---
    const t0 = performance.now();
    const canvas = canvasRepo.get(canvasId as CanvasId);
    const rawNodes = nodeRepo.getByCanvasId(canvasId);
    const t1 = performance.now();

    // --- Phase 2: Deserialization time (JSON.parse of data_json) ---
    // The repository already parses data_json during getByCanvasId.
    // To measure pure deserialization separately, we re-read the raw
    // rows and time JSON.parse explicitly.
    const rawRows = db
      .prepare(`SELECT data_json FROM canvas_nodes WHERE canvas_id = ? ORDER BY z_index ASC`)
      .all(canvasId) as Array<{ data_json: string }>;

    const t2 = performance.now();
    for (const row of rawRows) {
      JSON.parse(row.data_json);
    }
    const t3 = performance.now();

    const sqlTime = t1 - t0;
    const deserTime = t3 - t2;

    sqlTimes.push(sqlTime);
    deserTimes.push(deserTime);
    totalTimes.push(sqlTime + deserTime);

    // Sanity: verify the data came back correctly
    expect(canvas).toBeDefined();
    expect(rawNodes.length).toBe(nodeCount);
  }

  return {
    sqlMean: mean(sqlTimes),
    sqlP95: p95(sqlTimes),
    deserMean: mean(deserTimes),
    deserP95: p95(deserTimes),
    totalMean: mean(totalTimes),
    totalP95: p95(totalTimes),
    nodeCount,
  };
}

function reportResult(label: string, result: BenchmarkResult): void {
  console.log(`\n--- ${label} (${result.nodeCount} nodes) ---`);
  console.log(`  SQL   mean=${formatMs(result.sqlMean)}  p95=${formatMs(result.sqlP95)}`);
  console.log(`  Deser mean=${formatMs(result.deserMean)}  p95=${formatMs(result.deserP95)}`);
  console.log(`  Total mean=${formatMs(result.totalMean)}  p95=${formatMs(result.totalP95)}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('canvas load performance', () => {
  let db: BetterSqlite3.Database;

  beforeEach(() => {
    db = new BetterSqlite3(':memory:');
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
  });

  afterEach(() => {
    db.close();
  });

  it('200 nodes: SQL + deserialization within budget', () => {
    const result = runBenchmark(db, 200, 5);
    reportResult('200 nodes', result);

    // Loose budgets — 200 nodes should be very fast
    expect(result.sqlMean).toBeLessThan(30);
    expect(result.deserMean).toBeLessThan(15);
  });

  it('500 nodes: SQL < 50ms', () => {
    const result = runBenchmark(db, 500, 5);
    reportResult('500 nodes', result);

    expect(result.sqlMean).toBeLessThan(50);
    expect(result.deserMean).toBeLessThan(25);
  });

  it('1000 nodes: SQL < 100ms (slow)', { timeout: 30_000 }, () => {
    const result = runBenchmark(db, 1000, 5);
    reportResult('1000 nodes', result);

    expect(result.sqlMean).toBeLessThan(100);
    expect(result.deserMean).toBeLessThan(50);
  });
});
