/**
 * Anonymous usage analytics emitter.
 *
 * - When analytics is disabled (default), `trackEvent` is a no-op.
 * - When enabled, events are batched in memory and logged via the
 *   structured logger at 'info' level with category 'analytics'.
 * - No PII, no file paths, no content -- only event name + aggregate properties.
 * - No external service calls -- local logging only.
 */
import type { AnalyticsEvent } from './analytics-schema.js';
import log from './logger.js';

let enabled = false;
const eventBatch: AnalyticsEvent[] = [];
const BATCH_FLUSH_SIZE = 20;

/**
 * Control whether analytics events are recorded and logged.
 * Default: false (disabled).
 */
export function setAnalyticsEnabled(value: boolean): void {
  enabled = value;
  if (!value) {
    // When disabled, clear the batch -- no stale events should linger.
    eventBatch.length = 0;
  }
}

/**
 * Track an anonymous usage event.
 * No-op when analytics is disabled.
 */
export function trackEvent(name: string, properties?: Record<string, string | number>): void {
  if (!enabled) return;

  const event: AnalyticsEvent = {
    name,
    timestamp: new Date().toISOString(),
    properties: properties ?? {},
  };

  eventBatch.push(event);

  if (eventBatch.length >= BATCH_FLUSH_SIZE) {
    logBatch();
  }
}

/**
 * Flush all batched events (for testing or shutdown).
 * Returns a copy of the flushed events and clears the internal batch.
 */
export function flushEvents(): AnalyticsEvent[] {
  const flushed = [...eventBatch];
  if (eventBatch.length > 0) {
    logBatch();
  }
  return flushed;
}

function logBatch(): void {
  if (eventBatch.length === 0) return;

  log.info(`Analytics batch: ${eventBatch.length} event(s)`, {
    category: 'analytics',
    eventCount: eventBatch.length,
    events: eventBatch.map((e) => ({ name: e.name, timestamp: e.timestamp, ...e.properties })),
  });

  eventBatch.length = 0;
}
