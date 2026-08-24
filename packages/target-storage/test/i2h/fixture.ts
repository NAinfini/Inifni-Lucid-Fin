import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CapabilityCatalogSnapshotV1Schema,
  canonicalJson,
  generationQuoteHashInput,
  providerReceiptHashInput,
  type DeliveryDestinationIntent,
  type DomainObjectRef,
  type GenerationQuote,
  type ProjectMemoryIndex,
  type ProjectMemoryIndexEntry,
  type ProviderReceipt,
} from '@lucid-fin/target-contracts';
import {
  createAes256GcmPrivateRecoveryCodec,
  createTargetDataAccess,
  createTargetStore,
  type DeliveryDestinationGrantResolver,
  type GenerationProviderAdapter,
  type GenerationProviderQuoteRequest,
  type GenerationProviderState,
  type LocalDeliveryExporterAdapter,
  type LocalMediaDerivationAdapter,
  type LocalReviewRendererAdapter,
  type MediaCas,
  type MediaCasExpectedObject,
  type MediaImportCapabilityResolver,
  type PrivateRecoveryCodec,
  type ResultAssessmentProviderAdapter,
  type ResultAssessmentProviderState,
  type TargetCommandContext,
  type TargetDataAccessOptions,
  type TargetStore,
  type TranscriptionProviderAdapter,
  type TranscriptionProviderState,
} from '@lucid-fin/target-storage';
import type {
  MediaInspectionAdapter,
  ProviderCapabilitiesResolver,
} from '../../src/kernel/index.js';
import { getTargetStoreDatabase } from '../../dist/internal/database-access.js';
import { resolveOperationDispatchKey } from '../../dist/internal/operation-dispatch.js';

export const NOW = '2026-08-16T12:00:00.000Z';
export const PROVIDER_ID = 'provider.i2h';
export const PROVIDER_MODEL = 'video-model';
export const IMPORT_TOKEN = 'cap_i2h_reference_media_123';
export const PRIVATE_RECOVERY_KEY_ID = 'key.i2h.private-recovery';
const PRIVATE_RECOVERY_KEY = new Uint8Array(32).fill(0x5a);

export function createJourneyPrivateRecoveryCodec(
  encryptionKey: Uint8Array = PRIVATE_RECOVERY_KEY,
): PrivateRecoveryCodec {
  return createAes256GcmPrivateRecoveryCodec({
    encryptionKeyId: PRIVATE_RECOVERY_KEY_ID,
    encryptionKey,
  });
}

export const ROOT_CATALOG = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../target-contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);

export const budget = {
  costUsd: { state: 'known' as const, value: '50', currency: 'USD' },
  maxGenerationCount: 12,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
};

export const formatPolicy = {
  aspectRatio: '16:9' as const,
  customDimensions: null,
  frameRate: 24,
};

export const userContext: TargetCommandContext = {
  actor: 'user',
  causation: { kind: 'direct_ui', actionId: 'action.i2h.journey' },
  correlationId: 'correlation.i2h.journey',
};

export function commanderContext(runId: string): TargetCommandContext {
  return {
    actor: 'commander',
    causation: { kind: 'run', runId },
    correlationId: 'correlation.i2h.commander',
  };
}

export function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashCanonical(value: unknown): string {
  return sha256(canonicalJson(value));
}

export function hashContentObject<T extends { readonly contentHash: string }>(value: T): string {
  const { contentHash: _contentHash, ...content } = value;
  return hashCanonical(content);
}

export function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return `${kind}.${next}`;
  };
}

function stream(value: Uint8Array | string): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield typeof value === 'string' ? Buffer.from(value) : value;
  })();
}

export class MemoryMediaCas implements MediaCas {
  readonly objects = new Map<string, Uint8Array>();
  putCalls = 0;
  verifyCalls = 0;
  openCalls = 0;

  async putVerified(expected: MediaCasExpectedObject, source: AsyncIterable<Uint8Array>) {
    this.putCalls += 1;
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (sha256(bytes) !== expected.hash || bytes.byteLength !== expected.byteLength) {
      throw new Error('I2-H fixture CAS object mismatch');
    }
    const disposition = this.objects.has(expected.hash) ? 'existing' : 'created';
    this.objects.set(expected.hash, Uint8Array.from(bytes));
    return { ...expected, disposition } as const;
  }

  async stat(hash: string) {
    const bytes = this.objects.get(hash);
    return bytes === undefined ? null : { hash, byteLength: bytes.byteLength };
  }

