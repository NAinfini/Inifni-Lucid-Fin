import {
  RunEventCursorV1Schema,
  WirePushV1Schema,
  parseCanonical,
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

export function createTargetRunEventPushGateway(
  runs: Pick<RunsAuthority, 'listPublicEvents'>,
  sink: TargetWirePushSink,
  options: TargetRunEventPushGatewayOptions,
): TargetRunEventPushGateway {
  return Object.freeze({
    publishPersisted(runId: string, cursorValue: RunEventCursorV1): WirePushV1 {
      const cursor = parseCanonical(RunEventCursorV1Schema, cursorValue);
      const response = runs.listPublicEvents({
        wireVersion: 1,
        kind: 'request',
        requestId: options.createRequestId(),
        method: 'run.events.list',
        input: {
          runId,
          afterSequence: cursor.sequence === 1 ? null : cursor.sequence - 1,
          page: { cursor: null, limit: 1 },
        },
      });
      const event = response.result.items[0];
      if (
        response.result.items.length !== 1 ||
        event === undefined ||
        event.runId !== runId ||
        event.sequence !== cursor.sequence ||
        event.eventHash !== cursor.eventHash
      ) {
        throw new Error('Run event push cursor does not identify one persisted public event');
      }
      const push = parseCanonical(WirePushV1Schema, {
        wireVersion: 1,
        kind: 'push',
        method: 'run.events.appended',
        payload: { cursor, event },
      }) as WirePushV1;
      sink.send(push);
      return push;
    },
  });
}

export function createTargetPersistedRunEventPublisher(
  runs: Pick<RunsAuthority, 'listPublicEvents'>,
  sink: TargetWirePushSink,
  options: TargetPersistedRunEventPublisherOptions,
): TargetPersistedRunEventPublisher {
  const gateway = createTargetRunEventPushGateway(runs, sink, options);
  const published = new Map<string, Run['publicEventHead']>();
  return Object.freeze({
    publishHead(run: Pick<Run, 'id' | 'publicEventHead'>): void {
      const head = run.publicEventHead;
      const previous = published.get(run.id);
      if (
        head === null ||
        (previous !== null &&
          previous !== undefined &&
          previous.sequence === head.sequence &&
          previous.hash === head.hash)
      ) {
        return;
      }
      try {
        gateway.publishPersisted(run.id, { sequence: head.sequence, eventHash: head.hash });
        published.set(run.id, head);
      } catch (cause) {
        options.onError(cause);
      }
    },
  });
}
