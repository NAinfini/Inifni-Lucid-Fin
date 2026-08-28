import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalJson } from './canonical.js';
import {
  EvaluationInputSchema,
  EvaluationKindSchema,
  GenerationAttemptViewSchema,
  GenerationQuoteSchema,
  GenerationRequestSchema,
  GenerationSubmitInputSchema,
  ResultAssessmentAttemptViewSchema,
  generationQuoteHashInput,
  generationRequestHashInput,
} from './generation.js';
import {
  MediaDerivationAttemptViewSchema,
  MediaDerivationOutputSchema,
  MediaDerivationSchema,
  MediaDeriveInputSchema,
  MediaDeriveOutputIntentSchema,
  mediaDerivationRequestHashInput,
} from './media.js';
import { DeliveryExportSchema, ReviewCutAttemptSchema } from './delivery.js';
import {
  AttemptCommonSchema,
  OperationCancelInputSchema,
  OperationCancelOutputSchema,
  OperationGetInputSchema,
  OperationGetOutputSchema,
  OperationPublicErrorCodeSchema,
  OperationRefSchema,
  ProviderReceiptSchema,
  providerReceiptHashInput,
} from './operation.js';
import { OperationStateChangedRunEventPayloadSchema } from './run.js';
import { OperationCancelDefinition, OperationGetDefinition } from './tools/delivery-tools.js';
import { MediaDeriveDefinition } from './tools/domain-tools.js';
import { EvaluationRunDefinition } from './tools/generation-tools.js';
import { PUBLIC_WIRE_METHODS_V1 } from './wire.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const NOW = '2026-08-15T12:00:00.000Z';

function hash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function generationSpec() {
  return {
    kind: 'image' as const,
    task: 'create' as const,
    target: { authority: 'production' as const, id: 'shot.1', revision: 2, contentHash: HASH_A },
    prompt: 'Moonlit harbor',
    negativePrompt: null,
    references: [],
    provider: { providerId: 'provider.1', model: 'image-model' },
    outputCount: 1,
    seed: 42,
    width: 1_920,
    height: 1_080,
    guidanceScale: null,
    sourceMaskRefId: null,
  };
}

function generationRequest() {
  const spec = generationSpec();
  return {
    id: 'request.1',
    projectId: 'project.1',
    runId: 'run.1',
    spec,
    requestHash: hash(generationRequestHashInput(spec)),
    idempotencyKey: HASH_B,
    createdAt: NOW,
  };
}

function deriveOutputIntent(ordinal: number, attached: boolean) {
  return {
    ordinal,
    globalAsset: {
      filename: `frame-${ordinal}.png`,
      displayName: `Frame ${ordinal}`,
      folderId: null,
      tags: ['frame'],
    },
    projectMediaRef: attached
      ? {
          label: `Frame ${ordinal}`,
          collections: ['Frames'],
          roles: ['reference' as const],
          notes: 'Derived frame.',
        }
      : null,
  };
}

function resizeDeriveInput(attached: boolean) {
  return {
    operation: 'resize' as const,
    source: { kind: 'project_media_ref' as const, id: 'media.1' },
    expectedSourceHash: HASH_A,
    attach: { enabled: attached, expectedProjectRevision: attached ? 4 : null },
    outputIntents: [deriveOutputIntent(0, attached)],
    width: 1_920,
    height: 1_080,
    fit: 'contain' as const,
  };
}

