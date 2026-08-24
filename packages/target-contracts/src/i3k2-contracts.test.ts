import { describe, expect, it } from 'vitest';
import {
  BlockerRunEventPayloadSchema,
  ContextManifestSchema,
  ModelAdapterEventSchema,
  RunAcceptedSourceSchema,
  RunSchema,
  assertAttemptStateTransition,
  assertRunContextManifest,
  crashRetrySeedHashInput,
} from './index.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';
const budget = {
  costUsd: { state: 'known' as const, value: '10', currency: 'USD' },
  maxGenerationCount: 5,
  maxInputTokens: 10_000,
  maxOutputTokens: 2_000,
};
const model = { providerId: 'provider.1', model: 'model.1', reasoningStrength: null };
const acceptedSource = {
  kind: 'message' as const,
  messageId: 'message.1',
  contentHash: HASH_A,
};

function rootRun(id: string, retryOfRunId: string | null, retrySeedHash: string | null) {
  return {
    authority: 'run' as const,
    id,
    revision: 0,
    contentHash: HASH_A,
    rootRunId: id,
    parentRunId: null,
    retryOfRunId,
    retrySeedHash,
    projectId: 'project.1',
    chatId: 'chat.1',
    status: 'accepted' as const,
    model,
    permissionMode: 'reversible' as const,
    budget,
    contextManifestId: `manifest.${id}`,
    contextManifestHash: HASH_B,
    capabilityCatalogSnapshotId: 'catalog.1',
    capabilityCatalogHash: HASH_A,
    publicEventHead: null,
    privateRecoveryHead: null,
    acceptedSource,
    acceptedAt: NOW,
    terminalOutcome: null,
  };
}

function rootManifest(runId: string, retryOfRunId: string | null, retrySeedHash: string | null) {
  return {
    authority: 'context_manifest' as const,
    id: `manifest.${runId}`,
    runId,
    retryOfRunId,
    retrySeedHash,
    projectId: 'project.1',
    projectRevision: 2,
    projectSettings: {
      authority: 'project_settings' as const,
      projectId: 'project.1',
      revision: 3,
      contentHash: HASH_B,
      defaultProviderProfileId: 'provider.1',
      formatPolicy: { aspectRatio: '16:9' as const, customDimensions: null, frameRate: 24 },
      permission: 'reversible' as const,
      budget,
      enabledSkills: [],
      updatedAt: NOW,
    },
    chatId: 'chat.1',
    acceptedSource,
    locale: 'en-US',
    timeZone: 'America/New_York',
    selectedContext: [],
    projectMedia: [],
    attachments: [],
    historyWatermark: 0,
    memory: { state: 'unavailable' as const, reason: 'not_built' as const },
    model,
    permissionMode: 'reversible' as const,
    budget,
    capabilityCatalogSnapshotId: 'catalog.1',
    capabilityCatalogHash: HASH_A,
    capabilityIndex: [],
    capabilityIndexDigest: HASH_B,
    skillCatalogDigest: HASH_A,
    createdAt: NOW,
  };
}

describe('I3-K2 crash retry lineage contracts', () => {
  it('requires paired non-self lineage only on retry roots', () => {
    expect(RunSchema.parse(rootRun('run.initial', null, null))).toMatchObject({
      retryOfRunId: null,
      retrySeedHash: null,
    });
    expect(RunSchema.parse(rootRun('run.retry', 'run.initial', HASH_B))).toMatchObject({
      retryOfRunId: 'run.initial',
      retrySeedHash: HASH_B,
    });
    expect(() => RunSchema.parse(rootRun('run.retry', 'run.initial', null))).toThrow();
    expect(() => RunSchema.parse(rootRun('run.retry', null, HASH_B))).toThrow();
    expect(() => RunSchema.parse(rootRun('run.retry', 'run.retry', HASH_B))).toThrow();

    const child = {
      ...rootRun('run.child', null, null),
      rootRunId: 'run.initial',
      parentRunId: 'run.initial',
      acceptedSource: {
        kind: 'parent_direction' as const,
        parentRunId: 'run.initial',
        parentEventId: 'event.delegate',
        directionHash: HASH_B,
      },
      displayName: 'Child',
      publicSummary: 'Delegated child work.',
    };
    expect(() => RunSchema.parse(child)).not.toThrow();
    expect(() =>
      RunSchema.parse({ ...child, retryOfRunId: 'run.source', retrySeedHash: HASH_B }),
    ).toThrow();
    expect(
      RunAcceptedSourceSchema.safeParse({
        kind: 'crash_retry',
        sourceRunId: 'run.initial',
        sourceRunContentHash: HASH_A,
      }).success,
    ).toBe(false);
  });

  it('freezes the same retry lineage in the ContextManifest', () => {
    const run = RunSchema.parse(rootRun('run.retry', 'run.initial', HASH_B));
    const manifest = ContextManifestSchema.parse(rootManifest('run.retry', 'run.initial', HASH_B));
    expect(() => assertRunContextManifest(run, manifest)).not.toThrow();
    expect(() =>
      assertRunContextManifest(run, { ...manifest, retryOfRunId: 'run.other' }),
    ).toThrow();
    expect(() => assertRunContextManifest(run, { ...manifest, retrySeedHash: HASH_A })).toThrow();
    expect(() =>
      ContextManifestSchema.parse(rootManifest('run.retry', 'run.initial', null)),
    ).toThrow();
    expect(() =>
      ContextManifestSchema.parse(rootManifest('run.retry', 'run.retry', HASH_B)),
    ).toThrow();

    const child = {
      ...rootManifest('run.child', null, null),
      acceptedSource: {
        kind: 'parent_direction' as const,
        parentRunId: 'run.initial',
        parentEventId: 'event.delegate',
        directionHash: HASH_B,
      },
    };
    expect(() => ContextManifestSchema.parse(child)).not.toThrow();
    expect(() =>
      ContextManifestSchema.parse({
        ...child,
        retryOfRunId: 'run.initial',
        retrySeedHash: HASH_B,
      }),
    ).toThrow();
  });

  it('builds one strict canonical crash retry seed preimage without hashing', () => {
    expect(
      crashRetrySeedHashInput({
        sourceRunId: 'run.initial',
        sourceRunContentHash: HASH_A,
      }),
    ).toEqual({
      version: 1,
      kind: 'crash_retry',
      sourceRunId: 'run.initial',
      sourceRunContentHash: HASH_A,
    });
    expect(() =>
      crashRetrySeedHashInput({
        sourceRunId: 'run.initial',
        sourceRunContentHash: HASH_A,
        continuation: 'private',
      }),
    ).toThrow();
  });

  it('types interrupted recovery without adding blind retry transitions', () => {
    expect(
      BlockerRunEventPayloadSchema.parse({
        type: 'blocker',
        code: 'recovery_required',
        message: 'The interrupted Run requires an explicit related retry Run.',
      }).code,
    ).toBe('recovery_required');
    expect(
      ModelAdapterEventSchema.parse({
        type: 'model_failed',
        typedCode: 'process_interrupted',
        retrySafety: 'never',
        providerState: 'unknown',
      }),
    ).toMatchObject({ typedCode: 'process_interrupted' });
    expect(() => assertAttemptStateTransition('prepared', 'failed', false)).not.toThrow();
    expect(() => assertAttemptStateTransition('prepared', 'succeeded', false)).toThrow();
  });
});
