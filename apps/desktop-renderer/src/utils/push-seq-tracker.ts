/**
 * `utils/push-seq-tracker.ts` — R29 renderer-side sequence tracking.
 *
 * Tracks the last processed sequence number per push channel, detects gaps,
 * and deduplicates events. When a gap is detected, it triggers a re-sync
 * request via the provided callback.
 *
 * Usage: wrap the raw push event callback with `tracker.wrap(channel, cb)`
 * to get automatic dedup and gap detection.
 */

import type { PushEnvelope } from './push-seq-types.js';

// ---------------------------------------------------------------------------
// Re-sync strategy registry
// ---------------------------------------------------------------------------

/**
 * Map from push channel name to a re-sync function. When a gap is detected
 * on that channel, the function is called to restore consistent state.
 * Channels without a registered strategy log a warning but skip re-sync.
 */
export type ReSyncStrategy = () => void | Promise<void>;

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export interface PushSeqTrackerOpts {
  /** Called when a sequence gap is detected. */
  onGap?: (info: { channel: string; expected: number; received: number; gap: number }) => void;
  /** Called when a duplicate event is skipped. */
  onDuplicate?: (info: { channel: string; seq: number }) => void;
}

export interface PushSeqTracker {
  /**
   * Process an incoming push envelope. Returns `true` if the event should
   * be delivered to the subscriber (new, in-order or gap-detected).
   * Returns `false` if the event is a duplicate and should be skipped.
   */
  accept(envelope: PushEnvelope): boolean;

  /**
   * Register a re-sync strategy for a specific channel.
   */
  registerResync(channel: string, strategy: ReSyncStrategy): void;

  /**
   * Get the last processed seq per channel, for sending to `push:sync`.
   */
  getLastSeqs(): Record<string, number>;

  /**
   * Reset all tracking state (e.g. on full reconnect).
   */
  reset(): void;
}

export function createPushSeqTracker(opts: PushSeqTrackerOpts = {}): PushSeqTracker {
  /** Per-channel last processed seq. */
  const lastSeqs = new Map<string, number>();
  /** Per-channel re-sync strategies. */
  const resyncStrategies = new Map<string, ReSyncStrategy>();
  /** Channels currently re-syncing (prevent re-sync storms). */
  const resyncInFlight = new Set<string>();

  return {
    accept(envelope) {
      const { seq, channel } = envelope;
      const lastSeen = lastSeqs.get(channel) ?? 0;

      // Duplicate — skip
      if (seq <= lastSeen) {
        opts.onDuplicate?.({ channel, seq });
        return false;
      }

      // Gap detected — trigger re-sync if strategy exists
      const expected = lastSeen + 1;
      if (seq > expected) {
        const gap = seq - expected;
        opts.onGap?.({ channel, expected, received: seq, gap });

        const strategy = resyncStrategies.get(channel);
        if (strategy && !resyncInFlight.has(channel)) {
          resyncInFlight.add(channel);
          try {
            const result = strategy();
            // Handle async strategies
            if (result && typeof (result as Promise<void>).then === 'function') {
              (result as Promise<void>)
                .catch((err) => {
                  console.warn(`[push-seq-tracker] re-sync failed for ${channel}:`, err);
                })
                .finally(() => {
                  resyncInFlight.delete(channel);
                });
            } else {
              resyncInFlight.delete(channel);
            }
          } catch (err) {
            console.warn(`[push-seq-tracker] re-sync threw for ${channel}:`, err);
            resyncInFlight.delete(channel);
          }
        } else if (!strategy) {
          console.warn(
            `[push-seq-tracker] gap detected on '${channel}' (expected ${expected}, got ${seq}) but no re-sync strategy registered`,
          );
        }
      }

      // Accept the event and advance the counter
      lastSeqs.set(channel, seq);
      return true;
    },

    registerResync(channel, strategy) {
      resyncStrategies.set(channel, strategy);
    },

    getLastSeqs() {
      const result: Record<string, number> = {};
      for (const [ch, seq] of lastSeqs) {
        result[ch] = seq;
      }
      return result;
    },

    reset() {
      lastSeqs.clear();
      resyncInFlight.clear();
    },
  };
}
