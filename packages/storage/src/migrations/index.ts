import fs from 'node:fs';
import path from 'node:path';
import type BetterSqlite3 from 'better-sqlite3';

import { SCHEMA_SQL } from '../schema-sql.js';

export interface SqliteMigration {
  version: number;
  name: string;
  up: (db: BetterSqlite3.Database) => void;
}

// Migration v2 — no-op: columns added in v2 are present in all live databases (2026-04-26)
// Fresh installs create these columns in v1 schema; existing installs already ran v2.
function addMissingCanvasColumns(_db: BetterSqlite3.Database): void {
  // intentional no-op
}

export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    name: 'initial schema',
    up(db) {
      db.exec(SCHEMA_SQL);
    },
  },
  {
    version: 2,
    name: 'canvas settings columns',
    up(db) {
      addMissingCanvasColumns(db);
    },
  },
];

export const CURRENT_SCHEMA_VERSION = SQLITE_MIGRATIONS[SQLITE_MIGRATIONS.length - 1]?.version ?? 0;

function ensureVersionTable(db: BetterSqlite3.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
}

function getCurrentVersion(db: BetterSqlite3.Database): number {
  ensureVersionTable(db);
  const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as
    | { version: number }
    | undefined;
  return row?.version ?? 0;
}

function setCurrentVersion(db: BetterSqlite3.Database, version: number): void {
  db.prepare(
    `
      INSERT INTO schema_version (id, version, updated_at)
      VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        updated_at = excluded.updated_at
    `,
  ).run(version, Date.now());
}

function canBackup(dbPath: string): boolean {
  return dbPath.length > 0 && dbPath !== ':memory:' && fs.existsSync(dbPath);
}

function backupDatabase(
  db: BetterSqlite3.Database,
  dbPath: string,
  version: number,
): string | null {
  if (!canBackup(dbPath)) {
    return null;
  }

  db.pragma('wal_checkpoint(TRUNCATE)');
  const backupPath = `${dbPath}.bak.${version}`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function restoreBackup(
  db: BetterSqlite3.Database,
  dbPath: string,
  backupPath: string | null,
): void {
  if (!backupPath || !canBackup(backupPath)) {
    return;
  }

  db.close();
  fs.copyFileSync(backupPath, dbPath);
}

function cleanOldBackups(dbPath: string, maxAgeMs = 30 * 24 * 60 * 60 * 1000): void {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const now = Date.now();
  try {
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith(base + '.bak.')) continue;
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(fullPath, { force: true });
      }
    }
  } catch {
    // cleanup is best-effort; never block startup
  }
}

export function runSqliteMigrations(
  db: BetterSqlite3.Database,
  dbPath: string,
  migrations: readonly SqliteMigration[] = SQLITE_MIGRATIONS,
): void {
  const currentVersion = getCurrentVersion(db);
  const pending = [...migrations]
    .filter((migration) => migration.version > currentVersion)
    .sort((left, right) => left.version - right.version);

  for (const migration of pending) {
    const backupPath = backupDatabase(db, dbPath, migration.version);
    try {
      const tx = db.transaction(() => {
        migration.up(db);
        setCurrentVersion(db, migration.version);
      });
      tx();
    } catch (error) {
      restoreBackup(db, dbPath, backupPath);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SQLite migration ${migration.version} failed: ${message}`, {
        cause: error,
      });
    }
  }

  cleanOldBackups(dbPath);
}