describe('I2-F0 shared operation contracts', () => {
  it('uses the same operation schemas for tools and public Wire', () => {
    expect(OperationGetDefinition.inputSchema).toBe(OperationGetInputSchema);
    expect(OperationGetDefinition.successSchema).toBe(OperationGetOutputSchema);
    expect(OperationCancelDefinition.inputSchema).toBe(OperationCancelInputSchema);
    expect(OperationCancelDefinition.successSchema).toBe(OperationCancelOutputSchema);
    expect(PUBLIC_WIRE_METHODS_V1['operation.get'].inputSchema).toBe(OperationGetInputSchema);
    expect(PUBLIC_WIRE_METHODS_V1['operation.get'].outputSchema).toBe(OperationGetOutputSchema);
    expect(PUBLIC_WIRE_METHODS_V1['operation.cancel'].inputSchema).toBe(OperationCancelInputSchema);
    expect(PUBLIC_WIRE_METHODS_V1['operation.cancel'].outputSchema).toBe(
      OperationCancelOutputSchema,
    );
    expect(
      OperationGetOutputSchema.safeParse({
        operations: [
          {
            ref: {
              id: 'operation.1',
              revision: 0,
              kind: 'generation_attempt',
              ownerRef: {
                authority: 'generation_attempt',
                id: 'attempt.1',
                revision: 0,
                contentHash: HASH_A,
              },
            },
            state: 'prepared',
            cancelRequested: false,
            progressPercent: null,
            usage: null,
            publicErrorCode: null,
            resultRefs: [],
            artifacts: [],
          },
        ],
      }).success,
    ).toBe(true);
    expect(OperationGetOutputSchema.safeParse([]).success).toBe(false);
  });

  it('binds refs to the exact owner revision and rejects terminal cancellation', () => {
    const ref = {
      id: 'operation.1',
      revision: 2,
      kind: 'generation_attempt' as const,
      ownerRef: {
        authority: 'generation_attempt' as const,
        id: 'attempt.1',
        revision: 2,
        contentHash: HASH_A,
      },
    };
    expect(OperationRefSchema.parse(ref)).toEqual(ref);
    expect(
      OperationRefSchema.safeParse({ ...ref, ownerRef: { ...ref.ownerRef, revision: 1 } }).success,
    ).toBe(false);
    expect(
      OperationCancelInputSchema.safeParse({
        operations: [{ ref, expectedRevision: 1, expectedState: 'running' }],
      }).success,
    ).toBe(false);
    expect(
      OperationCancelInputSchema.safeParse({
        operations: [{ ref, expectedRevision: 2, expectedState: 'succeeded' }],
      }).success,
    ).toBe(false);
  });

  it('freezes receipt hashing and common attempt invariants', () => {
    const receiptWithoutHash = {
      providerOperationId: 'provider-operation.1',
      submittedAt: NOW,
    };
    const receipt = {
      ...receiptWithoutHash,
      reconciledAt: null,
      receiptHash: hash(receiptWithoutHash),
    };
    expect(providerReceiptHashInput(ProviderReceiptSchema.parse(receipt))).toEqual(
      receiptWithoutHash,
    );
    const common = {
      revision: 0,
      contentHash: HASH_A,
      state: 'unknown' as const,
      provider: { providerId: 'provider.1', model: 'model.1', reasoningStrength: null },
      receipt,
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: 'provider_state_unknown' as const,
      createdAt: NOW,
      finishedAt: null,
    };
    expect(AttemptCommonSchema.parse(common)).toEqual(common);
    expect(AttemptCommonSchema.safeParse({ ...common, receipt: null }).success).toBe(true);
    expect(
      AttemptCommonSchema.safeParse({
        ...common,
        state: 'cancelled',
        publicErrorCode: 'cancelled',
        finishedAt: null,
      }).success,
    ).toBe(false);
  });
});

