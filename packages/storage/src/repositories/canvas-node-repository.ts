/**
 * CanvasNodeRepository — R06: canvas_nodes table.
 *
 * Each row represents a single ReactFlow node belonging to a canvas.
 * The `canvas_nodes` table is the single source of truth for node rows.
 *
 * The repository converts between flat DB rows and the ReactFlow
 * `CanvasNode` shape expected by the renderer.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { CanvasNode, CanvasNodeData } from '@lucid-fin/contracts';
import type { NodeKind } from '@lucid-fin/contracts';
import { CanvasNodesTable } from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

const TBL = CanvasNodesTable.tableName;
const C = CanvasNodesTable.cols;

/** Raw row shape returned by SELECT queries. */
interface RawNodeRow {
  id: string;
  canvas_id: string;
  type: string;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  data_json: string;
  z_index: number;
  created_at: string;
  updated_at: string;
}

/** Convert a DB row to a ReactFlow CanvasNode. */
function rowToCanvasNode(row: RawNodeRow): CanvasNode {
  const data: CanvasNodeData = JSON.parse(row.data_json || '{}') as CanvasNodeData;
  const node: CanvasNode = {
    id: row.id,
    type: row.type as NodeKind,
    position: { x: row.position_x, y: row.position_y },
    data,
    // These fields are stored inside data_json together with the rest
    // of the CanvasNode top-level properties that aren't columns.
    // We parse them out below.
    title: '',
    bypassed: false,
    locked: false,
    createdAt: 0,
    updatedAt: 0,
  };

  // data_json also stores CanvasNode top-level fields that don't have
  // their own column (title, bypassed, locked, colorTag, tags, groupId,
  // parentId, createdAt, updatedAt). Extract them from the parsed data
  // object and delete the keys from `data` to keep it clean.
  const raw = data as unknown as Record<string, unknown>;
  if ('__node_title' in raw) {
    node.title = raw['__node_title'] as string;
    delete raw['__node_title'];
  }
  if ('__node_bypassed' in raw) {
    node.bypassed = raw['__node_bypassed'] as boolean;
    delete raw['__node_bypassed'];
  }
  if ('__node_locked' in raw) {
    node.locked = raw['__node_locked'] as boolean;
    delete raw['__node_locked'];
  }
  if ('__node_colorTag' in raw) {
    node.colorTag = raw['__node_colorTag'] as string;
    delete raw['__node_colorTag'];
  }
  if ('__node_tags' in raw) {
    node.tags = raw['__node_tags'] as string[];
    delete raw['__node_tags'];
  }
  if ('__node_groupId' in raw) {
    node.groupId = raw['__node_groupId'] as string;
    delete raw['__node_groupId'];
  }
  if ('__node_parentId' in raw) {
    node.parentId = raw['__node_parentId'] as string;
    delete raw['__node_parentId'];
  }
  if ('__node_createdAt' in raw) {
    node.createdAt = raw['__node_createdAt'] as number;
    delete raw['__node_createdAt'];
  }
  if ('__node_updatedAt' in raw) {
    node.updatedAt = raw['__node_updatedAt'] as number;
    delete raw['__node_updatedAt'];
  }

  if (row.width != null) node.width = row.width;
  if (row.height != null) node.height = row.height;

  return node;
}

/**
 * Serialize a CanvasNode into the column values for an INSERT/REPLACE.
 * Top-level CanvasNode fields that don't have their own DB column are
 * stashed inside data_json with a `__node_` prefix to avoid collision
 * with the actual node data fields.
 */
