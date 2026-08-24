import { randomUUID } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import type { AssetEntry, AssetEntryId, AssetMeta } from '@lucid-fin/contracts';
import {
  AssetContentsTable,
  AssetEntriesTable,
  AssetEntrySchema,
  AssetMetaSchema,
  parseOrDegrade,
} from '@lucid-fin/contracts-parse';
import type { Tx } from '../transactions.js';
import {
  normalizeAssetMeta,
  repairAssetSizes as repairContentSizes,
  type AssetMetaInput,
  type NormalizedAssetInput,
} from '../sqlite-assets.js';

export interface ListResult<T> {
  rows: T[];
  degradedCount: number;
}

type RawContentRow = {
  hash: string;
  type: string;
  format: string;
  prompt: string | null;
  provider: string | null;
  created_at: number;
  file_size: number | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  has_audio: number | null;
  generation_metadata: string | null;
};

type RawEntryRow = RawContentRow & {
  entry_id: string;
  asset_hash: string;
  display_name: string;
  tags: string;
  folder_id: string | null;
  entry_created_at: number;
  content_created_at: number;
};

const CT = AssetContentsTable.tableName;
const CC = AssetContentsTable.cols;
const LT = AssetEntriesTable.tableName;
const LC = AssetEntriesTable.cols;

function uniqueEntryIds(ids: readonly AssetEntryId[]): AssetEntryId[] {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('Asset entry IDs are required');
  for (const id of ids) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new Error('Asset entry IDs must be non-empty strings');
    }
  }
  return [...new Set(ids)];
}

const CONTENT_SELECT = [
  CC.hash.sqlName,
  CC.type.sqlName,
  CC.format.sqlName,
  CC.prompt.sqlName,
  CC.provider.sqlName,
  CC.createdAt.sqlName,
  CC.fileSize.sqlName,
  CC.width.sqlName,
  CC.height.sqlName,
  CC.duration.sqlName,
  CC.hasAudio.sqlName,
  CC.generationMetadata.sqlName,
].join(', ');

const ENTRY_SELECT = `
  entry.${LC.id.sqlName} AS entry_id,
  entry.${LC.assetHash.sqlName} AS asset_hash,
  entry.${LC.displayName.sqlName} AS display_name,
  entry.${LC.tags.sqlName} AS tags,
  entry.${LC.folderId.sqlName} AS folder_id,
  entry.${LC.createdAt.sqlName} AS entry_created_at,
  content.${CC.hash.sqlName} AS hash,
  content.${CC.type.sqlName} AS type,
  content.${CC.format.sqlName} AS format,
  content.${CC.prompt.sqlName} AS prompt,
  content.${CC.provider.sqlName} AS provider,
  content.${CC.createdAt.sqlName} AS content_created_at,
  content.${CC.fileSize.sqlName} AS file_size,
  content.${CC.width.sqlName} AS width,
  content.${CC.height.sqlName} AS height,
  content.${CC.duration.sqlName} AS duration,
  content.${CC.hasAudio.sqlName} AS has_audio,
  content.${CC.generationMetadata.sqlName} AS generation_metadata`;

export class AssetRepository {
  constructor(private readonly db: BetterSqlite3.Database) {}

  private atomically<T>(tx: Tx | undefined, mutation: (db: Tx) => T): T {
    return tx ? mutation(tx) : this.db.transaction(mutation)(this.db);
  }

  /** Record CAS content and create exactly one logical library entry. */
  insert(meta: AssetMetaInput, tx?: Tx): AssetEntry {
    const normalized = normalizeAssetMeta(meta);
    const insert = (db: Tx) => this.insertNormalized(db, normalized);
    return tx ? insert(tx) : this.db.transaction(insert)(this.db);
  }

