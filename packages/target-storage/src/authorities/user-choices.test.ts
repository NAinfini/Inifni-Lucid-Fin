import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  CapabilityCatalogSnapshotV1Schema,
  canonicalJson,
  generationPromptAssemblyHashInput,
  generationQuoteHashInput,
  providerReceiptHashInput,
  type ChoiceOwnerRef,
  type ConfirmationTarget,
  type GeneratedResult,
  type GenerationQuote,
  type GenerationSpec,
  type ProtectedFieldRef,
  type ProviderReceipt,
  type UserChoiceEffect,
} from '@lucid-fin/target-contracts';
import { describe, expect, it } from 'vitest';
import {
  registerTargetStoreDatabase,
  unregisterTargetStoreDatabase,
} from '../internal/database-access.js';
import { hashCanonical } from '../internal/hashes.js';
import { loadGeneratedResultRecord } from '../internal/operation-owner-records.js';
import { resolveOperationDispatchKey } from '../internal/operation-dispatch.js';
import { plannedProtectedChoiceMutationIds } from '../internal/protection-guard.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import type {
  GenerationProviderAdapter,
  GenerationProviderState,
} from '../kernel/generation-provider.js';
import { createTargetDataAccess } from '../kernel/data-access.js';
import type { MediaCas, MediaImportCapabilityResolver } from '../kernel/media-cas.js';
import type { TargetStore } from '../kernel/store.js';
import {
  commitPlannedDecisionMutationInTransaction,
  decisionMutationToolSuccess,
  planDecisionMutationInTransaction,
  recordDecisionInTransaction,
  setDecisionProtectionInTransaction,
} from './user-choices.js';