function canvasNodeToParams(canvasId: string, node: CanvasNode, zIndex: number) {
  const dataClone = { ...node.data } as Record<string, unknown>;
  // Stash top-level CanvasNode fields without their own column
  dataClone['__node_title'] = node.title;
  dataClone['__node_bypassed'] = node.bypassed;
  dataClone['__node_locked'] = node.locked;
  if (node.colorTag !== undefined) dataClone['__node_colorTag'] = node.colorTag;
  if (node.tags !== undefined) dataClone['__node_tags'] = node.tags;
  if (node.groupId !== undefined) dataClone['__node_groupId'] = node.groupId;
  if (node.parentId !== undefined) dataClone['__node_parentId'] = node.parentId;
  dataClone['__node_createdAt'] = node.createdAt;
  dataClone['__node_updatedAt'] = node.updatedAt;

  return {
    id: node.id,
    canvasId,
    type: node.type,
    positionX: node.position.x,
    positionY: node.position.y,
    width: node.width ?? null,
    height: node.height ?? null,
    dataJson: JSON.stringify(dataClone),
    zIndex,
    createdAt: new Date(node.createdAt).toISOString(),
    updatedAt: new Date(node.updatedAt).toISOString(),
  };
}

export class CanvasNodeRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  /**
   * Return all nodes for a canvas, ordered by z_index ASC (back-to-front).
   */
  getByCanvasId(canvasId: string, tx?: Tx): CanvasNode[] {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT * FROM ${TBL}
         WHERE ${C.canvasId.sqlName} = ?
         ORDER BY ${C.zIndex.sqlName} ASC`,
      )
      .all(canvasId) as RawNodeRow[];
    return rows.map(rowToCanvasNode);
  }

  /**
   * Batch upsert nodes for a canvas. Replaces the full node set:
   * deletes nodes not in the provided array, upserts all provided nodes.
   */
  upsertMany(canvasId: string, nodes: CanvasNode[], tx?: Tx): void {
    const d = tx ?? this.db;

    // Delete orphaned nodes (present in DB but not in the provided array)
    if (nodes.length === 0) {
      d.prepare(`DELETE FROM ${TBL} WHERE ${C.canvasId.sqlName} = ?`).run(canvasId);
      return;
    }

    const nodeIds = nodes.map((n) => n.id);
    const placeholders = nodeIds.map(() => '?').join(', ');
    d.prepare(
      `DELETE FROM ${TBL}
       WHERE ${C.canvasId.sqlName} = ? AND ${C.id.sqlName} NOT IN (${placeholders})`,
    ).run(canvasId, ...nodeIds);

    const upsertStmt = d.prepare(
      `INSERT INTO ${TBL}
         (${C.id.sqlName}, ${C.canvasId.sqlName}, ${C.type.sqlName},
          ${C.positionX.sqlName}, ${C.positionY.sqlName},
          ${C.width.sqlName}, ${C.height.sqlName},
          ${C.dataJson.sqlName}, ${C.zIndex.sqlName},
          ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
         ${C.canvasId.sqlName}  = excluded.${C.canvasId.sqlName},
         ${C.type.sqlName}      = excluded.${C.type.sqlName},
         ${C.positionX.sqlName} = excluded.${C.positionX.sqlName},
         ${C.positionY.sqlName} = excluded.${C.positionY.sqlName},
         ${C.width.sqlName}     = excluded.${C.width.sqlName},
         ${C.height.sqlName}    = excluded.${C.height.sqlName},
         ${C.dataJson.sqlName}  = excluded.${C.dataJson.sqlName},
         ${C.zIndex.sqlName}    = excluded.${C.zIndex.sqlName},
         ${C.updatedAt.sqlName} = excluded.${C.updatedAt.sqlName}`,
    );

    for (let i = 0; i < nodes.length; i++) {
      const p = canvasNodeToParams(canvasId, nodes[i], i);
      upsertStmt.run(
        p.id,
        p.canvasId,
        p.type,
        p.positionX,
        p.positionY,
        p.width,
        p.height,
        p.dataJson,
        p.zIndex,
        p.createdAt,
        p.updatedAt,
      );
    }
  }

  /** Delete all nodes belonging to a canvas. */
  deleteByCanvasId(canvasId: string, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.canvasId.sqlName} = ?`).run(canvasId);
  }

  patchApply(
    canvasId: string,
    added: Array<{ node: CanvasNode; zIndex: number }>,
    removedIds: string[],
    updated: Array<{ node: CanvasNode; zIndex: number }>,
    tx?: Tx,
  ): void {
    const d = tx ?? this.db;

    if (removedIds.length > 0) {
      this.deleteByIds(removedIds, d);
    }

    if (added.length > 0) {
      const upsertStmt = d.prepare(
        `INSERT INTO ${TBL}
           (${C.id.sqlName}, ${C.canvasId.sqlName}, ${C.type.sqlName},
            ${C.positionX.sqlName}, ${C.positionY.sqlName},
            ${C.width.sqlName}, ${C.height.sqlName},
            ${C.dataJson.sqlName}, ${C.zIndex.sqlName},
            ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
           ${C.canvasId.sqlName}  = excluded.${C.canvasId.sqlName},
           ${C.type.sqlName}      = excluded.${C.type.sqlName},
           ${C.positionX.sqlName} = excluded.${C.positionX.sqlName},
           ${C.positionY.sqlName} = excluded.${C.positionY.sqlName},
           ${C.width.sqlName}     = excluded.${C.width.sqlName},
           ${C.height.sqlName}    = excluded.${C.height.sqlName},
           ${C.dataJson.sqlName}  = excluded.${C.dataJson.sqlName},
           ${C.zIndex.sqlName}    = excluded.${C.zIndex.sqlName},
           ${C.updatedAt.sqlName} = excluded.${C.updatedAt.sqlName}`,
      );
      for (const { node, zIndex } of added) {
        const p = canvasNodeToParams(canvasId, node, zIndex);
        upsertStmt.run(
          p.id,
          p.canvasId,
          p.type,
          p.positionX,
          p.positionY,
          p.width,
          p.height,
          p.dataJson,
          p.zIndex,
          p.createdAt,
          p.updatedAt,
        );
      }
    }

    if (updated.length > 0) {
      const upsertStmt = d.prepare(
        `INSERT INTO ${TBL}
           (${C.id.sqlName}, ${C.canvasId.sqlName}, ${C.type.sqlName},
            ${C.positionX.sqlName}, ${C.positionY.sqlName},
            ${C.width.sqlName}, ${C.height.sqlName},
            ${C.dataJson.sqlName}, ${C.zIndex.sqlName},
            ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
           ${C.canvasId.sqlName}  = excluded.${C.canvasId.sqlName},
           ${C.type.sqlName}      = excluded.${C.type.sqlName},
           ${C.positionX.sqlName} = excluded.${C.positionX.sqlName},
           ${C.positionY.sqlName} = excluded.${C.positionY.sqlName},
           ${C.width.sqlName}     = excluded.${C.width.sqlName},
           ${C.height.sqlName}    = excluded.${C.height.sqlName},
           ${C.dataJson.sqlName}  = excluded.${C.dataJson.sqlName},
           ${C.zIndex.sqlName}    = excluded.${C.zIndex.sqlName},
           ${C.updatedAt.sqlName} = excluded.${C.updatedAt.sqlName}`,
      );
      for (const { node, zIndex } of updated) {
        const p = canvasNodeToParams(canvasId, node, zIndex);
        upsertStmt.run(
          p.id,
          p.canvasId,
          p.type,
          p.positionX,
          p.positionY,
          p.width,
          p.height,
          p.dataJson,
          p.zIndex,
          p.createdAt,
          p.updatedAt,
        );
      }
    }
  }

  /** Delete specific nodes by their ids. */
  deleteByIds(ids: string[], tx?: Tx): void {
    if (ids.length === 0) return;
    const d = tx ?? this.db;
    const placeholders = ids.map(() => '?').join(', ');
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} IN (${placeholders})`).run(...ids);
  }

  /** Query nodes by type within a canvas. */
  getByType(canvasId: string, type: string, tx?: Tx): CanvasNode[] {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT * FROM ${TBL}
         WHERE ${C.canvasId.sqlName} = ? AND ${C.type.sqlName} = ?
         ORDER BY ${C.zIndex.sqlName} ASC`,
      )
      .all(canvasId, type) as RawNodeRow[];
    return rows.map(rowToCanvasNode);
  }
}
