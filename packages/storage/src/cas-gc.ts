/**
 * CAS (Content-Addressable Storage) Garbage Collector.
 *
 * Identifies and optionally deletes orphaned CAS files -- files whose
 * content hash does not appear in any reference source in the database.
 *
 * The reference-source matrix covers every table/column that may store
 * a CAS hash. A hash is "live" if it appears in ANY cell of ANY row
 * in ANY of these sources.
 *
 * Concurrent-write safety uses an epoch mechanism: only files with
 * mtime strictly before the GC start timestamp are candidates for
 * deletion. Files written during or after GC are excluded automatically.
 */

import fs from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export interface OrphanFile {
  /** The content hash (filename without extension). */
  hash: string;
  /** Absolute path to the CAS file. */
  filePath: string;
  /** File size in bytes. */
  fileSize: number;
}

export interface GcResult {
  /** Whether files were actually deleted (false = dry-run). */
  deleted: boolean;
  /** Orphan files found. */
  orphans: OrphanFile[];
  /** Total bytes of orphan files. */
  totalBytes: number;
  /** Number of live (referenced) hashes found in the database. */
  liveHashCount: number;
  /** Number of CAS files scanned on disk. */
  scannedFileCount: number;
  /** Which reference sources were queried (for audit logging). */
  sourcesScanned: string[];
  /** Duration of the GC scan in milliseconds. */
  durationMs: number;
}

export interface GcOptions {
  /** When true, report orphans without deleting. Default: true. */
  dryRun?: boolean;
}

// ---------------------------------------------------------------------------
// SHA-256 hex hash pattern (64 hex chars)
// ---------------------------------------------------------------------------

const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

function isValidHash(s: unknown): s is string {
  return typeof s === 'string' && SHA256_HEX_RE.test(s);
}

// ---------------------------------------------------------------------------
// Reference-source collectors
// ---------------------------------------------------------------------------

/**
 * Each collector function queries one reference source and adds all
 * discovered hashes to the provided Set. Returns the source name for
 * audit logging.
 */
type HashCollector = (db: BetterSqlite3.Database, hashes: Set<string>) => string;

/** Extract hashes from a JSON string by walking all values recursively. */
function extractHashesFromJson(jsonStr: string, hashes: Set<string>): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return;
  }
  walkValue(parsed, hashes);
}

/**
 * Hash-bearing field names in canvas node data and entity reference images.
 * We extract any string value from these keys that looks like a SHA-256 hash.
 */
const HASH_FIELD_NAMES = new Set([
  'assetHash',
  'sourceImageHash',
  'firstFrameAssetHash',
  'lastFrameAssetHash',
  'referenceImageHash',
  'hash',
]);

function walkValue(value: unknown, hashes: Set<string>): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (isValidHash(value)) hashes.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkValue(item, hashes);
    return;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const [key, val] of Object.entries(obj)) {
      if (HASH_FIELD_NAMES.has(key)) {
        if (isValidHash(val)) hashes.add(val);
      }
      // Always recurse into nested objects/arrays (e.g. generationHistory,
      // variants, frameReferenceHashes)
      if (typeof val === 'object' && val !== null) {
        walkValue(val, hashes);
      }
      // Also check plain string values in 'variants' arrays
      if (key === 'variants' && Array.isArray(val)) {
        for (const v of val) {
          if (isValidHash(v)) hashes.add(v);
        }
      }
    }
  }
}

// -- Individual collectors --------------------------------------------------

const collectFromCanvasNodes: HashCollector = (db, hashes) => {
  const rows = db.prepare('SELECT data_json FROM canvas_nodes').all() as Array<{
    data_json: string;
  }>;
  for (const row of rows) {
    if (row.data_json) extractHashesFromJson(row.data_json, hashes);
  }
  return 'canvas_nodes.data_json';
};