describe('I2-F0 generation, media, and evaluation contracts', () => {
  it('has one quote shape and reconstructs one generation request from its spec', () => {
    const knownQuoteWithoutHash = {
      state: 'known' as const,
      quoteId: 'quote.1',
      quotedRequestHash: HASH_C,
      amount: '0.2',
      currency: 'USD',
      expiresAt: NOW,
      providerId: 'provider.1',
      model: 'image-model',
    };
    const knownQuote = {
      ...knownQuoteWithoutHash,
      quoteHash: hash(knownQuoteWithoutHash),
    };
    expect(generationQuoteHashInput(GenerationQuoteSchema.parse(knownQuote))).toEqual(
      knownQuoteWithoutHash,
    );
    expect(
      GenerationQuoteSchema.safeParse({
        state: 'unknown',
        quoteId: 'quote.2',
        quotedRequestHash: HASH_C,
        amount: '0.2',
        currency: 'USD',
        expiresAt: NOW,
        providerId: 'provider.1',
        model: 'image-model',
        quoteHash: HASH_A,
      }).success,
    ).toBe(false);

    const request = generationRequest();
    expect(GenerationRequestSchema.parse(request)).toEqual(request);
    expect(
      GenerationRequestSchema.safeParse({
        ...request,
        target: request.spec.target,
      }).success,
    ).toBe(false);
    expect(
      GenerationSubmitInputSchema.safeParse({
        spec: generationSpec(),
        quote: {
          ...knownQuote,
          providerId: 'provider.2',
        },
        expectedProjectRevision: 4,
        promptProvenance: {
          sourceObjectId: 'shot.1',
          sourceRevision: 2,
          sourceHash: HASH_A,
          assemblyHash: HASH_B,
          loadedSkillDigests: [],
        },
        outputIntents: [
          {
            variantIndex: 0,
            globalAsset: {
              filename: 'moonlit-harbor.png',
              displayName: 'Moonlit Harbor',
              folderId: null,
              tags: ['generated'],
            },
            projectMediaRef: {
              label: 'Moonlit Harbor candidate',
              collections: ['Generated candidates'],
              roles: ['generated_candidate'],
              notes: '',
            },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('freezes exactly five evaluations and keeps final choice outside assessment', () => {
    expect(EvaluationKindSchema.options).toEqual([
      'technical_integrity',
      'reference_similarity',
      'continuity',
      'coverage',
      'delivery_readiness',
    ]);
    expect(EvaluationRunDefinition.inputSchema).toBe(EvaluationInputSchema);
    expect(
      EvaluationInputSchema.safeParse({
        kind: 'technical_integrity',
        subjects: [
          { authority: 'generated_result', id: 'result.1', revision: 0, contentHash: HASH_A },
        ],
        checks: ['readable'],
        provider: { providerId: 'provider.1', model: 'vision-model' },
      }).success,
    ).toBe(false);
    expect(
      ResultAssessmentAttemptViewSchema.safeParse({
        authority: 'result_assessment_attempt',
        id: 'assessment.1',
        projectId: 'project.1',
        runId: 'run.1',
        revision: 0,
        contentHash: HASH_A,
        state: 'prepared',
        provider: null,
        receipt: null,
        usage: null,
        cancelRequested: false,
        progressPercent: null,
        publicErrorCode: null,
        createdAt: NOW,
        finishedAt: null,
        request: {
          kind: 'technical_integrity',
          subjects: [
            { authority: 'generated_result', id: 'result.1', revision: 0, contentHash: HASH_A },
          ],
          checks: ['readable'],
          provider: null,
        },
        requestHash: HASH_B,
        idempotencyKey: HASH_C,
        assessment: null,
        userChoice: { decision: 'selected' },
      }).success,
    ).toBe(false);
  });

  it('separates derivation byte identity from optional Project attachment', () => {
    expect(
      MediaDeriveInputSchema.safeParse({
        operation: 'resize',
        source: { kind: 'project_media_ref', id: 'media.1' },
        expectedSourceHash: HASH_A,
        attach: { enabled: false, expectedProjectRevision: 1 },
        width: 1_920,
        height: 1_080,
        fit: 'contain',
      }).success,
    ).toBe(false);
    const derivation = {
      authority: 'media_derivation' as const,
      id: 'derivation.1',
      projectId: 'project.1',
      runId: 'run.1',
      sourceBlobHash: HASH_A,
      transform: {
        operation: 'resize' as const,
        width: 1_920,
        height: 1_080,
        fit: 'contain' as const,
      },
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      createdAt: NOW,
    };
    expect(mediaDerivationRequestHashInput(MediaDerivationSchema.parse(derivation))).toEqual({
      sourceBlobHash: HASH_A,
      transform: derivation.transform,
    });
    expect(
      MediaDerivationOutputSchema.parse({
        id: 'output.1',
        derivationAttemptId: 'attempt.1',
        blobHash: HASH_A,
        globalAssetId: 'asset.1',
        projectMediaRefId: null,
        ordinal: 0,
      }).projectMediaRefId,
    ).toBeNull();
  });

  it('separates provider-backed transcription and evaluation from local attempts', () => {
    const derivation = {
      authority: 'media_derivation' as const,
      id: 'derivation.1',
      projectId: 'project.1',
      runId: 'run.1',
      sourceBlobHash: HASH_A,
      transform: {
        operation: 'transcribe' as const,
        language: null,
        provider: null,
      },
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      createdAt: NOW,
    };
    const attempt = {
      authority: 'media_derivation_attempt' as const,
      id: 'attempt.1',
      derivation,
      attemptNumber: 1,
      revision: 0,
      contentHash: HASH_A,
      state: 'prepared' as const,
      provider: { providerId: 'provider.1', model: 'speech-model', reasoningStrength: null },
      receipt: null,
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: null,
      createdAt: NOW,
      finishedAt: null,
    };
    expect(MediaDerivationAttemptViewSchema.safeParse(attempt).success).toBe(true);
    expect(MediaDerivationAttemptViewSchema.safeParse({ ...attempt, provider: null }).success).toBe(
      false,
    );
    expect(
      MediaDerivationAttemptViewSchema.safeParse({
        ...attempt,
        derivation: {
          ...derivation,
          transform: { operation: 'resize', width: 1_920, height: 1_080, fit: 'contain' },
        },
      }).success,
    ).toBe(false);

    const subject = {
      authority: 'generated_result' as const,
      id: 'result.1',
      revision: 0,
      contentHash: HASH_A,
    };
    const providerEvaluation = {
      authority: 'result_assessment_attempt' as const,
      id: 'assessment.1',
      projectId: 'project.1',
      runId: 'run.1',
      revision: 0,
      contentHash: HASH_A,
      state: 'prepared' as const,
      provider: null,
      receipt: null,
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: null,
      createdAt: NOW,
      finishedAt: null,
      request: {
        kind: 'coverage' as const,
        subjects: [subject],
        requirements: ['Opening shot exists'],
        provider: null,
      },
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      assessment: null,
    };
    expect(ResultAssessmentAttemptViewSchema.safeParse(providerEvaluation).success).toBe(false);
  });

  it('keeps cooperative delivery attempts local-only', () => {
    const common = {
      projectId: 'project.1',
      runId: 'run.1',
      revision: 0,
      contentHash: HASH_A,
      state: 'prepared' as const,
      provider: null,
      receipt: null,
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: null,
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      outputBlobHash: null,
      createdAt: NOW,
      finishedAt: null,
    };
    const review = {
      ...common,
      authority: 'review_cut_attempt' as const,
      id: 'review.1',
      manifest: {
        authority: 'delivery_manifest' as const,
        id: 'manifest.1',
        revision: 0 as const,
        contentHash: HASH_A,
      },
      request: {
        manifest: {
          authority: 'delivery_manifest' as const,
          id: 'manifest.1',
          revision: 0 as const,
          contentHash: HASH_A,
        },
        range: null,
      },
    };
    const deliveryExport = {
      ...common,
      authority: 'delivery_export' as const,
      id: 'export.1',
      manifest: {
        authority: 'delivery_manifest' as const,
        id: 'manifest.1',
        revision: 0 as const,
        contentHash: HASH_A,
      },
      destination: {
        kind: 'user_selected_file' as const,
        grantId: 'grant.1',
        grantHash: HASH_B,
        displayLabel: 'movie.mp4',
      },
      overwriteExisting: false,
      outputContentHash: null,
    };
    expect(ReviewCutAttemptSchema.safeParse(review).success).toBe(true);
    expect(DeliveryExportSchema.safeParse(deliveryExport).success).toBe(true);
    expect(ReviewCutAttemptSchema.safeParse({ ...review, state: 'submitted' }).success).toBe(false);
    expect(DeliveryExportSchema.safeParse({ ...deliveryExport, state: 'unknown' }).success).toBe(
      false,
    );
  });
});

describe('I2-F3 media derivation output intent contracts', () => {
  it('accepts only strict bounded output metadata with contiguous ordinals', () => {
    const intent = deriveOutputIntent(0, true);
    expect(MediaDeriveOutputIntentSchema.parse(intent)).toEqual(intent);
    expect(MediaDeriveOutputIntentSchema.safeParse({ ...intent, unknown: true }).success).toBe(
      false,
    );
    expect(
      MediaDeriveOutputIntentSchema.safeParse({
        ...intent,
        globalAsset: { ...intent.globalAsset, filename: 'frames/output.png' },
      }).success,
    ).toBe(false);
    expect(
      MediaDeriveOutputIntentSchema.safeParse({
        ...intent,
        globalAsset: { ...intent.globalAsset, filename: 'frames\\output.png' },
      }).success,
    ).toBe(false);
    expect(
      MediaDeriveOutputIntentSchema.safeParse({
        ...intent,
        globalAsset: { ...intent.globalAsset, tags: ['frame', 'frame'] },
      }).success,
    ).toBe(false);
    expect(
      MediaDeriveOutputIntentSchema.safeParse({
        ...intent,
        projectMediaRef: { ...intent.projectMediaRef!, collections: ['Frames', 'Frames'] },
      }).success,
    ).toBe(false);
    expect(
      MediaDeriveOutputIntentSchema.safeParse({
        ...intent,
        projectMediaRef: { ...intent.projectMediaRef!, roles: ['reference', 'reference'] },
      }).success,
    ).toBe(false);

    const noncontiguous = {
      operation: 'extractFrames' as const,
      source: { kind: 'project_media_ref' as const, id: 'media.1' },
      expectedSourceHash: HASH_A,
      attach: { enabled: false, expectedProjectRevision: null },
      outputIntents: [deriveOutputIntent(0, false), deriveOutputIntent(2, false)],
      timecodesMs: [0, 1_000],
      imageFormat: 'png' as const,
    };
    expect(MediaDeriveInputSchema.safeParse(noncontiguous).success).toBe(false);

    const hundred = Array.from({ length: 100 }, (_, ordinal) => ordinal);
    expect(
      MediaDeriveInputSchema.safeParse({
        ...noncontiguous,
        timecodesMs: hundred,
        outputIntents: hundred.map((ordinal) => deriveOutputIntent(ordinal, false)),
      }).success,
    ).toBe(true);
    const hundredOne = Array.from({ length: 101 }, (_, ordinal) => ordinal);
    expect(
      MediaDeriveInputSchema.safeParse({
        ...noncontiguous,
        timecodesMs: hundredOne,
        outputIntents: hundredOne.map((ordinal) => deriveOutputIntent(ordinal, false)),
      }).success,
    ).toBe(false);
  });

  it('binds attachment intent in both directions', () => {
    const attached = resizeDeriveInput(true);
    const detached = resizeDeriveInput(false);
    expect(MediaDeriveInputSchema.safeParse(attached).success).toBe(true);
    expect(MediaDeriveInputSchema.safeParse(detached).success).toBe(true);
    expect(
      MediaDeriveInputSchema.safeParse({
        ...attached,
        attach: { enabled: true, expectedProjectRevision: null },
      }).success,
    ).toBe(false);
    expect(
      MediaDeriveInputSchema.safeParse({
        ...attached,
        outputIntents: [{ ...attached.outputIntents[0], projectMediaRef: null }],
      }).success,
    ).toBe(false);
    expect(
      MediaDeriveInputSchema.safeParse({
        ...detached,
        attach: { enabled: false, expectedProjectRevision: 4 },
      }).success,
    ).toBe(false);
    expect(
      MediaDeriveInputSchema.safeParse({
        ...detached,
        outputIntents: [deriveOutputIntent(0, true)],
      }).success,
    ).toBe(false);
  });

  it('matches extractFrames outputs one-for-one and every other variant exactly once', () => {
    const detachedBase = {
      source: { kind: 'project_media_ref' as const, id: 'media.1' },
      expectedSourceHash: HASH_A,
      attach: { enabled: false, expectedProjectRevision: null },
      outputIntents: [deriveOutputIntent(0, false)],
    };
    const frames = {
      ...detachedBase,
      operation: 'extractFrames',
      timecodesMs: [0, 1_000],
      imageFormat: 'png',
      outputIntents: [deriveOutputIntent(0, false), deriveOutputIntent(1, false)],
    };
    expect(MediaDeriveInputSchema.safeParse(frames).success).toBe(true);
    expect(
      MediaDeriveInputSchema.safeParse({
        ...frames,
        outputIntents: [deriveOutputIntent(0, false)],
      }).success,
    ).toBe(false);

    const variants = [
      { ...detachedBase, operation: 'clip', startMs: 0, endMs: 1_000 },
      { ...detachedBase, operation: 'crop', x: 0, y: 0, width: 100, height: 100 },
      { ...detachedBase, operation: 'resize', width: 100, height: 100, fit: 'contain' },
      {
        ...detachedBase,
        operation: 'proxyTranscode',
        container: 'mp4',
        maxWidth: 100,
        maxHeight: 100,
        quality: 80,
      },
      { ...detachedBase, operation: 'extractAudio', format: 'wav', sampleRateHz: 48_000 },
      { ...detachedBase, operation: 'waveform', width: 100, height: 50 },
      { ...detachedBase, operation: 'ocr', language: 'en', pageNumbers: [1] },
      { ...detachedBase, operation: 'transcribe', language: null, provider: null },
    ];
    for (const variant of variants) {
      expect(MediaDeriveInputSchema.safeParse(variant).success, variant.operation).toBe(true);
      expect(
        MediaDeriveInputSchema.safeParse({
          ...variant,
          outputIntents: [deriveOutputIntent(0, false), deriveOutputIntent(1, false)],
        }).success,
        variant.operation,
      ).toBe(false);
    }
  });

  it('keeps complete output intents in the parsed tool input and example', () => {
    const input = resizeDeriveInput(true);
    const changed = {
      ...input,
      outputIntents: [
        {
          ...input.outputIntents[0],
          globalAsset: { ...input.outputIntents[0]!.globalAsset, displayName: 'Changed' },
        },
      ],
    };
    expect(hash(MediaDeriveInputSchema.parse(input))).not.toBe(
      hash(MediaDeriveInputSchema.parse(changed)),
    );
    expect(
      MediaDeriveDefinition.inputSchema.safeParse(MediaDeriveDefinition.examples.input).success,
    ).toBe(true);
  });
});

describe('I2-F3 local execution failure contracts', () => {
  it('accepts execution_failed for failed Attempts across all five owners', () => {
    expect(OperationPublicErrorCodeSchema.parse('execution_failed')).toBe('execution_failed');
    const failedCommon = {
      revision: 0,
      contentHash: HASH_A,
      state: 'failed' as const,
      receipt: null,
      usage: null,
      cancelRequested: false,
      progressPercent: null,
      publicErrorCode: 'execution_failed' as const,
      createdAt: NOW,
      finishedAt: NOW,
    };
    const request = generationRequest();
    const generationAttempt = {
      ...failedCommon,
      authority: 'generation_attempt' as const,
      id: 'attempt.generation.1',
      requestId: request.id,
      attemptNumber: 1,
      provider: { providerId: 'provider.1', model: 'image-model', reasoningStrength: null },
      quote: null,
      promptProvenance: {
        sourceObjectId: 'shot.1',
        sourceRevision: 2,
        sourceHash: HASH_A,
        assemblyHash: HASH_B,
        loadedSkillDigests: [],
      },
      request,
    };
    const derivation = {
      authority: 'media_derivation' as const,
      id: 'derivation.1',
      projectId: 'project.1',
      runId: 'run.1',
      sourceBlobHash: HASH_A,
      transform: {
        operation: 'resize' as const,
        width: 100,
        height: 100,
        fit: 'contain' as const,
      },
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      createdAt: NOW,
    };
    const mediaAttempt = {
      ...failedCommon,
      authority: 'media_derivation_attempt' as const,
      id: 'attempt.media.1',
      derivation,
      attemptNumber: 1,
      provider: null,
    };
    const assessmentAttempt = {
      ...failedCommon,
      authority: 'result_assessment_attempt' as const,
      id: 'attempt.assessment.1',
      projectId: 'project.1',
      runId: 'run.1',
      provider: null,
      request: {
        kind: 'technical_integrity' as const,
        subjects: [
          {
            authority: 'generated_result' as const,
            id: 'result.1',
            revision: 0,
            contentHash: HASH_A,
          },
        ],
        checks: ['readable' as const],
        provider: null,
      },
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      assessment: null,
    };
    const reviewAttempt = {
      ...failedCommon,
      authority: 'review_cut_attempt' as const,
      id: 'attempt.review.1',
      projectId: 'project.1',
      runId: 'run.1',
      manifest: {
        authority: 'delivery_manifest' as const,
        id: 'manifest.1',
        revision: 0 as const,
        contentHash: HASH_A,
      },
      request: {
        manifest: {
          authority: 'delivery_manifest' as const,
          id: 'manifest.1',
          revision: 0 as const,
          contentHash: HASH_A,
        },
        range: null,
      },
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      provider: null,
      outputBlobHash: null,
    };
    const exportAttempt = {
      ...failedCommon,
      authority: 'delivery_export' as const,
      id: 'attempt.export.1',
      projectId: 'project.1',
      runId: 'run.1',
      manifest: {
        authority: 'delivery_manifest' as const,
        id: 'manifest.1',
        revision: 0 as const,
        contentHash: HASH_A,
      },
      destination: {
        kind: 'user_selected_file' as const,
        grantId: 'grant.1',
        grantHash: HASH_B,
        displayLabel: 'movie.mp4',
      },
      overwriteExisting: false,
      requestHash: HASH_B,
      idempotencyKey: HASH_C,
      provider: null,
      outputBlobHash: null,
      outputContentHash: null,
    };

    expect(GenerationAttemptViewSchema.safeParse(generationAttempt).success).toBe(true);
    expect(MediaDerivationAttemptViewSchema.safeParse(mediaAttempt).success).toBe(true);
    expect(ResultAssessmentAttemptViewSchema.safeParse(assessmentAttempt).success).toBe(true);
    expect(ReviewCutAttemptSchema.safeParse(reviewAttempt).success).toBe(true);
    expect(DeliveryExportSchema.safeParse(exportAttempt).success).toBe(true);
  });

  it('allows execution_failed only on a failed Operation event', () => {
    const failed = {
      type: 'operation_state_changed' as const,
      operation: {
        id: 'operation.1',
        revision: 1,
        kind: 'media_derivation' as const,
        ownerRef: {
          authority: 'media_derivation_attempt' as const,
          id: 'attempt.1',
          revision: 1,
          contentHash: HASH_A,
        },
      },
      previousRevision: 0,
      previousState: 'running' as const,
      previousCancelRequested: false,
      state: 'failed' as const,
      cancelRequested: false,
      publicErrorCode: 'execution_failed' as const,
    };
    expect(OperationStateChangedRunEventPayloadSchema.safeParse(failed).success).toBe(true);
    expect(
      OperationStateChangedRunEventPayloadSchema.safeParse({
        ...failed,
        state: 'running',
      }).success,
    ).toBe(false);
    expect(
      OperationStateChangedRunEventPayloadSchema.safeParse({
        ...failed,
        publicErrorCode: 'cancelled',
      }).success,
    ).toBe(false);
  });
});

describe('I2-F0 operation RunEvent', () => {
  it('allows a legal transition or a same-state cancel request, never a no-op', () => {
    const changed = {
      type: 'operation_state_changed' as const,
      operation: {
        id: 'operation.1',
        revision: 2,
        kind: 'generation_attempt' as const,
        ownerRef: {
          authority: 'generation_attempt' as const,
          id: 'attempt.1',
          revision: 2,
          contentHash: HASH_A,
        },
      },
      previousRevision: 1,
      previousState: 'running' as const,
      previousCancelRequested: false,
      state: 'running' as const,
      cancelRequested: true,
      publicErrorCode: null,
    };
    expect(OperationStateChangedRunEventPayloadSchema.parse(changed)).toEqual(changed);
    expect(
      OperationStateChangedRunEventPayloadSchema.safeParse({
        ...changed,
        cancelRequested: false,
      }).success,
    ).toBe(false);
    expect(
      OperationStateChangedRunEventPayloadSchema.safeParse({
        ...changed,
        previousRevision: null,
      }).success,
    ).toBe(false);
    expect(
      OperationStateChangedRunEventPayloadSchema.safeParse({
        ...changed,
        previousState: 'running',
        state: 'failed',
        cancelRequested: false,
        publicErrorCode: null,
      }).success,
    ).toBe(false);
  });
});