  async verify(expected: MediaCasExpectedObject) {
    this.verifyCalls += 1;
    const bytes = this.objects.get(expected.hash);
    if (
      bytes === undefined ||
      bytes.byteLength !== expected.byteLength ||
      sha256(bytes) !== expected.hash
    ) {
      throw new Error('I2-H fixture CAS verification failed');
    }
  }

  openVerified(expected: MediaCasExpectedObject) {
    const cas = this;
    return {
      async *[Symbol.asyncIterator]() {
        cas.openCalls += 1;
        await cas.verify(expected);
        yield Uint8Array.from(cas.objects.get(expected.hash)!);
      },
    };
  }
}

export class MemoryImportCapabilities implements MediaImportCapabilityResolver {
  readonly bytes = Buffer.from('harbor-reference-media');
  resolveCalls = 0;
  openCalls = 0;

  async resolve(capabilityToken: string) {
    this.resolveCalls += 1;
    if (capabilityToken !== IMPORT_TOKEN) throw new Error('Unexpected I2-H import capability');
    const capabilities = this;
    return {
      descriptor: {
        capabilityToken,
        importId: 'import.i2h.reference',
        originalFileName: 'harbor-reference.png',
        blobHash: sha256(this.bytes),
        byteLength: this.bytes.byteLength,
        mimeType: 'image/png',
        technicalFacts: { kind: 'image' as const, width: 1_920, height: 1_080 },
      },
      openBytes() {
        capabilities.openCalls += 1;
        return stream(capabilities.bytes);
      },
    };
  }
}

export class FakeMediaInspector implements MediaInspectionAdapter {
  readonly calls: Parameters<MediaInspectionAdapter['inspect']>[0][] = [];

  async inspect(request: Parameters<MediaInspectionAdapter['inspect']>[0]) {
    this.calls.push(request);
    for await (const _chunk of request.bytes) {
      // Consume the accepted CAS stream so tests exercise its verification boundary.
    }
    return [
      {
        artifact: null,
        textEvidence: `Verified ${request.blob.technicalFacts.kind} evidence.`,
        timecodesMs: [],
        pageNumbers: [],
      },
    ];
  }
}

export class FakeProviderCapabilitiesResolver implements ProviderCapabilitiesResolver {
  readonly calls: Parameters<ProviderCapabilitiesResolver['resolve']>[0][] = [];

  async resolve(profile: Parameters<ProviderCapabilitiesResolver['resolve']>[0]) {
    this.calls.push(profile);
    return [
      {
        modality: 'video' as const,
        imageTasks: [],
        videoTasks: ['create' as const],
        audioTasks: [],
        parameters: [
          { name: 'durationMs' as const, required: true, minimum: 1_000, maximum: 10_000 },
        ],
        quoteSupport: 'estimate' as const,
        availability:
          profile.status === 'ready' ? ('available' as const) : ('unavailable' as const),
        capabilityVersion: `fixture.${profile.revision}`,
        freshAt: profile.updatedAt,
      },
    ];
  }
}

function receipt(providerOperationId: string): ProviderReceipt {
  const value = {
    providerOperationId,
    submittedAt: NOW,
    reconciledAt: null,
    receiptHash: '',
  };
  return { ...value, receiptHash: hashCanonical(providerReceiptHashInput(value)) };
}

function usage(generatedUnits: number, cost: string) {
  return {
    inputTokens: { state: 'known' as const, value: 0 },
    outputTokens: { state: 'known' as const, value: 0 },
    generatedUnits: { state: 'known' as const, value: generatedUnits },
    cost: { state: 'known' as const, value: cost, currency: 'USD' },
  };
}

export class FakeGenerationProvider implements GenerationProviderAdapter {
  readonly providerKind = 'fake-video';
  readonly outputs = [Buffer.from('harbor-candidate-one'), Buffer.from('harbor-candidate-two')];
  quoteCalls = 0;
  submitCalls = 0;
  reconcileCalls = 0;
  cancelCalls = 0;

  async quote(request: GenerationProviderQuoteRequest) {
    this.quoteCalls += 1;
    const withoutHash: GenerationQuote = {
      state: 'known',
      quoteId: 'quote.i2h.generation',
      quotedRequestHash: request.requestHash,
      currency: 'USD',
      expiresAt: '2026-08-17T12:00:00.000Z',
      providerId: request.profile.id,
      model: request.profile.model.model,
      amount: '2',
      quoteHash: '',
    };
    return {
      quote: {
        ...withoutHash,
        quoteHash: hashCanonical(generationQuoteHashInput(withoutHash)),
      },
      estimatedDurationMs: 1,
      constraints: [],
    };
  }

