/**
 * Commander telemetry counters.
 *
 * Renderer-side counters that track IPC parse quality, stream health,
 * back-pressure, and user-initiated aborts. Module-level singleton —
 * there is exactly one commander session service instance per renderer
 * window, and we want every wire-event drop counted in one place so a
 * dev-console `/telemetry` dump reflects the real picture without
 * walking instances.
 *
 * Render-lag samples track the time between a `push()` into the
 * BatchedDispatcher and the rAF callback actually firing, giving us an
 * honest p50/p95 even when the main thread is busy. We keep a ring
 * buffer of the last 200 samples (bounded memory) and compute
 * percentiles on demand.
 */

const RENDER_LAG_SAMPLE_CAP = 200;

export interface CommanderTelemetry {
  /** Events that failed the wire-schema zod parse (unexpected shape). */
  parseFailureCount: number;
  /** Events whose `kind` discriminator doesn't match any known variant. */
  unknownKindCount: number;
  /** Times the orchestrator's stall watchdog fired (90s no-event). */
  stallWarningCount: number;
  /** Times the orchestrator retried a failed LLM call (transient error). */
  llmRetryCount: number;
  /** Times the user cancelled a single LLM step (two-stage cancel, stage 1). */
  stepAbortCount: number;
  /** Times the user cancelled the entire run. */
  runAbortCount: number;
  /** Total pushes folded by the BatchedDispatcher (sum of batch sizes). */
  coalescedDeltaCount: number;
  /** Total flushes performed by the BatchedDispatcher. */
  flushCount: number;
  /** Largest single-flush batch size seen (max over all flushes). */
  maxBatchSize: number;
  /** Render-lag p50 in ms — null until the first sample is recorded. */
  renderLagMsP50: number | null;
  /** Render-lag p95 in ms — null until the first sample is recorded. */
  renderLagMsP95: number | null;
}

const counters = {
  parseFailureCount: 0,
  unknownKindCount: 0,
  stallWarningCount: 0,
  llmRetryCount: 0,
  stepAbortCount: 0,
  runAbortCount: 0,
  coalescedDeltaCount: 0,
  flushCount: 0,
  maxBatchSize: 0,
};

const renderLagSamples: number[] = [];

export function incrementParseFailure(): void {
  counters.parseFailureCount += 1;
}

export function incrementUnknownKind(): void {
  counters.unknownKindCount += 1;
}

export function incrementStallWarning(): void {
  counters.stallWarningCount += 1;
}

export function incrementLLMRetry(): void {
  counters.llmRetryCount += 1;
}

export function incrementStepAbort(): void {
  counters.stepAbortCount += 1;
}

export function incrementRunAbort(): void {
  counters.runAbortCount += 1;
}

/** Called on every BatchedDispatcher flush, once per kind+key. */
export function recordCoalescedBatch(batchSize: number): void {
  counters.coalescedDeltaCount += batchSize;
  counters.flushCount += 1;
  if (batchSize > counters.maxBatchSize) counters.maxBatchSize = batchSize;
}

/**
 * Record a render-lag sample (ms between `push()` and flush callback).
 * Kept in a bounded ring buffer; percentiles recomputed on read.
 */
export function recordRenderLagSample(ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  if (renderLagSamples.length >= RENDER_LAG_SAMPLE_CAP) renderLagSamples.shift();
  renderLagSamples.push(ms);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function readCommanderTelemetry(): Readonly<CommanderTelemetry> {
  const sorted = [...renderLagSamples].sort((a, b) => a - b);
  return {
    parseFailureCount: counters.parseFailureCount,
    unknownKindCount: counters.unknownKindCount,
    stallWarningCount: counters.stallWarningCount,
    llmRetryCount: counters.llmRetryCount,
    stepAbortCount: counters.stepAbortCount,
    runAbortCount: counters.runAbortCount,
    coalescedDeltaCount: counters.coalescedDeltaCount,
    flushCount: counters.flushCount,
    maxBatchSize: counters.maxBatchSize,
    renderLagMsP50: sorted.length === 0 ? null : percentile(sorted, 50),
    renderLagMsP95: sorted.length === 0 ? null : percentile(sorted, 95),
  };
}

export function resetCommanderTelemetry(): void {
  counters.parseFailureCount = 0;
  counters.unknownKindCount = 0;
  counters.stallWarningCount = 0;
  counters.llmRetryCount = 0;
  counters.stepAbortCount = 0;
  counters.runAbortCount = 0;
  counters.coalescedDeltaCount = 0;
  counters.flushCount = 0;
  counters.maxBatchSize = 0;
  renderLagSamples.length = 0;
}
