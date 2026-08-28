import {
  CompactionCompletedSchema,
  CompactionInterruptedSchema,
  CompactionStartedSchema,
  CompactionViewDerivedSchema,
  PROVIDER_CONTINUATION_UNAVAILABLE,
  ProviderContinuationUnavailableSchema,
} from './run.js';
import { describe, expect, it } from 'vitest';

describe('I2-E5 provider continuation contract', () => {
  it('freezes only the exact unavailable marker and rejects invented continuation data', () => {
    expect(ProviderContinuationUnavailableSchema.parse(PROVIDER_CONTINUATION_UNAVAILABLE)).toEqual({
      state: 'unavailable',
      reason: 'not_persisted',
    });
    expect(() =>
      ProviderContinuationUnavailableSchema.parse({
        state: 'unavailable',
        reason: 'not_persisted',
        detail: 'unknown',
      }),
    ).toThrow();
    expect(() =>
      ProviderContinuationUnavailableSchema.parse({ state: 'unavailable', reason: '' }),
    ).toThrow();
    expect(() =>
      ProviderContinuationUnavailableSchema.parse({ state: 'available', token: 'fake-token' }),
    ).toThrow();
    expect(() =>
      ProviderContinuationUnavailableSchema.parse({
        state: 'unavailable',
        reason: 'not_persisted',
        token: 'fake-token',
      }),
    ).toThrow();
  });

  it('requires one opaque operation fingerprint on every Compaction stage', () => {
    const operationFingerprint = 'a'.repeat(64);
    const stages = [
      [
        CompactionStartedSchema,
        {
          type: 'compaction_started',
          transactionId: 'compaction.tx',
          activationNumber: 1,
          sourceEventFrom: 1,
          sourceEventTo: 2,
          originalTokenCount: 10,
          model: 'gpt-5.6',
          operationFingerprint,
        },
      ],
      [
        CompactionViewDerivedSchema,
        {
          type: 'compaction_view_derived',
          transactionId: 'compaction.tx',
          viewId: 'compaction.view',
          sourceEventFrom: 1,
          sourceEventTo: 2,
          derivedViewHash: 'b'.repeat(64),
          summary: 'Compact view.',
          citedEventSequences: [1],
          compactedTokenCount: 2,
          operationFingerprint,
        },
      ],
      [
        CompactionCompletedSchema,
        {
          type: 'compaction_completed',
          transactionId: 'compaction.tx',
          viewId: 'compaction.view',
          derivedViewHash: 'b'.repeat(64),
          operationFingerprint,
        },
      ],
      [
        CompactionInterruptedSchema,
        {
          type: 'compaction_interrupted',
          transactionId: 'compaction.tx',
          reason: 'process_restarted',
          operationFingerprint,
        },
      ],
    ] as const;

    for (const [schema, stage] of stages) {
      expect(schema.parse(stage)).toMatchObject({ operationFingerprint });
      const { operationFingerprint: _fingerprint, ...missing } = stage;
      expect(() => schema.parse(missing)).toThrow();
    }
  });

  it('requires canonical strictly increasing Compaction citations', () => {
    const view = {
      type: 'compaction_view_derived' as const,
      transactionId: 'compaction.tx',
      viewId: 'compaction.view',
      sourceEventFrom: 1,
      sourceEventTo: 3,
      derivedViewHash: 'b'.repeat(64),
      summary: 'Compact view.',
      citedEventSequences: [1, 2, 3],
      compactedTokenCount: 2,
      operationFingerprint: 'a'.repeat(64),
    };
    expect(CompactionViewDerivedSchema.parse(view).citedEventSequences).toEqual([1, 2, 3]);
    expect(() =>
      CompactionViewDerivedSchema.parse({ ...view, citedEventSequences: [2, 1] }),
    ).toThrow();
    expect(() =>
      CompactionViewDerivedSchema.parse({ ...view, citedEventSequences: [1, 1] }),
    ).toThrow();
  });
});