const NOW = '2026-08-16T12:00:00.000Z';
const HASH_A = 'a'.repeat(64);
const rootCatalog = CapabilityCatalogSnapshotV1Schema.parse(
  JSON.parse(
    readFileSync(
      new URL('../../../target-contracts/generated/tool-catalog.v1.json', import.meta.url),
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

function receipt(): ProviderReceipt {
  const value = {
    providerOperationId: 'provider.operation.choice.fixture',
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
      quoteId: 'generation.quote.choice.fixture',
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
    const outputs = [Buffer.from('choice-result-one'), Buffer.from('choice-result-two')].map(
      (bytes, variantIndex) => ({
        variantIndex,
        blob: {
          hash: sha256(bytes),
          byteLength: bytes.byteLength,
          mimeType: 'image/png',
          technicalFacts: { kind: 'image' as const, width: 1280, height: 720 },
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
          durationValid: null,
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

type Fixture = Awaited<ReturnType<typeof harness>>;

async function harness() {
  const { store, database } = memoryStore();
  const mediaCas = new MemoryMediaCas();
  const environment = {
    now: () => NOW,
    createId: deterministicIds(),
  };
  const data = createTargetDataAccess(store, {
    ...environment,
    mediaCas,
    mediaImportCapabilities: unusedCapabilities,
    generationProvider: new FixtureGenerationProvider(),
    resultAssessmentProvider: {} as never,
  });
  const userContext = {
    actor: 'user' as const,
    causation: { kind: 'direct_ui' as const, actionId: 'action.choice.fixture' },
    correlationId: 'correlation.choice.fixture',
  };
  const project = data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.project.choice.fixture',
      method: 'project.create',
      input: {
        name: 'Choice Film',
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
       ) VALUES ('provider.choice.fixture', 'Provider', 'openai', 'image-model', NULL, NULL,
         NULL, 'ready', '{}', 0, ?, ?)`,
    )
    .run(NOW, NOW);
  const shot = data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.shot.choice.fixture',
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
  if (shot.type !== 'shot') throw new Error('fixture shot');
  const chat = data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.chat.choice.fixture',
      method: 'chat.create',
      input: { projectId: project.id, title: 'Main' },
    },
    userContext,
  ).result;
  const run = data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.message.choice.fixture',
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
        providerId: 'provider.choice.fixture',
        model: 'image-model',
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
    kind: 'image',
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
    provider: { providerId: 'provider.choice.fixture', model: 'image-model' },
    outputCount: 2,
    seed: 7,
    width: 1280,
    height: 720,
    guidanceScale: null,
    sourceMaskRefId: null,
  };
  const quoted = await data.generation.quote({ runId: run.id, request: { spec } });
  await data.generation.submit(
    {
      runId: run.id,
      commandId: 'command.generation.choice.fixture',
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
            filename: `result-${variantIndex}.png`,
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
      correlationId: 'correlation.generation.choice.fixture',
    },
  );
  const resultIds = database
    .prepare('SELECT id FROM generated_results ORDER BY variant_index')
    .all() as Array<{ id: string }>;
  const results = resultIds.map(({ id }) => loadGeneratedResultRecord(database, id));
  return {
    store,
    database,
    data,
    environment,
    project,
    run,
    shot,
    results: results as [GeneratedResult, GeneratedResult],
    userContext,
    commanderContext: {
      actor: 'commander' as const,
      causation: { kind: 'run' as const, runId: run.id },
      correlationId: 'correlation.choice.commander',
    },
  };
}

function refOf(result: GeneratedResult) {
  return {
    authority: 'generated_result' as const,
    id: result.id,
    revision: 0 as const,
    contentHash: result.contentHash,
  };
}

function shotRef(fixture: Fixture) {
  const object = fixture.data.production.get(fixture.shot.id).object;
  return {
    authority: 'production' as const,
    id: object.id,
    revision: object.revision,
    contentHash: object.contentHash,
  };
}

function deliveryRef(plan: { id: string; revision: number; contentHash: string }) {
  return {
    authority: 'delivery' as const,
    id: plan.id,
    revision: plan.revision,
    contentHash: plan.contentHash,
  };
}

function protectionRequest(
  requestId: string,
  mode: 'protect' | 'unprotect',
  owner: ChoiceOwnerRef,
  field: ProtectedFieldRef,
) {
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId,
    method: 'decision.protect' as const,
    input: { mode, owner, field, reason: '' },
  };
}

function decisionRequest(
  requestId: string,
  shot: ReturnType<typeof shotRef>,
  result: GeneratedResult,
  action: 'select' | 'reject' | 'refine' | 'use_as_reference',
) {
  const detail =
    action === 'refine'
      ? { instruction: 'Make the moon brighter.' }
      : { feedback: action === 'reject' ? 'Wrong composition.' : 'Use this take.' };
  return {
    wireVersion: 1 as const,
    kind: 'request' as const,
    requestId,
    method: 'decision.record' as const,
    input: { action, shot, result: refOf(result), ...detail },
  };
}

function insertAllowedDispatch(
  fixture: Fixture,
  toolId: 'decision.record' | 'decision.protect',
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
  const id = `dispatch.choice.${fixture.database.prepare('SELECT COUNT(*) AS count FROM dispatch_operations').get().count}`;
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
        .get(fixture.run.id) as {
        objective_message_id: string;
      }
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

describe('I2-G1 UserChoice and Production protection authority', () => {
  it('runs the reusable decision core in one caller transaction and rolls back every write', async () => {
    const fixture = await harness();
    try {
      const [firstResult, secondResult] = fixture.results;
      const selectRequest = decisionRequest(
        'request.choice.core.select',
        shotRef(fixture),
        firstResult,
        'select',
      );
      expect(() =>
        recordDecisionInTransaction(
          fixture.database,
          fixture.environment,
          selectRequest,
          fixture.userContext,
          NOW,
        ),
      ).toThrow('requires an active transaction');

      const selected = withImmediateTransaction(fixture.database, () =>
        recordDecisionInTransaction(
          fixture.database,
          fixture.environment,
          selectRequest,
          fixture.userContext,
          NOW,
        ),
      );
      expect(fixture.data.production.get(fixture.shot.id).object).toMatchObject({
        revision: 1,
        resultDecisions: [{ currentChoiceId: selected.id, value: { state: 'selected' } }],
      });
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'choice_recorded' AND subject_id = ?",
          )
          .get(selected.id),
      ).toEqual({ count: 1 });

      const undoRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.choice.core.undo',
        method: 'decision.record' as const,
        input: {
          action: 'undo' as const,
          targetChoice: {
            authority: 'user_choice' as const,
            id: selected.id,
            choiceHash: selected.choiceHash,
          },
          currentOwner: selected.ownerAfter,
        },
      };
      const undone = withImmediateTransaction(fixture.database, () =>
        recordDecisionInTransaction(
          fixture.database,
          fixture.environment,
          undoRequest,
          fixture.userContext,
          NOW,
        ),
      );
      expect(undone).toMatchObject({
        choice: { kind: 'undo', targetChoiceId: selected.id },
        supersedesChoiceIds: [selected.id],
      });
      expect(fixture.data.production.get(fixture.shot.id).object).toMatchObject({
        revision: 2,
        resultDecisions: [],
      });

      const beforeRollback = fixture.data.production.get(fixture.shot.id).object;
      const beforeChoiceCount = fixture.database
        .prepare('SELECT COUNT(*) AS count FROM user_choices')
        .get();
      const beforeEventCount = fixture.database
        .prepare(
          "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'choice_recorded'",
        )
        .get();
      expect(() =>
        withImmediateTransaction(fixture.database, () => {
          recordDecisionInTransaction(
            fixture.database,
            fixture.environment,
            decisionRequest(
              'request.choice.core.rollback',
              shotRef(fixture),
              secondResult,
              'reject',
            ),
            fixture.userContext,
            NOW,
          );
          throw new Error('force outer rollback');
        }),
      ).toThrow('force outer rollback');
      expect(fixture.data.production.get(fixture.shot.id).object).toEqual(beforeRollback);
      expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM user_choices').get()).toEqual(
        beforeChoiceCount,
      );
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'choice_recorded'",
          )
          .get(),
      ).toEqual(beforeEventCount);
    } finally {
      fixture.store.close();
    }
  });

  it('plans and commits every persistent Decision form with exact tool success state', async () => {
    const fixture = await harness();
    try {
      const [result] = fixture.results;
      const resultRequest = decisionRequest(
        'request.choice.plan.result',
        shotRef(fixture),
        result,
        'select',
      );
      const beforePlanCounts = fixture.database
        .prepare('SELECT COUNT(*) AS choices FROM user_choices')
        .get();
      const resultPlan = withImmediateTransaction(fixture.database, () =>
        planDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          resultRequest,
          fixture.userContext,
          NOW,
        ),
      );
      expect(resultPlan).toMatchObject({
        kind: 'production_result',
        currentState: 'selected',
        proposedEffectHash: hashCanonical(resultPlan.afterEffect),
      });
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS choices FROM user_choices').get(),
      ).toEqual(beforePlanCounts);
      const resultCommit = withImmediateTransaction(fixture.database, () =>
        commitPlannedDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          resultPlan,
          fixture.userContext,
        ),
      );
      if (resultCommit.toolId !== 'decision.record') throw new Error('result commit kind');
      expect(decisionMutationToolSuccess(resultCommit)).toMatchObject({
        action: 'select',
        currentState: 'selected',
      });

      const productionUndoRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.choice.plan.production-undo',
        method: 'decision.record' as const,
        input: {
          action: 'undo' as const,
          targetChoice: {
            authority: 'user_choice' as const,
            id: resultCommit.choice.id,
            choiceHash: resultCommit.choice.choiceHash,
          },
          currentOwner: resultCommit.choice.ownerAfter,
        },
      };
      const productionUndoPlan = withImmediateTransaction(fixture.database, () =>
        planDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          productionUndoRequest,
          fixture.userContext,
          NOW,
        ),
      );
      expect(productionUndoPlan).toMatchObject({
        kind: 'production_undo',
        currentState: 'unreviewed',
      });
      const productionUndoCommit = withImmediateTransaction(fixture.database, () =>
        commitPlannedDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          productionUndoPlan,
          fixture.userContext,
        ),
      );
      if (productionUndoCommit.toolId !== 'decision.record') throw new Error('undo commit kind');
      expect(decisionMutationToolSuccess(productionUndoCommit)).toMatchObject({
        action: 'undo',
        currentState: 'unreviewed',
      });

      const productionField = {
        owner: 'production' as const,
        objectId: fixture.shot.id,
        field: 'content' as const,
      };
      const productionProtectionPlan = withImmediateTransaction(fixture.database, () =>
        planDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          protectionRequest(
            'request.choice.plan.production-protection',
            'protect',
            shotRef(fixture),
            productionField,
          ),
          fixture.userContext,
          NOW,
        ),
      );
      expect(productionProtectionPlan.kind).toBe('production_protection');
      const productionProtectionCommit = withImmediateTransaction(fixture.database, () =>
        commitPlannedDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          productionProtectionPlan,
          fixture.userContext,
        ),
      );
      if (productionProtectionCommit.toolId !== 'decision.protect') {
        throw new Error('production protection commit kind');
      }
      expect(decisionMutationToolSuccess(productionProtectionCommit)).toMatchObject({
        active: true,
      });

      const delivery = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.choice.plan.delivery-create',
          method: 'delivery.apply',
          input: {
            action: 'create',
            project: {
              authority: 'project',
              id: fixture.project.id,
              revision: fixture.project.revision,
              contentHash: fixture.project.contentHash,
            },
            name: 'Planner cut',
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
      ).result.plan;
      const deliveryField = {
        owner: 'delivery' as const,
        deliveryId: delivery.id,
        itemId: null,
        field: 'name' as const,
      };
      const deliveryProtectionPlan = withImmediateTransaction(fixture.database, () =>
        planDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          protectionRequest(
            'request.choice.plan.delivery-protection',
            'protect',
            deliveryRef(delivery),
            deliveryField,
          ),
          fixture.userContext,
          NOW,
        ),
      );
      expect(deliveryProtectionPlan.kind).toBe('delivery_protection');
      const deliveryProtectionCommit = withImmediateTransaction(fixture.database, () =>
        commitPlannedDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          deliveryProtectionPlan,
          fixture.userContext,
        ),
      );
      if (deliveryProtectionCommit.toolId !== 'decision.protect') {
        throw new Error('delivery protection commit kind');
      }
      expect(decisionMutationToolSuccess(deliveryProtectionCommit)).toMatchObject({ active: true });

      const deliveryProtectionUndoPlan = withImmediateTransaction(fixture.database, () =>
        planDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.choice.plan.delivery-protection-undo',
            method: 'decision.record',
            input: {
              action: 'undo',
              targetChoice: {
                authority: 'user_choice',
                id: deliveryProtectionCommit.choice.id,
                choiceHash: deliveryProtectionCommit.choice.choiceHash,
              },
              currentOwner: deliveryProtectionCommit.choice.ownerAfter,
            },
          },
          fixture.userContext,
          NOW,
        ),
      );
      expect(deliveryProtectionUndoPlan).toMatchObject({
        kind: 'delivery_undo',
        currentState: null,
      });
      const deliveryProtectionUndoCommit = withImmediateTransaction(fixture.database, () =>
        commitPlannedDecisionMutationInTransaction(
          fixture.database,
          fixture.environment,
          deliveryProtectionUndoPlan,
          fixture.userContext,
        ),
      );
      if (deliveryProtectionUndoCommit.toolId !== 'decision.record') {
        throw new Error('delivery protection undo commit kind');
      }
      expect(decisionMutationToolSuccess(deliveryProtectionUndoCommit)).toMatchObject({
        action: 'undo',
        currentState: null,
      });
    } finally {
      fixture.store.close();
    }
  });

  it('runs both protection owners in one caller transaction and requires an exact empty target for Commander protection', async () => {
    const fixture = await harness();
    try {
      const productionField = {
        owner: 'production' as const,
        objectId: fixture.shot.id,
        field: 'content' as const,
      };
      const productionProtectRequest = protectionRequest(
        'request.choice.protection.core.production.protect',
        'protect',
        shotRef(fixture),
        productionField,
      );
      expect(() =>
        setDecisionProtectionInTransaction(
          fixture.database,
          fixture.environment,
          productionProtectRequest,
          fixture.userContext,
          NOW,
        ),
      ).toThrow('requires an active transaction');

      const productionProtected = withImmediateTransaction(fixture.database, () =>
        setDecisionProtectionInTransaction(
          fixture.database,
          fixture.environment,
          productionProtectRequest,
          fixture.userContext,
          NOW,
        ),
      );
      const productionUnprotected = withImmediateTransaction(fixture.database, () =>
        setDecisionProtectionInTransaction(
          fixture.database,
          fixture.environment,
          protectionRequest(
            'request.choice.protection.core.production.unprotect',
            'unprotect',
            productionProtected.owner,
            productionField,
          ),
          fixture.userContext,
          NOW,
        ),
      );
      expect(productionProtected).toMatchObject({
        active: true,
        owner: productionProtected.choice.ownerAfter,
      });
      expect(productionUnprotected).toMatchObject({
        active: false,
        owner: productionUnprotected.choice.ownerAfter,
      });

      const commanderRequest = protectionRequest(
        'request.choice.protection.core.commander',
        'protect',
        productionUnprotected.owner,
        productionField,
      );
      const unconfirmedRequest = {
        ...commanderRequest,
        input: { ...commanderRequest.input, reason: 'Unconfirmed protected change' },
      };
      const unconfirmedDispatchId = insertAllowedDispatch(
        fixture,
        'decision.protect',
        unconfirmedRequest.input,
      );
      expect(() =>
        withImmediateTransaction(fixture.database, () =>
          setDecisionProtectionInTransaction(
            fixture.database,
            fixture.environment,
            unconfirmedRequest,
            fixture.commanderContext,
            NOW,
            { dispatchOperationId: unconfirmedDispatchId },
          ),
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      const dispatchId = insertAllowedDispatch(
        fixture,
        'decision.protect',
        commanderRequest.input,
        ({ id, key }) => ({
          kind: 'protected_mutation',
          dispatch: {
            operationId: id,
            toolId: key.toolId,
            toolVersion: key.toolVersion,
            inputHash: key.inputHash,
            fingerprint: key.fingerprint,
            authorityWatermarkHash: key.authorityWatermarkHash,
          },
          owner: commanderRequest.input.owner,
          fields: [productionField],
          activeChoiceIds: [],
          proposedEffectHash: hashCanonical({
            kind: 'protection',
            field: productionField,
            active: true,
          }),
          plannedIds: plannedProtectedChoiceMutationIds(id, 'decision.protect'),
        }),
      );
      const commanderProtected = withImmediateTransaction(fixture.database, () =>
        setDecisionProtectionInTransaction(
          fixture.database,
          fixture.environment,
          commanderRequest,
          fixture.commanderContext,
          NOW,
          { dispatchOperationId: dispatchId },
        ),
      );
      const confirmation = fixture.database
        .prepare('SELECT target_v1_json FROM run_confirmations WHERE id = ?')
        .get(`confirmation.${dispatchId}`) as { target_v1_json: string };
      expect(JSON.parse(confirmation.target_v1_json)).toMatchObject({
        kind: 'protected_mutation',
        activeChoiceIds: [],
      });
      const commanderReplay = withImmediateTransaction(fixture.database, () =>
        setDecisionProtectionInTransaction(
          fixture.database,
          fixture.environment,
          commanderRequest,
          fixture.commanderContext,
          NOW,
          { dispatchOperationId: dispatchId },
        ),
      );
      expect(commanderReplay).toEqual(commanderProtected);

      for (const result of [productionProtected, productionUnprotected, commanderProtected]) {
        expect(
          fixture.database
            .prepare(
              `SELECT subject_id, event_type FROM project_events
               WHERE id = ?`,
            )
            .get(result.eventId),
        ).toEqual({ subject_id: result.choice.id, event_type: 'choice_recorded' });
      }

      const productionBeforeRollback = fixture.data.production.get(fixture.shot.id).object;
      const protectionsBeforeRollback = fixture.database
        .prepare(
          `SELECT id, choice_id, released_by_choice_id FROM production_protections
           WHERE production_object_id = ? ORDER BY id`,
        )
        .all(fixture.shot.id);
      const choicesBeforeRollback = fixture.database
        .prepare('SELECT COUNT(*) AS count FROM user_choices')
        .get();
      const eventsBeforeRollback = fixture.database
        .prepare('SELECT COUNT(*) AS count FROM project_events')
        .get();
      const searchBeforeRollback = fixture.database
        .prepare(
          `SELECT source_revision, source_hash, source_state, source_v1_json, search_text, updated_at
           FROM project_search_documents WHERE source_kind = 'production' AND source_id = ?`,
        )
        .get(fixture.shot.id);
      expect(() =>
        withImmediateTransaction(fixture.database, () => {
          setDecisionProtectionInTransaction(
            fixture.database,
            fixture.environment,
            protectionRequest(
              'request.choice.protection.core.rollback',
              'unprotect',
              commanderProtected.owner,
              productionField,
            ),
            fixture.userContext,
            NOW,
          );
          throw new Error('force outer rollback');
        }),
      ).toThrow('force outer rollback');
      expect(fixture.data.production.get(fixture.shot.id).object).toEqual(productionBeforeRollback);
      expect(
        fixture.database
          .prepare(
            `SELECT id, choice_id, released_by_choice_id FROM production_protections
             WHERE production_object_id = ? ORDER BY id`,
          )
          .all(fixture.shot.id),
      ).toEqual(protectionsBeforeRollback);
      expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM user_choices').get()).toEqual(
        choicesBeforeRollback,
      );
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM project_events').get(),
      ).toEqual(eventsBeforeRollback);
      expect(
        fixture.database
          .prepare(
            `SELECT source_revision, source_hash, source_state, source_v1_json, search_text, updated_at
             FROM project_search_documents WHERE source_kind = 'production' AND source_id = ?`,
          )
          .get(fixture.shot.id),
      ).toEqual(searchBeforeRollback);

      const productionWireRequest = protectionRequest(
        'request.choice.protection.wire.production.unprotect',
        'unprotect',
        commanderProtected.owner,
        productionField,
      );
      const productionWireResult = fixture.data.userChoices.setProtection(
        productionWireRequest,
        fixture.userContext,
      );
      expect(
        fixture.data.userChoices.setProtection(productionWireRequest, fixture.userContext),
      ).toEqual(productionWireResult);

      const created = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.choice.protection.delivery.create',
          method: 'delivery.apply',
          input: {
            action: 'create',
            project: {
              authority: 'project',
              id: fixture.project.id,
              revision: fixture.project.revision,
              contentHash: fixture.project.contentHash,
            },
            name: 'Protection cut',
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
      ).result.plan;
      const deliveryField = {
        owner: 'delivery' as const,
        deliveryId: created.id,
        itemId: null,
        field: 'name' as const,
      };
      const deliveryProtected = withImmediateTransaction(fixture.database, () =>
        setDecisionProtectionInTransaction(
          fixture.database,
          fixture.environment,
          protectionRequest(
            'request.choice.protection.core.delivery.protect',
            'protect',
            deliveryRef(created),
            deliveryField,
          ),
          fixture.userContext,
          NOW,
        ),
      );
      const deliveryUnprotected = withImmediateTransaction(fixture.database, () =>
        setDecisionProtectionInTransaction(
          fixture.database,
          fixture.environment,
          protectionRequest(
            'request.choice.protection.core.delivery.unprotect',
            'unprotect',
            deliveryProtected.owner,
            deliveryField,
          ),
          fixture.userContext,
          NOW,
        ),
      );
      expect(deliveryProtected).toMatchObject({
        active: true,
        owner: deliveryProtected.choice.ownerAfter,
      });
      expect(deliveryUnprotected).toMatchObject({
        active: false,
        owner: deliveryUnprotected.choice.ownerAfter,
      });
      for (const result of [deliveryProtected, deliveryUnprotected]) {
        expect(
          fixture.database
            .prepare('SELECT subject_id, event_type FROM project_events WHERE id = ?')
            .get(result.eventId),
        ).toEqual({ subject_id: result.choice.id, event_type: 'choice_recorded' });
      }

      const deliveryWireRequest = protectionRequest(
        'request.choice.protection.wire.delivery.protect',
        'protect',
        deliveryUnprotected.owner,
        deliveryField,
      );
      const deliveryWireResult = fixture.data.userChoices.setProtection(
        deliveryWireRequest,
        fixture.userContext,
      );
      expect(
        fixture.data.userChoices.setProtection(deliveryWireRequest, fixture.userContext),
      ).toEqual(deliveryWireResult);
    } finally {
      fixture.store.close();
    }
  }, 30_000);

  it('records all result decision kinds, switches the single selection, and replays exactly', async () => {
    const fixture = await harness();
    try {
      const [firstResult, secondResult] = fixture.results;
      const firstRequest = decisionRequest(
        'request.choice.select.1',
        shotRef(fixture),
        firstResult,
        'select',
      );
      const selected = fixture.data.userChoices.recordResultDecision(
        firstRequest,
        fixture.userContext,
      );
      expect(
        fixture.data.userChoices.recordResultDecision(firstRequest, fixture.userContext),
      ).toEqual(selected);
      expect(fixture.data.production.get(fixture.shot.id).object).toMatchObject({
        revision: 1,
        resultDecisions: [
          {
            result: refOf(firstResult),
            value: { state: 'selected', feedback: 'Use this take.' },
            currentChoiceId: selected.result.id,
          },
        ],
      });
      expect(fixture.data.production.get(fixture.shot.id).currentChoices).toEqual([
        {
          authority: 'user_choice',
          id: selected.result.id,
          choiceHash: selected.result.choiceHash,
        },
      ]);

      for (const action of ['reject', 'refine', 'use_as_reference'] as const) {
        const request = decisionRequest(
          `request.choice.${action}`,
          shotRef(fixture),
          secondResult,
          action,
        );
        fixture.data.userChoices.recordResultDecision(request, fixture.userContext);
      }
      const switched = fixture.data.userChoices.recordResultDecision(
        decisionRequest('request.choice.select.2', shotRef(fixture), secondResult, 'select'),
        fixture.userContext,
      ).result;
      const shot = fixture.data.production.get(fixture.shot.id).object;
      if (shot.type !== 'shot') throw new Error('fixture shot');
      expect(shot.resultDecisions).toEqual([
        {
          result: refOf(secondResult),
          value: { state: 'selected', feedback: 'Use this take.' },
          currentChoiceId: switched.id,
        },
      ]);
      expect(fixture.data.production.get(fixture.shot.id).currentChoices).toEqual([
        {
          authority: 'user_choice',
          id: switched.id,
          choiceHash: switched.choiceHash,
        },
      ]);
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM production_result_decisions WHERE state = 'selected'",
          )
          .get(),
      ).toEqual({ count: 1 });
      expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM user_choices').get()).toEqual({
        count: 5,
      });
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'choice_recorded'",
          )
          .get(),
      ).toEqual({ count: 5 });
      expect(fixture.data.userChoices.getChoice(switched.id)).toEqual(switched);
    } finally {
      fixture.store.close();
    }
  });

  it('lets a direct user retain protection but requires exact same-Run confirmation for Commander', async () => {
    const fixture = await harness();
    try {
      const [result] = fixture.results;
      fixture.data.userChoices.recordResultDecision(
        decisionRequest('request.choice.protected.seed', shotRef(fixture), result, 'select'),
        fixture.userContext,
      );
      const field = {
        owner: 'production' as const,
        objectId: fixture.shot.id,
        field: 'resultDecision' as const,
        resultId: result.id,
      };
      const protectedChoice = fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.choice.protect',
          method: 'decision.protect',
          input: { mode: 'protect', owner: shotRef(fixture), field, reason: 'Approved take' },
        },
        fixture.userContext,
      ).result;
      const ownerBeforeDirect = shotRef(fixture);
      fixture.data.userChoices.recordResultDecision(
        decisionRequest('request.choice.direct.protected', ownerBeforeDirect, result, 'refine'),
        fixture.userContext,
      );
      expect(fixture.data.production.get(fixture.shot.id).object.protections).toEqual([
        { field, choiceId: protectedChoice.id, protectedAt: NOW },
      ]);

      const request = decisionRequest(
        'request.choice.commander.protected',
        shotRef(fixture),
        result,
        'reject',
      );
      const afterEffect: UserChoiceEffect = {
        kind: 'result_decisions',
        shotId: fixture.shot.id,
        entries: [
          {
            resultId: result.id,
            value: { state: 'rejected', feedback: 'Wrong composition.' },
          },
        ],
      };
      let exactTarget!: ConfirmationTarget;
      const staleDispatch = insertAllowedDispatch(
        fixture,
        'decision.record',
        request.input,
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
            owner: request.input.shot,
            fields: [field],
            activeChoiceIds: [protectedChoice.id],
            proposedEffectHash: hashCanonical(afterEffect),
            plannedIds: plannedProtectedChoiceMutationIds(id, 'decision.record'),
          };
          return { ...exactTarget, proposedEffectHash: HASH_A };
        },
      );
      const beforeStaleOwner = fixture.data.production.get(fixture.shot.id).object;
      const beforeStaleChoices = fixture.database
        .prepare('SELECT COUNT(*) AS count FROM user_choices')
        .get();
      const beforeStaleEvents = fixture.database
        .prepare(
          "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'choice_recorded'",
        )
        .get();
      expect(() =>
        fixture.data.userChoices.recordResultDecision(request, fixture.commanderContext, {
          dispatchOperationId: staleDispatch,
        }),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));
      expect(fixture.data.production.get(fixture.shot.id).object).toEqual(beforeStaleOwner);
      expect(fixture.database.prepare('SELECT COUNT(*) AS count FROM user_choices').get()).toEqual(
        beforeStaleChoices,
      );
      expect(
        fixture.database
          .prepare(
            "SELECT COUNT(*) AS count FROM project_events WHERE event_type = 'choice_recorded'",
          )
          .get(),
      ).toEqual(beforeStaleEvents);
      fixture.database
        .prepare('UPDATE run_confirmations SET target_v1_json = ? WHERE id = ?')
        .run(canonicalJson(exactTarget), `confirmation.${staleDispatch}`);
      expect(
        fixture.data.userChoices.recordResultDecision(request, fixture.commanderContext, {
          dispatchOperationId: staleDispatch,
        }).result,
      ).toMatchObject({
        actor: 'commander',
        authorization: {
          kind: 'commander_dispatch',
          dispatchOperationId: staleDispatch,
          confirmationId: `confirmation.${staleDispatch}`,
        },
      });
    } finally {
      fixture.store.close();
    }
  });

  it('protects, unprotects, and undoes only the exact current Production owner', async () => {
    const fixture = await harness();
    try {
      const [result] = fixture.results;
      const selected = fixture.data.userChoices.recordResultDecision(
        decisionRequest('request.choice.undo.seed', shotRef(fixture), result, 'select'),
        fixture.userContext,
      ).result;
      const staleOwner = selected.ownerBefore!;
      const undoRequest = {
        wireVersion: 1 as const,
        kind: 'request' as const,
        requestId: 'request.choice.undo',
        method: 'decision.record' as const,
        input: {
          action: 'undo' as const,
          targetChoice: {
            authority: 'user_choice' as const,
            id: selected.id,
            choiceHash: selected.choiceHash,
          },
          currentOwner: selected.ownerAfter,
        },
      };
      const undone = fixture.data.userChoices.undoChoice(undoRequest, fixture.userContext);
      expect(fixture.data.userChoices.undoChoice(undoRequest, fixture.userContext)).toEqual(undone);
      expect(fixture.data.production.get(fixture.shot.id).object).toMatchObject({
        resultDecisions: [],
      });
      expect(fixture.data.production.get(fixture.shot.id).currentChoices).toEqual([]);
      expect(undone.result).toMatchObject({
        choice: { kind: 'undo', targetChoiceId: selected.id },
        supersedesChoiceIds: [selected.id],
      });
      expect(() =>
        fixture.data.userChoices.undoChoice(
          {
            ...undoRequest,
            requestId: 'request.choice.undo.stale',
            input: { ...undoRequest.input, currentOwner: staleOwner },
          },
          fixture.userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));

      const field = {
        owner: 'production' as const,
        objectId: fixture.shot.id,
        field: 'content' as const,
      };
      fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.choice.content.protect',
          method: 'decision.protect',
          input: { mode: 'protect', owner: shotRef(fixture), field, reason: '' },
        },
        fixture.userContext,
      );
      fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.choice.content.unprotect',
          method: 'decision.protect',
          input: { mode: 'unprotect', owner: shotRef(fixture), field, reason: '' },
        },
        fixture.userContext,
      );
      expect(fixture.data.production.get(fixture.shot.id).object.protections).toEqual([]);
    } finally {
      fixture.store.close();
    }
  });

  it('rejects stale concurrency, cross-Project/tampered refs, import overwrite, and ignores TaskList state', async () => {
    const fixture = await harness();
    try {
      const [firstResult, secondResult] = fixture.results;
      const commonOwner = shotRef(fixture);
      fixture.data.userChoices.recordResultDecision(
        decisionRequest('request.choice.concurrent.1', commonOwner, firstResult, 'select'),
        fixture.userContext,
      );
      expect(() =>
        fixture.data.userChoices.recordResultDecision(
          decisionRequest('request.choice.concurrent.2', commonOwner, secondResult, 'select'),
          fixture.userContext,
        ),
      ).toThrowError(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(() =>
        fixture.data.userChoices.recordResultDecision(
          decisionRequest(
            'request.choice.tamper',
            shotRef(fixture),
            { ...secondResult, contentHash: HASH_A },
            'select',
          ),
          fixture.userContext,
        ),
      ).toThrowError();

      const field = {
        owner: 'production' as const,
        objectId: fixture.shot.id,
        field: 'resultDecision' as const,
        resultId: firstResult.id,
      };
      fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.choice.import.protect',
          method: 'decision.protect',
          input: { mode: 'protect', owner: shotRef(fixture), field, reason: '' },
        },
        fixture.userContext,
      );
      expect(() =>
        fixture.data.userChoices.recordResultDecision(
          decisionRequest('request.choice.import.blocked', shotRef(fixture), firstResult, 'reject'),
          {
            actor: 'import',
            causation: { kind: 'import', importId: 'import.choice.fixture' },
            correlationId: 'correlation.choice.import',
          },
        ),
      ).toThrowError(expect.objectContaining({ code: 'INVALID_REQUEST' }));

      const currentRun = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.choice.run',
        method: 'run.get',
        input: { runId: fixture.run.id },
      }).result;
      const taskList = fixture.data.taskLists.manage(
        fixture.run.id,
        {
          action: 'create',
          expectedRunRevision: currentRun.revision,
          title: 'Choice progress',
          tasks: [{ draftId: 'draft.choice', title: 'Unrelated', parentDraftId: null, order: 0 }],
          publicSummary: 'Tracking an unrelated task.',
        },
        { commandId: 'command.choice.task.create', context: fixture.commanderContext },
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
        { commandId: 'command.choice.task.block', context: fixture.commanderContext },
      );
      const unprotected = fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.choice.tasklist.ignored',
          method: 'decision.protect',
          input: { mode: 'unprotect', owner: shotRef(fixture), field, reason: '' },
        },
        fixture.userContext,
      );
      expect(unprotected.result.choice.kind).toBe('unprotect');
      expect(
        fixture.database.prepare('SELECT COUNT(*) AS count FROM delivery_plans').get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
    }
  });
});
