/**
 * Lightweight performance tracing utility.
 *
 * When crash reporting is enabled, traces record timings via
 * `performance.mark()` / `performance.measure()` and log results through the
 * structured logger at 'debug' level.
 *
 * When crash reporting is disabled (the default), every function returns a
 * no-op implementation with ~0 overhead.
 *
 * The interface is designed so a future Sentry SDK integration can replace the
 * internals without changing call sites.
 */
import { performance } from 'node:perf_hooks';
import { log } from './logger.js';
import { isCrashReportEnabled } from './crash-reporter.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface PerfTrace {
  /** Record an additional numeric measurement (e.g. node count). */
  addMeasurement(key: string, value: number): void;
  /** Finish the trace and log the result. Optional extra data merged into the log entry. */
  finish(data?: Record<string, unknown>): void;
}

// ---------------------------------------------------------------------------
// No-op singleton — returned when tracing is disabled
// ---------------------------------------------------------------------------

const NOOP_TRACE: PerfTrace = {
  addMeasurement: () => {},
  finish: () => {},
};

// ---------------------------------------------------------------------------
// Active trace implementation
// ---------------------------------------------------------------------------

let traceCounter = 0;

function createActiveTrace(name: string, data?: Record<string, unknown>): PerfTrace {
  const id = `perf:${name}:${++traceCounter}`;
  const startMark = `${id}:start`;
  const measurements: Record<string, number> = {};

  performance.mark(startMark);

  return {
    addMeasurement(key: string, value: number): void {
      measurements[key] = value;
    },

    finish(finishData?: Record<string, unknown>): void {
      const endMark = `${id}:end`;
      performance.mark(endMark);

      let durationMs: number;
      try {
        const measure = performance.measure(id, startMark, endMark);
        durationMs = Math.round(measure.duration * 100) / 100;
      } catch {
        // Fallback if marks were already cleared
        durationMs = -1;
      }

      log('debug', `perf-trace: ${name}`, {
        category: 'perf',
        trace: name,
        durationMs,
        ...data,
        ...measurements,
        ...finishData,
      });

      // Clean up marks to avoid unbounded memory growth
      try {
        performance.clearMarks(startMark);
        performance.clearMarks(endMark);
        performance.clearMeasures(id);
      } catch {
        /* marks may already be cleared */
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start a named performance trace.
 *
 * Returns a `PerfTrace` handle whose `finish()` method records the elapsed
 * time. When crash reporting is disabled the returned handle is a no-op.
 */
export function startTrace(name: string, data?: Record<string, unknown>): PerfTrace {
  if (!isCrashReportEnabled()) return NOOP_TRACE;
  return createActiveTrace(name, data);
}
