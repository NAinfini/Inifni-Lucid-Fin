/**
 * CanvasEdgeRepository.
 *
 * Stores each ReactFlow canvas edge as a first-class SQL row.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { CanvasEdge } from '@lucid-fin/contracts';
import { CanvasEdgesTable } from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

const TBL = CanvasEdgesTable.tableName;
const C = CanvasEdgesTable.cols;

interface RawEdgeRow {
  id: string;
  canvas_id: string;
  source: string;
  target: string;
  source_handle: string | null;
  target_handle: string | null;
  label: string | null;
  status: CanvasEdge['data']['status'];
  auto_label: number;
  z_index: number;
  created_at: string;
  updated_at: string;
}

function rowToCanvasEdge(row: RawEdgeRow): CanvasEdge {
  return {
    id: row.id,
    source: row.source,
    target: row.target,
    ...(row.source_handle != null ? { sourceHandle: row.source_handle } : {}),
    ...(row.target_handle != null ? { targetHandle: row.target_handle } : {}),
    data: {
      ...(row.label != null ? { label: row.label } : {}),
      status: row.status,
      autoLabel: row.auto_label === 1,
    },
  };
}

function edgeToParams(canvasId: string, edge: CanvasEdge, zIndex: number) {
  return {
    id: edge.id,
    canvasId,
    source: edge.source,
    target: edge.target,
    sourceHandle: edge.sourceHandle ?? null,
    targetHandle: edge.targetHandle ?? null,
    label: edge.data.label ?? null,
    status: edge.data.status,
    autoLabel: edge.data.autoLabel ? 1 : 0,
    zIndex,
    now: new Date().toISOString(),
  };
}

export class CanvasEdgeRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  getByCanvasId(canvasId: string, tx?: Tx): CanvasEdge[] {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT * FROM ${TBL}
         WHERE ${C.canvasId.sqlName} = ?
         ORDER BY ${C.zIndex.sqlName} ASC`,
      )
      .all(canvasId) as RawEdgeRow[];
    return rows.map(rowToCanvasEdge);
  }

  upsertMany(canvasId: string, edges: CanvasEdge[], tx?: Tx): void {
    const d = tx ?? this.db;

    if (edges.length === 0) {
      d.prepare(`DELETE FROM ${TBL} WHERE ${C.canvasId.sqlName} = ?`).run(canvasId);
      return;
    }

    const edgeIds = edges.map((edge) => edge.id);
    const placeholders = edgeIds.map(() => '?').join(', ');
    d.prepare(
      `DELETE FROM ${TBL}
       WHERE ${C.canvasId.sqlName} = ? AND ${C.id.sqlName} NOT IN (${placeholders})`,
    ).run(canvasId, ...edgeIds);

    const upsertStmt = d.prepare(
      `INSERT INTO ${TBL}
         (${C.id.sqlName}, ${C.canvasId.sqlName}, ${C.source.sqlName}, ${C.target.sqlName},
          ${C.sourceHandle.sqlName}, ${C.targetHandle.sqlName}, ${C.label.sqlName},
          ${C.status.sqlName}, ${C.autoLabel.sqlName}, ${C.zIndex.sqlName},
          ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
         ${C.canvasId.sqlName}     = excluded.${C.canvasId.sqlName},
         ${C.source.sqlName}       = excluded.${C.source.sqlName},
         ${C.target.sqlName}       = excluded.${C.target.sqlName},
         ${C.sourceHandle.sqlName} = excluded.${C.sourceHandle.sqlName},
         ${C.targetHandle.sqlName} = excluded.${C.targetHandle.sqlName},
         ${C.label.sqlName}        = excluded.${C.label.sqlName},
         ${C.status.sqlName}       = excluded.${C.status.sqlName},
         ${C.autoLabel.sqlName}    = excluded.${C.autoLabel.sqlName},
         ${C.zIndex.sqlName}       = excluded.${C.zIndex.sqlName},
         ${C.updatedAt.sqlName}    = excluded.${C.updatedAt.sqlName}`,
    );

    for (let i = 0; i < edges.length; i++) {
      const p = edgeToParams(canvasId, edges[i], i);
      upsertStmt.run(
        p.id,
        p.canvasId,
        p.source,
        p.target,
        p.sourceHandle,
        p.targetHandle,
        p.label,
        p.status,
        p.autoLabel,
        p.zIndex,
        p.now,
        p.now,
      );
    }
  }

  deleteByCanvasId(canvasId: string, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.canvasId.sqlName} = ?`).run(canvasId);
  }
}
