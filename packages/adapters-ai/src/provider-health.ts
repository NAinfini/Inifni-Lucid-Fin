/**
 * Provider health tracker — in-memory runtime reliability monitoring.
 *
 * Tracks success/failure of each provider call and derives a health status.
 * Resets on app restart (not persisted).
 *
 * Status rules:
 *   - 0 consecutive failures → healthy
 *   - 1–2 consecutive failures → degraded
 *   - 3+ consecutive failures → down
 *   - No calls recorded → unknown
 */

export type ProviderHealthStatusValue = 'healthy' | 'degraded' | 'down' | 'unknown';

export interface ProviderHealthStatus {
  providerId: string;
  lastSuccess?: string; // ISO-8601
  lastFailure?: string; // ISO-8601
  consecutiveFailures: number;
  status: ProviderHealthStatusValue;
  totalSuccesses: number;
  totalFailures: number;
}

/** Threshold at which a warning is logged. */
const WARN_THRESHOLD = 5;

interface InternalEntry {
  lastSuccess?: string;
  lastFailure?: string;
  consecutiveFailures: number;
  totalSuccesses: number;
  totalFailures: number;
  warnedAt5: boolean;
}

function deriveStatus(entry: InternalEntry): ProviderHealthStatusValue {
  // No calls at all → unknown
  if (entry.totalSuccesses === 0 && entry.totalFailures === 0) {
    return 'unknown';
  }
  if (entry.consecutiveFailures === 0) return 'healthy';
  if (entry.consecutiveFailures <= 2) return 'degraded';
  return 'down';
}

export class ProviderHealthTracker {
  private entries = new Map<string, InternalEntry>();
  private warnLogger: ((message: string, meta: Record<string, unknown>) => void) | undefined;

  /**
   * Optional logger for the 5-consecutive-failure warning.
   * Pass `log.warn` from the consuming app layer to enable.
   */
  setWarnLogger(logger: (message: string, meta: Record<string, unknown>) => void): void {
    this.warnLogger = logger;
  }

  recordSuccess(providerId: string): void {
    const entry = this.getOrCreate(providerId);
    entry.lastSuccess = new Date().toISOString();
    entry.consecutiveFailures = 0;
    entry.totalSuccesses += 1;
    entry.warnedAt5 = false;
  }

  recordFailure(providerId: string): void {
    const entry = this.getOrCreate(providerId);
    entry.lastFailure = new Date().toISOString();
    entry.consecutiveFailures += 1;
    entry.totalFailures += 1;

    if (entry.consecutiveFailures >= WARN_THRESHOLD && !entry.warnedAt5) {
      entry.warnedAt5 = true;
      this.warnLogger?.(
        `Provider ${providerId} has ${entry.consecutiveFailures} consecutive failures`,
        {
          category: 'provider-health',
          providerId,
          consecutiveFailures: entry.consecutiveFailures,
          lastFailure: entry.lastFailure,
          totalFailures: entry.totalFailures,
        },
      );
    }
  }

  getStatus(providerId: string): ProviderHealthStatus {
    const entry = this.entries.get(providerId);
    if (!entry) {
      return {
        providerId,
        consecutiveFailures: 0,
        status: 'unknown',
        totalSuccesses: 0,
        totalFailures: 0,
      };
    }
    return {
      providerId,
      lastSuccess: entry.lastSuccess,
      lastFailure: entry.lastFailure,
      consecutiveFailures: entry.consecutiveFailures,
      status: deriveStatus(entry),
      totalSuccesses: entry.totalSuccesses,
      totalFailures: entry.totalFailures,
    };
  }

  getAllStatuses(): ProviderHealthStatus[] {
    return Array.from(this.entries.keys()).map((id) => this.getStatus(id));
  }

  /** Reset tracking for a single provider (e.g. after key change). */
  resetProvider(providerId: string): void {
    this.entries.delete(providerId);
  }

  /** Reset all tracking data. */
  resetAll(): void {
    this.entries.clear();
  }

  private getOrCreate(providerId: string): InternalEntry {
    let entry = this.entries.get(providerId);
    if (!entry) {
      entry = {
        consecutiveFailures: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        warnedAt5: false,
      };
      this.entries.set(providerId, entry);
    }
    return entry;
  }
}

/**
 * Singleton instance used across the app. Imported by adapter call sites
 * (canvas generation, commander image gen, generation pipeline) and the
 * IPC handler that exposes status to the renderer.
 */
export const providerHealth = new ProviderHealthTracker();
