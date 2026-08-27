import { describe, expect, it, vi } from 'vitest';
import type { PublicRunEvent, Run, WireSuccessV1 } from '@lucid-fin/target-contracts';
import {
  createTargetPersistedRunEventPublisher,
  createTargetRunEventPushGateway,
} from './push-gateway.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);

const event: PublicRunEvent = {
  visibility: 'public',
  eventId: 'event.push.1',
  eventVersion: 1,
  runId: 'run.push.1',
  sequence: 2,
  occurredAt: '2026-08-24T12:00:00.000Z',
  actor: 'commander',
  causation: { kind: 'run', runId: 'run.push.1' },
  correlationId: null,
  idempotencyKey: null,
  payloadHash: HASH_A,
  previousEventHash: HASH_B,
  eventHash: HASH_A,
  payloadState: {
    state: 'available',
    payload: { type: 'progress', summary: 'Persisted before broadcast' },
  },
};

function listResponse(
  items: PublicRunEvent[],
): Extract<WireSuccessV1, { method: 'run.events.list' }> {
  return {
    wireVersion: 1,
    kind: 'success',
    requestId: 'request.push.read.1',
    method: 'run.events.list',
    result: { items, nextCursor: null },
  };
}

function persistedEvent(runId: string, sequence: number, eventHash: string): PublicRunEvent {
  return {
    ...event,
    eventId: `event.${runId}.${sequence}`,
    runId,
    sequence,
    causation: { kind: 'run', runId },
    payloadHash: eventHash,
    eventHash,
    payloadState: {
      state: 'available',
      payload: { type: 'progress', summary: `Persisted event ${sequence}` },
    },
  };
}

function listPublicEventsFor(events: readonly PublicRunEvent[]) {
  return vi.fn((request) => {
    const afterSequence = request.input.afterSequence ?? 0;
    return listResponse(
      events
        .filter(
          (candidate) =>
            candidate.runId === request.input.runId && candidate.sequence > afterSequence,
        )
        .slice(0, request.input.page.limit),
    );
  });
}