  async submit(): Promise<GenerationProviderState> {
    this.submitCalls += 1;
    return {
      state: 'succeeded',
      receipt: receipt('provider.operation.i2h.generation'),
      usage: usage(2, '2'),
      outputs: this.outputs.map((bytes, variantIndex) => ({
        variantIndex,
        blob: {
          hash: sha256(bytes),
          byteLength: bytes.byteLength,
          mimeType: 'video/mp4',
          technicalFacts: {
            kind: 'video' as const,
            width: 1_920,
            height: 1_080,
            durationMs: 8_000,
            frameRate: 24,
            hasAudio: true,
          },
          publication: { state: 'pending' as const, bytes: stream(bytes) },
        },
        technicalValidation: {
          state: 'valid' as const,
          mimeTypeValid: true,
          dimensionsValid: true,
          durationValid: true,
          failureCode: null,
        },
      })),
    };
  }

  async reconcileByIdempotencyKey(): Promise<GenerationProviderState> {
    this.reconcileCalls += 1;
    throw new Error('Generation reconcile is not expected in I2-H1');
  }

  async cancel(): Promise<GenerationProviderState> {
    this.cancelCalls += 1;
    throw new Error('Generation cancel is not expected in I2-H1');
  }
}

export class FakeAssessmentProvider implements ResultAssessmentProviderAdapter {
  readonly providerKind = 'fake-video';
  quoteCalls = 0;
  submitCalls = 0;
  reconcileCalls = 0;
  cancelCalls = 0;

  async quote() {
    this.quoteCalls += 1;
    return { cost: { state: 'known' as const, value: '1', currency: 'USD' } };
  }

  async submit(request: Parameters<ResultAssessmentProviderAdapter['submit']>[0]) {
    this.submitCalls += 1;
    const subject = request.request.subjects[0]!;
    const state = {
      state: 'succeeded',
      receipt: receipt(`provider.operation.i2h.assessment.${this.submitCalls}`),
      usage: usage(0, '1'),
      assessment: {
        findings: [
          {
            severity: 'info' as const,
            subjectRef: subject,
            criterion: 'composition',
            finding: 'Harbor composition matches the supplied reference.',
            evidenceRefs: [subject],
          },
        ],
        limitations: ['The user remains the final creative decision maker.'],
        recommendations: ['Compare both candidates in Media before selecting.'],
        artifacts: [],
      },
    } satisfies Extract<ResultAssessmentProviderState, { state: 'succeeded' }>;
    return state;
  }

  async reconcileByIdempotencyKey(): Promise<ResultAssessmentProviderState> {
    this.reconcileCalls += 1;
    return { state: 'not_submitted' };
  }

  async cancel(): Promise<ResultAssessmentProviderState> {
    this.cancelCalls += 1;
    throw new Error('Assessment cancel is not expected in I2-H1');
  }
}

export class FakeLocalMediaDerivation implements LocalMediaDerivationAdapter {
  readonly calls: Array<Parameters<LocalMediaDerivationAdapter['derive']>[0]> = [];
  cancelCalls = 0;

  async derive(request: Parameters<LocalMediaDerivationAdapter['derive']>[0]) {
    this.calls.push(request);
    for await (const _chunk of request.source.bytes) {
      // Consume the verified source boundary.
    }
    const bytes = Buffer.from('harbor-derived-reference');
    return [
      {
        ordinal: 0,
        blob: {
          hash: sha256(bytes),
          byteLength: bytes.byteLength,
          mimeType: 'image/png',
          technicalFacts: { kind: 'image' as const, width: 960, height: 540 },
          publication: { state: 'pending' as const, bytes: stream(bytes) },
        },
      },
    ];
  }

  async cancel() {
    this.cancelCalls += 1;
    return { state: 'cancelled' as const };
  }
}

export class FakeTranscriptionProvider implements TranscriptionProviderAdapter {
  readonly providerKind = 'fake-video';
  submitCalls = 0;
  reconcileCalls = 0;
  cancelCalls = 0;

  async submit(): Promise<TranscriptionProviderState> {
    this.submitCalls += 1;
    return { state: 'not_submitted' };
  }

  async reconcileByIdempotencyKey(): Promise<TranscriptionProviderState> {
    this.reconcileCalls += 1;
    return { state: 'not_submitted' };
  }

  async cancel(): Promise<TranscriptionProviderState> {
    this.cancelCalls += 1;
    return { state: 'cancelled', receipt: null, usage: null, outputs: [] };
  }
}

function localOutput(value: string) {
  const bytes = Buffer.from(value);
  return {
    blob: {
      hash: sha256(bytes),
      byteLength: bytes.byteLength,
      mimeType: 'video/mp4',
      technicalFacts: {
        kind: 'video' as const,
        width: 1_920,
        height: 1_080,
        durationMs: 8_000,
        frameRate: 24,
        hasAudio: true,
      },
      bytes: stream(bytes),
    },
  };
}

