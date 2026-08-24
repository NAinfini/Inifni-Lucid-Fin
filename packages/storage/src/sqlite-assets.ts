import fs from 'node:fs';
import path from 'node:path';
import type { AssetMeta } from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

export type AssetMetaInput = Partial<AssetMeta> & {
  displayName?: unknown;
  tags?: unknown;
  folderId?: unknown;
  size?: unknown;
  mimeType?: unknown;
};

export type NormalizedAssetInput = AssetMeta & {
  displayName: string;
  tags: string[];
  folderId: string | null;
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

function normalizeTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeFileSize(meta: AssetMetaInput): number {
  if (typeof meta.fileSize === 'number' && Number.isFinite(meta.fileSize) && meta.fileSize >= 0) {
    return meta.fileSize;
  }
  if (typeof meta.size === 'number' && Number.isFinite(meta.size) && meta.size >= 0) {
    return meta.size;
  }
  return 0;
}

function normalizeFormat(meta: AssetMetaInput): string {
  if (typeof meta.format === 'string' && meta.format.trim()) {
    return meta.format.trim().toLowerCase();
  }
  if (typeof meta.originalName === 'string' && meta.originalName.trim()) {
    const ext = path.extname(meta.originalName).slice(1).toLowerCase();
    if (ext) return ext;
  }
  if (typeof meta.mimeType === 'string' && meta.mimeType.trim()) {
    const mimeType = meta.mimeType.trim().toLowerCase();
    const mapped = ASSET_FORMAT_BY_MIME_TYPE[mimeType];
    if (mapped) return mapped;
    const subtype = mimeType.split('/')[1]?.split('+')[0]?.trim();
    if (subtype) return subtype;
  }
  return 'bin';
}

export function normalizeAssetMeta(meta: AssetMetaInput): NormalizedAssetInput {
  const format = normalizeFormat(meta);
  const hash = typeof meta.hash === 'string' ? meta.hash : '';
  const originalName =
    typeof meta.originalName === 'string' && meta.originalName.trim()
      ? meta.originalName
      : `${hash}.${format}`;
  return {
    hash,
    type: meta.type as AssetMeta['type'],
    format,
    originalName,
    fileSize: normalizeFileSize(meta),
    width: typeof meta.width === 'number' && Number.isFinite(meta.width) ? meta.width : undefined,
    height:
      typeof meta.height === 'number' && Number.isFinite(meta.height) ? meta.height : undefined,
    duration:
      typeof meta.duration === 'number' && Number.isFinite(meta.duration)
        ? meta.duration
        : undefined,
    hasAudio:
      meta.type === 'video' && typeof meta.hasAudio === 'boolean' ? meta.hasAudio : undefined,
    prompt: typeof meta.prompt === 'string' ? meta.prompt : undefined,
    provider: typeof meta.provider === 'string' ? meta.provider : undefined,
    createdAt: normalizeTimestamp(meta.createdAt),
    generationMetadata: meta.generationMetadata ?? undefined,
    displayName:
      typeof meta.displayName === 'string' && meta.displayName.trim()
        ? meta.displayName.trim()
        : originalName,
    tags: Array.isArray(meta.tags)
      ? meta.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
    folderId: typeof meta.folderId === 'string' ? meta.folderId : null,
  };
}

export function repairAssetSizes(
  db: BetterSqlite3.Database,
  resolveAssetPath: (hash: string, type: string, format: string) => string,
): number {
  const rows = db
    .prepare(
      'SELECT hash, type, format FROM asset_contents WHERE file_size IS NULL OR file_size <= 0',
    )
    .all() as Array<{ hash: string; type: string; format: string }>;
  const update = db.prepare('UPDATE asset_contents SET file_size = ? WHERE hash = ?');
  let repaired = 0;
  db.transaction(() => {
    for (const row of rows) {
      try {
        const filePath = resolveAssetPath(row.hash, row.type, row.format);
        if (!fs.existsSync(filePath)) continue;
        const size = fs.statSync(filePath).size;
        if (size > 0) {
          update.run(size, row.hash);
          repaired += 1;
        }
      } catch {
        // Missing or unreadable CAS files remain eligible for later repair/GC.
      }
    }
  })();
  return repaired;
}
