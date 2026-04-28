import type { SqliteIndex } from '@lucid-fin/storage';
import log from '../logger.js';

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
      const result = db.repair();
      if (result.failedTables.length > 0) {
        log.warn('Database repair completed with losses', {
          category: 'startup',
          recovered: result.recoveredTables,
          failed: result.failedTables,
          backupReadable: result.backupReadable,
        });
      } else {
        log.info('Database repaired successfully', {
          category: 'startup',
          recovered: result.recoveredTables,
          backupReadable: result.backupReadable,
        });
      }
    } catch (repairErr) {
      log.error('Database repair failed:', repairErr);
    }
  }
}
