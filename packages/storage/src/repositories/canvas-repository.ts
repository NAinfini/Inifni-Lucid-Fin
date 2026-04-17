/**
 * CanvasRepository — Phase G1-2.5.
 *
 * Wraps `canvases` CRUD behind the `CanvasId` brand and fault-soft
 * reads. Canvas body (nodes/edges/viewport/notes) is stored as
 * serialized JSON; the repository parses and returns typed objects.
 *
 * SQL references column names through `CanvasesTable` (G1-1) — schema
 * drift fails at compile time.
 *
 * Reads go through `parseOrDegrade` with `'Canvas'` ctx so a corrupt
 * row surfaces as degraded-read telemetry + skip, not a crash in the
 * canvas tab / HistoryPanel.
 *
 * Phase G1-5 consumer migration will switch `canvas.handlers.ts` to
 * this repo directly. Until then `SqliteIndex` delegates its legacy
 * methods here.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { Canvas, CanvasId } from '@lucid-fin/contracts';
import {
  CanvasesTable,
  CanvasSchema,
  parseOrDegrade,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

/** Result shape for list reads that surface degraded-row counts. */
export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

/** Lightweight summary row for the canvas picker — no body JSON decode. */
export interface CanvasSummary {
  id: CanvasId;
  name: string;
  updatedAt: number;
}

type RawRow = {
  id: string;
  name: string;
  nodes: string;
  edges: string;
  viewport: string;
  notes: string;
  created_at: number;
  updated_at: number;
};

const TBL = CanvasesTable.tableName;
const C = CanvasesTable.cols;

const SELECT_COLS = [
  C.id.sqlName,
  C.name.sqlName,
  C.nodes.sqlName,
  C.edges.sqlName,
  C.viewport.sqlName,
  C.notes.sqlName,
  C.createdAt.sqlName,
  C.updatedAt.sqlName,
].join(', ');

const DEFAULT_VIEWPORT = '{"x":0,"y":0,"zoom":1}';

export class CanvasRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsert(canvas: Canvas, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT INTO ${TBL}
         (${C.id.sqlName}, ${C.name.sqlName}, ${C.nodes.sqlName}, ${C.edges.sqlName},
          ${C.viewport.sqlName}, ${C.notes.sqlName}, ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
         ${C.name.sqlName}     = excluded.${C.name.sqlName},
         ${C.nodes.sqlName}    = excluded.${C.nodes.sqlName},
         ${C.edges.sqlName}    = excluded.${C.edges.sqlName},
         ${C.viewport.sqlName} = excluded.${C.viewport.sqlName},
         ${C.notes.sqlName}    = excluded.${C.notes.sqlName},
         ${C.updatedAt.sqlName} = excluded.${C.updatedAt.sqlName}`,
    ).run(
      canvas.id,
      canvas.name,
      JSON.stringify(canvas.nodes ?? []),
      JSON.stringify(canvas.edges ?? []),
      JSON.stringify(canvas.viewport ?? { x: 0, y: 0, zoom: 1 }),
      JSON.stringify(canvas.notes ?? []),
      canvas.createdAt,
      canvas.updatedAt,
    );
  }

  get(id: CanvasId, tx?: Tx): Canvas | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(`SELECT ${SELECT_COLS} FROM ${TBL} WHERE ${C.id.sqlName} = ?`)
      .get(id) as RawRow | undefined;
    if (!row) return undefined;
    const { rows } = parseRows([row]);
    return rows[0];
  }

  /** Lightweight summary list (id/name/updatedAt) — no body parsing. */
  list(tx?: Tx): CanvasSummary[] {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${C.id.sqlName}, ${C.name.sqlName}, ${C.updatedAt.sqlName}
         FROM ${TBL}
         ORDER BY ${C.updatedAt.sqlName} DESC`,
      )
      .all() as Array<{ id: string; name: string; updated_at: number }>;
    return rows.map((r) => ({
      id: r.id as CanvasId,
      name: r.name,
      updatedAt: r.updated_at,
    }));
  }

  listFull(tx?: Tx): ListResult<Canvas> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${SELECT_COLS}
         FROM ${TBL}
         ORDER BY ${C.updatedAt.sqlName} DESC`,
      )
      .all() as RawRow[];
    return parseRows(rows);
  }

  delete(id: CanvasId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
  }
}

function rowToCanvas(row: RawRow): Canvas {
  // Defensive against legacy empty-string body columns (pre-DEFAULT migrations).
  const nodesJson    = row.nodes    && row.nodes.length    > 0 ? row.nodes    : '[]';
  const edgesJson    = row.edges    && row.edges.length    > 0 ? row.edges    : '[]';
  const viewportJson = row.viewport && row.viewport.length > 0 ? row.viewport : DEFAULT_VIEWPORT;
  const notesJson    = row.notes    && row.notes.length    > 0 ? row.notes    : '[]';

  return {
    id: row.id,
    name: row.name,
    nodes: JSON.parse(nodesJson) as Canvas['nodes'],
    edges: JSON.parse(edgesJson) as Canvas['edges'],
    viewport: JSON.parse(viewportJson) as Canvas['viewport'],
    notes: JSON.parse(notesJson) as Canvas['notes'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseRows(rows: RawRow[]): ListResult<Canvas> {
  const out: Canvas[] = [];
  let degradedCount = 0;
  const SENTINEL = Symbol('degraded');
  for (const row of rows) {
    let candidate: Canvas | RawRow;
    try {
      candidate = rowToCanvas(row);
    } catch {
      // JSON parse failed — feed the raw row to parseOrDegrade so zod
      // rejects it and the degrade reporter fires (observability parity
      // with schema-mismatch failures). The schema won't match string
      // columns against object fields, guaranteeing the fallback path.
      candidate = row;
    }
    const parsed = parseOrDegrade(
      CanvasSchema,
      candidate,
      SENTINEL as unknown as Canvas,
      { ctx: { name: 'Canvas' } },
    );
    if ((parsed as unknown) === SENTINEL) {
      degradedCount += 1;
      continue;
    }
    out.push(parsed as Canvas);
  }
  return { rows: out, degradedCount };
}
