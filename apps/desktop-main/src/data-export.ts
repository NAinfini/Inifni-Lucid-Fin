/**
 * Full data export module (R19).
 *
 * Exports all user data to a target directory:
 *   - SQLite databases (with WAL checkpoint)
 *   - CAS assets directory
 *   - Manifest file with checksums
 *
 * API keys are explicitly excluded (they stay in the OS keychain).
 */

import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import log from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportResult {
  success: boolean;
  exportDir?: string;
  manifest?: ExportManifest;
  error?: string;
  durationMs?: number;
}

export interface ExportManifest {
  version: 1;
  exportedAt: string;
  appVersion: string;
  items: ExportManifestItem[];
  totalBytes: number;
}

export interface ExportManifestItem {
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface ExportPaths {
  /** Absolute path to main SQLite database */
  dbPath: string;
  /** Absolute path to prompts database (may not exist) */
  promptsDbPath: string;
  /** Absolute path to CAS assets root directory */
  assetsRoot: string;
  /** Absolute path to logs directory */
  logsDir: string;
}

// ---------------------------------------------------------------------------
// Size estimation
// ---------------------------------------------------------------------------

async function dirSizeRecursive(dirPath: string): Promise<number> {
  try {
    await fsp.access(dirPath);
  } catch {
    return 0;
  }
  let total = 0;
  const entries = await fsp.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dirPath, entry.name);
    if (entry.isFile()) {
      const st = await fsp.stat(full).catch(() => null);
      total += st?.size ?? 0;
    } else if (entry.isDirectory()) {
      total += await dirSizeRecursive(full);
    }
  }
  return total;
}

async function fileSizeSafe(filePath: string): Promise<number> {
  try {
    return (await fsp.stat(filePath)).size;
  } catch {
    return 0;
  }
}

/**
 * Estimate total export size in bytes (before copying).
 */
export async function estimateExportSize(paths: ExportPaths): Promise<number> {
  const [dbSize, promptsSize, assetsSize] = await Promise.all([
    fileSizeSafe(paths.dbPath),
    fileSizeSafe(paths.promptsDbPath),
    dirSizeRecursive(paths.assetsRoot),
  ]);
  return dbSize + promptsSize + assetsSize;
}

// ---------------------------------------------------------------------------
// File hashing
// ---------------------------------------------------------------------------

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

async function copyFileWithManifest(
  srcPath: string,
  destPath: string,
  relativePath: string,
  items: ExportManifestItem[],
): Promise<void> {
  try {
    await fsp.access(srcPath);
  } catch {
    // Source does not exist -- skip silently
    return;
  }
  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await fsp.copyFile(srcPath, destPath);
  const stat = await fsp.stat(destPath);
  const checksum = await sha256File(destPath);
  items.push({ relativePath, sizeBytes: stat.size, sha256: checksum });
}

async function copyDirWithManifest(
  srcDir: string,
  destDir: string,
  relativeBase: string,
  items: ExportManifestItem[],
): Promise<void> {
  try {
    await fsp.access(srcDir);
  } catch {
    // Source does not exist -- skip silently
    return;
  }
  await fsp.mkdir(destDir, { recursive: true });
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    const relPath = path.join(relativeBase, entry.name).replace(/\\/g, '/');
    if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
      const stat = await fsp.stat(destPath);
      const checksum = await sha256File(destPath);
      items.push({ relativePath: relPath, sizeBytes: stat.size, sha256: checksum });
    } else if (entry.isDirectory()) {
      await copyDirWithManifest(srcPath, destPath, relPath, items);
    }
  }
}

// ---------------------------------------------------------------------------
// Main export function
// ---------------------------------------------------------------------------

/**
 * Export all user data to `targetDir`.
 *
 * The function performs a WAL checkpoint on the database before copying
 * to ensure data consistency. API keys stored in the OS keychain are
 * intentionally excluded from the export.
 *
 * @param targetDir - Destination directory (will be created if needed)
 * @param paths - Locations of all data stores
 * @param rawDb - The raw better-sqlite3 database handle (for WAL checkpoint)
 * @param appVersion - Application version string for the manifest
 */
export async function exportAllData(
  targetDir: string,
  paths: ExportPaths,
  rawDb: { pragma: (sql: string) => unknown },
  appVersion: string,
): Promise<ExportResult> {
  const start = Date.now();
  try {
    await fsp.mkdir(targetDir, { recursive: true });

    // WAL checkpoint to flush pending writes before copying
    try {
      rawDb.pragma('wal_checkpoint(TRUNCATE)');
      log.info('[data-export] WAL checkpoint completed', { category: 'export' });
    } catch (err) {
      log.warn('[data-export] WAL checkpoint failed (best-effort)', {
        category: 'export',
        error: String(err),
      });
    }

    const items: ExportManifestItem[] = [];

    // 1. Copy main database
    await copyFileWithManifest(
      paths.dbPath,
      path.join(targetDir, 'lucid-fin.db'),
      'lucid-fin.db',
      items,
    );

    // 2. Copy prompts database (may not exist)
    await copyFileWithManifest(
      paths.promptsDbPath,
      path.join(targetDir, 'prompts.db'),
      'prompts.db',
      items,
    );

    // 3. Copy CAS assets directory
    await copyDirWithManifest(
      paths.assetsRoot,
      path.join(targetDir, 'assets'),
      'assets',
      items,
    );

    // 4. Write manifest
    const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
    const manifest: ExportManifest = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appVersion,
      items,
      totalBytes,
    };
    const manifestJson = JSON.stringify(manifest, null, 2);
    await fsp.writeFile(path.join(targetDir, 'manifest.json'), manifestJson, 'utf-8');

    const durationMs = Date.now() - start;
    log.info('[data-export] Export completed', {
      category: 'export',
      targetDir,
      fileCount: items.length,
      totalBytes,
      durationMs,
    });

    return {
      success: true,
      exportDir: targetDir,
      manifest,
      durationMs,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    log.error('[data-export] Export failed', {
      category: 'export',
      targetDir,
      error: String(err),
      durationMs,
    });
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
  }
}