const collectFromCharacters: HashCollector = (db, hashes) => {
  const rows = db
    .prepare('SELECT ref_image, reference_images FROM characters WHERE deleted_at IS NULL')
    .all() as Array<{ ref_image: string | null; reference_images: string | null }>;
  for (const row of rows) {
    if (isValidHash(row.ref_image)) hashes.add(row.ref_image!);
    if (row.reference_images) extractHashesFromJson(row.reference_images, hashes);
  }
  return 'characters.ref_image + characters.reference_images';
};

const collectFromEquipment: HashCollector = (db, hashes) => {
  const rows = db
    .prepare('SELECT reference_images FROM equipment WHERE deleted_at IS NULL')
    .all() as Array<{ reference_images: string | null }>;
  for (const row of rows) {
    if (row.reference_images) extractHashesFromJson(row.reference_images, hashes);
  }
  return 'equipment.reference_images';
};

const collectFromLocations: HashCollector = (db, hashes) => {
  const rows = db
    .prepare('SELECT reference_images FROM locations WHERE deleted_at IS NULL')
    .all() as Array<{ reference_images: string | null }>;
  for (const row of rows) {
    if (row.reference_images) extractHashesFromJson(row.reference_images, hashes);
  }
  return 'locations.reference_images';
};

const collectFromWorkflowArtifacts: HashCollector = (db, hashes) => {
  const rows = db
    .prepare('SELECT asset_hash FROM workflow_artifacts WHERE asset_hash IS NOT NULL')
    .all() as Array<{ asset_hash: string }>;
  for (const row of rows) {
    if (isValidHash(row.asset_hash)) hashes.add(row.asset_hash);
  }
  return 'workflow_artifacts.asset_hash';
};

const collectFromColorStyles: HashCollector = (db, hashes) => {
  const rows = db
    .prepare('SELECT source_asset FROM color_styles WHERE source_asset IS NOT NULL')
    .all() as Array<{ source_asset: string }>;
  for (const row of rows) {
    if (isValidHash(row.source_asset)) hashes.add(row.source_asset);
  }
  return 'color_styles.source_asset';
};

const collectFromAssetEmbeddings: HashCollector = (db, hashes) => {
  const rows = db.prepare('SELECT hash FROM asset_embeddings').all() as Array<{ hash: string }>;
  for (const row of rows) {
    if (isValidHash(row.hash)) hashes.add(row.hash);
  }
  return 'asset_embeddings.hash';
};

const collectFromAssets: HashCollector = (db, hashes) => {
  const rows = db.prepare('SELECT hash FROM assets').all() as Array<{ hash: string }>;
  for (const row of rows) {
    if (isValidHash(row.hash)) hashes.add(row.hash);
  }
  return 'assets.hash';
};

/**
 * Ordered list of all reference-source collectors. When adding a new
 * table that stores CAS hashes, append a collector here.
 */
const ALL_COLLECTORS: HashCollector[] = [
  collectFromAssets,
  collectFromCanvasNodes,
  collectFromCharacters,
  collectFromEquipment,
  collectFromLocations,
  collectFromWorkflowArtifacts,
  collectFromColorStyles,
  collectFromAssetEmbeddings,
];

// ---------------------------------------------------------------------------
// CAS directory scanner
// ---------------------------------------------------------------------------

interface CasFile {
  hash: string;
  filePath: string;
  fileSize: number;
  mtimeMs: number;
}

/**
 * Scan the CAS directory tree and return all non-meta asset files.
 * CAS layout: `<assetsRoot>/<type>/<prefix>/<hash>.<ext>`
 * where `<type>` is image|video|audio and `<prefix>` is hash[0:2].
 */
