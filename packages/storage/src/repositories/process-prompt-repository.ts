/**
 * ProcessPromptRepository — Phase G1-2.2.
 *
 * Process-prompt CRUD behind `ProcessPromptKey` brand + fault-soft reads.
 * Schema creation, seeding, and legacy-key migration still live on the
 * `ProcessPromptStore` class (which owns its own database handle); this
 * repository receives an already-initialized handle and is only
 * responsible for CRUD against `process_prompts`.
 *
 * SQL references column names through the G1-1 `ProcessPromptsTable`
 * constant — schema drift fails at compile time.
 *
 * Reads loop rows through `parseOrDegrade` with a `ProcessPromptRecord`
 * context so a corrupt row surfaces as degraded-read telemetry + skip,
 * not a crash in the Settings window.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ProcessPromptKey } from '@lucid-fin/contracts';
import {
  ProcessPromptsTable,
  ProcessPromptRecordSchema,
  parseOrDegrade,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

export interface ProcessPromptRecord {
  id: number;
  processKey: ProcessPromptKey;
  name: string;
  description: string;
  defaultValue: string;
  customValue: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Result shape for list reads that surface degraded-row counts. */
export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

type RawRow = {
  id: number;
  processKey: string;
  name: string;
  description: string;
  defaultValue: string;
  customValue: string | null;
  createdAt: number;
  updatedAt: number;
};

const TBL = ProcessPromptsTable.tableName;
const C = ProcessPromptsTable.cols;

/**
 * Common SELECT column list, aliasing DB snake_case to the DTO camelCase.
 * Kept as a template expression rather than an inline literal so renames
 * in `ProcessPromptsTable` propagate automatically.
 */
const SELECT_COLS = `
  ${C.id.sqlName},
  ${C.processKey.sqlName}  AS processKey,
  ${C.name.sqlName},
  ${C.description.sqlName},
  ${C.defaultValue.sqlName} AS defaultValue,
  ${C.customValue.sqlName}  AS customValue,
  ${C.createdAt.sqlName}    AS createdAt,
  ${C.updatedAt.sqlName}    AS updatedAt
`;

export class ProcessPromptRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  list(tx?: Tx): ListResult<ProcessPromptRecord> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${SELECT_COLS}
         FROM ${TBL}
         ORDER BY ${C.id.sqlName} ASC`,
      )
      .all() as RawRow[];
    return parseRows(rows);
  }

  get(key: ProcessPromptKey, tx?: Tx): ProcessPromptRecord | null {
    const d = tx ?? this.db;
    const row = d
      .prepare(
        `SELECT ${SELECT_COLS}
         FROM ${TBL}
         WHERE ${C.processKey.sqlName} = ?`,
      )
      .get(key) as RawRow | undefined;
    if (!row) return null;
    const { rows } = parseRows([row]);
    return rows[0] ?? null;
  }

  /** Convenience: returns customValue ?? defaultValue, or null if missing. */
  getEffectiveValue(key: ProcessPromptKey, tx?: Tx): string | null {
    const rec = this.get(key, tx);
    return rec ? rec.customValue ?? rec.defaultValue : null;
  }

  /**
   * Throws when `key` does not exist — mirrors the legacy `ProcessPromptStore`
   * behavior so the settings UI still surfaces an obvious error rather than
   * silently no-op'ing.
   */
  setCustom(key: ProcessPromptKey, value: string, tx?: Tx): void {
    const existing = this.get(key, tx);
    if (!existing) throw new Error(`Process prompt not found: ${key}`);
    const d = tx ?? this.db;
    d.prepare(
      `UPDATE ${TBL}
       SET ${C.customValue.sqlName} = ?, ${C.updatedAt.sqlName} = ?
       WHERE ${C.processKey.sqlName} = ?`,
    ).run(value, Date.now(), key);
  }

  resetToDefault(key: ProcessPromptKey, tx?: Tx): void {
    const existing = this.get(key, tx);
    if (!existing) throw new Error(`Process prompt not found: ${key}`);
    const d = tx ?? this.db;
    d.prepare(
      `UPDATE ${TBL}
       SET ${C.customValue.sqlName} = NULL, ${C.updatedAt.sqlName} = ?
       WHERE ${C.processKey.sqlName} = ?`,
    ).run(Date.now(), key);
  }
}

function parseRows(rows: RawRow[]): ListResult<ProcessPromptRecord> {
  const out: ProcessPromptRecord[] = [];
  let degradedCount = 0;
  const SENTINEL = Symbol('degraded');
  for (const row of rows) {
    const parsed = parseOrDegrade(
      ProcessPromptRecordSchema,
      row,
      SENTINEL as unknown as RawRow,
      { ctx: { name: 'ProcessPromptRecord' } },
    );
    if ((parsed as unknown) === SENTINEL) {
      degradedCount += 1;
      continue;
    }
    out.push({ ...parsed, processKey: parsed.processKey as ProcessPromptKey });
  }
  return { rows: out, degradedCount };
}