  private insertNormalized(db: Tx, asset: NormalizedAssetInput): AssetEntry {
    db.prepare(
      `INSERT INTO ${CT} (
         ${CC.hash.sqlName}, ${CC.type.sqlName}, ${CC.format.sqlName},
         ${CC.prompt.sqlName}, ${CC.provider.sqlName}, ${CC.createdAt.sqlName},
         ${CC.fileSize.sqlName}, ${CC.width.sqlName}, ${CC.height.sqlName},
         ${CC.duration.sqlName}, ${CC.hasAudio.sqlName}, ${CC.generationMetadata.sqlName}
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${CC.hash.sqlName}) DO UPDATE SET
         ${CC.type.sqlName} = excluded.${CC.type.sqlName},
         ${CC.format.sqlName} = excluded.${CC.format.sqlName},
         ${CC.prompt.sqlName} = excluded.${CC.prompt.sqlName},
         ${CC.provider.sqlName} = excluded.${CC.provider.sqlName},
         ${CC.fileSize.sqlName} = excluded.${CC.fileSize.sqlName},
         ${CC.width.sqlName} = excluded.${CC.width.sqlName},
         ${CC.height.sqlName} = excluded.${CC.height.sqlName},
         ${CC.duration.sqlName} = excluded.${CC.duration.sqlName},
         ${CC.hasAudio.sqlName} = COALESCE(
           excluded.${CC.hasAudio.sqlName},
           ${CT}.${CC.hasAudio.sqlName}
         ),
         ${CC.generationMetadata.sqlName} = excluded.${CC.generationMetadata.sqlName}`,
    ).run(
      asset.hash,
      asset.type,
      asset.format,
      asset.prompt ?? null,
      asset.provider ?? null,
      asset.createdAt,
      asset.fileSize,
      asset.width ?? null,
      asset.height ?? null,
      asset.duration ?? null,
      asset.hasAudio === undefined ? null : Number(asset.hasAudio),
      asset.generationMetadata ? JSON.stringify(asset.generationMetadata) : null,
    );

    const id = randomUUID() as AssetEntryId;
    db.prepare(
      `INSERT INTO ${LT} (
         ${LC.id.sqlName}, ${LC.assetHash.sqlName}, ${LC.displayName.sqlName},
         ${LC.tags.sqlName}, ${LC.folderId.sqlName}, ${LC.createdAt.sqlName}
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      asset.hash,
      asset.displayName,
      JSON.stringify(asset.tags),
      asset.folderId,
      asset.createdAt,
    );
    return this.requireEntry(id, db);
  }

  findByHash(hash: string, tx?: Tx): AssetMeta | undefined {
    const db = tx ?? this.db;
    const row = db
      .prepare(`SELECT ${CONTENT_SELECT} FROM ${CT} WHERE ${CC.hash.sqlName} = ?`)
      .get(hash) as RawContentRow | undefined;
    return row ? parseContentRow(row) : undefined;
  }

  findByHashes(hashes: readonly string[], tx?: Tx): Map<string, AssetMeta> {
    const uniqueHashes = [...new Set(hashes)];
    if (uniqueHashes.length === 0) return new Map();
    const db = tx ?? this.db;
    const rows = db
      .prepare(
        `SELECT ${CONTENT_SELECT}
           FROM ${CT}
          WHERE ${CC.hash.sqlName} IN (SELECT value FROM json_each(?))
          ORDER BY ${CC.hash.sqlName} ASC`,
      )
      .all(JSON.stringify(uniqueHashes)) as RawContentRow[];
    const result = new Map<string, AssetMeta>();
    for (const row of rows) {
      const asset = parseContentRow(row);
      if (asset) result.set(row.hash, asset);
    }
    return result;
  }

  updateTechnicalMetadata(
    hash: string,
    patch: { width?: number; height?: number; duration?: number; hasAudio?: boolean },
    tx?: Tx,
  ): AssetMeta {
    for (const key of ['width', 'height', 'duration'] as const) {
      const value = patch[key];
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error(`${key} must be a finite nonnegative number`);
      }
    }
    const db = tx ?? this.db;
    const existing = this.findByHash(hash, db);
    if (!existing) throw new Error(`Asset content not found: ${hash}`);
    if (patch.hasAudio !== undefined && existing.type !== 'video') {
      throw new Error('hasAudio technical metadata is only valid for video content');
    }

    const sets: string[] = [];
    const params: Array<number | string> = [];
    for (const [key, column] of [
      ['width', CC.width.sqlName],
      ['height', CC.height.sqlName],
      ['duration', CC.duration.sqlName],
    ] as const) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = ?`);
        params.push(patch[key]);
      }
    }
    if (patch.hasAudio !== undefined) {
      sets.push(`${CC.hasAudio.sqlName} = ?`);
      params.push(Number(patch.hasAudio));
    }
    if (sets.length === 0) return existing;

    params.push(hash);
    const result = db
      .prepare(`UPDATE ${CT} SET ${sets.join(', ')} WHERE ${CC.hash.sqlName} = ?`)
      .run(...params);
    if (result.changes !== 1) throw new Error(`Asset content not found: ${hash}`);
    return this.findByHash(hash, db)!;
  }

  findEntryById(id: AssetEntryId, tx?: Tx): AssetEntry | undefined {
    const db = tx ?? this.db;
    const row = db
      .prepare(
        `SELECT ${ENTRY_SELECT}
           FROM ${LT} entry
           JOIN ${CT} content ON content.${CC.hash.sqlName} = entry.${LC.assetHash.sqlName}
          WHERE entry.${LC.id.sqlName} = ?`,
      )
      .get(id) as RawEntryRow | undefined;
    return row ? parseEntryRows([row]).rows[0] : undefined;
  }

  copyEntries(
    entryIds: readonly AssetEntryId[],
    targetFolderId: string | null,
    tx?: Tx,
  ): AssetEntry[] {
    const sourceIds = uniqueEntryIds(entryIds);
    return this.atomically(tx, (db) => {
      const sources = this.requireEntries(sourceIds, db);
      const copy = db.prepare(
        `INSERT INTO ${LT} (
           ${LC.id.sqlName}, ${LC.assetHash.sqlName}, ${LC.displayName.sqlName},
           ${LC.tags.sqlName}, ${LC.folderId.sqlName}, ${LC.createdAt.sqlName}
         )
         SELECT ?, ${LC.assetHash.sqlName}, ${LC.displayName.sqlName},
                ${LC.tags.sqlName}, ?, ?
           FROM ${LT}
          WHERE ${LC.id.sqlName} = ?`,
      );
      const createdAt = Date.now();
      return sources.map((source) => {
        const id = randomUUID() as AssetEntryId;
        copy.run(id, targetFolderId, createdAt, source.id);
        return { ...source, id, folderId: targetFolderId, createdAt };
      });
    });
  }

  moveEntry(entryIds: readonly AssetEntryId[], folderId: string | null, tx?: Tx): AssetEntryId[] {
    const movedEntryIds = uniqueEntryIds(entryIds);
    return this.atomically(tx, (db) => {
      this.requireEntries(movedEntryIds, db);
      db.prepare(
        `UPDATE ${LT}
            SET ${LC.folderId.sqlName} = ?
          WHERE ${LC.id.sqlName} IN (SELECT value FROM json_each(?))`,
      ).run(folderId, JSON.stringify(movedEntryIds));
      return movedEntryIds;
    });
  }

  renameEntry(id: AssetEntryId, displayName: string, tx?: Tx): AssetEntry {
    const trimmed = displayName.trim();
    if (!trimmed) throw new Error('Asset display name is required');
    const db = tx ?? this.db;
    const result = db
      .prepare(`UPDATE ${LT} SET ${LC.displayName.sqlName} = ? WHERE ${LC.id.sqlName} = ?`)
      .run(trimmed, id);
    if (result.changes !== 1) throw new Error(`Asset entry not found: ${id}`);
    return this.requireEntry(id, db);
  }

  setEntryTags(id: AssetEntryId, tags: string[], tx?: Tx): AssetEntry {
    const db = tx ?? this.db;
    const result = db
      .prepare(`UPDATE ${LT} SET ${LC.tags.sqlName} = ? WHERE ${LC.id.sqlName} = ?`)
      .run(JSON.stringify([...new Set(tags)]), id);
    if (result.changes !== 1) throw new Error(`Asset entry not found: ${id}`);
    return this.requireEntry(id, db);
  }

  deleteEntry(entryIds: readonly AssetEntryId[], tx?: Tx): AssetEntryId[] {
    const deletedEntryIds = uniqueEntryIds(entryIds);
    return this.atomically(tx, (db) => {
      this.requireEntries(deletedEntryIds, db);
      db.prepare(
        `DELETE FROM ${LT} WHERE ${LC.id.sqlName} IN (SELECT value FROM json_each(?))`,
      ).run(JSON.stringify(deletedEntryIds));
      return deletedEntryIds;
    });
  }

  query(
    filter: { type?: string; tags?: string[]; limit?: number; offset?: number },
    tx?: Tx,
  ): ListResult<AssetEntry> {
    const db = tx ?? this.db;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.type) {
      conditions.push(`content.${CC.type.sqlName} = ?`);
      params.push(filter.type);
    }
    for (const tag of filter.tags ?? []) {
      conditions.push(`EXISTS (SELECT 1 FROM json_each(entry.${LC.tags.sqlName}) WHERE value = ?)`);
      params.push(tag);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(
        `SELECT ${ENTRY_SELECT}
           FROM ${LT} entry
           JOIN ${CT} content ON content.${CC.hash.sqlName} = entry.${LC.assetHash.sqlName}
           ${where}
          ORDER BY entry.${LC.createdAt.sqlName} DESC
          LIMIT ? OFFSET ?`,
      )
      .all(...params, filter.limit ?? 100, filter.offset ?? 0) as RawEntryRow[];
    return parseEntryRows(rows);
  }

  search(query: string, limit = 50, tx?: Tx): ListResult<AssetEntry> {
    const sanitized = query.replace(/["*(){}^\-:]/g, ' ').trim();
    if (!sanitized) return { rows: [], degradedCount: 0 };
    const db = tx ?? this.db;
    try {
      const rows = db
        .prepare(
          `SELECT ${ENTRY_SELECT}
             FROM asset_entries_fts search
             JOIN ${LT} entry ON entry.${LC.id.sqlName} = search.entry_id
             JOIN ${CT} content ON content.${CC.hash.sqlName} = entry.${LC.assetHash.sqlName}
            WHERE asset_entries_fts MATCH ?
            ORDER BY bm25(asset_entries_fts)
            LIMIT ?`,
        )
        .all(sanitized, limit) as RawEntryRow[];
      return parseEntryRows(rows);
    } catch {
      return { rows: [], degradedCount: 0 };
    }
  }

  repairSizes(resolveAssetPath: (hash: string, type: string, format: string) => string): number {
    return repairContentSizes(this.db, resolveAssetPath);
  }

  private requireEntry(id: AssetEntryId, db: Tx): AssetEntry {
    const entry = this.findEntryById(id, db);
    if (!entry) throw new Error(`Asset entry not found: ${id}`);
    return entry;
  }

  private requireEntries(ids: readonly AssetEntryId[], db: Tx): AssetEntry[] {
    const rows = db
      .prepare(
        `SELECT ${ENTRY_SELECT}
           FROM ${LT} entry
           JOIN ${CT} content ON content.${CC.hash.sqlName} = entry.${LC.assetHash.sqlName}
          WHERE entry.${LC.id.sqlName} IN (SELECT value FROM json_each(?))`,
      )
      .all(JSON.stringify(ids)) as RawEntryRow[];
    const byId = new Map(parseEntryRows(rows).rows.map((entry) => [entry.id, entry]));
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new Error(`Asset entry not found: ${missing.join(', ')}`);
    return ids.map((id) => byId.get(id)!);
  }
}

function parseGenerationMetadata(raw: string | null): AssetMeta['generationMetadata'] {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as AssetMeta['generationMetadata'];
  } catch {
    return undefined;
  }
}