function scanCasFiles(assetsRoot: string): CasFile[] {
  const files: CasFile[] = [];
  if (!fs.existsSync(assetsRoot)) return files;

  const ASSET_TYPES = ['image', 'video', 'audio'];
  for (const assetType of ASSET_TYPES) {
    const typeDir = path.join(assetsRoot, assetType);
    if (!fs.existsSync(typeDir) || !fs.statSync(typeDir).isDirectory()) continue;

    for (const prefix of fs.readdirSync(typeDir)) {
      const prefixDir = path.join(typeDir, prefix);
      if (!fs.statSync(prefixDir).isDirectory()) continue;

      for (const entry of fs.readdirSync(prefixDir)) {
        // Skip metadata files
        if (entry.endsWith('.meta.json')) continue;

        const filePath = path.join(prefixDir, entry);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        // Extract hash from filename: <hash>.<ext>
        const dotIndex = entry.lastIndexOf('.');
        const hash = dotIndex >= 0 ? entry.slice(0, dotIndex) : entry;
        if (!isValidHash(hash)) continue;

        files.push({
          hash,
          filePath,
          fileSize: stat.size,
          mtimeMs: stat.mtimeMs,
        });
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run CAS garbage collection.
 *
 * 1. Record the epoch timestamp (for concurrent-write safety).
 * 2. Collect all live hashes from every reference source in the DB.
 * 3. Scan the CAS directory for all files.
 * 4. Identify orphans: files whose hash is not in the live set AND
 *    whose mtime is before the epoch (to avoid deleting in-flight writes).
 * 5. Optionally delete orphan files (when dryRun is false).
 *
 * @param db - The better-sqlite3 database handle.
 * @param assetsRoot - Absolute path to the CAS assets root directory.
 * @param options - GC options (dryRun defaults to true).
 */
export function collectGarbage(
  db: BetterSqlite3.Database,
  assetsRoot: string,
  options?: GcOptions,
): GcResult {
  const dryRun = options?.dryRun ?? true;
  const startTime = Date.now();

  // Step 1: Record epoch for concurrent-write safety
  const epochMs = Date.now();

  // Step 2: Collect all live hashes from the database
  const liveHashes = new Set<string>();
  const sourcesScanned: string[] = [];

  for (const collector of ALL_COLLECTORS) {
    const sourceName = collector(db, liveHashes);
    sourcesScanned.push(sourceName);
  }

  // Step 3: Scan CAS directory
  const casFiles = scanCasFiles(assetsRoot);

  // Step 4: Identify orphans
  // An orphan must satisfy BOTH conditions:
  //   a) hash is NOT in the live set
  //   b) file mtime is strictly before the epoch (concurrent-write safety)
  const orphans: OrphanFile[] = [];
  let totalBytes = 0;

  // Deduplicate by hash (same hash may have files in multiple type dirs)
  const seenHashes = new Set<string>();

  for (const file of casFiles) {
    if (liveHashes.has(file.hash)) continue;
    if (file.mtimeMs >= epochMs) continue; // Written during GC — skip
    if (seenHashes.has(file.hash)) {
      // Still count the extra file as an orphan to delete
      orphans.push({
        hash: file.hash,
        filePath: file.filePath,
        fileSize: file.fileSize,
      });
      totalBytes += file.fileSize;
      continue;
    }
    seenHashes.add(file.hash);
    orphans.push({
      hash: file.hash,
      filePath: file.filePath,
      fileSize: file.fileSize,
    });
    totalBytes += file.fileSize;
  }

  // Step 5: Delete orphans if not dry-run
  if (!dryRun) {
    for (const orphan of orphans) {
      try {
        fs.rmSync(orphan.filePath, { force: true });
        // Also delete the companion .meta.json if it exists
        const dir = path.dirname(orphan.filePath);
        const metaPath = path.join(dir, `${orphan.hash}.meta.json`);
        if (fs.existsSync(metaPath)) {
          fs.rmSync(metaPath, { force: true });
        }
      } catch {
        // Best-effort deletion; a subsequent GC run will retry.
      }
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    deleted: !dryRun,
    orphans,
    totalBytes,
    liveHashCount: liveHashes.size,
    scannedFileCount: casFiles.length,
    sourcesScanned,
    durationMs,
  };
}
