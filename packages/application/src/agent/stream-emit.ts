/**
 * Commander stream event emitter types.
 *
 * Separates the orchestrator-internal emit surface (an event *body*, minus
 * the provenance fields) from the fully-stamped `CommanderStreamEvent` that
 * crosses the IPC boundary. Every emit site passes the body; the orchestrator
 * stamps `runId`, `step`, `emittedAt` once at the wrapping layer.
 *
 * This keeps the orchestrator emit sites terse while guaranteeing every event
 * that reaches the wire carries complete provenance.
 */
import type { CommanderStreamEvent } from '@lucid-fin/contracts';

/** The wire-level stamped event — what the renderer receives. */
export type StampedStreamEvent = CommanderStreamEvent;

/**
 * Body of a stream event — everything except the three provenance fields.
 * Emit sites build this; `makeStampedEmit` adds `runId`/`step`/`emittedAt`.
 */
export type StreamEventBody = {
  [K in CommanderStreamEvent['kind']]: Omit<
    Extract<CommanderStreamEvent, { kind: K }>,
    'runId' | 'step' | 'emittedAt'
  >;
}[CommanderStreamEvent['kind']];

/** Emit function used throughout the orchestrator and tool executor. */
export type StreamEmit = (body: StreamEventBody) => void;

/**
 * Build a stamped emit function that injects `runId`/`step`/`emittedAt` before
 * forwarding to the outer emit. `getStep` is a closure because `step` changes
 * over the orchestrator loop; the tool-executor gets a fresh stamped emit per
 * iteration.
 */
export function makeStampedEmit(
  runId: string,
  getStep: () => number,
  outer: (event: StampedStreamEvent) => void,
): StreamEmit {
  return (body) => {
    outer({
      ...body,
      runId,
      step: getStep(),
      emittedAt: Date.now(),
    } as StampedStreamEvent);
  };
}
