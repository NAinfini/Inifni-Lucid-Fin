import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CapabilityCatalogSnapshotV1Schema,
  generationPromptAssemblyHashInput,
  generationQuoteHashInput,
  providerReceiptHashInput,
  type GenerationQuote,
  type GenerationSpec,
  type ProviderReceipt,
} from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import { registerStoreDatabase, unregisterStoreDatabase } from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import type {
  GenerationProviderAdapter,
  GenerationProviderCancelRequest,
  GenerationProviderQuoteRequest,
  GenerationProviderReconcileRequest,
  GenerationProviderState,
  GenerationProviderSubmitRequest,
} from '../kernel/generation-provider.js';
import { createDataAccess } from '../kernel/data-access.js';
import type {
  MediaCas,
  MediaCasExpectedObject,
  MediaImportCapabilityResolver,
} from '../kernel/media-cas.js';
import type { Store } from '../kernel/store.js';

const NOW = '2026-08-16T12:00:00.000Z';
const EXPIRES_AT = '2026-08-17T12:00:00.000Z';
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../contracts/generated/tool-catalog.v1.json', import.meta.url),
      'utf8',
    ),
  ),
);
const budget = {
  costUsd: { state: 'known' as const, value: '20', currency: 'USD' },
  maxGenerationCount: 12,
  maxInputTokens: 100_000,
  maxOutputTokens: 20_000,
};
const formatPolicy = { aspectRatio: '16:9' as const, customDimensions: null, frameRate: 24 };

