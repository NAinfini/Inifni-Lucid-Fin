import { describe, expect, it } from 'vitest';
import {
  GenerationAttemptViewSchema,
  GenerationOutputIntentSchema,
  GenerationSubmitInputSchema,
  ResultAssessmentAttemptViewSchema,
  generationPromptAssemblyHashInput,
} from './generation.js';
import { MediaDerivationAttemptViewSchema } from './media.js';
import {
  AttemptCommonSchema,
  ProviderReceiptSchema,
  assertAttemptCommonTransition,
} from './operation.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-16T12:00:00.000Z';
const LATER = '2026-08-16T12:01:00.000Z';

function generationSpec(outputCount = 2) {
  return {
    kind: 'video' as const,
    task: 'create' as const,
    target: {
      authority: 'production' as const,
      id: 'shot.1',
      revision: 2,
      contentHash: HASH_A,
    },
    prompt: 'Slow dolly across a moonlit harbor.',
    negativePrompt: 'No text overlays.',
    references: [
      {
        source: { kind: 'project_media_ref' as const, id: 'media.1' },
        expectedContentHash: HASH_B,
        role: 'style_reference' as const,
        influence: 0.75,
      },
    ],
    provider: { providerId: 'provider.1', model: 'video-model' },
    outputCount,
    seed: 42,
    width: 1_920,
    height: 1_080,
    durationMs: 5_000,
    frameRate: 24,
    includeAudio: false,
  };
}

function outputIntent(variantIndex: number) {
  return {
    variantIndex,
    globalAsset: {
      filename: `harbor-${variantIndex}.mp4`,
      displayName: `Harbor ${variantIndex + 1}`,
      folderId: null,
      tags: ['generated', 'harbor'],
    },
    projectMediaRef: {
      label: `Harbor candidate ${variantIndex + 1}`,
      collections: ['Generated candidates'],
      roles: ['generated_candidate' as const, 'reference' as const],
      notes: 'Generated for shot.1.',
    },
  };
}

function promptProvenance() {
  return {
    sourceObjectId: 'shot.1',
    sourceRevision: 2,
    sourceHash: HASH_A,
    assemblyHash: HASH_C,
    loadedSkillDigests: [HASH_A, HASH_B],
  };
}

function submitInput() {
  return {
    spec: generationSpec(),
    quote: null,
    expectedProjectRevision: 4,
    promptProvenance: promptProvenance(),
    outputIntents: [outputIntent(0), outputIntent(1)],
  };
}

function commonAttempt(state: 'unknown' | 'submitted' | 'succeeded' | 'failed' | 'cancelled') {
  return {
    revision: 0,
    contentHash: HASH_A,
    state,
    provider: { providerId: 'provider.1', model: 'video-model', reasoningStrength: null },
    receipt: null,
    usage: null,
    cancelRequested: false,
    progressPercent: null,
    publicErrorCode:
      state === 'unknown'
        ? ('provider_state_unknown' as const)
        : state === 'failed'
          ? ('provider_failed' as const)
          : state === 'cancelled'
            ? ('cancelled' as const)
            : null,
    createdAt: NOW,
    finishedAt: state === 'succeeded' || state === 'failed' || state === 'cancelled' ? LATER : null,
  };
}

function reconciledReceipt(hash = HASH_B) {
  return ProviderReceiptSchema.parse({
    providerOperationId: 'provider-operation.1',
    submittedAt: NOW,
    reconciledAt: LATER,
    receiptHash: hash,
  });
}

describe('I2-F4 generation trust-boundary contracts', () => {
  it('freezes one strict attached output intent per contiguous generation variant', () => {
    const valid = submitInput();
    expect(GenerationSubmitInputSchema.parse(valid)).toEqual(valid);
    expect(GenerationOutputIntentSchema.parse(valid.outputIntents[0])).toEqual(
      valid.outputIntents[0],
    );

    expect(
      GenerationSubmitInputSchema.safeParse({
        ...valid,
        outputIntents: [outputIntent(0)],
      }).success,
    ).toBe(false);
    expect(
      GenerationSubmitInputSchema.safeParse({
        ...valid,
        outputIntents: [outputIntent(0), outputIntent(2)],
      }).success,
    ).toBe(false);
    expect(
      GenerationOutputIntentSchema.safeParse({
        ...outputIntent(0),
        globalAsset: { ...outputIntent(0).globalAsset, filename: 'generated/harbor.mp4' },
      }).success,
    ).toBe(false);
    expect(
      GenerationOutputIntentSchema.safeParse({
        ...outputIntent(0),
        globalAsset: { ...outputIntent(0).globalAsset, tags: ['generated', 'generated'] },
      }).success,
    ).toBe(false);
    expect(
      GenerationOutputIntentSchema.safeParse({
        ...outputIntent(0),
        projectMediaRef: {
          ...outputIntent(0).projectMediaRef,
          roles: ['reference'],
        },
      }).success,
    ).toBe(false);
    expect(
      GenerationOutputIntentSchema.safeParse({
        ...outputIntent(0),
        projectMediaRef: {
          ...outputIntent(0).projectMediaRef,
          productionLinks: [],
        },
      }).success,
    ).toBe(false);
  });

  it('binds Prompt provenance to the exact target and sorted unique skill digests', () => {
    const valid = submitInput();
    for (const promptProvenance of [
      { ...valid.promptProvenance, sourceObjectId: 'shot.2' },
      { ...valid.promptProvenance, sourceRevision: 1 },
      { ...valid.promptProvenance, sourceHash: HASH_B },
      { ...valid.promptProvenance, loadedSkillDigests: [HASH_B, HASH_A] },
      { ...valid.promptProvenance, loadedSkillDigests: [HASH_A, HASH_A] },
    ]) {
      expect(GenerationSubmitInputSchema.safeParse({ ...valid, promptProvenance }).success).toBe(
        false,
      );
    }
  });

  it('defines the exact canonical Prompt assembly preimage and nothing else', () => {
    const spec = generationSpec();
    expect(
      generationPromptAssemblyHashInput({
        target: spec.target,
        prompt: spec.prompt,
        negativePrompt: spec.negativePrompt,
        references: spec.references,
        loadedSkillDigests: [HASH_A, HASH_B],
      }),
    ).toEqual({
      target: spec.target,
      prompt: spec.prompt,
      negativePrompt: spec.negativePrompt,
      references: spec.references,
      loadedSkillDigests: [HASH_A, HASH_B],
    });
  });
});

