/**
 * AssetRepository — Phase G1-2.4.
 *
 * Wraps `assets` + `asset_embeddings` CRUD behind the `AssetHash` brand
 * and fault-soft reads. Reuses the legacy `normalizeAssetMeta` helper
 * (`sqlite-assets.ts`) because the input sanitation logic is well-tested
 * and independent of the repository concern.
 *
 * SQL references column names through `AssetsTable` + `AssetEmbeddingsTable`
 * (G1-1) — schema drift fails at compile time.
 *
 * Reads go through `parseOrDegrade` with `'AssetMeta'` / `'EmbeddingRecord'`
 * contexts so a corrupt row surfaces as degraded-read telemetry + skip,
 * not a crash in the asset browser or the semantic search flow.
 *
 * Phase G1-5 consumer migration will switch asset handlers + generation
 * pipeline to call this repository directly. Until then `SqliteIndex`
 * delegates its legacy asset/embedding methods here.
 */

import type BetterSqlite3 from 'better-sqlite3';
import type { AssetHash, AssetMeta } from '@lucid-fin/contracts';
import {
  AssetsTable,
  AssetEmbeddingsTable,
  AssetMetaSchema,
  EmbeddingRecordSchema,
  parseOrDegrade,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';
import {
  normalizeAssetMeta,
  repairAssetSizes as _repairAssetSizes,
  type AssetMetaInput,
  type EmbeddingRecord,
  type SemanticSearchResult,
} from '../sqlite-assets.js';

/** Result shape for list reads that surface degraded-row counts. */
export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

type RawAssetRow = {
  hash: string;
  type: string;
  format: string;
  tags: string | null;
  prompt: string | null;
  provider: string | null;
  folder_id: string | null;
  created_at: number;
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  generation_metadata: string | null;
};

type RawEmbeddingRow = {
  hash: string;
  description: string;
  tokens: string;
  model: string;
  created_at: number;
};

const AT = AssetsTable.tableName;
const AC = AssetsTable.cols;
const ET = AssetEmbeddingsTable.tableName;
const EC = AssetEmbeddingsTable.cols;

const ASSET_SELECT_COLS = [
  AC.hash.sqlName,
  AC.type.sqlName,
  AC.format.sqlName,
  AC.tags.sqlName,
  AC.prompt.sqlName,
  AC.provider.sqlName,
  AC.folderId.sqlName,
  AC.createdAt.sqlName,
  AC.fileSize.sqlName,
  AC.width.sqlName,
  AC.height.sqlName,
  AC.duration.sqlName,
  AC.generationMetadata.sqlName,
].join(', ');

const ASSET_SELECT_COLS_PREFIXED_A = [
  AC.hash.sqlName,
  AC.type.sqlName,
  AC.format.sqlName,
  AC.tags.sqlName,
  AC.prompt.sqlName,
  AC.provider.sqlName,
  AC.folderId.sqlName,
  AC.createdAt.sqlName,
  AC.fileSize.sqlName,
  AC.width.sqlName,
  AC.height.sqlName,
  AC.duration.sqlName,
  AC.generationMetadata.sqlName,
]
  .map((c) => `a.${c}`)
  .join(', ');

export class AssetRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  insert(meta: AssetMetaInput, tx?: Tx): void {
    const d = tx ?? this.db;
    const normalized = normalizeAssetMeta(meta);
    d.prepare(
      `INSERT OR REPLACE INTO ${AT}
         (${AC.hash.sqlName}, ${AC.type.sqlName}, ${AC.format.sqlName},
          ${AC.tags.sqlName}, ${AC.prompt.sqlName}, ${AC.provider.sqlName},
          ${AC.folderId.sqlName},
          ${AC.createdAt.sqlName}, ${AC.fileSize.sqlName},
          ${AC.width.sqlName}, ${AC.height.sqlName}, ${AC.duration.sqlName},
          ${AC.generationMetadata.sqlName})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      normalized.hash,
      normalized.type,
      normalized.format,
      JSON.stringify(normalized.tags),
      normalized.prompt ?? null,
      normalized.provider ?? null,
      normalized.folderId ?? null,
      normalized.createdAt,
      normalized.fileSize,
      normalized.width ?? null,
      normalized.height ?? null,
      normalized.duration ?? null,
      normalized.generationMetadata ? JSON.stringify(normalized.generationMetadata) : null,
    );
  }

  delete(hash: AssetHash, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`DELETE FROM ${AT} WHERE ${AC.hash.sqlName} = ?`).run(hash);
  }

  findByHash(hash: string, tx?: Tx): AssetMeta | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(`SELECT ${ASSET_SELECT_COLS} FROM ${AT} WHERE ${AC.hash.sqlName} = ?`)
      .get(hash) as RawAssetRow | undefined;
    if (!row) return undefined;
    const SENTINEL = Symbol('degraded');
    const parsed = parseOrDegrade(
      AssetMetaSchema,
      rowToAssetMeta(row),
      SENTINEL as unknown as AssetMeta,
      { ctx: { name: 'AssetMeta' } },
    );
    return (parsed as unknown) === SENTINEL ? undefined : (parsed as AssetMeta);
  }

  setFolder(hash: AssetHash, folderId: string | null, tx?: Tx): void {
    const d = tx ?? this.db;
    d.prepare(`UPDATE ${AT} SET ${AC.folderId.sqlName} = ? WHERE ${AC.hash.sqlName} = ?`).run(
      folderId,
      hash,
    );
  }

  query(
    filter: { type?: string; limit?: number; offset?: number },
    tx?: Tx,
  ): ListResult<AssetMeta> {
    const d = tx ?? this.db;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.type) {
      conditions.push(`${AC.type.sqlName} = ?`);
      params.push(filter.type);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const rows = d
      .prepare(
        `SELECT ${ASSET_SELECT_COLS}
         FROM ${AT}
         ${where}
         ORDER BY ${AC.createdAt.sqlName} DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as RawAssetRow[];
    return parseAssetRows(rows);
  }

  /** FTS search — strips FTS5 operators from `query` to prevent injection. Returns `[]` on empty/malformed input. */
  search(query: string, limit = 50, tx?: Tx): ListResult<AssetMeta> {
    const sanitized = query.replace(/["*(){}^\-:]/g, ' ').trim();
    if (!sanitized) return { rows: [], degradedCount: 0 };
    const d = tx ?? this.db;
    try {
      const rows = d
        .prepare(
          `SELECT ${ASSET_SELECT_COLS_PREFIXED_A}
           FROM ${AT} a
           JOIN assets_fts f ON a.rowid = f.rowid
           WHERE assets_fts MATCH ?
           LIMIT ?`,
        )
        .all(sanitized, limit) as RawAssetRow[];
      return parseAssetRows(rows);
    } catch {
      return { rows: [], degradedCount: 0 };
    }
  }

  // ── Embeddings ─────────────────────────────────────────────────

  insertEmbedding(
    hash: AssetHash,
    description: string,
    tokens: string[],
    model: string,
    tx?: Tx,
  ): void {
    const d = tx ?? this.db;
    d.prepare(
      `INSERT OR REPLACE INTO ${ET}
         (${EC.hash.sqlName}, ${EC.description.sqlName}, ${EC.tokens.sqlName},
          ${EC.model.sqlName}, ${EC.createdAt.sqlName})
       VALUES (?, ?, ?, ?, ?)`,
    ).run(hash, description, JSON.stringify(tokens), model, Date.now());
  }

  queryEmbeddingByHash(hash: AssetHash, tx?: Tx): EmbeddingRecord | undefined {
    const d = tx ?? this.db;
    const row = d
      .prepare(
        `SELECT ${EC.hash.sqlName}, ${EC.description.sqlName}, ${EC.tokens.sqlName},
                ${EC.model.sqlName}, ${EC.createdAt.sqlName}
         FROM ${ET}
         WHERE ${EC.hash.sqlName} = ?`,
      )
      .get(hash) as RawEmbeddingRow | undefined;
    if (!row) return undefined;
    const parsed = parseEmbeddingRows([row]);
    return parsed.rows[0];
  }

  /** Jaccard-similarity search over stored token arrays. */
  searchByTokens(queryTokens: string[], limit: number, tx?: Tx): SemanticSearchResult[] {
    if (queryTokens.length === 0) return [];
    const d = tx ?? this.db;
    // Pre-filter: only load rows whose JSON tokens column contains at least
    // one query token as a substring. This avoids a full table scan and
    // deserialization of every embedding when the table is large.
    // The LIKE checks are intentionally loose (no word-boundary) — false
    // positives are acceptable because the exact Jaccard score is computed
    // in JS and zero-score rows are filtered out below.
    const likeConditions = queryTokens.map(() => `${EC.tokens.sqlName} LIKE ?`).join(' OR ');
    const likeParams = queryTokens.map((t) => `%"${t}"%`);
    const rows = d
      .prepare(
        `SELECT ${EC.hash.sqlName}, ${EC.description.sqlName}, ${EC.tokens.sqlName}
         FROM ${ET}
         WHERE ${likeConditions}`,
      )
      .all(...likeParams) as Array<{ hash: string; description: string; tokens: string }>;

    const querySet = new Set(queryTokens);
    return rows
      .map((row) => {
        const storedTokens = JSON.parse(row.tokens) as string[];
        const storedSet = new Set(storedTokens);
        let intersection = 0;
        for (const t of querySet) {
          if (storedSet.has(t)) intersection += 1;
        }
        const union = querySet.size + storedSet.size - intersection;
        const score = union > 0 ? intersection / union : 0;
        return { hash: row.hash, score, description: row.description };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getAllEmbeddedHashes(tx?: Tx): AssetHash[] {
    const d = tx ?? this.db;
    const rows = d.prepare(`SELECT ${EC.hash.sqlName} FROM ${ET}`).all() as Array<{ hash: string }>;
    return rows.map((r) => r.hash as AssetHash);
  }

  /**
   * Startup-time repair: backfills `file_size` for legacy rows where the
   * column was never populated. Delegates to the legacy helper (which owns
   * the fs + transaction logic); kept here so consumers don't need the raw
   * `BetterSqlite3.Database` handle.
   */
  repairSizes(resolveAssetPath: (hash: string, type: string, format: string) => string): number {
    return _repairAssetSizes(this.db, resolveAssetPath);
  }
}

function rowToAssetMeta(row: RawAssetRow): AssetMeta {
  const rawTags = typeof row.tags === 'string' && row.tags.length > 0 ? row.tags : '[]';
  let generationMetadata: AssetMeta['generationMetadata'];
  if (typeof row.generation_metadata === 'string' && row.generation_metadata.length > 0) {
    try {
      generationMetadata = JSON.parse(row.generation_metadata);
    } catch {
      generationMetadata = undefined;
    }
  }
  return {
    hash: row.hash,
    type: row.type as AssetMeta['type'],
    format: row.format,
    originalName: '',
    fileSize: typeof row.file_size === 'number' ? row.file_size : 0,
    width: typeof row.width === 'number' ? row.width : undefined,
    height: typeof row.height === 'number' ? row.height : undefined,
    duration: typeof row.duration === 'number' ? row.duration : undefined,
    tags: JSON.parse(rawTags) as string[],
    prompt: row.prompt ?? undefined,
    provider: row.provider ?? undefined,
    folderId: row.folder_id ?? null,
    createdAt: row.created_at,
    generationMetadata,
  };
}

function parseAssetRows(rows: RawAssetRow[]): ListResult<AssetMeta> {
  const out: AssetMeta[] = [];
  let degradedCount = 0;
  const SENTINEL = Symbol('degraded');
  for (const row of rows) {
    const candidate = rowToAssetMeta(row);
    const parsed = parseOrDegrade(AssetMetaSchema, candidate, SENTINEL as unknown as AssetMeta, {
      ctx: { name: 'AssetMeta' },
    });
    if ((parsed as unknown) === SENTINEL) {
      degradedCount += 1;
      continue;
    }
    out.push(parsed as AssetMeta);
  }
  return { rows: out, degradedCount };
}

function rowToEmbedding(row: RawEmbeddingRow): EmbeddingRecord {
  return {
    hash: row.hash,
    description: row.description,
    tokens: JSON.parse(row.tokens) as string[],
    model: row.model,
    createdAt: row.created_at,
  };
}

function parseEmbeddingRows(rows: RawEmbeddingRow[]): ListResult<EmbeddingRecord> {
  const out: EmbeddingRecord[] = [];
  let degradedCount = 0;
  const SENTINEL = Symbol('degraded');
  for (const row of rows) {
    const candidate = rowToEmbedding(row);
    const parsed = parseOrDegrade(
      EmbeddingRecordSchema,
      candidate,
      SENTINEL as unknown as EmbeddingRecord,
      { ctx: { name: 'EmbeddingRecord' } },
    );
    if ((parsed as unknown) === SENTINEL) {
      degradedCount += 1;
      continue;
    }
    out.push(parsed as EmbeddingRecord);
  }
  return { rows: out, degradedCount };
}
