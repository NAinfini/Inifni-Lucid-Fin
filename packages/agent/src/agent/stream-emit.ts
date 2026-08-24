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
import type {
  CommanderErrorCode,
  TimelineEvent,
  ToolRef,
} from '@lucid-fin/contracts';
import type { CanonicalJsonValue } from './event-context-projector.js';
import type { PublicToolProjection } from './tool-registry.js';
import type { RunResourceBudgetCheckpoint } from './run-resource-budget.js';

/**
 * The wire-level stamped event — a fully formed `TimelineEvent` with all
 * four provenance fields populated.
 */
type EventStamp = Pick<TimelineEvent, 'runId' | 'step' | 'seq' | 'emittedAt'>;

/**
 * Body of a stream event — everything except the four provenance fields
 * (`runId`, `step`, `seq`, `emittedAt`). Emit sites build this;
 * `makeStampedEmit` injects the provenance before forwarding.
 */
type PublicBody = {
  [K in Exclude<
    TimelineEvent['kind'],
    'tool_call' | 'tool_result' | 'tool_confirm_prompt' | 'public_progress' | 'resource_usage'
  >]: Omit<
    Extract<TimelineEvent, { kind: K }>,
    'runId' | 'step' | 'seq' | 'emittedAt'
  >;
}[Exclude<
  TimelineEvent['kind'],
  'tool_call' | 'tool_result' | 'tool_confirm_prompt' | 'public_progress' | 'resource_usage'
>];

type InternalToolCallBody = {
  kind: 'tool_call';
  toolCallId: string;
  toolRef: ToolRef;
  args: Record<string, unknown>;
};

type InternalToolResultBody = {
  kind: 'tool_result';
  toolCallId: string;
  projection: PublicToolProjection;
  status: 'succeeded' | 'failed' | 'skipped';
  errorCode?: CommanderErrorCode;
  durationMs: number;
  skipped?: true;
  synthetic?: true;
};

type InternalToolConfirmBody = {
  kind: 'tool_confirm_prompt';
  toolCallId: string;
  toolRef: ToolRef;
  tier: number;
  args: Record<string, unknown>;
};

type ResourceUsageBody = Omit<
  Extract<TimelineEvent, { kind: 'resource_usage' }>,
  'runId' | 'step' | 'seq' | 'emittedAt'
>;

type PublicProgressBody = Omit<
  Extract<TimelineEvent, { kind: 'public_progress' }>,
  'runId' | 'step' | 'seq' | 'emittedAt'
>;

export type StreamEventBody =
  | PublicBody
  | InternalToolCallBody
  | InternalToolResultBody
  | InternalToolConfirmBody
  | PublicProgressBody
  | ResourceUsageBody;

type Stamp<T> = T extends StreamEventBody ? T & EventStamp : never;

/** Internal stamped event. Raw tool payloads never cross the main-process projection boundary. */
export type StampedStreamEvent = Stamp<StreamEventBody>;

export type StreamRecoverySupplement =
  | { kind: 'tool_result'; result: CanonicalJsonValue }
  | {
      kind: 'model_checkpoint';
      content: string;
      finishReason: 'stop' | 'tool_calls' | 'length' | 'error';
      toolCalls: Array<{
        id: string;
        name: string;
        arguments: Record<string, CanonicalJsonValue>;
        thoughtSignature?: string;
      }>;
      completedStep: number;
    }
  | { kind: 'resource_checkpoint'; checkpoint: RunResourceBudgetCheckpoint };

export interface StreamRecoveryBody {
  body: StreamEventBody;
  recovery: StreamRecoverySupplement;
}

/** One internal emission. Recovery data is carried beside, never inside, the public event. */
export type StampedStreamEmission =
  | StampedStreamEvent
  | (StampedStreamEvent & {
      event: StampedStreamEvent;
      recovery: StreamRecoverySupplement;
    });

/** Emit function used throughout the orchestrator and tool executor. */
export interface StreamEmit {
  (body: StreamEventBody): void;
  withRecovery(body: StreamEventBody, recovery: StreamRecoverySupplement): void;
  batch(build: (firstSeq: number) => readonly (StreamEventBody | StreamRecoveryBody)[]): void;
}

/** Outer stamped sink. Main supplies `batch` for atomic persistence. */
export type StampedStreamSink = ((event: StampedStreamEmission) => void) & {
  batch?: (events: readonly StampedStreamEmission[]) => void;
};

export type StreamRecoveryFactory = (body: StreamEventBody) => StreamRecoveryBody | undefined;

/** Emit recovery data through the same callable even for a legacy in-memory sink. */
export function emitWithRecovery(
  emit: StreamEmit,
  body: StreamEventBody,
  recovery: StreamRecoverySupplement,
): void {
  if (typeof emit.withRecovery === 'function') {
    emit.withRecovery(body, recovery);
    return;
  }
  const legacyEmit = emit as unknown as (
    input: StreamEventBody & StreamRecoveryBody
  ) => void;
  legacyEmit({ ...body, body, recovery } as unknown as StreamEventBody & StreamRecoveryBody);
}

/**
 * Build a stamped emit function that injects `runId`/`step`/`seq`/
 * `emittedAt` before forwarding to the outer emit. `getStep` is a closure
 * because `step` changes over the orchestrator loop; `seq` is owned by
 * this factory (monotonic per-run).
 */
export function makeStampedEmit(
  runId: string,
  getStep: () => number,
  outer: StampedStreamSink,
  initialSeq = 0,
  recoveryFor?: StreamRecoveryFactory,
): StreamEmit {
  let seq = initialSeq;
  const stamp = (body: StreamEventBody): StampedStreamEvent => ({
      ...body,
      runId,
      step: getStep(),
      seq: seq++,
      emittedAt: Date.now(),
    }) as StampedStreamEvent;
  const prepare = (
    input: StreamEventBody | StreamRecoveryBody,
  ): StampedStreamEmission => {
    const prepared = 'body' in input ? input : (recoveryFor?.(input) ?? input);
    if (!('body' in prepared)) return stamp(prepared);
    const event = stamp(prepared.body);
    return { ...event, event, recovery: prepared.recovery };
  };
  const emit = ((body: StreamEventBody) => {
    outer(prepare(body));
  }) as StreamEmit;
  emit.withRecovery = (body, recovery) => {
    outer(prepare({ body, recovery }));
  };
  emit.batch = (build) => {
    const bodies = build(seq);
    if (bodies.length === 0) return;
    const events = bodies.map(prepare);
    if (outer.batch) outer.batch(events);
    else events.forEach(outer);
  };
  return emit;
}