describe('I2-F4 receipt-less provider unknown contracts', () => {
  it('allows receipt-less unknown across the three provider-backed owners', () => {
    const unknown = commonAttempt('unknown');
    expect(AttemptCommonSchema.safeParse(unknown).success).toBe(true);
    expect(AttemptCommonSchema.safeParse({ ...unknown, provider: null }).success).toBe(false);
    expect(AttemptCommonSchema.safeParse(commonAttempt('submitted')).success).toBe(false);

    const spec = generationSpec(1);
    const generation = {
      ...unknown,
      authority: 'generation_attempt' as const,
      id: 'attempt.generation.1',
      requestId: 'request.1',
      attemptNumber: 1,
      quote: null,
      promptProvenance: promptProvenance(),
      request: {
        id: 'request.1',
        projectId: 'project.1',
        runId: 'run.1',
        spec,
        requestHash: HASH_B,
        idempotencyKey: HASH_C,
        createdAt: NOW,
      },
    };
    const media = {
      ...unknown,
      authority: 'media_derivation_attempt' as const,
      id: 'attempt.media.1',
      attemptNumber: 1,
      derivation: {
        authority: 'media_derivation' as const,
        id: 'derivation.1',
        projectId: 'project.1',
        runId: 'run.1',
        sourceBlobHash: HASH_A,
        transform: { operation: 'transcribe' as const, language: null, provider: null },
        requestHash: HASH_B,
        idempotencyKey: HASH_C,
        createdAt: NOW,
      },
    };
    const assessment = {
      ...unknown,
      authority: 'result_assessment_attempt' as const,
      id: 'attempt.assessment.1',
      projectId: 'project.1',
      runId: 'run.1',
      request: {
        kind: 'coverage' as const,
        subjects: [
          {
            authority: 'generated_result' as const,
            id: 'result.1',
            revision: 0,
            contentHash: HASH_A,
          },
        ],
        requirements: ['Opening shot exists'],
        provider: null,
      },
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      assessment: null,
    };

    expect(GenerationAttemptViewSchema.safeParse(generation).success).toBe(true);
    expect(MediaDerivationAttemptViewSchema.safeParse(media).success).toBe(true);
    expect(ResultAssessmentAttemptViewSchema.safeParse(assessment).success).toBe(true);
  });

  it('exits unknown only after reconciliation, with or without a discovered receipt', () => {
    const unknown = commonAttempt('unknown');
    const failed = { ...commonAttempt('failed'), revision: 1 };
    expect(() => assertAttemptCommonTransition(unknown, failed, false)).toThrow();
    expect(() => assertAttemptCommonTransition(unknown, failed, true)).not.toThrow();
    expect(() =>
      assertAttemptCommonTransition(unknown, { ...commonAttempt('cancelled'), revision: 1 }, true),
    ).not.toThrow();
    expect(() =>
      assertAttemptCommonTransition(unknown, { ...commonAttempt('submitted'), revision: 1 }, true),
    ).toThrow();
    expect(() =>
      assertAttemptCommonTransition(
        unknown,
        { ...commonAttempt('submitted'), revision: 1, receipt: reconciledReceipt() },
        true,
      ),
    ).not.toThrow();

    const originalReceipt = { ...reconciledReceipt(), reconciledAt: null };
    const unknownWithReceipt = { ...unknown, receipt: originalReceipt };
    expect(() =>
      assertAttemptCommonTransition(
        unknownWithReceipt,
        { ...failed, receipt: reconciledReceipt(originalReceipt.receiptHash) },
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertAttemptCommonTransition(
        unknownWithReceipt,
        { ...failed, receipt: reconciledReceipt(HASH_C) },
        true,
      ),
    ).toThrow();
  });
});
