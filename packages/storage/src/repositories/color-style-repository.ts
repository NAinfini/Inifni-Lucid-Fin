/**
 * ColorStyleRepository — Phase G1-4.10.
 *
 * Wraps `color_styles` CRUD. JSON-serialized blobs (palette, gradients,
 * exposure, tags) are parsed back to typed objects on read. Column names
 * flow through `ColorStylesTable` (G1-1) so schema drift fails at compile
 * time.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { ColorStyle } from '@lucid-fin/contracts';
import { ColorStylesTable } from '@lucid-fin/contracts-parse';

const TBL = ColorStylesTable.tableName;
const C = ColorStylesTable.cols;

function rowToColorStyle(row: Record<string, unknown>): ColorStyle {
  return {
    id: row.id as string,
    name: row.name as string,
    sourceType: row.source_type as ColorStyle['sourceType'],
    sourceAsset: row.source_asset as string | undefined,
    palette: JSON.parse((row.palette as string) || '[]'),
    gradients: JSON.parse((row.gradients as string) || '[]'),
    exposure: JSON.parse((row.exposure as string) || '{}'),
    tags: JSON.parse((row.tags as string) || '[]'),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class ColorStyleRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsert(cs: ColorStyle): void {
    this.db
      .prepare(
        `INSERT INTO ${TBL}
           (${C.id.sqlName}, ${C.name.sqlName}, ${C.sourceType.sqlName},
            ${C.sourceAsset.sqlName}, ${C.palette.sqlName}, ${C.gradients.sqlName},
            ${C.exposure.sqlName}, ${C.tags.sqlName},
            ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
           ${C.name.sqlName}=excluded.${C.name.sqlName},
           ${C.sourceType.sqlName}=excluded.${C.sourceType.sqlName},
           ${C.sourceAsset.sqlName}=excluded.${C.sourceAsset.sqlName},
           ${C.palette.sqlName}=excluded.${C.palette.sqlName},
           ${C.gradients.sqlName}=excluded.${C.gradients.sqlName},
           ${C.exposure.sqlName}=excluded.${C.exposure.sqlName},
           ${C.tags.sqlName}=excluded.${C.tags.sqlName},
           ${C.updatedAt.sqlName}=excluded.${C.updatedAt.sqlName}`,
      )
      .run(
        cs.id,
        cs.name,
        cs.sourceType,
        cs.sourceAsset ?? null,
        JSON.stringify(cs.palette),
        JSON.stringify(cs.gradients),
        JSON.stringify(cs.exposure),
        JSON.stringify(cs.tags),
        cs.createdAt,
        cs.updatedAt,
      );
  }

  list(): ColorStyle[] {
    const rows = this.db
      .prepare(`SELECT * FROM ${TBL} ORDER BY ${C.updatedAt.sqlName} DESC`)
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => rowToColorStyle(r));
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
  }
}
