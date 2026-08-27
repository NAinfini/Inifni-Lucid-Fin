import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CapabilityCatalogSnapshotV1Schema,
  MediaInspectDefinition,
  canonicalJson,
  providerReceiptHashInput,
  type MediaTechnicalFacts,
  type ProviderReceipt,
  type ProviderUsage,
} from '@lucid-fin/target-contracts';
import { describe, expect, it } from 'vitest';
import {
  registerTargetStoreDatabase,
  unregisterTargetStoreDatabase,
} from '../internal/database-access.js';
import { createAes256GcmPrivateRecoveryCodec } from '../kernel/private-recovery-codec.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import type {
  LocalMediaDerivationAdapter,
  MediaDerivationAdapterOutput,
  TranscriptionProviderAdapter,
  TranscriptionProviderState,
} from '../kernel/media-derivation-adapters.js';
import type {
  MediaCas,
  MediaCasExpectedObject,
  MediaImportCapabilityResolver,
} from '../kernel/media-cas.js';
import type { MediaInspectionAdapter } from '../kernel/media-inspector.js';
import type { TargetStore } from '../kernel/store.js';

const NOW = '2026-08-15T12:00:00.000Z';
const SOURCE_BYTES = Buffer.from('accepted-source-image');
const SOURCE_HASH = sha256(SOURCE_BYTES);
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../target-contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stream(value: Uint8Array | string): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield typeof value === 'string' ? Buffer.from(value) : value;
  })();
}

async function collect(value: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of value) chunks.push(chunk);
  return Buffer.concat(chunks);
}

class MemoryMediaCas implements MediaCas {
  readonly objects = new Map<string, Uint8Array>();
  putCalls = 0;
  verifyCalls = 0;
  failPut = false;

  async putVerified(expected: MediaCasExpectedObject, source: AsyncIterable<Uint8Array>) {
    this.putCalls += 1;
    if (this.failPut) throw new Error('injected CAS failure');
    const bytes = await collect(source);
    if (sha256(bytes) !== expected.hash || bytes.byteLength !== expected.byteLength) {
      throw new Error('fixture output does not match its descriptor');
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
      throw new Error('fixture CAS corruption');
    }
  }

  openVerified(expected: MediaCasExpectedObject): AsyncIterable<Uint8Array> {
    const objects = this.objects;
    const verify = (value: MediaCasExpectedObject) => this.verify(value);
    return {
      async *[Symbol.asyncIterator]() {
        await verify(expected);
        yield Uint8Array.from(objects.get(expected.hash)!);
      },
    };
  }
}

function output(ordinal: number, prefix = 'local'): MediaDerivationAdapterOutput {
  const bytes = Buffer.from(`${prefix}-output-${ordinal}`);
  return {
    ordinal,
    blob: {
      hash: sha256(bytes),
      byteLength: bytes.byteLength,
      mimeType: 'image/png',
      technicalFacts: { kind: 'image', width: 640, height: 360 },
      publication: { state: 'pending', bytes: stream(bytes) },
    },
  };
}

class FakeLocalDeriver implements LocalMediaDerivationAdapter {
  readonly calls: Parameters<LocalMediaDerivationAdapter['derive']>[0][] = [];
  cancelCalls = 0;
  fail = false;
  beforeReturn: (() => void | Promise<void>) | null = null;

  async derive(request: Parameters<LocalMediaDerivationAdapter['derive']>[0]) {
    this.calls.push(request);
    expect(await collect(request.source.bytes)).toEqual(SOURCE_BYTES);
    await this.beforeReturn?.();
    if (this.fail) throw new Error('injected local failure');
    return Array.from({ length: request.outputCount }, (_, ordinal) => output(ordinal));
  }

  async cancel() {
    this.cancelCalls += 1;
    return { state: 'cancelled' as const };
  }
}

function receipt(id = 'provider.operation.transcription'): ProviderReceipt {
  const value = {
    providerOperationId: id,
    submittedAt: NOW,
    reconciledAt: null,
    receiptHash: '',
  };
  return { ...value, receiptHash: sha256(canonicalJson(providerReceiptHashInput(value))) };
}

