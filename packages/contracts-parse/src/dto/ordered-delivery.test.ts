import { describe, expect, it } from 'vitest';
import { OrderedDeliverySequenceSchema } from './ordered-delivery.js';

const HASH = 'a'.repeat(64);

function sequence() {
  return {
    revision: 1,
    items: [
      {
        shotId: 'shot-1',
        selectedVideoHash: HASH,
        trimInMs: 250,
        trimOutMs: 2_000,
        embeddedAudioEnabled: true,
      },
    ],
    updatedAt: 10,
  };
}

describe('OrderedDeliverySequenceSchema', () => {
  it('accepts only the canonical ordered-delivery facts', () => {
    expect(OrderedDeliverySequenceSchema.parse(sequence())).toEqual(sequence());
  });

  it.each([
    ['empty shot id', (value: ReturnType<typeof sequence>) => (value.items[0].shotId = ' ')],
    [
      'invalid hash',
      (value: ReturnType<typeof sequence>) => (value.items[0].selectedVideoHash = 'x'),
    ],
    ['empty trim', (value: ReturnType<typeof sequence>) => (value.items[0].trimOutMs = 250)],
    ['fractional trim', (value: ReturnType<typeof sequence>) => (value.items[0].trimInMs = 0.5)],
  ])('rejects %s', (_name, mutate) => {
    const value = sequence();
    mutate(value);
    expect(OrderedDeliverySequenceSchema.safeParse(value).success).toBe(false);
  });

  it('rejects duplicate shot identities and timeline-shaped fields', () => {
    const duplicate = sequence();
    duplicate.items.push({ ...duplicate.items[0] });
    expect(OrderedDeliverySequenceSchema.safeParse(duplicate).success).toBe(false);
    expect(
      OrderedDeliverySequenceSchema.safeParse({ ...sequence(), videoTrack: { clips: [] } }).success,
    ).toBe(false);
  });
});
