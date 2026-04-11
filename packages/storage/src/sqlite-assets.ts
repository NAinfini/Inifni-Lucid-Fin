import path from 'node:path';
import type { AssetMeta } from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

export type AssetMetaInput = Partial<AssetMeta> & {
  size?: unknown;
  mimeType?: unknown;
  projectId?: string;
};

const ASSET_FORMAT_BY_MIME_TYPE: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'audio/mp4': 'm4a',
};

function normalizeAssetTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return Date.now();
}

function normalizeAssetFileSize(meta: AssetMetaInput): number {
  if (typeof meta.fileSize === 'number' && Number.isFinite(meta.fileSize) && meta.fileSize >= 0) {
    return meta.fileSize;
  }
  if (typeof meta.size === 'number' && Number.isFinite(meta.size) && meta.size >= 0) {
    return meta.size;
  }
  return 0;
}

function normalizeAssetFormat(meta: AssetMetaInput): string {
  if (typeof meta.format === 'string' && meta.format.trim()) {
    return meta.format.trim().toLowerCase();
  }

  if (typeof meta.originalName === 'string' && meta.originalName.trim()) {
    const ext = path.extname(meta.originalName).slice(1).toLowerCase();
    if (ext) {
      return ext;
    }
  }

  if (typeof meta.mimeType === 'string' && meta.mimeType.trim()) {
    const mimeType = meta.mimeType.trim().toLowerCase();
    const mapped = ASSET_FORMAT_BY_MIME_TYPE[mimeType];
    if (mapped) {
      return mapped;
    }
    const subtype = mimeType.split('/')[1]?.split('+')[0]?.trim();
    if (subtype) {
      return subtype;
    }
  }

  return 'bin';
}

export function normalizeAssetMeta(meta: AssetMetaInput): AssetMeta & { projectId?: string } {
  const format = normalizeAssetFormat(meta);
  const hash = typeof meta.hash === 'string' ? meta.hash : '';
  const type = meta.type as AssetMeta['type'];

  return {
    hash,
    type,
    format,
    originalName:
      typeof meta.originalName === 'string' && meta.originalName.trim()
        ? meta.originalName
        : `${hash}.${format}`,
    fileSize: normalizeAssetFileSize(meta),
    width: typeof meta.width === 'number' && Number.isFinite(meta.width) ? meta.width : undefined,
    height: typeof meta.height === 'number' && Number.isFinite(meta.height) ? meta.height : undefined,
    duration:
      typeof meta.duration === 'number' && Number.isFinite(meta.duration) ? meta.duration : undefined,
    prompt: typeof meta.prompt === 'string' ? meta.prompt : undefined,
    provider: typeof meta.provider === 'string' ? meta.provider : undefined,
    tags: Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    createdAt: normalizeAssetTimestamp(meta.createdAt),
    projectId: typeof meta.projectId === 'string' ? meta.projectId : undefined,
  };
}

export function insertAsset(db: BetterSqlite3.Database, meta: AssetMetaInput): void {
  const normalized = normalizeAssetMeta(meta);
  db.prepare(
    `
    INSERT OR REPLACE INTO assets (hash, type, format, tags, prompt, provider, created_at, file_size, project_id, width, height, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    normalized.hash,
    normalized.type,
    normalized.format,
    JSON.stringify(normalized.tags),
    normalized.prompt ?? null,
    normalized.provider ?? null,
    normalized.createdAt,
    normalized.fileSize,
    normalized.projectId ?? null,
    normalized.width ?? null,
    normalized.height ?? null,
    normalized.duration ?? null,
  );
}

export function deleteAsset(db: BetterSqlite3.Database, hash: string): void {
  db.prepare('DELETE FROM assets WHERE hash = ?').run(hash);
}

export function queryAssets(
  db: BetterSqlite3.Database,
  filter: { type?: string; projectId?: string; limit?: number; offset?: number },
): AssetMeta[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter.type) {
    conditions.push('type = ?');
    params.push(filter.type);
  }
  if (filter.projectId) {
    conditions.push('project_id = ?');
    params.push(filter.projectId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter.limit ?? 100;
  const offset = filter.offset ?? 0;

  const rows = db
    .prepare(`SELECT * FROM assets ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    hash: r.hash as string,
    type: r.type as AssetMeta['type'],
    format: r.format as string,
    originalName: '',
    fileSize: typeof r.file_size === 'number' ? r.file_size : 0,
    width: typeof r.width === 'number' ? r.width : undefined,
    height: typeof r.height === 'number' ? r.height : undefined,
    duration: typeof r.duration === 'number' ? r.duration : undefined,
    tags: JSON.parse((r.tags as string) || '[]'),
    prompt: r.prompt as string | undefined,
    provider: r.provider as string | undefined,
    createdAt: r.created_at as number,
  }));
}

