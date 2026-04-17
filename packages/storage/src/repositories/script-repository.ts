/**
 * ScriptRepository — Phase G1-4.10.
 *
 * Wraps `scripts` CRUD behind a direct-to-repository interface. Schema is
 * a singleton-style store: `getScript()` returns the most-recently-updated
 * row (there is only ever one script per project in current use). Column
 * names flow through `ScriptsTable` (G1-1) so schema drift fails at compile
 * time.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ScriptDocument } from '@lucid-fin/contracts';
import { ScriptsTable } from '@lucid-fin/contracts-parse';

const TBL = ScriptsTable.tableName;
const C = ScriptsTable.cols;

function rowToScript(row: Record<string, unknown>): ScriptDocument {
  return {
    id: row.id as string,
    content: row.content as string,
    format: row.format as ScriptDocument['format'],
    parsedScenes: JSON.parse((row.parsed_scenes as string) || '[]'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class ScriptRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsert(doc: ScriptDocument): void {
    this.db
      .prepare(
        `INSERT INTO ${TBL}
           (${C.id.sqlName}, ${C.content.sqlName}, ${C.format.sqlName},
            ${C.parsedScenes.sqlName}, ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
           ${C.content.sqlName}=excluded.${C.content.sqlName},
           ${C.format.sqlName}=excluded.${C.format.sqlName},
           ${C.parsedScenes.sqlName}=excluded.${C.parsedScenes.sqlName},
           ${C.updatedAt.sqlName}=excluded.${C.updatedAt.sqlName}`,
      )
      .run(
        doc.id,
        doc.content,
        doc.format,
        JSON.stringify(doc.parsedScenes ?? []),
        doc.createdAt,
        doc.updatedAt,
      );
  }

  get(): ScriptDocument | null {
    const row = this.db
      .prepare(`SELECT * FROM ${TBL} ORDER BY ${C.updatedAt.sqlName} DESC LIMIT 1`)
      .get() as Record<string, unknown> | undefined;
    return row ? rowToScript(row) : null;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
  }
}
