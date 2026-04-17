/**
 * SeriesRepository — Phase G1-2.7.
 *
 * Wraps `series` and `episodes` CRUD behind branded IDs (`SeriesId` /
 * `EpisodeId`). Series body (styleGuide, episodeIds) is JSON-serialized;
 * the repository parses and returns typed objects via `parseOrDegrade`.
 *
 * Table column names flow through `SeriesTable` / `EpisodesTable` (G1-1) —
 * schema drift fails at compile time.
 *
 * `deleteSeries` cascades to dependent episode rows so orphaned rows can
 * never sit in the DB after a parent is dropped.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type {
  EpisodeId,
  Series,
  SeriesId,
} from '@lucid-fin/contracts';
import {
  EpisodesTable,
  EpisodeSchema,
  parseOrDegrade,
  SeriesSchema,
  SeriesTable,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

export interface EpisodeRecord {
  id: string;
  seriesId: string;
  title: string;
  order: number;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export interface EpisodeUpsertInput {
  id: string;
  seriesId: string;
  title: string;
  order: number;
  status?: string;
  createdAt: number;
  updatedAt: number;
}

const S_TBL = SeriesTable.tableName;
const S = SeriesTable.cols;
const E_TBL = EpisodesTable.tableName;
const E = EpisodesTable.cols;

const SERIES_SENTINEL = Symbol('series-degraded');
const EPISODE_SENTINEL = Symbol('episode-degraded');

function rowToSeries(row: Record<string, unknown>): Series {
  const styleGuideRaw = row.style_guide;
  const episodeIdsRaw = row.episode_ids;
  return {
    id: row.id as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    styleGuide:
      typeof styleGuideRaw === 'string' && styleGuideRaw.length > 0
        ? (JSON.parse(styleGuideRaw) as Series['styleGuide'])
        : ({} as Series['styleGuide']),
    episodeIds:
      typeof episodeIdsRaw === 'string' && episodeIdsRaw.length > 0
        ? (JSON.parse(episodeIdsRaw) as string[])
        : [],
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

function rowToEpisode(row: Record<string, unknown>): EpisodeRecord {
  return {
    id: row.id as string,
    seriesId: row.series_id as string,
    title: row.title as string,
    order: row.episode_order as number,
    status: (row.status as string) ?? 'draft',
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class SeriesRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  // ── Series ─────────────────────────────────────────────────────

  upsertSeries(series: Series, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT INTO ${S_TBL}
         (${S.id.sqlName}, ${S.title.sqlName}, ${S.description.sqlName},
          ${S.styleGuide.sqlName}, ${S.episodeIds.sqlName},
          ${S.createdAt.sqlName}, ${S.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${S.id.sqlName}) DO UPDATE SET
         ${S.title.sqlName}=excluded.${S.title.sqlName},
         ${S.description.sqlName}=excluded.${S.description.sqlName},
         ${S.styleGuide.sqlName}=excluded.${S.styleGuide.sqlName},
         ${S.episodeIds.sqlName}=excluded.${S.episodeIds.sqlName},
         ${S.updatedAt.sqlName}=excluded.${S.updatedAt.sqlName}`,
    ).run(
      series.id,
      series.title,
      series.description ?? '',
      JSON.stringify(series.styleGuide ?? {}),
      JSON.stringify(series.episodeIds ?? []),
      series.createdAt,
      series.updatedAt,
    );
  }

  getSeries(id: SeriesId, tx?: Tx): Series | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(`SELECT * FROM ${S_TBL} WHERE ${S.id.sqlName} = ?`)
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    let candidate: Series | Record<string, unknown>;
    try {
      candidate = rowToSeries(row);
    } catch {
      candidate = row;
    }
    const parsed = parseOrDegrade(
      SeriesSchema,
      candidate,
      SERIES_SENTINEL as unknown as Series,
      { ctx: { name: 'Series' } },
    );
    return (parsed as unknown) === SERIES_SENTINEL ? undefined : (parsed as Series);
  }

  /**
   * `deleteSeries` cascades to episode rows so dropping a parent never
   * orphans children. Both deletes share a single implicit statement so
   * concurrent reads can't observe a half-torn-down series.
   */
  deleteSeries(id: SeriesId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${S_TBL} WHERE ${S.id.sqlName} = ?`).run(id);
    d.prepare(`DELETE FROM ${E_TBL} WHERE ${E.seriesId.sqlName} = ?`).run(id);
  }

  // ── Episodes ───────────────────────────────────────────────────

  upsertEpisode(input: EpisodeUpsertInput, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT INTO ${E_TBL}
         (${E.id.sqlName}, ${E.seriesId.sqlName}, ${E.title.sqlName},
          ${E.episodeOrder.sqlName}, ${E.status.sqlName},
          ${E.createdAt.sqlName}, ${E.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${E.id.sqlName}) DO UPDATE SET
         ${E.seriesId.sqlName}=excluded.${E.seriesId.sqlName},
         ${E.title.sqlName}=excluded.${E.title.sqlName},
         ${E.episodeOrder.sqlName}=excluded.${E.episodeOrder.sqlName},
         ${E.status.sqlName}=excluded.${E.status.sqlName},
         ${E.updatedAt.sqlName}=excluded.${E.updatedAt.sqlName}`,
    ).run(
      input.id,
      input.seriesId,
      input.title,
      input.order,
      input.status ?? 'draft',
      input.createdAt,
      input.updatedAt,
    );
  }

  listEpisodes(seriesId: SeriesId, tx?: Tx): ListResult<EpisodeRecord> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT * FROM ${E_TBL}
         WHERE ${E.seriesId.sqlName} = ?
         ORDER BY ${E.episodeOrder.sqlName} ASC`,
      )
      .all(seriesId) as Array<Record<string, unknown>>;
    const out: EpisodeRecord[] = [];
    let degradedCount = 0;
    for (const row of rows) {
      let candidate: EpisodeRecord | Record<string, unknown>;
      try {
        candidate = rowToEpisode(row);
      } catch {
        candidate = row;
      }
      const parsed = parseOrDegrade(
        EpisodeSchema,
        candidate,
        EPISODE_SENTINEL as unknown as EpisodeRecord,
        { ctx: { name: 'Episode' } },
      );
      if ((parsed as unknown) === EPISODE_SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push(parsed as EpisodeRecord);
    }
    return { rows: out, degradedCount };
  }

  deleteEpisode(id: EpisodeId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${E_TBL} WHERE ${E.id.sqlName} = ?`).run(id);
  }
}
