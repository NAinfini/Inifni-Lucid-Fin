/**
 * CommanderEventRepository — Phase 5.
 *
 * Append-only store for `TimelineEvent`s keyed by (sessionId, runId, seq).
 * The renderer hydrates the timeline slice from this repo on session
 * resume; writes are driven by the main-process emit hook.
 *
 * Payload is the full stamped event as JSON. We factor out (kind, step,
 * emittedAt) into columns so queries can filter without decoding every
 * blob.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { SessionId } from '@lucid-fin/contracts';
import { CommanderEventsTable } from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

export interface StoredCommanderEvent {
  sessionId: SessionId;
  runId: string;
  seq: number;
  kind: string;
  step: number;
  emittedAt: number;
  payload: string;
}

type RawRow = {
  session_id: string;
  run_id: string;
  seq: number;
  kind: string;
  step: number;
  emitted_at: number;
  payload: string;
};

const TBL = CommanderEventsTable.tableName;
const C = CommanderEventsTable.cols;

export class CommanderEventRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  /**
   * Append a single event. On (session_id, run_id, seq) conflict we
   * overwrite — the renderer's middleware is idempotent on replay, and
   * the orchestrator never reuses a (run, seq) pair in one session.
   */
  append(event: StoredCommanderEvent, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `
      INSERT INTO ${TBL}
        (${C.sessionId.sqlName}, ${C.runId.sqlName}, ${C.seq.sqlName},
         ${C.kind.sqlName}, ${C.step.sqlName}, ${C.emittedAt.sqlName},
         ${C.payload.sqlName})
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(${C.sessionId.sqlName}, ${C.runId.sqlName}, ${C.seq.sqlName}) DO UPDATE SET
        ${C.kind.sqlName}      = excluded.${C.kind.sqlName},
        ${C.step.sqlName}      = excluded.${C.step.sqlName},
        ${C.emittedAt.sqlName} = excluded.${C.emittedAt.sqlName},
        ${C.payload.sqlName}   = excluded.${C.payload.sqlName}
      `,
    ).run(
      event.sessionId,
      event.runId,
      event.seq,
      event.kind,
      event.step,
      event.emittedAt,
      event.payload,
    );
  }

  /**
   * Read all events for a session in wire order (run_id, seq). Payload
   * rows are returned as-is — caller is responsible for JSON parsing
   * and schema validation via the timeline-event zod schema.
   */
  listBySession(sessionId: SessionId, tx?: Tx): StoredCommanderEvent[] {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${C.sessionId.sqlName}, ${C.runId.sqlName}, ${C.seq.sqlName},
                ${C.kind.sqlName}, ${C.step.sqlName}, ${C.emittedAt.sqlName},
                ${C.payload.sqlName}
         FROM ${TBL}
         WHERE ${C.sessionId.sqlName} = ?
         ORDER BY ${C.runId.sqlName}, ${C.seq.sqlName}`,
      )
      .all(sessionId) as RawRow[];
    return rows.map(rowToEvent);
  }

  /** Read a single run's events. */
  listByRun(sessionId: SessionId, runId: string, tx?: Tx): StoredCommanderEvent[] {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${C.sessionId.sqlName}, ${C.runId.sqlName}, ${C.seq.sqlName},
                ${C.kind.sqlName}, ${C.step.sqlName}, ${C.emittedAt.sqlName},
                ${C.payload.sqlName}
         FROM ${TBL}
         WHERE ${C.sessionId.sqlName} = ? AND ${C.runId.sqlName} = ?
         ORDER BY ${C.seq.sqlName}`,
      )
      .all(sessionId, runId) as RawRow[];
    return rows.map(rowToEvent);
  }

  /** Cascade-delete all events for a session. Used on session delete. */
  deleteBySession(sessionId: SessionId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.sessionId.sqlName} = ?`).run(sessionId);
  }
}

function rowToEvent(row: RawRow): StoredCommanderEvent {
  return {
    sessionId: row.session_id as SessionId,
    runId: row.run_id,
    seq: row.seq,
    kind: row.kind,
    step: row.step,
    emittedAt: row.emitted_at,
    payload: row.payload,
  };
}