describe('target Run event push gateway', () => {
  it('re-reads the exact persisted event before broadcasting it', () => {
    const order: string[] = [];
    const listPublicEvents = vi.fn((request) => {
      order.push('read');
      expect(request.input).toEqual({
        runId: event.runId,
        afterSequence: 1,
        page: { cursor: null, limit: 1 },
      });
      return listResponse([event]);
    });
    const send = vi.fn(() => order.push('send'));
    const gateway = createTargetRunEventPushGateway(
      { listPublicEvents },
      { send },
      { createRequestId: () => 'request.push.read.1' },
    );

    const push = gateway.publishPersisted(event.runId, {
      sequence: event.sequence,
      eventHash: event.eventHash,
    });
    expect(order).toEqual(['read', 'send']);
    expect(send).toHaveBeenCalledWith(push);
    expect(push.payload.event).toEqual(event);
  });

  it('does not broadcast a missing or hash-mismatched persisted event', () => {
    const send = vi.fn();
    const missing = createTargetRunEventPushGateway(
      { listPublicEvents: vi.fn(() => listResponse([])) },
      { send },
      { createRequestId: () => 'request.push.missing.1' },
    );
    expect(() =>
      missing.publishPersisted(event.runId, {
        sequence: event.sequence,
        eventHash: event.eventHash,
      }),
    ).toThrow(/persisted public event/);

    const mismatched = createTargetRunEventPushGateway(
      { listPublicEvents: vi.fn(() => listResponse([event])) },
      { send },
      { createRequestId: () => 'request.push.mismatch.1' },
    );
    expect(() =>
      mismatched.publishPersisted(event.runId, {
        sequence: event.sequence,
        eventHash: 'c'.repeat(64),
      }),
    ).toThrow(/persisted public event/);
    expect(send).not.toHaveBeenCalled();
  });

  it('pushes every missing public event through a batched Run head in persisted order', () => {
    const batch = [
      persistedEvent(event.runId, 1, HASH_A),
      persistedEvent(event.runId, 4, HASH_B),
      persistedEvent(event.runId, 7, HASH_C),
    ];
    const listPublicEvents = listPublicEventsFor(batch);
    const send = vi.fn();
    const onError = vi.fn();
    const publisher = createTargetPersistedRunEventPublisher(
      { listPublicEvents },
      { send },
      { createRequestId: () => 'request.push.publisher.batch', onError },
    );

    publisher.publishHead({
      id: event.runId,
      publicEventHead: { sequence: 7, hash: HASH_C },
    });

    expect(send.mock.calls.map(([push]) => push.payload.event)).toEqual(batch);
    expect(listPublicEvents.mock.calls.map(([request]) => request.input.afterSequence)).toEqual([
      null,
      1,
      4,
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not advance a Run cursor beyond a failed send', () => {
    const batch = [
      persistedEvent(event.runId, 1, HASH_A),
      persistedEvent(event.runId, 4, HASH_B),
      persistedEvent(event.runId, 7, HASH_C),
    ];
    const listPublicEvents = listPublicEventsFor(batch);
    let failed = false;
    const send = vi.fn((push) => {
      if (push.payload.event.sequence === 4 && !failed) {
        failed = true;
        throw new Error('renderer unavailable');
      }
    });
    const onError = vi.fn();
    const publisher = createTargetPersistedRunEventPublisher(
      { listPublicEvents },
      { send },
      { createRequestId: () => 'request.push.publisher.retry-batch', onError },
    );
    const run = {
      id: event.runId,
      publicEventHead: { sequence: 7, hash: HASH_C },
    } satisfies Pick<Run, 'id' | 'publicEventHead'>;

    publisher.publishHead(run);
    publisher.publishHead(run);

    expect(send.mock.calls.map(([push]) => push.payload.event.sequence)).toEqual([1, 4, 4, 7]);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('keeps independently published Run cursors isolated', () => {
    const otherRunId = 'run.push.other';
    const first = persistedEvent(event.runId, 1, HASH_A);
    const second = persistedEvent(otherRunId, 1, HASH_B);
    const listPublicEvents = listPublicEventsFor([first, second]);
    const send = vi.fn();
    const onError = vi.fn();
    const publisher = createTargetPersistedRunEventPublisher(
      { listPublicEvents },
      { send },
      { createRequestId: () => 'request.push.publisher.isolated', onError },
    );

    publisher.publishHead({
      id: event.runId,
      publicEventHead: { sequence: first.sequence, hash: first.eventHash },
    });
    publisher.publishHead({
      id: otherRunId,
      publicEventHead: { sequence: second.sequence, hash: second.eventHash },
    });
    publisher.publishHead({
      id: event.runId,
      publicEventHead: { sequence: first.sequence, hash: first.eventHash },
    });

    expect(send.mock.calls.map(([push]) => push.payload.event.runId)).toEqual([
      event.runId,
      otherRunId,
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it('deduplicates a published head and ignores Runs without a public head', () => {
    const listPublicEvents = vi.fn(() => listResponse([event]));
    const send = vi.fn();
    const onError = vi.fn();
    const publisher = createTargetPersistedRunEventPublisher(
      { listPublicEvents },
      { send },
      { createRequestId: () => 'request.push.publisher.1', onError },
    );

    publisher.publishHead({ id: event.runId, publicEventHead: null });
    const run = {
      id: event.runId,
      publicEventHead: { sequence: event.sequence, hash: event.eventHash },
    } satisfies Pick<Run, 'id' | 'publicEventHead'>;
    publisher.publishHead(run);
    publisher.publishHead(run);

    expect(listPublicEvents).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports a failed broadcast without marking the persisted head as published', () => {
    const listPublicEvents = vi.fn(() => listResponse([event]));
    const send = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error('renderer unavailable');
      })
      .mockImplementationOnce(() => undefined);
    const onError = vi.fn();
    const publisher = createTargetPersistedRunEventPublisher(
      { listPublicEvents },
      { send },
      { createRequestId: () => 'request.push.publisher.retry', onError },
    );
    const run = {
      id: event.runId,
      publicEventHead: { sequence: event.sequence, hash: event.eventHash },
    } satisfies Pick<Run, 'id' | 'publicEventHead'>;

    publisher.publishHead(run);
    publisher.publishHead(run);

    expect(onError).toHaveBeenCalledOnce();
    expect(listPublicEvents).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
