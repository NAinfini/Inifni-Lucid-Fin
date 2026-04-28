/**
 * ProjectSettingsRepository — key-value store for project-level settings.
 *
 * Uses the `project_settings` table which is a simple (key, value, updated_at)
 * KV store. Values are stored as JSON strings.
 */

import type BetterSqlite3 from 'better-sqlite3';
import { ProjectSettingsTable } from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

const TBL = ProjectSettingsTable.tableName;
const C = ProjectSettingsTable.cols;

export class ProjectSettingsRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  get(key: string, tx?: Tx): string | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(`SELECT ${C.value.sqlName} FROM ${TBL} WHERE ${C.key.sqlName} = ?`)
      .get(key) as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT INTO ${TBL} (${C.key.sqlName}, ${C.value.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?)
       ON CONFLICT(${C.key.sqlName}) DO UPDATE SET
         ${C.value.sqlName} = excluded.${C.value.sqlName},
         ${C.updatedAt.sqlName} = excluded.${C.updatedAt.sqlName}`,
    ).run(key, value, Date.now());
  }

  delete(key: string, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.key.sqlName} = ?`).run(key);
  }

  getJson<T>(key: string, tx?: Tx): T | undefined {
    const raw = this.get(key, tx);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  setJson(key: string, value: unknown, tx?: Tx): void {
    this.set(key, JSON.stringify(value), tx);
  }
}
