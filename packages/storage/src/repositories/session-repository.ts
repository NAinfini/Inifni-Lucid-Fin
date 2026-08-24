/**
 * Commander session persistence.
 *
 * Wraps commander_sessions CRUD behind branded IDs + fault-soft reads.
 * Reads loop rows through `parseOrDegrade` so a corrupt row in the
 * DB results in a degraded-read telemetry event + skip, not a crash.
 *
 * SQL references column names through the `CommanderSessionsTable`
 * constant — schema drift now fails at compile time.
 *
 * The public, reproducible Commander context cache is persisted behind the
 * existing `context_graph_json` column. Immutable Commander events remain the
 * authority; this column is only a validated performance cache.
 */

import type BetterSqlite3 from 'better-sqlite3';
import {
  TASK_LIST_TERMINAL_STATUSES,
  type SessionId,
  type CommanderContextCache,
} from '@lucid-fin/contracts';
import {
  CommanderContextCacheSchema,
  CommanderSessionsTable,
  CommanderRunsTable,
  TaskListsTable,
  StoredSessionSchema,
  StoredSessionSummarySchema,
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
  defaultCanvasId: string | null;
  title: string;
  messages: string;
  createdAt: number;
  updatedAt: number;
}

export interface StoredSessionSummary extends Omit<StoredSession, 'messages'> {
  messageCount: number;
}

/** Result shape for list reads that surface degraded-row counts. */
export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

export type StoredContextCacheRead =
  | { state: 'missing' }
  | { state: 'invalid' }
  | { state: 'valid'; cache: CommanderContextCache };

type RawRow = {
  id: string;
  default_canvas_id: string | null;
  title: string;
  messages: string;
  created_at: number;
  updated_at: number;
};

type RawSummaryRow = Omit<RawRow, 'messages'> & { message_count: number | null };

const TBL = CommanderSessionsTable.tableName;
const C = CommanderSessionsTable.cols;
const RUNS = CommanderRunsTable;
const TASK_LISTS = TaskListsTable;

