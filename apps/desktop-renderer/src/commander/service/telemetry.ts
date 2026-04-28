/**
 * Commander telemetry counters.
 *
 * Renderer-side counters that track IPC parse quality, stream health,
 * back-pressure, and user-initiated aborts. Module-level singleton —
 * there is exactly one commander session service instance per renderer
 * window, and we want every wire-event drop counted in one place so a
 * dev-console `/telemetry` dump reflects the real picture without
 * walking instances.
 */

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

export function readCommanderTelemetry(): Readonly<CommanderTelemetry> {
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
    renderLagMsP50: null,
    renderLagMsP95: null,
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
}
