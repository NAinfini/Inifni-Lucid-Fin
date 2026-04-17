/**
 * PresetRepository — Phase G1-2.8.
 *
 * Wraps `preset_overrides` CRUD behind the `PresetId` brand and fault-soft
 * reads. Preset body (`params`, `defaults`) is stored as serialized JSON;
 * the repository parses and returns typed objects.
 *
 * Table column names flow through `PresetOverridesTable` (G1-1) — schema
 * drift fails at compile time.
 *
 * Reads go through `parseOrDegrade` with `'PresetOverride'` ctx so a
 * corrupt row surfaces as degraded-read telemetry + skip, never a crash.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { PresetId } from '@lucid-fin/contracts';
import {
  parseOrDegrade,
  PresetOverrideSchema,
  PresetOverridesTable,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';

export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

export interface PresetOverrideRecord {
  id: string;
  presetId: string;
  category: string;
  name: string;
  description: string;
  prompt: string;
  params: unknown[];
  defaults: Record<string, unknown>;
  isUser: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PresetOverrideUpsertInput {
  id: string;
  presetId: string;
  category: string;
  name: string;
  description?: string;
  prompt?: string;
  params?: unknown[];
  defaults?: Record<string, unknown>;
  isUser: boolean;
  createdAt: number;
  updatedAt: number;
}

const TBL = PresetOverridesTable.tableName;
const C = PresetOverridesTable.cols;

const PRESET_SENTINEL = Symbol('preset-degraded');

function parseJsonArrayOrEmpty(raw: unknown): unknown[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObjectOrEmpty(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function rowToOverride(row: Record<string, unknown>): PresetOverrideRecord {
  return {
    id: row.id as string,
    presetId: row.preset_id as string,
    category: row.category as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    prompt: (row.prompt as string) ?? '',
    params: parseJsonArrayOrEmpty(row.params),
    defaults: parseJsonObjectOrEmpty(row.defaults),
    isUser: (row.is_user as number) === 1,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

export class PresetRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  upsertOverride(input: PresetOverrideUpsertInput, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT INTO ${TBL}
         (${C.id.sqlName}, ${C.presetId.sqlName}, ${C.category.sqlName}, ${C.name.sqlName},
          ${C.description.sqlName}, ${C.prompt.sqlName},
          ${C.params.sqlName}, ${C.defaults.sqlName},
          ${C.isUser.sqlName}, ${C.createdAt.sqlName}, ${C.updatedAt.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${C.id.sqlName}) DO UPDATE SET
         ${C.presetId.sqlName}=excluded.${C.presetId.sqlName},
         ${C.category.sqlName}=excluded.${C.category.sqlName},
         ${C.name.sqlName}=excluded.${C.name.sqlName},
         ${C.description.sqlName}=excluded.${C.description.sqlName},
         ${C.prompt.sqlName}=excluded.${C.prompt.sqlName},
         ${C.params.sqlName}=excluded.${C.params.sqlName},
         ${C.defaults.sqlName}=excluded.${C.defaults.sqlName},
         ${C.isUser.sqlName}=excluded.${C.isUser.sqlName},
         ${C.updatedAt.sqlName}=excluded.${C.updatedAt.sqlName}`,
    ).run(
      input.id,
      input.presetId,
      input.category,
      input.name,
      input.description ?? '',
      input.prompt ?? '',
      JSON.stringify(input.params ?? []),
      JSON.stringify(input.defaults ?? {}),
      input.isUser ? 1 : 0,
      input.createdAt,
      input.updatedAt,
    );
  }

  listOverrides(tx?: Tx): ListResult<PresetOverrideRecord> {
    const d = tx ?? this.db;
    const rows = d
      .prepare(
        `SELECT * FROM ${TBL}
         ORDER BY ${C.category.sqlName}, ${C.name.sqlName}`,
      )
      .all() as Array<Record<string, unknown>>;
    const out: PresetOverrideRecord[] = [];
    let degradedCount = 0;
    for (const row of rows) {
      let candidate: PresetOverrideRecord | Record<string, unknown>;
      try {
        candidate = rowToOverride(row);
      } catch {
        candidate = row;
      }
      const parsed = parseOrDegrade(
        PresetOverrideSchema,
        candidate,
        PRESET_SENTINEL as unknown as PresetOverrideRecord,
        { ctx: { name: 'PresetOverride' } },
      );
      if ((parsed as unknown) === PRESET_SENTINEL) {
        degradedCount += 1;
        continue;
      }
      out.push(parsed as PresetOverrideRecord);
    }
    return { rows: out, degradedCount };
  }

  deleteOverride(id: PresetId, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${TBL} WHERE ${C.id.sqlName} = ?`).run(id);
  }
}
