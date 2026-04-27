/**
 * Commander stream event emitter types.
 *
 * Separates the orchestrator-internal emit surface (an event *body*, minus
 * the provenance fields) from the fully-stamped `TimelineEvent` that crosses
 * the IPC boundary. Every emit site passes the body; the wrapping layer
 * stamps `runId`, `step`, `seq`, `emittedAt` once.
 *
 * `seq` is the single primary ordering key, monotonic per-run. `step` is
 * semantic only (model-step-index, used for dedup windowing). `emittedAt`
 * is debug/display only. Phase C reducer reads `seq` for ordering; Phase E
 * persistence writes `seq` as part of the primary key.
 */
import type { TimelineEvent } from '@lucid-fin/contracts';

/**
 * The wire-level stamped event — a fully formed `TimelineEvent` with all
 * four provenance fields populated.
 */
export type StampedStreamEvent = TimelineEvent;

/**
 * Body of a stream event — everything except the four provenance fields
 * (`runId`, `step`, `seq`, `emittedAt`). Emit sites build this;
 * `makeStampedEmit` injects the provenance before forwarding.
 */
export type StreamEventBody = {
  [K in TimelineEvent['kind']]: Omit<
    Extract<TimelineEvent, { kind: K }>,
    'runId' | 'step' | 'seq' | 'emittedAt'
  >;
}[TimelineEvent['kind']];

/** Emit function used throughout the orchestrator and tool executor. */
export type StreamEmit = (body: StreamEventBody) => void;

/**
 * Build a stamped emit function that injects `runId`/`step`/`seq`/
 * `emittedAt` before forwarding to the outer emit. `getStep` is a closure
 * because `step` changes over the orchestrator loop; `seq` is owned by
 * this factory (monotonic per-run).
 */
export function makeStampedEmit(
  runId: string,
  getStep: () => number,
  outer: (event: StampedStreamEvent) => void,
): StreamEmit {
  let seq = 0;
  return (body) => {
    outer({
      ...body,
      runId,
      step: getStep(),
      seq: seq++,
      emittedAt: Date.now(),
    } as StampedStreamEvent);
  };
}
