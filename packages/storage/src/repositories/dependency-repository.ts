/**
 * DependencyRepository — Phase G1-4.10.
 *
 * Wraps the `dependencies` edge table: directed (sourceType,sourceId) →
 * (targetType,targetId) pairs. `add` is idempotent via INSERT OR IGNORE
 * so duplicate edges are a no-op. Column names flow through
 * `DependenciesTable` (G1-1).
 */

import type BetterSqlite3 from 'better-sqlite3';
import { DependenciesTable } from '@lucid-fin/contracts-parse';

const TBL = DependenciesTable.tableName;
const C = DependenciesTable.cols;

export interface Dependent {
  targetType: string;
  targetId: string;
}

export class DependencyRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  add(sourceType: string, sourceId: string, targetType: string, targetId: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO ${TBL}
           (${C.sourceType.sqlName}, ${C.sourceId.sqlName},
            ${C.targetType.sqlName}, ${C.targetId.sqlName})
         VALUES (?, ?, ?, ?)`,
      )
      .run(sourceType, sourceId, targetType, targetId);
  }

  listDependents(sourceType: string, sourceId: string): Dependent[] {
    return this.db
      .prepare(
        `SELECT ${C.targetType.sqlName} as targetType,
                ${C.targetId.sqlName} as targetId
         FROM ${TBL}
         WHERE ${C.sourceType.sqlName} = ? AND ${C.sourceId.sqlName} = ?`,
      )
      .all(sourceType, sourceId) as Dependent[];
  }
}
