/**
 * Full data wipe module (R19).
 *
 * Destructively deletes all user data in a safe sequence:
 *   1. Close the database
 *   2. Delete DB file + WAL + SHM
 *   3. Delete prompts DB + WAL + SHM
 *   4. Delete CAS assets directory
 *   5. Clear keytar entries (API keys)
 *   6. Delete logs directory
 *
 * Each step is idempotent — safe to retry after partial failure.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import keytar from 'keytar';
import log from './logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WipeResult {
  success: boolean;
  steps: WipeStepResult[];
  error?: string;
  durationMs?: number;
}

export interface WipeStepResult {
  step: string;
  success: boolean;
  error?: string;
}

export interface WipePaths {
  /** Absolute path to main SQLite database */
  dbPath: string;
  /** Absolute path to prompts database */
  promptsDbPath: string;
  /** Absolute path to CAS assets root directory */
  assetsRoot: string;
  /** Absolute paths to log directories (may be multiple) */
  logDirs: string[];
}

export interface WipeDeps {
  /** Close the database handle before file deletion */
  closeDb: () => void;
  /** Flush any pending saves (e.g. settings, in-memory state) */
  flushPendingSaves: () => Promise<void>;
  /** Cancel all active jobs */
  stopBackgroundTasks: () => void;
}

const KEYTAR_SERVICE = 'lucid-fin';

/**
 * Confirmation token the renderer must supply.
 * The UI makes the user type this string verbatim.
 */
export const WIPE_CONFIRMATION_TOKEN = 'DELETE';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function removeFileSafe(filePath: string): Promise<WipeStepResult> {
  const step = `delete ${path.basename(filePath)}`;
  try {
    await fsp.rm(filePath, { force: true });
    return { step, success: true };
  } catch (err) {
    return { step, success: false, error: String(err) };
  }
}

async function removeDirSafe(dirPath: string): Promise<WipeStepResult> {
  const step = `delete ${path.basename(dirPath)}/`;
  try {
    await fsp.rm(dirPath, { recursive: true, force: true });
    return { step, success: true };
  } catch (err) {
    return { step, success: false, error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Main wipe function
// ---------------------------------------------------------------------------

/**
 * Wipe all user data. This is a destructive, irreversible operation.
 *
 * The caller must verify the confirmation token before invoking this.
 *
 * @param paths - Locations of all data stores
 * @param deps - Runtime dependencies (DB close, job cancellation, etc.)
 */
export async function wipeAllData(paths: WipePaths, deps: WipeDeps): Promise<WipeResult> {
  const start = Date.now();
  const steps: WipeStepResult[] = [];

  try {
    // Step 1: Cancel all active jobs
    try {
      deps.stopBackgroundTasks();
      steps.push({ step: 'cancel active jobs', success: true });
      log.info('[data-wipe] Active jobs cancelled', { category: 'wipe' });
    } catch (err) {
      steps.push({ step: 'cancel active jobs', success: false, error: String(err) });
      log.warn('[data-wipe] Failed to cancel active jobs', {
        category: 'wipe',
        error: String(err),
      });
    }

    // Step 2: Flush pending saves
    try {
      await deps.flushPendingSaves();
      steps.push({ step: 'flush pending saves', success: true });
      log.info('[data-wipe] Pending saves flushed', { category: 'wipe' });
    } catch (err) {
      steps.push({ step: 'flush pending saves', success: false, error: String(err) });
      log.warn('[data-wipe] Failed to flush pending saves', {
        category: 'wipe',
        error: String(err),
      });
    }

    // Step 3: Close database
    try {
      deps.closeDb();
      steps.push({ step: 'close database', success: true });
      log.info('[data-wipe] Database closed', { category: 'wipe' });
    } catch (err) {
      steps.push({ step: 'close database', success: false, error: String(err) });
      log.warn('[data-wipe] Failed to close database', {
        category: 'wipe',
        error: String(err),
      });
    }

    // Step 4: Delete main database + WAL + SHM
    steps.push(await removeFileSafe(paths.dbPath));
    steps.push(await removeFileSafe(paths.dbPath + '-wal'));
    steps.push(await removeFileSafe(paths.dbPath + '-shm'));
    log.info('[data-wipe] Main database files deleted', { category: 'wipe' });

    // Step 5: Delete prompts database + WAL + SHM
    steps.push(await removeFileSafe(paths.promptsDbPath));
    steps.push(await removeFileSafe(paths.promptsDbPath + '-wal'));
    steps.push(await removeFileSafe(paths.promptsDbPath + '-shm'));
    log.info('[data-wipe] Prompts database files deleted', { category: 'wipe' });

    // Step 6: Delete CAS assets directory
    steps.push(await removeDirSafe(paths.assetsRoot));
    log.info('[data-wipe] CAS assets directory deleted', { category: 'wipe' });

    // Step 7: Clear keytar entries
    try {
      const credentials = await keytar.findCredentials(KEYTAR_SERVICE);
      for (const cred of credentials) {
        await keytar.deletePassword(KEYTAR_SERVICE, cred.account);
      }
      steps.push({
        step: 'clear keychain entries',
        success: true,
      });
      log.info('[data-wipe] Keychain entries cleared', {
        category: 'wipe',
        count: credentials.length,
      });
    } catch (err) {
      steps.push({
        step: 'clear keychain entries',
        success: false,
        error: String(err),
      });
      log.warn('[data-wipe] Failed to clear keychain entries', {
        category: 'wipe',
        error: String(err),
      });
    }

    // Step 8: Delete logs directories
    for (const logDir of paths.logDirs) {
      const result = await removeDirSafe(logDir);
      steps.push({
        ...result,
        step: `delete logs (${path.basename(path.dirname(logDir))}/${path.basename(logDir)})`,
      });
    }
    log.info('[data-wipe] Log directories deleted', { category: 'wipe' });

    const allSucceeded = steps.every((s) => s.success);
    const durationMs = Date.now() - start;

    log.info('[data-wipe] Wipe completed', {
      category: 'wipe',
      allSucceeded,
      stepCount: steps.length,
      failedSteps: steps.filter((s) => !s.success).map((s) => s.step),
      durationMs,
    });

    return {
      success: allSucceeded,
      steps,
      durationMs,
      error: allSucceeded ? undefined : 'Some wipe steps failed — see steps for details',
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    log.error('[data-wipe] Wipe failed', {
      category: 'wipe',
      error: String(err),
      durationMs,
    });
    return {
      success: false,
      steps,
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    };
  }
}