export class FakeReviewRenderer implements LocalReviewRendererAdapter {
  readonly calls: Array<Parameters<LocalReviewRendererAdapter['render']>[0]> = [];

  async render(request: Parameters<LocalReviewRendererAdapter['render']>[0]) {
    this.calls.push(request);
    return localOutput('harbor-review-cut');
  }

  async cancel() {
    return { state: 'cancelled' as const };
  }
}

export class FakeDeliveryExporter implements LocalDeliveryExporterAdapter {
  readonly calls: Array<Parameters<LocalDeliveryExporterAdapter['export']>[0]> = [];

  async export(request: Parameters<LocalDeliveryExporterAdapter['export']>[0]) {
    this.calls.push(request);
    const output = localOutput('harbor-delivery-export');
    return { ...output, outputContentHash: output.blob.hash };
  }

  async cancel() {
    return { state: 'cancelled' as const };
  }
}

export class FakeDestinationGrants implements DeliveryDestinationGrantResolver {
  readonly calls: DeliveryDestinationIntent[] = [];

  async resolve(descriptor: DeliveryDestinationIntent) {
    this.calls.push(descriptor);
    return { descriptor, writableGrant: { opaque: 'test-only-grant' } };
  }
}

export interface JourneyDependencies {
  readonly mediaCas: MemoryMediaCas;
  readonly imports: MemoryImportCapabilities;
  readonly mediaInspector: FakeMediaInspector;
  readonly generation: FakeGenerationProvider;
  readonly providerCapabilities: FakeProviderCapabilitiesResolver;
  readonly assessment: FakeAssessmentProvider;
  readonly localDerivation: FakeLocalMediaDerivation;
  readonly transcription: FakeTranscriptionProvider;
  readonly review: FakeReviewRenderer;
  readonly exporter: FakeDeliveryExporter;
  readonly destinations: FakeDestinationGrants;
}

export function createJourneyDependencies(): JourneyDependencies {
  return {
    mediaCas: new MemoryMediaCas(),
    imports: new MemoryImportCapabilities(),
    mediaInspector: new FakeMediaInspector(),
    generation: new FakeGenerationProvider(),
    providerCapabilities: new FakeProviderCapabilitiesResolver(),
    assessment: new FakeAssessmentProvider(),
    localDerivation: new FakeLocalMediaDerivation(),
    transcription: new FakeTranscriptionProvider(),
    review: new FakeReviewRenderer(),
    exporter: new FakeDeliveryExporter(),
    destinations: new FakeDestinationGrants(),
  };
}

export function createJourneyDataAccess(
  store: TargetStore,
  dependencies: JourneyDependencies,
  createId = deterministicIds(),
  privateRecoveryCodec = createJourneyPrivateRecoveryCodec(),
) {
  const options: TargetDataAccessOptions = {
    now: () => NOW,
    createId,
    privateRecoveryCodec,
    mediaCas: dependencies.mediaCas,
    mediaImportCapabilities: dependencies.imports,
    mediaInspector: dependencies.mediaInspector,
    localMediaDerivation: dependencies.localDerivation,
    transcriptionProvider: dependencies.transcription,
    generationProvider: dependencies.generation,
    providerCapabilitiesResolver: dependencies.providerCapabilities,
    resultAssessmentProvider: dependencies.assessment,
    reviewRenderer: dependencies.review,
    deliveryExporter: dependencies.exporter,
    deliveryDestinationGrants: dependencies.destinations,
  };
  return createTargetDataAccess(store, options);
}

export function getJourneyTestDatabase(store: TargetStore) {
  return getTargetStoreDatabase(store);
}

export async function createJourneyFixture(
  dependencies: JourneyDependencies = createJourneyDependencies(),
) {
  const directory = await mkdtemp(join(tmpdir(), 'lucid-fin-i2h1-'));
  const databasePath = join(directory, 'project.sqlite');
  const store = await createTargetStore(databasePath);
  const createId = deterministicIds();
  return {
    createId,
    databasePath,
    dependencies,
    directory,
    store,
    data: createJourneyDataAccess(store, dependencies, createId),
  };
}

