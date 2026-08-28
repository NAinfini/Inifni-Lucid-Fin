import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CapabilityCatalogSnapshotV1Schema,
  canonicalJson,
  generationPromptAssemblyHashInput,
  generationQuoteHashInput,
  providerReceiptHashInput,
  type ConfirmationTarget,
  type GeneratedResult,
  type GenerationQuote,
  type GenerationSpec,
  type ProviderReceipt,
} from '@lucid-fin/contracts';
import { describe, expect, it } from 'vitest';
import { registerStoreDatabase, unregisterStoreDatabase } from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { loadGeneratedResultRecord } from '../internal/operation-owner-records.js';
import { resolveOperationDispatchKey } from '../internal/operation-dispatch.js';
import { createDataAccess } from '../kernel/data-access.js';
import type {
  GenerationProviderAdapter,
  GenerationProviderState,
} from '../kernel/generation-provider.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import type {
  ResultAssessmentProviderAdapter,
  ResultAssessmentProviderState,
} from '../kernel/result-assessment-provider.js';
import type { Store } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import {
  applyDeliveryInTransaction,
  planDeliveryMutationInTransaction,
  plannedDeliveryMutationIds,
} from './delivery.js';

const NOW = '2026-08-16T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
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

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function receipt(id = 'provider.operation.delivery.fixture'): ProviderReceipt {
  const value = {
    providerOperationId: id,
    submittedAt: NOW,
    reconciledAt: null,
    receiptHash: '',
  };
  return { ...value, receiptHash: hashCanonical(providerReceiptHashInput(value)) };
}

class FixtureGenerationProvider implements GenerationProviderAdapter {
  readonly providerKind = 'openai';

  async quote(request: Parameters<GenerationProviderAdapter['quote']>[0]) {
    const value: GenerationQuote = {
      state: 'known',
      quoteId: 'generation.quote.delivery.fixture',
      quotedRequestHash: request.requestHash,
      amount: '2',
      currency: 'USD',
      expiresAt: '2026-08-17T12:00:00.000Z',
      providerId: request.profile.id,
      model: request.profile.model.model,
      quoteHash: '',
    };
    return {
      quote: { ...value, quoteHash: hashCanonical(generationQuoteHashInput(value)) },
      estimatedDurationMs: 1_000,
      constraints: [],
    };
  }

  async submit(): Promise<GenerationProviderState> {
    const outputs = [Buffer.from('delivery-video-one'), Buffer.from('delivery-video-two')].map(
      (bytes, variantIndex) => ({
        variantIndex,
        blob: {
          hash: sha256(bytes),
          byteLength: bytes.byteLength,
          mimeType: 'video/mp4',
          technicalFacts: {
            kind: 'video' as const,
            width: 1_920,
            height: 1_080,
            durationMs: 10_000,
            frameRate: 24,
            hasAudio: true,
          },
          publication: {
            state: 'pending' as const,
            bytes: (async function* () {
              yield bytes;
            })(),
          },
        },
        technicalValidation: {
          state: 'valid' as const,
          mimeTypeValid: true,
          dimensionsValid: true,
          durationValid: true,
          failureCode: null,
        },
      }),
    );
    return {
      state: 'succeeded',
      receipt: receipt(),
      usage: {
        inputTokens: { state: 'known', value: 0 },
        outputTokens: { state: 'known', value: 0 },
        generatedUnits: { state: 'known', value: 2 },
        cost: { state: 'known', value: '2', currency: 'USD' },
      },
      outputs,
    };
  }

  async reconcileByIdempotencyKey(): Promise<GenerationProviderState> {
    return { state: 'not_submitted' };
  }

  async cancel(): Promise<GenerationProviderState> {
    return { state: 'not_submitted' };
  }
}

class FixtureAssessmentProvider implements ResultAssessmentProviderAdapter {
  readonly providerKind = 'openai';

  async quote() {
    return { cost: { state: 'known' as const, value: '1', currency: 'USD' } };
  }

  async submit(
    request: Parameters<ResultAssessmentProviderAdapter['submit']>[0],
  ): Promise<ResultAssessmentProviderState> {
    const subject = request.subjects.find((entry) => entry.role === 'subject')!.ref;
    return {
      state: 'succeeded',
      receipt: receipt('provider.operation.delivery.assessment'),
      usage: {
        inputTokens: { state: 'known', value: 0 },
        outputTokens: { state: 'known', value: 0 },
        generatedUnits: { state: 'known', value: 0 },
        cost: { state: 'known', value: '1', currency: 'USD' },
      },
      assessment: {
        findings: [
          {
            severity: 'error',
            subjectRef: subject,
            criterion: 'creative_preference',
            finding: 'The evaluator dislikes this otherwise valid clip.',
            evidenceRefs: [subject],
          },
        ],
        limitations: [],
        recommendations: ['Use only if the user explicitly chooses it.'],
        artifacts: [],
      },
    };
  }

  async reconcileByIdempotencyKey(): Promise<ResultAssessmentProviderState> {
    return { state: 'not_submitted' };
  }

  async cancel(): Promise<ResultAssessmentProviderState> {
    return { state: 'cancelled', receipt: null, usage: null };
  }
}

class MemoryMediaCas implements MediaCas {
  readonly objects = new Map<string, Uint8Array>();

