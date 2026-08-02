/**
 * Update Safety Module — R34/R35/R36 unified update-safety system.
 *
 * Provides:
 *   - R34: Release rollback — stores previous version info, tracks update
 *     health via a 5-minute survival timer, offers rollback if the app
 *     crashes on first post-update launch.
 *   - R35: Staged rollout (client-side) — update channel concept
 *     (stable/beta/canary), filters available updates by channel.
 *   - R36: Forced update check — minimum version enforcement, blocking
 *     dialog trigger, persistent offline banner support.
 *
 * Persisted state lives in `%APPDATA%/Lucid Fin/update-safety.json`.
 */
import * as electron from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { log } from './logger.js';

const { app } = electron;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpdateChannel = 'stable' | 'beta' | 'canary';

export interface RollbackMetadata {
  previousVersion: string;
  currentVersion: string;
  installedAt: number;
  healthy: boolean;
  healthCheckedAt: number | null;
}

export interface UpdateSafetyState {
  /** User's chosen update channel. Default: 'stable'. */
  channel: UpdateChannel;
  /** Rollback info — populated after an update is applied. */
  rollback: RollbackMetadata | null;
  /** Minimum required version from server metadata. */
  minimumVersion: string | null;
}

export interface UpdateSafetyInfo {
  channel: UpdateChannel;
  rollback: RollbackMetadata | null;
  currentVersion: string;
  minimumVersion: string | null;
  isForcedUpdate: boolean;
}

// ---------------------------------------------------------------------------
// Lightweight semver comparison (major.minor.patch only)
// ---------------------------------------------------------------------------

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

function parseSemVer(version: string): SemVer | null {
  // Strip leading 'v' if present
  const v = version.startsWith('v') ? version.slice(1) : version;
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(v);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compare two semver strings. Returns:
 *   -1 if a < b
 *    0 if a === b
 *    1 if a > b
 *
 * Pre-release versions are considered less than the release version.
 * Returns 0 if either version cannot be parsed.
 */
function compareSemVer(a: string, b: string): -1 | 0 | 1 {
  const va = parseSemVer(a);
  const vb = parseSemVer(b);
  if (!va || !vb) return 0;

  if (va.major !== vb.major) return va.major < vb.major ? -1 : 1;
  if (va.minor !== vb.minor) return va.minor < vb.minor ? -1 : 1;
  if (va.patch !== vb.patch) return va.patch < vb.patch ? -1 : 1;

  // Both are release versions (no prerelease)
  if (!va.prerelease && !vb.prerelease) return 0;
  // A prerelease is less than the release
  if (va.prerelease && !vb.prerelease) return -1;
  if (!va.prerelease && vb.prerelease) return 1;

  // Both have prerelease: compare lexicographically
  if (va.prerelease! < vb.prerelease!) return -1;
  if (va.prerelease! > vb.prerelease!) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STATE_FILE_NAME = 'update-safety.json';

function getStatePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE_NAME);
}

