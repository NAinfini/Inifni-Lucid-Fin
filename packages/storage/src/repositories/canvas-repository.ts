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
import type {
  Canvas,
  CanvasId,
  CanvasSettings,
  CanvasAspectRatio,
} from '@lucid-fin/contracts';
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
  style_plate: string | null;
  negative_prompt: string | null;
  default_width: number | null;
  default_height: number | null;
  publish_width: number | null;
  publish_height: number | null;
  publish_video_width: number | null;
  publish_video_height: number | null;
  aspect_ratio: string | null;
  llm_provider_id: string | null;
  image_provider_id: string | null;
  video_provider_id: string | null;
  audio_provider_id: string | null;
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
  C.stylePlate.sqlName,
  C.negativePrompt.sqlName,
  C.refWidth.sqlName,
  C.refHeight.sqlName,
  C.publishImageWidth.sqlName,
  C.publishImageHeight.sqlName,
  C.publishVideoWidth.sqlName,
  C.publishVideoHeight.sqlName,
  C.aspectRatio.sqlName,
  C.llmProviderId.sqlName,
  C.imageProviderId.sqlName,
  C.videoProviderId.sqlName,
  C.audioProviderId.sqlName,
  C.createdAt.sqlName,
  C.updatedAt.sqlName,
].join(', ');

const DEFAULT_VIEWPORT = '{"x":0,"y":0,"zoom":1}';

export class CanvasRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsert(canvas: Canvas, tx?: Tx): void {
    const d = tx ?? this.db;
    const s = canvas.settings ?? {};
    d.prepare(
      `INSERT INTO ${TBL}
         (${C.id.sqlName}, ${C.name.sqlName}, ${C.nodes.sqlName}, ${C.edges.sqlName},
          ${C.viewport.sqlName}, ${C.notes.sqlName},
          ${C.stylePlate.sqlName}, ${C.negativePrompt.sqlName},
          ${C.refWidth.sqlName}, ${C.refHeight.sqlName},
          ${C.publishImageWidth.sqlName}, ${C.publishImageHeight.sqlName},
          ${C.publishVideoWidth.sqlName}, ${C.publishVideoHeight.sqlName},
          ${C.aspectRatio.sqlName},
          ${C.llmProviderId.sqlName}, ${C.imageProviderId.sqlName},
          ${C.videoProviderId.sqlName}, ${C.audioProviderId.sqlName},
          ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
         ${C.name.sqlName}            = excluded.${C.name.sqlName},
         ${C.nodes.sqlName}           = excluded.${C.nodes.sqlName},
         ${C.edges.sqlName}           = excluded.${C.edges.sqlName},
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
         ${C.aspectRatio.sqlName}     = excluded.${C.aspectRatio.sqlName},
         ${C.llmProviderId.sqlName}   = excluded.${C.llmProviderId.sqlName},
         ${C.imageProviderId.sqlName} = excluded.${C.imageProviderId.sqlName},
         ${C.videoProviderId.sqlName} = excluded.${C.videoProviderId.sqlName},
         ${C.audioProviderId.sqlName} = excluded.${C.audioProviderId.sqlName},
         ${C.updatedAt.sqlName}       = excluded.${C.updatedAt.sqlName}`,
    ).run(
      canvas.id,
      canvas.name,
      JSON.stringify(canvas.nodes ?? []),
      JSON.stringify(canvas.edges ?? []),
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
      s.aspectRatio ?? null,
      s.llmProviderId ?? null,
      s.imageProviderId ?? null,
      s.videoProviderId ?? null,
      s.audioProviderId ?? null,
      canvas.createdAt,
      canvas.updatedAt,
    );
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
      [Exclude<keyof CanvasSettings, 'refResolution' | 'publishImageResolution' | 'publishVideoResolution'>, string]
    > = [
      ['stylePlate',      C.stylePlate.sqlName],
      ['negativePrompt',  C.negativePrompt.sqlName],
      ['aspectRatio',     C.aspectRatio.sqlName],
      ['llmProviderId',   C.llmProviderId.sqlName],
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
    if (sets.length === 0) return 0;
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

  const settings: CanvasSettings = {};
  if (row.style_plate)       settings.stylePlate       = row.style_plate;
  if (row.negative_prompt)   settings.negativePrompt   = row.negative_prompt;
  if (row.default_width && row.default_height) {
    settings.refResolution = { width: row.default_width, height: row.default_height };
  }
  if (row.publish_width && row.publish_height) {
    settings.publishImageResolution = { width: row.publish_width, height: row.publish_height };
  }
  if (row.publish_video_width && row.publish_video_height) {
    settings.publishVideoResolution = { width: row.publish_video_width, height: row.publish_video_height };
  }
  if (row.aspect_ratio && isCanvasAspectRatio(row.aspect_ratio)) {
    settings.aspectRatio = row.aspect_ratio;
  }
  if (row.llm_provider_id)   settings.llmProviderId   = row.llm_provider_id;
  if (row.image_provider_id) settings.imageProviderId = row.image_provider_id;
  if (row.video_provider_id) settings.videoProviderId = row.video_provider_id;
  if (row.audio_provider_id) settings.audioProviderId = row.audio_provider_id;

  const canvas: Canvas = {
    id: row.id,
    name: row.name,
    nodes: JSON.parse(nodesJson) as Canvas['nodes'],
    edges: JSON.parse(edgesJson) as Canvas['edges'],
    viewport: JSON.parse(viewportJson) as Canvas['viewport'],
    notes: JSON.parse(notesJson) as Canvas['notes'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (Object.keys(settings).length > 0) canvas.settings = settings;
  return canvas;
}

const ASPECT_RATIO_VALUES: ReadonlySet<CanvasAspectRatio> =
  new Set<CanvasAspectRatio>(['16:9', '9:16', '1:1', '2.39:1']);

function isCanvasAspectRatio(value: string): value is CanvasAspectRatio {
  return (ASPECT_RATIO_VALUES as ReadonlySet<string>).has(value);
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
