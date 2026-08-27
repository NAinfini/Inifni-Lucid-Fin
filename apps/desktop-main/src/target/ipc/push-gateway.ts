import {
  RunEventCursorV1Schema,
  WirePushV1Schema,
  parseCanonical,
  type PublicRunEvent,
  type Run,
  type RunEventCursorV1,
  type WirePushV1,
} from '@lucid-fin/target-contracts';
import type { RunsAuthority } from '@lucid-fin/target-storage';

export interface TargetWirePushSink {
  send(push: WirePushV1): void;
}

export interface TargetRunEventPushGateway {
  publishPersisted(runId: string, cursor: RunEventCursorV1): WirePushV1;
}

export interface TargetRunEventPushGatewayOptions {
  readonly createRequestId: () => string;
}

export interface TargetPersistedRunEventPublisher {
  publishHead(run: Pick<Run, 'id' | 'publicEventHead'>): void;
}

export interface TargetPersistedRunEventPublisherOptions extends TargetRunEventPushGatewayOptions {
  readonly onError: (cause: unknown) => void;
}

function readOnePersistedPublicEvent(
  runs: Pick<RunsAuthority, 'listPublicEvents'>,
  runId: string,
  afterSequence: number | null,
  createRequestId: () => string,
): PublicRunEvent {
  const response = runs.listPublicEvents({
    wireVersion: 1,
    kind: 'request',
    requestId: createRequestId(),
    method: 'run.events.list',
    input: {
      runId,
      afterSequence,
      page: { cursor: null, limit: 1 },
    },
  });
  const event = response.result.items[0];
  if (
    response.result.items.length !== 1 ||
    event === undefined ||
    event.runId !== runId ||
    event.sequence <= (afterSequence ?? 0)
  ) {
    throw new Error('Run event push cursor does not identify one persisted public event');
  }
  return event;
}

function sendPersistedPublicEvent(
  sink: TargetWirePushSink,
  cursor: RunEventCursorV1,
  event: PublicRunEvent,
): WirePushV1 {
  const push = parseCanonical(WirePushV1Schema, {
    wireVersion: 1,
    kind: 'push',
    method: 'run.events.appended',
    payload: { cursor, event },
  }) as WirePushV1;
  sink.send(push);
  return push;
}

export function createTargetRunEventPushGateway(
  runs: Pick<RunsAuthority, 'listPublicEvents'>,
  sink: TargetWirePushSink,
  options: TargetRunEventPushGatewayOptions,
): TargetRunEventPushGateway {
  return Object.freeze({
    publishPersisted(runId: string, cursorValue: RunEventCursorV1): WirePushV1 {
      const cursor = parseCanonical(RunEventCursorV1Schema, cursorValue);
      const event = readOnePersistedPublicEvent(
        runs,
        runId,
        cursor.sequence === 1 ? null : cursor.sequence - 1,
        options.createRequestId,
      );
      if (event.sequence !== cursor.sequence || event.eventHash !== cursor.eventHash) {
        throw new Error('Run event push cursor does not identify one persisted public event');
      }
      return sendPersistedPublicEvent(sink, cursor, event);
    },
  });
}

export function createTargetPersistedRunEventPublisher(
  runs: Pick<RunsAuthority, 'listPublicEvents'>,
  sink: TargetWirePushSink,
  options: TargetPersistedRunEventPublisherOptions,
): TargetPersistedRunEventPublisher {
  const published = new Map<string, RunEventCursorV1>();
  return Object.freeze({
    publishHead(run: Pick<Run, 'id' | 'publicEventHead'>): void {
      const head = run.publicEventHead;
      if (head === null) return;
      try {
        let cursor = published.get(run.id);
        if (cursor !== undefined && cursor.sequence >= head.sequence) {
          if (cursor.sequence === head.sequence && cursor.eventHash !== head.hash) {
            throw new Error('Run event head conflicts with the published cursor');
          }
          return;
        }
        for (;;) {
          const event = readOnePersistedPublicEvent(
            runs,
            run.id,
            cursor?.sequence ?? null,
            options.createRequestId,
          );
          if (
            event.sequence > head.sequence ||
            (event.sequence === head.sequence && event.eventHash !== head.hash)
          ) {
            throw new Error('Run event head does not bound the persisted public event stream');
          }
          const next = parseCanonical(RunEventCursorV1Schema, {
            sequence: event.sequence,
            eventHash: event.eventHash,
          });
          sendPersistedPublicEvent(sink, next, event);
          published.set(run.id, next);
          if (next.sequence === head.sequence && next.eventHash === head.hash) return;
          cursor = next;
        }
      } catch (cause) {
        options.onError(cause);
      }
    },
  });
}
