/**
 * Canvas persistence.
 *
 * Wraps `canvases` CRUD behind the `CanvasId` brand and fault-soft
 * reads. Canvas body (nodes/edges/viewport/notes) is stored as
 * serialized JSON; the repository parses and returns typed objects.
 *
 * SQL references column names through `CanvasesTable` (G1-1) — schema
 * drift fails at compile time.
 *
 * Reads go through `parseOrDegrade` with `'Canvas'` context so a corrupt
 * row surfaces as degraded-read telemetry + skip, not a crash in the
 * canvas tab / HistoryPanel.
 *
 * Nodes and edges live in normalized tables; this repository coordinates
 * them through their dedicated repositories.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { createHash } from 'node:crypto';
import {
  TASK_LIST_TERMINAL_STATUSES,
  type Canvas,
  type CanvasId,
  type CanvasSettings,
  type CanvasAspectRatio,
  type CanvasNode,
  type CanvasEdge,
  type OrderedDeliverySequence,
} from '@lucid-fin/contracts';
import {
  CanvasesTable,
  CanvasSchema,
  ResolutionPolicySchema,
  CanvasVisualStylePolicySchema,
  OrderedDeliverySequenceSchema,
  parseOrDegrade,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';
import type { CanvasNodeRepository } from './canvas-node-repository.js';
import type { CanvasEdgeRepository } from './canvas-edge-repository.js';

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
  archivedAt?: number;
}

type RawRow = {
  id: string;
  name: string;
  viewport: string;
  notes: string;
  style_plate: string | null;
  negative_prompt: string | null;
  default_width: number | null;
  default_height: number | null;
  publish_width: number | null;
  publish_height: number | null;
  publish_video_width: number | null;
  publish_video_height: number | null;
  resolution_policy_json: string | null;
  visual_style_policy_json: string | null;
  aspect_ratio: string | null;
  llm_provider_id: string | null;
  image_provider_id: string | null;
  video_provider_id: string | null;
  audio_provider_id: string | null;
  delivery_sequence_json: string | null;
  delivery_sequence_revision: number;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

const TBL = CanvasesTable.tableName;
const C = CanvasesTable.cols;

const SELECT_COLS = [
  C.id.sqlName,
  C.name.sqlName,
  C.viewport.sqlName,
  C.notes.sqlName,
  C.stylePlate.sqlName,
  C.negativePrompt.sqlName,
  C.refWidth.sqlName,
  C.refHeight.sqlName,
  C.publishImageWidth.sqlName,
  C.publishImageHeight.sqlName,
  C.publishVideoWidth.sqlName,
  C.publishVideoHeight.sqlName,
  C.resolutionPolicyJson.sqlName,
  C.visualStylePolicyJson.sqlName,
  C.aspectRatio.sqlName,
  C.llmProviderId.sqlName,
  C.imageProviderId.sqlName,
  C.videoProviderId.sqlName,
  C.audioProviderId.sqlName,
  C.deliverySequenceJson.sqlName,
  C.deliverySequenceRevision.sqlName,
  C.archivedAt.sqlName,
  C.createdAt.sqlName,
  C.updatedAt.sqlName,
].join(', ');

const DEFAULT_VIEWPORT = '{"x":0,"y":0,"zoom":1}';

export class CanvasRepository {
  private nodeRepository?: CanvasNodeRepository;
  private edgeRepository?: CanvasEdgeRepository;

  constructor(private readonly db: BetterSqlite3.Database) {}

  setGraphRepositories(repos: { nodes: CanvasNodeRepository; edges: CanvasEdgeRepository }): void {
    this.nodeRepository = repos.nodes;
    this.edgeRepository = repos.edges;
  }

  setNodeRepository(repo: CanvasNodeRepository): void {
    this.nodeRepository = repo;
  }

  setEdgeRepository(repo: CanvasEdgeRepository): void {
    this.edgeRepository = repo;
  }

  upsert(canvas: Canvas, tx?: Tx): void {
    if (!tx) {
      this.db.transaction(() => {
        this.upsert(canvas, this.db);
      })();
      return;
    }

    const d = tx ?? this.db;
    const s = canvas.settings ?? {};
    const existing = d
      .prepare(
        `SELECT ${C.archivedAt.sqlName} AS archived_at
           FROM ${TBL} WHERE ${C.id.sqlName} = ?`,
      )
      .get(canvas.id) as { archived_at: number | null } | undefined;
    if (existing?.archived_at !== null && existing?.archived_at !== undefined) {
      throw new Error(`Canvas is archived and cannot be modified: ${canvas.id}`);
    }
    if (canvas.archivedAt !== undefined) {
      throw new Error('Canvas archive state can only be changed through archive or restore');
    }
    if (!existing && canvas.deliverySequence) {
      throw new Error('Create the Canvas before persisting its delivery sequence');
    }
    d.prepare(
      `INSERT INTO ${TBL}
         (${C.id.sqlName}, ${C.name.sqlName}, ${C.viewport.sqlName}, ${C.notes.sqlName},
          ${C.stylePlate.sqlName}, ${C.negativePrompt.sqlName},
          ${C.refWidth.sqlName}, ${C.refHeight.sqlName},
          ${C.publishImageWidth.sqlName}, ${C.publishImageHeight.sqlName},
          ${C.publishVideoWidth.sqlName}, ${C.publishVideoHeight.sqlName},
          ${C.resolutionPolicyJson.sqlName},
          ${C.visualStylePolicyJson.sqlName},
          ${C.aspectRatio.sqlName},
          ${C.llmProviderId.sqlName}, ${C.imageProviderId.sqlName},
          ${C.videoProviderId.sqlName}, ${C.audioProviderId.sqlName},
          ${C.archivedAt.sqlName}, ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
         ${C.name.sqlName}            = excluded.${C.name.sqlName},
         ${C.viewport.sqlName}        = excluded.${C.viewport.sqlName},
         ${C.notes.sqlName}           = excluded.${C.notes.sqlName},
         ${C.stylePlate.sqlName}      = excluded.${C.stylePlate.sqlName},
         ${C.negativePrompt.sqlName}  = excluded.${C.negativePrompt.sqlName},
         ${C.refWidth.sqlName}        = excluded.${C.refWidth.sqlName},
         ${C.refHeight.sqlName}       = excluded.${C.refHeight.sqlName},
         ${C.publishImageWidth.sqlName}  = excluded.${C.publishImageWidth.sqlName},
         ${C.publishImageHeight.sqlName} = excluded.${C.publishImageHeight.sqlName},
         ${C.publishVideoWidth.sqlName}  = excluded.${C.publishVideoWidth.sqlName},
         ${C.publishVideoHeight.sqlName} = excluded.${C.publishVideoHeight.sqlName},
         ${C.resolutionPolicyJson.sqlName} = excluded.${C.resolutionPolicyJson.sqlName},
         ${C.visualStylePolicyJson.sqlName} = excluded.${C.visualStylePolicyJson.sqlName},
         ${C.aspectRatio.sqlName}     = excluded.${C.aspectRatio.sqlName},
         ${C.llmProviderId.sqlName}   = excluded.${C.llmProviderId.sqlName},
         ${C.imageProviderId.sqlName} = excluded.${C.imageProviderId.sqlName},
         ${C.videoProviderId.sqlName} = excluded.${C.videoProviderId.sqlName},
         ${C.audioProviderId.sqlName} = excluded.${C.audioProviderId.sqlName},
         ${C.updatedAt.sqlName}       = excluded.${C.updatedAt.sqlName}`,
    ).run(
      canvas.id,
      canvas.name,
      JSON.stringify(canvas.viewport ?? { x: 0, y: 0, zoom: 1 }),
      JSON.stringify(canvas.notes ?? []),
      s.stylePlate ?? null,
      s.negativePrompt ?? null,
      s.refResolution?.width ?? null,
      s.refResolution?.height ?? null,
      s.publishImageResolution?.width ?? null,
      s.publishImageResolution?.height ?? null,
      s.publishVideoResolution?.width ?? null,
      s.publishVideoResolution?.height ?? null,
      s.resolutionPolicy ? JSON.stringify(s.resolutionPolicy) : null,
      s.visualStylePolicy ? JSON.stringify(s.visualStylePolicy) : null,
      s.aspectRatio ?? null,
      s.llmProviderId ?? null,
      s.imageProviderId ?? null,
      s.videoProviderId ?? null,
      s.audioProviderId ?? null,
      null,
      canvas.createdAt,
      canvas.updatedAt,
    );

    this.nodeRepository?.upsertMany(canvas.id, canvas.nodes ?? [], d);
    this.edgeRepository?.upsertMany(canvas.id, canvas.edges ?? [], d);
  }

  updateDeliverySequence(
    id: CanvasId,
    expectedRevision: number,
    sequence: OrderedDeliverySequence,
    tx?: Tx,
  ): OrderedDeliverySequence {
    if (!tx) {
      return this.db.transaction(() =>
        this.updateDeliverySequence(id, expectedRevision, sequence, this.db),
      )();
    }
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw new Error('expectedRevision must be a nonnegative integer');
    }

    const value = OrderedDeliverySequenceSchema.parse(sequence) as OrderedDeliverySequence;
    if (value.revision !== expectedRevision + 1) {
      throw new Error('Delivery sequence revision must equal expectedRevision + 1');
    }

    const current = tx
      .prepare(
        `SELECT ${C.deliverySequenceJson.sqlName} AS delivery_sequence_json,
                ${C.deliverySequenceRevision.sqlName} AS delivery_sequence_revision,
                ${C.archivedAt.sqlName} AS archived_at
           FROM ${TBL} WHERE ${C.id.sqlName} = ?`,
      )
      .get(id) as
      | {
          delivery_sequence_json: string | null;
          delivery_sequence_revision: number;
          archived_at: number | null;
        }
      | undefined;
    if (!current) throw new Error(`Canvas not found: ${id}`);
    if (current.archived_at !== null) {
      throw new Error(`Canvas is archived and cannot be modified: ${id}`);
    }
    if ((current.delivery_sequence_json === null) !== (current.delivery_sequence_revision === 0)) {
      throw new Error(`Canvas ${id} has inconsistent delivery sequence storage`);
    }
    if (current.delivery_sequence_json !== null) {
      const stored = OrderedDeliverySequenceSchema.parse(
        JSON.parse(current.delivery_sequence_json),
      ) as OrderedDeliverySequence;
      if (stored.revision !== current.delivery_sequence_revision) {
        throw new Error(`Canvas ${id} delivery sequence revision does not match its document`);
      }
    }
    if (current.delivery_sequence_revision !== expectedRevision) {
      throw new Error(
        `Delivery sequence revision conflict: expected ${expectedRevision}, stored ${current.delivery_sequence_revision}`,
      );
    }

    const assetHashes = validateDeliveryReferences(tx, value);
    rejectActiveDeliveryPackages(tx, id);
    const serialized = JSON.stringify(value);
    const result = tx
      .prepare(
        `UPDATE ${TBL}
            SET ${C.deliverySequenceJson.sqlName} = ?,
                ${C.deliverySequenceRevision.sqlName} = ?,
                ${C.updatedAt.sqlName} = ?
          WHERE ${C.id.sqlName} = ? AND ${C.deliverySequenceRevision.sqlName} = ?`,
      )
      .run(serialized, value.revision, value.updatedAt, id, expectedRevision);
    if (result.changes !== 1) {
      throw new Error(`Delivery sequence revision conflict for Canvas ${id}`);
    }
    replaceDeliveryAssetRefs(tx, id, assetHashes);
    invalidateDeliveryWorkflows(
      tx,
      id,
      value,
      createHash('sha256').update(serialized).digest('hex'),
    );
    return value;
  }

  /**
   * Patch the canvas settings columns in place, bumping updated_at. Pass
   * `null` for a field to clear it; omit to leave it unchanged. Throws
   * if the canvas doesn't exist (caller should `.get()` first when they
   * need to know). Returns the number of rows updated (0 | 1).
   *
   * `refResolution` maps to (default_width, default_height) and
   * `publishImageResolution` maps to (publish_width, publish_height) and
   * `publishVideoResolution` maps to (publish_video_width, publish_video_height). Each
   * pair is patched atomically: a full object sets both, null clears
   * both.
   */
  patchSettings(id: CanvasId, patch: CanvasSettings, tx?: Tx): number {
    const d = tx ?? this.db;
    const sets: string[] = [];
    const params: Array<string | number | null> = [];
    const simpleFields: Array<
      [
        Exclude<
          keyof CanvasSettings,
          | 'refResolution'
          | 'publishImageResolution'
          | 'publishVideoResolution'
          | 'resolutionPolicy'
          | 'visualStylePolicy'
        >,
        string,
      ]
    > = [
      ['stylePlate', C.stylePlate.sqlName],
      ['negativePrompt', C.negativePrompt.sqlName],
      ['aspectRatio', C.aspectRatio.sqlName],
      ['llmProviderId', C.llmProviderId.sqlName],
      ['imageProviderId', C.imageProviderId.sqlName],
      ['videoProviderId', C.videoProviderId.sqlName],
      ['audioProviderId', C.audioProviderId.sqlName],
    ];
    for (const [key, col] of simpleFields) {
      if (key in patch) {
        sets.push(`${col} = ?`);
        params.push(patch[key] ?? null);
      }
    }
    if ('refResolution' in patch) {
      const value = patch.refResolution;
      sets.push(`${C.refWidth.sqlName} = ?`, `${C.refHeight.sqlName} = ?`);
      params.push(value?.width ?? null, value?.height ?? null);
    }
    if ('publishImageResolution' in patch) {
      const value = patch.publishImageResolution;
      sets.push(`${C.publishImageWidth.sqlName} = ?`, `${C.publishImageHeight.sqlName} = ?`);
      params.push(value?.width ?? null, value?.height ?? null);
    }
    if ('publishVideoResolution' in patch) {
      const value = patch.publishVideoResolution;
      sets.push(`${C.publishVideoWidth.sqlName} = ?`, `${C.publishVideoHeight.sqlName} = ?`);
      params.push(value?.width ?? null, value?.height ?? null);
    }
    if ('resolutionPolicy' in patch) {
      sets.push(`${C.resolutionPolicyJson.sqlName} = ?`);
      params.push(patch.resolutionPolicy ? JSON.stringify(patch.resolutionPolicy) : null);
    }
    if ('visualStylePolicy' in patch) {
      sets.push(`${C.visualStylePolicyJson.sqlName} = ?`);
      params.push(patch.visualStylePolicy ? JSON.stringify(patch.visualStylePolicy) : null);
    }
    if (sets.length === 0) return 0;
    rejectArchivedCanvas(d, id);
    sets.push(`${C.updatedAt.sqlName} = ?`);
    params.push(Date.now());
    params.push(id);
    const result = d
      .prepare(`UPDATE ${TBL} SET ${sets.join(', ')} WHERE ${C.id.sqlName} = ?`)
      .run(...params);
    return result.changes;
  }

  get(id: CanvasId, tx?: Tx): Canvas | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(
        `SELECT ${SELECT_COLS} FROM ${TBL}
          WHERE ${C.id.sqlName} = ? AND ${C.archivedAt.sqlName} IS NULL`,
      )
      .get(id) as RawRow | undefined;
    if (!row) return undefined;
    const { rows } = parseRows([row], this.nodeRepository, this.edgeRepository, d);
    return rows[0];
  }

  getIncludingArchived(id: CanvasId, tx?: Tx): Canvas | undefined {
    const d = tx ?? this.db;
    const row = d.prepare(`SELECT ${SELECT_COLS} FROM ${TBL} WHERE ${C.id.sqlName} = ?`).get(id) as
      RawRow | undefined;
    if (!row) return undefined;
    const { rows } = parseRows([row], this.nodeRepository, this.edgeRepository, d);
    return rows[0];
  }

  /** Lightweight summary list (id/name/updatedAt) — no body parsing. */
  list(tx?: Tx): CanvasSummary[] {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${C.id.sqlName}, ${C.name.sqlName}, ${C.updatedAt.sqlName},
                ${C.archivedAt.sqlName}
         FROM ${TBL}
         ORDER BY ${C.updatedAt.sqlName} DESC`,
      )
      .all() as Array<{ id: string; name: string; updated_at: number; archived_at: number | null }>;
    return rows.map((row) => ({
      id: row.id as CanvasId,
      name: row.name,
      updatedAt: row.updated_at,
      ...(row.archived_at === null ? {} : { archivedAt: row.archived_at }),
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
    return parseRows(rows, this.nodeRepository, this.edgeRepository, d);
  }

  archive(id: CanvasId, archivedAt = Date.now(), tx?: Tx): void {
    validateLifecycleTimestamp(archivedAt);
    if (!tx) {
      this.db.transaction(() => this.archive(id, archivedAt, this.db))();
      return;
    }
    const row = getArchiveState(tx, id);
    if (!row) throw new Error(`Canvas not found: ${id}`);
    if (row.archived_at !== null) throw new Error(`Canvas is already archived: ${id}`);
    assertCanvasLifecycleAllowed(tx, id);
    tx.prepare(
      `UPDATE ${TBL}
          SET ${C.archivedAt.sqlName} = ?, ${C.updatedAt.sqlName} = ?
        WHERE ${C.id.sqlName} = ? AND ${C.archivedAt.sqlName} IS NULL`,
    ).run(archivedAt, archivedAt, id);
  }

  restore(id: CanvasId, updatedAt = Date.now(), tx?: Tx): void {
    validateLifecycleTimestamp(updatedAt);
    if (!tx) {
      this.db.transaction(() => this.restore(id, updatedAt, this.db))();
      return;
    }
    const row = getArchiveState(tx, id);
    if (!row) throw new Error(`Canvas not found: ${id}`);
    if (row.archived_at === null) throw new Error(`Canvas is not archived: ${id}`);
    tx.prepare(
      `UPDATE ${TBL}
          SET ${C.archivedAt.sqlName} = NULL, ${C.updatedAt.sqlName} = ?
        WHERE ${C.id.sqlName} = ? AND ${C.archivedAt.sqlName} IS NOT NULL`,
    ).run(updatedAt, id);
  }

  deletePermanent(id: CanvasId, tx?: Tx): void {
    if (!tx) {
      this.db.transaction(() => this.deletePermanent(id, this.db))();
      return;
    }
    const row = getArchiveState(tx, id);
    if (!row) throw new Error(`Canvas not found: ${id}`);
    if (row.archived_at === null) {
      throw new Error(`Canvas must be archived before permanent deletion: ${id}`);
    }
    assertCanvasLifecycleAllowed(tx, id);
    tx.prepare('UPDATE commander_sessions SET default_canvas_id = NULL WHERE default_canvas_id = ?').run(
      id,
    );
    this.edgeRepository?.deleteByCanvasId(id, tx);
    this.nodeRepository?.deleteByCanvasId(id, tx);
    const result = tx
      .prepare(
        `DELETE FROM ${TBL}
          WHERE ${C.id.sqlName} = ? AND ${C.archivedAt.sqlName} IS NOT NULL`,
      )
      .run(id);
    if (result.changes !== 1) throw new Error(`Canvas permanent deletion failed: ${id}`);
  }

  patchApply(
    id: CanvasId,
    patch: {
      nameChange?: string;
      addedNodes?: Array<{ node: CanvasNode; zIndex: number }>;
      removedNodeIds?: string[];
      updatedNodes?: Array<{ node: CanvasNode; zIndex: number }>;
      addedEdges?: Array<{ edge: CanvasEdge; zIndex: number }>;
      removedEdgeIds?: string[];
      updatedEdges?: Array<{ edge: CanvasEdge; zIndex: number }>;
      updatedAt: number;
    },
    tx?: Tx,
  ): void {
    const runPatch = (d: Tx) => {
      if (patch.nameChange !== undefined) {
        d.prepare(
          `UPDATE ${TBL} SET ${C.name.sqlName} = ?, ${C.updatedAt.sqlName} = ? WHERE ${C.id.sqlName} = ?`,
        ).run(patch.nameChange, patch.updatedAt, id);
      } else {
        d.prepare(`UPDATE ${TBL} SET ${C.updatedAt.sqlName} = ? WHERE ${C.id.sqlName} = ?`).run(
          patch.updatedAt,
          id,
        );
      }
      this.nodeRepository?.patchApply(
        id,
        patch.addedNodes ?? [],
        patch.removedNodeIds ?? [],
        patch.updatedNodes ?? [],
        d,
      );
      this.edgeRepository?.patchApply(
        id,
        patch.addedEdges ?? [],
        patch.removedEdgeIds ?? [],
        patch.updatedEdges ?? [],
        d,
      );
    };

    if (tx) {
      assertCanvasActive(tx, id);
      runPatch(tx);
    } else {
      this.db.transaction(() => {
        assertCanvasActive(this.db, id);
        runPatch(this.db);
      })();
    }
  }
}

function validateLifecycleTimestamp(timestamp: number): void {
  if (!Number.isInteger(timestamp) || timestamp < 0) {
    throw new Error('Canvas lifecycle timestamp must be a nonnegative integer');
  }
}

function getArchiveState(db: Tx, canvasId: CanvasId): { archived_at: number | null } | undefined {
  return db
    .prepare(
      `SELECT ${C.archivedAt.sqlName} AS archived_at
         FROM ${TBL} WHERE ${C.id.sqlName} = ?`,
    )
    .get(canvasId) as { archived_at: number | null } | undefined;
}

function rejectArchivedCanvas(db: Tx, canvasId: CanvasId): void {
  const row = getArchiveState(db, canvasId);
  if (row?.archived_at !== null && row?.archived_at !== undefined) {
    throw new Error(`Canvas is archived and cannot be modified: ${canvasId}`);
  }
}

function assertCanvasActive(db: Tx, canvasId: CanvasId): void {
  const row = getArchiveState(db, canvasId);
  if (!row) throw new Error(`Canvas not found: ${canvasId}`);
  if (row.archived_at !== null) {
    throw new Error(`Canvas is archived and cannot be modified: ${canvasId}`);
  }
}

function assertCanvasLifecycleAllowed(db: Tx, canvasId: CanvasId): void {
  const activeRun = db
    .prepare(
      `SELECT commander_run.id
         FROM commander_runs commander_run
        WHERE commander_run.status IN ('accepted', 'running')
          AND (
            commander_run.default_canvas_id = ?
            OR EXISTS (
              SELECT 1 FROM commander_run_canvases run_canvas
               WHERE run_canvas.run_id = commander_run.id AND run_canvas.canvas_id = ?
                 AND run_canvas.released_at IS NULL
            )
          )
        LIMIT 1`,
    )
    .get(canvasId, canvasId) as { id: string } | undefined;
  if (activeRun) {
    throw new Error(`Canvas ${canvasId} is referenced by active Commander run ${activeRun.id}`);
  }

  const terminalPlaceholders = TASK_LIST_TERMINAL_STATUSES.map(() => '?').join(', ');
  const unfinishedTaskList = db
    .prepare(
      `SELECT task_list.id
         FROM task_lists task_list
        WHERE task_list.status NOT IN (${terminalPlaceholders})
          AND (
            (task_list.entity_type = 'canvas' AND task_list.entity_id = ?)
            OR EXISTS (
              SELECT 1 FROM commander_sessions session
               WHERE session.default_canvas_id = ?
                 AND session.id = json_extract(task_list.metadata_json, '$.commanderSessionId')
            )
          )
        LIMIT 1`,
    )
    .get(...TASK_LIST_TERMINAL_STATUSES, canvasId, canvasId) as { id: string } | undefined;
  if (unfinishedTaskList) {
    throw new Error(
      `Canvas ${canvasId} is referenced by unfinished Task List ${unfinishedTaskList.id}`,
    );
  }
}

function rowToCanvas(
  row: RawRow,
  nodeRepository: CanvasNodeRepository | undefined,
  edgeRepository: CanvasEdgeRepository | undefined,
  tx?: Tx,
): Canvas {
  const viewportJson = row.viewport && row.viewport.length > 0 ? row.viewport : DEFAULT_VIEWPORT;
  const notesJson = row.notes && row.notes.length > 0 ? row.notes : '[]';

  const settings: CanvasSettings = {};
  if (row.style_plate) settings.stylePlate = row.style_plate;
  if (row.negative_prompt) settings.negativePrompt = row.negative_prompt;
  if (row.default_width && row.default_height) {
    settings.refResolution = { width: row.default_width, height: row.default_height };
  }
  if (row.publish_width && row.publish_height) {
    settings.publishImageResolution = { width: row.publish_width, height: row.publish_height };
  }
  if (row.publish_video_width && row.publish_video_height) {
    settings.publishVideoResolution = {
      width: row.publish_video_width,
      height: row.publish_video_height,
    };
  }
  if (row.resolution_policy_json) {
    try {
      const parsed = ResolutionPolicySchema.safeParse(JSON.parse(row.resolution_policy_json));
      if (parsed.success) settings.resolutionPolicy = parsed.data;
    } catch {
      // Fault-soft read: legacy Canvas settings remain usable when this optional JSON is corrupt.
    }
  }
  if (row.visual_style_policy_json) {
    try {
      const parsed = CanvasVisualStylePolicySchema.safeParse(
        JSON.parse(row.visual_style_policy_json),
      );
      if (parsed.success) settings.visualStylePolicy = parsed.data;
    } catch {
      // Fault-soft read: legacy Canvas settings remain usable when this optional JSON is corrupt.
    }
  }
  if (row.aspect_ratio && isCanvasAspectRatio(row.aspect_ratio)) {
    settings.aspectRatio = row.aspect_ratio;
  }
  if (row.llm_provider_id) settings.llmProviderId = row.llm_provider_id;
  if (row.image_provider_id) settings.imageProviderId = row.image_provider_id;
  if (row.video_provider_id) settings.videoProviderId = row.video_provider_id;
  if (row.audio_provider_id) settings.audioProviderId = row.audio_provider_id;

  if ((row.delivery_sequence_json === null) !== (row.delivery_sequence_revision === 0)) {
    throw new Error(`Canvas ${row.id} has inconsistent delivery sequence storage`);
  }

  const canvas: Canvas = {
    id: row.id,
    name: row.name,
    nodes: nodeRepository?.getByCanvasId(row.id, tx) ?? [],
    edges: edgeRepository?.getByCanvasId(row.id, tx) ?? [],
    viewport: JSON.parse(viewportJson) as Canvas['viewport'],
    notes: JSON.parse(notesJson) as Canvas['notes'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.archived_at !== null) canvas.archivedAt = row.archived_at;
  if (Object.keys(settings).length > 0) canvas.settings = settings;
  if (row.delivery_sequence_json !== null) {
    const sequence = OrderedDeliverySequenceSchema.parse(
      JSON.parse(row.delivery_sequence_json),
    ) as OrderedDeliverySequence;
    if (sequence.revision !== row.delivery_sequence_revision) {
      throw new Error(`Canvas ${row.id} delivery sequence revision does not match its document`);
    }
    canvas.deliverySequence = sequence;
  }
  return canvas;
}

function validateDeliveryReferences(db: Tx, value: OrderedDeliverySequence): string[] {
  const findAsset = db.prepare(
    'SELECT type, duration, has_audio FROM asset_contents WHERE hash = ?',
  );
  const hashes = new Set<string>();
  for (const item of value.items) {
    const stored = findAsset.get(item.selectedVideoHash) as
      { type: string; duration: number | null; has_audio: number | null } | undefined;
    if (!stored) {
      throw new Error(`Delivery video is not owned by local CAS: ${item.selectedVideoHash}`);
    }
    if (stored.type !== 'video') {
      throw new Error(`Delivery asset is not a video: ${item.selectedVideoHash}`);
    }
    if (stored.duration === null || !Number.isFinite(stored.duration) || stored.duration <= 0) {
      throw new Error(`Delivery video duration metadata is unavailable: ${item.selectedVideoHash}`);
    }
    if (item.trimOutMs > Math.round(stored.duration * 1_000)) {
      throw new Error(`Delivery trim exceeds video duration: ${item.selectedVideoHash}`);
    }
    if (item.embeddedAudioEnabled && stored.has_audio !== 1) {
      throw new Error(`Delivery video has no confirmed embedded audio: ${item.selectedVideoHash}`);
    }
    hashes.add(item.selectedVideoHash);
  }
  return [...hashes];
}

function replaceDeliveryAssetRefs(db: Tx, canvasId: string, assetHashes: string[]): void {
  db.prepare('DELETE FROM delivery_asset_refs WHERE canvas_id = ?').run(canvasId);
  const insert = db.prepare(
    'INSERT INTO delivery_asset_refs (canvas_id, asset_hash) VALUES (?, ?)',
  );
  for (const hash of assetHashes) insert.run(canvasId, hash);
}

function rejectActiveDeliveryPackages(db: Tx, canvasId: string): void {
  const active = db
    .prepare(
      `SELECT attempt.id
         FROM task_attempts attempt
         JOIN task_lists task_list ON task_list.id = attempt.task_list_id
        WHERE task_list.entity_type = 'canvas' AND task_list.entity_id = ?
          AND attempt.kind = 'batch_export'
          AND attempt.status IN ('queued', 'running', 'ready_to_publish', 'recovery_required')
        LIMIT 1`,
    )
    .get(canvasId);
  if (active) throw new Error('Delivery sequence cannot change while a batch export is active');
}

function invalidateDeliveryWorkflows(
  db: Tx,
  canvasId: string,
  sequence: OrderedDeliverySequence,
  sequenceHash: string,
): void {
  const taskLists = db
    .prepare(
      `SELECT DISTINCT task_list.id, delivery_task.id AS task_id
         FROM task_lists task_list
         JOIN tasks delivery_task ON delivery_task.task_list_id = task_list.id
        WHERE task_list.entity_type = 'canvas' AND task_list.entity_id = ?
          AND json_extract(delivery_task.input_json, '$.taskRole') = 'delivery'
          AND (
            task_list.status = 'completed'
            OR EXISTS (
              SELECT 1 FROM plan_approvals approval
               WHERE approval.task_list_id = task_list.id
                 AND approval.gate_key = 'delivery'
                 AND approval.status IN ('pending', 'approved')
            )
          )
        ORDER BY task_list.id`,
    )
    .all(canvasId) as Array<{ id: string; task_id: string }>;

  for (const taskList of taskLists) {
    db.prepare(
      `UPDATE plan_approvals
          SET status = 'invalidated', decided_at = ?, updated_at = ?
        WHERE task_list_id = ? AND gate_key = 'delivery'
          AND status IN ('pending', 'approved')`,
    ).run(sequence.updatedAt, sequence.updatedAt, taskList.id);
    db.prepare(
      `UPDATE tasks
          SET status = 'ready', output_json = '{}', error_text = NULL,
              progress = 0, current_step = 'sequence_changed',
              completed_at = NULL, updated_at = ?
        WHERE id = ? AND task_list_id = ?`,
    ).run(sequence.updatedAt, taskList.task_id, taskList.id);
    db.prepare(
      `UPDATE task_lists
          SET status = 'ready', current_gate = NULL,
              current_phase_key = 'delivery', current_task_id = ?,
              completed_tasks = (
                SELECT COUNT(*) FROM tasks
                 WHERE task_list_id = ? AND status = 'completed'
              ),
              completed_phases = (
                SELECT COUNT(*) FROM (
                  SELECT phase_key FROM tasks WHERE task_list_id = ? GROUP BY phase_key
                  HAVING SUM(CASE WHEN status NOT IN ('completed', 'skipped') THEN 1 ELSE 0 END) = 0
                )
              ),
              error_text = NULL, completed_at = NULL, updated_at = ?,
              row_version = row_version + 1
        WHERE id = ?`,
    ).run(taskList.task_id, taskList.id, taskList.id, sequence.updatedAt, taskList.id);
    const seq = db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS value FROM task_events WHERE task_list_id = ?')
      .get(taskList.id) as { value: number };
    db.prepare(
      `INSERT INTO task_events (
         task_list_id, seq, event_id, actor, correlation_id, causation_id,
         payload_json, event_timestamp
       ) VALUES (?, ?, ?, 'system', NULL, NULL, ?, ?)`,
    ).run(
      taskList.id,
      Number(seq.value),
      `delivery-sequence-invalidated:${taskList.id}:${sequence.revision}`,
      JSON.stringify({
        type: 'task_list.delivery.invalidated',
        canvasId,
        deliverySequenceRevision: sequence.revision,
        deliverySequenceHash: sequenceHash,
      }),
      sequence.updatedAt,
    );
  }
}

const ASPECT_RATIO_VALUES: ReadonlySet<CanvasAspectRatio> = new Set<CanvasAspectRatio>([
  '16:9',
  '9:16',
  '1:1',
  '2.39:1',
]);

function isCanvasAspectRatio(value: string): value is CanvasAspectRatio {
  return (ASPECT_RATIO_VALUES as ReadonlySet<string>).has(value);
}

function parseRows(
  rows: RawRow[],
  nodeRepository: CanvasNodeRepository | undefined,
  edgeRepository: CanvasEdgeRepository | undefined,
  tx?: Tx,
): ListResult<Canvas> {
  const out: Canvas[] = [];
  let degradedCount = 0;
  const SENTINEL = Symbol('degraded');
  for (const row of rows) {
    let candidate: Canvas | RawRow;
    try {
      candidate = rowToCanvas(row, nodeRepository, edgeRepository, tx);
    } catch {
      // JSON parse failed — feed the raw row to parseOrDegrade so zod
      // rejects it and the degrade reporter fires (observability parity
      // with schema-mismatch failures). The schema won't match string
      // columns against object fields, guaranteeing the fallback path.
      candidate = row;
    }
    const parsed = parseOrDegrade(CanvasSchema, candidate, SENTINEL as unknown as Canvas, {
      ctx: { name: 'Canvas' },
    });
    if ((parsed as unknown) === SENTINEL) {
      degradedCount += 1;
      continue;
    }
    out.push(parsed as Canvas);
  }
  return { rows: out, degradedCount };
}
