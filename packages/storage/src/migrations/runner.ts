/**
 * Versioned database migration runner.
 *
 * Each migration is a numbered function that receives a better-sqlite3 Database
 * instance. Migrations run inside a transaction — if one fails, it rolls back
 * cleanly. A `schema_migrations` table tracks which versions have been applied.
 *
 * Usage:
 *   import { runMigrations } from './migrations/runner.js';
 *   import { migrations } from './migrations/index.js';
 *   runMigrations(db, migrations);
 */
import type BetterSqlite3 from 'better-sqlite3';

export interface Migration {
  /** Sequential version number (1, 2, 3, ...). Must be unique and ascending. */
  version: number;
  /** Short human-readable label shown in logs. */
  name: string;
  /** The migration function. Receives the raw database handle. */
  up: (db: BetterSqlite3.Database) => void;
}

/**
 * Run all pending migrations in order.
 * Creates the `schema_migrations` tracking table if it doesn't exist.
 * Each migration runs in its own SAVEPOINT so a failure rolls back only that migration.
 *
 * @returns The number of migrations applied.
 */
export function runMigrations(db: BetterSqlite3.Database, migrations: Migration[]): number {
  // Ensure tracking table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version   INTEGER PRIMARY KEY,
      name      TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);

  // Determine which versions have already been applied
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>)
      .map((row) => row.version),
  );

  // Sort migrations by version (ascending)
  const sorted = [...migrations].sort((a, b) => a.version - b.version);

  let count = 0;
  for (const migration of sorted) {
    if (applied.has(migration.version)) continue;

    // Run inside a transaction for atomicity
    const run = db.transaction(() => {
      migration.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
      ).run(migration.version, migration.name, Date.now());
    });

    run();
    count++;
  }

  return count;
}

/**
 * Get the current schema version (highest applied migration).
 * Returns 0 if no migrations have been applied.
 */
export function getCurrentVersion(db: BetterSqlite3.Database): number {
  try {
    const row = db.prepare(
      'SELECT MAX(version) as v FROM schema_migrations',
    ).get() as { v: number | null } | undefined;
    return row?.v ?? 0;
  } catch { /* schema_migrations table not yet created — treat as version 0 */
    return 0;
  }
}
