/**
 * Backup scheduler (R24).
 *
 * Runs an initial backup on app startup (after DB init) and then
 * periodically every `intervalMs` (default 30 minutes). Clears the
 * timer on `stop()` so app shutdown is clean.
 */

import { createBackup, type BackupResult, type BackupFailure } from '@lucid-fin/storage';
import type BetterSqlite3 from 'better-sqlite3';
import log from '../logger.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_BACKUPS = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setInterval> | null = null;
let consecutiveFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BackupSchedulerDeps {
  /** The raw better-sqlite3 Database handle (for checkpoint). */
  getDb: () => BetterSqlite3.Database;
  /** Absolute path to the database file. */
  dbPath: string;
  /** Interval in ms between backups (default 30 minutes). */
  intervalMs?: number;
  /** Maximum number of backups to retain (default 3). */
  maxBackups?: number;
  /** Optional callback when 3 consecutive backups fail. */
  onRepeatedFailure?: () => void;
}

function runBackup(deps: BackupSchedulerDeps): BackupResult | BackupFailure {
  const { getDb, dbPath, maxBackups = DEFAULT_MAX_BACKUPS } = deps;
  const startMs = performance.now();

  try {
    const db = getDb();
    const result = createBackup(db, dbPath, maxBackups);
    const elapsed = Math.round(performance.now() - startMs);

    if (result.success) {
      consecutiveFailures = 0;
      log.info('Periodic backup completed', {
        category: 'backup',
        filename: result.filename,
        sizeBytes: result.sizeBytes,
        durationMs: elapsed,
      });
    } else {
      consecutiveFailures++;
      log.error('Periodic backup failed', {
        category: 'backup',
        error: result.error,
        consecutiveFailures,
        durationMs: elapsed,
      });
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && deps.onRepeatedFailure) {
        deps.onRepeatedFailure();
      }
    }

    return result;
  } catch (err) {
    consecutiveFailures++;
    const elapsed = Math.round(performance.now() - startMs);
    log.error('Periodic backup threw', {
      category: 'backup',
      error: err instanceof Error ? err.message : String(err),
      consecutiveFailures,
      durationMs: elapsed,
    });
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES && deps.onRepeatedFailure) {
      deps.onRepeatedFailure();
    }
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Start the backup scheduler. Runs an immediate backup, then
 * sets up a periodic interval.
 */
export function startBackupScheduler(deps: BackupSchedulerDeps): void {
  if (timer) {
    log.warn('Backup scheduler already running — skipping start', { category: 'backup' });
    return;
  }

  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  consecutiveFailures = 0;

  log.info('Starting backup scheduler', {
    category: 'backup',
    intervalMs,
    maxBackups: deps.maxBackups ?? DEFAULT_MAX_BACKUPS,
  });

  // Run initial backup
  runBackup(deps);

  // Schedule periodic backups
  timer = setInterval(() => {
    runBackup(deps);
  }, intervalMs);
}

/**
 * Stop the backup scheduler. Safe to call multiple times.
 */
export function stopBackupScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    consecutiveFailures = 0;
    log.info('Backup scheduler stopped', { category: 'backup' });
  }
}

/**
 * Trigger a manual backup outside the schedule.
 */
export function triggerManualBackup(deps: BackupSchedulerDeps): BackupResult | BackupFailure {
  log.info('Manual backup triggered', { category: 'backup' });
  return runBackup(deps);
}