  async putVerified(
    expected: { hash: string; byteLength: number },
    source: AsyncIterable<Uint8Array>,
  ) {
    const chunks: Uint8Array[] = [];
    for await (const chunk of source) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    if (sha256(bytes) !== expected.hash || bytes.byteLength !== expected.byteLength) {
      throw new Error('fixture CAS mismatch');
    }
    const disposition = this.objects.has(expected.hash) ? 'existing' : 'created';
    this.objects.set(expected.hash, bytes);
    return { ...expected, disposition } as const;
  }

  async stat(hash: string) {
    const bytes = this.objects.get(hash);
    return bytes === undefined ? null : { hash, byteLength: bytes.byteLength };
  }

  async verify(expected: { hash: string; byteLength: number }) {
    const bytes = this.objects.get(expected.hash);
    if (
      bytes === undefined ||
      bytes.byteLength !== expected.byteLength ||
      sha256(bytes) !== expected.hash
    ) {
      throw new Error('fixture CAS corruption');
    }
  }

  openVerified(expected: { hash: string; byteLength: number }) {
    const verify = () => this.verify(expected);
    const readBytes = () => this.objects.get(expected.hash)!;
    return {
      async *[Symbol.asyncIterator]() {
        await verify();
        yield Uint8Array.from(readBytes());
      },
    };
  }
}

const unusedCapabilities: MediaImportCapabilityResolver = {
  async resolve() {
    throw new Error('unused');
  },
};

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

function deterministicIds() {
  const counts = new Map<string, number>();
  return (kind: string) => {
    const count = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, count);
    return `${kind}.${count}`;
  };
}

async function harness() {
  const { store, database } = memoryStore();
  const data = createDataAccess(store, {
    now: () => NOW,
    createId: deterministicIds(),
    mediaCas: new MemoryMediaCas(),
    mediaImportCapabilities: unusedCapabilities,
    generationProvider: new FixtureGenerationProvider(),
    resultAssessmentProvider: new FixtureAssessmentProvider(),
  });
  const userContext = {
    actor: 'user' as const,
    causation: { kind: 'direct_ui' as const, actionId: 'action.delivery.fixture' },
    correlationId: 'correlation.delivery.fixture',
  };
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.delivery.full',
      method: 'project.create',
      input: {
        name: 'Delivery Film',
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
       ) VALUES ('provider.delivery.fixture', 'Provider', 'openai', 'video-model', NULL, NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const shot = data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.shot.delivery.fixture',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Opening',
            description: 'Moonlit harbor',
            durationMs: 10_000,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    userContext,
  ).result.object;
  if (shot.type !== 'shot') throw new Error('fixture shot');
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.delivery.fixture',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    userContext,
  ).result;
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.delivery.fixture',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: 'Generate candidates.' }],
        attachments: [],
        selectedContext: [],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    userContext,
    {
      model: {
        providerId: 'provider.delivery.fixture',
        model: 'video-model',
        reasoningStrength: null,
      },
      locale: 'en-US',
      timeZone: 'America/New_York',
      capabilityCatalog: rootCatalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    },
  ).result.acceptedRun;
  const spec: GenerationSpec = {
    kind: 'video',
    task: 'create',
    target: {
      authority: 'production',
      id: shot.id,
      revision: shot.revision,
      contentHash: shot.contentHash,
    },
    prompt: 'Moonlit harbor',
    negativePrompt: null,
    references: [],
    provider: { providerId: 'provider.delivery.fixture', model: 'video-model' },
    outputCount: 2,
    seed: 7,
    width: 1_920,
    height: 1_080,
    durationMs: 10_000,
    frameRate: 24,
    includeAudio: true,
  };
  const quoted = await data.generation.quote({ runId: run.id, request: { spec } });
  await data.generation.submit(
    {
      runId: run.id,
      commandId: 'command.generation.delivery.fixture',
      request: {
        spec,
        quote: quoted.quote,
        expectedProjectRevision: project.revision,
        promptProvenance: {
          sourceObjectId: shot.id,
          sourceRevision: shot.revision,
          sourceHash: shot.contentHash,
          assemblyHash: hashCanonical(
            generationPromptAssemblyHashInput({
              target: spec.target,
              prompt: spec.prompt,
              negativePrompt: spec.negativePrompt,
              references: [],
              loadedSkillDigests: [],
            }),
          ),
          loadedSkillDigests: [],
        },
        outputIntents: [0, 1].map((variantIndex) => ({
          variantIndex,
          globalAsset: {
            filename: `result-${variantIndex}.mp4`,
            displayName: `Result ${variantIndex}`,
            folderId: null,
            tags: [],
          },
          projectMediaRef: {
            label: `Result ${variantIndex}`,
            collections: [],
            roles: ['generated_candidate' as const],
            notes: '',
          },
        })),
      },
    },
    {
      actor: 'commander',
      causation: { kind: 'run', runId: run.id },
      correlationId: 'correlation.generation.delivery.fixture',
    },
  );
  const resultIds = database
    .prepare('SELECT id FROM generated_results ORDER BY variant_index')
    .all() as Array<{ id: string }>;
  const results = resultIds.map(({ id }) => loadGeneratedResultRecord(database, id)) as [
    GeneratedResult,
    GeneratedResult,
  ];
  return {
    store,
    database,
    data,
    project,
    shot,
    run,
    results,
    userContext,
    commanderContext: {
      actor: 'commander' as const,
      causation: { kind: 'run' as const, runId: run.id },
      correlationId: 'correlation.delivery.commander',
    },
  };
}