function usage(
  cost: ProviderUsage['cost'] = { state: 'estimated', value: '1.25', currency: 'USD' },
): ProviderUsage {
  return {
    inputTokens: { state: 'known', value: 0 },
    outputTokens: { state: 'known', value: 0 },
    generatedUnits: { state: 'known', value: 1 },
    cost,
  };
}

function succeededProviderState(
  providerReceipt = receipt(),
  providerUsage = usage(),
): TranscriptionProviderState {
  return {
    state: 'succeeded',
    receipt: providerReceipt,
    usage: providerUsage,
    outputs: [output(0, 'transcription')],
  };
}

class FakeTranscriptionProvider implements TranscriptionProviderAdapter {
  readonly providerKind = 'openai';
  submitCalls = 0;
  reconcileCalls = 0;
  cancelCalls = 0;
  submitResult: unknown = { state: 'not_submitted' };
  reconcileResult: unknown = { state: 'not_submitted' };
  cancelResult: unknown = {
    state: 'cancelled',
    receipt: receipt(),
    usage: usage({ state: 'unknown', currency: 'USD' }),
    outputs: [],
  };
  failSubmit = false;
  failReconcile = false;

  async submit(): Promise<TranscriptionProviderState> {
    this.submitCalls += 1;
    if (this.failSubmit) throw new Error('injected submit failure');
    return this.submitResult as TranscriptionProviderState;
  }

  async reconcileByIdempotencyKey(): Promise<TranscriptionProviderState> {
    this.reconcileCalls += 1;
    if (this.failReconcile) throw new Error('injected reconcile failure');
    return this.reconcileResult as TranscriptionProviderState;
  }

  async cancel(): Promise<TranscriptionProviderState> {
    this.cancelCalls += 1;
    return this.cancelResult as TranscriptionProviderState;
  }
}

class FakeInspector implements MediaInspectionAdapter {
  calls = 0;

  async inspect(request: Parameters<MediaInspectionAdapter['inspect']>[0]) {
    this.calls += 1;
    await collect(request.bytes);
    return [{ artifact: null, textEvidence: 'verified', timecodesMs: [], pageNumbers: [] }];
  }
}

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return `${kind}.${count}`;
  };
}

function memoryStore(): { store: TargetStore; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../target-contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  let open = true;
  const store: TargetStore = {
    databasePath: ':memory:',
    schemaFingerprint: {} as TargetStore['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      if (!open) return;
      open = false;
      unregisterTargetStoreDatabase(store);
      database.close();
    },
  };
  registerTargetStoreDatabase(store, database);
  return { store, database };
}

