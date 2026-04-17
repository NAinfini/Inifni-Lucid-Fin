/**
 * ShotTemplateRepository — Phase G1-2.9.
 *
 * Wraps `custom_shot_templates` CRUD behind the `ShotTemplateId` brand and
 * fault-soft reads. `tracks` is stored as serialized JSON; the repository
 * parses and returns typed objects via `parseOrDegrade`.
 *
 * Table column names flow through `CustomShotTemplatesTable` (G1-1) — schema
 * drift fails at compile time.
 *
 * Only user-authored (`builtIn: false`) templates live in this table;
 * built-in templates are bundled in-code. `listCustomShotTemplates` therefore
 * always returns `builtIn: false` for every row.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ShotTemplate, ShotTemplateId } from '@lucid-fin/contracts';
import {
  CustomShotTemplatesTable,
  parseOrDegrade,
  ShotTemplateSchema,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

const TBL = CustomShotTemplatesTable.tableName;
const C = CustomShotTemplatesTable.cols;

const SHOT_TMPL_SENTINEL = Symbol('shot-template-degraded');

function rowToShotTemplate(row: Record<string, unknown>): ShotTemplate {
  const tracksRaw = row.tracks_json;
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    builtIn: false,
    tracks:
      typeof tracksRaw === 'string' && tracksRaw.length > 0
        ? (JSON.parse(tracksRaw) as ShotTemplate['tracks'])
        : ({} as ShotTemplate['tracks']),
    createdAt: (row.created_at as number) ?? undefined,
  };
}

export class ShotTemplateRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsert(template: ShotTemplate, tx?: Tx): void {
    const d = tx ?? this.db;
    const now = Date.now();
    d.prepare(
      `INSERT INTO ${TBL}
         (${C.id.sqlName}, ${C.name.sqlName}, ${C.description.sqlName},
          ${C.tracksJson.sqlName}, ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
         ${C.name.sqlName}=excluded.${C.name.sqlName},
         ${C.description.sqlName}=excluded.${C.description.sqlName},
         ${C.tracksJson.sqlName}=excluded.${C.tracksJson.sqlName},
         ${C.updatedAt.sqlName}=excluded.${C.updatedAt.sqlName}`,
    ).run(
      template.id,
      template.name,
      template.description,
      JSON.stringify(template.tracks ?? {}),
      template.createdAt ?? now,
      now,
    );
  }

  list(tx?: Tx): ListResult<ShotTemplate> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT ${C.id.sqlName}, ${C.name.sqlName}, ${C.description.sqlName},
                ${C.tracksJson.sqlName}, ${C.createdAt.sqlName}
         FROM ${TBL}`,
      )
      .all() as Array<Record<string, unknown>>;
    const out: ShotTemplate[] = [];
    let degradedCount = 0;
    for (const row of rows) {
      let candidate: ShotTemplate;
      try {
        candidate = rowToShotTemplate(row);
      } catch {
        // Malformed tracks_json — force a zod failure on the raw row so the
        // degrade reporter fires (telemetry parity with schema-mismatch
        // failures). Null `tracks` guarantees the schema rejects.
        parseOrDegrade(
          ShotTemplateSchema,
          { ...row, tracks: null },
          SHOT_TMPL_SENTINEL as unknown as ShotTemplate,
          { ctx: { name: 'ShotTemplate' } },
        );
        degradedCount += 1;
        continue;
      }
      const parsed = parseOrDegrade(
        ShotTemplateSchema,
        candidate,
        SHOT_TMPL_SENTINEL as unknown as ShotTemplate,
        { ctx: { name: 'ShotTemplate' } },
      );
      if ((parsed as unknown) === SHOT_TMPL_SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push(parsed as ShotTemplate);
    }
    return { rows: out, degradedCount };
  }

  delete(id: ShotTemplateId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
  }
}
