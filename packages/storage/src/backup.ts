/**
 * Periodic database backup with restore capability (R24).
 *
 * Provides timestamped full-snapshot backups of the SQLite database,
 * a manifest tracking each backup (timestamp, size, SHA-256 checksum),
 * a retention policy (keep last N), and a restore function that
 * verifies integrity before committing.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupManifestEntry {
  filename: string;
  timestamp: string;
  sizeBytes: number;
  checksum: string; // SHA-256 hex
}

export interface BackupManifest {
  entries: BackupManifestEntry[];
}

export interface BackupResult {
  success: true;
  filename: string;
  backupPath: string;
  sizeBytes: number;
  checksum: string;
  durationMs: number;
}

export interface BackupFailure {
  success: false;
  error: string;
}

export interface RestoreResult {
  success: true;
  preRestoreBackup: string;
  restoredFrom: string;
}

export interface RestoreFailure {
  success: false;
  error: string;
  rolledBack: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUPS_DIR = 'backups';
const MANIFEST_FILE = 'manifest.json';
const DEFAULT_MAX_BACKUPS = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256File(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return createHash('sha256').update(data).digest('hex');
}

function ensureBackupsDir(dbPath: string): string {
  const dir = path.join(path.dirname(dbPath), BACKUPS_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function manifestPath(dbPath: string): string {
  return path.join(ensureBackupsDir(dbPath), MANIFEST_FILE);
}

function readManifest(dbPath: string): BackupManifest {
  const mPath = manifestPath(dbPath);
  if (!fs.existsSync(mPath)) {
    return { entries: [] };
  }
  try {
    const raw = fs.readFileSync(mPath, 'utf-8');
    const parsed = JSON.parse(raw) as BackupManifest;
    if (!Array.isArray(parsed.entries)) {
      return { entries: [] };
    }
    return parsed;
  } catch {
    return { entries: [] };
  }
}

function writeManifest(dbPath: string, manifest: BackupManifest): void {
  const mPath = manifestPath(dbPath);
  fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a timestamped backup of the database.
 *
 * 1. Checkpoint WAL to flush pending transactions.
 * 2. Copy the DB file to `backups/{dbname}.backup.{ISO-timestamp}.sqlite`.
 * 3. Compute SHA-256 checksum.
 * 4. Update the manifest.
 * 5. Enforce retention policy.
 */
