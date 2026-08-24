import { describe, expect, it, vi } from 'vitest';
import type { OrderedDeliverySequence } from '@lucid-fin/contracts';
import { DeliveryPersistenceController } from './delivery-persistence.js';

const hash = 'a'.repeat(64);

function sequence(revision: number, shotId = 'shot'): OrderedDeliverySequence {
  return {
    revision,
    updatedAt: 1,
    items: [{ shotId, selectedVideoHash: hash, trimInMs: 0, trimOutMs: 1_000, embeddedAudioEnabled: false }],
  };
}

describe('DeliveryPersistenceController', () => {
  it('coalesces drafts and uses adjacent CAS revisions', async () => {
    vi.useFakeTimers();
    const requests: Array<{ expectedRevision: number; deliverySequence: OrderedDeliverySequence }> = [];
    const persisted: OrderedDeliverySequence[] = [];
    const controller = new DeliveryPersistenceController({
      canvasId: 'canvas',
      persistedRevision: 4,
      debounceMs: 10,
      transport: {
        update: async (request) => {
          requests.push(request);
          return { deliverySequence: request.deliverySequence };
        },
      },
      onPersisted: (value) => persisted.push(value),
      onFailure: () => {},
    });

    controller.queue(sequence(4, 'first'));
    controller.queue(sequence(4, 'latest'));
    await vi.advanceTimersByTimeAsync(10);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      expectedRevision: 4,
      deliverySequence: { revision: 5, items: [{ shotId: 'latest' }] },
    });
    expect(persisted[0]!.revision).toBe(5);
    vi.useRealTimers();
  });
});
