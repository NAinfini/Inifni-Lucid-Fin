import type { SqliteIndex } from '@lucid-fin/storage';
import fs from 'node:fs';
import log from 'electron-log';

/**
 * DB self-healing: validates the database on startup.
 * If corrupted, backs up the bad file and lets SqliteIndex recreate a fresh one.
 */
export function initDb(db: SqliteIndex): void {
  try {
    db.healthCheck();
    log.info('SQLite database initialized');
  } catch (err) {
    log.error('Database health check failed, attempting repair:', err);
    try {
      db.repair();
      log.info('Database repaired successfully');
    } catch (repairErr) {
      log.error('Database repair failed:', repairErr);
    }
  }
}