export function callCounts(dependencies: JourneyDependencies) {
  return {
    cas: {
      objects: dependencies.mediaCas.objects.size,
      opens: dependencies.mediaCas.openCalls,
      puts: dependencies.mediaCas.putCalls,
      verifies: dependencies.mediaCas.verifyCalls,
    },
    import: {
      opens: dependencies.imports.openCalls,
      resolves: dependencies.imports.resolveCalls,
    },
    generation: {
      cancel: dependencies.generation.cancelCalls,
      quote: dependencies.generation.quoteCalls,
      reconcile: dependencies.generation.reconcileCalls,
      submit: dependencies.generation.submitCalls,
    },
    assessment: {
      cancel: dependencies.assessment.cancelCalls,
      quote: dependencies.assessment.quoteCalls,
      reconcile: dependencies.assessment.reconcileCalls,
      submit: dependencies.assessment.submitCalls,
    },
    mediaDerivation: {
      cancel: dependencies.localDerivation.cancelCalls,
      derive: dependencies.localDerivation.calls.length,
      providerCancel: dependencies.transcription.cancelCalls,
      reconcile: dependencies.transcription.reconcileCalls,
      submit: dependencies.transcription.submitCalls,
    },
    review: dependencies.review.calls.length,
    export: dependencies.exporter.calls.length,
    destination: dependencies.destinations.calls.length,
  };
}

export function pendingMediaOutput(value: string) {
  const bytes = Buffer.from(value);
  return {
    ordinal: 0,
    blob: {
      hash: sha256(bytes),
      byteLength: bytes.byteLength,
      mimeType: 'image/png',
      technicalFacts: { kind: 'image' as const, width: 960, height: 540 },
      publication: { state: 'pending' as const, bytes: stream(bytes) },
    },
  };
}

export function publishedMediaOutput(value: string) {
  const pending = pendingMediaOutput(value);
  return {
    ...pending,
    blob: { ...pending.blob, publication: { state: 'published' as const } },
  };
}

export function memoryIndex(
  projectId: string,
  historyWatermark: number,
  sources: readonly (DomainObjectRef | { readonly choiceId: string })[],
): ProjectMemoryIndex {
  const normalizedSources = sources.map((source) =>
    'choiceId' in source
      ? ({ kind: 'user_choice' as const, choiceId: source.choiceId } as const)
      : ({ kind: 'domain_object' as const, ref: source } as const),
  );
  const withoutHash = {
    id: 'memory.item.i2h.harbor-choice',
    category: 'decision' as const,
    sources: normalizedSources,
    state: 'current' as const,
    tentative: false,
    topics: ['harbor', 'selection'],
    searchableText: 'The user selected and protected the first harbor candidate.',
    contentHash: '',
  };
  const entry: ProjectMemoryIndexEntry = {
    ...withoutHash,
    contentHash: hashContentObject(withoutHash),
  };
  const canonicalSources = [
    ...new Map(normalizedSources.map((source) => [canonicalJson(source), source])),
  ]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, source]) => source);
  return {
    authority: 'project_memory',
    id: 'memory.version.i2h.1',
    projectId,
    derivationVersion: 'i2h-memory-v1',
    sourceSchemaVersion: 'source-v1',
    historyWatermark,
    sourceSetHash: hashCanonical(canonicalSources),
    completeness: 'complete',
    entries: [entry],
    createdAt: NOW,
  };
}

export function seedApprovedExportConfirmation(
  store: TargetStore,
  runId: string,
  request: Parameters<
    ReturnType<typeof createJourneyDataAccess>['deliveryOperations']['export']
  >[0]['request'],
): string {
  // I3 owns interaction persistence; H1 needs one typed, centralized seed until that public seam exists.
  const database = getTargetStoreDatabase(store);
  const key = resolveOperationDispatchKey(database, {
    runId,
    toolId: 'delivery.export',
    input: request,
  });
  const objective = database
    .prepare('SELECT objective_message_id FROM runs WHERE id = ?')
    .get(runId) as { objective_message_id: string };
  const interactionId = 'interaction.i2h.export';
  const confirmationId = 'confirmation.i2h.export';
  database
    .prepare(
      `INSERT INTO run_interactions (
         id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
         allow_free_text, state, answer_message_id, created_at, resolved_at
       ) VALUES (?, ?, 'confirmation', 'Approve final export?', '[]', '[]', 0,
         'answered', ?, ?, ?)`,
    )
    .run(interactionId, runId, objective.objective_message_id, NOW, NOW);
  database
    .prepare(
      `INSERT INTO run_confirmations (
         id, run_id, interaction_id, target_v1_json, immutable_input_hash,
         decision, decided_by_message_id, requested_at, decided_at
       ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
    )
    .run(
      confirmationId,
      runId,
      interactionId,
      canonicalJson({ kind: 'domain_object', ref: request.manifest }),
      key.inputHash,
      objective.objective_message_id,
      NOW,
      NOW,
    );
  return confirmationId;
}
