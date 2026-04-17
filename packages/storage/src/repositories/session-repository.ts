/**
 * SessionRepository — Phase G1-2.1.
 *
 * Wraps commander_sessions CRUD behind branded IDs + fault-soft reads.
 * Reads loop rows through `parseOrDegrade` so a corrupt row in the
 * DB results in a degraded-read telemetry event + skip, not a crash.
 *
 * SQL references column names through the G1-1 `CommanderSessionsTable`
 * constant — schema drift now fails at compile time.
 *
 * Phase G1-5 consumer migration (to land alongside G1-4 SqliteIndex
 * reduction) will switch `snapshot.handlers.ts` from calling
 * `SqliteIndex.upsertSession(...)` to calling this repository directly.
 * Until then `SqliteIndex` delegates its legacy session methods here.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { SessionId } from '@lucid-fin/contracts';
import {
  CommanderSessionsTable,
  StoredSessionSchema,
  parseOrDegrade,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

/**
 * Row shape stored in `commander_sessions`. Mirrors the DTO but keeps the
 * repository signature readable without forcing every caller to import the
 * zod-inferred type.
 */
export interface StoredSession {
  id: SessionId;
  canvasId: string | null;
  title: string;
  messages: string;
  createdAt: number;
  updatedAt: number;
}

/** Result shape for list reads that surface degraded-row counts. */
export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

type RawRow = {
  id: string;
  canvas_id: string | null;
  title: string;
  messages: string;
  created_at: number;
  updated_at: number;
};

const TBL = CommanderSessionsTable.tableName;
const C = CommanderSessionsTable.cols;

export class SessionRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsert(session: StoredSession, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `
      INSERT INTO ${TBL}
        (${C.id.sqlName}, ${C.canvasId.sqlName}, ${C.title.sqlName}, ${C.messages.sqlName},
         ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
        ${C.canvasId.sqlName}  = excluded.${C.canvasId.sqlName},
        ${C.title.sqlName}     = excluded.${C.title.sqlName},
        ${C.messages.sqlName}  = excluded.${C.messages.sqlName},
        ${C.updatedAt.sqlName} = excluded.${C.updatedAt.sqlName}
      `,
    ).run(
      session.id,
      session.canvasId,
      session.title,
      session.messages,
      session.createdAt,
      session.updatedAt,
    );
  }

  get(id: SessionId, tx?: Tx): StoredSession | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(
        `SELECT ${C.id.sqlName}, ${C.canvasId.sqlName}, ${C.title.sqlName}, ${C.messages.sqlName},
                ${C.createdAt.sqlName}, ${C.updatedAt.sqlName}
         FROM ${TBL}
         WHERE ${C.id.sqlName} = ?`,
      )
      .get(id) as RawRow | undefined;
    if (!row) return undefined;
    return rowToSession(row);
  }

  list(limit = 50, tx?: Tx): ListResult<StoredSession> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${C.id.sqlName}, ${C.canvasId.sqlName}, ${C.title.sqlName}, ${C.messages.sqlName},
                ${C.createdAt.sqlName}, ${C.updatedAt.sqlName}
         FROM ${TBL}
         ORDER BY ${C.updatedAt.sqlName} DESC LIMIT ?`,
      )
      .all(limit) as RawRow[];

    const out: StoredSession[] = [];
    let degradedCount = 0;
    const SENTINEL = Symbol('degraded');
    for (const row of rows) {
      const parsed = parseOrDegrade(
        StoredSessionSchema,
        rowToSession(row),
        SENTINEL as unknown as ReturnType<typeof rowToSession>,
        { ctx: { name: 'StoredSession' } },
      );
      if ((parsed as unknown) === SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push({ ...parsed, id: parsed.id as SessionId });
    }
    return { rows: out, degradedCount };
  }

  delete(id: SessionId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`,
    ).run(id);
  }
}

function rowToSession(row: RawRow): StoredSession {
  return {
    id: row.id as SessionId,
    canvasId: row.canvas_id,
    title: row.title,
    messages: row.messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