async function harness(costState: 'known' | 'unknown' = 'known') {
  const { store, database } = memoryStore();
  const cas = new MemoryMediaCas();
  cas.objects.set(SOURCE_HASH, SOURCE_BYTES);
  const local = new FakeLocalDeriver();
  const transcription = new FakeTranscriptionProvider();
  const inspector = new FakeInspector();
  const capabilityToken = 'cap_media_derivation_source_123';
  const resolver: MediaImportCapabilityResolver = {
    async resolve(token) {
      if (token !== capabilityToken) throw new Error('unexpected capability');
      const facts: MediaTechnicalFacts = { kind: 'image', width: 1920, height: 1080 };
      return {
        descriptor: {
          capabilityToken,
          importId: 'import.media.derivation',
          originalFileName: 'source.png',
          blobHash: SOURCE_HASH,
          byteLength: SOURCE_BYTES.byteLength,
          mimeType: 'image/png',
          technicalFacts: facts,
        },
        openBytes: () => stream(SOURCE_BYTES),
      };
    },
  };
  const data = createTargetDataAccess(store, {
    now: () => NOW,
    createId: deterministicIds(),
    privateRecoveryCodec: createAes256GcmPrivateRecoveryCodec({
      encryptionKeyId: 'key.media-derive',
      encryptionKey: new Uint8Array(32).fill(7),
    }),
    mediaCas: cas,
    mediaImportCapabilities: resolver,
    mediaInspector: inspector,
    localMediaDerivation: local,
    transcriptionProvider: transcription,
    generationProvider: {} as never,
    providerCapabilitiesResolver: {} as never,
    resultAssessmentProvider: {} as never,
    reviewRenderer: {} as never,
    deliveryExporter: {} as never,
    deliveryDestinationGrants: {} as never,
  });
  const userContext = {
    actor: 'user' as const,
    causation: { kind: 'direct_ui' as const, actionId: 'action.media.derivation.setup' },
    correlationId: 'correlation.media.derivation.setup',
  };
  const budget = {
    costUsd:
      costState === 'known'
        ? ({ state: 'known', value: '20', currency: 'USD' } as const)
        : ({ state: 'unknown', currency: 'USD' } as const),
    maxGenerationCount: 12,
    maxInputTokens: 100_000,
    maxOutputTokens: 20_000,
  };
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.media.derivation',
      method: 'project.create',
      input: {
        name: 'Derivative Film',
        permissionMode: 'reversible',
        budget,
        formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
      },
    },
    userContext,
  ).result.project;
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES ('provider.1', 'Provider', 'openai', 'transcribe-model', NULL, NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const asset = (
    await data.globalMedia.importGlobal(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.media.derivation.import',
        method: 'media.global.import',
        input: { capabilityToken, displayName: 'Source', tags: ['source'] },
      },
      userContext,
    )
  ).result.asset;
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.media.derivation',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    userContext,
  ).result;
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.media.derivation',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Prepare a derivative.' }],
        attachments: [],
        selectedContext: [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    userContext,
    {
      model: { providerId: 'provider.1', model: 'transcribe-model', reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  cas.putCalls = 0;
  cas.verifyCalls = 0;
  return {
    store,
    database,
    data,
    cas,
    local,
    transcription,
    inspector,
    project,
    asset,
    run,
    userContext,
    context: {
      actor: 'commander' as const,
      causation: { kind: 'run' as const, runId: run.id },
      correlationId: 'correlation.media.derivation',
    },
  };
}

type Fixture = Awaited<ReturnType<typeof harness>>;

function intent(ordinal: number, suffix = String(ordinal)) {
  return {
    ordinal,
    globalAsset: {
      filename: `derived-${suffix}.png`,
      displayName: `Derived ${suffix}`,
      folderId: null,
      tags: ['derived'],
    },
    projectMediaRef: null,
  };
}

function baseInput(fixture: Fixture, count = 1) {
  return {
    source: { kind: 'global_asset' as const, id: fixture.asset.id },
    expectedSourceHash: fixture.asset.blobHash,
    attach: { enabled: false as const, expectedProjectRevision: null },
    outputIntents: Array.from({ length: count }, (_, ordinal) => intent(ordinal)),
  };
}

function localVariants(fixture: Fixture) {
  const base = baseInput(fixture);
  return [
    {
      ...baseInput(fixture, 2),
      operation: 'extractFrames' as const,
      timecodesMs: [0, 1000],
      imageFormat: 'png' as const,
    },
    { ...base, operation: 'clip' as const, startMs: 0, endMs: 1000 },
    { ...base, operation: 'crop' as const, x: 0, y: 0, width: 640, height: 360 },
    { ...base, operation: 'resize' as const, width: 640, height: 360, fit: 'contain' as const },
    {
      ...base,
      operation: 'proxyTranscode' as const,
      container: 'mp4' as const,
      maxWidth: 640,
      maxHeight: 360,
      quality: 80,
    },
    {
      ...base,
      operation: 'extractAudio' as const,
      format: 'wav' as const,
      sampleRateHz: 48_000,
    },
    { ...base, operation: 'waveform' as const, width: 640, height: 180 },
    { ...base, operation: 'ocr' as const, language: 'en', pageNumbers: [1] },
  ];
}

function transcriptionInput(fixture: Fixture) {
  return {
    ...baseInput(fixture),
    operation: 'transcribe' as const,
    language: 'en',
    provider: { providerId: 'provider.1', model: 'transcribe-model' },
  };
}

function rowCount(database: DatabaseSync, table: string): number {
  return (database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number })
    .count;
}

function operationState(fixture: Fixture, operation: { id: string }) {
  return fixture.database
    .prepare(
      `SELECT attempt.state, attempt.receipt_v1_json AS receipt, attempt.usage_v1_json AS usage
         FROM dispatch_operations AS dispatch
         JOIN media_derivation_attempts AS attempt ON attempt.id = dispatch.owner_id
         WHERE dispatch.id = ?`,
    )
    .get(operation.id) as { state: string; receipt: string | null; usage: string | null };
}

function cancel(fixture: Fixture, operation: { id: string; revision: number; ownerRef: object }) {
  return fixture.data.operations.cancel(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: `request.cancel.${operation.id}.${operation.revision}`,
      method: 'operation.cancel',
      input: {
        operations: [
          {
            ref: operation as never,
            expectedRevision: operation.revision,
            expectedState: operationState(fixture, operation).state as never,
          },
        ],
      },
    },
    fixture.context,
  ).result.operations[0]!;
}