function receipt(): ProviderReceipt {
  const value = {
    providerOperationId: 'provider.operation.1',
    submittedAt: NOW,
    reconciledAt: null,
    receiptHash: '',
  };
  return { ...value, receiptHash: hashCanonical(providerReceiptHashInput(value)) };
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function usage() {
  return {
    inputTokens: { state: 'known' as const, value: 0 },
    outputTokens: { state: 'known' as const, value: 0 },
    generatedUnits: { state: 'known' as const, value: 1 },
    cost: { state: 'known' as const, value: '1', currency: 'USD' },
  };
}

function succeeded(bytes: Uint8Array): GenerationProviderState {
  return {
    state: 'succeeded',
    receipt: receipt(),
    usage: usage(),
    outputs: [
      {
        variantIndex: 0,
        blob: {
          hash: sha256(bytes),
          byteLength: bytes.byteLength,
          mimeType: 'image/png',
          technicalFacts: { kind: 'image', width: 1280, height: 720 },
          publication: {
            state: 'pending',
            bytes: (async function* () {
              yield bytes;
            })(),
          },
        },
        technicalValidation: {
          state: 'valid',
          mimeTypeValid: true,
          dimensionsValid: true,
          durationValid: null,
          failureCode: null,
        },
      },
    ],
  };
}

class FakeGenerationProvider implements GenerationProviderAdapter {
  readonly providerKind = 'openai';
  quoteState: GenerationQuote['state'] = 'known';
  quoteAmount = '2';
  quoteCalls = 0;
  submitCalls = 0;
  reconcileCalls = 0;
  cancelCalls = 0;
  onSubmit: (() => void | Promise<void>) | null = null;
  onCancel: (() => void | Promise<void>) | null = null;
  readonly submitStates: GenerationProviderState[] = [];
  readonly reconcileStates: GenerationProviderState[] = [];
  readonly cancelStates: GenerationProviderState[] = [];

  async quote(request: GenerationProviderQuoteRequest) {
    this.quoteCalls += 1;
    const common = {
      quoteId: 'generation.quote.1',
      quotedRequestHash: request.requestHash,
      currency: 'USD',
      expiresAt: EXPIRES_AT,
      providerId: request.profile.id,
      model: request.profile.model.model,
      quoteHash: '',
    };
    const value: GenerationQuote =
      this.quoteState === 'unknown'
        ? { state: 'unknown', ...common }
        : { state: this.quoteState, ...common, amount: this.quoteAmount };
    const quote: GenerationQuote = {
      ...value,
      quoteHash: hashCanonical(generationQuoteHashInput(value)),
    };
    return { quote, estimatedDurationMs: 1_000, constraints: [] };
  }

  async submit(_request: GenerationProviderSubmitRequest): Promise<GenerationProviderState> {
    this.submitCalls += 1;
    await this.onSubmit?.();
    return (
      this.submitStates.shift() ?? {
        state: 'submitted',
        receipt: receipt(),
        usage: null,
        outputs: [],
      }
    );
  }

  async reconcileByIdempotencyKey(
    _request: GenerationProviderReconcileRequest,
  ): Promise<GenerationProviderState> {
    this.reconcileCalls += 1;
    return (
      this.reconcileStates.shift() ?? {
        state: 'submitted',
        receipt: receipt(),
        usage: null,
        outputs: [],
      }
    );
  }

  async cancel(_request: GenerationProviderCancelRequest): Promise<GenerationProviderState> {
    this.cancelCalls += 1;
    await this.onCancel?.();
    return (
      this.cancelStates.shift() ?? {
        state: 'unknown',
        receipt: receipt(),
        usage: null,
        outputs: [],
      }
    );
  }
}

class MemoryMediaCas implements MediaCas {
  readonly objects = new Map<string, Uint8Array>();
  putCalls = 0;
  onPut: (() => void | Promise<void>) | null = null;

  async putVerified(expected: MediaCasExpectedObject, source: AsyncIterable<Uint8Array>) {
    this.putCalls += 1;
    await this.onPut?.();
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (sha256(bytes) !== expected.hash || bytes.byteLength !== expected.byteLength) {
      throw new Error('fixture bytes do not match');
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
    const bytes = this.objects.get(expected.hash);
    if (
      bytes === undefined ||
      bytes.byteLength !== expected.byteLength ||
      sha256(bytes) !== expected.hash
    ) {
      throw new Error('fixture CAS corruption');
    }
  }

  openVerified(expected: MediaCasExpectedObject) {
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

const unusedCapabilities: MediaImportCapabilityResolver = {
  async resolve() {
    throw new Error('unused');
  },
};

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return `${kind}.${count}`;
  };
}

function memoryStore(): { store: Store; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  database.exec(
    readFileSync(new URL('../../../contracts/ddl/project-v1.sql', import.meta.url), 'utf8'),
  );
  let open = true;
  const store: Store = {
    databasePath: ':memory:',
    schemaFingerprint: {} as Store['schemaFingerprint'],
    security: { defensive: true, extensionLoading: false, foreignKeys: true },
    close() {
      if (!open) return;
      open = false;
      unregisterStoreDatabase(store);
      database.close();
    },
  };
  registerStoreDatabase(store, database);
  return { store, database };
}

async function harness(
  options: {
    readonly budgetCost?: string;
    readonly quoteState?: GenerationQuote['state'];
    readonly quoteAmount?: string;
  } = {},
) {
  const { store, database } = memoryStore();
  const provider = new FakeGenerationProvider();
  provider.quoteState = options.quoteState ?? 'known';
  provider.quoteAmount = options.quoteAmount ?? '2';
  const mediaCas = new MemoryMediaCas();
  const data = createDataAccess(store, {
    now: () => NOW,
    createId: deterministicIds(),
    mediaCas,
    mediaImportCapabilities: unusedCapabilities,
    generationProvider: provider,
  });
  const userContext = {
    actor: 'user' as const,
    causation: { kind: 'direct_ui' as const, actionId: 'action.generation.setup' },
    correlationId: 'correlation.generation.setup',
  };
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.generation',
      method: 'project.create',
      input: {
        name: 'Generation Film',
        permissionMode: 'reversible',
        budget: {
          ...budget,
          costUsd: { ...budget.costUsd, value: options.budgetCost ?? budget.costUsd.value },
        },
        formatPolicy,
      },
    },
    userContext,
  ).result.project;
  database
    .prepare(
      `INSERT INTO provider_profiles (
         id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
         credential_handle, status, configuration_v1_json, revision, created_at, updated_at
       ) VALUES ('provider.1', 'Provider', 'openai', 'video-model', NULL, NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const target = data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.production.generation',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Opening shot',
            description: 'A moonlit harbor.',
            durationMs: null,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    userContext,
  ).result.object;
  expect(target.type).toBe('shot');
  if (target.type === 'shot') expect(target.resultDecisions).toEqual([]);
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.generation',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    userContext,
  ).result;
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.generation',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Generate the opening frame.' }],
        attachments: [],
        selectedContext: [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    userContext,
    {
      model: { providerId: 'provider.1', model: 'video-model', reasoningStrength: null },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  const spec: GenerationSpec = {
    kind: 'image',
    task: 'create',
    target: {
      authority: 'production',
      id: target.id,
      revision: target.revision,
      contentHash: target.contentHash,
    },
    prompt: 'A cinematic moonlit harbor.',
    negativePrompt: null,
    references: [],
    provider: { providerId: 'provider.1', model: 'video-model' },
    outputCount: 1,
    seed: 7,
    width: 1280,
    height: 720,
    guidanceScale: null,
    sourceMaskRefId: null,
  };
  const quoted = await data.generation.quote({ runId: run.id, request: { spec } });
  const request = {
    spec,
    quote: quoted.quote,
    expectedProjectRevision: project.revision,
    promptProvenance: {
      sourceObjectId: spec.target.id,
      sourceRevision: spec.target.revision,
      sourceHash: spec.target.contentHash,
      assemblyHash: hashCanonical(
        generationPromptAssemblyHashInput({
          target: spec.target,
          prompt: spec.prompt,
          negativePrompt: spec.negativePrompt,
          references: spec.references,
          loadedSkillDigests: [],
        }),
      ),
      loadedSkillDigests: [],
    },
    outputIntents: [
      {
        variantIndex: 0,
        globalAsset: {
          filename: 'opening.png',
          displayName: 'Opening',
          folderId: null,
          tags: ['generated'],
        },
        projectMediaRef: {
          label: 'Opening',
          collections: [],
          roles: ['generated_candidate' as const],
          notes: '',
        },
      },
    ],
  };
  return {
    store,
    database,
    data,
    provider,
    mediaCas,
    run,
    request,
    context: {
      actor: 'commander' as const,
      causation: { kind: 'run' as const, runId: run.id },
      correlationId: 'correlation.generation',
    },
  };
}

describe('I2-F4 Generation authority', () => {
  it('commits the running Attempt, F2 dispatch, and reservations before provider submission', async () => {
    const fixture = await harness();
    try {
      expect(fixture.data.taskLists.get(fixture.run.id)).toBeNull();
      let committedState: unknown;
      fixture.provider.onSubmit = () => {
        committedState = {
          isTransaction: fixture.database.isTransaction,
          attempt: fixture.database.prepare('SELECT state FROM generation_attempts').get(),
          dispatches: fixture.database
            .prepare('SELECT COUNT(*) AS count FROM dispatch_operations')
            .get(),
          reservations: fixture.database
            .prepare("SELECT COUNT(*) AS count FROM run_resource_entries WHERE phase = 'reserved'")
            .get(),
        };
      };

      const result = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.submit',
          request: fixture.request,
        },
        fixture.context,
      );

      expect(committedState).toEqual({
        isTransaction: false,
        attempt: { state: 'running' },
        dispatches: { count: 1 },
        reservations: { count: 2 },
      });
      expect(result.state).toBe('submitted');
      expect(fixture.provider.submitCalls).toBe(1);
    } finally {
      fixture.store.close();
    }
  });

  it('replays the same fingerprint without requoting, resubmitting, or writing rows', async () => {
    const fixture = await harness();
    try {
      const first = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.first',
          request: fixture.request,
        },
        fixture.context,
      );
      const counts = () => ({
        requests: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM generation_requests')
          .get(),
        attempts: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM generation_attempts')
          .get(),
        dispatches: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM dispatch_operations')
          .get(),
        resources: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_resource_entries')
          .get(),
        events: fixture.database.prepare('SELECT COUNT(*) AS count FROM run_events').get(),
      });
      const committed = counts();

      const replay = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.replay',
          request: fixture.request,
        },
        fixture.context,
      );

      expect(replay).toEqual(first);
      expect(counts()).toEqual(committed);
      expect(fixture.provider).toMatchObject({ quoteCalls: 2, submitCalls: 1 });
    } finally {
      fixture.store.close();
    }
  });

  it('persists the provider receipt before publishing successful output bytes to CAS', async () => {
    const fixture = await harness();
    try {
      fixture.provider.submitStates.push(succeeded(Buffer.from('generated-opening-frame')));
      let stateAtCas: unknown;
      fixture.mediaCas.onPut = () => {
        stateAtCas = fixture.database
          .prepare('SELECT state, receipt_v1_json FROM generation_attempts')
          .get();
      };

      const result = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.success',
          request: fixture.request,
        },
        fixture.context,
      );

      expect(stateAtCas).toMatchObject({ state: 'submitted' });
      expect((stateAtCas as { receipt_v1_json: string }).receipt_v1_json).toContain(
        'provider.operation.1',
      );
      expect(result).toMatchObject({
        state: 'succeeded',
        immediateResults: [{ technicalState: 'valid' }],
      });
      expect(fixture.mediaCas.putCalls).toBe(1);
    } finally {
      fixture.store.close();
    }
  });

  it('never resubmits receiptless unknown until authoritative reconcile reports not_submitted', async () => {
    const fixture = await harness();
    try {
      fixture.provider.submitStates.push({
        state: 'unknown',
        receipt: null,
        usage: null,
        outputs: [],
      });
      const unknown = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.unknown',
          request: fixture.request,
        },
        fixture.context,
      );
      const replay = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.unknown.replay',
          request: fixture.request,
        },
        fixture.context,
      );

      expect(unknown.state).toBe('unknown');
      expect(replay).toEqual(unknown);
      expect(fixture.provider).toMatchObject({ submitCalls: 1, reconcileCalls: 0 });

      fixture.provider.reconcileStates.push({ state: 'not_submitted' });
      fixture.provider.submitStates.push({
        state: 'submitted',
        receipt: receipt(),
        usage: null,
        outputs: [],
      });
      const reconciled = await fixture.data.generation.reconcile(
        {
          operation: unknown.operation,
          expectedRevision: unknown.operation.revision,
          commandId: 'command.generation.reconcile',
        },
        fixture.context,
      );

      expect(reconciled.state).toBe('submitted');
      expect(reconciled.attemptId).toBe(unknown.attemptId);
      expect(fixture.provider).toMatchObject({ submitCalls: 2, reconcileCalls: 1 });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM generation_attempts').get(),
      ).toEqual({ count: 1 });
    } finally {
      fixture.store.close();
    }
  });

  it('blocks finite-cap, unknown, and over-cap estimated quotes before provider submission', async () => {
    const cases = [
      { budgetCost: '1', quoteState: 'known' as const, quoteAmount: '2' },
      { budgetCost: '20', quoteState: 'unknown' as const, quoteAmount: '2' },
      { budgetCost: '1', quoteState: 'estimated' as const, quoteAmount: '2' },
    ];
    for (const [index, options] of cases.entries()) {
      const fixture = await harness(options);
      try {
        await expect(
          fixture.data.generation.submit(
            {
              runId: fixture.run.id,
              commandId: `command.generation.budget.${index}`,
              request: fixture.request,
            },
            fixture.context,
          ),
        ).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        expect(fixture.provider.submitCalls).toBe(0);
        expect(
          fixture.database.prepare('SELECT COUNT(*) AS count FROM generation_requests').get(),
        ).toEqual({ count: 0 });
        expect(
          fixture.database.prepare('SELECT COUNT(*) AS count FROM run_resource_entries').get(),
        ).toEqual({ count: 0 });
      } finally {
        fixture.store.close();
      }
    }
  });

  it('rolls back publication rows after CAS and replays a lost DB response without duplicates', async () => {
    const fixture = await harness();
    try {
      fixture.provider.submitStates.push({
        state: 'submitted',
        receipt: receipt(),
        usage: null,
        outputs: [],
      });
      const submitted = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.atomic.submit',
          request: fixture.request,
        },
        fixture.context,
      );
      fixture.database.exec(
        `CREATE TRIGGER fail_generated_result
         BEFORE INSERT ON generated_results
         BEGIN SELECT RAISE(ABORT, 'injected generation publication failure'); END`,
      );
      fixture.provider.reconcileStates.push(succeeded(Buffer.from('atomic-generated-frame')));
      await expect(
        fixture.data.generation.reconcile(
          {
            operation: submitted.operation,
            expectedRevision: submitted.operation.revision,
            commandId: 'command.generation.atomic.fail',
          },
          fixture.context,
        ),
      ).rejects.toThrow('injected generation publication failure');

      for (const table of [
        'media_blobs',
        'global_media_assets',
        'project_media_refs',
        'project_media_links',
        'generated_results',
      ]) {
        expect(fixture.database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({
          count: 0,
        });
      }
      expect(fixture.mediaCas.objects.size).toBe(1);
      fixture.database.exec('DROP TRIGGER fail_generated_result');
      const current = fixture.data.operations.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.operation.atomic.current',
        method: 'operation.get',
        input: { operations: [submitted.operation] },
      }).result.operations[0]!;
      fixture.provider.reconcileStates.push(succeeded(Buffer.from('atomic-generated-frame')));
      const succeededResult = await fixture.data.generation.reconcile(
        {
          operation: current.ref,
          expectedRevision: current.ref.revision,
          commandId: 'command.generation.atomic.retry',
        },
        fixture.context,
      );
      const committed = {
        blobs: fixture.database.prepare('SELECT COUNT(*) AS count FROM media_blobs').get(),
        assets: fixture.database.prepare('SELECT COUNT(*) AS count FROM global_media_assets').get(),
        refs: fixture.database.prepare('SELECT COUNT(*) AS count FROM project_media_refs').get(),
        links: fixture.database.prepare('SELECT COUNT(*) AS count FROM project_media_links').get(),
        results: fixture.database.prepare('SELECT COUNT(*) AS count FROM generated_results').get(),
        resultEvents: fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'generated_result_recorded'",
          )
          .get(),
        resources: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_resource_entries')
          .get(),
      };
      const reconciles = fixture.provider.reconcileCalls;
      const puts = fixture.mediaCas.putCalls;

      const responseReplay = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.atomic.response-lost',
          request: fixture.request,
        },
        fixture.context,
      );
      const afterReplay = {
        blobs: fixture.database.prepare('SELECT COUNT(*) AS count FROM media_blobs').get(),
        assets: fixture.database.prepare('SELECT COUNT(*) AS count FROM global_media_assets').get(),
        refs: fixture.database.prepare('SELECT COUNT(*) AS count FROM project_media_refs').get(),
        links: fixture.database.prepare('SELECT COUNT(*) AS count FROM project_media_links').get(),
        results: fixture.database.prepare('SELECT COUNT(*) AS count FROM generated_results').get(),
        resultEvents: fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'generated_result_recorded'",
          )
          .get(),
        resources: fixture.database
          .prepare('SELECT COUNT(*) AS count FROM run_resource_entries')
          .get(),
      };

      expect(succeededResult.state).toBe('succeeded');
      expect(responseReplay).toEqual(succeededResult);
      expect(committed).toMatchObject({
        blobs: { count: 1 },
        assets: { count: 1 },
        refs: { count: 1 },
        links: { count: 1 },
        results: { count: 1 },
        resultEvents: { count: 1 },
      });
      expect(afterReplay).toEqual(committed);
      expect(fixture.provider.reconcileCalls).toBe(reconciles);
      expect(fixture.mediaCas.putCalls).toBe(puts);
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM generated_results').get(),
      ).toEqual({ count: 1 });
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'generated_result_recorded'",
          )
          .get(),
      ).toEqual({ count: 1 });
    } finally {
      fixture.store.close();
    }
  });

  it('lets one cancel claimant preserve a provider race that actually succeeded with usage', async () => {
    const fixture = await harness();
    try {
      fixture.provider.submitStates.push({
        state: 'submitted',
        receipt: receipt(),
        usage: null,
        outputs: [],
      });
      const submitted = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.cancel.submit',
          request: fixture.request,
        },
        fixture.context,
      );
      const cancelled = fixture.data.operations.cancel(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.operation.generation.cancel',
          method: 'operation.cancel',
          input: {
            operations: [
              {
                ref: submitted.operation,
                expectedRevision: submitted.operation.revision,
                expectedState: 'submitted',
              },
            ],
          },
        },
        fixture.context,
      ).result.operations[0]!;
      let announceCancel!: () => void;
      let releaseCancel!: () => void;
      const cancelStarted = new Promise<void>((resolve) => (announceCancel = resolve));
      const cancelGate = new Promise<void>((resolve) => (releaseCancel = resolve));
      fixture.provider.onCancel = async () => {
        announceCancel();
        await cancelGate;
      };
      fixture.provider.cancelStates.push(succeeded(Buffer.from('won-cancel-race')));
      const input = {
        operation: cancelled.ref,
        expectedRevision: cancelled.ref.revision,
        commandId: 'command.generation.cancel.reconcile',
      };
      const first = fixture.data.generation.reconcile(input, fixture.context);
      await cancelStarted;
      const second = fixture.data.generation.reconcile(input, fixture.context);
      releaseCancel();
      const settled = await Promise.allSettled([first, second]);

      expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1);
      expect(fixture.provider.cancelCalls).toBe(1);
      expect(settled.find(({ status }) => status === 'fulfilled')).toMatchObject({
        status: 'fulfilled',
        value: { state: 'succeeded' },
      });
      expect(
        fixture.database
          .prepare('SELECT state, usage_v1_json, public_error_code FROM generation_attempts')
          .get(),
      ).toMatchObject({ state: 'succeeded', public_error_code: null });
      expect(
        JSON.parse(
          (
            fixture.database.prepare('SELECT usage_v1_json FROM generation_attempts').get() as {
              usage_v1_json: string;
            }
          ).usage_v1_json,
        ),
      ).toEqual(usage());
    } finally {
      fixture.store.close();
    }
  });

  it('never persists or returns raw provider secret sentinels', async () => {
    const fixture = await harness();
    const sentinel = 'RAW_PROVIDER_SECRET_SENTINEL_7f1a';
    try {
      fixture.provider.submitStates.push({
        state: 'unknown',
        receipt: null,
        usage: null,
        outputs: [],
        secret: sentinel,
      } as unknown as GenerationProviderState);

      const result = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.privacy',
          request: fixture.request,
        },
        fixture.context,
      );
      const publicView = fixture.data.operations.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.operation.generation.privacy',
        method: 'operation.get',
        input: { operations: [result.operation] },
      }).result.operations[0];
      const persisted = JSON.stringify({
        requests: fixture.database.prepare('SELECT * FROM generation_requests').all(),
        attempts: fixture.database.prepare('SELECT * FROM generation_attempts').all(),
        dispatches: fixture.database.prepare('SELECT * FROM dispatch_operations').all(),
        resources: fixture.database.prepare('SELECT * FROM run_resource_entries').all(),
        runEvents: fixture.database.prepare('SELECT * FROM run_events').all(),
        runPayloads: fixture.database.prepare('SELECT * FROM run_event_payloads').all(),
        projectEvents: fixture.database.prepare('SELECT * FROM project_events').all(),
        search: fixture.database.prepare('SELECT * FROM project_search_documents').all(),
      });

      expect(result.state).toBe('unknown');
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(JSON.stringify(publicView)).not.toContain(sentinel);
      expect(persisted).not.toContain(sentinel);
    } finally {
      fixture.store.close();
    }
  });

  it('does not use a blocked Commander TaskList as a Generation gate', async () => {
    const fixture = await harness();
    try {
      const currentRun = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.run.generation.task-list',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      const created = fixture.data.taskLists.manage(
        fixture.run.id,
        {
          action: 'create',
          expectedRunRevision: currentRun.revision,
          title: 'Generation progress',
          tasks: [
            {
              draftId: 'draft.generation',
              title: 'Waiting on a separate decision',
              parentDraftId: null,
              order: 0,
            },
          ],
          publicSummary: 'Tracking generation progress.',
        },
        { commandId: 'command.task-list.create', context: fixture.context },
      ).taskList!;
      const blocked = fixture.data.taskLists.manage(
        fixture.run.id,
        {
          action: 'update',
          expectedRevision: created.revision,
          taskId: created.items[0]!.id,
          title: null,
          state: 'blocked',
          resultSummary: 'Waiting for an unrelated choice.',
          childRunId: null,
          publicSummary: 'Marked the unrelated task blocked.',
        },
        { commandId: 'command.task-list.block', context: fixture.context },
      ).taskList!;

      const result = await fixture.data.generation.submit(
        {
          runId: fixture.run.id,
          commandId: 'command.generation.with-blocked-task',
          request: fixture.request,
        },
        fixture.context,
      );

      expect(blocked.items[0]!.state).toBe('blocked');
      expect(result.state).toBe('submitted');
      expect(fixture.provider.submitCalls).toBe(1);
    } finally {
      fixture.store.close();
    }
  });
});