type Fixture = Awaited<ReturnType<typeof harness>>;

function resultRef(result: GeneratedResult) {
  return {
    authority: 'generated_result' as const,
    id: result.id,
    revision: 0 as const,
    contentHash: result.contentHash,
  };
}

function shotRef(fixture: Fixture) {
  const shot = fixture.data.production.get(fixture.shot.id).object;
  return {
    authority: 'production' as const,
    id: shot.id,
    revision: shot.revision,
    contentHash: shot.contentHash,
  };
}

function planRef(plan: { id: string; revision: number; contentHash: string }) {
  return {
    authority: 'delivery' as const,
    id: plan.id,
    revision: plan.revision,
    contentHash: plan.contentHash,
  };
}

function createPlan(fixture: Fixture, requestId = 'request.delivery.full.create') {
  return fixture.data.delivery.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId,
      method: 'delivery.apply',
      input: {
        action: 'create',
        project: {
          authority: 'project',
          id: fixture.project.id,
          revision: fixture.project.revision,
          contentHash: fixture.project.contentHash,
        },
        name: 'Main cut',
        formatIntent: {
          container: 'mp4',
          videoCodec: 'h264',
          audioCodec: 'aac',
          width: 1_920,
          height: 1_080,
          frameRate: 24,
          quality: 'review',
        },
      },
    },
    fixture.userContext,
  ).result;
}

function place(
  fixture: Fixture,
  plan: { id: string; revision: number; contentHash: string },
  result: GeneratedResult,
  order: number,
  requestId: string,
) {
  return fixture.data.delivery.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId,
      method: 'delivery.apply',
      input: {
        action: 'place',
        plan: planRef(plan),
        shot: shotRef(fixture),
        result: resultRef(result),
        order,
        trim: { startMs: 0, endMs: 8_000 },
        audioPolicy: 'use',
        transition: { kind: 'cut', durationMs: 0 },
      },
    },
    fixture.userContext,
  ).result;
}

function insertAllowedDispatch(
  fixture: Fixture,
  toolId: 'delivery.mutate' | 'decision.protect' | 'decision.record',
  input: unknown,
  confirmationTarget:
    | ConfirmationTarget
    | ((binding: {
        readonly id: string;
        readonly key: ReturnType<typeof resolveOperationDispatchKey>;
      }) => ConfirmationTarget)
    | null = null,
) {
  const key = resolveOperationDispatchKey(fixture.database, {
    runId: fixture.run.id,
    toolId,
    input,
  });
  const id = `dispatch.delivery.${fixture.database.prepare('SELECT COUNT(*) AS count FROM dispatch_operations').get().count}`;
  let confirmationId: string | null = null;
  if (confirmationTarget !== null) {
    const target =
      typeof confirmationTarget === 'function'
        ? confirmationTarget({ id, key })
        : confirmationTarget;
    confirmationId = `confirmation.${id}`;
    const interactionId = `interaction.${id}`;
    const objectiveMessageId = (
      fixture.database
        .prepare('SELECT objective_message_id FROM runs WHERE id = ?')
        .get(fixture.run.id) as { objective_message_id: string }
    ).objective_message_id;
    fixture.database
      .prepare(
        `INSERT INTO run_interactions (
           id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
           allow_free_text, state, answer_message_id, created_at, resolved_at
         ) VALUES (?, ?, 'confirmation', 'Approve protected change?', '[]', '[]',
           0, 'answered', ?, ?, ?)`,
      )
      .run(interactionId, fixture.run.id, objectiveMessageId, NOW, NOW);
    fixture.database
      .prepare(
        `INSERT INTO run_confirmations (
           id, run_id, interaction_id, target_v1_json, immutable_input_hash,
           decision, decided_by_message_id, requested_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?)`,
      )
      .run(
        confirmationId,
        fixture.run.id,
        interactionId,
        canonicalJson(target),
        key.inputHash,
        objectiveMessageId,
        NOW,
        NOW,
      );
  }
  fixture.database
    .prepare(
      `INSERT INTO dispatch_operations (
         id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
         input_hash, input_v1_json, confirmation_id, operation_kind,
         owner_authority, owner_id, project_event_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'allowed', ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      fixture.run.id,
      key.toolId,
      key.toolVersion,
      key.fingerprint,
      key.inputHash,
      key.inputJson,
      confirmationId,
      NOW,
      NOW,
    );
  return id;
}

function currentPlan(fixture: Fixture, planId: string) {
  return fixture.data.delivery.query({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.delivery.query.${planId}`,
    method: 'delivery.query',
    input: {
      projectId: fixture.project.id,
      deliveryPlanIds: [planId],
      page: { cursor: null, limit: 20 },
    },
  }).result.plans[0]!;
}