function loadState(): UpdateSafetyState {
  const defaults: UpdateSafetyState = {
    channel: 'stable',
    rollback: null,
    minimumVersion: null,
  };

  try {
    const raw = fs.readFileSync(getStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<UpdateSafetyState>;
    return {
      channel: isValidChannel(parsed.channel) ? parsed.channel : defaults.channel,
      rollback: isValidRollback(parsed.rollback) ? parsed.rollback : defaults.rollback,
      minimumVersion:
        typeof parsed.minimumVersion === 'string' ? parsed.minimumVersion : defaults.minimumVersion,
    };
  } catch {
    // File doesn't exist or is corrupt — use defaults
    return defaults;
  }
}

function saveState(state: UpdateSafetyState): void {
  try {
    fs.writeFileSync(getStatePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    log('error', 'Failed to save update-safety state', {
      category: 'update-safety',
      error: String(err),
    });
  }
}

function isValidChannel(value: unknown): value is UpdateChannel {
  return value === 'stable' || value === 'beta' || value === 'canary';
}

function isValidRollback(value: unknown): value is RollbackMetadata {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.previousVersion === 'string' &&
    typeof v.currentVersion === 'string' &&
    typeof v.installedAt === 'number' &&
    typeof v.healthy === 'boolean'
  );
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let state: UpdateSafetyState = {
  channel: 'stable',
  rollback: null,
  minimumVersion: null,
};

let healthTimer: ReturnType<typeof setTimeout> | null = null;

/** Duration (ms) the app must survive after an update to be marked healthy. */
const HEALTH_CHECK_DELAY_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Initialize the update-safety module. Should be called early in app startup.
 *
 * On first launch after an update, this starts the 5-minute health timer.
 * If the app survives, the update is marked healthy.
 */
export function initUpdateSafety(): void {
  state = loadState();

  const currentVersion = getAppVersion();

  // Check if we just updated (rollback exists, not yet healthy, version matches)
  if (
    state.rollback &&
    !state.rollback.healthy &&
    state.rollback.currentVersion === currentVersion
  ) {
    log('info', 'Post-update health check started', {
      category: 'update-safety',
      previousVersion: state.rollback.previousVersion,
      currentVersion,
    });

    // Start the health timer
    healthTimer = setTimeout(() => {
      markUpdateHealthy();
    }, HEALTH_CHECK_DELAY_MS);
  }

  // If current version is different from rollback.currentVersion and rollback exists,
  // this means we're running a different version (possibly rolled back or manually changed).
  // Clear stale rollback data.
  if (state.rollback && state.rollback.currentVersion !== currentVersion) {
    log('info', 'Clearing stale rollback metadata (version mismatch)', {
      category: 'update-safety',
      storedVersion: state.rollback.currentVersion,
      currentVersion,
    });
    state.rollback = null;
    saveState(state);
  }

  log('debug', 'Update-safety initialized', {
    category: 'update-safety',
    channel: state.channel,
    hasRollback: state.rollback !== null,
    minimumVersion: state.minimumVersion,
  });
}

/**
 * Stop the update-safety module. Called on app shutdown.
 */
export function stopUpdateSafety(): void {
  if (healthTimer) {
    clearTimeout(healthTimer);
    healthTimer = null;
  }
}

// ---------------------------------------------------------------------------
// R34: Rollback
// ---------------------------------------------------------------------------

/**
 * Record that an update is about to be installed. Stores the current version
 * as the "previous" version so we can offer rollback later.
 *
 * Called just before `autoUpdater.quitAndInstall()`.
 */
export function recordPreUpdateState(newVersion: string): void {
  const currentVersion = getAppVersion();

  state.rollback = {
    previousVersion: currentVersion,
    currentVersion: newVersion,
    installedAt: Date.now(),
    healthy: false,
    healthCheckedAt: null,
  };
  saveState(state);

  log('info', 'Pre-update state recorded', {
    category: 'update-safety',
    previousVersion: currentVersion,
    newVersion,
  });
}

/**
 * Mark the current update as healthy (survived the health check period).
 */
function markUpdateHealthy(): void {
  if (!state.rollback) return;

  state.rollback.healthy = true;
  state.rollback.healthCheckedAt = Date.now();
  saveState(state);

  log('info', 'Update marked as healthy', {
    category: 'update-safety',
    version: state.rollback.currentVersion,
  });
}

/**
 * Get rollback info for the renderer to display.
 */
export function getRollbackInfo(): RollbackMetadata | null {
  return state.rollback;
}

/**
 * Perform a rollback by relaunching the app. In Electron with NSIS/Squirrel,
 * we can't truly downgrade in-process. The rollback triggers `app.relaunch()`
 * and clears the rollback state. The user should have the previous installer
 * or the OS restore mechanism.
 *
 * For now this is a best-effort mechanism: we clear the rollback state and
 * relaunch. Full installer-level rollback would require storing the previous
 * installer binary, which is a future enhancement.
 */
export function performRollback(): { initiated: boolean; message: string } {
  if (!state.rollback) {
    return { initiated: false, message: 'No rollback information available' };
  }

  if (state.rollback.healthy) {
    return { initiated: false, message: 'Current update is marked as healthy' };
  }

  const previousVersion = state.rollback.previousVersion;

  // Clear rollback state
  state.rollback = null;
  saveState(state);

  log('info', 'Rollback initiated', {
    category: 'update-safety',
    targetVersion: previousVersion,
  });

  // Relaunch the app — on next launch, the rollback state is cleared.
  // In a real scenario, the OS/installer's rollback mechanism handles
  // restoring the previous version.
  app.relaunch();
  app.exit(0);

  return { initiated: true, message: `Rollback to ${previousVersion} initiated` };
}

// ---------------------------------------------------------------------------
// R35: Update Channel
// ---------------------------------------------------------------------------

/**
 * Get the current update channel.
 */
export function getUpdateChannel(): UpdateChannel {
  return state.channel;
}

/**
 * Set the update channel preference.
 */
export function setUpdateChannel(channel: UpdateChannel): void {
  state.channel = channel;
  saveState(state);

  log('info', 'Update channel changed', {
    category: 'update-safety',
    channel,
  });
}

/**
 * Check if a given version matches the user's channel preference.
 *
 * - `stable`: only versions without prerelease tags (e.g. 1.2.3)
 * - `beta`: stable + versions with `beta` or `rc` prerelease
 * - `canary`: all versions (including alpha, dev, canary, etc.)
 */
export function isVersionAllowedByChannel(version: string, channel?: UpdateChannel): boolean {
  const effectiveChannel = channel ?? state.channel;
  const sv = parseSemVer(version);
  if (!sv) return true; // Can't parse — allow through

  if (effectiveChannel === 'canary') return true;

  if (effectiveChannel === 'beta') {
    if (!sv.prerelease) return true;
    const pre = sv.prerelease.toLowerCase();
    return pre.startsWith('beta') || pre.startsWith('rc');
  }

  // stable: no prerelease
  return !sv.prerelease;
}

// ---------------------------------------------------------------------------
// R36: Forced Update
// ---------------------------------------------------------------------------

/**
 * Update the minimum version from server metadata.
 * Called when we receive update info from the update server.
 */
export function setMinimumVersion(version: string | null): void {
  state.minimumVersion = version;
  saveState(state);

  if (version) {
    log('info', 'Minimum version updated', {
      category: 'update-safety',
      minimumVersion: version,
    });
  }
}

/**
 * Check if the current app version is below the minimum required version.
 * Returns true if a forced update is required.
 */
export function isForcedUpdateRequired(): boolean {
  if (!state.minimumVersion) return false;
  const current = getAppVersion();
  return compareSemVer(current, state.minimumVersion) < 0;
}

/**
 * Get the minimum version string (or null if none set).
 */
export function getMinimumVersion(): string | null {
  return state.minimumVersion;
}

// ---------------------------------------------------------------------------
// Combined info for renderer
// ---------------------------------------------------------------------------

/**
 * Get the full update-safety info for the renderer.
 */
export function getUpdateSafetyInfo(): UpdateSafetyInfo {
  return {
    channel: state.channel,
    rollback: state.rollback,
    currentVersion: getAppVersion(),
    minimumVersion: state.minimumVersion,
    isForcedUpdate: isForcedUpdateRequired(),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAppVersion(): string {
  try {
    const pkgPath = path.join(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
      '..',
      'package.json',
    );
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? app.getVersion();
  } catch {
    return app.getVersion();
  }
}

// Exported for testing
export { compareSemVer as _compareSemVer, parseSemVer as _parseSemVer };