export interface EmbeddingRecord {
  hash: string;
  description: string;
  tokens: string[];
  model: string;
  createdAt: number;
}

export interface SemanticSearchResult {
  hash: string;
  score: number;
  description: string;
}

export function insertEmbedding(
  db: BetterSqlite3.Database,
  hash: string,
  description: string,
  tokens: string[],
  model: string,
): void {
  db.prepare(
    `INSERT OR REPLACE INTO asset_embeddings (hash, description, tokens, model, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(hash, description, JSON.stringify(tokens), model, Date.now());
}

export function queryEmbeddingByHash(
  db: BetterSqlite3.Database,
  hash: string,
): EmbeddingRecord | undefined {
  const row = db
    .prepare('SELECT * FROM asset_embeddings WHERE hash = ?')
    .get(hash) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return {
    hash: row.hash as string,
    description: row.description as string,
    tokens: JSON.parse(row.tokens as string) as string[],
    model: row.model as string,
    createdAt: row.created_at as number,
  };
}

export function searchByTokens(
  db: BetterSqlite3.Database,
  queryTokens: string[],
  limit: number,
): SemanticSearchResult[] {
  if (queryTokens.length === 0) return [];

  const rows = db
    .prepare('SELECT hash, description, tokens FROM asset_embeddings')
    .all() as Array<{ hash: string; description: string; tokens: string }>;

  const querySet = new Set(queryTokens);

  const scored = rows
    .map((row) => {
      const storedTokens: string[] = JSON.parse(row.tokens);
      const storedSet = new Set(storedTokens);
      // Jaccard similarity: |intersection| / |union|
      let intersection = 0;
      for (const t of querySet) {
        if (storedSet.has(t)) intersection++;
      }
      const union = querySet.size + storedSet.size - intersection;
      const score = union > 0 ? intersection / union : 0;
      return { hash: row.hash, score, description: row.description };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

export function getAllEmbeddedHashes(db: BetterSqlite3.Database): string[] {
  const rows = db
    .prepare('SELECT hash FROM asset_embeddings')
    .all() as Array<{ hash: string }>;
  return rows.map((r) => r.hash);
}

export function searchAssets(
  db: BetterSqlite3.Database,
  query: string,
  limit = 50,
  projectId?: string,
): AssetMeta[] {
  const projectFilter = projectId ? 'AND a.project_id = ?' : '';
  const params: unknown[] = projectId ? [query, projectId, limit] : [query, limit];
  const rows = db
    .prepare(
      `
    SELECT a.* FROM assets a
    JOIN assets_fts f ON a.rowid = f.rowid
    WHERE assets_fts MATCH ?
    ${projectFilter}
    LIMIT ?
  `,
    )
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    hash: r.hash as string,
    type: r.type as AssetMeta['type'],
    format: r.format as string,
    originalName: '',
    fileSize: typeof r.file_size === 'number' ? r.file_size : 0,
    width: typeof r.width === 'number' ? r.width : undefined,
    height: typeof r.height === 'number' ? r.height : undefined,
    duration: typeof r.duration === 'number' ? r.duration : undefined,
    tags: JSON.parse((r.tags as string) || '[]'),
    prompt: r.prompt as string | undefined,
    provider: r.provider as string | undefined,
    createdAt: r.created_at as number,
  }));
}