describe('Media Derivations authority', () => {
  it('keeps media.inspect read-only and bound to verified CAS bytes', async () => {
    const fixture = await harness();
    try {
      const before = rowCount(fixture.database, 'dispatch_operations');
      const result = await fixture.data.mediaInspection.inspect(
        fixture.run.id,
        MediaInspectDefinition.parseInput({
          source: { kind: 'global_asset', id: fixture.asset.id },
          expectedSourceHash: fixture.asset.blobHash,
          view: { kind: 'image', maxDimension: 1280 },
        }),
      );
      expect(result.observations).toHaveLength(1);
      expect(fixture.inspector.calls).toBe(1);
      expect(rowCount(fixture.database, 'dispatch_operations')).toBe(before);
    } finally {
      fixture.store.close();
    }
  });

  it('executes all eight local variants through one typed adapter with exact output cardinality', async () => {
    const fixture = await harness();
    try {
      for (const [index, input] of localVariants(fixture).entries()) {
        const started = await fixture.data.mediaDerivations.start(
          { runId: fixture.run.id, commandId: `command.local.start.${index}`, input },
          fixture.context,
        );
        const completed = await fixture.data.mediaDerivations.continue(
          {
            dispatchOperationId: started.operation.id,
            commandId: `command.local.continue.${index}`,
          },
          fixture.context,
        );
        expect(operationState(fixture, completed.operation).state).toBe('succeeded');
        expect(completed.globalAssets).toHaveLength(input.outputIntents.length);
        const call = fixture.local.calls[index]!;
        const {
          source: _source,
          expectedSourceHash: _expectedSourceHash,
          attach: _attach,
          outputIntents: _outputIntents,
          ...transform
        } = input;
        expect(call.transform).toEqual(transform);
        expect(call.outputCount).toBe(input.outputIntents.length);
      }
      expect(rowCount(fixture.database, 'run_resource_entries')).toBe(0);
    } finally {
      fixture.store.close();
    }
  }, 30_000);

  it('replays terminal local work without adapter calls or database writes', async () => {
    const fixture = await harness();
    try {
      const request = {
        runId: fixture.run.id,
        commandId: 'command.local.replay.start',
        input: localVariants(fixture)[3]!,
      };
      const started = await fixture.data.mediaDerivations.start(request, fixture.context);
      const continued = {
        dispatchOperationId: started.operation.id,
        commandId: 'command.local.replay.continue',
      };
      const completed = await fixture.data.mediaDerivations.continue(continued, fixture.context);
      const before = {
        calls: fixture.local.calls.length,
        events: rowCount(fixture.database, 'run_events'),
        assets: rowCount(fixture.database, 'global_media_assets'),
        outputs: rowCount(fixture.database, 'media_derivation_outputs'),
      };
      expect(await fixture.data.mediaDerivations.start(request, fixture.context)).toEqual(
        completed,
      );
      expect(await fixture.data.mediaDerivations.continue(continued, fixture.context)).toEqual(
        completed,
      );
      expect({
        calls: fixture.local.calls.length,
        events: rowCount(fixture.database, 'run_events'),
        assets: rowCount(fixture.database, 'global_media_assets'),
        outputs: rowCount(fixture.database, 'media_derivation_outputs'),
      }).toEqual(before);
    } finally {
      fixture.store.close();
    }
  });

  it('persists local failure and cooperative cancellation without outputs', async () => {
    const failedFixture = await harness();
    try {
      failedFixture.local.fail = true;
      const started = await failedFixture.data.mediaDerivations.start(
        {
          runId: failedFixture.run.id,
          commandId: 'command.local.fail.start',
          input: localVariants(failedFixture)[3]!,
        },
        failedFixture.context,
      );
      const failed = await failedFixture.data.mediaDerivations.continue(
        { dispatchOperationId: started.operation.id, commandId: 'command.local.fail.continue' },
        failedFixture.context,
      );
      expect(operationState(failedFixture, failed.operation).state).toBe('failed');
      expect(rowCount(failedFixture.database, 'media_derivation_outputs')).toBe(0);
    } finally {
      failedFixture.store.close();
    }

    const cancelledFixture = await harness();
    try {
      const started = await cancelledFixture.data.mediaDerivations.start(
        {
          runId: cancelledFixture.run.id,
          commandId: 'command.local.cancel.start',
          input: localVariants(cancelledFixture)[3]!,
        },
        cancelledFixture.context,
      );
      const requested = cancel(cancelledFixture, started.operation);
      const cancelled = await cancelledFixture.data.mediaDerivations.continue(
        {
          dispatchOperationId: requested.ref.id,
          commandId: 'command.local.cancel.continue',
        },
        cancelledFixture.context,
      );
      expect(operationState(cancelledFixture, cancelled.operation).state).toBe('cancelled');
      expect(cancelledFixture.local.calls).toHaveLength(0);
      expect(cancelledFixture.local.cancelCalls).toBe(1);
      expect(rowCount(cancelledFixture.database, 'media_derivation_outputs')).toBe(0);
    } finally {
      cancelledFixture.store.close();
    }
  });

  it('rolls back domain publication on a Project revision race while leaving only a CAS orphan', async () => {
    const fixture = await harness();
    try {
      const input = {
        ...localVariants(fixture)[3]!,
        attach: { enabled: true as const, expectedProjectRevision: fixture.project.revision },
        outputIntents: [
          {
            ...intent(0),
            projectMediaRef: {
              label: 'Derived',
              collections: [],
              roles: ['reference' as const],
              notes: '',
            },
          },
        ],
      };
      const started = await fixture.data.mediaDerivations.start(
        { runId: fixture.run.id, commandId: 'command.local.race.start', input },
        fixture.context,
      );
      fixture.local.beforeReturn = () => {
        fixture.data.projects.update(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.project.race',
            method: 'project.update',
            input: {
              projectId: fixture.project.id,
              expectedRevision: fixture.project.revision,
              name: 'Derivative Film revised',
              lifecycle: null,
            },
          },
          fixture.userContext,
        );
      };
      await expect(
        fixture.data.mediaDerivations.continue(
          { dispatchOperationId: started.operation.id, commandId: 'command.local.race.continue' },
          fixture.context,
        ),
      ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
      expect(rowCount(fixture.database, 'media_derivation_outputs')).toBe(0);
      expect(fixture.cas.objects.size).toBe(2);
    } finally {
      fixture.store.close();
    }
  });

  it('blocks finite-budget transcription before provider exposure', async () => {
    const fixture = await harness('known');
    try {
      await expect(
        fixture.data.mediaDerivations.start(
          {
            runId: fixture.run.id,
            commandId: 'command.transcribe.finite',
            input: transcriptionInput(fixture),
          },
          fixture.context,
        ),
      ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
      expect(fixture.transcription.submitCalls).toBe(0);
      expect(rowCount(fixture.database, 'media_derivation_attempts')).toBe(0);
    } finally {
      fixture.store.close();
    }
  });

  it('persists real transcription receipt, usage, output, and unknown-cost settlement', async () => {
    const fixture = await harness('unknown');
    try {
      const providerReceipt = receipt();
      const providerUsage = usage({ state: 'estimated', value: '1.25', currency: 'USD' });
      fixture.transcription.submitResult = {
        state: 'submitted',
        receipt: providerReceipt,
        usage: null,
        outputs: [],
      };
      fixture.transcription.reconcileResult = succeededProviderState(
        providerReceipt,
        providerUsage,
      );
      const started = await fixture.data.mediaDerivations.start(
        {
          runId: fixture.run.id,
          commandId: 'command.transcribe.start',
          input: transcriptionInput(fixture),
        },
        fixture.context,
      );
      expect(rowCount(fixture.database, 'run_resource_entries')).toBe(1);
      const completed = await fixture.data.mediaDerivations.continue(
        {
          dispatchOperationId: started.operation.id,
          commandId: 'command.transcribe.continue',
        },
        fixture.context,
      );
      expect(operationState(fixture, completed.operation)).toMatchObject({ state: 'succeeded' });
      expect(JSON.parse(operationState(fixture, completed.operation).receipt!)).toMatchObject({
        providerOperationId: providerReceipt.providerOperationId,
      });
      expect(JSON.parse(operationState(fixture, completed.operation).usage!)).toEqual(
        providerUsage,
      );
      expect(completed.globalAssets).toHaveLength(1);
      expect(fixture.transcription.submitCalls).toBe(1);
      expect(fixture.transcription.reconcileCalls).toBe(1);
      const ledger = fixture.database
        .prepare(
          `SELECT phase, reservation_entry_id, amount_v1_json
           FROM run_resource_entries ORDER BY rowid`,
        )
        .all() as Array<{
        phase: string;
        reservation_entry_id: string | null;
        amount_v1_json: string;
      }>;
      expect(ledger.map(({ phase }) => phase)).toEqual(['reserved', 'released', 'consumed']);
      expect(ledger[2]!.reservation_entry_id).toBeNull();
      expect(JSON.parse(ledger[2]!.amount_v1_json)).toEqual(providerUsage.cost);
    } finally {
      fixture.store.close();
    }
  });

  it('claims provider exposure durably and never resubmits after an unknown result', async () => {
    const fixture = await harness('unknown');
    try {
      fixture.transcription.failSubmit = true;
      const started = await fixture.data.mediaDerivations.start(
        {
          runId: fixture.run.id,
          commandId: 'command.transcribe.unknown.start',
          input: transcriptionInput(fixture),
        },
        fixture.context,
      );
      const unknown = await fixture.data.mediaDerivations.continue(
        {
          dispatchOperationId: started.operation.id,
          commandId: 'command.transcribe.unknown.submit',
        },
        fixture.context,
      );
      expect(operationState(fixture, unknown.operation).state).toBe('unknown');
      expect(fixture.transcription.submitCalls).toBe(1);
      fixture.transcription.failSubmit = false;
      fixture.transcription.reconcileResult = { state: 'not_submitted' };
      const failed = await fixture.data.mediaDerivations.continue(
        {
          dispatchOperationId: unknown.operation.id,
          commandId: 'command.transcribe.unknown.reconcile',
        },
        fixture.context,
      );
      expect(operationState(fixture, failed.operation).state).toBe('failed');
      expect(fixture.transcription.submitCalls).toBe(1);
      expect(fixture.transcription.reconcileCalls).toBe(1);
    } finally {
      fixture.store.close();
    }
  });

  it('rejects malformed provider responses without receipt or output writes', async () => {
    const fixture = await harness('unknown');
    try {
      fixture.transcription.submitResult = {
        state: 'succeeded',
        receipt: null,
        usage: null,
        outputs: [],
      };
      const started = await fixture.data.mediaDerivations.start(
        {
          runId: fixture.run.id,
          commandId: 'command.transcribe.malformed.start',
          input: transcriptionInput(fixture),
        },
        fixture.context,
      );
      await expect(
        fixture.data.mediaDerivations.continue(
          {
            dispatchOperationId: started.operation.id,
            commandId: 'command.transcribe.malformed.continue',
          },
          fixture.context,
        ),
      ).rejects.toMatchObject({ code: 'CORRUPT_DATA' });
      expect(operationState(fixture, started.operation)).toMatchObject({
        state: 'unknown',
        receipt: null,
      });
      expect(rowCount(fixture.database, 'media_derivation_outputs')).toBe(0);
    } finally {
      fixture.store.close();
    }
  });

  it('handles cancellation before exposure, receipt-less unknown, and provider success races', async () => {
    const beforeExposure = await harness('unknown');
    try {
      const started = await beforeExposure.data.mediaDerivations.start(
        {
          runId: beforeExposure.run.id,
          commandId: 'command.cancel.before.start',
          input: transcriptionInput(beforeExposure),
        },
        beforeExposure.context,
      );
      const requested = cancel(beforeExposure, started.operation);
      const terminal = await beforeExposure.data.mediaDerivations.continue(
        {
          dispatchOperationId: requested.ref.id,
          commandId: 'command.cancel.before.continue',
        },
        beforeExposure.context,
      );
      expect(operationState(beforeExposure, terminal.operation).state).toBe('cancelled');
      expect(beforeExposure.transcription.submitCalls).toBe(0);
      expect(beforeExposure.transcription.reconcileCalls).toBe(0);
    } finally {
      beforeExposure.store.close();
    }

    const receiptless = await harness('unknown');
    try {
      receiptless.transcription.failSubmit = true;
      const started = await receiptless.data.mediaDerivations.start(
        {
          runId: receiptless.run.id,
          commandId: 'command.cancel.receiptless.start',
          input: transcriptionInput(receiptless),
        },
        receiptless.context,
      );
      const unknown = await receiptless.data.mediaDerivations.continue(
        {
          dispatchOperationId: started.operation.id,
          commandId: 'command.cancel.receiptless.submit',
        },
        receiptless.context,
      );
      const requested = cancel(receiptless, unknown.operation);
      receiptless.transcription.reconcileResult = { state: 'not_submitted' };
      const terminal = await receiptless.data.mediaDerivations.continue(
        {
          dispatchOperationId: requested.ref.id,
          commandId: 'command.cancel.receiptless.reconcile',
        },
        receiptless.context,
      );
      expect(operationState(receiptless, terminal.operation).state).toBe('cancelled');
      expect(receiptless.transcription.submitCalls).toBe(1);
      expect(receiptless.transcription.reconcileCalls).toBe(1);
    } finally {
      receiptless.store.close();
    }

    const successRace = await harness('unknown');
    try {
      const providerReceipt = receipt('provider.operation.cancel-race');
      const providerUsage = usage({ state: 'known', value: '2', currency: 'USD' });
      successRace.transcription.submitResult = {
        state: 'submitted',
        receipt: providerReceipt,
        usage: null,
        outputs: [],
      };
      successRace.transcription.reconcileResult = {
        state: 'submitted',
        receipt: providerReceipt,
        usage: null,
        outputs: [],
      };
      successRace.transcription.cancelResult = succeededProviderState(
        providerReceipt,
        providerUsage,
      );
      const started = await successRace.data.mediaDerivations.start(
        {
          runId: successRace.run.id,
          commandId: 'command.cancel.race.start',
          input: transcriptionInput(successRace),
        },
        successRace.context,
      );
      const submitted = await successRace.data.mediaDerivations.continue(
        {
          dispatchOperationId: started.operation.id,
          commandId: 'command.cancel.race.submit',
        },
        successRace.context,
      );
      expect(operationState(successRace, submitted.operation).state).toBe('submitted');
      const requested = cancel(successRace, submitted.operation);
      const succeeded = await successRace.data.mediaDerivations.continue(
        {
          dispatchOperationId: requested.ref.id,
          commandId: 'command.cancel.race.cancel',
        },
        successRace.context,
      );
      expect(operationState(successRace, succeeded.operation).state).toBe('succeeded');
      expect(successRace.transcription.cancelCalls).toBe(1);
      expect(succeeded.globalAssets).toHaveLength(1);
    } finally {
      successRace.store.close();
    }
  }, 30_000);
});