describe('I2-G2 Delivery authority', () => {
  it('creates a canonical Delivery plan through the frozen semantic command', () => {
    const { store } = memoryStore();
    try {
      const data = createDataAccess(store, {
        now: () => NOW,
        createId: deterministicIds(),
        mediaCas: {} as never,
        mediaImportCapabilities: {} as never,
        generationProvider: {} as never,
        resultAssessmentProvider: {} as never,
      });
      const context = {
        actor: 'user' as const,
        causation: { kind: 'direct_ui' as const, actionId: 'action.delivery.fixture' },
        correlationId: 'correlation.delivery.fixture',
      };
      const project = data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.delivery.fixture',
          method: 'project.create',
          input: {
            name: 'Delivery Film',
            permissionMode: 'reversible',
            budget,
            formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
          },
        },
        context,
      ).result.project;
      const created = data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.create',
          method: 'delivery.apply',
          input: {
            action: 'create',
            project: {
              authority: 'project',
              id: project.id,
              revision: project.revision,
              contentHash: project.contentHash,
            },
            name: 'Main cut',
            formatIntent: {
              container: 'mp4',
              videoCodec: 'h264',
              audioCodec: 'aac',
              width: 1_920,
              height: 1_080,
              frameRate: 24,
              quality: 'review',
            },
          },
        },
        context,
      );
      expect(created.result.plan).toMatchObject({
        authority: 'delivery',
        projectId: project.id,
        revision: 0,
        name: 'Main cut',
        items: [],
      });
      expect(created.result.choice).toMatchObject({
        authority: 'user_choice',
        choice: { kind: 'delivery_mutation', action: 'create' },
      });
    } finally {
      store.close();
    }
  });

  it('runs the reusable apply core in one caller transaction and rolls back every write', () => {
    const { store, database } = memoryStore();
    try {
      const environment = { now: () => NOW, createId: deterministicIds() };
      const data = createDataAccess(store, {
        ...environment,
        mediaCas: {} as never,
        mediaImportCapabilities: {} as never,
        generationProvider: {} as never,
        resultAssessmentProvider: {} as never,
      });
      const context = {
        actor: 'user' as const,
        causation: { kind: 'direct_ui' as const, actionId: 'action.delivery.core' },
        correlationId: 'correlation.delivery.core',
      };
      const project = data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.project.delivery.core',
          method: 'project.create',
          input: {
            name: 'Delivery Core Film',
            permissionMode: 'reversible',
            budget,
            formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
          },
        },
        context,
      ).result.project;
      const formatIntent = {
        container: 'mp4' as const,
        videoCodec: 'h264' as const,
        audioCodec: 'aac' as const,
        width: 1_920,
        height: 1_080,
        frameRate: 24,
        quality: 'review' as const,
      };
      const createRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.delivery.core.create',
        method: 'delivery.apply' as const,
        input: {
          action: 'create' as const,
          project: {
            authority: 'project' as const,
            id: project.id,
            revision: project.revision,
            contentHash: project.contentHash,
          },
          name: 'Core cut',
          formatIntent,
        },
      };
      expect(() =>
        applyDeliveryInTransaction(database, environment, createRequest, context, NOW),
      ).toThrow('requires an active transaction');

      const created = withImmediateTransaction(database, () =>
        applyDeliveryInTransaction(database, environment, createRequest, context, NOW),
      );
      expect(created).toMatchObject({
        plan: { revision: 0, name: 'Core cut', lifecycle: 'active' },
        choice: { choice: { kind: 'delivery_mutation', action: 'create' } },
      });

      const updateRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.delivery.core.update',
        method: 'delivery.apply' as const,
        input: {
          action: 'updateSettings' as const,
          plan: planRef(created.plan),
          name: 'Core final cut',
          formatIntent: { ...formatIntent, quality: 'high' as const },
        },
      };
      const updated = withImmediateTransaction(database, () =>
        applyDeliveryInTransaction(database, environment, updateRequest, context, NOW),
      );
      expect(updated).toMatchObject({
        plan: { revision: 1, name: 'Core final cut', lifecycle: 'active' },
        choice: { choice: { kind: 'delivery_mutation', action: 'updateSettings' } },
      });
      const choiceCount = database.prepare('SELECT COUNT(*) AS count FROM user_choices').get();
      const eventCount = database
        .prepare(
          "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'delivery_changed'",
        )
        .get();
      const searchBefore = database
        .prepare(
          `SELECT source_revision, source_hash, source_state, source_v1_json, search_text, updated_at
           FROM project_search_documents WHERE source_kind = 'delivery' AND source_id = ?`,
        )
        .get(updated.plan.id);

      const archiveRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.delivery.core.rollback',
        method: 'delivery.apply' as const,
        input: { action: 'archive' as const, plan: planRef(updated.plan) },
      };
      expect(() =>
        withImmediateTransaction(database, () => {
          applyDeliveryInTransaction(database, environment, archiveRequest, context, NOW);
          throw new Error('force outer rollback');
        }),
      ).toThrow('force outer rollback');
      expect(
        data.delivery.query({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.core.query',
          method: 'delivery.query',
          input: {
            projectId: project.id,
            deliveryPlanIds: [updated.plan.id],
            page: { cursor: null, limit: 20 },
          },
        }).result.plans[0],
      ).toEqual(updated.plan);
      expect(database.prepare('SELECT COUNT(*) AS count FROM user_choices').get()).toEqual(
        choiceCount,
      );
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'delivery_changed'",
          )
          .get(),
      ).toEqual(eventCount);
      expect(
        database
          .prepare(
            `SELECT source_revision, source_hash, source_state, source_v1_json, search_text, updated_at
             FROM project_search_documents WHERE source_kind = 'delivery' AND source_id = ?`,
          )
          .get(updated.plan.id),
      ).toEqual(searchBefore);

      const wireRequest = { ...archiveRequest, requestId: 'request.delivery.core.wire.archive' };
      const archived = data.delivery.apply(wireRequest, context);
      expect(data.delivery.apply(wireRequest, context)).toEqual(archived);
      expect(archived.result.plan).toMatchObject({ revision: 2, lifecycle: 'archived' });
      expect(
        database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'delivery_changed'",
          )
          .get(),
      ).toEqual({ count: 3 });
    } finally {
      store.close();
    }
  });

  it('applies every semantic variant with exact plan/item CAS, contiguous order, replay, and undo', async () => {
    const fixture = await harness();
    try {
      const created = createPlan(fixture);
      expect(createPlan(fixture)).toEqual(created);
      const stalePlan = created.plan;
      let state = place(fixture, created.plan, fixture.results[0], 0, 'request.delivery.place.1');
      expect(() =>
        place(fixture, stalePlan, fixture.results[1], 0, 'request.delivery.place.stale'),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      state = place(fixture, state.plan, fixture.results[1], 1, 'request.delivery.place.2');
      const apply = (requestId: string, input: Record<string, unknown>) =>
        fixture.data.delivery.apply(
          {
            wireVersion: 1,
            kind: 'request',
            requestId,
            method: 'delivery.apply',
            input,
          } as never,
          fixture.userContext,
        ).result;
      state = apply('request.delivery.settings', {
        action: 'updateSettings',
        plan: planRef(state.plan),
        name: 'Director cut',
        formatIntent: { ...state.plan.formatIntent, quality: 'high' },
      });
      let first = state.plan.items.find((item) => item.lifecycle === 'active' && item.order === 0)!;
      state = apply('request.delivery.trim', {
        action: 'trim',
        plan: planRef(state.plan),
        item: { id: first.id, revision: first.revision, contentHash: first.contentHash },
        value: { startMs: 250, endMs: 7_500 },
      });
      first = state.plan.items.find((item) => item.id === first.id)!;
      state = apply('request.delivery.transition', {
        action: 'transition',
        plan: planRef(state.plan),
        item: { id: first.id, revision: first.revision, contentHash: first.contentHash },
        value: { kind: 'crossfade', durationMs: 300 },
      });
      first = state.plan.items.find((item) => item.id === first.id)!;
      state = apply('request.delivery.audio', {
        action: 'audioPolicy',
        plan: planRef(state.plan),
        item: { id: first.id, revision: first.revision, contentHash: first.contentHash },
        value: 'mute',
      });
      first = state.plan.items.find((item) => item.id === first.id)!;
      state = apply('request.delivery.review', {
        action: 'reviewState',
        plan: planRef(state.plan),
        item: { id: first.id, revision: first.revision, contentHash: first.contentHash },
        value: 'approved',
      });
      const ordered = state.plan.items
        .filter((item) => item.lifecycle === 'active')
        .sort((left, right) => right.order - left.order)
        .map((item) => ({ id: item.id, revision: item.revision, contentHash: item.contentHash }));
      state = apply('request.delivery.reorder', {
        action: 'reorder',
        plan: planRef(state.plan),
        orderedItems: ordered,
      });
      first = state.plan.items.find((item) => item.lifecycle === 'active' && item.order === 0)!;
      const removed = apply('request.delivery.remove', {
        action: 'remove',
        plan: planRef(state.plan),
        item: { id: first.id, revision: first.revision, contentHash: first.contentHash },
      });
      const undoRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.delivery.undo.remove',
        method: 'decision.record' as const,
        input: {
          action: 'undo' as const,
          targetChoice: {
            authority: 'user_choice' as const,
            id: removed.choice.id,
            choiceHash: removed.choice.choiceHash,
          },
          currentOwner: removed.choice.ownerAfter,
        },
      };
      const undone = fixture.data.userChoices.undoChoice(undoRequest, fixture.userContext);
      expect(fixture.data.userChoices.undoChoice(undoRequest, fixture.userContext)).toEqual(undone);
      const plan = currentPlan(fixture, created.plan.id);
      expect(
        plan.items
          .filter((item) => item.lifecycle === 'active')
          .sort((left, right) => left.order - right.order)
          .map((item) => item.order),
      ).toEqual([0, 1]);
      state = apply('request.delivery.archive', { action: 'archive', plan: planRef(plan) });
      expect(state.plan.lifecycle).toBe('archived');
      state = apply('request.delivery.restore', {
        action: 'restore',
        plan: planRef(state.plan),
      });
      expect(state.plan.lifecycle).toBe('active');
      expect(
        fixture.database
          .prepare('SELECT COUNT(*) AS count FROM user_choices WHERE delivery_owner_id = ?')
          .get(state.plan.id),
      ).toEqual({ count: 13 });
      expect(
        fixture.database
          .prepare(
            `SELECT COUNT(*) AS count FROM project_events
             WHERE subject_authority = 'delivery' AND event_type = 'delivery_changed'`,
          )
          .get(),
      ).toEqual({ count: 12 });
    } finally {
      fixture.store.close();
    }
  });

  it('retains direct-user protection and requires exact persisted confirmation for Commander', async () => {
    const fixture = await harness();
    try {
      const created = createPlan(fixture, 'request.delivery.protection.create');
      const field = {
        owner: 'delivery' as const,
        deliveryId: created.plan.id,
        itemId: null,
        field: 'name' as const,
      };
      const protectedChoice = fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.protect.name',
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: planRef(created.plan),
            field,
            reason: 'User-approved title',
          },
        },
        fixture.userContext,
      ).result;
      let plan = currentPlan(fixture, created.plan.id);
      const direct = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.protected.direct',
          method: 'delivery.apply',
          input: {
            action: 'updateSettings',
            plan: planRef(plan),
            name: 'User title',
            formatIntent: plan.formatIntent,
          },
        },
        fixture.userContext,
      ).result;
      expect(direct.plan.protections).toEqual([
        { field, choiceId: protectedChoice.id, protectedAt: NOW },
      ]);
      plan = direct.plan;
      const command = {
        action: 'updateSettings' as const,
        plan: planRef(plan),
        name: 'Commander title',
        formatIntent: { ...plan.formatIntent, quality: 'standard' as const },
      };
      const afterEffect = {
        kind: 'delivery' as const,
        deliveryId: plan.id,
        settings: {
          name: command.name,
          lifecycle: plan.lifecycle,
          formatIntent: command.formatIntent,
        },
        items: [],
        order: null,
      };
      const fields = [
        field,
        {
          owner: 'delivery' as const,
          deliveryId: plan.id,
          itemId: null,
          field: 'formatIntent' as const,
        },
      ].sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
      let exactTarget!: ConfirmationTarget;
      const dispatchId = insertAllowedDispatch(
        fixture,
        'delivery.mutate',
        command,
        ({ id, key }) => {
          exactTarget = {
            kind: 'protected_mutation',
            dispatch: {
              operationId: id,
              toolId: key.toolId,
              toolVersion: key.toolVersion,
              inputHash: key.inputHash,
              fingerprint: key.fingerprint,
              authorityWatermarkHash: key.authorityWatermarkHash,
            },
            owner: planRef(plan),
            fields,
            activeChoiceIds: [protectedChoice.id],
            proposedEffectHash: hashCanonical(afterEffect),
            plannedIds: plannedDeliveryMutationIds(id, command.action),
          };
          return { ...exactTarget, proposedEffectHash: HASH_A };
        },
      );
      const request = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.delivery.protected.commander',
        method: 'delivery.apply' as const,
        input: command,
      };
      expect(() =>
        fixture.data.delivery.apply(request, fixture.commanderContext, {
          dispatchOperationId: dispatchId,
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      fixture.database
        .prepare('UPDATE run_confirmations SET target_v1_json = ? WHERE id = ?')
        .run(canonicalJson(exactTarget), `confirmation.${dispatchId}`);
      const applied = fixture.data.delivery.apply(request, fixture.commanderContext, {
        dispatchOperationId: dispatchId,
      }).result;
      const plannedIds = plannedDeliveryMutationIds(dispatchId, command.action);
      expect(applied.choice.id).toBe(plannedIds.userChoiceId);
      expect(
        fixture.database
          .prepare('SELECT id FROM project_events WHERE id = ?')
          .get(plannedIds.projectEventId),
      ).toEqual({ id: plannedIds.projectEventId });
      expect(applied.choice).toMatchObject({
        actor: 'commander',
        authorization: {
          kind: 'commander_dispatch',
          dispatchOperationId: dispatchId,
          confirmationId: `confirmation.${dispatchId}`,
        },
      });
      expect(applied.plan.protections).toHaveLength(1);
      expect(() =>
        fixture.data.userChoices.setProtection(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.delivery.protection.import',
            method: 'decision.protect',
            input: {
              mode: 'unprotect',
              owner: planRef(applied.plan),
              field,
              reason: '',
            },
          },
          {
            actor: 'import',
            causation: { kind: 'import', importId: 'import.delivery.fixture' },
            correlationId: 'correlation.delivery.import',
          },
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
    } finally {
      fixture.store.close();
    }
  });

  it('freezes a protected placement item ID before Commander approval', async () => {
    const fixture = await harness();
    try {
      const created = createPlan(fixture, 'request.delivery.place-protected.create');
      const first = place(
        fixture,
        created.plan,
        fixture.results[0],
        0,
        'request.delivery.place-protected.first',
      );
      const orderField = {
        owner: 'delivery' as const,
        deliveryId: first.plan.id,
        itemId: null,
        field: 'order' as const,
      };
      fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.place-protected.protect',
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: planRef(first.plan),
            field: orderField,
            reason: 'Keep the approved sequence order.',
          },
        },
        fixture.userContext,
      );
      const plan = currentPlan(fixture, first.plan.id);
      const command = {
        action: 'place' as const,
        plan: planRef(plan),
        shot: shotRef(fixture),
        result: resultRef(fixture.results[1]),
        order: 0,
        trim: { startMs: 0, endMs: 8_000 },
        audioPolicy: 'use' as const,
        transition: { kind: 'cut' as const, durationMs: 0 },
      };
      const request = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.delivery.place-protected.commander',
        method: 'delivery.apply' as const,
        input: command,
      };
      let frozenIds!: ReturnType<typeof plannedDeliveryMutationIds>;
      const dispatchId = insertAllowedDispatch(
        fixture,
        'delivery.mutate',
        command,
        ({ id, key }) => {
          frozenIds = plannedDeliveryMutationIds(id, command.action);
          const planned = withImmediateTransaction(fixture.database, () =>
            planDeliveryMutationInTransaction(
              fixture.database,
              {
                now: () => NOW,
                createId: () => {
                  throw new Error('Protected placement must use its frozen IDs');
                },
              },
              request,
              NOW,
              frozenIds,
            ),
          );
          return {
            kind: 'protected_mutation',
            dispatch: {
              operationId: id,
              toolId: key.toolId,
              toolVersion: key.toolVersion,
              inputHash: key.inputHash,
              fingerprint: key.fingerprint,
              authorityWatermarkHash: key.authorityWatermarkHash,
            },
            owner: planRef(planned.before!),
            fields: [...planned.fields].sort((left, right) =>
              canonicalJson(left).localeCompare(canonicalJson(right)),
            ),
            activeChoiceIds: [...planned.activeChoiceIds],
            proposedEffectHash: hashCanonical(planned.afterEffect),
            plannedIds: planned.ids,
          };
        },
      );
      const applied = fixture.data.delivery.apply(request, fixture.commanderContext, {
        dispatchOperationId: dispatchId,
      }).result;
      expect(frozenIds.deliveryItemId).not.toBeNull();
      expect(applied.plan.items).toContainEqual(
        expect.objectContaining({
          id: frozenIds.deliveryItemId,
          result: resultRef(fixture.results[1]),
          order: 0,
        }),
      );
      expect(applied.choice.id).toBe(frozenIds.userChoiceId);
      expect(
        fixture.database
          .prepare('SELECT id FROM project_events WHERE id = ?')
          .get(frozenIds.projectEventId),
      ).toEqual({ id: frozenIds.projectEventId });
    } finally {
      fixture.store.close();
    }
  });

  it('freezes complete immutable manifests while rejected results, negative assessment, protection, and TaskList do not gate', async () => {
    const fixture = await harness();
    try {
      const created = createPlan(fixture, 'request.delivery.manifest.create');
      expect(() =>
        fixture.data.delivery.freeze({ plan: planRef(created.plan) }, fixture.userContext),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      fixture.data.userChoices.recordResultDecision(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.reject.result',
          method: 'decision.record',
          input: {
            action: 'reject',
            shot: shotRef(fixture),
            result: resultRef(fixture.results[0]),
            feedback: 'The user still wants to inspect this in Delivery.',
          },
        },
        fixture.userContext,
      );
      const startedAssessment = await fixture.data.resultAssessments.start(
        {
          runId: fixture.run.id,
          commandId: 'command.delivery.negative.assessment.start',
          request: {
            kind: 'coverage',
            subjects: [resultRef(fixture.results[0])],
            requirements: ['Evaluator preference'],
            provider: { providerId: 'provider.delivery.fixture', model: 'video-model' },
          },
        },
        fixture.commanderContext,
      );
      const negativeAssessment = await fixture.data.resultAssessments.submitProvider(
        {
          operation: startedAssessment.operation,
          expectedRevision: startedAssessment.operation.revision,
          commandId: 'command.delivery.negative.assessment.submit',
        },
        fixture.commanderContext,
      );
      expect(negativeAssessment.assessment?.findings[0]?.severity).toBe('error');
      const run = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.delivery.run.current',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      const taskList = fixture.data.taskLists.manage(
        fixture.run.id,
        {
          action: 'create',
          expectedRunRevision: run.revision,
          title: 'Delivery progress',
          tasks: [{ draftId: 'draft.delivery', title: 'Unrelated', parentDraftId: null, order: 0 }],
          publicSummary: 'Track unrelated work.',
        },
        { commandId: 'command.delivery.task.create', context: fixture.commanderContext },
      ).taskList!;
      fixture.data.taskLists.manage(
        fixture.run.id,
        {
          action: 'update',
          expectedRevision: taskList.revision,
          taskId: taskList.items[0]!.id,
          title: null,
          state: 'blocked',
          resultSummary: 'Unrelated blocker.',
          childRunId: null,
          publicSummary: 'Still unrelated.',
        },
        { commandId: 'command.delivery.task.block', context: fixture.commanderContext },
      );
      let state = place(
        fixture,
        created.plan,
        fixture.results[0],
        0,
        'request.delivery.manifest.place',
      );
      const item = state.plan.items.find((entry) => entry.lifecycle === 'active')!;
      const clipField = {
        owner: 'delivery' as const,
        deliveryId: state.plan.id,
        itemId: item.id,
        field: 'clip' as const,
      };
      fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.manifest.protect',
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: planRef(state.plan),
            field: clipField,
            reason: 'Keep this user-selected clip.',
          },
        },
        fixture.userContext,
      );
      state = { ...state, plan: currentPlan(fixture, state.plan.id) };
      const firstManifest = fixture.data.delivery.freeze(
        { plan: planRef(state.plan) },
        fixture.userContext,
      );
      expect(firstManifest).toMatchObject({
        projectId: fixture.project.id,
        sourcePlan: planRef(state.plan),
        items: [
          {
            generatedResultId: fixture.results[0].id,
            generatedResultContentHash: fixture.results[0].contentHash,
            shotId: fixture.shot.id,
            blobHash: fixture.results[0].mediaBlobHash,
          },
        ],
      });
      expect(firstManifest.currentChoices.length).toBeGreaterThanOrEqual(7);
      expect(firstManifest.protections).toEqual([expect.objectContaining({ field: clipField })]);
      expect(
        fixture.data.delivery.freeze({ plan: planRef(state.plan) }, fixture.userContext),
      ).toEqual(firstManifest);
      const activeItem = state.plan.items.find((entry) => entry.lifecycle === 'active')!;
      const revised = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.manifest.revise',
          method: 'delivery.apply',
          input: {
            action: 'trim',
            plan: planRef(state.plan),
            item: {
              id: activeItem.id,
              revision: activeItem.revision,
              contentHash: activeItem.contentHash,
            },
            value: { startMs: 500, endMs: 7_000 },
          },
        },
        fixture.userContext,
      ).result;
      expect(
        fixture.data.delivery.freeze({ plan: planRef(state.plan) }, fixture.userContext),
      ).toEqual(firstManifest);
      const secondManifest = fixture.data.delivery.freeze(
        { plan: planRef(revised.plan) },
        fixture.userContext,
      );
      expect(secondManifest.id).not.toBe(firstManifest.id);
      expect(fixture.data.delivery.getManifest(firstManifest.id)).toEqual(firstManifest);
      const query = fixture.data.delivery.query({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.delivery.manifest.query',
        method: 'delivery.query',
        input: {
          projectId: fixture.project.id,
          deliveryPlanIds: [revised.plan.id],
          page: { cursor: null, limit: 20 },
        },
      }).result;
      expect(query.manifests.map((manifest) => manifest.id)).toEqual([
        firstManifest.id,
        secondManifest.id,
      ]);
      expect(
        fixture.data.delivery.queryTool(fixture.project.id, {
          planIds: [],
          itemIds: [activeItem.id],
          manifestIds: [secondManifest.id],
          include: ['items', 'format', 'review', 'manifests', 'protections'],
          page: { cursor: null, limit: 20 },
        }),
      ).toEqual({
        items: [
          {
            plan: revised.plan,
            manifests: [
              {
                authority: 'delivery_manifest',
                id: secondManifest.id,
                revision: 0,
                contentHash: secondManifest.contentHash,
              },
            ],
            operations: [],
          },
        ],
        nextCursor: null,
      });
      const additional = createPlan(fixture, 'request.delivery.tool-query.additional');
      const firstPage = fixture.data.delivery.queryTool(fixture.project.id, {
        planIds: [],
        itemIds: [],
        manifestIds: [],
        include: [],
        page: { cursor: null, limit: 1 },
      });
      expect(firstPage.items.map(({ plan }) => plan.id)).toEqual([revised.plan.id]);
      expect(firstPage.nextCursor).not.toBeNull();
      expect(
        fixture.data.delivery
          .queryTool(fixture.project.id, {
            planIds: [],
            itemIds: [],
            manifestIds: [],
            include: [],
            page: { cursor: firstPage.nextCursor, limit: 1 },
          })
          .items.map(({ plan }) => plan.id),
      ).toEqual([additional.plan.id]);
      expect(() =>
        fixture.data.delivery.queryTool(fixture.project.id, {
          planIds: [additional.plan.id],
          itemIds: [],
          manifestIds: [],
          include: [],
          page: { cursor: firstPage.nextCursor, limit: 1 },
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      fixture.database
        .prepare(
          'UPDATE delivery_manifest_items SET trim_end_ms = trim_end_ms - 1 WHERE delivery_manifest_id = ?',
        )
        .run(firstManifest.id);
      expect(() => fixture.data.delivery.getManifest(firstManifest.id)).toThrowError(
        expect.objectContaining({ code: 'CORRUPT_DATA' }),
      );
      expect(fixture.data.delivery.getManifest(secondManifest.id)).toEqual(secondManifest);

      const other = fixture.data.projects.create(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.other.project',
          method: 'project.create',
          input: {
            name: 'Other Film',
            permissionMode: 'reversible',
            budget,
            formatPolicy: { aspectRatio: '16:9', customDimensions: null, frameRate: 24 },
          },
        },
        fixture.userContext,
      ).result.project;
      const otherPlan = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.delivery.other.plan',
          method: 'delivery.apply',
          input: {
            action: 'create',
            project: {
              authority: 'project',
              id: other.id,
              revision: other.revision,
              contentHash: other.contentHash,
            },
            name: 'Other cut',
            formatIntent: revised.plan.formatIntent,
          },
        },
        fixture.userContext,
      ).result.plan;
      expect(() =>
        fixture.data.delivery.apply(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.delivery.cross.project',
            method: 'delivery.apply',
            input: {
              action: 'place',
              plan: planRef(otherPlan),
              shot: shotRef(fixture),
              result: resultRef(fixture.results[0]),
              order: 0,
              trim: { startMs: 0, endMs: 1_000 },
              audioPolicy: 'use',
              transition: { kind: 'cut', durationMs: 0 },
            },
          },
          fixture.userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(() =>
        fixture.data.delivery.apply(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.delivery.tampered.result',
            method: 'delivery.apply',
            input: {
              action: 'place',
              plan: planRef(otherPlan),
              shot: shotRef(fixture),
              result: { ...resultRef(fixture.results[0]), contentHash: HASH_A },
              order: 0,
              trim: { startMs: 0, endMs: 1_000 },
              audioPolicy: 'use',
              transition: { kind: 'cut', durationMs: 0 },
            },
          },
          fixture.userContext,
        ),
      ).toThrowError();
    } finally {
      fixture.store.close();
    }
  }, 15_000);
});