export function createBackup(
  db: BetterSqlite3.Database,
  dbPath: string,
  maxBackups: number = DEFAULT_MAX_BACKUPS,
): BackupResult | BackupFailure {
  const startMs = performance.now();

  if (!dbPath || dbPath === ':memory:') {
    return { success: false, error: 'Cannot backup in-memory database' };
  }
  if (!fs.existsSync(dbPath)) {
    return { success: false, error: `Database file not found: ${dbPath}` };
  }

  try {
    // Flush WAL to main file
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // best-effort; backup may still be consistent via the file copy
    }

    const backupsDir = ensureBackupsDir(dbPath);
    const dbName = path.basename(dbPath, path.extname(dbPath));
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${dbName}.backup.${timestamp}.sqlite`;
    const backupPath = path.join(backupsDir, filename);

    fs.copyFileSync(dbPath, backupPath);

    const stat = fs.statSync(backupPath);
    const checksum = sha256File(backupPath);
    const durationMs = Math.round(performance.now() - startMs);

    // Update manifest
    const manifest = readManifest(dbPath);
    manifest.entries.push({
      filename,
      timestamp: new Date().toISOString(),
      sizeBytes: stat.size,
      checksum,
    });

    // Enforce retention — keep only the most recent N entries
    if (manifest.entries.length > maxBackups) {
      const toRemove = manifest.entries.splice(0, manifest.entries.length - maxBackups);
      for (const entry of toRemove) {
        const oldPath = path.join(backupsDir, entry.filename);
        try {
          fs.rmSync(oldPath, { force: true });
        } catch {
          // best-effort cleanup
        }
      }
    }

    writeManifest(dbPath, manifest);

    return {
      success: true,
      filename,
      backupPath,
      sizeBytes: stat.size,
      checksum,
      durationMs,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * List all known backups from the manifest.
 */
export function listBackups(dbPath: string): BackupManifestEntry[] {
  const manifest = readManifest(dbPath);
  // Return newest-first
  return [...manifest.entries].reverse();
}

/**
 * Restore a database from a backup file.
 *
 * 1. Verify the backup file exists and its hash matches the manifest.
 * 2. Create a pre-restore backup of the current database.
 * 3. Close the provided DB connection (caller must reopen after).
 * 4. Copy backup over current DB file.
 * 5. Remove WAL/SHM files for a clean start.
 * 6. Reopen and run integrity check.
 * 7. On failure, rollback to pre-restore backup.
 *
 * IMPORTANT: Caller is responsible for closing all connections to the DB
 * before calling this, and reopening after. The `db` parameter is used
 * only for the pre-restore checkpoint. The function closes it internally.
 */
export function restoreBackup(
  db: BetterSqlite3.Database,
  dbPath: string,
  backupFilename: string,
  Database: typeof BetterSqlite3,
): RestoreResult | RestoreFailure {
  if (!dbPath || dbPath === ':memory:') {
    return { success: false, error: 'Cannot restore in-memory database', rolledBack: false };
  }

  const backupsDir = path.join(path.dirname(dbPath), BACKUPS_DIR);
  const backupPath = path.join(backupsDir, backupFilename);

  if (!fs.existsSync(backupPath)) {
    return {
      success: false,
      error: `Backup file not found: ${backupFilename}`,
      rolledBack: false,
    };
  }

  // Verify hash against manifest
  const manifest = readManifest(dbPath);
  const entry = manifest.entries.find((e) => e.filename === backupFilename);
  if (entry) {
    const actualHash = sha256File(backupPath);
    if (actualHash !== entry.checksum) {
      return {
        success: false,
        error: `Hash mismatch: expected ${entry.checksum}, got ${actualHash}. Backup may be corrupted.`,
        rolledBack: false,
      };
    }
  }

  // Create pre-restore backup
  const preRestoreFilename = `pre-restore.${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;
  const preRestorePath = path.join(backupsDir, preRestoreFilename);

  try {
    // Checkpoint WAL before closing
    try {
      db.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      /* best-effort */
    }
    db.close();
  } catch {
    /* may already be closed */
  }

  try {
    // Copy current DB as pre-restore backup
    if (fs.existsSync(dbPath)) {
      fs.copyFileSync(dbPath, preRestorePath);
    }

    // Copy backup over current DB
    fs.copyFileSync(backupPath, dbPath);

    // Remove WAL and SHM files for clean start
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.rmSync(dbPath + suffix, { force: true });
      } catch {
        /* may not exist */
      }
    }

    // Open restored DB and verify integrity
    let restoredDb: BetterSqlite3.Database;
    try {
      restoredDb = new Database(dbPath);
      restoredDb.pragma('journal_mode = WAL');
      restoredDb.pragma('foreign_keys = ON');
    } catch (openErr) {
      // Cannot open restored DB — rollback
      rollback(preRestorePath, dbPath);
      return {
        success: false,
        error: `Failed to open restored database: ${openErr instanceof Error ? openErr.message : String(openErr)}`,
        rolledBack: true,
      };
    }

    try {
      const result = restoredDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
      if (!result.length || result[0].integrity_check !== 'ok') {
        restoredDb.close();
        rollback(preRestorePath, dbPath);
        return {
          success: false,
          error: `Integrity check failed after restore: ${JSON.stringify(result)}`,
          rolledBack: true,
        };
      }
      restoredDb.close();
    } catch (checkErr) {
      try {
        restoredDb.close();
      } catch {
        /* ignore */
      }
      rollback(preRestorePath, dbPath);
      return {
        success: false,
        error: `Integrity check threw: ${checkErr instanceof Error ? checkErr.message : String(checkErr)}`,
        rolledBack: true,
      };
    }

    return {
      success: true,
      preRestoreBackup: preRestoreFilename,
      restoredFrom: backupFilename,
    };
  } catch (err) {
    // Attempt rollback
    try {
      rollback(preRestorePath, dbPath);
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        rolledBack: true,
      };
    } catch {
      return {
        success: false,
        error: `Restore failed and rollback also failed: ${err instanceof Error ? err.message : String(err)}`,
        rolledBack: false,
      };
    }
  }
}

function rollback(preRestorePath: string, dbPath: string): void {
  if (fs.existsSync(preRestorePath)) {
    fs.copyFileSync(preRestorePath, dbPath);
    // Clean WAL/SHM left over
    for (const suffix of ['-wal', '-shm']) {
      try {
        fs.rmSync(dbPath + suffix, { force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Purge the backups directory and manifest. Used in tests or explicit reset.
 */
export function purgeAllBackups(dbPath: string): void {
  const backupsDir = path.join(path.dirname(dbPath), BACKUPS_DIR);
  if (fs.existsSync(backupsDir)) {
    fs.rmSync(backupsDir, { recursive: true, force: true });
  }
}