function contentCandidate(row: RawContentRow): AssetMeta {
  return {
    hash: row.hash,
    type: row.type as AssetMeta['type'],
    format: row.format,
    originalName: `${row.hash}.${row.format}`,
    fileSize: row.file_size ?? 0,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    duration: row.duration ?? undefined,
    hasAudio: row.has_audio === null ? undefined : row.has_audio === 1,
    prompt: row.prompt ?? undefined,
    provider: row.provider ?? undefined,
    createdAt: row.created_at,
    generationMetadata: parseGenerationMetadata(row.generation_metadata),
  };
}

function parseContentRow(row: RawContentRow): AssetMeta | undefined {
  const sentinel = Symbol('degraded');
  const parsed = parseOrDegrade(
    AssetMetaSchema,
    contentCandidate(row),
    sentinel as unknown as AssetMeta,
    { ctx: { name: 'AssetMeta' } },
  );
  return (parsed as unknown) === sentinel ? undefined : (parsed as AssetMeta);
}

function entryCandidate(row: RawEntryRow): Record<string, unknown> {
  let tags: unknown;
  try {
    tags = JSON.parse(row.tags);
  } catch {
    tags = null;
  }
  const content = contentCandidate({ ...row, created_at: row.content_created_at });
  const { createdAt: contentCreatedAt, ...rest } = content;
  return {
    ...rest,
    id: row.entry_id,
    displayName: row.display_name,
    tags,
    folderId: row.folder_id,
    createdAt: row.entry_created_at,
    contentCreatedAt,
  };
}

function parseEntryRows(rows: RawEntryRow[]): ListResult<AssetEntry> {
  const parsedRows: AssetEntry[] = [];
  let degradedCount = 0;
  const sentinel = Symbol('degraded');
  for (const row of rows) {
    const parsed = parseOrDegrade(
      AssetEntrySchema,
      entryCandidate(row),
      sentinel as unknown as AssetEntry,
      { ctx: { name: 'AssetEntry' } },
    );
    if ((parsed as unknown) === sentinel) degradedCount += 1;
    else parsedRows.push(parsed as AssetEntry);
  }
  return { rows: parsedRows, degradedCount };
}