export class SessionRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsert(session: StoredSession, tx?: Tx): void {
    const write = (d: Tx): void => {
      const existing = d
        .prepare(
          `SELECT ${C.defaultCanvasId.sqlName} AS default_canvas_id
             FROM ${TBL}
            WHERE ${C.id.sqlName} = ?`,
        )
        .get(session.id) as { default_canvas_id: string | null } | undefined;
      if (existing && existing.default_canvas_id !== session.defaultCanvasId) {
        this.assertSessionCanChangeOwnership(d, session.id);
      }

      d.prepare(
        `
      INSERT INTO ${TBL}
        (${C.id.sqlName}, ${C.defaultCanvasId.sqlName}, ${C.title.sqlName}, ${C.messages.sqlName},
         ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
        ${C.defaultCanvasId.sqlName} = excluded.${C.defaultCanvasId.sqlName},
        ${C.title.sqlName}     = excluded.${C.title.sqlName},
        ${C.messages.sqlName}  = excluded.${C.messages.sqlName},
        ${C.updatedAt.sqlName} = excluded.${C.updatedAt.sqlName}
        `,
      ).run(
        session.id,
        session.defaultCanvasId,
        session.title,
        session.messages,
        session.createdAt,
        session.updatedAt,
      );
    };
    if (tx) write(tx);
    else this.db.transaction(() => write(this.db))();
  }

  get(id: SessionId, tx?: Tx): StoredSession | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(
        `SELECT ${C.id.sqlName}, ${C.defaultCanvasId.sqlName}, ${C.title.sqlName}, ${C.messages.sqlName},
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
        `SELECT ${C.id.sqlName}, ${C.defaultCanvasId.sqlName}, ${C.title.sqlName}, ${C.messages.sqlName},
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

  listSummaries(limit = 50, tx?: Tx): ListResult<StoredSessionSummary> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${C.id.sqlName}, ${C.defaultCanvasId.sqlName}, ${C.title.sqlName},
                ${C.createdAt.sqlName}, ${C.updatedAt.sqlName},
                CASE
                  WHEN json_valid(${C.messages.sqlName}) THEN
                    CASE WHEN json_type(${C.messages.sqlName}) = 'array'
                      THEN json_array_length(${C.messages.sqlName})
                    END
                  ELSE NULL
                END AS message_count
           FROM ${TBL}
          ORDER BY ${C.updatedAt.sqlName} DESC LIMIT ?`,
      )
      .all(limit) as RawSummaryRow[];

    const out: StoredSessionSummary[] = [];
    let degradedCount = 0;
    const SENTINEL = Symbol('degraded');
    for (const row of rows) {
      const parsed = parseOrDegrade(
        StoredSessionSummarySchema,
        rowToSessionSummary(row),
        SENTINEL as unknown as StoredSessionSummary,
        { ctx: { name: 'StoredSessionSummary' } },
      );
      if ((parsed as unknown) === SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push({ ...parsed, id: parsed.id as SessionId });
    }
    return { rows: out, degradedCount };
  }

  move(id: SessionId, defaultCanvasId: string | null, tx?: Tx): void {
    const moveWithin = (d: Tx): void => {
      const existing = d
        .prepare(
          `SELECT ${C.defaultCanvasId.sqlName} AS default_canvas_id
             FROM ${TBL}
            WHERE ${C.id.sqlName} = ?`,
        )
        .get(id) as { default_canvas_id: string | null } | undefined;
      if (!existing) throw new Error(`Commander session "${id}" not found`);
      if (existing.default_canvas_id === defaultCanvasId) return;
      this.assertSessionCanChangeOwnership(d, id);
      d.prepare(
        `UPDATE ${TBL}
            SET ${C.defaultCanvasId.sqlName} = ?
          WHERE ${C.id.sqlName} = ?`,
      ).run(defaultCanvasId, id);
    };
    if (tx) moveWithin(tx);
    else this.db.transaction(() => moveWithin(this.db))();
  }

  delete(id: SessionId, tx?: Tx): void {
    const remove = (d: Tx): void => {
      this.assertSessionCanChangeOwnership(d, id);
      d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
    };
    if (tx) remove(tx);
    else this.db.transaction(() => remove(this.db))();
  }

  deleteTerminal(id: SessionId, tx?: Tx): boolean {
    const remove = (d: Tx): boolean => {
      if (this.sessionOwnershipBlock(d, id)) return false;
      d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
      return true;
    };
    return tx ? remove(tx) : this.db.transaction(() => remove(this.db))();
  }

  private assertSessionCanChangeOwnership(d: Tx, id: SessionId): void {
    const block = this.sessionOwnershipBlock(d, id);
    if (block === 'active-run') {
      throw new Error(`Commander session "${id}" has an active run`);
    }
    if (block === 'unfinished-task-list') {
      throw new Error(`Commander session "${id}" has an unfinished Task List`);
    }
  }

  private sessionOwnershipBlock(
    d: Tx,
    id: SessionId,
  ): 'active-run' | 'unfinished-task-list' | undefined {
    const activeRun = d
      .prepare(
        `SELECT 1
           FROM ${RUNS.tableName}
          WHERE ${RUNS.cols.sessionId.sqlName} = ?
            AND ${RUNS.cols.status.sqlName} IN ('accepted', 'running')
          LIMIT 1`,
      )
      .get(id);
    if (activeRun) return 'active-run';

    const terminalPlaceholders = TASK_LIST_TERMINAL_STATUSES.map(() => '?').join(', ');
    const safeMetadata = `CASE WHEN json_valid(${TASK_LISTS.cols.metadataJson.sqlName}) THEN ${TASK_LISTS.cols.metadataJson.sqlName} ELSE '{}' END`;
    const unfinishedTaskList = d
      .prepare(
        `SELECT 1
           FROM ${TASK_LISTS.tableName}
          WHERE json_type(${safeMetadata}, '$.commanderSessionId') = 'text'
            AND trim(json_extract(${safeMetadata}, '$.commanderSessionId')) = ?
            AND ${TASK_LISTS.cols.status.sqlName} NOT IN (${terminalPlaceholders})
          LIMIT 1`,
      )
      .get(id, ...TASK_LIST_TERMINAL_STATUSES);
    return unfinishedTaskList ? 'unfinished-task-list' : undefined;
  }

  readContextCache(id: SessionId, tx?: Tx): StoredContextCacheRead {
    const d = tx ?? this.db;
    const row = d
      .prepare(
        `SELECT ${C.contextGraphJson.sqlName}
         FROM ${TBL}
         WHERE ${C.id.sqlName} = ?`,
      )
      .get(id) as { context_graph_json: string | null } | undefined;

    if (!row || row.context_graph_json == null) return { state: 'missing' };

    let parsed: unknown;
    try {
      parsed = JSON.parse(row.context_graph_json);
    } catch {
      return { state: 'invalid' };
    }

    const result = CommanderContextCacheSchema.safeParse(parsed);
    return result.success
      ? { state: 'valid', cache: result.data }
      : { state: 'invalid' };
  }

  saveContextCache(id: SessionId, cache: CommanderContextCache, tx?: Tx): void {
    const parsed = CommanderContextCacheSchema.parse(cache);
    const d = tx ?? this.db;
    d.prepare(
      `UPDATE ${TBL} SET ${C.contextGraphJson.sqlName} = ?
       WHERE ${C.id.sqlName} = ?`,
    ).run(JSON.stringify(parsed), id);
  }

  clearContextCache(id: SessionId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `UPDATE ${TBL} SET ${C.contextGraphJson.sqlName} = NULL
       WHERE ${C.id.sqlName} = ?`,
    ).run(id);
  }
}

function rowToSession(row: RawRow): StoredSession {
  return {
    id: row.id as SessionId,
    defaultCanvasId: row.default_canvas_id,
    title: row.title,
    messages: row.messages,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSessionSummary(row: RawSummaryRow): StoredSessionSummary {
  return {
    id: row.id as SessionId,
    defaultCanvasId: row.default_canvas_id,
    title: row.title,
    messageCount: row.message_count as number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
