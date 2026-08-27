import { rm } from 'node:fs/promises';
import {
  AgentCancelDefinition,
  AgentResultDefinition,
  AgentSendDefinition,
  AgentSpawnDefinition,
  AgentWaitDefinition,
  CapabilityCatalogSnapshotV1Schema,
  CanvasMutateDefinition,
  CanvasQueryDefinition,
  ChatQueryDefinition,
  DecisionProtectDefinition,
  DecisionRecordDefinition,
  DeliveryExportDefinition,
  DeliveryFreezeDefinition,
  DeliveryMutateDefinition,
  DeliveryPreviewDefinition,
  DeliveryQueryDefinition,
  EvaluationRunDefinition,
  GenerationQuoteDefinition,
  GenerationSubmitDefinition,
  HistoryQueryDefinition,
  InteractionAskDefinition,
  MediaAttachDefinition,
  MediaDeriveDefinition,
  MediaInspectDefinition,
  MediaLinkDefinition,
  MediaQueryDefinition,
  MemoryQueryDefinition,
  OperationCancelDefinition,
  OperationGetDefinition,
  OperationRefSchema,
  ProductionMutateDefinition,
  ProductionQueryDefinition,
  ProjectGetDefinition,
  ProjectSearchDefinition,
  ProviderCapabilitiesDefinition,
  ResultQueryDefinition,
  RunInspectDefinition,
  SkillLoadDefinition,
  SkillProposeDefinition,
  TaskManageDefinition,
  ToolGetDefinition,
  ToolProgramDefinition,
  capabilityCatalogHashInput,
  generationPromptAssemblyHashInput,
  providerReceiptHashInput,
  skillCatalogDigestInput,
  type CapabilityCatalogSnapshotV1,
  type CanonicalModelRequestV1,
  type GenerationSpec,
  type ModelAdapterEvent,
  type ModelResourceQuoteV1,
  type OperationRef,
  type ResourceBudget,
  type RuntimeLoopOutcome,
  type SkillDocument,
  type ToolId,
} from '@lucid-fin/target-contracts';
import {
  createHostCatalogProvisioning,
  createHostConfirmationAuthority,
  createHostInteractionAuthority,
} from '@lucid-fin/target-storage/host';
import type {
  HarnessActivationSnapshot,
  HarnessPersistenceAuthority,
  GenerationProviderState,
  MessageSendAcceptanceSeed,
  PrivateModelContext,
  ResultAssessmentProviderState,
} from '@lucid-fin/target-storage';
import { describe, expect, it, vi } from 'vitest';
import {
  NOW,
  IMPORT_TOKEN,
  PROVIDER_ID,
  PROVIDER_MODEL,
  ROOT_CATALOG,
  FakeAssessmentProvider,
  FakeGenerationProvider,
  FakeTranscriptionProvider,
  budget,
  commanderContext,
  createJourneyDataAccess,
  createJourneyDependencies,
  createJourneyFixture,
  createJourneyPrivateRecoveryCodec,
  formatPolicy,
  getJourneyTestDatabase,
  hashCanonical,
  sha256,
  userContext,
  type JourneyDependencies,
} from '../../target-storage/test/i2h/fixture.js';
import {
  createTargetStorageReadToolExecutor,
  coordinateRun,
  drainRequestedOperationCancellations,
  recoverTargetActivation,
  runTargetActivation,
  type RecoverTargetActivationDependencies,
  type TargetModelAdapter,
  type TargetToolExecution,
  type TargetToolExecutor,
} from './index.js';

const USAGE = {
  inputTokens: { state: 'known' as const, value: 120 },
  outputTokens: { state: 'known' as const, value: 24 },
  cost: { state: 'known' as const, value: '0.5', currency: 'USD' },
};

const OPERATION_OWNER_AUTHORITIES = {
  generation_attempt: 'generation_attempt',
  media_derivation: 'media_derivation_attempt',
  result_assessment: 'result_assessment_attempt',
  review_cut_attempt: 'review_cut_attempt',
  delivery_export: 'delivery_export',
} as const;

function queuedCancellationOperation(
  kind: OperationRef['kind'],
  suffix: string,
): { readonly runId: string; readonly operation: OperationRef } {
  const id = `operation.runtime.cancellation.${suffix}`;
  return {
    runId: `run.runtime.cancellation.${suffix}`,
    operation: OperationRefSchema.parse({
      id,
      revision: 1,
      kind,
      ownerRef: {
        authority: OPERATION_OWNER_AUTHORITIES[kind],
        id: `attempt.runtime.cancellation.${suffix}`,
        revision: 1,
        contentHash: sha256(`owner.runtime.cancellation.${suffix}`),
      },
    }),
  };
}

function throwOnOperationCancellationError(cause: unknown): never {
  throw cause;
}

const ROOT_ACCEPTANCE_SEED = {
  model: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
  locale: 'en-US',
  timeZone: 'UTC',
  capabilityCatalog: ROOT_CATALOG,
  projectMediaSelections: [],
  citedMemoryEntryIds: [],
} satisfies MessageSendAcceptanceSeed;

const UNKNOWN_COST_BUDGET: ResourceBudget = {
  ...budget,
  costUsd: { state: 'unknown', currency: 'USD' },
};

const STORAGE_READ_IDS = [
  'canvas.query',
  'chat.query',
  'delivery.query',
  'generation.quote',
  'history.query',
  'media.inspect',
  'media.query',
  'memory.query',
  'operation.get',
  'project.get',
  'project.search',
  'production.query',
  'provider.capabilities',
  'result.query',
  'run.inspect',
  'skill.load',
  'tool.get',
] as const;
const INITIAL_STORAGE_READ_IDS = [
  'history.query',
  'memory.query',
  'result.query',
  'skill.load',
  'tool.get',
] as const;
const MATERIALIZED_MODEL_TOOL_IDS = [
  AgentCancelDefinition.id,
  AgentResultDefinition.id,
  AgentSendDefinition.id,
  AgentSpawnDefinition.id,
  AgentWaitDefinition.id,
  HistoryQueryDefinition.id,
  InteractionAskDefinition.id,
  MemoryQueryDefinition.id,
  OperationCancelDefinition.id,
  ResultQueryDefinition.id,
  SkillLoadDefinition.id,
  SkillProposeDefinition.id,
  TaskManageDefinition.id,
  ToolGetDefinition.id,
  ToolProgramDefinition.id,
] as const;

const SKILLS = [
  {
    skillId: 'skill.alpha',
    name: 'Alpha review',
    description: 'Review alpha evidence.',
    version: '1.0.0',
    contentHash: sha256('Apply the alpha review instructions.'),
    provenance: 'built_in',
    trust: 'trusted',
    content: 'Apply the alpha review instructions.',
    createdAt: NOW,
  },
  {
    skillId: 'skill.beta',
    name: 'Beta review',
    description: 'Review beta evidence.',
    version: '1.0.0',
    contentHash: sha256('Apply the beta review instructions.'),
    provenance: 'installed',
    trust: 'reviewed',
    content: 'Apply the beta review instructions.',
    createdAt: NOW,
  },
] as const satisfies readonly SkillDocument[];

function catalogWithSkills(skills: readonly SkillDocument[]): CapabilityCatalogSnapshotV1 {
  const withoutHash = {
    version: ROOT_CATALOG.version,
    parserPolicyVersion: ROOT_CATALOG.parserPolicyVersion,
    parentCatalogHash: ROOT_CATALOG.parentCatalogHash,
    toolCatalogDigest: ROOT_CATALOG.toolCatalogDigest,
    skillCatalogDigest: sha256(skillCatalogDigestInput(skills)),
    capabilityIndexDigest: ROOT_CATALOG.capabilityIndexDigest,
    tools: ROOT_CATALOG.tools,
    skills,
    capabilityIndex: ROOT_CATALOG.capabilityIndex,
  };
  return CapabilityCatalogSnapshotV1Schema.parse({
    catalogHash: sha256(capabilityCatalogHashInput(withoutHash)),
    ...withoutHash,
  });
}

const SKILL_CATALOG = catalogWithSkills(SKILLS);

const HISTORY_QUERY_INPUT = HistoryQueryDefinition.parseInput({
  sources: ['message'],
  eventTypes: [],
  subjects: [],
  actors: [],
  time: { from: null, to: null },
  page: { cursor: null, limit: 20 },
});

const FINAL_RESPONSE = [
  { type: 'assistant_delta', publicText: 'The read completed.' },
  { type: 'usage', usage: USAGE },
  { type: 'model_completed', finishReason: 'stop' },
] satisfies readonly ModelAdapterEvent[];

function interruptedResponse(finishReason: 'length' | 'content_filter') {
  return [
    { type: 'assistant_delta', publicText: 'The response was interrupted.' },
    { type: 'usage', usage: USAGE },
    { type: 'model_completed', finishReason },
  ] satisfies readonly ModelAdapterEvent[];
}

const LENGTH_RESPONSE = interruptedResponse('length');

type ToolArguments = Extract<ModelAdapterEvent, { type: 'tool_call' }>['canonicalArguments'];

function fakeToolExecutor(
  toolIds: readonly ToolId[],
  execute: TargetToolExecutor['execute'],
  initialToolIds?: readonly ToolId[],
): TargetToolExecutor {
  return {
    toolIds,
    initialToolIds:
      initialToolIds ?? (toolIds === STORAGE_READ_IDS ? INITIAL_STORAGE_READ_IDS : toolIds),
    execute,
  };
}

function toolExecution(projectId: string, toolId: ToolId, input: unknown): TargetToolExecution {
  const tool = ROOT_CATALOG.tools.find(({ id }) => id === toolId);
  if (tool === undefined) throw new Error(`Missing fixture tool ${toolId}`);
  return {
    dispatchOperationId: `operation.${toolId}`,
    operationFingerprint: 'a'.repeat(64),
    origin: {
      kind: 'model',
      modelAttemptId: 'model-attempt.1',
      providerCallId: `provider-call.${toolId}`,
    },
    runId: 'run.1',
    projectId,
    toolId,
    toolVersion: tool.version,
    authorityWatermarkHash: null,
    input,
  };
}

function toolResponse(
  toolId: ToolId,
  canonicalArguments: ToolArguments,
  providerCallId = `provider-call.${toolId}`,
): readonly ModelAdapterEvent[] {
  return [
    { type: 'tool_call', providerCallId, toolId, canonicalArguments },
    { type: 'usage', usage: USAGE },
    { type: 'model_completed', finishReason: 'tool_calls' },
  ];
}

function serializedDatabaseRows(database: ReturnType<typeof getJourneyTestDatabase>): string {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as unknown as Array<{ readonly name: string }>;
  return JSON.stringify(
    tables.map(({ name }) => ({ name, rows: database.prepare(`SELECT * FROM "${name}"`).all() })),
  );
}

class PendingGenerationProvider extends FakeGenerationProvider {
  async submit(): Promise<GenerationProviderState> {
    this.submitCalls += 1;
    const receiptSeed = {
      providerOperationId: 'provider.operation.runtime.operation-cancel',
      submittedAt: NOW,
      reconciledAt: null,
      receiptHash: '0'.repeat(64),
    };
    return {
      state: 'submitted',
      receipt: {
        ...receiptSeed,
        receiptHash: hashCanonical(providerReceiptHashInput(receiptSeed)),
      },
      usage: null,
      outputs: [],
    };
  }

  async cancel(
    request: Parameters<FakeGenerationProvider['cancel']>[0],
  ): Promise<GenerationProviderState> {
    this.cancelCalls += 1;
    return {
      state: 'cancelled',
      receipt: request.receipt,
      usage: {
        inputTokens: { state: 'known', value: 0 },
        outputTokens: { state: 'known', value: 0 },
        generatedUnits: { state: 'known', value: 0 },
        cost: { state: 'known', value: '0', currency: 'USD' },
      },
      outputs: [],
    };
  }
}

class RecoverableGenerationProvider extends FakeGenerationProvider {
  private failBeforeReceipt = true;

  async submit(): Promise<GenerationProviderState> {
    if (this.failBeforeReceipt) {
      this.failBeforeReceipt = false;
      this.submitCalls += 1;
      throw new Error('simulated provider connection loss before receipt');
    }
    return super.submit();
  }

  async reconcileByIdempotencyKey(): Promise<GenerationProviderState> {
    this.reconcileCalls += 1;
    return { state: 'not_submitted' };
  }
}

class RecoverableAssessmentProvider extends FakeAssessmentProvider {
  private failBeforeReceipt = true;

  async submit(
    request: Parameters<FakeAssessmentProvider['submit']>[0],
  ): Promise<ResultAssessmentProviderState> {
    if (this.failBeforeReceipt) {
      this.failBeforeReceipt = false;
      this.submitCalls += 1;
      throw new Error('simulated assessment provider connection loss before receipt');
    }
    return super.submit(request);
  }
}

class UnavailableTranscriptionProvider extends FakeTranscriptionProvider {
  async submit(): Promise<never> {
    this.submitCalls += 1;
    throw new Error('simulated transcription connection loss after exposure');
  }

  async reconcileByIdempotencyKey(): Promise<never> {
    this.reconcileCalls += 1;
    throw new Error('simulated transcription reconciliation outage');
  }
}

class FakeModelAdapter implements TargetModelAdapter {
  readonly provider = {
    providerId: PROVIDER_ID,
    model: PROVIDER_MODEL,
    reasoningStrength: null,
  };
  readonly quoted: CanonicalModelRequestV1[] = [];
  readonly streamed: CanonicalModelRequestV1[] = [];
  readonly quotedPrivateContexts: PrivateModelContext[] = [];
  readonly streamedPrivateContexts: PrivateModelContext[] = [];

  constructor(
    private readonly firstResponse: readonly ModelAdapterEvent[] = toolResponse(
      HistoryQueryDefinition.id,
      HISTORY_QUERY_INPUT,
      'provider-call.history-query',
    ),
    private readonly subsequentResponses: readonly (readonly ModelAdapterEvent[])[] = [
      FINAL_RESPONSE,
    ],
    private readonly beforeStream?: (
      request: CanonicalModelRequestV1,
      attemptIndex: number,
    ) => void | Promise<void>,
    private readonly beforeQuote?: (
      request: CanonicalModelRequestV1,
      quoteIndex: number,
    ) => void | Promise<void>,
  ) {}

  async quote(
    request: CanonicalModelRequestV1,
    privateContext: PrivateModelContext,
  ): Promise<ModelResourceQuoteV1> {
    this.quoted.push(request);
    this.quotedPrivateContexts.push(privateContext);
    await this.beforeQuote?.(request, this.quoted.length - 1);
    return USAGE;
  }

  async *stream(
    request: CanonicalModelRequestV1,
    privateContext: PrivateModelContext,
  ): AsyncIterable<ModelAdapterEvent> {
    this.streamed.push(request);
    this.streamedPrivateContexts.push(privateContext);
    await this.beforeStream?.(request, this.streamed.length - 1);
    const response =
      this.streamed.length === 1
        ? this.firstResponse
        : this.subsequentResponses[this.streamed.length - 2];
    if (response === undefined) throw new Error('Fake Model exhausted its scripted responses');
    for (const event of response) {
      yield event;
    }
  }
}

async function acceptedRuntimeFixture(
  capabilityCatalog = ROOT_CATALOG,
  dependencies?: JourneyDependencies,
  objective = 'Inspect the current Project.',
  runtimeBudget: ResourceBudget = budget,
) {
  const fixture = await createJourneyFixture(dependencies);
  const host = createHostCatalogProvisioning(fixture.store, { now: () => NOW });
  host.registerProviderProfile({
    id: PROVIDER_ID,
    displayName: 'I3 Fake Model',
    providerKind: 'fake-model',
    model: PROVIDER_MODEL,
    status: 'ready',
  });
  const created = fixture.data.projects.create(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.i3k1.project.create',
      method: 'project.create',
      input: {
        name: 'I3-K1 runtime fixture',
        permissionMode: 'reversible',
        budget: runtimeBudget,
        formatPolicy,
      },
    },
    userContext,
  ).result;
  for (const skill of capabilityCatalog.skills) {
    host.registerSkill({
      document: skill,
      projectId: null,
    });
  }
  fixture.data.projects.updateSettings(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.i3k1.settings.update',
      method: 'project.settings.update',
      input: {
        projectId: created.project.id,
        expectedRevision: created.settings.revision,
        expectedContentHash: created.settings.contentHash,
        defaultProviderProfileId: PROVIDER_ID,
        formatPolicy,
        permission: 'reversible',
        budget: runtimeBudget,
        enabledSkills: capabilityCatalog.skills.map(({ skillId, version }) => ({
          id: skillId,
          version,
        })),
      },
    },
    userContext,
  );
  const chat = fixture.data.conversations.createChat(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.i3k1.chat.create',
      method: 'chat.create',
      input: { projectId: created.project.id, title: 'Runtime loop' },
    },
    userContext,
  ).result;
  const run = fixture.data.conversations.sendMessage(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.i3k1.message.send',
      method: 'message.send',
      input: {
        chatId: chat.id,
        blocks: [{ type: 'text', text: objective }],
        attachments: [],
        selectedContext: [
          {
            ref: {
              authority: 'project',
              id: created.project.id,
              revision: created.project.revision,
              contentHash: created.project.contentHash,
            },
            role: 'target',
          },
        ],
        exportDestinationGrant: null,
        supersedesMessageId: null,
      },
    },
    userContext,
    ROOT_ACCEPTANCE_SEED,
  ).result.acceptedRun;
  const context = commanderContext(run.id);
  const inbox = fixture.data.runs.listInbox(run.id)[0]!;
  return { fixture, context, inbox, project: created.project, runId: run.id };
}

async function confirmProtectedRuntimeMutation(
  state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>,
  toolId: typeof DecisionRecordDefinition.id | typeof DecisionProtectDefinition.id,
  input: ToolArguments,
  decision: 'approved' | 'denied',
  suffix: string,
) {
  const { fixture, context, runId } = state;
  const definition = ROOT_CATALOG.tools.find(({ id }) => id === toolId);
  if (definition === undefined) throw new Error(`Missing ${toolId} fixture tool`);
  const initialModel = new FakeModelAdapter(
    toolResponse(
      ToolGetDefinition.id,
      ToolGetDefinition.parseInput({ names: [toolId] }),
      `provider-call.tool-get.${suffix}`,
    ),
    [toolResponse(toolId, input, `provider-call.${suffix}`)],
  );
  const executions: ToolId[] = [];
  const paused = await coordinateRun(
    {
      runs: fixture.data.runs,
      persistence: fixture.data.harness,
      model: initialModel,
      toolExecutor: fakeToolExecutor([ToolGetDefinition.id], (execution) => {
        executions.push(execution.toolId);
        if (execution.toolId !== ToolGetDefinition.id) {
          throw new Error(`${toolId} must not reach the generic executor`);
        }
        return ToolGetDefinition.parseOutcome({
          status: 'succeeded',
          data: { definitions: [definition], catalogHash: ROOT_CATALOG.catalogHash },
        });
      }),
    },
    { runId, limits: { maxInputTokens: 2_000, maxOutputTokens: 500 }, context },
  );
  if (paused.kind !== 'executed') throw new Error(`Expected protected ${toolId} Run`);
  const dispatch = paused.snapshot.dispatches.find(({ key }) => key.toolId === toolId);
  if (dispatch === undefined || dispatch.confirmationId === null) {
    throw new Error(`Expected a pending protected ${toolId} Dispatch`);
  }
  expect(executions).toEqual([ToolGetDefinition.id]);
  expect(initialModel.streamed).toHaveLength(2);
  expect(initialModel.streamed[0]!.materializedTools.some(({ id }) => id === toolId)).toBe(false);
  expect(initialModel.streamed[1]!.materializedTools).toContainEqual(
    expect.objectContaining({ id: toolId, version: definition.version }),
  );
  expect(paused.snapshot.run.status).toBe('waiting_confirmation');
  expect(dispatch).toMatchObject({
    guardOutcome: 'confirmation_required',
    outcome: null,
    key: { toolId, input },
  });

  const confirmation = createHostConfirmationAuthority(fixture.store, {
    now: () => NOW,
    createId: fixture.createId,
  }).respond(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: `request.runtime.${suffix}.confirm`,
      method: 'confirmation.respond',
      input: {
        confirmationId: dispatch.confirmationId,
        immutableInputHash: dispatch.key.inputHash,
        decision,
      },
    },
    userContext,
  );
  const answerInbox = fixture.data.runs
    .listInbox(runId)
    .find(
      ({ source }) =>
        source.kind === 'message' && source.messageId === confirmation.result.messageId,
    );
  if (answerInbox === undefined) throw new Error('Expected a confirmation answer Inbox item');
  const settled = fixture.data.harness
    .loadActivation(runId, 1)
    .dispatches.find(({ id }) => id === dispatch.id);
  if (settled === undefined || settled.outcome === null) {
    throw new Error(`Expected the confirmed ${toolId} Dispatch to settle`);
  }
  const continuationModel = new FakeModelAdapter(FINAL_RESPONSE);
  const resumed = await coordinateRun(
    {
      runs: fixture.data.runs,
      persistence: fixture.data.harness,
      model: continuationModel,
      toolExecutor: fakeToolExecutor([ToolGetDefinition.id], () => {
        throw new Error('A confirmation continuation final must not execute a tool');
      }),
    },
    { runId, limits: { maxInputTokens: 2_000, maxOutputTokens: 500 }, context },
  );
  if (resumed.kind !== 'executed') {
    throw new Error('Expected the confirmation continuation Activation to execute');
  }
  expect(continuationModel.streamed).toHaveLength(1);
  expect(continuationModel.streamed[0]!.activationNumber).toBe(2);
  expect(continuationModel.streamed[0]!.facts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: 'tool_result',
        dispatchOperationId: dispatch.id,
        toolId,
        outcome: settled.outcome,
      }),
    ]),
  );
  expect(settled.outcome).toMatchObject(
    decision === 'approved'
      ? { status: 'succeeded' }
      : { status: 'permission_denied', code: 'protected_denied' },
  );
  expect(resumed.snapshot.activation).toMatchObject({
    activationNumber: 2,
    triggerInboxMessageId: answerInbox.id,
    triggerInboxSequence: answerInbox.sequence,
    state: 'ended',
    endReason: 'terminal',
  });
  return { confirmation, dispatch, paused, resumed, settled };
}

async function seedCancelableGenerationOperation(
  state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>,
  provider: PendingGenerationProvider,
) {
  const { fixture, context, project, runId } = state;
  const providerId = 'provider.runtime.operation-cancel';
  createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerProviderProfile({
    id: providerId,
    displayName: 'Runtime cancellation provider',
    providerKind: provider.providerKind,
    model: 'video-model',
    status: 'ready',
  });
  const target = fixture.data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.operation-cancel.target',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Cancelable harbor shot',
            description: 'A pending fake generation used only by the disposable runtime test.',
            durationMs: null,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    context,
  ).result.object;
  const currentProject = fixture.data.projects.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.runtime.operation-cancel.project',
    method: 'project.get',
    input: { projectId: project.id },
  }).result;
  const spec: GenerationSpec = {
    kind: 'image',
    task: 'create',
    target: {
      authority: 'production',
      id: target.id,
      revision: target.revision,
      contentHash: target.contentHash,
    },
    prompt: 'A moonlit harbor test frame.',
    negativePrompt: null,
    references: [],
    provider: { providerId, model: 'video-model' },
    outputCount: 1,
    seed: 7,
    width: 1280,
    height: 720,
    guidanceScale: null,
    sourceMaskRefId: null,
  };
  const quoted = await fixture.data.generation.quote({ runId, request: { spec } });
  const submitted = await fixture.data.generation.submit(
    {
      runId,
      commandId: 'command.runtime.operation-cancel.seed',
      request: {
        spec,
        quote: quoted.quote,
        expectedProjectRevision: currentProject.revision,
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
              filename: 'cancelable-harbor.png',
              displayName: 'Cancelable harbor',
              folderId: null,
              tags: ['runtime-test'],
            },
            projectMediaRef: {
              label: 'Cancelable harbor',
              collections: [],
              roles: ['generated_candidate'],
              notes: '',
            },
          },
        ],
      },
    },
    context,
  );
  if (submitted.state !== 'submitted') {
    throw new Error('Expected a nonterminal fake generation Operation');
  }
  return submitted.operation;
}

async function seedMediaLinkInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const { fixture, context, project } = state;
  const imported = await fixture.data.globalMedia.importGlobal(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.media-link.import',
      method: 'media.global.import',
      input: {
        capabilityToken: IMPORT_TOKEN,
        displayName: 'Runtime harbor reference',
        tags: ['runtime-test'],
      },
    },
    userContext,
  );
  const attached = fixture.data.projectMedia.attach(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.media-link.attach',
      method: 'media.project.attach',
      input: {
        projectId: project.id,
        expectedProjectRevision: project.revision,
        globalAssetId: imported.result.asset.id,
        expectedExistingRef: null,
        label: 'Runtime harbor reference',
        collections: ['Visual direction'],
        roles: ['reference'],
        notes: 'Disposable media.link runtime fixture.',
      },
    },
    userContext,
  ).result.object;
  const target = fixture.data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.media-link.target',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Runtime media link target',
            description: 'A disposable shot used to prove the model media.link boundary.',
            durationMs: null,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    context,
  ).result.object;
  return MediaLinkDefinition.parseInput({
    mode: 'link',
    mediaRef: {
      authority: 'project_media_ref',
      id: attached.id,
      revision: attached.revision,
      contentHash: attached.contentHash,
    },
    target: {
      authority: 'production',
      id: target.id,
      revision: target.revision,
      contentHash: target.contentHash,
    },
    relation: 'references',
  });
}

async function seedMediaAttachInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const { fixture, project } = state;
  const imported = await fixture.data.globalMedia.importGlobal(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.media-attach.import',
      method: 'media.global.import',
      input: {
        capabilityToken: IMPORT_TOKEN,
        displayName: 'Runtime attach source',
        tags: ['runtime-test'],
      },
    },
    userContext,
  );
  return {
    asset: imported.result.asset,
    input: MediaAttachDefinition.parseInput({
      source: { kind: 'global_asset', id: imported.result.asset.id },
      expectedProjectRevision: project.revision,
      label: 'Runtime attached source',
      collections: ['Visual direction'],
      roles: ['reference'],
      notes: 'Disposable media.attach runtime fixture.',
    }),
  };
}

async function seedMediaDeriveInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const { fixture } = state;
  const imported = await fixture.data.globalMedia.importGlobal(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.media-derive.import',
      method: 'media.global.import',
      input: {
        capabilityToken: IMPORT_TOKEN,
        displayName: 'Runtime derivative source',
        tags: ['runtime-test'],
      },
    },
    userContext,
  );
  return MediaDeriveDefinition.parseInput({
    operation: 'resize',
    source: { kind: 'global_asset', id: imported.result.asset.id },
    expectedSourceHash: imported.result.asset.blobHash,
    attach: { enabled: false, expectedProjectRevision: null },
    outputIntents: [
      {
        ordinal: 0,
        globalAsset: {
          filename: 'runtime-derived-reference.png',
          displayName: 'Runtime derived reference',
          folderId: null,
          tags: ['runtime-test', 'derived'],
        },
        projectMediaRef: null,
      },
    ],
    width: 960,
    height: 540,
    fit: 'contain',
  });
}

async function seedMediaTranscribeInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const { fixture } = state;
  const providerId = 'provider.runtime.media-transcribe';
  const model = 'transcription-model';
  createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerProviderProfile({
    id: providerId,
    displayName: 'Runtime transcription provider',
    providerKind: fixture.dependencies.transcription.providerKind,
    model,
    status: 'ready',
  });
  const imported = await fixture.data.globalMedia.importGlobal(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.media-transcribe.import',
      method: 'media.global.import',
      input: {
        capabilityToken: IMPORT_TOKEN,
        displayName: 'Runtime transcription source',
        tags: ['runtime-test'],
      },
    },
    userContext,
  );
  return MediaDeriveDefinition.parseInput({
    operation: 'transcribe',
    source: { kind: 'global_asset', id: imported.result.asset.id },
    expectedSourceHash: imported.result.asset.blobHash,
    attach: { enabled: false, expectedProjectRevision: null },
    outputIntents: [
      {
        ordinal: 0,
        globalAsset: {
          filename: 'runtime-transcript.json',
          displayName: 'Runtime transcript',
          folderId: null,
          tags: ['runtime-test', 'transcript'],
        },
        projectMediaRef: null,
      },
    ],
    language: 'en',
    provider: { providerId, model },
  });
}

async function seedCanvasMutateInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const { fixture, context, project } = state;
  const target = fixture.data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.canvas-mutate.target',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'story',
          content: {
            title: 'Runtime Canvas target',
            premise: 'A Canvas placement created through the model boundary.',
            synopsis: 'The dedicated Canvas path must not reach the generic read executor.',
          },
        },
        relations: [],
      },
    },
    context,
  ).result.object;
  const canvas = fixture.data.canvas.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.runtime.canvas-mutate.canvas',
    method: 'canvas.get',
    input: { projectId: project.id },
  }).result;
  return CanvasMutateDefinition.parseInput({
    action: 'place',
    target: { targetType: 'production', targetId: target.id },
    geometry: { position: { x: 120, y: 80 }, size: { width: 320, height: 180 } },
    expectedCanvasRevision: canvas.revision,
  });
}

async function seedGenerationSubmitInput(
  state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>,
) {
  const { fixture, project, runId } = state;
  const providerId = 'provider.runtime.generation-submit';
  createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerProviderProfile({
    id: providerId,
    displayName: 'Runtime generation provider',
    providerKind: fixture.dependencies.generation.providerKind,
    model: PROVIDER_MODEL,
    status: 'ready',
  });
  const target = fixture.data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.generation-submit.target',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Runtime generated harbor',
            description: 'A disposable target for the generation.submit durable boundary.',
            durationMs: 8_000,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    userContext,
  ).result.object;
  const currentProject = fixture.data.projects.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.runtime.generation-submit.project',
    method: 'project.get',
    input: { projectId: project.id },
  }).result;
  const spec: GenerationSpec = {
    kind: 'video',
    task: 'create',
    target: {
      authority: 'production',
      id: target.id,
      revision: target.revision,
      contentHash: target.contentHash,
    },
    prompt: 'A slow cinematic move across a moonlit harbor.',
    negativePrompt: 'No text overlays.',
    references: [],
    provider: { providerId, model: PROVIDER_MODEL },
    outputCount: 2,
    seed: 29,
    width: 1_920,
    height: 1_080,
    durationMs: 8_000,
    frameRate: 24,
    includeAudio: true,
  };
  const quoted = await fixture.data.generation.quote({ runId, request: { spec } });
  return GenerationSubmitDefinition.parseInput({
    spec,
    quote: quoted.quote,
    expectedProjectRevision: currentProject.revision,
    promptProvenance: {
      sourceObjectId: target.id,
      sourceRevision: target.revision,
      sourceHash: target.contentHash,
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
    outputIntents: [0, 1].map((variantIndex) => ({
      variantIndex,
      globalAsset: {
        filename: `runtime-generation-${variantIndex}.mp4`,
        displayName: `Runtime generation ${variantIndex}`,
        folderId: null,
        tags: ['runtime-test'],
      },
      projectMediaRef: {
        label: `Runtime generation ${variantIndex}`,
        collections: ['Candidates'],
        roles: ['generated_candidate' as const],
        notes: '',
      },
    })),
  });
}

async function seedEvaluationRunInputs(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const { fixture, project } = state;
  const providerId = 'provider.runtime.evaluation-run';
  createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerProviderProfile({
    id: providerId,
    displayName: 'Runtime assessment provider',
    providerKind: fixture.dependencies.assessment.providerKind,
    model: PROVIDER_MODEL,
    status: 'ready',
  });
  const target = fixture.data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.evaluation-run.target',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Runtime evaluation target',
            description: 'A disposable target for all evaluation.run variants.',
            durationMs: 5_000,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    userContext,
  ).result.object;
  const currentProject = fixture.data.projects.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.runtime.evaluation-run.project',
    method: 'project.get',
    input: { projectId: project.id },
  }).result;
  const projectRef = {
    authority: 'project' as const,
    id: currentProject.id,
    revision: currentProject.revision,
    contentHash: currentProject.contentHash,
  };
  const targetRef = {
    authority: 'production' as const,
    id: target.id,
    revision: target.revision,
    contentHash: target.contentHash,
  };
  return {
    technical_integrity: EvaluationRunDefinition.parseInput({
      kind: 'technical_integrity',
      subjects: [projectRef],
      checks: ['readable', 'media_kind'],
      provider: null,
    }),
    reference_similarity: EvaluationRunDefinition.parseInput({
      kind: 'reference_similarity',
      subjects: [projectRef],
      references: [targetRef],
      aspects: ['composition', 'lighting'],
      provider: { providerId, model: PROVIDER_MODEL },
    }),
    continuity: EvaluationRunDefinition.parseInput({
      kind: 'continuity',
      subjects: [projectRef, targetRef],
      aspects: ['identity', 'lighting'],
      provider: { providerId, model: PROVIDER_MODEL },
    }),
    coverage: EvaluationRunDefinition.parseInput({
      kind: 'coverage',
      subjects: [projectRef],
      requirements: ['The harbor setting is represented.'],
      provider: { providerId, model: PROVIDER_MODEL },
    }),
    delivery_readiness: EvaluationRunDefinition.parseInput({
      kind: 'delivery_readiness',
      subjects: [projectRef],
      checks: ['all_items_resolve', 'hashes_valid'],
      provider: null,
    }),
  };
}

async function seedDeliveryFreezeInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const { fixture, project, runId } = state;
  const providerId = 'provider.runtime.delivery-freeze';
  createHostCatalogProvisioning(fixture.store, { now: () => NOW }).registerProviderProfile({
    id: providerId,
    displayName: 'Runtime Delivery provider',
    providerKind: 'fake-video',
    model: PROVIDER_MODEL,
    status: 'ready',
  });
  const shot = fixture.data.production.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.delivery-freeze.shot',
      method: 'production.apply',
      input: {
        action: 'create',
        projectId: project.id,
        expectedProjectRevision: project.revision,
        value: {
          objectType: 'shot',
          content: {
            title: 'Runtime delivery shot',
            description: 'A disposable shot used to prove the delivery.freeze model boundary.',
            durationMs: 8_000,
            shotSize: null,
            cameraMovement: null,
          },
        },
        relations: [],
      },
    },
    userContext,
  ).result.object;
  const spec: GenerationSpec = {
    kind: 'video',
    task: 'create',
    target: {
      authority: 'production',
      id: shot.id,
      revision: shot.revision,
      contentHash: shot.contentHash,
    },
    prompt: 'A short moonlit harbor delivery clip.',
    negativePrompt: null,
    references: [],
    provider: { providerId, model: PROVIDER_MODEL },
    outputCount: 2,
    seed: 19,
    width: 1_920,
    height: 1_080,
    durationMs: 8_000,
    frameRate: 24,
    includeAudio: true,
  };
  const quoted = await fixture.data.generation.quote({ runId, request: { spec } });
  const submitted = await fixture.data.generation.submit(
    {
      runId,
      commandId: 'command.runtime.delivery-freeze.generate',
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
              references: spec.references,
              loadedSkillDigests: [],
            }),
          ),
          loadedSkillDigests: [],
        },
        outputIntents: [0, 1].map((variantIndex) => ({
          variantIndex,
          globalAsset: {
            filename: `runtime-delivery-${variantIndex}.mp4`,
            displayName: `Runtime delivery ${variantIndex}`,
            folderId: null,
            tags: ['runtime-test'],
          },
          projectMediaRef: {
            label: `Runtime delivery ${variantIndex}`,
            collections: ['Candidates'],
            roles: ['generated_candidate' as const],
            notes: '',
          },
        })),
      },
    },
    commanderContext(runId),
  );
  if (submitted.state !== 'succeeded') throw new Error('Expected generated Delivery media');
  const result = fixture.data.results.query(project.id, {
    resultIds: [],
    requestIds: [],
    targetRefs: [],
    include: ['artifact'],
    page: { cursor: null, limit: 20 },
  }).items[0];
  if (result === undefined) throw new Error('Expected a generated Delivery result');
  const created = fixture.data.delivery.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.delivery-freeze.create',
      method: 'delivery.apply',
      input: {
        action: 'create',
        project: {
          authority: 'project',
          id: project.id,
          revision: project.revision,
          contentHash: project.contentHash,
        },
        name: 'Runtime delivery',
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
    userContext,
  ).result.plan;
  const placed = fixture.data.delivery.apply(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.delivery-freeze.place',
      method: 'delivery.apply',
      input: {
        action: 'place',
        plan: {
          authority: 'delivery',
          id: created.id,
          revision: created.revision,
          contentHash: created.contentHash,
        },
        shot: spec.target,
        result: result.resultRef,
        order: 0,
        trim: { startMs: 0, endMs: 8_000 },
        audioPolicy: 'use',
        transition: { kind: 'cut', durationMs: 0 },
      },
    },
    userContext,
  ).result.plan;
  return DeliveryFreezeDefinition.parseInput({
    plan: {
      authority: 'delivery',
      id: placed.id,
      revision: placed.revision,
      contentHash: placed.contentHash,
    },
  });
}

async function seedDecisionRecordInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  await seedDeliveryFreezeInput(state);
  const result = state.fixture.data.results.query(state.project.id, {
    resultIds: [],
    requestIds: [],
    targetRefs: [],
    include: ['artifact'],
    page: { cursor: null, limit: 20 },
  }).items[0];
  if (result === undefined) throw new Error('Expected a generated Decision candidate');
  const shot = state.fixture.data.production.get(result.targetRef.id).object;
  if (shot.type !== 'shot') throw new Error('Expected a generated Shot candidate');
  return {
    result,
    shot,
    input: DecisionRecordDefinition.parseInput({
      action: 'select',
      shot: {
        authority: 'production',
        id: shot.id,
        revision: shot.revision,
        contentHash: shot.contentHash,
      },
      result: result.resultRef,
      feedback: 'Use this runtime candidate.',
    }),
  };
}

async function seedDeliveryPreviewInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const frozen = await seedDeliveryFreezeInput(state);
  return DeliveryPreviewDefinition.parseInput({ plan: frozen.plan, range: null });
}

async function seedDeliveryExportInput(state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>) {
  const frozen = await seedDeliveryFreezeInput(state);
  const manifest = state.fixture.data.delivery.freeze({ plan: frozen.plan }, state.context);
  return DeliveryExportDefinition.parseInput({
    manifest: {
      authority: 'delivery_manifest',
      id: manifest.id,
      revision: manifest.revision,
      contentHash: manifest.contentHash,
    },
    destination: {
      kind: 'user_selected_file',
      grantId: 'destination.runtime.delivery-export',
      grantHash: hashCanonical({ grantId: 'destination.runtime.delivery-export' }),
      displayLabel: 'runtime-final.mp4',
    },
    overwriteExisting: false,
  });
}

async function activeRuntimeFixture(
  capabilityCatalog = ROOT_CATALOG,
  objective = 'Inspect the current Project.',
) {
  const state = await acceptedRuntimeFixture(capabilityCatalog, undefined, objective);
  const { fixture, context, inbox, runId } = state;
  fixture.data.runs.transitionInbox(
    {
      runId,
      expectedRevision: 0,
      inboxMessageId: inbox.id,
      sequence: inbox.sequence,
      action: 'deliver',
      commandId: 'command.i3k1.inbox.deliver',
    },
    context,
  );
  const delivered = fixture.data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: 'request.i3k1.run.delivered',
    method: 'run.get',
    input: { runId },
  }).result;
  fixture.data.runs.startActivation(
    {
      runId,
      expectedRevision: delivered.revision,
      commandId: 'command.i3k1.activation.start',
    },
    context,
  );
  return state;
}

function activateAcceptedRuntimeState(
  state: Awaited<ReturnType<typeof acceptedRuntimeFixture>>,
  suffix: string,
) {
  const { fixture, context, inbox, runId } = state;
  const beforeDelivery = fixture.data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.runtime.${suffix}.before-delivery`,
    method: 'run.get',
    input: { runId },
  }).result;
  fixture.data.runs.transitionInbox(
    {
      runId,
      expectedRevision: beforeDelivery.revision,
      inboxMessageId: inbox.id,
      sequence: inbox.sequence,
      action: 'deliver',
      commandId: `command.runtime.${suffix}.deliver`,
    },
    context,
  );
  const delivered = fixture.data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.runtime.${suffix}.delivered`,
    method: 'run.get',
    input: { runId },
  }).result;
  fixture.data.runs.startActivation(
    {
      runId,
      expectedRevision: delivered.revision,
      commandId: `command.runtime.${suffix}.activate`,
    },
    context,
  );
}

function queueRuntimeFollowup(
  fixture: Awaited<ReturnType<typeof createJourneyFixture>>,
  runId: string,
  suffix: string,
) {
  const run = fixture.data.runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: `request.runtime.followup.${suffix}.run`,
    method: 'run.get',
    input: { runId },
  }).result;
  return fixture.data.runs.sendFollowup(
    {
      wireVersion: 1,
      kind: 'request',
      requestId: `request.runtime.followup.${suffix}`,
      method: 'run.sendFollowup',
      input: {
        runId,
        expectedRevision: run.revision,
        text: `Follow-up ${suffix}`,
        selectedContext: [],
        exportDestinationGrant: null,
      },
    },
    userContext,
    ROOT_ACCEPTANCE_SEED,
  ).result;
}

function recoveryInput(
  snapshot: HarnessActivationSnapshot,
  context: Parameters<HarnessPersistenceAuthority['closeInterruptedActivation']>[1],
  suffix: string,
) {
  if (snapshot.run.publicEventHead === null) throw new Error('Expected a public event head');
  return {
    close: {
      runId: snapshot.run.id,
      activationNumber: snapshot.activation.activationNumber,
      expectedRunRevision: snapshot.run.revision,
      expectedRunContentHash: snapshot.run.contentHash,
      expectedPublicEventHead: snapshot.run.publicEventHead,
      commandId: `command.i3k2c.${suffix}.close`,
    },
    retryCommandId: `command.i3k2c.${suffix}.retry`,
    context,
  };
}

function recoveryDependencies(persistence: HarnessPersistenceAuthority) {
  const calls = { close: 0, retry: 0 };
  const recoveryPersistence = {
    closeInterruptedActivation(input, context) {
      calls.close += 1;
      return persistence.closeInterruptedActivation(input, context);
    },
    acceptCrashRetryRun(input, context) {
      calls.retry += 1;
      return persistence.acceptCrashRetryRun(input, context);
    },
  } satisfies Pick<
    HarnessPersistenceAuthority,
    'closeInterruptedActivation' | 'acceptCrashRetryRun'
  >;
  const dependencies = {
    persistence: recoveryPersistence,
  } satisfies RecoverTargetActivationDependencies;
  return { calls, dependencies };
}

describe('target runtime', () => {
  it('coordinates an accepted Run through its first FIFO Activation', async () => {
    const { fixture, context, inbox, runId } = await acceptedRuntimeFixture();
    const model = new FakeModelAdapter(FINAL_RESPONSE);
    try {
      expect(fixture.data.runs.listActivations(runId)).toEqual([]);

      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('A direct final response must not execute a tool');
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected the first Activation to execute');
      const completed = result.snapshot;

      expect(model.streamed).toHaveLength(1);
      expect(model.streamed[0]!.activationNumber).toBe(1);
      expect(model.streamed[0]!.facts).toMatchObject([
        { type: 'message', role: 'user', messageId: inbox.source.messageId },
      ]);
      expect(completed.activation).toMatchObject({
        activationNumber: 1,
        triggerInboxMessageId: inbox.id,
        triggerInboxSequence: inbox.sequence,
        state: 'ended',
        endReason: 'terminal',
      });
      expect(completed.run.status).toBe('completed');
      expect(fixture.data.runs.listInbox(runId)).toMatchObject([{ state: 'consumed' }]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('atomically persists one interaction.ask and waits without using the generic executor', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const before = fixture.data.harness.loadActivation(runId, 1);
    const input = InteractionAskDefinition.parseInput({
      prompt: 'Which harbor treatment should become the primary direction?',
      options: [
        {
          optionId: 'option.cool',
          label: 'Cool moonlight',
          description: 'Preserve cyan reflections and deep blue shadows.',
        },
        {
          optionId: 'option.warm',
          label: 'Warm dawn',
          description: 'Shift the harbor toward amber sunrise light.',
        },
      ],
      allowFreeText: false,
      contextRefs: [],
      expectedRunRevision: before.run.revision + 1,
    });
    const model = new FakeModelAdapter(
      toolResponse(InteractionAskDefinition.id, input, 'provider-call.interaction-ask.atomic'),
    );
    let executeCount = 0;
    try {
      const waiting = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            executeCount += 1;
            throw new Error('interaction.ask must not reach the generic executor');
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      const rows = getJourneyTestDatabase(fixture.store)
        .prepare(
          `SELECT id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
                  allow_free_text, state, answer_message_id, resolved_at
           FROM run_interactions WHERE run_id = ?`,
        )
        .all(runId) as Array<Record<string, unknown>>;

      expect(executeCount).toBe(0);
      expect(model.streamed).toHaveLength(1);
      expect(model.streamed[0]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: InteractionAskDefinition.id }),
      );
      expect(waiting.run.status).toBe('waiting_question');
      expect(waiting.activation).toMatchObject({ state: 'ended', endReason: 'waiting' });
      expect(waiting.dispatches).toMatchObject([
        {
          key: { toolId: InteractionAskDefinition.id, input },
          guardOutcome: 'allowed',
          outcome: {
            status: 'succeeded',
            data: {
              interactionId: expect.any(String),
              state: 'pending',
              runState: 'waiting_question',
              runRevision: waiting.run.revision,
            },
          },
        },
      ]);
      expect(rows).toEqual([
        {
          id: expect.any(String),
          run_id: runId,
          kind: 'question',
          prompt: input.prompt,
          options_v1_json: JSON.stringify(input.options),
          context_refs_v1_json: JSON.stringify(input.contextRefs),
          allow_free_text: 0,
          state: 'pending',
          answer_message_id: null,
          resolved_at: null,
        },
      ]);

      const interactionId = rows[0]!.id as string;
      const answers = createHostInteractionAuthority(fixture.store, {
        now: () => '2026-08-15T12:00:01.000Z',
      });
      const messageCountBeforeRejectedAnswer = (
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM messages')
          .get() as { readonly count: number }
      ).count;
      expect(() =>
        answers.answer(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.interaction-answer.free-text-denied',
            method: 'interaction.answer',
            input: {
              interactionId,
              answer: { kind: 'free_text', text: 'Use the cool moonlight direction.' },
            },
          },
          userContext,
        ),
      ).toThrow('does not allow free text');
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare(
            'SELECT state, answer_message_id, resolved_at FROM run_interactions WHERE id = ?',
          )
          .get(interactionId),
      ).toEqual({ state: 'pending', answer_message_id: null, resolved_at: null });
      expect(
        (
          getJourneyTestDatabase(fixture.store)
            .prepare('SELECT COUNT(*) AS count FROM messages')
            .get() as { readonly count: number }
        ).count,
      ).toBe(messageCountBeforeRejectedAnswer);
      const answerRequest = {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.interaction-answer.options',
        method: 'interaction.answer',
        input: {
          interactionId,
          answer: { kind: 'options', optionIds: ['option.cool'] },
        },
      } as const;
      const answered = answers.answer(answerRequest, userContext);
      const rowCountBeforeReplay = (
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM messages')
          .get() as { readonly count: number }
      ).count;

      expect(answers.answer(answerRequest, userContext)).toEqual(answered);
      expect(
        (
          getJourneyTestDatabase(fixture.store)
            .prepare('SELECT COUNT(*) AS count FROM messages')
            .get() as { readonly count: number }
        ).count,
      ).toBe(rowCountBeforeReplay);
      expect(answered.result).toMatchObject({ interactionId, state: 'answered' });
      expect(fixture.data.conversations.getMessage(answered.result.messageId).blocks).toEqual([
        {
          type: 'text',
          text: '[option.cool] Cool moonlight — Preserve cyan reflections and deep blue shadows.',
        },
      ]);
      const resumed = fixture.data.harness.loadActivation(runId, 1);
      expect(resumed.run.status).toBe('running');
      expect(resumed.inbox.at(-1)).toMatchObject({
        actor: 'user',
        state: 'queued',
        source: { kind: 'message', messageId: answered.result.messageId },
      });
      expect(
        resumed.journal.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' &&
            payloadState.payload.type === 'interaction_answered' &&
            payloadState.payload.interactionId === interactionId,
        ),
      ).toHaveLength(1);
      const answerInbox = resumed.inbox.at(-1);
      if (answerInbox === undefined) throw new Error('Expected the interaction answer Inbox item');
      const continuationModel = new FakeModelAdapter(FINAL_RESPONSE);
      const continuation = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: continuationModel,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('An interaction answer continuation final must not execute a tool');
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (continuation.kind !== 'executed') {
        throw new Error('Expected the interaction answer Activation to execute');
      }
      expect(continuationModel.streamed).toHaveLength(1);
      expect(continuationModel.streamed[0]!.activationNumber).toBe(2);
      expect(continuationModel.streamed[0]!.facts.at(-1)).toMatchObject({
        type: 'message',
        role: 'user',
        messageId: answered.result.messageId,
      });
      expect(continuation.snapshot).toMatchObject({
        run: { status: 'completed' },
        activation: {
          activationNumber: 2,
          triggerInboxMessageId: answerInbox.id,
          triggerInboxSequence: answerInbox.sequence,
          state: 'ended',
          endReason: 'terminal',
        },
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('replays a committed interaction.ask boundary without duplicating the question', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleInteractionAskBoundary']>[0];
    type BoundaryContext = Parameters<
      HarnessPersistenceAuthority['settleInteractionAskBoundary']
    >[1];
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeSettlementRevision: number | null = null;
    let interrupted = false;
    const persistence = {
      ...fixture.data.harness,
      settleInteractionAskBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeSettlementRevision = (
          getJourneyTestDatabase(fixture.store)
            .prepare('SELECT revision FROM runs WHERE id = ?')
            .get(runId) as { readonly revision: number }
        ).revision;
        const committed = fixture.data.harness.settleInteractionAskBoundary(input, commandContext);
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit after interaction.ask settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          InteractionAskDefinition.id,
          InteractionAskDefinition.parseInput({
            prompt: 'Choose the primary harbor light.',
            options: [
              {
                optionId: 'option.cool',
                label: 'Cool moonlight',
                description: '',
              },
            ],
            allowFreeText: false,
            contextRefs: [],
            expectedRunRevision: request.runRevision,
          }),
          'provider-call.interaction-ask.replay',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after interaction.ask settlement');
      if (capturedInput === null || capturedContext === null || beforeSettlementRevision === null) {
        throw new Error('Expected the interaction.ask settlement boundary to be captured');
      }
      const committed = fixture.data.harness.loadActivation(runId, 1);
      const dispatch = committed.dispatches.find(
        ({ key }) => key.toolId === InteractionAskDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected the committed interaction.ask Dispatch');
      }
      expect(committed.run).toMatchObject({
        status: 'waiting_question',
        revision: beforeSettlementRevision + 1,
      });
      expect(committed.activation).toMatchObject({ state: 'ended', endReason: 'waiting' });
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare("SELECT COUNT(*) AS count FROM run_interactions WHERE state = 'pending'")
          .get(),
      ).toEqual({ count: 1 });

      const call = capturedInput.response.events.find(
        (event) => event.type === 'tool_call' && event.toolId === InteractionAskDefinition.id,
      );
      if (call?.type !== 'tool_call') throw new Error('Expected the captured interaction.ask call');
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: capturedInput.attemptId,
            requestHash: capturedInput.requestHash,
            response: capturedInput.response,
            settledAt: capturedInput.settledAt,
            commandId: 'command.interaction-ask.generic-settle',
          },
          capturedContext,
        ),
      ).toThrow(
        'interaction.ask, operation.cancel, task.manage, and tool.program require dedicated',
      );
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: capturedInput.attemptId,
            providerCallId: call.providerCallId,
            toolId: InteractionAskDefinition.id,
            input: InteractionAskDefinition.parseInput(call.canonicalArguments),
            authorityWatermarkHash: null,
            activationNumber: capturedInput.activationNumber,
            turnNumber: capturedInput.turnNumber,
            stepNumber: capturedInput.stepNumber + 1,
            commandId: 'command.interaction-ask.generic-dispatch',
          },
          capturedContext,
        ),
      ).toThrow('interaction.ask requires its dedicated durable settlement boundary');

      const beforeReplayRows = serializedDatabaseRows(getJourneyTestDatabase(fixture.store));
      const replay = fixture.data.harness.settleInteractionAskBoundary(
        capturedInput,
        capturedContext,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.dispatch.id).toBe(dispatch.id);
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).toBe(beforeReplayRows);
      expect(streamed).toHaveLength(1);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rolls back the complete interaction.ask boundary when the Run journal cannot advance', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleInteractionAskBoundary']>[0];
    type BoundaryContext = Parameters<
      HarnessPersistenceAuthority['settleInteractionAskBoundary']
    >[1];
    const database = getJourneyTestDatabase(fixture.store);
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeBoundaryRows: string | null = null;
    const persistence = {
      ...fixture.data.harness,
      settleInteractionAskBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeBoundaryRows = serializedDatabaseRows(database);
        database.exec(`
          CREATE TEMP TRIGGER fail_interaction_ask_boundary
          BEFORE UPDATE ON runs
          BEGIN
            SELECT RAISE(ABORT, 'injected interaction.ask boundary failure');
          END;
        `);
        try {
          return fixture.data.harness.settleInteractionAskBoundary(input, commandContext);
        } finally {
          database.exec('DROP TRIGGER fail_interaction_ask_boundary');
        }
      },
    } satisfies HarnessPersistenceAuthority;
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        for (const event of toolResponse(
          InteractionAskDefinition.id,
          InteractionAskDefinition.parseInput({
            prompt: 'Choose a harbor direction.',
            options: [],
            allowFreeText: true,
            contextRefs: [],
            expectedRunRevision: request.runRevision,
          }),
          'provider-call.interaction-ask.rollback',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('injected interaction.ask boundary failure');
      if (capturedInput === null || capturedContext === null || beforeBoundaryRows === null) {
        throw new Error('Expected the failed interaction.ask boundary to be captured');
      }
      expect(serializedDatabaseRows(database)).toBe(beforeBoundaryRows);
      expect(fixture.data.harness.loadActivation(runId, 1)).toMatchObject({
        recoveryRequired: true,
        modelAttempts: [{ state: 'running', response: null }],
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM run_interactions').get()).toEqual({
        count: 0,
      });

      const committed = fixture.data.harness.settleInteractionAskBoundary(
        capturedInput,
        capturedContext,
      );
      expect(committed).toMatchObject({
        value: {
          dispatch: {
            key: { toolId: InteractionAskDefinition.id },
            outcome: { status: 'succeeded' },
          },
          result: { state: 'pending', runState: 'waiting_question' },
        },
        run: { status: 'waiting_question' },
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM run_interactions').get()).toEqual({
        count: 1,
      });
      const afterCommitRows = serializedDatabaseRows(database);
      expect(
        fixture.data.harness.settleInteractionAskBoundary(capturedInput, capturedContext).events,
      ).toEqual([]);
      expect(serializedDatabaseRows(database)).toBe(afterCommitRows);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('loads delivery.freeze on demand and atomically freezes an exact Delivery manifest', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, project, runId } = state;
    const input = await seedDeliveryFreezeInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryFreezeDefinition.id] }),
        'provider-call.tool-get.delivery-freeze',
      ),
      [
        toolResponse(DeliveryFreezeDefinition.id, input, 'provider-call.delivery-freeze.atomic'),
        FINAL_RESPONSE,
      ],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected delivery.freeze Run execution');
      const freezeDispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === DeliveryFreezeDefinition.id,
      );
      if (freezeDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled delivery.freeze Dispatch');
      }
      const manifest = DeliveryFreezeDefinition.parseSuccess(freezeDispatch.outcome.data);

      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === DeliveryFreezeDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: DeliveryFreezeDefinition.id }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: DeliveryFreezeDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({ id: manifest.id }),
            }),
          }),
        ]),
      );
      expect(manifest).toMatchObject({
        projectId: project.id,
        sourcePlan: input.plan,
        items: [expect.objectContaining({ shotId: expect.any(String) })],
        createdBy: { kind: 'run', runId },
      });
      expect(fixture.data.delivery.getManifest(manifest.id)).toEqual(manifest);
      expect(result.snapshot.run.status).toBe('completed');
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare(
            `SELECT COUNT(*) AS count FROM project_events
             WHERE project_id = ? AND subject_authority = 'delivery' AND subject_id = ?`,
          )
          .get(project.id, input.plan.id),
      ).toEqual({ count: 3 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('loads delivery.mutate on demand and commits an unprotected create through its dedicated boundary', async () => {
    const { fixture, context, project, runId } = await acceptedRuntimeFixture();
    const input = DeliveryMutateDefinition.parseInput({
      action: 'create',
      project: {
        authority: 'project',
        id: project.id,
        revision: project.revision,
        contentHash: project.contentHash,
      },
      name: 'Runtime-created Delivery',
      formatIntent: DeliveryMutateDefinition.examples.input.formatIntent,
    });
    const deliveryDefinition = ROOT_CATALOG.tools.find(
      ({ id }) => id === DeliveryMutateDefinition.id,
    );
    if (deliveryDefinition === undefined) throw new Error('Missing delivery.mutate fixture tool');
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryMutateDefinition.id] }),
        'provider-call.tool-get.delivery-mutate',
      ),
      [
        toolResponse(
          DeliveryMutateDefinition.id,
          input,
          'provider-call.delivery-mutate.unprotected',
        ),
        FINAL_RESPONSE,
      ],
    );
    const executions: ToolId[] = [];
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ToolGetDefinition.id], (execution) => {
            executions.push(execution.toolId);
            if (execution.toolId !== ToolGetDefinition.id) {
              throw new Error('delivery.mutate must not reach the generic executor');
            }
            return ToolGetDefinition.parseOutcome({
              status: 'succeeded',
              data: {
                definitions: [deliveryDefinition],
                catalogHash: ROOT_CATALOG.catalogHash,
              },
            });
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected delivery.mutate Run execution');
      const dispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === DeliveryMutateDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled delivery.mutate Dispatch');
      }
      const success = DeliveryMutateDefinition.parseSuccess(dispatch.outcome.data);

      expect(executions).toEqual([ToolGetDefinition.id]);
      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === DeliveryMutateDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({
          id: DeliveryMutateDefinition.id,
          version: DeliveryMutateDefinition.version,
        }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            dispatchOperationId: dispatch.id,
            toolId: DeliveryMutateDefinition.id,
            outcome: { status: 'succeeded', data: success },
          }),
        ]),
      );
      expect(dispatch).toMatchObject({
        guardOutcome: 'allowed',
        confirmationId: null,
        projectEventId: expect.any(String),
        key: { toolId: DeliveryMutateDefinition.id, toolVersion: DeliveryMutateDefinition.version },
      });
      expect(result.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('loads production.mutate on demand and commits an unprotected root create through its dedicated boundary', async () => {
    const { fixture, context, project, runId } = await acceptedRuntimeFixture();
    const input = ProductionMutateDefinition.parseInput({
      action: 'create',
      expectedProjectRevision: project.revision,
      parentRef: null,
      order: null,
      value: {
        objectType: 'story',
        content: {
          title: 'Runtime-created Production story',
          premise: 'A runtime tool call creates a root story.',
          synopsis: 'The dedicated protected mutation boundary owns the write.',
        },
      },
    });
    const productionDefinition = ROOT_CATALOG.tools.find(
      ({ id }) => id === ProductionMutateDefinition.id,
    );
    if (productionDefinition === undefined)
      throw new Error('Missing production.mutate fixture tool');
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [ProductionMutateDefinition.id] }),
        'provider-call.tool-get.production-mutate',
      ),
      [
        toolResponse(
          ProductionMutateDefinition.id,
          input,
          'provider-call.production-mutate.unprotected',
        ),
        FINAL_RESPONSE,
      ],
    );
    const executions: ToolId[] = [];
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ToolGetDefinition.id], (execution) => {
            executions.push(execution.toolId);
            if (execution.toolId !== ToolGetDefinition.id) {
              throw new Error('production.mutate must not reach the generic executor');
            }
            return ToolGetDefinition.parseOutcome({
              status: 'succeeded',
              data: {
                definitions: [productionDefinition],
                catalogHash: ROOT_CATALOG.catalogHash,
              },
            });
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected production.mutate Run execution');
      const dispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === ProductionMutateDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled production.mutate Dispatch');
      }
      const success = ProductionMutateDefinition.parseSuccess(dispatch.outcome.data);
      const receipt = success.receipts[0];
      if (receipt === undefined) throw new Error('Expected a Production root-create receipt');

      expect(executions).toEqual([ToolGetDefinition.id]);
      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === ProductionMutateDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({
          id: ProductionMutateDefinition.id,
          version: ProductionMutateDefinition.version,
        }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            dispatchOperationId: dispatch.id,
            toolId: ProductionMutateDefinition.id,
            outcome: { status: 'succeeded', data: success },
          }),
        ]),
      );
      expect(dispatch).toMatchObject({
        guardOutcome: 'allowed',
        confirmationId: null,
        projectEventId: receipt.eventId,
        key: {
          toolId: ProductionMutateDefinition.id,
          toolVersion: ProductionMutateDefinition.version,
        },
      });
      expect(result.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it.each(['approved', 'denied'] as const)(
    'pauses a protected delivery.mutate and projects its exact %s confirmation result to the next Activation',
    async (decision) => {
      const { fixture, context, project, runId } = await acceptedRuntimeFixture();
      const created = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: `request.runtime.delivery-mutate.${decision}.create`,
          method: 'delivery.apply',
          input: {
            action: 'create',
            project: {
              authority: 'project',
              id: project.id,
              revision: project.revision,
              contentHash: project.contentHash,
            },
            name: 'Protected runtime Delivery',
            formatIntent: DeliveryMutateDefinition.examples.input.formatIntent,
          },
        },
        userContext,
      ).result.plan;
      const protectedField = {
        owner: 'delivery' as const,
        deliveryId: created.id,
        itemId: null,
        field: 'name' as const,
      };
      fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: `request.runtime.delivery-mutate.${decision}.protect`,
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: {
              authority: 'delivery',
              id: created.id,
              revision: created.revision,
              contentHash: created.contentHash,
            },
            field: protectedField,
            reason: 'The user chose this Delivery title.',
          },
        },
        userContext,
      );
      const protectedPlan = fixture.data.delivery.query({
        wireVersion: 1,
        kind: 'request',
        requestId: `request.runtime.delivery-mutate.${decision}.query`,
        method: 'delivery.query',
        input: {
          projectId: project.id,
          deliveryPlanIds: [created.id],
          page: { cursor: null, limit: 1 },
        },
      }).result.plans[0]!;
      const input = DeliveryMutateDefinition.parseInput({
        action: 'updateSettings',
        plan: {
          authority: 'delivery',
          id: protectedPlan.id,
          revision: protectedPlan.revision,
          contentHash: protectedPlan.contentHash,
        },
        name: 'Commander-proposed Delivery title',
        formatIntent: protectedPlan.formatIntent,
      });
      const deliveryDefinition = ROOT_CATALOG.tools.find(
        ({ id }) => id === DeliveryMutateDefinition.id,
      );
      if (deliveryDefinition === undefined) throw new Error('Missing delivery.mutate fixture tool');
      const initialModel = new FakeModelAdapter(
        toolResponse(
          ToolGetDefinition.id,
          ToolGetDefinition.parseInput({ names: [DeliveryMutateDefinition.id] }),
          `provider-call.tool-get.delivery-mutate.${decision}`,
        ),
        [
          toolResponse(
            DeliveryMutateDefinition.id,
            input,
            `provider-call.delivery-mutate.protected.${decision}`,
          ),
        ],
      );
      const executions: ToolId[] = [];
      try {
        const paused = await coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model: initialModel,
            toolExecutor: fakeToolExecutor([ToolGetDefinition.id], (execution) => {
              executions.push(execution.toolId);
              if (execution.toolId !== ToolGetDefinition.id) {
                throw new Error('delivery.mutate must not reach the generic executor');
              }
              return ToolGetDefinition.parseOutcome({
                status: 'succeeded',
                data: {
                  definitions: [deliveryDefinition],
                  catalogHash: ROOT_CATALOG.catalogHash,
                },
              });
            }),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        );
        if (paused.kind !== 'executed') throw new Error('Expected protected delivery.mutate Run');
        const dispatch = paused.snapshot.dispatches.find(
          ({ key }) => key.toolId === DeliveryMutateDefinition.id,
        );
        if (dispatch === undefined || dispatch.confirmationId === null) {
          throw new Error('Expected a pending protected delivery.mutate Dispatch');
        }

        expect(executions).toEqual([ToolGetDefinition.id]);
        expect(initialModel.streamed).toHaveLength(2);
        expect(paused.snapshot.run.status).toBe('waiting_confirmation');
        expect(paused.snapshot.dispatches).toContainEqual(
          expect.objectContaining({
            id: dispatch.id,
            key: expect.objectContaining({ toolId: DeliveryMutateDefinition.id, input }),
            guardOutcome: 'confirmation_required',
            confirmationId: dispatch.confirmationId,
            outcome: null,
          }),
        );

        const confirmation = createHostConfirmationAuthority(fixture.store, {
          now: () => NOW,
          createId: fixture.createId,
        }).respond(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: `request.runtime.delivery-mutate.${decision}.confirm`,
            method: 'confirmation.respond',
            input: {
              confirmationId: dispatch.confirmationId,
              immutableInputHash: dispatch.key.inputHash,
              decision,
            },
          },
          userContext,
        );
        const answerInbox = fixture.data.runs
          .listInbox(runId)
          .find(
            ({ source }) =>
              source.kind === 'message' && source.messageId === confirmation.result.messageId,
          );
        if (answerInbox === undefined) throw new Error('Expected a confirmation answer Inbox item');
        const settled = fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.find(({ id }) => id === dispatch.id);
        if (settled === undefined || settled.outcome === null) {
          throw new Error('Expected the confirmed delivery.mutate Dispatch to settle');
        }
        const continuationModel = new FakeModelAdapter(FINAL_RESPONSE);
        const resumed = await coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model: continuationModel,
            toolExecutor: fakeToolExecutor([ToolGetDefinition.id], () => {
              throw new Error('A confirmation continuation final must not execute a tool');
            }),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        );
        if (resumed.kind !== 'executed') {
          throw new Error('Expected the confirmation continuation Activation to execute');
        }

        expect(continuationModel.streamed).toHaveLength(1);
        expect(continuationModel.streamed[0]!.activationNumber).toBe(2);
        expect(continuationModel.streamed[0]!.facts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'tool_result',
              dispatchOperationId: dispatch.id,
              toolId: DeliveryMutateDefinition.id,
              outcome: settled.outcome,
            }),
          ]),
        );
        expect(settled.outcome).toMatchObject(
          decision === 'approved'
            ? { status: 'succeeded' }
            : { status: 'permission_denied', code: 'protected_denied' },
        );
        expect(resumed.snapshot.activation).toMatchObject({
          activationNumber: 2,
          triggerInboxMessageId: answerInbox.id,
          triggerInboxSequence: answerInbox.sequence,
          state: 'ended',
          endReason: 'terminal',
        });
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it('loads decision.record on demand and commits one unprotected result choice atomically', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, runId } = state;
    const { input, result: candidate, shot } = await seedDecisionRecordInput(state);
    const definition = ROOT_CATALOG.tools.find(({ id }) => id === DecisionRecordDefinition.id);
    if (definition === undefined) throw new Error('Missing decision.record fixture tool');
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DecisionRecordDefinition.id] }),
        'provider-call.tool-get.decision-record',
      ),
      [
        toolResponse(
          DecisionRecordDefinition.id,
          input,
          'provider-call.decision-record.unprotected',
        ),
        FINAL_RESPONSE,
      ],
    );
    const executions: ToolId[] = [];
    try {
      const coordinated = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ToolGetDefinition.id], (execution) => {
            executions.push(execution.toolId);
            if (execution.toolId !== ToolGetDefinition.id) {
              throw new Error('decision.record must not reach the generic executor');
            }
            return ToolGetDefinition.parseOutcome({
              status: 'succeeded',
              data: { definitions: [definition], catalogHash: ROOT_CATALOG.catalogHash },
            });
          }),
        },
        { runId, limits: { maxInputTokens: 2_000, maxOutputTokens: 500 }, context },
      );
      if (coordinated.kind !== 'executed') throw new Error('Expected decision.record execution');
      const dispatch = coordinated.snapshot.dispatches.find(
        ({ key }) => key.toolId === DecisionRecordDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled decision.record Dispatch');
      }
      const success = DecisionRecordDefinition.parseSuccess(dispatch.outcome.data);
      expect(executions).toEqual([ToolGetDefinition.id]);
      expect(success).toMatchObject({ action: 'select', currentState: 'selected' });
      expect(model.streamed).toHaveLength(3);
      expect(model.streamed[0]!.materializedTools.some(({ id }) => id === definition.id)).toBe(
        false,
      );
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: definition.id, version: definition.version }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            dispatchOperationId: dispatch.id,
            toolId: DecisionRecordDefinition.id,
            outcome: { status: 'succeeded', data: success },
          }),
        ]),
      );
      expect(fixture.data.production.get(shot.id).object).toMatchObject({
        revision: shot.revision + 1,
        resultDecisions: [
          expect.objectContaining({
            result: candidate.resultRef,
            value: { state: 'selected', feedback: 'Use this runtime candidate.' },
          }),
        ],
      });
      expect(coordinated.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 180_000);

  it.each(['approved', 'denied'] as const)(
    'pauses a protected decision.record and projects its exact %s result to the next Activation',
    async (decision) => {
      const state = await acceptedRuntimeFixture();
      const { fixture } = state;
      const seeded = await seedDecisionRecordInput(state);
      const field = {
        owner: 'production' as const,
        objectId: seeded.shot.id,
        field: 'resultDecision' as const,
        resultId: seeded.result.resultRef.id,
      };
      fixture.data.userChoices.setProtection(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: `request.runtime.decision-record.${decision}.protect`,
          method: 'decision.protect',
          input: {
            mode: 'protect',
            owner: {
              authority: 'production',
              id: seeded.shot.id,
              revision: seeded.shot.revision,
              contentHash: seeded.shot.contentHash,
            },
            field,
            reason: 'Keep this result decision under user control.',
          },
        },
        userContext,
      );
      const protectedShot = fixture.data.production.get(seeded.shot.id).object;
      const input = DecisionRecordDefinition.parseInput({
        action: 'select',
        shot: {
          authority: 'production',
          id: protectedShot.id,
          revision: protectedShot.revision,
          contentHash: protectedShot.contentHash,
        },
        result: seeded.result.resultRef,
        feedback: 'Use this protected runtime candidate.',
      });
      try {
        const confirmed = await confirmProtectedRuntimeMutation(
          state,
          DecisionRecordDefinition.id,
          input,
          decision,
          `decision-record.${decision}`,
        );
        expect(confirmed.confirmation.result.effect).toEqual(
          decision === 'approved'
            ? expect.objectContaining({
                kind: 'decision_recorded',
                dispatchOperationId: confirmed.dispatch.id,
                action: 'select',
                currentState: 'selected',
              })
            : null,
        );
        expect(fixture.data.production.get(seeded.shot.id).object).toMatchObject(
          decision === 'approved'
            ? {
                revision: protectedShot.revision + 1,
                resultDecisions: [
                  expect.objectContaining({
                    result: seeded.result.resultRef,
                    value: {
                      state: 'selected',
                      feedback: 'Use this protected runtime candidate.',
                    },
                  }),
                ],
              }
            : { revision: protectedShot.revision, resultDecisions: [] },
        );
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it.each(['approved', 'denied'] as const)(
    'always confirms exact decision.protect with no active Choice heads and projects %s',
    async (decision) => {
      const state = await acceptedRuntimeFixture();
      const { fixture, project } = state;
      const created = fixture.data.delivery.apply(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: `request.runtime.decision-protect.${decision}.create`,
          method: 'delivery.apply',
          input: {
            action: 'create',
            project: {
              authority: 'project',
              id: project.id,
              revision: project.revision,
              contentHash: project.contentHash,
            },
            name: 'Decision protection runtime plan',
            formatIntent: DeliveryMutateDefinition.examples.input.formatIntent,
          },
        },
        userContext,
      ).result.plan;
      const input = DecisionProtectDefinition.parseInput({
        mode: 'protect',
        owner: {
          authority: 'delivery',
          id: created.id,
          revision: created.revision,
          contentHash: created.contentHash,
        },
        field: {
          owner: 'delivery',
          deliveryId: created.id,
          itemId: null,
          field: 'name',
        },
        reason: 'Protect the chosen Delivery name.',
      });
      const database = getJourneyTestDatabase(fixture.store);
      const choicesBefore = database
        .prepare('SELECT COUNT(*) AS count FROM user_choices')
        .get() as {
        count: number;
      };
      try {
        const confirmed = await confirmProtectedRuntimeMutation(
          state,
          DecisionProtectDefinition.id,
          input,
          decision,
          `decision-protect.${decision}`,
        );
        const targetRow = database
          .prepare('SELECT target_v1_json FROM run_confirmations WHERE id = ?')
          .get(confirmed.dispatch.confirmationId!) as { target_v1_json: string };
        expect(JSON.parse(targetRow.target_v1_json)).toMatchObject({
          kind: 'protected_mutation',
          activeChoiceIds: [],
        });
        expect(confirmed.confirmation.result.effect).toEqual(
          decision === 'approved'
            ? expect.objectContaining({
                kind: 'decision_protection_changed',
                dispatchOperationId: confirmed.dispatch.id,
                active: true,
              })
            : null,
        );
        const choicesAfter = database
          .prepare('SELECT COUNT(*) AS count FROM user_choices')
          .get() as {
          count: number;
        };
        expect(choicesAfter.count).toBe(choicesBefore.count + (decision === 'approved' ? 1 : 0));
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it('rejects delivery.freeze for another Project before creating a Manifest', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, runId } = state;
    const other = fixture.data.projects.create(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.delivery-freeze.other-project',
        method: 'project.create',
        input: {
          name: 'Other runtime Project',
          permissionMode: 'reversible',
          budget,
          formatPolicy,
        },
      },
      userContext,
    ).result.project;
    const otherPlan = fixture.data.delivery.apply(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.delivery-freeze.other-plan',
        method: 'delivery.apply',
        input: {
          action: 'create',
          project: {
            authority: 'project',
            id: other.id,
            revision: other.revision,
            contentHash: other.contentHash,
          },
          name: 'Other runtime Delivery',
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
      userContext,
    ).result.plan;
    const input = DeliveryFreezeDefinition.parseInput({
      plan: {
        authority: 'delivery',
        id: otherPlan.id,
        revision: otherPlan.revision,
        contentHash: otherPlan.contentHash,
      },
    });
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryFreezeDefinition.id] }),
        'provider-call.tool-get.delivery-freeze.cross-project',
      ),
      [
        toolResponse(
          DeliveryFreezeDefinition.id,
          input,
          'provider-call.delivery-freeze.cross-project',
        ),
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(`delivery:${otherPlan.id} belongs to another Project`);
      expect(model.streamed).toHaveLength(2);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM delivery_manifests')
          .get(),
      ).toEqual({ count: 0 });
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === DeliveryFreezeDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects a frozen delivery.freeze definition with altered recovery metadata', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter();
    const persistence = {
      ...fixture.data.harness,
      loadActivation(targetRunId, activationNumber) {
        const snapshot = fixture.data.harness.loadActivation(targetRunId, activationNumber);
        return {
          ...snapshot,
          catalog: {
            ...snapshot.catalog,
            tools: snapshot.catalog.tools.map((tool) =>
              tool.id === DeliveryFreezeDefinition.id
                ? {
                    ...tool,
                    metadata: {
                      ...tool.metadata,
                      recovery: {
                        ...tool.metadata.recovery,
                        unknownStateNeverResubmit: true,
                      },
                    },
                  }
                : tool,
            ),
          },
        };
      },
    } satisfies HarnessPersistenceAuthority;
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Frozen delivery.freeze definition is unavailable or invalid');
      expect(model.streamed).toHaveLength(0);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === DeliveryFreezeDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('replays a committed delivery.freeze boundary without freezing or journaling twice', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, runId } = state;
    const freezeInput = await seedDeliveryFreezeInput(state);
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleDeliveryFreezeBoundary']>[0];
    type BoundaryContext = Parameters<
      HarnessPersistenceAuthority['settleDeliveryFreezeBoundary']
    >[1];
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeSettlementRevision: number | null = null;
    let interrupted = false;
    const persistence = {
      ...fixture.data.harness,
      settleDeliveryFreezeBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeSettlementRevision = fixture.data.harness.loadActivation(runId, 1).run.revision;
        const committed = fixture.data.harness.settleDeliveryFreezeBoundary(input, commandContext);
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit after delivery.freeze settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryFreezeDefinition.id] }),
        'provider-call.tool-get.delivery-freeze.replay',
      ),
      [
        toolResponse(
          DeliveryFreezeDefinition.id,
          freezeInput,
          'provider-call.delivery-freeze.replay',
        ),
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after delivery.freeze settlement');
      if (capturedInput === null || capturedContext === null || beforeSettlementRevision === null) {
        throw new Error('Expected the delivery.freeze settlement boundary to be captured');
      }
      const committed = fixture.data.harness.loadActivation(runId, 1);
      const dispatch = committed.dispatches.find(
        ({ key }) => key.toolId === DeliveryFreezeDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected the committed delivery.freeze Dispatch');
      }
      const manifest = DeliveryFreezeDefinition.parseSuccess(dispatch.outcome.data);
      expect(committed.run.revision).toBe(beforeSettlementRevision + 1);
      expect(fixture.data.delivery.getManifest(manifest.id)).toEqual(manifest);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare(
            `SELECT COUNT(*) AS count FROM delivery_manifests
             WHERE delivery_plan_id = ? AND delivery_revision = ?`,
          )
          .get(freezeInput.plan.id, freezeInput.plan.revision),
      ).toEqual({ count: 1 });

      const call = capturedInput.response.events.find(
        (event) => event.type === 'tool_call' && event.toolId === DeliveryFreezeDefinition.id,
      );
      if (call?.type !== 'tool_call') {
        throw new Error('Expected the captured delivery.freeze call');
      }
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: capturedInput.attemptId,
            requestHash: capturedInput.requestHash,
            response: capturedInput.response,
            settledAt: capturedInput.settledAt,
            commandId: 'command.delivery-freeze.generic-settle',
          },
          capturedContext,
        ),
      ).toThrow('delivery.freeze');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: capturedInput.attemptId,
            providerCallId: call.providerCallId,
            toolId: DeliveryFreezeDefinition.id,
            input: DeliveryFreezeDefinition.parseInput(call.canonicalArguments),
            authorityWatermarkHash: null,
            activationNumber: capturedInput.activationNumber,
            turnNumber: capturedInput.turnNumber,
            stepNumber: capturedInput.stepNumber + 1,
            commandId: 'command.delivery-freeze.generic-dispatch',
          },
          capturedContext,
        ),
      ).toThrow('delivery.freeze requires its dedicated durable settlement boundary');

      const beforeReplayRows = serializedDatabaseRows(getJourneyTestDatabase(fixture.store));
      const replay = fixture.data.harness.settleDeliveryFreezeBoundary(
        capturedInput,
        capturedContext,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.result).toEqual(manifest);
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).toBe(beforeReplayRows);
      expect(model.streamed).toHaveLength(2);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('rolls back the complete delivery.freeze boundary when the Run journal cannot advance', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, runId } = state;
    const freezeInput = await seedDeliveryFreezeInput(state);
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleDeliveryFreezeBoundary']>[0];
    type BoundaryContext = Parameters<
      HarnessPersistenceAuthority['settleDeliveryFreezeBoundary']
    >[1];
    const database = getJourneyTestDatabase(fixture.store);
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeBoundaryRows: string | null = null;
    const persistence = {
      ...fixture.data.harness,
      settleDeliveryFreezeBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeBoundaryRows = serializedDatabaseRows(database);
        database.exec(`
          CREATE TEMP TRIGGER fail_delivery_freeze_boundary
          BEFORE UPDATE ON runs
          BEGIN
            SELECT RAISE(ABORT, 'injected delivery.freeze boundary failure');
          END;
        `);
        try {
          return fixture.data.harness.settleDeliveryFreezeBoundary(input, commandContext);
        } finally {
          database.exec('DROP TRIGGER fail_delivery_freeze_boundary');
        }
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryFreezeDefinition.id] }),
        'provider-call.tool-get.delivery-freeze.rollback',
      ),
      [
        toolResponse(
          DeliveryFreezeDefinition.id,
          freezeInput,
          'provider-call.delivery-freeze.rollback',
        ),
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('injected delivery.freeze boundary failure');
      if (capturedInput === null || capturedContext === null || beforeBoundaryRows === null) {
        throw new Error('Expected the failed delivery.freeze boundary to be captured');
      }
      expect(serializedDatabaseRows(database)).toBe(beforeBoundaryRows);
      const failed = fixture.data.harness.loadActivation(runId, 1);
      expect(failed.recoveryRequired).toBe(true);
      expect(failed.modelAttempts.at(-1)).toMatchObject({ state: 'running', response: null });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM delivery_manifests
             WHERE delivery_plan_id = ? AND delivery_revision = ?`,
          )
          .get(freezeInput.plan.id, freezeInput.plan.revision),
      ).toEqual({ count: 0 });

      const committed = fixture.data.harness.settleDeliveryFreezeBoundary(
        capturedInput,
        capturedContext,
      );
      expect(committed).toMatchObject({
        value: {
          dispatch: {
            key: { toolId: DeliveryFreezeDefinition.id },
            outcome: { status: 'succeeded' },
          },
          result: { projectId: state.project.id, sourcePlan: freezeInput.plan },
        },
        run: { status: 'running' },
      });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM delivery_manifests
             WHERE delivery_plan_id = ? AND delivery_revision = ?`,
          )
          .get(freezeInput.plan.id, freezeInput.plan.revision),
      ).toEqual({ count: 1 });
      const afterCommitRows = serializedDatabaseRows(database);
      expect(
        fixture.data.harness.settleDeliveryFreezeBoundary(capturedInput, capturedContext).events,
      ).toEqual([]);
      expect(serializedDatabaseRows(database)).toBe(afterCommitRows);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('loads evaluation.run on demand and settles all five variants through owner-backed dispatches', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const inputs = await seedEvaluationRunInputs(state);
    const kinds = [
      'technical_integrity',
      'reference_similarity',
      'continuity',
      'coverage',
      'delivery_readiness',
    ] as const;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [EvaluationRunDefinition.id] }),
        'provider-call.tool-get.evaluation-run',
      ),
      [
        ...kinds.map((kind) =>
          toolResponse(
            EvaluationRunDefinition.id,
            inputs[kind],
            `provider-call.evaluation-run.${kind}`,
          ),
        ),
        FINAL_RESPONSE,
      ],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          resultAssessments: fixture.data.resultAssessments,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected evaluation.run Run execution');
      const matching = result.snapshot.dispatches.filter(
        ({ key }) => key.toolId === EvaluationRunDefinition.id,
      );
      expect(matching).toHaveLength(kinds.length);
      expect(model.streamed).toHaveLength(kinds.length + 2);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === EvaluationRunDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: EvaluationRunDefinition.id }),
      );
      for (const kind of kinds) {
        const dispatch = matching.find(
          ({ key }) => EvaluationRunDefinition.parseInput(key.input).kind === kind,
        );
        if (dispatch?.outcome?.status !== 'succeeded') {
          throw new Error(`Expected a settled ${kind} evaluation.run Dispatch`);
        }
        const evaluation = EvaluationRunDefinition.parseSuccess(dispatch.outcome.data);
        expect(evaluation).toMatchObject({
          state: 'succeeded',
          assessmentId: dispatch.ownerId,
          assessment: { kind },
          operation: {
            id: dispatch.id,
            kind: 'result_assessment',
            ownerRef: {
              authority: 'result_assessment_attempt',
              id: dispatch.ownerId,
            },
          },
        });
      }
      expect(dependencies.assessment.quoteCalls).toBe(3);
      expect(dependencies.assessment.submitCalls).toBe(3);
      expect(dependencies.assessment.reconcileCalls).toBe(3);
      const database = getJourneyTestDatabase(fixture.store);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM result_assessment_attempts').get(),
      ).toEqual({ count: kinds.length });
      expect(database.prepare('SELECT COUNT(*) AS count FROM result_assessments').get()).toEqual({
        count: kinds.length,
      });
      const settledRows = serializedDatabaseRows(database);
      const firstDispatch = matching[0]!;
      if (firstDispatch.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled evaluation.run Dispatch for tamper validation');
      }
      const firstEvaluation = EvaluationRunDefinition.parseSuccess(firstDispatch.outcome.data);
      if (firstEvaluation.assessment === null) {
        throw new Error('Expected a final Assessment for tamper validation');
      }
      expect(() =>
        fixture.data.harness.settleEvaluationRunBoundary(
          {
            dispatchOperationId: firstDispatch.id,
            activationNumber: 1,
            result: {
              ...firstEvaluation,
              assessment: {
                ...firstEvaluation.assessment,
                limitations: [...firstEvaluation.assessment.limitations, 'tampered'],
              },
            },
            completedAt: NOW,
            commandId: 'command.evaluation-run.tampered-replay',
          },
          context,
        ),
      ).toThrow('result changed its owner');
      expect(serializedDatabaseRows(database)).toBe(settledRows);
      for (const dispatch of matching) {
        if (dispatch.outcome?.status !== 'succeeded') {
          throw new Error(`Expected settled evaluation.run Dispatch ${dispatch.id}`);
        }
        const evaluation = EvaluationRunDefinition.parseSuccess(dispatch.outcome.data);
        const replay = fixture.data.harness.settleEvaluationRunBoundary(
          {
            dispatchOperationId: dispatch.id,
            activationNumber: 1,
            result: evaluation,
            completedAt: NOW,
            commandId: `command.evaluation-run.replay.${evaluation.assessmentId}`,
          },
          context,
        );
        expect(replay.events).toEqual([]);
        expect(replay.value.result).toEqual(evaluation);
      }
      expect(serializedDatabaseRows(database)).toBe(settledRows);
      expect(result.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 360_000);

  it('recovers evaluation.run from an unknown Provider owner without duplicating its dispatch', async () => {
    const provider = new RecoverableAssessmentProvider();
    const dependencies = { ...createJourneyDependencies(), assessment: provider };
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = (await seedEvaluationRunInputs(state)).reference_similarity;
    let interrupted = false;
    const interruptedAuthority: Pick<
      typeof fixture.data.resultAssessments,
      'start' | 'executeLocal' | 'submitProvider' | 'reconcileProvider'
    > = {
      start(request, commandContext, signal) {
        return fixture.data.resultAssessments.start(request, commandContext, signal);
      },
      executeLocal(request, commandContext) {
        return fixture.data.resultAssessments.executeLocal(request, commandContext);
      },
      async submitProvider(request, commandContext, signal) {
        const result = await fixture.data.resultAssessments.submitProvider(
          request,
          commandContext,
          signal,
        );
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit after assessment owner became unknown');
        }
        return result;
      },
      reconcileProvider(request, commandContext, signal) {
        return fixture.data.resultAssessments.reconcileProvider(request, commandContext, signal);
      },
    };
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [EvaluationRunDefinition.id] }),
        'provider-call.tool-get.evaluation-run.recovery',
      ),
      [
        toolResponse(EvaluationRunDefinition.id, input, 'provider-call.evaluation-run.recovery'),
        FINAL_RESPONSE,
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Materialized evaluation.run requires ResultAssessmentsAuthority');
      expect(model.streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === EvaluationRunDefinition.id),
      ).toBe(false);
      await expect(
        runTargetActivation(
          {
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            resultAssessments: interruptedAuthority,
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after assessment owner became unknown');
      const database = getJourneyTestDatabase(fixture.store);
      const openSnapshot = fixture.data.harness.loadActivation(runId, 1);
      const open = openSnapshot.dispatches.find(
        ({ key }) => key.toolId === EvaluationRunDefinition.id,
      );
      expect(open).toMatchObject({
        operationKind: 'result_assessment',
        ownerAuthority: 'result_assessment_attempt',
        outcome: null,
      });
      expect(database.prepare('SELECT state FROM result_assessment_attempts').get()).toEqual({
        state: 'unknown',
      });
      expect(provider.quoteCalls).toBe(1);
      expect(provider.submitCalls).toBe(1);
      expect(provider.reconcileCalls).toBe(1);
      const modelAttempt = openSnapshot.modelAttempts.find(
        ({ id }) => id === open?.originModelAttemptId,
      );
      const boundary =
        open === undefined ? null : fixture.data.harness.loadEvaluationRunBoundary(open.id);
      if (
        open === undefined ||
        modelAttempt === undefined ||
        modelAttempt.response === null ||
        modelAttempt.finishedAt === null ||
        open.originProviderCallId === null ||
        boundary?.result === null ||
        boundary === null
      ) {
        throw new Error('Expected the committed evaluation.run model boundary');
      }
      const beforeGenericAttempts = serializedDatabaseRows(database);
      const startReplay = fixture.data.harness.settleEvaluationRunStartBoundary(
        {
          attemptId: modelAttempt.id,
          requestHash: modelAttempt.requestHash,
          response: modelAttempt.response,
          providerCallId: open.originProviderCallId,
          activationNumber: 1,
          turnNumber: 2,
          stepNumber: 2,
          settledAt: modelAttempt.finishedAt,
        },
        context,
      );
      expect(startReplay.events).toEqual([]);
      expect(startReplay.value).toMatchObject({
        dispatch: { id: open.id },
        result: boundary.result,
      });
      expect(serializedDatabaseRows(database)).toBe(beforeGenericAttempts);
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: modelAttempt.id,
            requestHash: modelAttempt.requestHash,
            response: modelAttempt.response,
            settledAt: NOW,
            commandId: 'command.evaluation-run.generic-model-settle',
          },
          context,
        ),
      ).toThrow('evaluation.run');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: modelAttempt.id,
            providerCallId: open.originProviderCallId,
            toolId: EvaluationRunDefinition.id,
            input,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            commandId: 'command.evaluation-run.generic-prepare',
          },
          context,
        ),
      ).toThrow('evaluation.run requires its dedicated durable settlement boundary');
      expect(() =>
        fixture.data.harness.settleDispatch(
          {
            dispatchOperationId: open.id,
            modelAttemptId: modelAttempt.id,
            providerCallId: open.originProviderCallId,
            outcome: EvaluationRunDefinition.parseOutcome({
              status: 'succeeded',
              data: boundary.result,
            }),
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            completedAt: NOW,
            commandId: 'command.evaluation-run.generic-settle',
          },
          context,
        ),
      ).toThrow('evaluation.run requires its dedicated durable settlement boundary');
      expect(serializedDatabaseRows(database)).toBe(beforeGenericAttempts);

      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          resultAssessments: fixture.data.resultAssessments,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (resumed.kind !== 'executed') throw new Error('Expected evaluation.run recovery');
      const matching = resumed.snapshot.dispatches.filter(
        ({ key }) => key.toolId === EvaluationRunDefinition.id,
      );
      expect(matching).toHaveLength(1);
      expect(matching[0]).toMatchObject({
        id: open?.id,
        outcome: { status: 'succeeded', data: { state: 'succeeded' } },
      });
      expect(provider.quoteCalls).toBe(1);
      expect(provider.submitCalls).toBe(2);
      expect(provider.reconcileCalls).toBe(2);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM result_assessment_attempts').get(),
      ).toEqual({ count: 1 });
      expect(database.prepare('SELECT COUNT(*) AS count FROM result_assessments').get()).toEqual({
        count: 1,
      });
      expect(resumed.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 180_000);

  it('loads generation.submit on demand and settles one owner-backed Fake Provider submission', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedGenerationSubmitInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [GenerationSubmitDefinition.id] }),
        'provider-call.tool-get.generation-submit',
      ),
      [
        toolResponse(GenerationSubmitDefinition.id, input, 'provider-call.generation-submit.fake'),
        FINAL_RESPONSE,
      ],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          generation: fixture.data.generation,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected generation.submit Run execution');
      const dispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === GenerationSubmitDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled generation.submit Dispatch');
      }
      const submission = GenerationSubmitDefinition.parseSuccess(dispatch.outcome.data);

      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === GenerationSubmitDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: GenerationSubmitDefinition.id }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: GenerationSubmitDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({ attemptId: submission.attemptId }),
            }),
          }),
        ]),
      );
      expect(submission).toMatchObject({
        state: 'succeeded',
        operation: {
          id: dispatch.id,
          kind: 'generation_attempt',
          ownerRef: { authority: 'generation_attempt', id: submission.attemptId },
        },
      });
      expect(submission.immediateResults).toHaveLength(2);
      expect(dependencies.generation.submitCalls).toBe(1);
      expect(dependencies.generation.reconcileCalls).toBe(0);
      const database = getJourneyTestDatabase(fixture.store);
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_requests').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_attempts').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM generated_results').get()).toEqual({
        count: 2,
      });
      const settledRows = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleGenerationSubmitBoundary(
          {
            dispatchOperationId: dispatch.id,
            activationNumber: 1,
            result: { ...submission, requestHash: 'f'.repeat(64) },
            completedAt: NOW,
            commandId: 'command.generation-submit.tampered-replay',
          },
          context,
        ),
      ).toThrow('result changed its owner');
      expect(serializedDatabaseRows(database)).toBe(settledRows);
      const replay = fixture.data.harness.settleGenerationSubmitBoundary(
        {
          dispatchOperationId: dispatch.id,
          activationNumber: 1,
          result: submission,
          completedAt: NOW,
          commandId: 'command.generation-submit.exact-replay',
        },
        context,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.result).toEqual(submission);
      expect(serializedDatabaseRows(database)).toBe(settledRows);
      expect(dependencies.generation.submitCalls).toBe(1);
      expect(result.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('recovers generation.submit before Provider submission and reconciles an unknown exact owner', async () => {
    const provider = new RecoverableGenerationProvider();
    const dependencies = { ...createJourneyDependencies(), generation: provider };
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedGenerationSubmitInput(state);
    let interruptedBeforeSubmission = false;
    const preSubmissionExit: Pick<typeof fixture.data.generation, 'submit' | 'reconcile'> = {
      async submit(request, commandContext, signal) {
        if (!interruptedBeforeSubmission) {
          interruptedBeforeSubmission = true;
          throw new Error('simulated process exit before generation Provider submission');
        }
        return fixture.data.generation.submit(request, commandContext, signal);
      },
      reconcile(request, commandContext, signal) {
        return fixture.data.generation.reconcile(request, commandContext, signal);
      },
    };
    let interruptedAfterUnknownOwner = false;
    const unknownOwnerExit: Pick<typeof fixture.data.generation, 'submit' | 'reconcile'> = {
      async submit(request, commandContext, signal) {
        const result = await fixture.data.generation.submit(request, commandContext, signal);
        if (!interruptedAfterUnknownOwner) {
          interruptedAfterUnknownOwner = true;
          throw new Error('simulated process exit after generation owner became unknown');
        }
        return result;
      },
      reconcile(request, commandContext, signal) {
        return fixture.data.generation.reconcile(request, commandContext, signal);
      },
    };
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [GenerationSubmitDefinition.id] }),
        'provider-call.tool-get.generation-recovery',
      ),
      [
        toolResponse(
          GenerationSubmitDefinition.id,
          input,
          'provider-call.generation-submit.recovery',
        ),
        FINAL_RESPONSE,
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            generation: preSubmissionExit,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit before generation Provider submission');

      const database = getJourneyTestDatabase(fixture.store);
      const unboundSnapshot = fixture.data.harness.loadActivation(runId, 1);
      const unbound = unboundSnapshot.dispatches.find(
        ({ key }) => key.toolId === GenerationSubmitDefinition.id,
      );
      expect(unbound).toMatchObject({
        operationKind: null,
        ownerAuthority: null,
        ownerId: null,
        outcome: null,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_attempts').get()).toEqual({
        count: 0,
      });
      expect(provider.submitCalls).toBe(0);
      expect(provider.reconcileCalls).toBe(0);
      const modelAttempt = unboundSnapshot.modelAttempts.find(
        ({ id }) => id === unbound?.originModelAttemptId,
      );
      if (
        unbound === undefined ||
        modelAttempt === undefined ||
        modelAttempt.response === null ||
        unbound.originProviderCallId === null
      ) {
        throw new Error('Expected the committed generation.submit model boundary');
      }
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: modelAttempt.id,
            requestHash: modelAttempt.requestHash,
            response: modelAttempt.response,
            settledAt: NOW,
            commandId: 'command.generation-submit.generic-model-settle',
          },
          context,
        ),
      ).toThrow('generation.submit');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: modelAttempt.id,
            providerCallId: unbound.originProviderCallId!,
            toolId: GenerationSubmitDefinition.id,
            input,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            commandId: 'command.generation-submit.generic-prepare',
          },
          context,
        ),
      ).toThrow('generation.submit requires its dedicated durable settlement boundary');
      expect(() =>
        fixture.data.harness.settleDispatch(
          {
            dispatchOperationId: unbound.id,
            modelAttemptId: modelAttempt.id,
            providerCallId: unbound.originProviderCallId!,
            outcome: GenerationSubmitDefinition.parseOutcome({
              status: 'succeeded',
              data: GenerationSubmitDefinition.examples.success,
            }),
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            completedAt: NOW,
            commandId: 'command.generation-submit.generic-settle',
          },
          context,
        ),
      ).toThrow('generation.submit requires its dedicated durable settlement boundary');

      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            generation: unknownOwnerExit,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after generation owner became unknown');

      const open = fixture.data.harness
        .loadActivation(runId, 1)
        .dispatches.find(({ id }) => id === unbound?.id);
      expect(open).toMatchObject({
        operationKind: 'generation_attempt',
        ownerAuthority: 'generation_attempt',
        outcome: null,
      });
      expect(database.prepare('SELECT state FROM generation_attempts').get()).toEqual({
        state: 'unknown',
      });
      expect(provider.submitCalls).toBe(1);
      expect(provider.reconcileCalls).toBe(0);

      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          generation: fixture.data.generation,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (resumed.kind !== 'executed') throw new Error('Expected generation.submit recovery');
      const settled = resumed.snapshot.dispatches.find(({ id }) => id === open?.id);
      expect(settled?.outcome).toMatchObject({
        status: 'succeeded',
        data: { state: 'succeeded' },
      });
      expect(provider.reconcileCalls).toBe(1);
      expect(provider.submitCalls).toBe(2);
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_requests').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_attempts').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM generated_results').get()).toEqual({
        count: 2,
      });
      expect(resumed.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 180_000);

  it('rejects cross-Project generation.submit before creating a dispatch or Provider owner', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, project, runId } = state;
    const currentInput = await seedGenerationSubmitInput(state);
    const other = fixture.data.projects.create(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.generation-submit.other-project',
        method: 'project.create',
        input: {
          name: 'Other generation Project',
          permissionMode: 'reversible',
          budget,
          formatPolicy,
        },
      },
      userContext,
    ).result.project;
    const otherTarget = fixture.data.production.apply(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.generation-submit.other-target',
        method: 'production.apply',
        input: {
          action: 'create',
          projectId: other.id,
          expectedProjectRevision: other.revision,
          value: {
            objectType: 'shot',
            content: {
              title: 'Other Project generation target',
              description: 'A cross-Project target that the active Run must reject.',
              durationMs: 8_000,
              shotSize: null,
              cameraMovement: null,
            },
          },
          relations: [],
        },
      },
      userContext,
    ).result.object;
    const target = {
      authority: 'production' as const,
      id: otherTarget.id,
      revision: otherTarget.revision,
      contentHash: otherTarget.contentHash,
    };
    const spec = { ...currentInput.spec, target };
    const input = GenerationSubmitDefinition.parseInput({
      ...currentInput,
      spec,
      quote: null,
      expectedProjectRevision: project.revision,
      promptProvenance: {
        sourceObjectId: target.id,
        sourceRevision: target.revision,
        sourceHash: target.contentHash,
        assemblyHash: hashCanonical(
          generationPromptAssemblyHashInput({
            target,
            prompt: spec.prompt,
            negativePrompt: spec.negativePrompt,
            references: spec.references,
            loadedSkillDigests: [],
          }),
        ),
        loadedSkillDigests: [],
      },
    });
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [GenerationSubmitDefinition.id] }),
        'provider-call.tool-get.generation-cross-project',
      ),
      [
        toolResponse(
          GenerationSubmitDefinition.id,
          input,
          'provider-call.generation-submit.cross-project',
        ),
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            generation: fixture.data.generation,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Generation target ${otherTarget.id} does not match its current Project snapshot`,
      );
      expect(model.streamed).toHaveLength(2);
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      expect(
        snapshot.dispatches.some(({ key }) => key.toolId === GenerationSubmitDefinition.id),
      ).toBe(false);
      const database = getJourneyTestDatabase(fixture.store);
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_requests').get()).toEqual({
        count: 0,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_attempts').get()).toEqual({
        count: 0,
      });
      expect(dependencies.generation.submitCalls).toBe(0);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects a frozen generation.submit definition with altered recovery metadata', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter();
    const persistence = {
      ...fixture.data.harness,
      loadActivation(targetRunId, activationNumber) {
        const snapshot = fixture.data.harness.loadActivation(targetRunId, activationNumber);
        return {
          ...snapshot,
          catalog: {
            ...snapshot.catalog,
            tools: snapshot.catalog.tools.map((tool) =>
              tool.id === GenerationSubmitDefinition.id
                ? {
                    ...tool,
                    metadata: {
                      ...tool.metadata,
                      recovery: {
                        ...tool.metadata.recovery,
                        unknownStateNeverResubmit: false,
                      },
                    },
                  }
                : tool,
            ),
          },
        };
      },
    } satisfies HarnessPersistenceAuthority;
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Frozen generation.submit definition is unavailable or invalid');
      expect(model.streamed).toHaveLength(0);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === GenerationSubmitDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('loads media.derive on demand and settles one owner-backed local derivative', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedMediaDeriveInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaDeriveDefinition.id] }),
        'provider-call.tool-get.media-derive',
      ),
      [
        toolResponse(MediaDeriveDefinition.id, input, 'provider-call.media-derive.local'),
        FINAL_RESPONSE,
      ],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          mediaDerivations: fixture.data.mediaDerivations,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected media.derive Run execution');
      const dispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === MediaDeriveDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled media.derive Dispatch');
      }
      const derivation = MediaDeriveDefinition.parseSuccess(dispatch.outcome.data);

      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === MediaDeriveDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: MediaDeriveDefinition.id }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: MediaDeriveDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({ attemptId: derivation.attemptId }),
            }),
          }),
        ]),
      );
      expect(derivation).toMatchObject({
        operation: {
          id: dispatch.id,
          kind: 'media_derivation',
          ownerRef: { authority: 'media_derivation_attempt', id: derivation.attemptId },
        },
      });
      expect(derivation.globalAssets).toHaveLength(1);
      expect(derivation.projectMediaRefs).toEqual([]);
      expect(dependencies.localDerivation.calls).toHaveLength(1);
      const database = getJourneyTestDatabase(fixture.store);
      expect(database.prepare('SELECT COUNT(*) AS count FROM media_derivations').get()).toEqual({
        count: 1,
      });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM media_derivation_attempts').get(),
      ).toEqual({ count: 1 });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM media_derivation_outputs').get(),
      ).toEqual({ count: 1 });

      const settledRows = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleMediaDeriveBoundary(
          {
            dispatchOperationId: dispatch.id,
            activationNumber: 1,
            result: { ...derivation, requestHash: 'f'.repeat(64) },
            completedAt: NOW,
            commandId: 'command.media-derive.tampered-replay',
          },
          context,
        ),
      ).toThrow('result changed');
      expect(serializedDatabaseRows(database)).toBe(settledRows);
      const replay = fixture.data.harness.settleMediaDeriveBoundary(
        {
          dispatchOperationId: dispatch.id,
          activationNumber: 1,
          result: derivation,
          completedAt: NOW,
          commandId: 'command.media-derive.exact-replay',
        },
        context,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.result).toEqual(derivation);
      expect(serializedDatabaseRows(database)).toBe(settledRows);
      expect(dependencies.localDerivation.calls).toHaveLength(1);
      expect(result.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('cold-recovers media.derive before owner creation and after local owner settlement', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedMediaDeriveInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaDeriveDefinition.id] }),
        'provider-call.tool-get.media-derive.recovery',
      ),
      [
        toolResponse(MediaDeriveDefinition.id, input, 'provider-call.media-derive.recovery'),
        FINAL_RESPONSE,
      ],
    );
    const beforeOwnerExit: Pick<typeof fixture.data.mediaDerivations, 'start' | 'continue'> = {
      async start() {
        throw new Error('simulated process exit before media.derive owner creation');
      },
      continue(request, commandContext, signal) {
        return fixture.data.mediaDerivations.continue(request, commandContext, signal);
      },
    };
    const afterOwnerCreationExit: Pick<typeof fixture.data.mediaDerivations, 'start' | 'continue'> =
      {
        async start(request, commandContext) {
          await fixture.data.mediaDerivations.start(request, commandContext);
          throw new Error('simulated process exit after media.derive owner creation');
        },
        continue(request, commandContext, signal) {
          return fixture.data.mediaDerivations.continue(request, commandContext, signal);
        },
      };
    let interruptedAfterOwnerSettlement = false;
    const afterOwnerSettlementExit: Pick<
      typeof fixture.data.mediaDerivations,
      'start' | 'continue'
    > = {
      start(request, commandContext) {
        return fixture.data.mediaDerivations.start(request, commandContext);
      },
      async continue(request, commandContext, signal) {
        const result = await fixture.data.mediaDerivations.continue(
          request,
          commandContext,
          signal,
        );
        if (!interruptedAfterOwnerSettlement) {
          interruptedAfterOwnerSettlement = true;
          throw new Error('simulated process exit after media.derive owner settlement');
        }
        return result;
      },
    };
    const runtimeInput = {
      runId,
      limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
      context,
    } as const;
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            mediaDerivations: beforeOwnerExit,
          },
          runtimeInput,
        ),
      ).rejects.toThrow('simulated process exit before media.derive owner creation');

      const database = getJourneyTestDatabase(fixture.store);
      const unboundSnapshot = fixture.data.harness.loadActivation(runId, 1);
      const unbound = unboundSnapshot.dispatches.find(
        ({ key }) => key.toolId === MediaDeriveDefinition.id,
      );
      expect(unboundSnapshot.recoveryRequired).toBe(true);
      expect(unbound).toMatchObject({
        operationKind: null,
        ownerAuthority: null,
        ownerId: null,
        outcome: null,
      });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM media_derivation_attempts').get(),
      ).toEqual({ count: 0 });
      expect(dependencies.localDerivation.calls).toHaveLength(0);
      const modelAttempt = unboundSnapshot.modelAttempts.find(
        ({ id }) => id === unbound?.originModelAttemptId,
      );
      if (
        unbound === undefined ||
        modelAttempt === undefined ||
        modelAttempt.response === null ||
        unbound.originProviderCallId === null
      ) {
        throw new Error('Expected the committed media.derive model boundary');
      }
      const beforeGenericAttempts = serializedDatabaseRows(database);
      const startReplay = fixture.data.harness.settleMediaDeriveStartBoundary(
        {
          attemptId: modelAttempt.id,
          requestHash: modelAttempt.requestHash,
          response: modelAttempt.response,
          providerCallId: unbound.originProviderCallId,
          activationNumber: 1,
          turnNumber: 2,
          stepNumber: 1,
          settledAt: NOW,
        },
        context,
      );
      expect(startReplay.events).toEqual([]);
      expect(startReplay.value.dispatch.id).toBe(unbound.id);
      expect(serializedDatabaseRows(database)).toBe(beforeGenericAttempts);
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: modelAttempt.id,
            requestHash: modelAttempt.requestHash,
            response: modelAttempt.response,
            settledAt: NOW,
            commandId: 'command.media-derive.generic-model-settle',
          },
          context,
        ),
      ).toThrow('media.derive');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: modelAttempt.id,
            providerCallId: unbound.originProviderCallId!,
            toolId: MediaDeriveDefinition.id,
            input,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            commandId: 'command.media-derive.generic-prepare',
          },
          context,
        ),
      ).toThrow('media.derive requires its dedicated durable settlement boundary');
      expect(() =>
        fixture.data.harness.settleDispatch(
          {
            dispatchOperationId: unbound.id,
            modelAttemptId: modelAttempt.id,
            providerCallId: unbound.originProviderCallId!,
            outcome: MediaDeriveDefinition.parseOutcome({
              status: 'succeeded',
              data: MediaDeriveDefinition.examples.success,
            }),
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            completedAt: NOW,
            commandId: 'command.media-derive.generic-settle',
          },
          context,
        ),
      ).toThrow('media.derive requires its dedicated durable settlement boundary');
      expect(serializedDatabaseRows(database)).toBe(beforeGenericAttempts);

      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            mediaDerivations: afterOwnerCreationExit,
          },
          runtimeInput,
        ),
      ).rejects.toThrow('simulated process exit after media.derive owner creation');

      const runningSnapshot = fixture.data.harness.loadActivation(runId, 1);
      const runningOwner = runningSnapshot.dispatches.find(({ id }) => id === unbound.id);
      expect(runningSnapshot.recoveryRequired).toBe(true);
      expect(runningOwner).toMatchObject({
        operationKind: 'media_derivation',
        ownerAuthority: 'media_derivation_attempt',
        outcome: null,
      });
      expect(database.prepare('SELECT state FROM media_derivation_attempts').get()).toEqual({
        state: 'running',
      });
      expect(dependencies.localDerivation.calls).toHaveLength(0);

      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            mediaDerivations: afterOwnerSettlementExit,
          },
          runtimeInput,
        ),
      ).rejects.toThrow('simulated process exit after media.derive owner settlement');

      const ownerSnapshot = fixture.data.harness.loadActivation(runId, 1);
      const ownerBacked = ownerSnapshot.dispatches.find(({ id }) => id === unbound.id);
      expect(ownerSnapshot.recoveryRequired).toBe(true);
      expect(ownerBacked).toMatchObject({
        operationKind: 'media_derivation',
        ownerAuthority: 'media_derivation_attempt',
        outcome: null,
      });
      expect(database.prepare('SELECT state FROM media_derivation_attempts').get()).toEqual({
        state: 'succeeded',
      });
      expect(dependencies.localDerivation.calls).toHaveLength(1);

      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          mediaDerivations: fixture.data.mediaDerivations,
        },
        runtimeInput,
      );
      if (resumed.kind !== 'executed') throw new Error('Expected media.derive recovery');
      const settled = resumed.snapshot.dispatches.find(({ id }) => id === unbound.id);
      expect(settled?.outcome).toMatchObject({ status: 'succeeded' });
      expect(dependencies.localDerivation.calls).toHaveLength(1);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM media_derivation_attempts').get(),
      ).toEqual({ count: 1 });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM media_derivation_outputs').get(),
      ).toEqual({ count: 1 });
      expect(model.streamed).toHaveLength(3);
      expect(resumed.snapshot.recoveryRequired).toBe(false);
      expect(resumed.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 180_000);

  it('settles durable unknown transcription and reconciles without resubmission after restart', async () => {
    const transcription = new UnavailableTranscriptionProvider();
    const dependencies = { ...createJourneyDependencies(), transcription };
    const state = await acceptedRuntimeFixture(
      ROOT_CATALOG,
      dependencies,
      'Transcribe the accepted source.',
      UNKNOWN_COST_BUDGET,
    );
    const { fixture, context, runId } = state;
    const input = await seedMediaTranscribeInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaDeriveDefinition.id] }),
        'provider-call.tool-get.media-transcribe',
      ),
      [
        toolResponse(MediaDeriveDefinition.id, input, 'provider-call.media-transcribe'),
        FINAL_RESPONSE,
      ],
    );
    let interruptedAfterUnknown = false;
    const afterUnknownExit: Pick<typeof fixture.data.mediaDerivations, 'start' | 'continue'> = {
      start(request, commandContext) {
        return fixture.data.mediaDerivations.start(request, commandContext);
      },
      async continue(request, commandContext, signal) {
        const result = await fixture.data.mediaDerivations.continue(
          request,
          commandContext,
          signal,
        );
        if (!interruptedAfterUnknown) {
          interruptedAfterUnknown = true;
          throw new Error('simulated process exit after unknown transcription owner');
        }
        return result;
      },
    };
    const runtimeInput = {
      runId,
      limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
      context,
    } as const;
    let frozenSettlementResult: ReturnType<typeof MediaDeriveDefinition.parseSuccess> | null = null;
    const settlementExitPersistence = {
      ...fixture.data.harness,
      settleMediaDeriveBoundary(settleInput, commandContext) {
        const commit = fixture.data.harness.settleMediaDeriveBoundary(settleInput, commandContext);
        if (commit.value.result === null) {
          throw new Error('Expected media.derive settlement result');
        }
        frozenSettlementResult = commit.value.result;
        fixture.data.operations.cancel(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.runtime.media-transcribe.cancel-after-settlement',
            method: 'operation.cancel',
            input: {
              operations: [
                {
                  ref: commit.value.result.operation,
                  expectedRevision: commit.value.result.operation.revision,
                  expectedState: 'unknown',
                },
              ],
            },
          },
          context,
        );
        throw new Error('simulated process exit after transcription Dispatch settlement');
      },
    } satisfies HarnessPersistenceAuthority;
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            mediaDerivations: afterUnknownExit,
          },
          runtimeInput,
        ),
      ).rejects.toThrow('simulated process exit after unknown transcription owner');

      const database = getJourneyTestDatabase(fixture.store);
      const interrupted = fixture.data.harness.loadActivation(runId, 1);
      const open = interrupted.dispatches.find(
        ({ key }) => key.toolId === MediaDeriveDefinition.id,
      );
      expect(interrupted.recoveryRequired).toBe(true);
      expect(open).toMatchObject({
        operationKind: 'media_derivation',
        ownerAuthority: 'media_derivation_attempt',
        outcome: null,
      });
      expect(database.prepare('SELECT state FROM media_derivation_attempts').get()).toEqual({
        state: 'unknown',
      });
      expect(dependencies.transcription.submitCalls).toBe(1);
      expect(dependencies.transcription.reconcileCalls).toBe(0);

      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: settlementExitPersistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            mediaDerivations: fixture.data.mediaDerivations,
          },
          runtimeInput,
        ),
      ).rejects.toThrow('simulated process exit after transcription Dispatch settlement');

      const afterSettlement = fixture.data.harness.loadActivation(runId, 1);
      const settled = afterSettlement.dispatches.find(({ id }) => id === open?.id);
      expect(settled?.outcome).toMatchObject({ status: 'succeeded' });
      if (settled?.outcome?.status !== 'succeeded' || frozenSettlementResult === null) {
        throw new Error('Expected a settled transcription Dispatch');
      }
      const settledResult = MediaDeriveDefinition.parseSuccess(frozenSettlementResult);
      expect(database.prepare('SELECT state FROM media_derivation_attempts').get()).toEqual({
        state: 'unknown',
      });
      expect(
        database.prepare('SELECT cancel_requested FROM media_derivation_attempts').get(),
      ).toEqual({ cancel_requested: 1 });
      expect(dependencies.transcription.submitCalls).toBe(1);
      expect(dependencies.transcription.reconcileCalls).toBe(1);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM media_derivation_attempts').get(),
      ).toEqual({ count: 1 });
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM media_derivation_outputs').get(),
      ).toEqual({ count: 0 });
      const afterOwnerChange = serializedDatabaseRows(database);
      const replay = fixture.data.harness.settleMediaDeriveBoundary(
        {
          dispatchOperationId: settled.id,
          activationNumber: 1,
          result: settledResult,
          completedAt: NOW,
          commandId: 'command.media-transcribe.replay-after-owner-change',
        },
        context,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.result).toEqual(settledResult);
      expect(serializedDatabaseRows(database)).toBe(afterOwnerChange);

      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          mediaDerivations: fixture.data.mediaDerivations,
        },
        runtimeInput,
      );
      if (resumed.kind !== 'executed') throw new Error('Expected transcription recovery');
      expect(resumed.snapshot.recoveryRequired).toBe(false);
      expect(resumed.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 180_000);

  it('rejects materialized media.derive without its authority before model execution', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaDeriveDefinition.id] }),
        'provider-call.tool-get.media-derive.missing-authority',
      ),
      [FINAL_RESPONSE],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Materialized media.derive requires MediaDerivationsAuthority');
      expect(model.streamed).toHaveLength(1);
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      expect(snapshot.dispatches.some(({ key }) => key.toolId === MediaDeriveDefinition.id)).toBe(
        false,
      );
      expect(dependencies.localDerivation.calls).toHaveLength(0);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM media_derivation_attempts')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects a frozen media.derive definition with altered recovery metadata', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter();
    const persistence = {
      ...fixture.data.harness,
      loadActivation(targetRunId, activationNumber) {
        const snapshot = fixture.data.harness.loadActivation(targetRunId, activationNumber);
        return {
          ...snapshot,
          catalog: {
            ...snapshot.catalog,
            tools: snapshot.catalog.tools.map((tool) =>
              tool.id === MediaDeriveDefinition.id
                ? {
                    ...tool,
                    metadata: {
                      ...tool.metadata,
                      recovery: {
                        ...tool.metadata.recovery,
                        unknownStateNeverResubmit: false,
                      },
                    },
                  }
                : tool,
            ),
          },
        };
      },
    } satisfies HarnessPersistenceAuthority;
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Frozen media.derive definition is unavailable or invalid');
      expect(model.streamed).toHaveLength(0);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === MediaDeriveDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('confirms delivery.export exactly and cold-recovers one owner-backed export without repeating the adapter', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedDeliveryExportInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryExportDefinition.id] }),
        'provider-call.tool-get.delivery-export',
      ),
      [
        toolResponse(DeliveryExportDefinition.id, input, 'provider-call.delivery-export.local'),
        FINAL_RESPONSE,
      ],
    );
    const runtimeDependencies = {
      runs: fixture.data.runs,
      persistence: fixture.data.harness,
      model,
      toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
      deliveryOperations: fixture.data.deliveryOperations,
    };
    try {
      const paused = await coordinateRun(runtimeDependencies, {
        runId,
        limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
        context,
      });
      if (paused.kind !== 'executed') throw new Error('Expected delivery.export confirmation wait');
      const dispatch = paused.snapshot.dispatches.find(
        ({ key }) => key.toolId === DeliveryExportDefinition.id,
      );
      if (dispatch === undefined || dispatch.confirmationId === null) {
        throw new Error('Expected a pending delivery.export Dispatch');
      }
      expect(paused.snapshot.run.status).toBe('waiting_confirmation');
      expect(paused.snapshot.activation.state).toBe('active');
      expect(dispatch).toMatchObject({
        guardOutcome: 'confirmation_required',
        confirmationId: dispatch.confirmationId,
        operationKind: null,
        ownerId: null,
        outcome: null,
        key: { input },
      });
      expect(
        paused.snapshot.journal
          .filter(({ payloadState }) => payloadState.state === 'available')
          .map(({ payloadState }) =>
            payloadState.state === 'available' ? payloadState.payload : null,
          ),
      ).toContainEqual(
        expect.objectContaining({
          type: 'confirmation_requested',
          confirmationId: dispatch.confirmationId,
          target: {
            kind: 'delivery_export',
            manifest: input.manifest,
            formatIntent: {
              container: 'mp4',
              videoCodec: 'h264',
              audioCodec: 'aac',
              width: 1_920,
              height: 1_080,
              frameRate: 24,
              quality: 'review',
            },
            itemCount: 1,
            destination: { kind: 'user_selected_file', displayLabel: 'runtime-final.mp4' },
            overwriteExisting: false,
            cost: { state: 'known', value: '0', currency: 'USD' },
          },
          immutableInputHash: dispatch.key.inputHash,
        }),
      );
      const database = getJourneyTestDatabase(fixture.store);
      const storedConfirmation = database
        .prepare('SELECT target_v1_json FROM run_confirmations WHERE id = ?')
        .get(dispatch.confirmationId) as { readonly target_v1_json: string } | undefined;
      if (storedConfirmation === undefined)
        throw new Error('Expected stored delivery export confirmation');
      const corruptedTarget = {
        ...(JSON.parse(storedConfirmation.target_v1_json) as Record<string, unknown>),
        itemCount: 2,
      };
      database
        .prepare('UPDATE run_confirmations SET target_v1_json = ? WHERE id = ?')
        .run(JSON.stringify(corruptedTarget), dispatch.confirmationId);
      expect(() =>
        createHostConfirmationAuthority(fixture.store, {
          now: () => NOW,
          createId: fixture.createId,
        }).respond(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.runtime.delivery-export.tampered',
            method: 'confirmation.respond',
            input: {
              confirmationId: dispatch.confirmationId!,
              immutableInputHash: dispatch.key.inputHash,
              decision: 'approved',
            },
          },
          userContext,
        ),
      ).toThrow('delivery.export Confirmation');
      database
        .prepare('UPDATE run_confirmations SET target_v1_json = ? WHERE id = ?')
        .run(storedConfirmation.target_v1_json, dispatch.confirmationId);
      expect(dependencies.exporter.calls).toHaveLength(0);
      expect(dependencies.destinations.calls).toHaveLength(0);

      const exportAttempt = paused.snapshot.modelAttempts.find(
        ({ id }) => id === dispatch.originModelAttemptId,
      );
      if (exportAttempt === undefined || exportAttempt.response === null) {
        throw new Error('Expected the committed delivery.export Model Attempt');
      }
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: exportAttempt.id,
            requestHash: exportAttempt.requestHash,
            response: exportAttempt.response,
            settledAt: NOW,
            commandId: 'command.delivery-export.generic-model-settle',
          },
          context,
        ),
      ).toThrow('delivery.export');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: exportAttempt.id,
            providerCallId: dispatch.originProviderCallId!,
            toolId: DeliveryExportDefinition.id,
            input,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            commandId: 'command.delivery-export.generic-prepare',
          },
          context,
        ),
      ).toThrow('delivery.export requires its dedicated durable settlement boundary');
      expect(() =>
        fixture.data.harness.settleDispatch(
          {
            dispatchOperationId: dispatch.id,
            modelAttemptId: exportAttempt.id,
            providerCallId: dispatch.originProviderCallId!,
            outcome: DeliveryExportDefinition.parseOutcome({
              status: 'succeeded',
              data: DeliveryExportDefinition.examples.success,
            }),
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            completedAt: NOW,
            commandId: 'command.delivery-export.generic-settle',
          },
          context,
        ),
      ).toThrow('delivery.export requires its dedicated durable settlement boundary');

      const confirmation = createHostConfirmationAuthority(fixture.store, {
        now: () => NOW,
        createId: fixture.createId,
      }).respond(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.delivery-export.approve',
          method: 'confirmation.respond',
          input: {
            confirmationId: dispatch.confirmationId,
            immutableInputHash: dispatch.key.inputHash,
            decision: 'approved',
          },
        },
        userContext,
      );
      expect(confirmation.result.effect).toBeNull();
      expect(
        fixture.data.runs
          .listInbox(runId)
          .some(
            ({ source }) =>
              source.kind === 'message' && source.messageId === confirmation.result.messageId,
          ),
      ).toBe(false);
      expect(fixture.data.harness.loadActivation(runId, 1)).toMatchObject({
        run: { status: 'running' },
        activation: { state: 'active' },
      });

      const beforeOwner = {
        preview: fixture.data.deliveryOperations.preview,
        async export() {
          throw new Error('simulated process exit before delivery.export owner creation');
        },
      } satisfies Pick<typeof fixture.data.deliveryOperations, 'export' | 'preview'>;
      await expect(
        coordinateRun(
          { ...runtimeDependencies, deliveryOperations: beforeOwner },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit before delivery.export owner creation');
      expect(database.prepare('SELECT COUNT(*) AS count FROM delivery_exports').get()).toEqual({
        count: 0,
      });
      expect(dependencies.exporter.calls).toHaveLength(0);

      const afterOwnerSettlement = {
        preview: fixture.data.deliveryOperations.preview,
        async export(
          request: Parameters<typeof fixture.data.deliveryOperations.export>[0],
          commandContext: Parameters<typeof fixture.data.deliveryOperations.export>[1],
          signal?: AbortSignal,
        ) {
          await fixture.data.deliveryOperations.export(request, commandContext, signal);
          throw new Error('simulated process exit after delivery.export owner settlement');
        },
      } satisfies Pick<typeof fixture.data.deliveryOperations, 'export' | 'preview'>;
      await expect(
        coordinateRun(
          { ...runtimeDependencies, deliveryOperations: afterOwnerSettlement },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after delivery.export owner settlement');
      expect(database.prepare('SELECT state FROM delivery_exports').get()).toEqual({
        state: 'succeeded',
      });
      expect(dependencies.destinations.calls).toHaveLength(1);
      expect(dependencies.exporter.calls).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.find(({ id }) => id === dispatch.id)?.outcome,
      ).toBeNull();

      const resumed = await coordinateRun(runtimeDependencies, {
        runId,
        limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
        context,
      });
      if (resumed.kind !== 'executed') throw new Error('Expected delivery.export recovery');
      const settled = resumed.snapshot.dispatches.find(({ id }) => id === dispatch.id);
      expect(settled?.outcome).toMatchObject({
        status: 'succeeded',
        data: {
          state: 'succeeded',
          destinationLabel: input.destination.displayLabel,
          contentHash: expect.any(String),
          artifact: { kind: 'delivery_export' },
          cost: { state: 'known', value: '0', currency: 'USD' },
        },
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM delivery_exports').get()).toEqual({
        count: 1,
      });
      expect(dependencies.destinations.calls).toHaveLength(1);
      expect(dependencies.exporter.calls).toHaveLength(1);
      expect(model.streamed).toHaveLength(3);
      expect(resumed.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('denies delivery.export without creating an owner or invoking destination capabilities', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedDeliveryExportInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryExportDefinition.id] }),
        'provider-call.tool-get.delivery-export-denied',
      ),
      [
        toolResponse(DeliveryExportDefinition.id, input, 'provider-call.delivery-export.denied'),
        FINAL_RESPONSE,
      ],
    );
    const runtimeDependencies = {
      runs: fixture.data.runs,
      persistence: fixture.data.harness,
      model,
      toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
      deliveryOperations: fixture.data.deliveryOperations,
    };
    try {
      const paused = await coordinateRun(runtimeDependencies, {
        runId,
        limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
        context,
      });
      if (paused.kind !== 'executed') throw new Error('Expected delivery.export confirmation wait');
      const dispatch = paused.snapshot.dispatches.find(
        ({ key }) => key.toolId === DeliveryExportDefinition.id,
      );
      if (dispatch === undefined || dispatch.confirmationId === null) {
        throw new Error('Expected a pending delivery.export Dispatch');
      }
      createHostConfirmationAuthority(fixture.store, {
        now: () => NOW,
        createId: fixture.createId,
      }).respond(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.delivery-export.deny',
          method: 'confirmation.respond',
          input: {
            confirmationId: dispatch.confirmationId,
            immutableInputHash: dispatch.key.inputHash,
            decision: 'denied',
          },
        },
        userContext,
      );
      const denied = fixture.data.harness
        .loadActivation(runId, 1)
        .dispatches.find(({ id }) => id === dispatch.id);
      expect(denied).toMatchObject({
        guardOutcome: 'denied',
        operationKind: null,
        ownerId: null,
        outcome: { status: 'permission_denied', code: 'protected_denied' },
      });
      expect(fixture.data.harness.loadActivation(runId, 1)).toMatchObject({
        run: { status: 'running' },
        activation: { state: 'active' },
      });

      const resumed = await coordinateRun(runtimeDependencies, {
        runId,
        limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
        context,
      });
      if (resumed.kind !== 'executed') throw new Error('Expected denied export continuation');
      expect(resumed.snapshot.run.status).toBe('completed');
      expect(dependencies.destinations.calls).toHaveLength(0);
      expect(dependencies.exporter.calls).toHaveLength(0);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM delivery_exports')
          .get(),
      ).toEqual({ count: 0 });
      expect(model.streamed).toHaveLength(3);
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: DeliveryExportDefinition.id,
            outcome: expect.objectContaining({ status: 'permission_denied' }),
          }),
        ]),
      );
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('requires DeliveryOperationsAuthority when delivery.export is materialized', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryExportDefinition.id] }),
        'provider-call.tool-get.delivery-export.missing-authority',
      ),
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Materialized delivery tools require DeliveryOperationsAuthority');
      expect(model.streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === DeliveryExportDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects a frozen delivery.export definition with altered recovery metadata', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter();
    const persistence = {
      ...fixture.data.harness,
      loadActivation(targetRunId, activationNumber) {
        const snapshot = fixture.data.harness.loadActivation(targetRunId, activationNumber);
        return {
          ...snapshot,
          catalog: {
            ...snapshot.catalog,
            tools: snapshot.catalog.tools.map((tool) =>
              tool.id === DeliveryExportDefinition.id
                ? {
                    ...tool,
                    metadata: {
                      ...tool.metadata,
                      recovery: {
                        ...tool.metadata.recovery,
                        unknownStateNeverResubmit: true,
                      },
                    },
                  }
                : tool,
            ),
          },
        };
      },
    } satisfies HarnessPersistenceAuthority;
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Frozen delivery.export definition is unavailable or invalid');
      expect(model.streamed).toHaveLength(0);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === DeliveryExportDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('loads delivery.preview on demand and settles one owner-backed local Review Cut', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedDeliveryPreviewInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryPreviewDefinition.id] }),
        'provider-call.tool-get.delivery-preview',
      ),
      [
        toolResponse(DeliveryPreviewDefinition.id, input, 'provider-call.delivery-preview.local'),
        FINAL_RESPONSE,
      ],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          deliveryOperations: fixture.data.deliveryOperations,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected delivery.preview Run execution');
      const dispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === DeliveryPreviewDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled delivery.preview Dispatch');
      }
      const preview = DeliveryPreviewDefinition.parseSuccess(dispatch.outcome.data);

      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === DeliveryPreviewDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: DeliveryPreviewDefinition.id }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: DeliveryPreviewDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({ attemptId: preview.attemptId }),
            }),
          }),
        ]),
      );
      expect(preview).toMatchObject({
        state: 'succeeded',
        operation: {
          kind: 'review_cut_attempt',
          ownerRef: { authority: 'review_cut_attempt', id: preview.attemptId },
        },
        artifact: { kind: 'review_cut' },
        warnings: [],
        usage: { state: 'known', value: '0', currency: 'USD' },
      });
      expect(dependencies.review.calls).toHaveLength(1);
      expect(dependencies.review.calls[0]).toMatchObject({
        manifest: { sourcePlan: input.plan },
        range: null,
      });
      const database = getJourneyTestDatabase(fixture.store);
      expect(database.prepare('SELECT COUNT(*) AS count FROM review_cut_attempts').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM delivery_manifests').get()).toEqual({
        count: 1,
      });
      expect(result.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('rejects delivery.preview for another Project before creating an owner or Manifest', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const other = fixture.data.projects.create(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.delivery-preview.other-project',
        method: 'project.create',
        input: {
          name: 'Other runtime preview Project',
          permissionMode: 'reversible',
          budget,
          formatPolicy,
        },
      },
      userContext,
    ).result.project;
    const otherPlan = fixture.data.delivery.apply(
      {
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.delivery-preview.other-plan',
        method: 'delivery.apply',
        input: {
          action: 'create',
          project: {
            authority: 'project',
            id: other.id,
            revision: other.revision,
            contentHash: other.contentHash,
          },
          name: 'Other runtime preview Delivery',
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
      userContext,
    ).result.plan;
    const input = DeliveryPreviewDefinition.parseInput({
      plan: {
        authority: 'delivery',
        id: otherPlan.id,
        revision: otherPlan.revision,
        contentHash: otherPlan.contentHash,
      },
      range: null,
    });
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryPreviewDefinition.id] }),
        'provider-call.tool-get.delivery-preview.cross-project',
      ),
      [
        toolResponse(
          DeliveryPreviewDefinition.id,
          input,
          'provider-call.delivery-preview.cross-project',
        ),
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            deliveryOperations: fixture.data.deliveryOperations,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(`delivery:${otherPlan.id} belongs to another Project`);
      expect(model.streamed).toHaveLength(2);
      expect(dependencies.review.calls).toHaveLength(0);
      const database = getJourneyTestDatabase(fixture.store);
      expect(database.prepare('SELECT COUNT(*) AS count FROM review_cut_attempts').get()).toEqual({
        count: 0,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM delivery_manifests').get()).toEqual({
        count: 0,
      });
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === DeliveryPreviewDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects a frozen delivery.preview definition with altered recovery metadata', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter();
    const persistence = {
      ...fixture.data.harness,
      loadActivation(targetRunId, activationNumber) {
        const snapshot = fixture.data.harness.loadActivation(targetRunId, activationNumber);
        return {
          ...snapshot,
          catalog: {
            ...snapshot.catalog,
            tools: snapshot.catalog.tools.map((tool) =>
              tool.id === DeliveryPreviewDefinition.id
                ? {
                    ...tool,
                    metadata: {
                      ...tool.metadata,
                      recovery: {
                        ...tool.metadata.recovery,
                        unknownStateNeverResubmit: true,
                      },
                    },
                  }
                : tool,
            ),
          },
        };
      },
    } satisfies HarnessPersistenceAuthority;
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Frozen delivery.preview definition is unavailable or invalid');
      expect(model.streamed).toHaveLength(0);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === DeliveryPreviewDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('resumes delivery.preview across exits before rendering and after owner settlement', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedDeliveryPreviewInput(state);
    let interrupted = false;
    const interruptedOperations: Pick<typeof fixture.data.deliveryOperations, 'preview'> = {
      async preview(request, commandContext, signal) {
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit before delivery.preview renderer');
        }
        return fixture.data.deliveryOperations.preview(request, commandContext, signal);
      },
    };
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryPreviewDefinition.id] }),
        'provider-call.tool-get.delivery-preview.owner-recovery',
      ),
      [
        toolResponse(
          DeliveryPreviewDefinition.id,
          input,
          'provider-call.delivery-preview.owner-recovery',
        ),
        FINAL_RESPONSE,
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            deliveryOperations: interruptedOperations,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit before delivery.preview renderer');

      const database = getJourneyTestDatabase(fixture.store);
      const interruptedSnapshot = fixture.data.harness.loadActivation(runId, 1);
      const dispatch = interruptedSnapshot.dispatches.find(
        ({ key }) => key.toolId === DeliveryPreviewDefinition.id,
      );
      if (dispatch === undefined) throw new Error('Expected an open delivery.preview Dispatch');
      expect(dispatch).toMatchObject({
        operationKind: 'review_cut_attempt',
        ownerAuthority: 'review_cut_attempt',
        outcome: null,
      });
      expect(interruptedSnapshot.recoveryRequired).toBe(true);
      expect(dependencies.review.calls).toHaveLength(0);
      expect(
        database
          .prepare('SELECT state, COUNT(*) AS count FROM review_cut_attempts GROUP BY state')
          .get(),
      ).toEqual({ state: 'running', count: 1 });
      const modelAttempt = interruptedSnapshot.modelAttempts.find(
        ({ id }) => id === dispatch.originModelAttemptId,
      );
      if (modelAttempt === undefined || modelAttempt.response === null) {
        throw new Error('Expected the settled delivery.preview Model Attempt');
      }
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: modelAttempt.id,
            requestHash: modelAttempt.requestHash,
            response: modelAttempt.response,
            settledAt: NOW,
            commandId: 'command.delivery-preview.generic-model-settle',
          },
          context,
        ),
      ).toThrow('delivery.preview');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: modelAttempt.id,
            providerCallId: dispatch.originProviderCallId!,
            toolId: DeliveryPreviewDefinition.id,
            input,
            authorityWatermarkHash: null,
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            commandId: 'command.delivery-preview.generic-prepare',
          },
          context,
        ),
      ).toThrow('delivery.preview requires its dedicated durable settlement boundary');
      expect(() =>
        fixture.data.harness.settleDispatch(
          {
            dispatchOperationId: dispatch.id,
            modelAttemptId: dispatch.originModelAttemptId!,
            providerCallId: dispatch.originProviderCallId!,
            outcome: DeliveryPreviewDefinition.parseOutcome({
              status: 'succeeded',
              data: DeliveryPreviewDefinition.examples.success,
            }),
            activationNumber: 1,
            turnNumber: 2,
            stepNumber: 2,
            completedAt: NOW,
            commandId: 'command.delivery-preview.generic-settle',
          },
          context,
        ),
      ).toThrow('delivery.preview requires its dedicated durable settlement boundary');

      let interruptedAfterOwnerSettlement = false;
      const settledOwnerThenInterrupted: Pick<typeof fixture.data.deliveryOperations, 'preview'> = {
        async preview(request, commandContext, signal) {
          const result = await fixture.data.deliveryOperations.preview(
            request,
            commandContext,
            signal,
          );
          if (!interruptedAfterOwnerSettlement) {
            interruptedAfterOwnerSettlement = true;
            throw new Error('simulated process exit after delivery.preview owner settlement');
          }
          return result;
        },
      };
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            deliveryOperations: settledOwnerThenInterrupted,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after delivery.preview owner settlement');
      expect(dependencies.review.calls).toHaveLength(1);
      expect(database.prepare('SELECT state FROM review_cut_attempts').get()).toEqual({
        state: 'succeeded',
      });
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.find(({ id }) => id === dispatch.id)?.outcome,
      ).toBeNull();

      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          deliveryOperations: fixture.data.deliveryOperations,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (resumed.kind !== 'executed') throw new Error('Expected delivery.preview recovery');
      const settled = resumed.snapshot.dispatches.find(({ id }) => id === dispatch.id);
      expect(settled?.outcome).toMatchObject({
        status: 'succeeded',
        data: { state: 'succeeded' },
      });
      expect(dependencies.review.calls).toHaveLength(1);
      expect(database.prepare('SELECT COUNT(*) AS count FROM review_cut_attempts').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM delivery_manifests').get()).toEqual({
        count: 1,
      });
      expect(resumed.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('replays a committed delivery.preview settlement without rendering or writing twice', async () => {
    const dependencies = createJourneyDependencies();
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedDeliveryPreviewInput(state);
    type BoundaryInput = Parameters<
      HarnessPersistenceAuthority['settleDeliveryPreviewBoundary']
    >[0];
    type BoundaryContext = Parameters<
      HarnessPersistenceAuthority['settleDeliveryPreviewBoundary']
    >[1];
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let interrupted = false;
    const persistence = {
      ...fixture.data.harness,
      settleDeliveryPreviewBoundary(inputValue, commandContext) {
        capturedInput = inputValue;
        capturedContext = commandContext;
        const committed = fixture.data.harness.settleDeliveryPreviewBoundary(
          inputValue,
          commandContext,
        );
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit after delivery.preview settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [DeliveryPreviewDefinition.id] }),
        'provider-call.tool-get.delivery-preview.settlement-replay',
      ),
      [
        toolResponse(
          DeliveryPreviewDefinition.id,
          input,
          'provider-call.delivery-preview.settlement-replay',
        ),
        FINAL_RESPONSE,
      ],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            deliveryOperations: fixture.data.deliveryOperations,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after delivery.preview settlement');
      if (capturedInput === null || capturedContext === null) {
        throw new Error('Expected the delivery.preview settlement boundary to be captured');
      }
      expect(dependencies.review.calls).toHaveLength(1);
      const database = getJourneyTestDatabase(fixture.store);
      const beforeTamperRows = serializedDatabaseRows(database);
      expect(() =>
        fixture.data.harness.settleDeliveryPreviewBoundary(
          {
            ...capturedInput,
            result: { ...capturedInput.result, warnings: ['tampered'] },
          },
          capturedContext,
        ),
      ).toThrow('result changed its owner');
      expect(serializedDatabaseRows(database)).toBe(beforeTamperRows);

      const replay = fixture.data.harness.settleDeliveryPreviewBoundary(
        capturedInput,
        capturedContext,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.result).toEqual(capturedInput.result);
      expect(serializedDatabaseRows(database)).toBe(beforeTamperRows);
      expect(dependencies.review.calls).toHaveLength(1);

      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          deliveryOperations: fixture.data.deliveryOperations,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (resumed.kind !== 'executed') throw new Error('Expected settled preview continuation');
      expect(resumed.snapshot.run.status).toBe('completed');
      expect(dependencies.review.calls).toHaveLength(1);
      expect(database.prepare('SELECT COUNT(*) AS count FROM review_cut_attempts').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM delivery_manifests').get()).toEqual({
        count: 1,
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('loads media.link on demand and atomically links Project Media before continuing', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, runId } = state;
    const input = await seedMediaLinkInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaLinkDefinition.id] }),
        'provider-call.tool-get.media-link',
      ),
      [
        toolResponse(MediaLinkDefinition.id, input, 'provider-call.media-link.atomic'),
        FINAL_RESPONSE,
      ],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected media.link Run execution');
      const linkDispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === MediaLinkDefinition.id,
      );
      if (linkDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled media.link Dispatch');
      }
      const linked = MediaLinkDefinition.parseSuccess(linkDispatch.outcome.data);

      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === MediaLinkDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: MediaLinkDefinition.id }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: MediaLinkDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({
                object: expect.objectContaining({ id: input.mediaRef.id }),
              }),
            }),
          }),
        ]),
      );
      expect(linked).toMatchObject({
        object: {
          id: input.mediaRef.id,
          revision: input.mediaRef.revision + 1,
          productionLinks: [{ productionObjectId: input.target.id, relation: input.relation }],
        },
        previousRevision: input.mediaRef.revision,
        changedPaths: ['productionLinks'],
        undoRef: null,
      });
      expect(fixture.data.projectMedia.get(input.mediaRef.id)).toEqual(linked.object);
      expect(result.snapshot.run.status).toBe('completed');
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare(
            `SELECT COUNT(*) AS count FROM project_events
             WHERE id = ? AND project_id = ? AND subject_authority = 'project_media_ref'
               AND subject_id = ?`,
          )
          .get(linked.eventId, linked.object.projectId, linked.object.id),
      ).toEqual({ count: 1 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('loads media.attach on demand and atomically attaches authorized media before continuing', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, project, runId } = state;
    const { asset, input } = await seedMediaAttachInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaAttachDefinition.id] }),
        'provider-call.tool-get.media-attach',
      ),
      [
        toolResponse(MediaAttachDefinition.id, input, 'provider-call.media-attach.atomic'),
        FINAL_RESPONSE,
      ],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected media.attach Run execution');
      const attachDispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === MediaAttachDefinition.id,
      );
      if (attachDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled media.attach Dispatch');
      }
      const attached = MediaAttachDefinition.parseSuccess(attachDispatch.outcome.data);

      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === MediaAttachDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: MediaAttachDefinition.id }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: MediaAttachDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({
                object: expect.objectContaining({ globalAssetId: asset.id }),
              }),
            }),
          }),
        ]),
      );
      expect(attached).toMatchObject({
        object: {
          projectId: project.id,
          globalAssetId: asset.id,
          revision: 0,
          lifecycle: 'active',
          label: input.label,
          collections: input.collections,
          roles: input.roles,
          notes: input.notes,
        },
        previousRevision: null,
        changedPaths: ['project_media_ref'],
        undoRef: null,
      });
      expect(fixture.data.projectMedia.get(attached.object.id)).toEqual(attached.object);
      expect(result.snapshot.run.status).toBe('completed');
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare(
            `SELECT COUNT(*) AS count FROM project_events
             WHERE id = ? AND project_id = ? AND event_type = 'media_attached'
               AND subject_authority = 'project_media_ref' AND subject_id = ?`,
          )
          .get(attached.eventId, project.id, attached.object.id),
      ).toEqual({ count: 1 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('loads canvas.mutate on demand and commits through its dedicated atomic boundary', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, project, runId } = state;
    const input = await seedCanvasMutateInput(state);
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [CanvasMutateDefinition.id] }),
        'provider-call.tool-get.canvas-mutate',
      ),
      [
        toolResponse(CanvasMutateDefinition.id, input, 'provider-call.canvas-mutate.atomic'),
        FINAL_RESPONSE,
      ],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected canvas.mutate Run execution');
      const canvasDispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === CanvasMutateDefinition.id,
      );
      if (canvasDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled canvas.mutate Dispatch');
      }
      const mutated = CanvasMutateDefinition.parseSuccess(canvasDispatch.outcome.data);

      expect(model.streamed).toHaveLength(3);
      expect(
        model.streamed[0]!.materializedTools.some(({ id }) => id === CanvasMutateDefinition.id),
      ).toBe(false);
      expect(model.streamed[1]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: CanvasMutateDefinition.id }),
      );
      expect(model.streamed[2]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: CanvasMutateDefinition.id,
            outcome: expect.objectContaining({ status: 'succeeded', data: mutated }),
          }),
        ]),
      );
      expect(canvasDispatch.projectEventId).toBe(mutated.receipts[0]!.eventId);
      expect(new Set(mutated.receipts.map(({ eventId }) => eventId))).toEqual(
        new Set([canvasDispatch.projectEventId]),
      );
      expect(
        fixture.data.canvas.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.canvas-mutate.persisted',
          method: 'canvas.get',
          input: { projectId: project.id },
        }).result,
      ).toMatchObject({
        revision: input.expectedCanvasRevision + 1,
        placements: [{ id: mutated.receipts[0]!.object.id, revision: 0 }],
      });
      expect(result.snapshot.run.status).toBe('completed');
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare(
            `SELECT COUNT(*) AS count FROM project_events
             WHERE id = ? AND project_id = ? AND event_type = 'object_revision_changed'
               AND subject_authority = 'canvas'`,
          )
          .get(canvasDispatch.projectEventId, project.id),
      ).toEqual({ count: 1 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('replays a committed media.attach boundary without attaching or journaling twice', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, project, runId } = state;
    const { asset, input: attachInput } = await seedMediaAttachInput(state);
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleMediaAttachBoundary']>[0];
    type BoundaryContext = Parameters<HarnessPersistenceAuthority['settleMediaAttachBoundary']>[1];
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeSettlementRevision: number | null = null;
    let interrupted = false;
    const persistence = {
      ...fixture.data.harness,
      settleMediaAttachBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeSettlementRevision = fixture.data.harness.loadActivation(runId, 1).run.revision;
        const committed = fixture.data.harness.settleMediaAttachBoundary(input, commandContext);
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit after media.attach settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaAttachDefinition.id] }),
        'provider-call.tool-get.media-attach.replay',
      ),
      [toolResponse(MediaAttachDefinition.id, attachInput, 'provider-call.media-attach.replay')],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after media.attach settlement');
      if (capturedInput === null || capturedContext === null || beforeSettlementRevision === null) {
        throw new Error('Expected the media.attach settlement boundary to be captured');
      }
      const committed = fixture.data.harness.loadActivation(runId, 1);
      const dispatch = committed.dispatches.find(
        ({ key }) => key.toolId === MediaAttachDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected the committed media.attach Dispatch');
      }
      const result = MediaAttachDefinition.parseSuccess(dispatch.outcome.data);
      expect(committed.run.revision).toBe(beforeSettlementRevision + 1);
      expect(fixture.data.projectMedia.get(result.object.id)).toEqual(result.object);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare(
            `SELECT COUNT(*) AS count FROM project_media_refs
             WHERE project_id = ? AND global_asset_id = ?`,
          )
          .get(project.id, asset.id),
      ).toEqual({ count: 1 });
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM project_events WHERE id = ?')
          .get(result.eventId),
      ).toEqual({ count: 1 });

      const call = capturedInput.response.events.find(
        (event) => event.type === 'tool_call' && event.toolId === MediaAttachDefinition.id,
      );
      if (call?.type !== 'tool_call') throw new Error('Expected the captured media.attach call');
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: capturedInput.attemptId,
            requestHash: capturedInput.requestHash,
            response: capturedInput.response,
            settledAt: capturedInput.settledAt,
            commandId: 'command.media-attach.generic-settle',
          },
          capturedContext,
        ),
      ).toThrow('media.attach, media.derive, media.link');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: capturedInput.attemptId,
            providerCallId: call.providerCallId,
            toolId: MediaAttachDefinition.id,
            input: MediaAttachDefinition.parseInput(call.canonicalArguments),
            authorityWatermarkHash: null,
            activationNumber: capturedInput.activationNumber,
            turnNumber: capturedInput.turnNumber,
            stepNumber: capturedInput.stepNumber + 1,
            commandId: 'command.media-attach.generic-dispatch',
          },
          capturedContext,
        ),
      ).toThrow('media.attach requires its dedicated durable settlement boundary');

      const beforeReplayRows = serializedDatabaseRows(getJourneyTestDatabase(fixture.store));
      const replay = fixture.data.harness.settleMediaAttachBoundary(capturedInput, capturedContext);
      expect(replay.events).toEqual([]);
      expect(replay.value.result).toEqual(result);
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).toBe(beforeReplayRows);
      expect(model.streamed).toHaveLength(2);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('rolls back the complete media.attach boundary when the Run journal cannot advance', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, project, runId } = state;
    const { asset, input: attachInput } = await seedMediaAttachInput(state);
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleMediaAttachBoundary']>[0];
    type BoundaryContext = Parameters<HarnessPersistenceAuthority['settleMediaAttachBoundary']>[1];
    const database = getJourneyTestDatabase(fixture.store);
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeBoundaryRows: string | null = null;
    const persistence = {
      ...fixture.data.harness,
      settleMediaAttachBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeBoundaryRows = serializedDatabaseRows(database);
        database.exec(`
          CREATE TEMP TRIGGER fail_media_attach_boundary
          BEFORE UPDATE ON runs
          BEGIN
            SELECT RAISE(ABORT, 'injected media.attach boundary failure');
          END;
        `);
        try {
          return fixture.data.harness.settleMediaAttachBoundary(input, commandContext);
        } finally {
          database.exec('DROP TRIGGER fail_media_attach_boundary');
        }
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaAttachDefinition.id] }),
        'provider-call.tool-get.media-attach.rollback',
      ),
      [toolResponse(MediaAttachDefinition.id, attachInput, 'provider-call.media-attach.rollback')],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('injected media.attach boundary failure');
      if (capturedInput === null || capturedContext === null || beforeBoundaryRows === null) {
        throw new Error('Expected the failed media.attach boundary to be captured');
      }
      expect(serializedDatabaseRows(database)).toBe(beforeBoundaryRows);
      const failed = fixture.data.harness.loadActivation(runId, 1);
      expect(failed.recoveryRequired).toBe(true);
      expect(failed.modelAttempts.at(-1)).toMatchObject({ state: 'running', response: null });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM project_media_refs
             WHERE project_id = ? AND global_asset_id = ?`,
          )
          .get(project.id, asset.id),
      ).toEqual({ count: 0 });

      const committed = fixture.data.harness.settleMediaAttachBoundary(
        capturedInput,
        capturedContext,
      );
      expect(committed).toMatchObject({
        value: {
          dispatch: {
            key: { toolId: MediaAttachDefinition.id },
            outcome: { status: 'succeeded' },
          },
          result: {
            object: { projectId: project.id, globalAssetId: asset.id, revision: 0 },
            previousRevision: null,
          },
        },
        run: { status: 'running' },
      });
      expect(
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM project_media_refs
             WHERE project_id = ? AND global_asset_id = ?`,
          )
          .get(project.id, asset.id),
      ).toEqual({ count: 1 });
      const afterCommitRows = serializedDatabaseRows(database);
      expect(
        fixture.data.harness.settleMediaAttachBoundary(capturedInput, capturedContext).events,
      ).toEqual([]);
      expect(serializedDatabaseRows(database)).toBe(afterCommitRows);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('replays a committed media.link boundary without linking or journaling twice', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, runId } = state;
    const linkInput = await seedMediaLinkInput(state);
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleMediaLinkBoundary']>[0];
    type BoundaryContext = Parameters<HarnessPersistenceAuthority['settleMediaLinkBoundary']>[1];
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeSettlementRevision: number | null = null;
    let interrupted = false;
    const persistence = {
      ...fixture.data.harness,
      settleMediaLinkBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeSettlementRevision = fixture.data.harness.loadActivation(runId, 1).run.revision;
        const committed = fixture.data.harness.settleMediaLinkBoundary(input, commandContext);
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit after media.link settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaLinkDefinition.id] }),
        'provider-call.tool-get.media-link.replay',
      ),
      [toolResponse(MediaLinkDefinition.id, linkInput, 'provider-call.media-link.replay')],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after media.link settlement');
      if (capturedInput === null || capturedContext === null || beforeSettlementRevision === null) {
        throw new Error('Expected the media.link settlement boundary to be captured');
      }
      const committed = fixture.data.harness.loadActivation(runId, 1);
      const dispatch = committed.dispatches.find(
        ({ key }) => key.toolId === MediaLinkDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected the committed media.link Dispatch');
      }
      const result = MediaLinkDefinition.parseSuccess(dispatch.outcome.data);
      expect(committed.run.revision).toBe(beforeSettlementRevision + 1);
      expect(fixture.data.projectMedia.get(linkInput.mediaRef.id)).toEqual(result.object);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM project_media_links')
          .get(),
      ).toEqual({ count: 1 });
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM project_events WHERE id = ?')
          .get(result.eventId),
      ).toEqual({ count: 1 });

      const call = capturedInput.response.events.find(
        (event) => event.type === 'tool_call' && event.toolId === MediaLinkDefinition.id,
      );
      if (call?.type !== 'tool_call') throw new Error('Expected the captured media.link call');
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: capturedInput.attemptId,
            requestHash: capturedInput.requestHash,
            response: capturedInput.response,
            settledAt: capturedInput.settledAt,
            commandId: 'command.media-link.generic-settle',
          },
          capturedContext,
        ),
      ).toThrow('media.attach, media.derive, media.link');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: capturedInput.attemptId,
            providerCallId: call.providerCallId,
            toolId: MediaLinkDefinition.id,
            input: MediaLinkDefinition.parseInput(call.canonicalArguments),
            authorityWatermarkHash: null,
            activationNumber: capturedInput.activationNumber,
            turnNumber: capturedInput.turnNumber,
            stepNumber: capturedInput.stepNumber + 1,
            commandId: 'command.media-link.generic-dispatch',
          },
          capturedContext,
        ),
      ).toThrow('media.link requires its dedicated durable settlement boundary');

      const beforeReplayRows = serializedDatabaseRows(getJourneyTestDatabase(fixture.store));
      const replay = fixture.data.harness.settleMediaLinkBoundary(capturedInput, capturedContext);
      expect(replay.events).toEqual([]);
      expect(replay.value.result).toEqual(result);
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).toBe(beforeReplayRows);
      expect(model.streamed).toHaveLength(2);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('rolls back the complete media.link boundary when the Run journal cannot advance', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, runId } = state;
    const linkInput = await seedMediaLinkInput(state);
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleMediaLinkBoundary']>[0];
    type BoundaryContext = Parameters<HarnessPersistenceAuthority['settleMediaLinkBoundary']>[1];
    const database = getJourneyTestDatabase(fixture.store);
    const beforeMedia = fixture.data.projectMedia.get(linkInput.mediaRef.id);
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeBoundaryRows: string | null = null;
    const persistence = {
      ...fixture.data.harness,
      settleMediaLinkBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeBoundaryRows = serializedDatabaseRows(database);
        database.exec(`
          CREATE TEMP TRIGGER fail_media_link_boundary
          BEFORE UPDATE ON runs
          BEGIN
            SELECT RAISE(ABORT, 'injected media.link boundary failure');
          END;
        `);
        try {
          return fixture.data.harness.settleMediaLinkBoundary(input, commandContext);
        } finally {
          database.exec('DROP TRIGGER fail_media_link_boundary');
        }
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [MediaLinkDefinition.id] }),
        'provider-call.tool-get.media-link.rollback',
      ),
      [toolResponse(MediaLinkDefinition.id, linkInput, 'provider-call.media-link.rollback')],
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('injected media.link boundary failure');
      if (capturedInput === null || capturedContext === null || beforeBoundaryRows === null) {
        throw new Error('Expected the failed media.link boundary to be captured');
      }
      expect(serializedDatabaseRows(database)).toBe(beforeBoundaryRows);
      const failed = fixture.data.harness.loadActivation(runId, 1);
      expect(failed.recoveryRequired).toBe(true);
      expect(failed.modelAttempts.at(-1)).toMatchObject({ state: 'running', response: null });
      expect(fixture.data.projectMedia.get(linkInput.mediaRef.id)).toEqual(beforeMedia);
      expect(database.prepare('SELECT COUNT(*) AS count FROM project_media_links').get()).toEqual({
        count: 0,
      });

      const committed = fixture.data.harness.settleMediaLinkBoundary(
        capturedInput,
        capturedContext,
      );
      expect(committed).toMatchObject({
        value: {
          dispatch: {
            key: { toolId: MediaLinkDefinition.id },
            outcome: { status: 'succeeded' },
          },
          result: {
            object: { id: linkInput.mediaRef.id, revision: linkInput.mediaRef.revision + 1 },
            previousRevision: linkInput.mediaRef.revision,
          },
        },
        run: { status: 'running' },
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM project_media_links').get()).toEqual({
        count: 1,
      });
      const afterCommitRows = serializedDatabaseRows(database);
      expect(
        fixture.data.harness.settleMediaLinkBoundary(capturedInput, capturedContext).events,
      ).toEqual([]);
      expect(serializedDatabaseRows(database)).toBe(afterCommitRows);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('atomically requests and immediately drains operation.cancel', async () => {
    const provider = new PendingGenerationProvider();
    const dependencies = {
      ...createJourneyDependencies(),
      generation: provider,
    } satisfies JourneyDependencies;
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, project, runId } = state;
    const operation = await seedCancelableGenerationOperation(state, provider);
    const operations = {
      ...fixture.data.operations,
      listCancellationRequested() {
        throw new Error('unrelated queued cancellation must not run inside operation.cancel');
      },
    };
    const cancelInput = OperationCancelDefinition.parseInput({
      operations: [
        {
          ref: operation,
          expectedRevision: operation.revision,
          expectedState: 'submitted',
        },
      ],
    });
    const model = new FakeModelAdapter(
      toolResponse(
        OperationCancelDefinition.id,
        cancelInput,
        'provider-call.operation-cancel.atomic',
      ),
      [FINAL_RESPONSE],
      undefined,
      (_request, quoteIndex) => {
        if (quoteIndex === 1) throw new Error('stop after operation.cancel settlement');
      },
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            onOperationCancellationError: throwOnOperationCancellationError,
            operations,
            deliveryOperations: fixture.data.deliveryOperations,
            resultAssessments: fixture.data.resultAssessments,
            generation: fixture.data.generation,
            mediaDerivations: fixture.data.mediaDerivations,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('stop after operation.cancel settlement');
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      const cancelDispatch = snapshot.dispatches.find(
        ({ key }) => key.toolId === OperationCancelDefinition.id,
      );
      if (cancelDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled operation.cancel Dispatch');
      }
      const cancelled = OperationCancelDefinition.parseSuccess(cancelDispatch.outcome.data)
        .operations[0]!;

      expect(provider).toMatchObject({ submitCalls: 1, cancelCalls: 1 });
      expect(model.streamed).toHaveLength(1);
      expect(model.streamed[0]!.materializedTools).toContainEqual(
        expect.objectContaining({ id: OperationCancelDefinition.id }),
      );
      expect(cancelled).toMatchObject({
        ref: { id: operation.id, revision: operation.revision + 1 },
        state: 'submitted',
        cancelRequested: true,
      });
      expect(
        fixture.data.operations.query(project.id, runId, { operations: [cancelled.ref] }),
      ).toEqual({
        operations: [expect.objectContaining({ state: 'cancelled', cancelRequested: true })],
      });
      const cancellationEvents = fixture.data.runs
        .listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.operation-cancel.events',
          method: 'run.events.list',
          input: { runId, afterSequence: null, page: { cursor: null, limit: 200 } },
        })
        .result.items.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' &&
            payloadState.payload.type === 'operation_state_changed' &&
            payloadState.payload.operation.id === operation.id &&
            payloadState.payload.cancelRequested,
        );
      expect(cancellationEvents).toHaveLength(2);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('keeps a committed operation.cancel successful when its drain and observer both fail', async () => {
    const provider = new PendingGenerationProvider();
    const dependencies = {
      ...createJourneyDependencies(),
      generation: provider,
    } satisfies JourneyDependencies;
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const operation = await seedCancelableGenerationOperation(state, provider);
    const drainFailure = new Error('simulated immediate cancellation drain failure');
    const observerFailure = new Error('simulated cancellation observer failure');
    const onOperationCancellationError = vi.fn(() => {
      throw observerFailure;
    });
    const model = new FakeModelAdapter(
      toolResponse(
        OperationCancelDefinition.id,
        OperationCancelDefinition.parseInput({
          operations: [
            {
              ref: operation,
              expectedRevision: operation.revision,
              expectedState: 'submitted',
            },
          ],
        }),
        'provider-call.operation-cancel.observer-failure',
      ),
      [FINAL_RESPONSE],
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          onOperationCancellationError,
          operations: fixture.data.operations,
          deliveryOperations: fixture.data.deliveryOperations,
          resultAssessments: fixture.data.resultAssessments,
          generation: {
            ...fixture.data.generation,
            async reconcile() {
              throw drainFailure;
            },
          },
          mediaDerivations: fixture.data.mediaDerivations,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(result).toMatchObject({
        kind: 'executed',
        snapshot: { run: { id: runId, status: 'completed' } },
      });
      expect(onOperationCancellationError).toHaveBeenCalledOnce();
      expect(onOperationCancellationError.mock.calls[0]?.[0]).toBeInstanceOf(AggregateError);
      const cancelDispatch = fixture.data.harness
        .loadActivation(runId, 1)
        .dispatches.find(({ key }) => key.toolId === OperationCancelDefinition.id);
      expect(cancelDispatch?.outcome).toMatchObject({ status: 'succeeded' });
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT state, cancel_requested FROM generation_attempts WHERE id = ?')
          .get(operation.ownerRef.id),
      ).toEqual({ state: 'submitted', cancel_requested: 1 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('drains a user run.control cancellation after its Run is terminal', async () => {
    const provider = new PendingGenerationProvider();
    const dependencies = {
      ...createJourneyDependencies(),
      generation: provider,
    } satisfies JourneyDependencies;
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, project, runId } = state;
    const operation = await seedCancelableGenerationOperation(state, provider);
    try {
      const current = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.run-control-cancellation.current',
        method: 'run.get',
        input: { runId },
      }).result;
      const cancelled = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.run-control-cancellation.cancel',
          method: 'run.control',
          input: {
            runId,
            expectedRevision: current.revision,
            expectedStatus: 'accepted',
            action: 'cancel',
            terminalSummary: 'Stop the pending generation.',
          },
        },
        userContext,
      );

      expect(cancelled.result).toMatchObject({ id: runId, status: 'cancelled' });
      expect(provider.cancelCalls).toBe(0);

      await drainRequestedOperationCancellations({
        operations: fixture.data.operations,
        deliveryOperations: fixture.data.deliveryOperations,
        resultAssessments: fixture.data.resultAssessments,
        generation: fixture.data.generation,
        mediaDerivations: fixture.data.mediaDerivations,
      });

      expect(provider.cancelCalls).toBe(1);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT state, cancel_requested FROM generation_attempts WHERE id = ?')
          .get(operation.ownerRef.id),
      ).toEqual({ state: 'cancelled', cancel_requested: 1 });
      expect(fixture.data.operations.query(project.id, runId, { operations: [operation] })).toEqual(
        {
          operations: [expect.objectContaining({ state: 'cancelled', cancelRequested: true })],
        },
      );

      await drainRequestedOperationCancellations({
        operations: fixture.data.operations,
        deliveryOperations: fixture.data.deliveryOperations,
        resultAssessments: fixture.data.resultAssessments,
        generation: fixture.data.generation,
        mediaDerivations: fixture.data.mediaDerivations,
      });
      expect(provider.cancelCalls).toBe(1);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('drains an unknown generation owner with a receipt after terminal run.control cancellation', async () => {
    const provider = new PendingGenerationProvider();
    const dependencies = {
      ...createJourneyDependencies(),
      generation: provider,
    } satisfies JourneyDependencies;
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, project, runId } = state;
    const submitted = await seedCancelableGenerationOperation(state, provider);
    try {
      const unknown = await fixture.data.generation.reconcile(
        {
          operation: submitted,
          expectedRevision: submitted.revision,
          commandId: 'command.runtime.run-control-cancellation.unknown',
        },
        context,
      );
      expect(unknown.state).toBe('unknown');

      const current = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.run-control-cancellation.unknown.current',
        method: 'run.get',
        input: { runId },
      }).result;
      fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.run-control-cancellation.unknown.cancel',
          method: 'run.control',
          input: {
            runId,
            expectedRevision: current.revision,
            expectedStatus: 'accepted',
            action: 'cancel',
            terminalSummary: 'Stop the uncertain generation.',
          },
        },
        userContext,
      );

      await drainRequestedOperationCancellations({
        operations: fixture.data.operations,
        deliveryOperations: fixture.data.deliveryOperations,
        resultAssessments: fixture.data.resultAssessments,
        generation: fixture.data.generation,
        mediaDerivations: fixture.data.mediaDerivations,
      });

      expect(provider.cancelCalls).toBe(1);
      expect(
        fixture.data.operations.query(project.id, runId, { operations: [unknown.operation] }),
      ).toEqual({
        operations: [expect.objectContaining({ state: 'cancelled', cancelRequested: true })],
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('drains a child owner operation as part of agent.cancel', async () => {
    const provider = new PendingGenerationProvider();
    const dependencies = {
      ...createJourneyDependencies(),
      generation: provider,
    } satisfies JourneyDependencies;
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const parent = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-cancel-drain.parent',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parent.revision,
        commandId: 'command.runtime.agent-cancel-drain.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Cancelable child owner operation',
          objective: 'Run a cancellable generation.',
          publicSummary: 'Preparing cancellable child work.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parent.revision,
        }),
      },
      context,
    );
    const childRunId = spawned.child.childRunId;
    const operation = await seedCancelableGenerationOperation(
      { ...state, context: commanderContext(childRunId), runId: childRunId },
      provider,
    );
    const child = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-cancel-drain.child',
      method: 'run.get',
      input: { runId: childRunId },
    }).result;
    const model = new FakeModelAdapter(
      toolResponse(
        AgentCancelDefinition.id,
        AgentCancelDefinition.parseInput({
          childRunId,
          expectedRevision: child.revision,
          reason: 'Cancel the delegated generation.',
        }),
        'provider-call.runtime.agent-cancel-drain',
      ),
      [FINAL_RESPONSE],
    );
    try {
      await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          onOperationCancellationError: throwOnOperationCancellationError,
          operations: fixture.data.operations,
          deliveryOperations: fixture.data.deliveryOperations,
          resultAssessments: fixture.data.resultAssessments,
          generation: fixture.data.generation,
          mediaDerivations: fixture.data.mediaDerivations,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(provider.cancelCalls).toBe(1);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT state, cancel_requested FROM generation_attempts WHERE id = ?')
          .get(operation.ownerRef.id),
      ).toEqual({ state: 'cancelled', cancel_requested: 1 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('fails agent.cancel before durable settlement when cancellation composition is unavailable', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const parent = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-cancel-preflight.parent',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parent.revision,
        commandId: 'command.runtime.agent-cancel-preflight.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Preflight child',
          objective: 'Remain unchanged when cancellation wiring is incomplete.',
          publicSummary: 'Verifying cancellation composition.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parent.revision,
        }),
      },
      context,
    );
    const childRunId = spawned.child.childRunId;
    const child = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-cancel-preflight.child',
      method: 'run.get',
      input: { runId: childRunId },
    }).result;
    const settleAgentCancelBoundary = vi.fn(fixture.data.harness.settleAgentCancelBoundary);
    const persistence = {
      ...fixture.data.harness,
      settleAgentCancelBoundary,
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        AgentCancelDefinition.id,
        AgentCancelDefinition.parseInput({
          childRunId,
          expectedRevision: child.revision,
          reason: 'This must not commit without the cancellation worker.',
        }),
        'provider-call.runtime.agent-cancel-preflight',
      ),
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        'Operation cancellation drain requires operations, generation, mediaDerivations, resultAssessments, deliveryOperations, onOperationCancellationError',
      );
      expect(settleAgentCancelBoundary).not.toHaveBeenCalled();
      expect(
        fixture.data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.agent-cancel-preflight.child-after',
          method: 'run.get',
          input: { runId: childRunId },
        }).result,
      ).toMatchObject({ id: childRunId, status: 'accepted', revision: child.revision });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('routes every queued owner cancellation and drains past a failed candidate', async () => {
    const candidates = [
      queuedCancellationOperation('generation_attempt', 'generation'),
      queuedCancellationOperation('media_derivation', 'media'),
      queuedCancellationOperation('result_assessment', 'assessment'),
      queuedCancellationOperation('review_cut_attempt', 'review'),
      queuedCancellationOperation('delivery_export', 'export'),
    ];
    const calls: string[] = [];
    const dependencies = {
      operations: {
        listCancellationRequested: () => ({
          operations: candidates,
          nextAfterOperationId: null,
        }),
      },
      generation: {
        async reconcile(input: { readonly operation: OperationRef }) {
          calls.push(input.operation.kind);
          throw new Error('simulated generation cancellation outage');
        },
      },
      mediaDerivations: {
        async continue(input: { readonly dispatchOperationId: string }) {
          calls.push(
            input.dispatchOperationId.includes('.media') ? 'media_derivation' : 'unexpected',
          );
        },
      },
      resultAssessments: {
        async acknowledgeCancellation(input: { readonly operation: OperationRef }) {
          calls.push(input.operation.kind);
        },
      },
      deliveryOperations: {
        async acknowledgeCancellation(input: { readonly operation: OperationRef }) {
          calls.push(input.operation.kind);
        },
      },
    } as unknown as Parameters<typeof drainRequestedOperationCancellations>[0];

    let failure: unknown;
    try {
      await drainRequestedOperationCancellations(dependencies);
    } catch (cause) {
      failure = cause;
    }
    if (!(failure instanceof AggregateError)) throw new Error('Expected a drain AggregateError');
    expect(failure.errors).toHaveLength(1);
    expect(failure.errors[0]).toMatchObject({
      message: 'simulated generation cancellation outage',
    });
    expect(calls).toEqual([
      'generation_attempt',
      'media_derivation',
      'result_assessment',
      'review_cut_attempt',
      'delivery_export',
    ]);
  });

  it('reports an unavailable queued owner authority instead of silently dropping it', async () => {
    const dependencies = {
      operations: {
        listCancellationRequested: () => ({
          operations: [queuedCancellationOperation('media_derivation', 'missing-authority')],
          nextAfterOperationId: null,
        }),
      },
    } as unknown as Parameters<typeof drainRequestedOperationCancellations>[0];

    let failure: unknown;
    try {
      await drainRequestedOperationCancellations(dependencies);
    } catch (cause) {
      failure = cause;
    }
    if (!(failure instanceof AggregateError)) throw new Error('Expected a drain AggregateError');
    expect(failure.errors).toHaveLength(1);
    expect(failure.errors[0]).toMatchObject({
      message: 'Media Derivation cancellation authority is unavailable',
    });
  });

  it('replays a committed operation.cancel boundary without cancelling the owner or Provider twice', async () => {
    const provider = new PendingGenerationProvider();
    const dependencies = {
      ...createJourneyDependencies(),
      generation: provider,
    } satisfies JourneyDependencies;
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, project, runId } = state;
    const operation = await seedCancelableGenerationOperation(state, provider);
    activateAcceptedRuntimeState(state, 'operation-cancel-replay');
    type BoundaryInput = Parameters<
      HarnessPersistenceAuthority['settleOperationCancelBoundary']
    >[0];
    type BoundaryContext = Parameters<
      HarnessPersistenceAuthority['settleOperationCancelBoundary']
    >[1];
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeSettlementRevision: number | null = null;
    let interrupted = false;
    const persistence = {
      ...fixture.data.harness,
      settleOperationCancelBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeSettlementRevision = (
          getJourneyTestDatabase(fixture.store)
            .prepare('SELECT revision FROM runs WHERE id = ?')
            .get(runId) as { readonly revision: number }
        ).revision;
        const committed = fixture.data.harness.settleOperationCancelBoundary(input, commandContext);
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit after operation.cancel settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        OperationCancelDefinition.id,
        OperationCancelDefinition.parseInput({
          operations: [
            {
              ref: operation,
              expectedRevision: operation.revision,
              expectedState: 'submitted',
            },
          ],
        }),
        'provider-call.operation-cancel.replay',
      ),
    );
    const cancellationEvents = () =>
      fixture.data.runs
        .listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.operation-cancel.replay.events',
          method: 'run.events.list',
          input: { runId, afterSequence: null, page: { cursor: null, limit: 200 } },
        })
        .result.items.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' &&
            payloadState.payload.type === 'operation_state_changed' &&
            payloadState.payload.operation.id === operation.id &&
            payloadState.payload.cancelRequested,
        );
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            onOperationCancellationError: throwOnOperationCancellationError,
            operations: fixture.data.operations,
            deliveryOperations: fixture.data.deliveryOperations,
            resultAssessments: fixture.data.resultAssessments,
            generation: fixture.data.generation,
            mediaDerivations: fixture.data.mediaDerivations,
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after operation.cancel settlement');
      if (capturedInput === null || capturedContext === null) {
        throw new Error('Expected the operation.cancel settlement boundary to be captured');
      }
      const committed = fixture.data.harness.loadActivation(runId, 1);
      const dispatch = committed.dispatches.find(
        ({ key }) => key.toolId === OperationCancelDefinition.id,
      );
      if (dispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected the committed operation.cancel Dispatch');
      }
      const cancelled = OperationCancelDefinition.parseSuccess(dispatch.outcome.data)
        .operations[0]!;
      if (beforeSettlementRevision === null) {
        throw new Error('Expected the pre-settlement Run revision to be captured');
      }
      expect(committed.recoveryRequired).toBe(false);
      expect(committed.run.revision).toBe(beforeSettlementRevision + 1);
      expect(cancelled).toMatchObject({ cancelRequested: true, state: 'submitted' });
      expect(cancellationEvents()).toHaveLength(1);
      expect(provider.cancelCalls).toBe(0);

      const call = capturedInput.response.events.find(
        (event) => event.type === 'tool_call' && event.toolId === OperationCancelDefinition.id,
      );
      if (call?.type !== 'tool_call')
        throw new Error('Expected the captured operation.cancel call');
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: capturedInput.attemptId,
            requestHash: capturedInput.requestHash,
            response: capturedInput.response,
            settledAt: capturedInput.settledAt,
            commandId: 'command.operation-cancel.generic-settle',
          },
          capturedContext,
        ),
      ).toThrow('operation.cancel, task.manage, and tool.program require dedicated');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: capturedInput.attemptId,
            providerCallId: call.providerCallId,
            toolId: OperationCancelDefinition.id,
            input: OperationCancelDefinition.parseInput(call.canonicalArguments),
            authorityWatermarkHash: null,
            activationNumber: capturedInput.activationNumber,
            turnNumber: capturedInput.turnNumber,
            stepNumber: capturedInput.stepNumber + 1,
            commandId: 'command.operation-cancel.generic-dispatch',
          },
          capturedContext,
        ),
      ).toThrow('operation.cancel requires its dedicated durable settlement boundary');

      const beforeReplayRows = serializedDatabaseRows(getJourneyTestDatabase(fixture.store));
      const replay = fixture.data.harness.settleOperationCancelBoundary(
        capturedInput,
        capturedContext,
      );
      expect(replay.events).toEqual([]);
      expect(replay.value.dispatch.id).toBe(dispatch.id);
      expect(
        fixture.data.operations.query(project.id, runId, { operations: [cancelled.ref] }),
      ).toEqual({ operations: [cancelled] });
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).toBe(beforeReplayRows);
      expect(cancellationEvents()).toHaveLength(1);
      expect(provider.cancelCalls).toBe(0);
      expect(model.streamed).toHaveLength(1);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rolls back the complete operation.cancel boundary when Run journal settlement fails', async () => {
    const provider = new PendingGenerationProvider();
    const dependencies = {
      ...createJourneyDependencies(),
      generation: provider,
    } satisfies JourneyDependencies;
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, project, runId } = state;
    const operation = await seedCancelableGenerationOperation(state, provider);
    activateAcceptedRuntimeState(state, 'operation-cancel-rollback');
    type BoundaryInput = Parameters<
      HarnessPersistenceAuthority['settleOperationCancelBoundary']
    >[0];
    type BoundaryContext = Parameters<
      HarnessPersistenceAuthority['settleOperationCancelBoundary']
    >[1];
    const database = getJourneyTestDatabase(fixture.store);
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeBoundaryRows: string | null = null;
    const persistence = {
      ...fixture.data.harness,
      settleOperationCancelBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeBoundaryRows = serializedDatabaseRows(database);
        database.exec(`
          CREATE TEMP TRIGGER fail_operation_cancel_boundary
          BEFORE UPDATE ON runs
          BEGIN
            SELECT RAISE(ABORT, 'injected operation.cancel boundary failure');
          END;
        `);
        try {
          return fixture.data.harness.settleOperationCancelBoundary(input, commandContext);
        } finally {
          database.exec('DROP TRIGGER fail_operation_cancel_boundary');
        }
      },
    } satisfies HarnessPersistenceAuthority;
    const model = new FakeModelAdapter(
      toolResponse(
        OperationCancelDefinition.id,
        OperationCancelDefinition.parseInput({
          operations: [
            {
              ref: operation,
              expectedRevision: operation.revision,
              expectedState: 'submitted',
            },
          ],
        }),
        'provider-call.operation-cancel.rollback',
      ),
    );
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
            onOperationCancellationError: throwOnOperationCancellationError,
            operations: fixture.data.operations,
            deliveryOperations: fixture.data.deliveryOperations,
            resultAssessments: fixture.data.resultAssessments,
            generation: fixture.data.generation,
            mediaDerivations: fixture.data.mediaDerivations,
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('injected operation.cancel boundary failure');
      if (capturedInput === null || capturedContext === null || beforeBoundaryRows === null) {
        throw new Error('Expected the failed operation.cancel boundary to be captured');
      }
      expect(serializedDatabaseRows(database)).toBe(beforeBoundaryRows);
      expect(fixture.data.harness.loadActivation(runId, 1)).toMatchObject({
        recoveryRequired: true,
        modelAttempts: [{ state: 'running', response: null }],
      });
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === OperationCancelDefinition.id),
      ).toBe(false);
      const unchanged = fixture.data.operations.query(project.id, runId, {
        operations: [operation],
      }).operations[0]!;
      expect(unchanged).toMatchObject({
        ref: operation,
        state: 'submitted',
        cancelRequested: false,
      });
      expect(provider.cancelCalls).toBe(0);

      const committed = fixture.data.harness.settleOperationCancelBoundary(
        capturedInput,
        capturedContext,
      );
      expect(committed).toMatchObject({
        value: {
          result: {
            operations: [
              {
                ref: { id: operation.id, revision: operation.revision + 1 },
                state: 'submitted',
                cancelRequested: true,
              },
            ],
          },
          dispatch: {
            key: { toolId: OperationCancelDefinition.id },
            outcome: { status: 'succeeded' },
          },
        },
        run: { status: 'running' },
      });
      expect(
        committed.events.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' &&
            payloadState.payload.type === 'operation_state_changed' &&
            payloadState.payload.operation.id === operation.id &&
            payloadState.payload.cancelRequested,
        ),
      ).toHaveLength(1);
      const afterCommitRows = serializedDatabaseRows(database);
      expect(
        fixture.data.harness.settleOperationCancelBoundary(capturedInput, capturedContext).events,
      ).toEqual([]);
      expect(serializedDatabaseRows(database)).toBe(afterCommitRows);
      expect(provider.cancelCalls).toBe(0);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('atomically executes task.manage get, create, and remove before continuing the model loop', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    let removedTaskId: string | undefined;
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        let response: readonly ModelAdapterEvent[];
        if (streamed.length === 0) {
          response = toolResponse(
            TaskManageDefinition.id,
            TaskManageDefinition.parseInput({ action: 'get' }),
            'provider-call.task-manage.get',
          );
        } else if (streamed.length === 1) {
          response = toolResponse(
            TaskManageDefinition.id,
            TaskManageDefinition.parseInput({
              action: 'create',
              expectedRunRevision: request.runRevision,
              title: 'Harbor sequence',
              tasks: [
                {
                  draftId: 'draft.inspect',
                  title: 'Inspect references',
                  parentDraftId: null,
                  order: 0,
                },
              ],
              publicSummary: 'Created the harbor sequence task list.',
            }),
            'provider-call.task-manage.create',
          );
        } else if (streamed.length === 2) {
          const taskList = fixture.data.taskLists.get(runId);
          if (taskList === null || taskList.items[0] === undefined) {
            throw new Error('Expected task.manage create to persist one Task item');
          }
          removedTaskId = taskList.items[0].id;
          response = toolResponse(
            TaskManageDefinition.id,
            TaskManageDefinition.parseInput({
              action: 'remove',
              expectedRevision: taskList.revision,
              taskId: removedTaskId,
              publicSummary: 'Removed the completed inspection task.',
            }),
            'provider-call.task-manage.remove',
          );
        } else {
          response = FINAL_RESPONSE;
        }
        streamed.push(request);
        for (const event of response) yield event;
      },
    };
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected task.manage Run execution');

      const taskList = fixture.data.taskLists.get(runId);
      expect(taskList).toMatchObject({ state: 'completed', revision: 3, items: [] });
      expect(streamed).toHaveLength(4);
      expect(
        streamed.every((request) =>
          request.materializedTools.some(({ id }) => id === TaskManageDefinition.id),
        ),
      ).toBe(true);
      expect(result.snapshot.dispatches).toMatchObject([
        {
          key: { toolId: TaskManageDefinition.id, input: { action: 'get' } },
          outcome: { status: 'succeeded', data: { taskList: null, changedTaskIds: [] } },
        },
        {
          key: { toolId: TaskManageDefinition.id, input: { action: 'create' } },
          outcome: { status: 'succeeded' },
        },
        {
          key: { toolId: TaskManageDefinition.id, input: { action: 'remove' } },
          outcome: {
            status: 'succeeded',
            data: { changedTaskIds: [removedTaskId] },
          },
        },
      ]);
      const taskEvents = fixture.data.runs
        .listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.task-manage.runtime.events',
          method: 'run.events.list',
          input: { runId, afterSequence: null, page: { cursor: null, limit: 200 } },
        })
        .result.items.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' && payloadState.payload.type === 'task_list_changed',
        );
      expect(taskEvents).toMatchObject([
        { payloadState: { payload: { revision: 1 } } },
        { payloadState: { payload: { revision: 2 } } },
        { payloadState: { payload: { revision: 3 } } },
      ]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('replays a committed task.manage boundary without changing the TaskList or journal twice', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleTaskManageBoundary']>[0];
    type BoundaryContext = Parameters<HarnessPersistenceAuthority['settleTaskManageBoundary']>[1];
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let interrupted = false;
    const persistence = {
      ...fixture.data.harness,
      settleTaskManageBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        const committed = fixture.data.harness.settleTaskManageBoundary(input, commandContext);
        if (!interrupted) {
          interrupted = true;
          throw new Error('simulated process exit after task.manage settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    const quoted: CanonicalModelRequestV1[] = [];
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote(request) {
        quoted.push(request);
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          TaskManageDefinition.id,
          TaskManageDefinition.parseInput({
            action: 'create',
            expectedRunRevision: request.runRevision,
            title: 'Crash-safe tasks',
            tasks: [],
            publicSummary: 'Created crash-safe tasks.',
          }),
          'provider-call.task-manage.replay',
        )) {
          yield event;
        }
      },
    };
    const taskEvents = () =>
      fixture.data.runs
        .listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.task-manage.replay.events',
          method: 'run.events.list',
          input: { runId, afterSequence: null, page: { cursor: null, limit: 200 } },
        })
        .result.items.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' && payloadState.payload.type === 'task_list_changed',
        );
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
              throw new Error('task.manage must not reach the generic tool executor');
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after task.manage settlement');
      if (capturedInput === null || capturedContext === null) {
        throw new Error('Expected the task.manage settlement boundary to be captured');
      }
      const committed = fixture.data.harness.loadActivation(runId, 1);
      expect(committed).toMatchObject({
        recoveryRequired: false,
        taskList: { state: 'active', revision: 1, title: 'Crash-safe tasks' },
        dispatches: [
          { key: { toolId: TaskManageDefinition.id }, outcome: { status: 'succeeded' } },
        ],
      });
      expect(taskEvents()).toHaveLength(1);

      const taskCall = capturedInput.response.events.find(
        (event) => event.type === 'tool_call' && event.toolId === TaskManageDefinition.id,
      );
      if (taskCall?.type !== 'tool_call') throw new Error('Expected the captured task.manage call');
      expect(() =>
        fixture.data.harness.settleModelAttempt(
          {
            attemptId: capturedInput.attemptId,
            requestHash: capturedInput.requestHash,
            response: capturedInput.response,
            settledAt: capturedInput.settledAt,
            commandId: 'command.task-manage.generic-settle',
          },
          capturedContext,
        ),
      ).toThrow('task.manage, and tool.program require dedicated durable settlement boundaries');
      expect(() =>
        fixture.data.harness.prepareDispatch(
          {
            runId,
            modelAttemptId: capturedInput.attemptId,
            providerCallId: taskCall.providerCallId,
            toolId: TaskManageDefinition.id,
            input: TaskManageDefinition.parseInput(taskCall.canonicalArguments),
            authorityWatermarkHash: null,
            activationNumber: capturedInput.activationNumber,
            turnNumber: capturedInput.turnNumber,
            stepNumber: capturedInput.stepNumber + 1,
            commandId: 'command.task-manage.generic-dispatch',
          },
          capturedContext,
        ),
      ).toThrow('task.manage requires its dedicated durable settlement boundary');

      const replay = fixture.data.harness.settleTaskManageBoundary(capturedInput, capturedContext);
      expect(replay.events).toEqual([]);
      expect(replay.value.dispatch.id).toBe(committed.dispatches[0]!.id);
      expect(fixture.data.harness.loadActivation(runId, 1).taskList).toEqual(committed.taskList);
      expect(taskEvents()).toHaveLength(1);
      expect(quoted).toHaveLength(1);
      expect(streamed).toHaveLength(1);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rolls back the complete task.manage boundary when Run journal settlement fails', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    type BoundaryInput = Parameters<HarnessPersistenceAuthority['settleTaskManageBoundary']>[0];
    type BoundaryContext = Parameters<HarnessPersistenceAuthority['settleTaskManageBoundary']>[1];
    const database = getJourneyTestDatabase(fixture.store);
    let capturedInput: BoundaryInput | null = null;
    let capturedContext: BoundaryContext | null = null;
    let beforeBoundaryRows: string | null = null;
    const persistence = {
      ...fixture.data.harness,
      settleTaskManageBoundary(input, commandContext) {
        capturedInput = input;
        capturedContext = commandContext;
        beforeBoundaryRows = serializedDatabaseRows(database);
        database.exec(`
          CREATE TEMP TRIGGER fail_task_manage_boundary
          BEFORE UPDATE ON runs
          BEGIN
            SELECT RAISE(ABORT, 'injected task.manage boundary failure');
          END;
        `);
        try {
          return fixture.data.harness.settleTaskManageBoundary(input, commandContext);
        } finally {
          database.exec('DROP TRIGGER fail_task_manage_boundary');
        }
      },
    } satisfies HarnessPersistenceAuthority;
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        for (const event of toolResponse(
          TaskManageDefinition.id,
          TaskManageDefinition.parseInput({
            action: 'create',
            expectedRunRevision: request.runRevision,
            title: 'Rollback-safe tasks',
            tasks: [],
            publicSummary: 'Created rollback-safe tasks.',
          }),
          'provider-call.task-manage.rollback',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
              throw new Error('task.manage must not reach the generic tool executor');
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('injected task.manage boundary failure');
      if (capturedInput === null || capturedContext === null || beforeBoundaryRows === null) {
        throw new Error('Expected the failed task.manage boundary to be captured');
      }
      expect(serializedDatabaseRows(database)).toBe(beforeBoundaryRows);
      expect(fixture.data.harness.loadActivation(runId, 1)).toMatchObject({
        recoveryRequired: true,
        taskList: null,
        modelAttempts: [{ state: 'running', response: null }],
        dispatches: [],
      });

      const committed = fixture.data.harness.settleTaskManageBoundary(
        capturedInput,
        capturedContext,
      );
      expect(committed).toMatchObject({
        value: {
          result: { taskList: { state: 'active', revision: 1, title: 'Rollback-safe tasks' } },
          dispatch: { key: { toolId: TaskManageDefinition.id }, outcome: { status: 'succeeded' } },
        },
        run: { status: 'running' },
      });
      expect(
        committed.events.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' && payloadState.payload.type === 'task_list_changed',
        ),
      ).toHaveLength(1);
      const afterCommitRows = serializedDatabaseRows(database);
      expect(
        fixture.data.harness.settleTaskManageBoundary(capturedInput, capturedContext).events,
      ).toEqual([]);
      expect(serializedDatabaseRows(database)).toBe(afterCommitRows);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('executes one encrypted tool.program child call and returns its canonical outcome to the parent model', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const sentinel = '2037-05-06T07:08:09.000Z';
    const streamed: CanonicalModelRequestV1[] = [];
    const executions: TargetToolExecution[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        const response =
          streamed.length === 0
            ? toolResponse(
                ToolProgramDefinition.id,
                ToolProgramDefinition.parseInput({
                  version: 1,
                  displayName: 'Read bounded message history',
                  expectedRunRevision: request.runRevision,
                  contextRefs: [],
                  steps: [
                    {
                      stepId: 'step.program.history',
                      operation: 'call',
                      invocation: {
                        toolId: HistoryQueryDefinition.id,
                        toolVersion: HistoryQueryDefinition.version,
                        input: {
                          ...HISTORY_QUERY_INPUT,
                          time: { from: sentinel, to: null },
                        },
                      },
                    },
                  ],
                }),
                'provider-call.tool-program',
              )
            : FINAL_RESPONSE;
        streamed.push(request);
        for (const event of response) yield event;
      },
    };
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([HistoryQueryDefinition.id], (execution) => {
            executions.push(execution);
            expect(execution.origin).toMatchObject({
              kind: 'tool_program',
              programStepId: 'step.program.history',
              programCallIndex: 0,
            });
            expect(execution.input).toMatchObject({ time: { from: sentinel, to: null } });
            return HistoryQueryDefinition.parseOutcome({
              status: 'succeeded',
              data: { items: [], nextCursor: null },
            });
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected Tool Program Run execution');

      const finalSnapshot = result.snapshot;
      const parentDispatch = finalSnapshot.dispatches.find(
        ({ key }) => key.toolId === ToolProgramDefinition.id,
      );
      if (parentDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled Tool Program parent dispatch');
      }
      const child = fixture.data.harness.loadToolProgramBoundary(parentDispatch.id).child.child;

      expect(executions).toHaveLength(1);
      expect(child.status).toBe('completed');
      expect(finalSnapshot.run.status).toBe('completed');
      expect(streamed).toHaveLength(2);
      expect(streamed[0]!.materializedTools.map(({ id }) => id)).toEqual([
        AgentCancelDefinition.id,
        AgentResultDefinition.id,
        AgentSendDefinition.id,
        AgentSpawnDefinition.id,
        AgentWaitDefinition.id,
        HistoryQueryDefinition.id,
        InteractionAskDefinition.id,
        OperationCancelDefinition.id,
        SkillProposeDefinition.id,
        TaskManageDefinition.id,
        ToolProgramDefinition.id,
      ]);
      expect(streamed[1]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: ToolProgramDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({
                childCalls: [
                  expect.objectContaining({
                    toolId: HistoryQueryDefinition.id,
                    toolVersion: HistoryQueryDefinition.version,
                    outcomeStatus: 'succeeded',
                    outcome: { status: 'succeeded', data: { items: [], nextCursor: null } },
                  }),
                ],
              }),
            }),
          }),
        ]),
      );
      const database = getJourneyTestDatabase(fixture.store);
      expect(serializedDatabaseRows(database)).not.toContain(sentinel);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects a non-canonical tool.program model input before dispatch persistence', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        const canonicalProgram = ToolProgramDefinition.parseInput({
          version: 1,
          displayName: 'Reject normalized parent input',
          expectedRunRevision: request.runRevision,
          contextRefs: [],
          steps: [
            {
              stepId: 'step.program.non-canonical-parent',
              operation: 'call',
              invocation: {
                toolId: HistoryQueryDefinition.id,
                toolVersion: HistoryQueryDefinition.version,
                input: HISTORY_QUERY_INPUT,
              },
            },
          ],
        });
        for (const event of toolResponse(ToolProgramDefinition.id, {
          ...canonicalProgram,
          displayName: ` ${canonicalProgram.displayName} `,
        })) {
          yield event;
        }
      },
    };
    const executions: TargetToolExecution[] = [];
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: fakeToolExecutor([HistoryQueryDefinition.id], (execution) => {
              executions.push(execution);
              return HistoryQueryDefinition.parseOutcome({
                status: 'succeeded',
                data: { items: [], nextCursor: null },
              });
            }),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Tool tool.program input is not canonical');
      expect(executions).toEqual([]);
      expect(fixture.data.harness.loadActivation(runId, 1).dispatches).toEqual([]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects receipt-aware operation.get as a tool.program child before it can execute', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const toolGetInput = ToolGetDefinition.parseInput({ names: [OperationGetDefinition.id] });
    const operationGetInput = OperationGetDefinition.parseInput(
      OperationGetDefinition.examples.input,
    );
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        const response =
          streamed.length === 0
            ? toolResponse(
                ToolGetDefinition.id,
                toolGetInput,
                'provider-call.tool-get.before-tool-program',
              )
            : toolResponse(
                ToolProgramDefinition.id,
                ToolProgramDefinition.parseInput({
                  version: 1,
                  displayName: 'Poll receipt-aware operation state',
                  expectedRunRevision: request.runRevision,
                  contextRefs: [],
                  steps: [
                    {
                      stepId: 'step.program.operation-get',
                      operation: 'call',
                      invocation: {
                        toolId: OperationGetDefinition.id,
                        toolVersion: OperationGetDefinition.version,
                        input: operationGetInput,
                      },
                    },
                  ],
                }),
                'provider-call.tool-program.operation-get',
              );
        streamed.push(request);
        for (const event of response) yield event;
      },
    };
    const reads = createTargetStorageReadToolExecutor(fixture.data);
    const executions: TargetToolExecution[] = [];
    const executor = fakeToolExecutor(
      reads.toolIds,
      (execution) => {
        executions.push(execution);
        return reads.execute(execution);
      },
      reads.initialToolIds,
    );
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: executor,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${OperationGetDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(2);
      expect(executions.map(({ toolId }) => toolId)).toEqual([ToolGetDefinition.id]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('rejects operation.cancel as a tool.program child before any cancellation can execute', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested cancellation',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.operation-cancel',
                operation: 'call',
                invocation: {
                  toolId: OperationCancelDefinition.id,
                  toolVersion: OperationCancelDefinition.version,
                  input: OperationCancelDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.operation-cancel',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${OperationCancelDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === OperationCancelDefinition.id),
      ).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects interaction.ask as a tool.program child before a question can be persisted', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested question',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.interaction-ask',
                operation: 'call',
                invocation: {
                  toolId: InteractionAskDefinition.id,
                  toolVersion: InteractionAskDefinition.version,
                  input: InteractionAskDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.interaction-ask',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${InteractionAskDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === InteractionAskDefinition.id),
      ).toBe(false);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM run_interactions')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects delivery.freeze as a tool.program child before a Manifest can be created', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested Delivery freeze',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.delivery-freeze',
                operation: 'call',
                invocation: {
                  toolId: DeliveryFreezeDefinition.id,
                  toolVersion: DeliveryFreezeDefinition.version,
                  input: DeliveryFreezeDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.delivery-freeze',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${DeliveryFreezeDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === DeliveryFreezeDefinition.id),
      ).toBe(false);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM delivery_manifests')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects delivery.preview as a tool.program child before an owner can be created', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested Delivery preview',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.delivery-preview',
                operation: 'call',
                invocation: {
                  toolId: DeliveryPreviewDefinition.id,
                  toolVersion: DeliveryPreviewDefinition.version,
                  input: DeliveryPreviewDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.delivery-preview',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${DeliveryPreviewDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === DeliveryPreviewDefinition.id),
      ).toBe(false);
      const database = getJourneyTestDatabase(fixture.store);
      expect(database.prepare('SELECT COUNT(*) AS count FROM review_cut_attempts').get()).toEqual({
        count: 0,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM delivery_manifests').get()).toEqual({
        count: 0,
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects generation.submit as a tool.program child before a Provider owner can be created', async () => {
    const dependencies = createJourneyDependencies();
    const { fixture, context, runId } = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested generation submission',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.generation-submit',
                operation: 'call',
                invocation: {
                  toolId: GenerationSubmitDefinition.id,
                  toolVersion: GenerationSubmitDefinition.version,
                  input: GenerationSubmitDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.generation-submit',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${GenerationSubmitDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === GenerationSubmitDefinition.id),
      ).toBe(false);
      const database = getJourneyTestDatabase(fixture.store);
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_requests').get()).toEqual({
        count: 0,
      });
      expect(database.prepare('SELECT COUNT(*) AS count FROM generation_attempts').get()).toEqual({
        count: 0,
      });
      expect(dependencies.generation.submitCalls).toBe(0);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects media.derive as a tool.program child before a Derivation owner can be created', async () => {
    const dependencies = createJourneyDependencies();
    const { fixture, context, runId } = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested media derivation',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.media-derive',
                operation: 'call',
                invocation: {
                  toolId: MediaDeriveDefinition.id,
                  toolVersion: MediaDeriveDefinition.version,
                  input: MediaDeriveDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.media-derive',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${MediaDeriveDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === MediaDeriveDefinition.id),
      ).toBe(false);
      const database = getJourneyTestDatabase(fixture.store);
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM media_derivation_attempts').get(),
      ).toEqual({ count: 0 });
      expect(dependencies.localDerivation.calls).toHaveLength(0);
      expect(dependencies.transcription.submitCalls).toBe(0);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects media.link as a tool.program child before Project Media can change', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested media link',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.media-link',
                operation: 'call',
                invocation: {
                  toolId: MediaLinkDefinition.id,
                  toolVersion: MediaLinkDefinition.version,
                  input: MediaLinkDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.media-link',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${MediaLinkDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === MediaLinkDefinition.id),
      ).toBe(false);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM project_media_links')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects canvas.mutate as a tool.program child before Canvas can change', async () => {
    const { fixture, context, project, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested Canvas mutation',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.canvas-mutate',
                operation: 'call',
                invocation: {
                  toolId: CanvasMutateDefinition.id,
                  toolVersion: CanvasMutateDefinition.version,
                  input: CanvasMutateDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.canvas-mutate',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${CanvasMutateDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === CanvasMutateDefinition.id),
      ).toBe(false);
      expect(
        fixture.data.canvas.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.tool-program.canvas-mutate.canvas',
          method: 'canvas.get',
          input: { projectId: project.id },
        }).result,
      ).toMatchObject({ revision: 0, placements: [], edges: [] });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects media.attach as a tool.program child before Project Media can change', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        streamed.push(request);
        for (const event of toolResponse(
          ToolProgramDefinition.id,
          ToolProgramDefinition.parseInput({
            version: 1,
            displayName: 'Invalid nested media attachment',
            expectedRunRevision: request.runRevision,
            contextRefs: [],
            steps: [
              {
                stepId: 'step.program.media-attach',
                operation: 'call',
                invocation: {
                  toolId: MediaAttachDefinition.id,
                  toolVersion: MediaAttachDefinition.version,
                  input: MediaAttachDefinition.examples.input,
                },
              },
            ],
          }),
          'provider-call.tool-program.media-attach',
        )) {
          yield event;
        }
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(
        `Tool Program child ${MediaAttachDefinition.id} is not available as a frozen recovery-safe R tool`,
      );
      expect(streamed).toHaveLength(1);
      expect(
        fixture.data.harness
          .loadActivation(runId, 1)
          .dispatches.some(({ key }) => key.toolId === MediaAttachDefinition.id),
      ).toBe(false);
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT COUNT(*) AS count FROM project_media_refs')
          .get(),
      ).toEqual({ count: 0 });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('executes the full bounded tool.program AST with deterministic map and sequential batch semantics', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const streamed: CanonicalModelRequestV1[] = [];
    const executionOrder: string[] = [];
    let activeMap = 0;
    let maximumMap = 0;
    let activeBatch = 0;
    let maximumBatch = 0;
    const queryInput = (limit: number) => ({
      ...HISTORY_QUERY_INPUT,
      page: { cursor: null, limit },
    });
    const programFor = (revision: number) =>
      ToolProgramDefinition.parseInput({
        version: 1,
        displayName: 'Evaluate the complete bounded read AST',
        expectedRunRevision: revision,
        contextRefs: [],
        steps: [
          {
            stepId: 'step.program.call',
            operation: 'call',
            invocation: {
              toolId: HistoryQueryDefinition.id,
              toolVersion: HistoryQueryDefinition.version,
              input: queryInput(1),
            },
          },
          {
            stepId: 'step.program.map',
            operation: 'map',
            concurrency: 2,
            invocations: [2, 3, 4].map((limit) => ({
              toolId: HistoryQueryDefinition.id,
              toolVersion: HistoryQueryDefinition.version,
              input: queryInput(limit),
            })),
          },
          {
            stepId: 'step.program.filter',
            operation: 'filter',
            sourceStepId: 'step.program.map',
            predicate: { field: 'outcome_status', include: ['succeeded'] },
          },
          {
            stepId: 'step.program.sort',
            operation: 'sort',
            sourceStepId: 'step.program.filter',
            key: 'outcome_status',
            direction: 'descending',
          },
          {
            stepId: 'step.program.take',
            operation: 'take',
            sourceStepId: 'step.program.sort',
            count: 1,
          },
          {
            stepId: 'step.program.validate-take',
            operation: 'validate',
            sourceStepId: 'step.program.take',
            rule: { kind: 'maximum_items', maximum: 1 },
          },
          {
            stepId: 'step.program.batch',
            operation: 'batch',
            invocations: [5, 6].map((limit) => ({
              toolId: HistoryQueryDefinition.id,
              toolVersion: HistoryQueryDefinition.version,
              input: queryInput(limit),
            })),
          },
          {
            stepId: 'step.program.validate-batch',
            operation: 'validate',
            sourceStepId: 'step.program.batch',
            rule: { kind: 'all_succeeded' },
          },
          {
            stepId: 'step.program.pending',
            operation: 'call',
            invocation: {
              toolId: HistoryQueryDefinition.id,
              toolVersion: HistoryQueryDefinition.version,
              input: queryInput(7),
            },
          },
        ],
      });
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        const response =
          streamed.length === 0
            ? toolResponse(
                ToolProgramDefinition.id,
                programFor(request.runRevision),
                'provider-call.tool-program.full-ast',
              )
            : FINAL_RESPONSE;
        streamed.push(request);
        for (const event of response) yield event;
      },
    };
    const executor = fakeToolExecutor([HistoryQueryDefinition.id], async (execution) => {
      const input = HistoryQueryDefinition.parseInput(execution.input as Record<string, unknown>);
      const limit = input.page.limit;
      const stepId =
        execution.origin.kind === 'tool_program' ? execution.origin.programStepId : 'direct';
      if (stepId === 'step.program.map') {
        activeMap += 1;
        maximumMap = Math.max(maximumMap, activeMap);
      }
      if (stepId === 'step.program.batch') {
        activeBatch += 1;
        maximumBatch = Math.max(maximumBatch, activeBatch);
      }
      try {
        await new Promise((resolve) => setTimeout(resolve, { 2: 30, 3: 5, 4: 10 }[limit] ?? 1));
        executionOrder.push(`${stepId}/${limit}`);
        if (limit === 3 || limit === 6) {
          return HistoryQueryDefinition.parseOutcome({
            status: 'validation_failed',
            issues: [
              { fieldSegments: ['page', 'limit'], code: 'fixture', message: `Rejected ${limit}` },
            ],
          });
        }
        return HistoryQueryDefinition.parseOutcome({
          status: 'succeeded',
          data: { items: [], nextCursor: null },
        });
      } finally {
        if (stepId === 'step.program.map') activeMap -= 1;
        if (stepId === 'step.program.batch') activeBatch -= 1;
      }
    });

    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: executor,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected Tool Program Run execution');
      const parentDispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === ToolProgramDefinition.id,
      );
      if (parentDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a settled Tool Program parent dispatch');
      }
      const output = ToolProgramDefinition.parseOutcome(parentDispatch.outcome);
      if (output.status !== 'succeeded') throw new Error('Expected Tool Program success envelope');
      const child = fixture.data.harness.loadToolProgramBoundary(parentDispatch.id).child.child;

      expect(maximumMap).toBe(2);
      expect(maximumBatch).toBe(1);
      expect(executionOrder.filter((entry) => entry.startsWith('step.program.batch'))).toEqual([
        'step.program.batch/5',
        'step.program.batch/6',
      ]);
      expect(executionOrder).not.toContain('step.program.pending/7');
      expect(output.data.state).toBe('failed');
      expect(output.data.steps).toEqual([
        { stepId: 'step.program.call', operation: 'call', state: 'succeeded', itemCount: 1 },
        { stepId: 'step.program.map', operation: 'map', state: 'failed', itemCount: 3 },
        { stepId: 'step.program.filter', operation: 'filter', state: 'succeeded', itemCount: 2 },
        { stepId: 'step.program.sort', operation: 'sort', state: 'succeeded', itemCount: 2 },
        { stepId: 'step.program.take', operation: 'take', state: 'succeeded', itemCount: 1 },
        {
          stepId: 'step.program.validate-take',
          operation: 'validate',
          state: 'succeeded',
          itemCount: 1,
        },
        { stepId: 'step.program.batch', operation: 'batch', state: 'failed', itemCount: 2 },
        {
          stepId: 'step.program.validate-batch',
          operation: 'validate',
          state: 'failed',
          itemCount: 2,
        },
        { stepId: 'step.program.pending', operation: 'call', state: 'pending', itemCount: 0 },
      ]);
      expect(
        output.data.childCalls.map(({ stepId, callIndex, outcomeStatus }) => ({
          stepId,
          callIndex,
          outcomeStatus,
        })),
      ).toEqual([
        { stepId: 'step.program.call', callIndex: 0, outcomeStatus: 'succeeded' },
        { stepId: 'step.program.map', callIndex: 0, outcomeStatus: 'succeeded' },
        { stepId: 'step.program.map', callIndex: 1, outcomeStatus: 'validation_failed' },
        { stepId: 'step.program.map', callIndex: 2, outcomeStatus: 'succeeded' },
        { stepId: 'step.program.batch', callIndex: 0, outcomeStatus: 'succeeded' },
        { stepId: 'step.program.batch', callIndex: 1, outcomeStatus: 'validation_failed' },
      ]);
      expect(output.data.blocker).toContain('step.program.validate-batch');
      expect(child.status).toBe('failed');
      expect(result.snapshot.run.status).toBe('completed');
      expect(streamed).toHaveLength(2);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('recovers a partial tool.program map and retries only its unsettled safe child calls', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    let streamCount = 0;
    const executionCounts = new Map<number, number>();
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        const response =
          streamCount++ === 0
            ? toolResponse(
                ToolProgramDefinition.id,
                ToolProgramDefinition.parseInput({
                  version: 1,
                  displayName: 'Recover a partially settled history map',
                  expectedRunRevision: request.runRevision,
                  contextRefs: [],
                  steps: [
                    {
                      stepId: 'step.program.recover',
                      operation: 'map',
                      concurrency: 1,
                      invocations: [1, 2, 3].map((limit) => ({
                        toolId: HistoryQueryDefinition.id,
                        toolVersion: HistoryQueryDefinition.version,
                        input: {
                          ...HISTORY_QUERY_INPUT,
                          page: { cursor: null, limit },
                        },
                      })),
                    },
                  ],
                }),
                'provider-call.tool-program.recover',
              )
            : FINAL_RESPONSE;
        for (const event of response) yield event;
      },
    };
    const executor = fakeToolExecutor([HistoryQueryDefinition.id], (execution) => {
      const { limit } = HistoryQueryDefinition.parseInput(
        execution.input as Record<string, unknown>,
      ).page;
      const count = (executionCounts.get(limit) ?? 0) + 1;
      executionCounts.set(limit, count);
      if (limit === 2 && count === 1) throw new Error('simulated safe child executor fault');
      return HistoryQueryDefinition.parseOutcome({
        status: 'succeeded',
        data: { items: [], nextCursor: null },
      });
    });
    try {
      await expect(
        runTargetActivation(
          { persistence: fixture.data.harness, model, toolExecutor: executor },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated safe child executor fault');

      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: executor,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (resumed.kind !== 'executed') throw new Error('Expected recovered Tool Program execution');

      const parentDispatch = resumed.snapshot.dispatches.find(
        ({ key }) => key.toolId === ToolProgramDefinition.id,
      );
      if (parentDispatch === undefined) throw new Error('Expected recovered parent dispatch');
      const boundary = fixture.data.harness.loadToolProgramBoundary(parentDispatch.id);
      const child = boundary.child.child;
      const output = ToolProgramDefinition.parseOutcome(parentDispatch.outcome);
      if (output.status !== 'succeeded') throw new Error('Expected recovered Tool Program outcome');
      expect([...executionCounts.entries()]).toEqual([
        [1, 1],
        [2, 2],
        [3, 1],
      ]);
      expect(
        output.data.childCalls.map(({ callIndex, outcomeStatus }) => ({
          callIndex,
          outcomeStatus,
        })),
      ).toEqual([
        { callIndex: 0, outcomeStatus: 'succeeded' },
        { callIndex: 1, outcomeStatus: 'succeeded' },
        { callIndex: 2, outcomeStatus: 'succeeded' },
      ]);
      expect(child.status).toBe('completed');
      expect(resumed.snapshot.run.status).toBe('completed');
      expect(resumed.snapshot.recoveryRequired).toBe(false);
      expect(streamCount).toBe(2);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('preserves settled tool.program results and cancels only prepared pending calls', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    let streamCount = 0;
    const executionOrder: number[] = [];
    const model: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote() {
        return USAGE;
      },
      async *stream(request) {
        const response =
          streamCount++ === 0
            ? toolResponse(
                ToolProgramDefinition.id,
                ToolProgramDefinition.parseInput({
                  version: 1,
                  displayName: 'Cancel a partially settled history map',
                  expectedRunRevision: request.runRevision,
                  contextRefs: [],
                  steps: [
                    {
                      stepId: 'step.program.cancel-map',
                      operation: 'map',
                      concurrency: 1,
                      invocations: [1, 2, 3].map((limit) => ({
                        toolId: HistoryQueryDefinition.id,
                        toolVersion: HistoryQueryDefinition.version,
                        input: {
                          ...HISTORY_QUERY_INPUT,
                          page: { cursor: null, limit },
                        },
                      })),
                    },
                    {
                      stepId: 'step.program.cancel-pending',
                      operation: 'call',
                      invocation: {
                        toolId: HistoryQueryDefinition.id,
                        toolVersion: HistoryQueryDefinition.version,
                        input: {
                          ...HISTORY_QUERY_INPUT,
                          page: { cursor: null, limit: 4 },
                        },
                      },
                    },
                  ],
                }),
                'provider-call.tool-program.cancel-map',
              )
            : FINAL_RESPONSE;
        for (const event of response) yield event;
      },
    };
    const executor = fakeToolExecutor([HistoryQueryDefinition.id], (execution) => {
      const { limit } = HistoryQueryDefinition.parseInput(
        execution.input as Record<string, unknown>,
      ).page;
      executionOrder.push(limit);
      if (limit === 2) {
        const child = fixture.data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.tool-program.cancel-map.child',
          method: 'run.get',
          input: { runId: execution.runId },
        }).result;
        fixture.data.runs.terminalize(
          {
            runId: child.id,
            expectedRevision: child.revision,
            status: 'cancelled',
            summary: 'The Tool Program was cancelled during its map.',
            resultIds: [],
            commandId: 'command.runtime.tool-program.cancel-map.child',
          },
          commanderContext(child.id),
        );
      }
      return HistoryQueryDefinition.parseOutcome({
        status: 'succeeded',
        data: { items: [], nextCursor: null },
      });
    });

    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: executor,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected cancelled Tool Program execution');
      const parentDispatch = result.snapshot.dispatches.find(
        ({ key }) => key.toolId === ToolProgramDefinition.id,
      );
      if (parentDispatch === undefined) throw new Error('Expected Tool Program parent dispatch');
      const output = ToolProgramDefinition.parseOutcome(parentDispatch.outcome);
      if (output.status !== 'succeeded') throw new Error('Expected Tool Program success envelope');
      const child = fixture.data.harness.loadToolProgramBoundary(parentDispatch.id).child.child;

      expect(executionOrder).toEqual([1, 2]);
      expect(output.data.state).toBe('cancelled');
      expect(output.data.steps).toEqual([
        {
          stepId: 'step.program.cancel-map',
          operation: 'map',
          state: 'cancelled',
          itemCount: 3,
        },
        {
          stepId: 'step.program.cancel-pending',
          operation: 'call',
          state: 'pending',
          itemCount: 0,
        },
      ]);
      expect(
        output.data.childCalls.map(({ callIndex, outcomeStatus }) => ({
          callIndex,
          outcomeStatus,
        })),
      ).toEqual([
        { callIndex: 0, outcomeStatus: 'succeeded' },
        { callIndex: 1, outcomeStatus: 'cancelled' },
        { callIndex: 2, outcomeStatus: 'cancelled' },
      ]);
      expect(child.status).toBe('cancelled');
      expect(result.snapshot.run.status).toBe('completed');
      expect(streamCount).toBe(2);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 120_000);

  it('settles a model agent.spawn and reloads parent-only private spawn objectives before the next model turn', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const objective = 'SENTINEL_RUNTIME_AGENT_SPAWN_PRIVATE_OBJECTIVE';
    const streamed: CanonicalModelRequestV1[] = [];
    const streamedPrivateContexts: PrivateModelContext[] = [];
    const quotedPrivateContexts: PrivateModelContext[] = [];
    const parentModel: TargetModelAdapter = {
      provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
      async quote(_request, privateContext) {
        quotedPrivateContexts.push(privateContext);
        return USAGE;
      },
      async *stream(request, privateContext) {
        const response =
          streamed.length === 0
            ? toolResponse(
                AgentSpawnDefinition.id,
                AgentSpawnDefinition.parseInput({
                  displayName: 'Private runtime child',
                  objective,
                  publicSummary: 'Delegating a private child objective.',
                  contextRefs: [],
                  toolAllowlist: null,
                  permissionCeiling: null,
                  budgetCaps: null,
                  expectedParentRevision: request.runRevision,
                }),
                'provider-call.runtime.agent-spawn',
              )
            : toolResponse(
                SkillProposeDefinition.id,
                SkillProposeDefinition.parseInput({
                  name: 'Private child follow-up',
                  description: 'Wait for the delegated child before finalizing.',
                  content: 'Use the child result before completing the parent Run.',
                }),
                'provider-call.runtime.agent-spawn.follow-up',
              );
        streamed.push(request);
        streamedPrivateContexts.push(privateContext);
        for (const event of response) yield event;
      },
    };
    try {
      const parentSnapshot = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model: parentModel,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('agent.spawn must not reach the generic tool executor');
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      const spawnDispatch = parentSnapshot.dispatches.find(
        ({ key }) => key.toolId === AgentSpawnDefinition.id,
      );
      if (spawnDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a successful durable agent.spawn dispatch');
      }
      const childRunId = AgentSpawnDefinition.parseSuccess(spawnDispatch.outcome.data).child
        .childRunId;
      const objectiveHash = sha256(objective);

      expect(parentSnapshot.run.status).toBe('waiting_confirmation');
      expect(streamed).toHaveLength(2);
      expect(quotedPrivateContexts).toEqual(streamedPrivateContexts);
      expect(streamedPrivateContexts[0]).toEqual({ parentDirections: [], spawnObjectives: [] });
      expect(streamedPrivateContexts[1]).toEqual({
        parentDirections: [],
        spawnObjectives: [
          expect.objectContaining({
            type: 'spawn_objective',
            dispatchOperationId: spawnDispatch.id,
            childRunId,
            objectiveHash,
            objective,
          }),
        ],
      });
      expect(JSON.stringify(streamed[1])).not.toContain(objective);
      expect(JSON.stringify(streamed[1]!.facts)).toContain(objectiveHash);

      const childModel = new FakeModelAdapter(FINAL_RESPONSE);
      const childResult = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: childModel,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('The child final response must not execute a tool');
          }),
        },
        {
          runId: childRunId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context: commanderContext(childRunId),
        },
      );
      expect(childResult).toMatchObject({
        kind: 'executed',
        runId: childRunId,
        snapshot: { run: { status: 'completed' } },
      });
      expect(childModel.streamedPrivateContexts).toEqual([
        {
          parentDirections: [
            expect.objectContaining({
              type: 'parent_direction',
              parentRunId: runId,
              directionHash: objectiveHash,
              objective,
            }),
          ],
          spawnObjectives: [],
        },
      ]);

      const database = getJourneyTestDatabase(fixture.store);
      expect(serializedDatabaseRows(database)).not.toContain(objective);
      expect(
        JSON.stringify(
          database
            .prepare(
              `SELECT request_v1_json, response_v1_json
               FROM model_attempts
               WHERE run_id IN (?, ?)`,
            )
            .all(runId, childRunId),
        ),
      ).not.toContain(objective);
      expect(
        JSON.stringify(
          database
            .prepare('SELECT input_v1_json, outcome_v1_json FROM dispatch_operations WHERE id = ?')
            .get(spawnDispatch.id),
        ),
      ).not.toContain(objective);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('settles agent.send privately, resumes its parent after a pre-model crash, and delivers it only to the child', async () => {
    const { fixture, context, inbox, runId } = await acceptedRuntimeFixture();
    const direction = 'SENTINEL_RUNTIME_AGENT_SEND_PRIVATE_DIRECTION';
    const getRun = (id: string, suffix: string) =>
      fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: `request.runtime.agent-send.${suffix}`,
        method: 'run.get',
        input: { runId: id },
      }).result;
    const parentBeforeChild = getRun(runId, 'parent-before-child');
    const child = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parentBeforeChild.revision,
        commandId: 'command.runtime.agent-send.child.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Agent send target',
          objective: 'Complete the initial private child direction first.',
          publicSummary: 'Preparing a child for one private follow-up.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parentBeforeChild.revision,
        }),
      },
      context,
    ).child;
    const childContext = commanderContext(child.childRunId);
    const childInitialInbox = fixture.data.runs.listInbox(child.childRunId)[0]!;
    try {
      let childRun = getRun(child.childRunId, 'child-before-initial-delivery');
      fixture.data.runs.transitionInbox(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          inboxMessageId: childInitialInbox.id,
          sequence: childInitialInbox.sequence,
          action: 'deliver',
          commandId: 'command.runtime.agent-send.child.initial-deliver',
        },
        childContext,
      );
      childRun = getRun(child.childRunId, 'child-before-initial-activation');
      fixture.data.runs.startActivation(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          commandId: 'command.runtime.agent-send.child.initial-activate',
        },
        childContext,
      );
      childRun = getRun(child.childRunId, 'child-before-initial-consume');
      fixture.data.harness.consumeInbox(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          inboxMessageId: childInitialInbox.id,
          sequence: childInitialInbox.sequence,
          commandId: 'command.runtime.agent-send.child.initial-consume',
        },
        childContext,
      );
      childRun = getRun(child.childRunId, 'child-before-initial-end');
      fixture.data.runs.endActivation(
        {
          runId: child.childRunId,
          expectedRevision: childRun.revision,
          activationNumber: 1,
          reason: 'safe_boundary',
          commandId: 'command.runtime.agent-send.child.initial-end',
        },
        childContext,
      );
      const readyChild = getRun(child.childRunId, 'child-ready-for-send');

      let parentRun = getRun(runId, 'parent-before-delivery');
      fixture.data.runs.transitionInbox(
        {
          runId,
          expectedRevision: parentRun.revision,
          inboxMessageId: inbox.id,
          sequence: inbox.sequence,
          action: 'deliver',
          commandId: 'command.runtime.agent-send.parent-deliver',
        },
        context,
      );
      parentRun = getRun(runId, 'parent-before-activation');
      fixture.data.runs.startActivation(
        {
          runId,
          expectedRevision: parentRun.revision,
          commandId: 'command.runtime.agent-send.parent-activate',
        },
        context,
      );

      const parentPrivateContexts: PrivateModelContext[] = [];
      const parentRequests: CanonicalModelRequestV1[] = [];
      let quoteCount = 0;
      const crashAfterSendModel: TargetModelAdapter = {
        provider: { providerId: PROVIDER_ID, model: PROVIDER_MODEL, reasoningStrength: null },
        async quote(_request, privateContext) {
          parentPrivateContexts.push(privateContext);
          quoteCount += 1;
          if (quoteCount === 2) throw new Error('simulated crash after agent.send settlement');
          return USAGE;
        },
        async *stream(request) {
          parentRequests.push(request);
          for (const event of toolResponse(
            AgentSendDefinition.id,
            AgentSendDefinition.parseInput({
              childRunId: child.childRunId,
              expectedChildRevision: readyChild.revision,
              message: direction,
              contextRefs: [],
            }),
            'provider-call.runtime.agent-send',
          )) {
            yield event;
          }
        },
      };
      const noGenericExecution = fakeToolExecutor(STORAGE_READ_IDS, () => {
        throw new Error('agent.send must not reach the generic tool executor');
      });

      await expect(
        runTargetActivation(
          {
            persistence: fixture.data.harness,
            model: crashAfterSendModel,
            toolExecutor: noGenericExecution,
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated crash after agent.send settlement');

      const afterSend = fixture.data.harness.loadActivation(runId, 1);
      const sendDispatch = afterSend.dispatches.find(
        ({ key }) => key.toolId === AgentSendDefinition.id,
      );
      if (sendDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a successful durable agent.send dispatch');
      }
      const sent = AgentSendDefinition.parseSuccess(sendDispatch.outcome.data);
      expect(afterSend.recoveryRequired).toBe(false);
      expect(parentPrivateContexts).toEqual([
        { parentDirections: [], spawnObjectives: [] },
        {
          parentDirections: [],
          spawnObjectives: [],
          sentDirections: [
            expect.objectContaining({
              dispatchOperationId: sendDispatch.id,
              childRunId: child.childRunId,
              directionHash: sha256(direction),
              message: direction,
            }),
          ],
        },
      ]);
      expect(parentRequests[0]!.materializedTools.map(({ id }) => id)).toContain(
        AgentSendDefinition.id,
      );
      expect(
        fixture.data.harness.materializePrivateModelContext(child.childRunId),
      ).not.toMatchObject({
        parentDirections: expect.arrayContaining([
          expect.objectContaining({ inboxMessageId: sent.inboxMessageId, message: direction }),
        ]),
      });
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).not.toContain(
        direction,
      );

      const resumedModel = new FakeModelAdapter(FINAL_RESPONSE);
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model: resumedModel,
            toolExecutor: noGenericExecution,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow(`Run ${runId} has a nonterminal descendant: ${child.childRunId}`);
      expect(resumedModel.streamed).toHaveLength(1);
      expect(resumedModel.streamedPrivateContexts).toEqual([
        expect.objectContaining({
          sentDirections: [expect.objectContaining({ message: direction })],
        }),
      ]);
      expect(resumedModel.streamed[0]!.materializedTools.map(({ id }) => id)).toContain(
        AgentSendDefinition.id,
      );

      const childModel = new FakeModelAdapter(FINAL_RESPONSE);
      const childResult = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: childModel,
          toolExecutor: noGenericExecution,
        },
        {
          runId: child.childRunId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context: childContext,
        },
      );
      expect(childResult).toMatchObject({
        kind: 'executed',
        runId: child.childRunId,
        activationNumber: sent.activationNumber,
        snapshot: { run: { status: 'completed' } },
      });
      expect(childModel.streamedPrivateContexts).toEqual([
        expect.objectContaining({
          parentDirections: expect.arrayContaining([
            expect.objectContaining({
              inboxMessageId: sent.inboxMessageId,
              parentRunId: runId,
              directionHash: sha256(direction),
              message: direction,
            }),
          ]),
        }),
      ]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('settles agent.result atomically and resumes the parent after a post-settlement crash', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const childObjective = 'SENTINEL_AGENT_RESULT_PRIVATE_OBJECTIVE_DO_NOT_PERSIST';
    const parent = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-result.parent',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parent.revision,
        commandId: 'command.runtime.agent-result.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Terminal result child',
          objective: childObjective,
          publicSummary: 'Producing one public terminal result.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parent.revision,
        }),
      },
      context,
    );
    const childRunId = spawned.child.childRunId;
    const childContext = commanderContext(childRunId);
    const noGenericExecution = fakeToolExecutor(STORAGE_READ_IDS, () => {
      throw new Error('agent.result must not reach the generic tool executor');
    });
    try {
      const childModel = new FakeModelAdapter(FINAL_RESPONSE);
      const childResult = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: childModel,
          toolExecutor: noGenericExecution,
        },
        {
          runId: childRunId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context: childContext,
        },
      );
      expect(childResult).toMatchObject({
        kind: 'executed',
        snapshot: { run: { id: childRunId, status: 'completed' } },
      });

      const resultInput = AgentResultDefinition.parseInput({ childRunIds: [childRunId] });
      let quoteCount = 0;
      const crashAfterResultModel = new FakeModelAdapter(
        toolResponse(AgentResultDefinition.id, resultInput, 'provider-call.runtime.agent-result'),
        [FINAL_RESPONSE],
        undefined,
        () => {
          quoteCount += 1;
          if (quoteCount === 2) throw new Error('simulated crash after agent.result settlement');
        },
      );
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model: crashAfterResultModel,
            toolExecutor: noGenericExecution,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated crash after agent.result settlement');

      const afterResult = fixture.data.harness.loadActivation(runId, 1);
      expect(afterResult.recoveryRequired).toBe(false);
      const resultDispatch = afterResult.dispatches.find(
        ({ key }) => key.toolId === AgentResultDefinition.id,
      );
      if (resultDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a successful durable agent.result dispatch');
      }
      expect(AgentResultDefinition.parseSuccess(resultDispatch.outcome.data)).toEqual({
        children: [
          expect.objectContaining({
            child: expect.objectContaining({ childRunId, state: 'completed' }),
            displayName: 'Terminal result child',
            summary: 'The read completed.',
            resultRefs: [],
            artifacts: [],
            blockers: [],
            usage: {
              costUsd: { state: 'known', value: '0.5', currency: 'USD' },
              generationCount: { state: 'known', value: 0 },
              inputTokens: { state: 'known', value: 120 },
              outputTokens: { state: 'known', value: 24 },
            },
          }),
        ],
      });
      expect(crashAfterResultModel.streamed[0]!.materializedTools.map(({ id }) => id)).toContain(
        AgentResultDefinition.id,
      );
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).not.toContain(
        childObjective,
      );

      const resumedModel = new FakeModelAdapter(FINAL_RESPONSE);
      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: resumedModel,
          toolExecutor: noGenericExecution,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      expect(resumed).toMatchObject({
        kind: 'executed',
        snapshot: { run: { id: runId, status: 'completed' } },
      });
      expect(resumedModel.streamed).toHaveLength(1);
      expect(resumedModel.streamed[0]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: AgentResultDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({
                children: [
                  expect.objectContaining({
                    child: expect.objectContaining({ childRunId, state: 'completed' }),
                    summary: 'The read completed.',
                  }),
                ],
              }),
            }),
          }),
        ]),
      );
      expect(JSON.stringify(resumedModel.streamed[0])).not.toContain(childObjective);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('re-enters an open agent.wait before generic recovery and resumes after its requested child completes', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const childObjective = 'SENTINEL_AGENT_WAIT_OPEN_PRIVATE_OBJECTIVE_DO_NOT_PERSIST';
    const parent = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-wait-open.parent',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parent.revision,
        commandId: 'command.runtime.agent-wait-open.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Open wait child',
          objective: childObjective,
          publicSummary: 'Preparing the child work that the parent will wait for.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parent.revision,
        }),
      },
      context,
    );
    const childRunId = spawned.child.childRunId;
    const waitInput = AgentWaitDefinition.parseInput({
      childRunIds: [childRunId],
      condition: 'any_terminal',
      timeoutMs: null,
    });
    const noGenericExecution = fakeToolExecutor(STORAGE_READ_IDS, () => {
      throw new Error('agent.wait must not reach the generic tool executor');
    });
    const crashAfterWaitStart: HarnessPersistenceAuthority = {
      ...fixture.data.harness,
      loadAgentWaitBoundary() {
        throw new Error('simulated crash after agent.wait start');
      },
    };
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: crashAfterWaitStart,
            model: new FakeModelAdapter(
              toolResponse(
                AgentWaitDefinition.id,
                waitInput,
                'provider-call.runtime.agent-wait-open',
              ),
            ),
            toolExecutor: noGenericExecution,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated crash after agent.wait start');

      const afterStart = fixture.data.harness.loadActivation(runId, 1);
      const openWait = afterStart.dispatches.find(
        ({ key }) => key.toolId === AgentWaitDefinition.id,
      );
      expect(afterStart.recoveryRequired).toBe(true);
      expect(openWait).toMatchObject({ outcome: null });
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).not.toContain(
        childObjective,
      );

      const childResult = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: new FakeModelAdapter(FINAL_RESPONSE),
          toolExecutor: noGenericExecution,
        },
        {
          runId: childRunId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context: commanderContext(childRunId),
        },
      );
      expect(childResult).toMatchObject({
        kind: 'executed',
        snapshot: { run: { id: childRunId, status: 'completed' } },
      });

      const resumedModel = new FakeModelAdapter(FINAL_RESPONSE);
      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: resumedModel,
          toolExecutor: noGenericExecution,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      expect(resumed).toMatchObject({
        kind: 'executed',
        snapshot: { run: { id: runId, status: 'completed' } },
      });
      expect(resumedModel.streamed[0]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: AgentWaitDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({ timedOut: false }),
            }),
          }),
        ]),
      );
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('stops a recovered open agent.wait without settlement when its parent ends during polling', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const parent = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-wait-parent-end.parent',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parent.revision,
        commandId: 'command.runtime.agent-wait-parent-end.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Cancelled parent wait child',
          objective: 'Remain active while the parent is cancelled.',
          publicSummary: 'Waiting while the parent is active.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parent.revision,
        }),
      },
      context,
    );
    const waitInput = AgentWaitDefinition.parseInput({
      childRunIds: [spawned.child.childRunId],
      condition: 'any_terminal',
      timeoutMs: null,
    });
    let cancellationCount = 0;
    let settlementCount = 0;
    const cancelDuringWait: HarnessPersistenceAuthority = {
      ...fixture.data.harness,
      loadAgentWaitBoundary(dispatchOperationId) {
        if (cancellationCount === 0) {
          const childRunId = spawned.child.childRunId;
          const currentChild = fixture.data.runs.get({
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.runtime.agent-wait-parent-end.child-current',
            method: 'run.get',
            input: { runId: childRunId },
          }).result;
          fixture.data.runs.terminalize(
            {
              runId: childRunId,
              expectedRevision: currentChild.revision,
              status: 'cancelled',
              summary: 'The delegated child was cancelled with its parent.',
              resultIds: [],
              commandId: 'command.runtime.agent-wait-parent-end.cancel-child',
            },
            commanderContext(childRunId),
          );
          const current = fixture.data.runs.get({
            wireVersion: 1,
            kind: 'request',
            requestId: 'request.runtime.agent-wait-parent-end.current',
            method: 'run.get',
            input: { runId },
          }).result;
          fixture.data.runs.terminalize(
            {
              runId,
              expectedRevision: current.revision,
              status: 'cancelled',
              summary: 'The parent was cancelled while waiting.',
              resultIds: [],
              commandId: 'command.runtime.agent-wait-parent-end.cancel',
            },
            context,
          );
          cancellationCount += 1;
        }
        return fixture.data.harness.loadAgentWaitBoundary(dispatchOperationId);
      },
      settleAgentWaitBoundary(input, settlementContext) {
        settlementCount += 1;
        return fixture.data.harness.settleAgentWaitBoundary(input, settlementContext);
      },
    };
    const initialModel = new FakeModelAdapter(
      toolResponse(
        AgentWaitDefinition.id,
        waitInput,
        'provider-call.runtime.agent-wait-parent-end',
      ),
    );
    const crashAfterWaitStart: HarnessPersistenceAuthority = {
      ...fixture.data.harness,
      loadAgentWaitBoundary() {
        throw new Error('simulated crash before recovered parent cancellation');
      },
    };
    const noGenericExecution = fakeToolExecutor(STORAGE_READ_IDS, () => {
      throw new Error('agent.wait must not reach the generic tool executor');
    });
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: crashAfterWaitStart,
            model: initialModel,
            toolExecutor: noGenericExecution,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated crash before recovered parent cancellation');

      const resumedModel = new FakeModelAdapter(FINAL_RESPONSE);
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: cancelDuringWait,
          model: resumedModel,
          toolExecutor: noGenericExecution,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      expect(result).toMatchObject({
        kind: 'executed',
        snapshot: {
          run: { id: runId, status: 'cancelled' },
          activation: { state: 'ended' },
        },
      });
      expect(cancellationCount).toBe(1);
      expect(settlementCount).toBe(0);
      expect(initialModel.streamed).toHaveLength(1);
      expect(resumedModel.quoted).toEqual([]);
      expect(resumedModel.streamed).toEqual([]);
      const waitDispatch = fixture.data.harness
        .loadActivation(runId, 1)
        .dispatches.find(({ key }) => key.toolId === AgentWaitDefinition.id);
      expect(waitDispatch).toMatchObject({ outcome: null });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('settles agent.wait before a post-settlement crash and resumes its parent with the durable result', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const childObjective = 'SENTINEL_AGENT_WAIT_SETTLED_PRIVATE_OBJECTIVE_DO_NOT_PERSIST';
    const parent = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-wait-settled.parent',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parent.revision,
        commandId: 'command.runtime.agent-wait-settled.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Settled wait child',
          objective: childObjective,
          publicSummary: 'Producing the terminal state needed by the wait.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parent.revision,
        }),
      },
      context,
    );
    const childRunId = spawned.child.childRunId;
    const noGenericExecution = fakeToolExecutor(STORAGE_READ_IDS, () => {
      throw new Error('agent.wait must not reach the generic tool executor');
    });
    try {
      await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: new FakeModelAdapter(FINAL_RESPONSE),
          toolExecutor: noGenericExecution,
        },
        {
          runId: childRunId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context: commanderContext(childRunId),
        },
      );
      const waitInput = AgentWaitDefinition.parseInput({
        childRunIds: [childRunId],
        condition: 'any_terminal',
        timeoutMs: null,
      });
      let quoteCount = 0;
      const crashAfterWaitModel = new FakeModelAdapter(
        toolResponse(AgentWaitDefinition.id, waitInput, 'provider-call.runtime.agent-wait-settled'),
        [FINAL_RESPONSE],
        undefined,
        () => {
          quoteCount += 1;
          if (quoteCount === 2) throw new Error('simulated crash after agent.wait settlement');
        },
      );
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model: crashAfterWaitModel,
            toolExecutor: noGenericExecution,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated crash after agent.wait settlement');

      const afterWait = fixture.data.harness.loadActivation(runId, 1);
      const waitDispatch = afterWait.dispatches.find(
        ({ key }) => key.toolId === AgentWaitDefinition.id,
      );
      if (waitDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a successful durable agent.wait dispatch');
      }
      expect(afterWait.recoveryRequired).toBe(false);
      expect(AgentWaitDefinition.parseSuccess(waitDispatch.outcome.data)).toMatchObject({
        timedOut: false,
        children: [
          {
            child: expect.objectContaining({ childRunId, state: 'completed' }),
          },
        ],
      });
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).not.toContain(
        childObjective,
      );

      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: new FakeModelAdapter(FINAL_RESPONSE),
          toolExecutor: noGenericExecution,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      expect(resumed).toMatchObject({
        kind: 'executed',
        snapshot: { run: { id: runId, status: 'completed' } },
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('settles agent.cancel atomically and resumes the parent after a post-settlement crash', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const childObjective = 'SENTINEL_AGENT_CANCEL_PRIVATE_OBJECTIVE_DO_NOT_PERSIST';
    const parent = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-cancel.parent',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parent.revision,
        commandId: 'command.runtime.agent-cancel.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Cancellable child',
          objective: childObjective,
          publicSummary: 'Preparing cancellable delegated work.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parent.revision,
        }),
      },
      context,
    );
    const childRunId = spawned.child.childRunId;
    const child = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.agent-cancel.child',
      method: 'run.get',
      input: { runId: childRunId },
    }).result;
    const reason = 'The parent changed direction.';
    const cancelInput = AgentCancelDefinition.parseInput({
      childRunId,
      expectedRevision: child.revision,
      reason,
    });
    let quoteCount = 0;
    const crashAfterCancelModel = new FakeModelAdapter(
      toolResponse(AgentCancelDefinition.id, cancelInput, 'provider-call.runtime.agent-cancel'),
      [FINAL_RESPONSE],
      undefined,
      () => {
        quoteCount += 1;
        if (quoteCount === 2) throw new Error('simulated crash after agent.cancel settlement');
      },
    );
    const noGenericExecution = fakeToolExecutor(STORAGE_READ_IDS, () => {
      throw new Error('agent.cancel must not reach the generic tool executor');
    });
    try {
      await expect(
        coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model: crashAfterCancelModel,
            toolExecutor: noGenericExecution,
            onOperationCancellationError: throwOnOperationCancellationError,
            operations: fixture.data.operations,
            deliveryOperations: fixture.data.deliveryOperations,
            resultAssessments: fixture.data.resultAssessments,
            generation: fixture.data.generation,
            mediaDerivations: fixture.data.mediaDerivations,
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated crash after agent.cancel settlement');

      const afterCancel = fixture.data.harness.loadActivation(runId, 1);
      expect(afterCancel.recoveryRequired).toBe(false);
      const cancelDispatch = afterCancel.dispatches.find(
        ({ key }) => key.toolId === AgentCancelDefinition.id,
      );
      if (cancelDispatch?.outcome?.status !== 'succeeded') {
        throw new Error('Expected a successful durable agent.cancel dispatch');
      }
      expect(AgentCancelDefinition.parseSuccess(cancelDispatch.outcome.data)).toEqual({
        children: [
          expect.objectContaining({
            child: expect.objectContaining({ childRunId, state: 'cancelled' }),
            displayName: 'Cancellable child',
            summary: reason,
          }),
        ],
        retainedArtifactCount: 0,
        unknownOperationCount: 0,
      });
      expect(fixture.data.runs.listInbox(childRunId)).toEqual([
        expect.objectContaining({ state: 'cancelled' }),
      ]);
      expect(crashAfterCancelModel.streamed[0]!.materializedTools.map(({ id }) => id)).toContain(
        AgentCancelDefinition.id,
      );
      expect(serializedDatabaseRows(getJourneyTestDatabase(fixture.store))).not.toContain(
        childObjective,
      );

      const resumedModel = new FakeModelAdapter(FINAL_RESPONSE);
      const resumed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: resumedModel,
          toolExecutor: noGenericExecution,
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      expect(resumed).toMatchObject({
        kind: 'executed',
        snapshot: { run: { id: runId, status: 'completed' } },
      });
      expect(resumedModel.streamed).toHaveLength(1);
      expect(resumedModel.streamed[0]!.facts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_result',
            toolId: AgentCancelDefinition.id,
            outcome: expect.objectContaining({
              status: 'succeeded',
              data: expect.objectContaining({
                children: [
                  expect.objectContaining({
                    child: expect.objectContaining({ childRunId, state: 'cancelled' }),
                    summary: reason,
                  }),
                ],
              }),
            }),
          }),
        ]),
      );
      expect(JSON.stringify(resumedModel.streamed[0])).not.toContain(childObjective);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('coordinates an accepted child Run without mutating or activating its parent', async () => {
    const { fixture, runId } = await acceptedRuntimeFixture();
    const childObjective = 'Complete one isolated child Run through the shared coordinator.';
    const parentBeforeSpawn = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.child.parent-before-spawn',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parentBeforeSpawn.revision,
        commandId: 'command.runtime.child.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Child runtime proof',
          objective: childObjective,
          publicSummary: 'Running one isolated child task.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parentBeforeSpawn.revision,
        }),
      },
      commanderContext(runId),
    );
    const childRunId = spawned.child.childRunId;
    const childContext = commanderContext(childRunId);
    const childInbox = fixture.data.runs.listInbox(childRunId)[0]!;
    if (childInbox.source.kind !== 'parent_direction') {
      throw new Error('Expected the child Inbox to carry a parent direction');
    }
    const childSource = childInbox.source;
    const parentAfterSpawn = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.child.parent-after-spawn',
      method: 'run.get',
      input: { runId },
    }).result;
    const parentInboxAfterSpawn = fixture.data.runs.listInbox(runId);
    const parentActivationsAfterSpawn = fixture.data.runs.listActivations(runId);
    const parentEventsAfterSpawn = fixture.data.runs.listPublicEvents({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.child.parent-events-after-spawn',
      method: 'run.events.list',
      input: { runId, afterSequence: null, page: { cursor: null, limit: 100 } },
    }).result.items;
    const model = new FakeModelAdapter(FINAL_RESPONSE);
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('A direct child final response must not execute a tool');
          }),
        },
        {
          runId: childRunId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context: childContext,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected the child Activation to execute');
      expect(result).toMatchObject({
        runId: childRunId,
        activationNumber: 1,
        triggerInboxMessageId: childInbox.id,
        snapshot: {
          run: { id: childRunId, parentRunId: runId, rootRunId: runId, status: 'completed' },
          activation: { state: 'ended', endReason: 'terminal' },
        },
      });
      expect(fixture.data.runs.listInbox(childRunId)).toMatchObject([{ state: 'consumed' }]);
      expect(fixture.data.runs.listActivations(childRunId)).toHaveLength(1);
      expect(
        await coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model,
            toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
              throw new Error('A terminal child replay must not execute a tool');
            }),
          },
          {
            runId: childRunId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context: childContext,
          },
        ),
      ).toMatchObject({ kind: 'idle', reason: 'terminal', run: { id: childRunId } });
      expect(model.streamed).toHaveLength(1);
      expect(model.streamed[0]!.facts).toEqual([
        {
          type: 'parent_direction',
          eventSequence: expect.any(Number),
          inboxMessageId: childInbox.id,
          parentRunId: runId,
          parentEventId: childSource.parentEventId,
          directionHash: spawned.child.objectiveHash,
        },
      ]);
      expect(model.quotedPrivateContexts).toEqual([
        {
          parentDirections: [
            {
              type: 'parent_direction',
              inboxMessageId: childInbox.id,
              parentRunId: runId,
              parentEventId: childSource.parentEventId,
              directionHash: spawned.child.objectiveHash,
              objective: childObjective,
            },
          ],
          spawnObjectives: [],
        },
      ]);
      expect(model.streamedPrivateContexts).toEqual(model.quotedPrivateContexts);
      expect(JSON.stringify(model.streamed[0])).not.toContain(childObjective);
      const persistedRequest = getJourneyTestDatabase(fixture.store)
        .prepare('SELECT request_v1_json FROM model_attempts WHERE run_id = ?')
        .get(childRunId) as { request_v1_json: string };
      expect(persistedRequest.request_v1_json).not.toContain(childObjective);
      expect(fixture.data.runs.listActivations(childRunId)).toHaveLength(1);
      expect(
        fixture.data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.child.parent-after-execution',
          method: 'run.get',
          input: { runId },
        }).result,
      ).toEqual(parentAfterSpawn);
      expect(fixture.data.runs.listInbox(runId)).toEqual(parentInboxAfterSpawn);
      expect(fixture.data.runs.listActivations(runId)).toEqual(parentActivationsAfterSpawn);
      expect(
        fixture.data.runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.child.parent-events-after-execution',
          method: 'run.events.list',
          input: { runId, afterSequence: null, page: { cursor: null, limit: 100 } },
        }).result.items,
      ).toEqual(parentEventsAfterSpawn);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('fails child coordination before delivery or Activation when private recovery authentication fails', async () => {
    const { fixture, runId } = await acceptedRuntimeFixture();
    const parent = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.child-corrupt.parent',
      method: 'run.get',
      input: { runId },
    }).result;
    const spawned = fixture.data.runs.spawnChild(
      {
        parentRunId: runId,
        expectedParentRevision: parent.revision,
        commandId: 'command.runtime.child-corrupt.spawn',
        spawnInput: AgentSpawnDefinition.parseInput({
          displayName: 'Authenticated child',
          objective: 'This child objective must authenticate before scheduling.',
          publicSummary: 'Checking one authenticated child task.',
          contextRefs: [],
          toolAllowlist: null,
          permissionCeiling: null,
          budgetCaps: null,
          expectedParentRevision: parent.revision,
        }),
      },
      commanderContext(runId),
    );
    const childRunId = spawned.child.childRunId;
    const before = fixture.data.runReplay.get(childRunId);
    const wrongKeyData = createJourneyDataAccess(
      fixture.store,
      fixture.dependencies,
      fixture.createId,
      createJourneyPrivateRecoveryCodec(new Uint8Array(32).fill(0x6b)),
    );
    const model = new FakeModelAdapter(FINAL_RESPONSE);
    try {
      await expect(
        coordinateRun(
          {
            runs: wrongKeyData.runs,
            persistence: wrongKeyData.harness,
            model,
            toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
              throw new Error('An unauthenticated child must not execute a tool');
            }),
          },
          {
            runId: childRunId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context: commanderContext(childRunId),
          },
        ),
      ).rejects.toMatchObject({ code: 'CORRUPT_DATA' });
      expect(model.quoted).toEqual([]);
      expect(model.streamed).toEqual([]);
      expect(fixture.data.runReplay.get(childRunId)).toEqual(before);
      expect(fixture.data.runs.listInbox(childRunId)).toMatchObject([{ state: 'queued' }]);
      expect(fixture.data.runs.listActivations(childRunId)).toEqual([]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('coordinates a stale follow-up from a fresh root after the source root terminalizes', async () => {
    const { fixture, runId } = await acceptedRuntimeFixture(SKILL_CATALOG);
    const sourceBefore = fixture.data.runs.get({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.terminal-followup.source-before',
      method: 'run.get',
      input: { runId },
    }).result;
    const terminalSource = fixture.data.runs.terminalize(
      {
        runId,
        expectedRevision: sourceBefore.revision,
        status: 'cancelled',
        summary: 'The source root ended before the follow-up committed.',
        resultIds: [],
        commandId: 'command.runtime.terminal-followup.terminalize',
      },
      commanderContext(runId),
    );
    const sourceInboxAtTerminal = fixture.data.runs.listInbox(runId);
    const sourceEventsAtTerminal = fixture.data.runs.listPublicEvents({
      wireVersion: 1,
      kind: 'request',
      requestId: 'request.runtime.terminal-followup.source-events-at-terminal',
      method: 'run.events.list',
      input: { runId, afterSequence: null, page: { cursor: null, limit: 100 } },
    }).result.items;
    const model = new FakeModelAdapter(FINAL_RESPONSE);
    try {
      const nextInbox = fixture.data.runs.sendFollowup(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.terminal-followup.send',
          method: 'run.sendFollowup',
          input: {
            runId,
            expectedRevision: sourceBefore.revision,
            text: 'Continue this conversation in a new root Run.',
            selectedContext: [],
            exportDestinationGrant: null,
          },
        },
        userContext,
        ROOT_ACCEPTANCE_SEED,
      ).result;
      expect(nextInbox).toMatchObject({ sequence: 1, state: 'queued' });
      expect(nextInbox.runId).not.toBe(runId);

      const nextRun = fixture.data.runs.get({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.runtime.terminal-followup.next-run',
        method: 'run.get',
        input: { runId: nextInbox.runId },
      }).result;
      expect(nextRun).toMatchObject({
        id: nextInbox.runId,
        rootRunId: nextInbox.runId,
        parentRunId: null,
        retryOfRunId: null,
        status: 'accepted',
      });
      expect(nextRun.contextManifestId).not.toBe(terminalSource.contextManifestId);
      expect(nextRun.capabilityCatalogSnapshotId).not.toBe(
        terminalSource.capabilityCatalogSnapshotId,
      );
      expect(
        fixture.data.runs.get({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.terminal-followup.source-after',
          method: 'run.get',
          input: { runId },
        }).result,
      ).toEqual(terminalSource);
      expect(fixture.data.runs.listInbox(runId)).toEqual(sourceInboxAtTerminal);
      expect(
        fixture.data.runs.listPublicEvents({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.terminal-followup.source-events-after',
          method: 'run.events.list',
          input: { runId, afterSequence: null, page: { cursor: null, limit: 100 } },
        }).result.items,
      ).toEqual(sourceEventsAtTerminal);

      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('The next-root final response must not execute a tool');
          }),
        },
        {
          runId: nextInbox.runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context: commanderContext(nextInbox.runId),
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected the next root to execute');
      expect(result).toMatchObject({
        activationNumber: 1,
        triggerInboxMessageId: nextInbox.id,
        snapshot: {
          run: { id: nextInbox.runId, status: 'completed' },
          activation: { state: 'ended', endReason: 'terminal' },
        },
      });
      expect(result.snapshot.catalog.skills).toEqual(SKILLS);
      expect(model.streamed[0]!.facts).toMatchObject([
        { type: 'message', role: 'user', messageId: nextInbox.source.messageId },
      ]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('continues FIFO across safe-boundary follow-ups queued during an owned Activation', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const followups: ReturnType<typeof queueRuntimeFollowup>[] = [];
    const model = new FakeModelAdapter(
      FINAL_RESPONSE,
      [FINAL_RESPONSE, FINAL_RESPONSE],
      (_request, attemptIndex) => {
        if (attemptIndex === 0) {
          followups.push(queueRuntimeFollowup(fixture, runId, 'owned-activation-1'));
          followups.push(queueRuntimeFollowup(fixture, runId, 'owned-activation-2'));
        }
      },
    );
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('A direct final response must not execute a tool');
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (followups.length !== 2) throw new Error('Expected both owned follow-ups to be queued');
      const [firstFollowup, secondFollowup] = followups;
      if (firstFollowup === undefined || secondFollowup === undefined) {
        throw new Error('Expected both owned follow-ups');
      }
      if (result.kind !== 'executed') {
        throw new Error('Expected the owning Coordinator to execute all Activations');
      }

      expect(model.quoted.map(({ activationNumber }) => activationNumber)).toEqual([1, 2, 3]);
      expect(model.streamed.map(({ activationNumber }) => activationNumber)).toEqual([1, 3]);
      expect(result.activationNumber).toBe(3);
      expect(result.triggerInboxMessageId).toBe(secondFollowup.id);
      expect(result.snapshot.run.status).toBe('completed');
      expect(fixture.data.runs.listInbox(runId)).toMatchObject([
        { sequence: 1, state: 'consumed' },
        { id: firstFollowup.id, sequence: 2, state: 'consumed' },
        { id: secondFollowup.id, sequence: 3, state: 'consumed' },
      ]);
      expect(fixture.data.runs.listActivations(runId)).toMatchObject([
        { activationNumber: 1, state: 'ended', endReason: 'safe_boundary' },
        {
          activationNumber: 2,
          triggerInboxMessageId: firstFollowup.id,
          state: 'ended',
          endReason: 'safe_boundary',
        },
        {
          activationNumber: 3,
          triggerInboxMessageId: secondFollowup.id,
          state: 'ended',
          endReason: 'terminal',
        },
      ]);
      expect(fixture.data.harness.loadActivation(runId, 2).modelAttempts).toEqual([]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('starts from an already delivered Inbox without appending a second delivery', async () => {
    const { fixture, context, inbox, runId } = await acceptedRuntimeFixture();
    const delivered = fixture.data.runs.transitionInbox(
      {
        runId,
        expectedRevision: 0,
        inboxMessageId: inbox.id,
        sequence: inbox.sequence,
        action: 'deliver',
        commandId: 'command.runtime.coordinator.pre-delivered',
      },
      context,
    );
    const model = new FakeModelAdapter(FINAL_RESPONSE);
    try {
      expect(delivered.state).toBe('delivered');

      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('A direct final response must not execute a tool');
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (result.kind !== 'executed') throw new Error('Expected the delivered Inbox to execute');

      const deliveredEvents = result.snapshot.journal.filter(
        ({ payloadState }) =>
          payloadState.state === 'available' &&
          payloadState.payload.type === 'inbox_state_changed' &&
          payloadState.payload.state === 'delivered',
      );
      expect(deliveredEvents).toHaveLength(1);
      expect(result.snapshot.activation.triggerInboxMessageId).toBe(inbox.id);
      expect(model.streamed).toHaveLength(1);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('resumes an existing active Activation without starting a duplicate Activation', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(FINAL_RESPONSE);
    try {
      const before = fixture.data.harness.loadActivation(runId, 1);
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('A direct final response must not execute a tool');
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(result).toMatchObject({
        kind: 'executed',
        activationNumber: before.activation.activationNumber,
        triggerInboxMessageId: before.activation.triggerInboxMessageId,
        snapshot: { run: { id: runId, status: 'completed' } },
      });
      expect(model.quoted).toHaveLength(1);
      expect(model.streamed).toHaveLength(1);
      expect(fixture.data.runs.listActivations(runId)).toHaveLength(1);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it.each(['approved', 'denied'] as const)(
    'coordinates an %s Skill confirmation through the next frozen-catalog Activation',
    async (decision) => {
      const { fixture, context, runId } = await activeRuntimeFixture();
      const proposalInput = SkillProposeDefinition.parseInput({
        name: 'Continuity reviewer',
        description: 'Review shots for visible continuity errors.',
        content: 'Check props, wardrobe, lighting, and screen direction.',
      });
      try {
        const waiting = await runTargetActivation(
          {
            persistence: fixture.data.harness,
            model: new FakeModelAdapter(
              toolResponse(
                SkillProposeDefinition.id,
                proposalInput,
                `provider-call.skill-propose.${decision}`,
              ),
            ),
            toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
              throw new Error('Host-owned Skill proposals must not reach the read executor');
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        );
        const proposal = waiting.dispatches[0]!;
        if (proposal.confirmationId === null) throw new Error('Expected a pending confirmation');
        const beforeAnswerModel = new FakeModelAdapter(FINAL_RESPONSE);
        expect(
          await coordinateRun(
            {
              runs: fixture.data.runs,
              persistence: fixture.data.harness,
              model: beforeAnswerModel,
              toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
                throw new Error('A pending confirmation must not execute a tool');
              }),
            },
            {
              runId,
              limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
              context,
            },
          ),
        ).toMatchObject({
          kind: 'deferred',
          reason: 'run_not_running',
          run: { status: 'waiting_confirmation' },
          pendingInbox: null,
        });
        expect(beforeAnswerModel.streamed).toEqual([]);
        const confirmation = createHostConfirmationAuthority(fixture.store, {
          now: () => NOW,
          createId: fixture.createId,
        }).respond(
          {
            wireVersion: 1,
            kind: 'request',
            requestId: `request.runtime.skill-confirmation.${decision}`,
            method: 'confirmation.respond',
            input: {
              confirmationId: proposal.confirmationId,
              immutableInputHash: proposal.key.inputHash,
              decision,
            },
          },
          userContext,
        );
        const answerInbox = fixture.data.runs
          .listInbox(runId)
          .find(
            ({ source }) =>
              source.kind === 'message' && source.messageId === confirmation.result.messageId,
          );
        if (answerInbox === undefined)
          throw new Error('Expected the confirmation answer Inbox item');
        const continuationModel = new FakeModelAdapter(FINAL_RESPONSE);

        const result = await coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model: continuationModel,
            toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
              throw new Error('A confirmation continuation final must not execute a tool');
            }),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        );
        if (result.kind !== 'executed') {
          throw new Error('Expected the confirmation Activation to execute');
        }
        const completed = result.snapshot;

        expect(continuationModel.streamed).toHaveLength(1);
        expect(continuationModel.streamed[0]!.activationNumber).toBe(2);
        expect(continuationModel.streamed[0]!.facts.at(-1)).toMatchObject({
          type: 'message',
          role: 'user',
          messageId: confirmation.result.messageId,
          blocks: [
            {
              type: 'text',
              text: `${decision === 'approved' ? 'Approved' : 'Denied'} Project Skill "Continuity reviewer".`,
            },
          ],
        });
        expect(completed.activation).toMatchObject({
          activationNumber: 2,
          triggerInboxMessageId: answerInbox.id,
          triggerInboxSequence: answerInbox.sequence,
          state: 'ended',
          endReason: 'terminal',
        });
        expect(completed.catalog.catalogHash).toBe(waiting.catalog.catalogHash);
        expect(completed.catalog.skills).toEqual(waiting.catalog.skills);
        expect(fixture.data.runs.listActivations(runId)).toHaveLength(2);

        const replay = await coordinateRun(
          {
            runs: fixture.data.runs,
            persistence: fixture.data.harness,
            model: continuationModel,
            toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
              throw new Error('A terminal replay must not execute a tool');
            }),
          },
          {
            runId,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        );
        expect(replay).toEqual({ kind: 'idle', reason: 'terminal', run: completed.run });
        expect(continuationModel.streamed).toHaveLength(1);
        expect(fixture.data.runs.listActivations(runId)).toHaveLength(2);
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it('yields a final stop to a follow-up queued while the model is streaming', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    let followup: ReturnType<typeof queueRuntimeFollowup> | undefined;
    const model = new FakeModelAdapter(FINAL_RESPONSE, [], (_request, attemptIndex) => {
      if (attemptIndex === 0) {
        followup = queueRuntimeFollowup(fixture, runId, 'during-final');
      }
    });
    try {
      const yielded = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('A final response must not execute a tool');
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (followup === undefined) throw new Error('Expected the streaming follow-up to be queued');

      expect(model.streamed).toHaveLength(1);
      expect(yielded.run.status).toBe('running');
      expect(yielded.activation).toMatchObject({ state: 'ended', endReason: 'safe_boundary' });
      expect(fixture.data.runs.listInbox(runId)).toContainEqual(followup);

      const continuationModel = new FakeModelAdapter(FINAL_RESPONSE);
      const continuation = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: continuationModel,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('The follow-up continuation final must not execute a tool');
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (continuation.kind !== 'executed') {
        throw new Error('Expected the queued follow-up to execute in a new Activation');
      }
      expect(continuation.activationNumber).toBe(2);
      expect(continuation.triggerInboxMessageId).toBe(followup.id);
      expect(continuation.snapshot.run.status).toBe('completed');
      expect(continuationModel.streamed[0]!.facts.at(-1)).toMatchObject({
        type: 'message',
        role: 'user',
        messageId: followup.source.messageId,
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('yields after a settled tool when a follow-up arrives during its execution', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    let followup: ReturnType<typeof queueRuntimeFollowup> | undefined;
    const model = new FakeModelAdapter(
      toolResponse(
        ProjectSearchDefinition.id,
        ProjectSearchDefinition.examples.input,
        'provider-call.project-search.before-followup',
      ),
      [FINAL_RESPONSE],
    );
    try {
      const yielded = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], () => {
            followup = queueRuntimeFollowup(fixture, runId, 'during-tool');
            return ProjectSearchDefinition.parseOutcome({
              status: 'succeeded',
              data: { items: [], nextCursor: null },
            });
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (followup === undefined) throw new Error('Expected the tool follow-up to be queued');

      expect(model.streamed).toHaveLength(1);
      expect(yielded.modelAttempts).toHaveLength(1);
      expect(yielded.dispatches).toHaveLength(1);
      expect(yielded.dispatches[0]!.outcome).toMatchObject({ status: 'succeeded' });
      expect(yielded.run.status).toBe('running');
      expect(yielded.activation).toMatchObject({ state: 'ended', endReason: 'safe_boundary' });
      expect(
        yielded.journal.flatMap(({ payloadState }) =>
          payloadState.state === 'available' &&
          (payloadState.payload.type === 'turn_ended' ||
            (payloadState.payload.type === 'activation_changed' &&
              payloadState.payload.state === 'ended'))
            ? [payloadState.payload]
            : [],
        ),
      ).toMatchObject([
        { type: 'turn_ended', activationNumber: 1, outcome: 'interrupted' },
        {
          type: 'activation_changed',
          activationNumber: 1,
          state: 'ended',
          endReason: 'safe_boundary',
        },
      ]);

      const continuationModel = new FakeModelAdapter(FINAL_RESPONSE);
      const continuation = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: continuationModel,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('The follow-up continuation final must not execute a tool');
          }),
        },
        {
          runId,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (continuation.kind !== 'executed') {
        throw new Error('Expected the tool follow-up to execute in a new Activation');
      }
      expect(continuation.activationNumber).toBe(2);
      expect(continuation.triggerInboxMessageId).toBe(followup.id);
      expect(continuation.snapshot.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('yields an unused Activation when a follow-up wins the first quote boundary', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    let followup: ReturnType<typeof queueRuntimeFollowup> | undefined;
    const model = new FakeModelAdapter(FINAL_RESPONSE, [], undefined, (_request, quoteIndex) => {
      if (quoteIndex === 0) {
        followup = queueRuntimeFollowup(fixture, runId, 'during-first-quote');
      }
    });
    try {
      const yielded = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('A yielded quote boundary must not execute a tool');
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (followup === undefined) throw new Error('Expected the first-quote follow-up');

      expect(model.quoted).toHaveLength(1);
      expect(model.streamed).toEqual([]);
      expect(yielded.modelAttempts).toEqual([]);
      expect(yielded.activation).toMatchObject({ state: 'ended', endReason: 'safe_boundary' });
      expect(
        yielded.journal.filter(
          ({ payloadState }) =>
            payloadState.state === 'available' && payloadState.payload.type === 'turn_ended',
        ),
      ).toEqual([]);

      const continuation = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: new FakeModelAdapter(FINAL_RESPONSE),
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('The quote-boundary continuation must not execute a tool');
          }),
        },
        { runId, limits: { maxInputTokens: 2_000, maxOutputTokens: 500 }, context },
      );
      expect(continuation).toMatchObject({
        kind: 'executed',
        activationNumber: 2,
        triggerInboxMessageId: followup.id,
        snapshot: { run: { status: 'completed' } },
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('yields before a later model attempt when a follow-up wins its quote boundary', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    let followup: ReturnType<typeof queueRuntimeFollowup> | undefined;
    const model = new FakeModelAdapter(
      toolResponse(
        ProjectSearchDefinition.id,
        ProjectSearchDefinition.examples.input,
        'provider-call.project-search.before-quote-followup',
      ),
      [FINAL_RESPONSE],
      undefined,
      (_request, quoteIndex) => {
        if (quoteIndex === 1) {
          followup = queueRuntimeFollowup(fixture, runId, 'during-later-quote');
        }
      },
    );
    try {
      const yielded = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], () =>
            ProjectSearchDefinition.parseOutcome({
              status: 'succeeded',
              data: { items: [], nextCursor: null },
            }),
          ),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      if (followup === undefined) throw new Error('Expected the later-quote follow-up');

      expect(model.quoted).toHaveLength(2);
      expect(model.streamed).toHaveLength(1);
      expect(yielded.modelAttempts).toHaveLength(1);
      expect(yielded.dispatches).toHaveLength(1);
      expect(yielded.activation).toMatchObject({ state: 'ended', endReason: 'safe_boundary' });
      expect(
        yielded.journal.flatMap(({ payloadState }) =>
          payloadState.state === 'available' && payloadState.payload.type === 'turn_ended'
            ? [payloadState.payload]
            : [],
        ),
      ).toContainEqual(
        expect.objectContaining({
          type: 'turn_ended',
          activationNumber: 1,
          outcome: 'interrupted',
        }),
      );

      const continuation = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: new FakeModelAdapter(FINAL_RESPONSE),
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            throw new Error('The quote-boundary continuation must not execute a tool');
          }),
        },
        { runId, limits: { maxInputTokens: 2_000, maxOutputTokens: 500 }, context },
      );
      expect(continuation).toMatchObject({
        kind: 'executed',
        activationNumber: 2,
        triggerInboxMessageId: followup.id,
        snapshot: { run: { status: 'completed' } },
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('runs a real history.query through two durable model attempts', async () => {
    const { fixture, context, inbox, project, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter();
    try {
      const messagesBefore = fixture.data.conversations.listMessages({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3k1.messages.before',
        method: 'message.list',
        input: {
          chatId: fixture.data.harness.loadActivation(runId, 1).run.chatId,
          beforeSequence: null,
          page: { cursor: null, limit: 100 },
        },
      }).result.items;

      const finalSnapshot = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.quoted).toHaveLength(2);
      expect(model.streamed).toHaveLength(2);
      expect(model.quoted).toEqual(model.streamed);
      expect(model.streamed[0]!.facts.map(({ type }) => type)).toEqual(['message']);
      expect(model.streamed[1]!.facts.map(({ type }) => type)).toEqual([
        'message',
        'tool_call',
        'tool_result',
      ]);
      for (const request of model.streamed) {
        expect(request.capabilityIndex).toHaveLength(40);
        expect(request.materializedTools.map(({ id }) => id)).toEqual(MATERIALIZED_MODEL_TOOL_IDS);
        expect(
          request.materializedTools.map(
            ({ id, version, schemaDigest, inputSchema, successSchema, outcomeSchema }) => ({
              id,
              version,
              schemaDigest,
              inputSchemaHash: inputSchema.sha256,
              successSchemaHash: successSchema.sha256,
              outcomeSchemaHash: outcomeSchema.sha256,
            }),
          ),
        ).toEqual(
          ROOT_CATALOG.tools
            .filter(({ id }) => MATERIALIZED_MODEL_TOOL_IDS.includes(id as never))
            .map(({ id, version, schemaDigest, inputSchema, successSchema, outcomeSchema }) => ({
              id,
              version,
              schemaDigest,
              inputSchemaHash: inputSchema.sha256,
              successSchemaHash: successSchema.sha256,
              outcomeSchemaHash: outcomeSchema.sha256,
            })),
        );
        for (const tool of request.materializedTools) {
          expect(request.capabilityIndex.find(({ name }) => name === tool.id)).toMatchObject({
            version: tool.version,
            schemaDigest: tool.schemaDigest,
          });
        }
      }

      expect(finalSnapshot.inbox.find(({ id }) => id === inbox.id)?.state).toBe('consumed');
      expect(finalSnapshot.run).toMatchObject({
        status: 'completed',
        terminalOutcome: { status: 'completed', summary: 'The read completed.' },
      });
      expect(finalSnapshot.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
      expect(finalSnapshot.taskList).toBeNull();
      expect(finalSnapshot.modelAttempts.map(({ state }) => state)).toEqual([
        'succeeded',
        'succeeded',
      ]);
      expect(finalSnapshot.dispatches).toHaveLength(1);
      expect(finalSnapshot.dispatches[0]).toMatchObject({
        originModelAttemptId: finalSnapshot.modelAttempts[0]!.id,
        originProviderCallId: 'provider-call.history-query',
        key: {
          projectId: project.id,
          toolId: 'history.query',
          authorityWatermarkHash: null,
          input: HISTORY_QUERY_INPUT,
        },
        outcome: {
          status: 'succeeded',
          data: { items: [{ projectId: project.id, source: 'message' }] },
        },
      });
      expect(finalSnapshot.dispatches[0]!.key.inputHash).toMatch(/^[a-f0-9]{64}$/);
      expect(finalSnapshot.dispatches[0]!.outcomeHash).toMatch(/^[a-f0-9]{64}$/);
      expect(finalSnapshot.facts.map(({ type }) => type)).toEqual([
        'message',
        'tool_call',
        'tool_result',
        'message',
      ]);
      expect(finalSnapshot.resourceExposure).toMatchObject({
        inputTokens: 240n,
        outputTokens: 48n,
      });
      expect(finalSnapshot.resourceExposure.cost?.coefficient).toBe(10n);
      expect(finalSnapshot.recoveryRequired).toBe(false);

      const messagesAfter = fixture.data.conversations.listMessages({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3k1.messages.after',
        method: 'message.list',
        input: {
          chatId: finalSnapshot.run.chatId,
          beforeSequence: null,
          page: { cursor: null, limit: 100 },
        },
      }).result.items;
      expect(messagesAfter).toHaveLength(messagesBefore.length + 1);
      expect(messagesAfter.at(-1)).toMatchObject({
        role: 'assistant',
        status: 'completed',
        originatingRunId: runId,
        blocks: [{ type: 'text', text: 'The read completed.' }],
      });
      const payloads = finalSnapshot.journal.flatMap(({ payloadState }) =>
        payloadState.state === 'available' ? [payloadState.payload] : [],
      );
      expect(payloads.filter(({ type }) => type === 'tool_result_ref')).toHaveLength(1);
      expect(payloads.slice(-7).map(({ type }) => type)).toEqual([
        'usage',
        'message_ref',
        'step_ended',
        'turn_ended',
        'activation_changed',
        'run_state_changed',
        'terminal_summary',
      ]);
      expect(payloads.slice(-7)).toMatchObject([
        { type: 'usage' },
        { type: 'message_ref', role: 'assistant' },
        { type: 'step_ended', outcome: 'completed' },
        { type: 'turn_ended', outcome: 'completed' },
        { type: 'activation_changed', state: 'ended', endReason: 'terminal' },
        { type: 'run_state_changed', previousState: 'running', state: 'completed' },
        { type: 'terminal_summary', status: 'completed', summary: 'The read completed.' },
      ]);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('continues one durable turn through three tool calls before the model stops', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const inputs = ['moonlit location', 'rain reference', 'continuity evidence'].map((query) =>
      ProjectSearchDefinition.parseInput({
        ...ProjectSearchDefinition.examples.input,
        query,
      }),
    );
    const model = new FakeModelAdapter(
      toolResponse(ProjectSearchDefinition.id, inputs[0]!, 'provider-call.project-search.1'),
      [
        toolResponse(ProjectSearchDefinition.id, inputs[1]!, 'provider-call.project-search.2'),
        toolResponse(ProjectSearchDefinition.id, inputs[2]!, 'provider-call.project-search.3'),
        FINAL_RESPONSE,
      ],
    );
    const executions: TargetToolExecution[] = [];
    try {
      const finalSnapshot = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], (execution) => {
            executions.push(execution);
            ProjectSearchDefinition.parseInput(execution.input as Record<string, unknown>);
            return ProjectSearchDefinition.parseOutcome({
              status: 'succeeded',
              data: { items: [], nextCursor: null },
            });
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.streamed.map(({ attemptNumber }) => attemptNumber)).toEqual([1, 2, 3, 4]);
      expect(model.streamed.map(({ facts }) => facts.length)).toEqual([1, 3, 5, 7]);
      expect(model.streamed.map(({ capabilityCatalog }) => capabilityCatalog)).toEqual(
        Array.from({ length: 4 }, () => model.streamed[0]!.capabilityCatalog),
      );
      expect(model.streamed.map(({ materializedTools }) => materializedTools)).toEqual(
        Array.from({ length: 4 }, () => model.streamed[0]!.materializedTools),
      );
      expect(
        executions.map((execution) =>
          execution.origin.kind === 'model' ? execution.origin.providerCallId : null,
        ),
      ).toEqual([
        'provider-call.project-search.1',
        'provider-call.project-search.2',
        'provider-call.project-search.3',
      ]);
      expect(executions.map(({ input }) => input)).toEqual(inputs);
      expect(new Set(executions.map(({ operationFingerprint }) => operationFingerprint)).size).toBe(
        3,
      );
      expect(finalSnapshot.modelAttempts).toHaveLength(4);
      expect(finalSnapshot.dispatches).toHaveLength(3);
      expect(
        finalSnapshot.dispatches.map(({ originModelAttemptId }) => originModelAttemptId),
      ).toEqual(finalSnapshot.modelAttempts.slice(0, 3).map(({ id }) => id));
      expect(
        finalSnapshot.journal.flatMap(({ payloadState }) =>
          payloadState.state === 'available' && payloadState.payload.type === 'step_started'
            ? [payloadState.payload.kind]
            : [],
        ),
      ).toEqual(['model', 'tool', 'model', 'tool', 'model', 'tool', 'model']);
      expect(finalSnapshot.facts).toHaveLength(8);
      expect(finalSnapshot.run.status).toBe('completed');
      expect(finalSnapshot.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('turns an explicit user request to add a Skill into one exact pending confirmation', async () => {
    const objective = 'Please add a Skill that reviews visible continuity errors.';
    const { fixture, context, runId } = await activeRuntimeFixture(ROOT_CATALOG, objective);
    const input = SkillProposeDefinition.parseInput({
      name: 'Continuity reviewer',
      description: 'Review shots for visible continuity errors.',
      content: 'Check props, wardrobe, lighting, and screen direction.',
    });
    const model = new FakeModelAdapter(
      toolResponse(SkillProposeDefinition.id, input, 'provider-call.skill-propose'),
      [],
      (request) => {
        expect(request.materializedTools).toContainEqual(
          expect.objectContaining({ id: SkillProposeDefinition.id }),
        );
        expect(request.facts).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'message',
              role: 'user',
              blocks: [{ type: 'text', text: objective }],
            }),
          ]),
        );
      },
    );
    let executeCount = 0;
    try {
      const before = fixture.data.harness.loadActivation(runId, 1);
      const waiting = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
            executeCount += 1;
            throw new Error('Host-owned Skill proposals must not reach the read executor');
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.quoted).toHaveLength(1);
      expect(model.streamed).toHaveLength(1);
      expect(model.quoted).toEqual(model.streamed);
      expect(model.streamed[0]!.materializedTools.map(({ id }) => id)).toEqual(
        MATERIALIZED_MODEL_TOOL_IDS,
      );
      expect(executeCount).toBe(0);
      expect(waiting.run.status).toBe('waiting_confirmation');
      expect(waiting.activation).toMatchObject({ state: 'ended', endReason: 'waiting' });
      expect(waiting.modelAttempts).toHaveLength(1);
      expect(waiting.modelAttempts[0]!.state).toBe('succeeded');
      expect(waiting.modelAttempts[0]!.response?.events[0]).toEqual({
        type: 'tool_call',
        providerCallId: 'provider-call.skill-propose',
        toolId: 'skill.propose',
        canonicalArguments: input,
      });
      expect(waiting.dispatches).toHaveLength(1);
      expect(waiting.dispatches[0]).toMatchObject({
        guardOutcome: 'confirmation_required',
        key: { toolId: 'skill.propose', input },
        outcome: { status: 'permission_required' },
      });
      expect(waiting.dispatches[0]!.confirmationId).not.toBeNull();
      expect(waiting.catalog.catalogHash).toBe(before.catalog.catalogHash);
      expect(waiting.catalog.skills).toEqual(before.catalog.skills);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('settles earlier tool work before a later Skill proposal waits for confirmation', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const proposalInput = SkillProposeDefinition.parseInput({
      name: 'Continuity reviewer',
      description: 'Review shots for visible continuity errors.',
      content: 'Check props, wardrobe, lighting, and screen direction.',
    });
    const model = new FakeModelAdapter(
      toolResponse(
        ProjectSearchDefinition.id,
        ProjectSearchDefinition.examples.input,
        'provider-call.project-search.before-skill',
      ),
      [
        toolResponse(
          SkillProposeDefinition.id,
          proposalInput,
          'provider-call.skill-propose.after-read',
        ),
      ],
    );
    const executions: TargetToolExecution[] = [];
    try {
      const waiting = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], (execution) => {
            executions.push(execution);
            return ProjectSearchDefinition.parseOutcome({
              status: 'succeeded',
              data: { items: [], nextCursor: null },
            });
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.streamed).toHaveLength(2);
      expect(executions).toMatchObject([{ toolId: 'project.search' }]);
      expect(waiting.modelAttempts.map(({ state }) => state)).toEqual(['succeeded', 'succeeded']);
      expect(waiting.dispatches).toMatchObject([
        {
          originProviderCallId: 'provider-call.project-search.before-skill',
          guardOutcome: 'allowed',
          outcome: { status: 'succeeded' },
        },
        {
          originProviderCallId: 'provider-call.skill-propose.after-read',
          guardOutcome: 'confirmation_required',
          outcome: { status: 'permission_required' },
        },
      ]);
      expect(waiting.run.status).toBe('waiting_confirmation');
      expect(waiting.activation).toMatchObject({ state: 'ended', endReason: 'waiting' });
      expect(waiting.recoveryRequired).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('materializes generation.quote only after a successful tool.get dispatch', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const toolGetInput = ToolGetDefinition.parseInput({ names: [GenerationQuoteDefinition.id] });
    const generationQuoteInput = GenerationQuoteDefinition.parseInput(
      GenerationQuoteDefinition.examples.input,
    );
    const model = new FakeModelAdapter(
      toolResponse(ToolGetDefinition.id, toolGetInput, 'provider-call.tool-get'),
      [
        toolResponse(
          GenerationQuoteDefinition.id,
          generationQuoteInput,
          'provider-call.generation-quote.after-tool-get',
        ),
        FINAL_RESPONSE,
      ],
    );
    const reads = createTargetStorageReadToolExecutor(fixture.data);
    const executions: TargetToolExecution[] = [];
    const executor = fakeToolExecutor(
      reads.toolIds,
      (execution) => {
        executions.push(execution);
        if (execution.toolId === GenerationQuoteDefinition.id) {
          return GenerationQuoteDefinition.parseOutcome({
            status: 'succeeded',
            data: GenerationQuoteDefinition.examples.success,
          });
        }
        return reads.execute(execution);
      },
      reads.initialToolIds,
    );
    try {
      const completed = await runTargetActivation(
        { persistence: fixture.data.harness, model, toolExecutor: executor },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.streamed).toHaveLength(3);
      expect(model.streamed[0]!.materializedTools.map(({ id }) => id)).toEqual(
        MATERIALIZED_MODEL_TOOL_IDS,
      );
      expect(model.streamed[0]!.materializedTools).not.toContainEqual(
        expect.objectContaining({ id: GenerationQuoteDefinition.id }),
      );
      for (const request of model.streamed.slice(1)) {
        expect(request.materializedTools).toContainEqual(
          ROOT_CATALOG.tools.find(({ id }) => id === GenerationQuoteDefinition.id),
        );
      }
      expect(executions.map(({ toolId }) => toolId)).toEqual([
        ToolGetDefinition.id,
        GenerationQuoteDefinition.id,
      ]);
      expect(completed.dispatches).toMatchObject([
        {
          key: { toolId: ToolGetDefinition.id, input: toolGetInput },
          outcome: {
            status: 'succeeded',
            data: {
              definitions: [
                ROOT_CATALOG.tools.find(({ id }) => id === GenerationQuoteDefinition.id),
              ],
              catalogHash: ROOT_CATALOG.catalogHash,
            },
          },
        },
        {
          key: { toolId: GenerationQuoteDefinition.id, input: generationQuoteInput },
          outcome: { status: 'succeeded' },
        },
      ]);
      expect(completed.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('materializes project.search on demand and returns persisted Project facts', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const toolGetInput = ToolGetDefinition.parseInput({ names: [ProjectSearchDefinition.id] });
    const searchInput = ProjectSearchDefinition.parseInput({
      query: 'Inspect',
      kinds: ['message'],
      state: 'current',
      page: { cursor: null, limit: 20 },
    });
    const model = new FakeModelAdapter(
      toolResponse(ToolGetDefinition.id, toolGetInput, 'provider-call.tool-get.project-search'),
      [
        toolResponse(
          ProjectSearchDefinition.id,
          searchInput,
          'provider-call.project-search.after-tool-get',
        ),
        FINAL_RESPONSE,
      ],
    );
    try {
      const completed = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.streamed).toHaveLength(3);
      expect(model.streamed[0]!.materializedTools).not.toContainEqual(
        expect.objectContaining({ id: ProjectSearchDefinition.id }),
      );
      for (const request of model.streamed.slice(1)) {
        expect(request.materializedTools).toContainEqual(
          ROOT_CATALOG.tools.find(({ id }) => id === ProjectSearchDefinition.id),
        );
      }
      expect(completed.dispatches).toMatchObject([
        { key: { toolId: ToolGetDefinition.id }, outcome: { status: 'succeeded' } },
        {
          key: { toolId: ProjectSearchDefinition.id, input: searchInput },
          outcome: {
            status: 'succeeded',
            data: {
              items: [
                {
                  source: { kind: 'message' },
                  label: 'Inspect the current Project.',
                  excerpt: 'Inspect the current Project.',
                },
              ],
              nextCursor: null,
            },
          },
        },
      ]);
      expect(ProjectSearchDefinition.parseOutcome(completed.dispatches[1]!.outcome)).toMatchObject({
        status: 'succeeded',
      });
      expect(completed.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('materializes media.query on demand and returns persisted Project Media facts', async () => {
    const state = await acceptedRuntimeFixture();
    const { fixture, context, runId } = state;
    const linkInput = await seedMediaLinkInput(state);
    const mediaRef = fixture.data.projectMedia.get(linkInput.mediaRef.id);
    activateAcceptedRuntimeState(state, 'media-query');
    const toolGetInput = ToolGetDefinition.parseInput({ names: [MediaQueryDefinition.id] });
    const queryInput = MediaQueryDefinition.parseInput({
      scope: 'project',
      globalAssetIds: [mediaRef.globalAssetId],
      projectMediaRefIds: [linkInput.mediaRef.id],
      blobHashes: [],
      mediaKinds: ['image'],
      tags: ['runtime-test'],
      roles: ['reference'],
      integrity: ['unknown'],
      query: 'HARBOR',
      page: { cursor: null, limit: 20 },
    });
    const model = new FakeModelAdapter(
      toolResponse(ToolGetDefinition.id, toolGetInput, 'provider-call.tool-get.media-query'),
      [
        toolResponse(
          MediaQueryDefinition.id,
          queryInput,
          'provider-call.media-query.after-tool-get',
        ),
        FINAL_RESPONSE,
      ],
    );
    try {
      const completed = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.streamed).toHaveLength(3);
      expect(model.streamed[0]!.materializedTools).not.toContainEqual(
        expect.objectContaining({ id: MediaQueryDefinition.id }),
      );
      for (const request of model.streamed.slice(1)) {
        expect(request.materializedTools).toContainEqual(
          ROOT_CATALOG.tools.find(({ id }) => id === MediaQueryDefinition.id),
        );
      }
      expect(completed.dispatches).toMatchObject([
        { key: { toolId: ToolGetDefinition.id }, outcome: { status: 'succeeded' } },
        {
          key: { toolId: MediaQueryDefinition.id, input: queryInput },
          outcome: {
            status: 'succeeded',
            data: {
              items: [
                {
                  scope: 'project',
                  globalAssetId: mediaRef.globalAssetId,
                  projectMediaRef: linkInput.mediaRef,
                  kind: 'image',
                  displayName: 'Runtime harbor reference',
                  tags: ['runtime-test'],
                  roles: ['reference'],
                  integrity: 'unknown',
                },
              ],
              nextCursor: null,
            },
          },
        },
      ]);
      expect(MediaQueryDefinition.parseOutcome(completed.dispatches[1]!.outcome)).toMatchObject({
        status: 'succeeded',
      });
      expect(completed.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('materializes receipt-aware operation.get only after tool.get without treating it as a recovery replay', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const toolGetInput = ToolGetDefinition.parseInput({ names: [OperationGetDefinition.id] });
    const operationGetInput = OperationGetDefinition.parseInput(
      OperationGetDefinition.examples.input,
    );
    const model = new FakeModelAdapter(
      toolResponse(ToolGetDefinition.id, toolGetInput, 'provider-call.tool-get.operation'),
      [
        toolResponse(
          OperationGetDefinition.id,
          operationGetInput,
          'provider-call.operation-get.after-tool-get',
        ),
        FINAL_RESPONSE,
      ],
    );
    const reads = createTargetStorageReadToolExecutor(fixture.data);
    const executions: TargetToolExecution[] = [];
    const executor = fakeToolExecutor(
      reads.toolIds,
      (execution) => {
        executions.push(execution);
        if (execution.toolId === OperationGetDefinition.id) {
          return OperationGetDefinition.parseOutcome({
            status: 'succeeded',
            data: OperationGetDefinition.examples.success,
          });
        }
        return reads.execute(execution);
      },
      reads.initialToolIds,
    );
    try {
      const completed = await runTargetActivation(
        { persistence: fixture.data.harness, model, toolExecutor: executor },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.streamed[0]!.materializedTools).not.toContainEqual(
        expect.objectContaining({ id: OperationGetDefinition.id }),
      );
      for (const request of model.streamed.slice(1)) {
        expect(request.materializedTools).toContainEqual(
          ROOT_CATALOG.tools.find(({ id }) => id === OperationGetDefinition.id),
        );
      }
      expect(executions.map(({ toolId }) => toolId)).toEqual([
        ToolGetDefinition.id,
        OperationGetDefinition.id,
      ]);
      expect(completed.dispatches).toMatchObject([
        { key: { toolId: ToolGetDefinition.id }, outcome: { status: 'succeeded' } },
        { key: { toolId: OperationGetDefinition.id }, outcome: { status: 'succeeded' } },
      ]);
      expect(completed.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('reconstructs run.inspect materialization from settled facts after a cold restart', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const toolGetInput = ToolGetDefinition.parseInput({ names: [RunInspectDefinition.id] });
    const interruption = new Error('simulated process exit before the next Model Attempt');
    const interruptedModel = new FakeModelAdapter(
      toolResponse(ToolGetDefinition.id, toolGetInput, 'provider-call.tool-get.before-restart'),
      [FINAL_RESPONSE],
      undefined,
      (_request, quoteIndex) => {
        if (quoteIndex === 1) throw interruption;
      },
    );
    const reads = createTargetStorageReadToolExecutor(fixture.data);
    const executor = reads;
    try {
      await expect(
        runTargetActivation(
          { persistence: fixture.data.harness, model: interruptedModel, toolExecutor: executor },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toBe(interruption);
      expect(interruptedModel.quoted).toHaveLength(2);
      const expandedTools = interruptedModel.quoted[1]!.materializedTools;
      expect(expandedTools).toContainEqual(
        ROOT_CATALOG.tools.find(({ id }) => id === RunInspectDefinition.id),
      );
      expect(fixture.data.harness.loadActivation(runId, 1)).toMatchObject({
        activation: { state: 'active' },
        recoveryRequired: false,
        dispatches: [{ key: { toolId: ToolGetDefinition.id }, outcome: { status: 'succeeded' } }],
      });

      const resumedModel = new FakeModelAdapter(
        toolResponse(
          RunInspectDefinition.id,
          RunInspectDefinition.examples.input,
          'provider-call.run-inspect.after-restart',
        ),
        [FINAL_RESPONSE],
      );
      const completed = await runTargetActivation(
        { persistence: fixture.data.harness, model: resumedModel, toolExecutor: executor },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );
      expect(resumedModel.streamed).toHaveLength(2);
      expect(resumedModel.streamed[0]!.materializedTools).toEqual(expandedTools);
      expect(completed.dispatches).toMatchObject([
        { key: { toolId: ToolGetDefinition.id }, outcome: { status: 'succeeded' } },
        { key: { toolId: RunInspectDefinition.id }, outcome: { status: 'succeeded' } },
      ]);
      expect(completed.run.status).toBe('completed');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it.each([
    {
      name: 'failed',
      outcome: ToolGetDefinition.parseOutcome({
        status: 'non_retryable_failure',
        code: 'tool_get_failed',
        message: 'The frozen definition was not loaded.',
      }),
      error: null,
    },
    {
      name: 'cancelled',
      outcome: ToolGetDefinition.parseOutcome({
        status: 'cancelled',
        message: 'The frozen definition read was cancelled.',
        retainedOperations: [],
      }),
      error: null,
    },
    {
      name: 'mismatched',
      outcome: (() => {
        const frozen = ROOT_CATALOG.tools.find(({ id }) => id === ProjectSearchDefinition.id)!;
        const description = `${frozen.description} Altered.`;
        return ToolGetDefinition.parseOutcome({
          status: 'succeeded',
          data: {
            definitions: [
              { ...frozen, description, metadata: { ...frozen.metadata, description } },
            ],
            catalogHash: ROOT_CATALOG.catalogHash,
          },
        });
      })(),
      error: 'tool.get result does not match the frozen Capability Catalog',
    },
  ] as const)(
    'does not materialize tools from a $name tool.get outcome',
    async (testCase) => {
      const { fixture, context, runId } = await activeRuntimeFixture();
      const input = ToolGetDefinition.parseInput({ names: [ProjectSearchDefinition.id] });
      const model = new FakeModelAdapter(toolResponse(ToolGetDefinition.id, input), [
        FINAL_RESPONSE,
      ]);
      const executor = fakeToolExecutor(
        [ToolGetDefinition.id, ProjectSearchDefinition.id],
        () => testCase.outcome,
        [ToolGetDefinition.id],
      );
      try {
        const result = runTargetActivation(
          { persistence: fixture.data.harness, model, toolExecutor: executor },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        );
        if (testCase.error === null) {
          await expect(result).resolves.toMatchObject({ run: { status: 'completed' } });
          expect(model.streamed).toHaveLength(2);
          expect(model.streamed[1]!.materializedTools).not.toContainEqual(
            expect.objectContaining({ id: ProjectSearchDefinition.id }),
          );
        } else {
          await expect(result).rejects.toThrow(testCase.error);
          expect(model.streamed).toHaveLength(1);
        }
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    60_000,
  );

  it('loads exact frozen skills through one settled dispatch and completes', async () => {
    const { fixture, context, project, runId } = await activeRuntimeFixture(SKILL_CATALOG);
    const input = SkillLoadDefinition.parseInput({ skillIds: ['skill.beta', 'skill.alpha'] });
    const model = new FakeModelAdapter(
      toolResponse(SkillLoadDefinition.id, input, 'provider-call.skill-load'),
    );
    try {
      const finalSnapshot = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.streamed).toHaveLength(2);
      expect(model.streamed[0]!.skillIndex).toEqual(
        SKILLS.map(
          ({ skillId: id, name, description, version, contentHash, provenance, trust }) => ({
            id,
            name,
            description,
            version,
            contentHash,
            provenance,
            trust,
          }),
        ),
      );
      expect(model.streamed[0]!.skillIndex).not.toHaveProperty('0.content');
      expect(finalSnapshot.modelAttempts.map(({ state }) => state)).toEqual([
        'succeeded',
        'succeeded',
      ]);
      expect(finalSnapshot.dispatches).toMatchObject([
        {
          originProviderCallId: 'provider-call.skill-load',
          key: { projectId: project.id, toolId: 'skill.load', input },
          outcome: {
            status: 'succeeded',
            data: {
              skills: [SKILLS[1], SKILLS[0]],
              skillCatalogDigest: SKILL_CATALOG.skillCatalogDigest,
            },
          },
        },
      ]);
      expect(finalSnapshot.run.status).toBe('completed');
      expect(finalSnapshot.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('leaves a missing frozen skill dispatch open for crash recovery', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture(SKILL_CATALOG);
    const model = new FakeModelAdapter(
      toolResponse(SkillLoadDefinition.id, { skillIds: ['skill.missing'] }),
    );
    try {
      await expect(
        runTargetActivation(
          {
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('Frozen skill was not found: skill.missing');

      const interrupted = fixture.data.harness.loadActivation(runId, 1);
      expect(interrupted).toMatchObject({
        recoveryRequired: true,
        modelAttempts: [{ state: 'succeeded' }],
        dispatches: [{ key: { toolId: 'skill.load' }, outcome: null }],
      });
      const { dependencies } = recoveryDependencies(fixture.data.harness);
      expect(
        recoverTargetActivation(dependencies, recoveryInput(interrupted, context, 'skill')),
      ).toMatchObject({
        closed: {
          run: { id: runId, status: 'blocked' },
          activation: { state: 'ended', endReason: 'process_exit' },
          frontier: { kind: 'dispatch', toolId: 'skill.load' },
        },
        retry: { created: true, retryRun: { status: 'accepted', retryOfRunId: runId } },
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects undeclared project.get before model settlement or executor work', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(
      toolResponse(ProjectGetDefinition.id, ProjectGetDefinition.examples.input),
    );
    let executeCount = 0;
    try {
      await expect(
        runTargetActivation(
          {
            persistence: fixture.data.harness,
            model,
            toolExecutor: fakeToolExecutor(STORAGE_READ_IDS, () => {
              executeCount += 1;
              throw new Error('Undeclared project.get must not reach the executor');
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('not a live materialized definition');
      const after = fixture.data.harness.loadActivation(runId, 1);
      expect(model.quoted).toHaveLength(1);
      expect(model.streamed).toHaveLength(1);
      expect(model.streamed[0]!.materializedTools.map(({ id }) => id)).toEqual(
        MATERIALIZED_MODEL_TOOL_IDS,
      );
      expect(executeCount).toBe(0);
      expect(after.modelAttempts).toMatchObject([{ state: 'running', response: null }]);
      expect(after.dispatches).toEqual([]);
      expect(after.recoveryRequired).toBe(true);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('maps scoped storage-backed target reads', async () => {
    const { fixture, project, runId } = await activeRuntimeFixture();
    const acceptedRun = fixture.data.runReplay.get(runId).run;
    let replayReads = 0;
    const canvasQueries: unknown[] = [];
    const chatQueries: unknown[] = [];
    const deliveryQueries: unknown[] = [];
    const generationQuotes: unknown[] = [];
    const mediaInspections: unknown[] = [];
    const mediaQueries: unknown[] = [];
    const operationQueries: unknown[] = [];
    const productionQueries: unknown[] = [];
    const providerCapabilityQueries: unknown[] = [];
    const projectGets: unknown[] = [];
    const searchQueries: unknown[] = [];
    const runInspections: unknown[] = [];
    let generationQuoteSignal: AbortSignal | undefined;
    try {
      const executor = createTargetStorageReadToolExecutor({
        canvas: {
          queryTool(projectId, input) {
            canvasQueries.push({ projectId, input });
            return CanvasQueryDefinition.parseSuccess(CanvasQueryDefinition.examples.success);
          },
        },
        conversations: {
          queryMessages(projectId, defaultChatId, input) {
            chatQueries.push({ projectId, defaultChatId, input });
            return ChatQueryDefinition.parseSuccess(ChatQueryDefinition.examples.success);
          },
        },
        delivery: {
          queryTool(projectId, input) {
            deliveryQueries.push({ projectId, input });
            return DeliveryQueryDefinition.parseSuccess(DeliveryQueryDefinition.examples.success);
          },
        },
        generation: {
          quote(input, signal) {
            generationQuotes.push(input);
            generationQuoteSignal = signal;
            return Promise.resolve(
              GenerationQuoteDefinition.parseSuccess(GenerationQuoteDefinition.examples.success),
            );
          },
        },
        history: fixture.data.history,
        mediaInspection: {
          inspect(currentRunId, input) {
            mediaInspections.push({ runId: currentRunId, input });
            return Promise.resolve(
              MediaInspectDefinition.parseSuccess(MediaInspectDefinition.examples.success),
            );
          },
        },
        media: {
          query(projectId, input) {
            mediaQueries.push({ projectId, input });
            return MediaQueryDefinition.parseSuccess(MediaQueryDefinition.examples.success);
          },
        },
        memory: fixture.data.memory,
        operations: {
          query(projectId, currentRunId, input) {
            operationQueries.push({ projectId, runId: currentRunId, input });
            return OperationGetDefinition.parseSuccess(OperationGetDefinition.examples.success);
          },
        },
        production: {
          queryTool(projectId, input) {
            productionQueries.push({ projectId, input });
            return ProductionQueryDefinition.parseSuccess(
              ProductionQueryDefinition.examples.success,
            );
          },
        },
        providerCapabilities: {
          query(input) {
            providerCapabilityQueries.push(input);
            return Promise.resolve(
              ProviderCapabilitiesDefinition.parseSuccess(
                ProviderCapabilitiesDefinition.examples.success,
              ),
            );
          },
        },
        projects: {
          getTool(projectId, input) {
            projectGets.push({ projectId, input });
            return ProjectGetDefinition.parseSuccess(ProjectGetDefinition.examples.success);
          },
        },
        results: fixture.data.results,
        search: {
          query(projectId, input) {
            searchQueries.push({ projectId, input });
            return ProjectSearchDefinition.parseSuccess(ProjectSearchDefinition.examples.success);
          },
        },
        runReplay: {
          get(id) {
            replayReads += 1;
            return fixture.data.runReplay.get(id);
          },
          inspect(id, input) {
            runInspections.push({ id, input });
            return RunInspectDefinition.parseSuccess(RunInspectDefinition.examples.success);
          },
        },
      });
      expect(executor.toolIds).toEqual(STORAGE_READ_IDS);
      expect(executor.initialToolIds).toEqual(INITIAL_STORAGE_READ_IDS);
      const canvasInput = CanvasQueryDefinition.parseInput(CanvasQueryDefinition.examples.input);
      expect(
        executor.execute(toolExecution(project.id, CanvasQueryDefinition.id, canvasInput)),
      ).toEqual(
        CanvasQueryDefinition.parseOutcome({
          status: 'succeeded',
          data: CanvasQueryDefinition.examples.success,
        }),
      );
      expect(canvasQueries).toEqual([{ projectId: project.id, input: canvasInput }]);
      expect(() =>
        executor.execute({
          ...toolExecution(project.id, CanvasQueryDefinition.id, canvasInput),
          toolVersion: '9.0.0',
        }),
      ).toThrow('Target storage read tool canvas.query@9.0.0 is unavailable');
      expect(() =>
        executor.execute(
          toolExecution(
            project.id,
            CanvasQueryDefinition.id,
            CanvasQueryDefinition.parseInput({ ...canvasInput, include: ['groups'] }),
          ),
        ),
      ).toThrow('unrequested item kind');
      const deliveryInput = DeliveryQueryDefinition.parseInput(
        DeliveryQueryDefinition.examples.input,
      );
      expect(
        executor.execute(toolExecution(project.id, DeliveryQueryDefinition.id, deliveryInput)),
      ).toEqual(
        DeliveryQueryDefinition.parseOutcome({
          status: 'succeeded',
          data: DeliveryQueryDefinition.examples.success,
        }),
      );
      expect(deliveryQueries).toEqual([{ projectId: project.id, input: deliveryInput }]);
      expect(
        await executor.execute(
          toolExecution(project.id, MemoryQueryDefinition.id, MemoryQueryDefinition.examples.input),
        ),
      ).toEqual(
        MemoryQueryDefinition.parseOutcome({
          status: 'succeeded',
          data: { state: 'unavailable', reason: 'not_built' },
        }),
      );
      expect(
        await executor.execute(
          toolExecution(project.id, ResultQueryDefinition.id, ResultQueryDefinition.examples.input),
        ),
      ).toEqual(
        ResultQueryDefinition.parseOutcome({
          status: 'succeeded',
          data: { items: [], nextCursor: null },
        }),
      );
      const generationQuoteInput = GenerationQuoteDefinition.parseInput(
        GenerationQuoteDefinition.examples.input,
      );
      expect(
        await executor.execute({
          ...toolExecution(project.id, GenerationQuoteDefinition.id, generationQuoteInput),
          runId,
        }),
      ).toEqual(
        GenerationQuoteDefinition.parseOutcome({
          status: 'succeeded',
          data: GenerationQuoteDefinition.examples.success,
        }),
      );
      expect(generationQuotes).toEqual([{ runId, request: generationQuoteInput }]);
      expect(generationQuoteSignal).toBeUndefined();
      const mediaInspectInput = MediaInspectDefinition.parseInput(
        MediaInspectDefinition.examples.input,
      );
      expect(
        await executor.execute({
          ...toolExecution(project.id, MediaInspectDefinition.id, mediaInspectInput),
          runId,
        }),
      ).toEqual(
        MediaInspectDefinition.parseOutcome({
          status: 'succeeded',
          data: MediaInspectDefinition.examples.success,
        }),
      );
      expect(mediaInspections).toEqual([{ runId, input: mediaInspectInput }]);
      const operationGetInput = OperationGetDefinition.parseInput(
        OperationGetDefinition.examples.input,
      );
      expect(
        executor.execute({
          ...toolExecution(project.id, OperationGetDefinition.id, operationGetInput),
          runId,
        }),
      ).toEqual(
        OperationGetDefinition.parseOutcome({
          status: 'succeeded',
          data: OperationGetDefinition.examples.success,
        }),
      );
      expect(operationQueries).toEqual([
        { projectId: project.id, runId, input: operationGetInput },
      ]);
      const projectGetInput = ProjectGetDefinition.parseInput(ProjectGetDefinition.examples.input);
      expect(
        executor.execute(toolExecution(project.id, ProjectGetDefinition.id, projectGetInput)),
      ).toEqual(
        ProjectGetDefinition.parseOutcome({
          status: 'succeeded',
          data: ProjectGetDefinition.examples.success,
        }),
      );
      expect(projectGets).toEqual([{ projectId: project.id, input: projectGetInput }]);
      expect(() =>
        executor.execute(
          toolExecution(
            project.id,
            ProjectGetDefinition.id,
            ProjectGetDefinition.parseInput({ include: ['metadata'] }),
          ),
        ),
      ).toThrow('storage sections do not match requested includes');
      const searchInput = ProjectSearchDefinition.parseInput(
        ProjectSearchDefinition.examples.input,
      );
      expect(
        executor.execute(toolExecution(project.id, ProjectSearchDefinition.id, searchInput)),
      ).toEqual(
        ProjectSearchDefinition.parseOutcome({
          status: 'succeeded',
          data: ProjectSearchDefinition.examples.success,
        }),
      );
      expect(searchQueries).toEqual([{ projectId: project.id, input: searchInput }]);
      const mediaInput = MediaQueryDefinition.parseInput(MediaQueryDefinition.examples.input);
      expect(
        executor.execute(toolExecution(project.id, MediaQueryDefinition.id, mediaInput)),
      ).toEqual(
        MediaQueryDefinition.parseOutcome({
          status: 'succeeded',
          data: MediaQueryDefinition.examples.success,
        }),
      );
      expect(mediaQueries).toEqual([{ projectId: project.id, input: mediaInput }]);
      const productionInput = ProductionQueryDefinition.parseInput(
        ProductionQueryDefinition.examples.input,
      );
      expect(
        executor.execute(toolExecution(project.id, ProductionQueryDefinition.id, productionInput)),
      ).toEqual(
        ProductionQueryDefinition.parseOutcome({
          status: 'succeeded',
          data: ProductionQueryDefinition.examples.success,
        }),
      );
      expect(productionQueries).toEqual([{ projectId: project.id, input: productionInput }]);
      expect(() =>
        executor.execute(
          toolExecution(
            project.id,
            ProductionQueryDefinition.id,
            ProductionQueryDefinition.parseInput({ ...productionInput, include: ['content'] }),
          ),
        ),
      ).toThrow('storage sections do not match requested includes');
      const providerCapabilitiesInput = ProviderCapabilitiesDefinition.parseInput(
        ProviderCapabilitiesDefinition.examples.input,
      );
      expect(
        await executor.execute(
          toolExecution(project.id, ProviderCapabilitiesDefinition.id, providerCapabilitiesInput),
        ),
      ).toEqual(
        ProviderCapabilitiesDefinition.parseOutcome({
          status: 'succeeded',
          data: ProviderCapabilitiesDefinition.examples.success,
        }),
      );
      expect(providerCapabilityQueries).toEqual([providerCapabilitiesInput]);
      const chatQueryInput = ChatQueryDefinition.parseInput(ChatQueryDefinition.examples.input);
      expect(
        await executor.execute({
          ...toolExecution(project.id, ChatQueryDefinition.id, chatQueryInput),
          runId,
        }),
      ).toEqual(
        ChatQueryDefinition.parseOutcome({
          status: 'succeeded',
          data: ChatQueryDefinition.examples.success,
        }),
      );
      expect(chatQueries).toEqual([
        {
          projectId: project.id,
          defaultChatId: acceptedRun.chatId,
          input: chatQueryInput,
        },
      ]);
      expect(replayReads).toBe(1);
      const runInspectInput = RunInspectDefinition.parseInput(RunInspectDefinition.examples.input);
      expect(
        await executor.execute({
          ...toolExecution(project.id, RunInspectDefinition.id, runInspectInput),
          runId,
        }),
      ).toEqual(
        RunInspectDefinition.parseOutcome({
          status: 'succeeded',
          data: RunInspectDefinition.examples.success,
        }),
      );
      expect(runInspections).toEqual([{ id: runId, input: runInspectInput }]);
      expect(replayReads).toBe(2);
      expect(() =>
        executor.execute({
          ...toolExecution('project.other', RunInspectDefinition.id, runInspectInput),
          runId,
        }),
      ).toThrow('Run replay identity mismatch');
      expect(runInspections).toHaveLength(1);
      expect(replayReads).toBe(3);
      const replay = fixture.data.runReplay.get(runId);
      const names = [ProjectGetDefinition.id, HistoryQueryDefinition.id] as const;
      expect(
        await executor.execute({
          ...toolExecution(
            project.id,
            ToolGetDefinition.id,
            ToolGetDefinition.parseInput({ names }),
          ),
          runId: replay.run.id,
        }),
      ).toEqual(
        ToolGetDefinition.parseOutcome({
          status: 'succeeded',
          data: {
            definitions: names.map((name) => replay.catalog.tools.find(({ id }) => id === name)),
            catalogHash: replay.catalog.catalogHash,
          },
        }),
      );
      expect(replayReads).toBe(4);
      const missingExecutor = createTargetStorageReadToolExecutor({
        canvas: fixture.data.canvas,
        conversations: fixture.data.conversations,
        delivery: fixture.data.delivery,
        generation: fixture.data.generation,
        history: fixture.data.history,
        media: fixture.data.media,
        memory: fixture.data.memory,
        operations: fixture.data.operations,
        production: fixture.data.production,
        projects: fixture.data.projects,
        results: fixture.data.results,
        search: fixture.data.search,
        runReplay: {
          inspect: fixture.data.runReplay.inspect,
          get() {
            return {
              ...replay,
              catalog: {
                ...replay.catalog,
                tools: replay.catalog.tools.filter(({ id }) => id !== ProjectGetDefinition.id),
              },
            } as typeof replay;
          },
        },
      });
      expect(() =>
        missingExecutor.execute({
          ...toolExecution(
            project.id,
            ToolGetDefinition.id,
            ToolGetDefinition.parseInput({ names: [ProjectGetDefinition.id] }),
          ),
          runId,
        }),
      ).toThrow(`Frozen tool was not found: ${ProjectGetDefinition.id}`);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('loads requested frozen skills in input order from exactly one Run replay', async () => {
    const { fixture, project, runId } = await activeRuntimeFixture(SKILL_CATALOG);
    let replayReads = 0;
    try {
      const executor = createTargetStorageReadToolExecutor({
        canvas: fixture.data.canvas,
        conversations: fixture.data.conversations,
        delivery: fixture.data.delivery,
        generation: fixture.data.generation,
        history: fixture.data.history,
        media: fixture.data.media,
        memory: fixture.data.memory,
        operations: fixture.data.operations,
        production: fixture.data.production,
        projects: fixture.data.projects,
        results: fixture.data.results,
        search: fixture.data.search,
        runReplay: {
          inspect: fixture.data.runReplay.inspect,
          get(id) {
            replayReads += 1;
            return fixture.data.runReplay.get(id);
          },
        },
      });
      const input = SkillLoadDefinition.parseInput({ skillIds: ['skill.beta', 'skill.alpha'] });
      expect(
        executor.execute({ ...toolExecution(project.id, SkillLoadDefinition.id, input), runId }),
      ).toEqual(
        SkillLoadDefinition.parseOutcome({
          status: 'succeeded',
          data: {
            skills: [SKILLS[1], SKILLS[0]],
            skillCatalogDigest: SKILL_CATALOG.skillCatalogDigest,
          },
        }),
      );
      expect(replayReads).toBe(1);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects missing and ambiguous frozen skill identities', async () => {
    const missing = await activeRuntimeFixture(SKILL_CATALOG);
    try {
      const missingExecutor = createTargetStorageReadToolExecutor(missing.fixture.data);
      expect(() =>
        missingExecutor.execute({
          ...toolExecution(
            missing.project.id,
            SkillLoadDefinition.id,
            SkillLoadDefinition.parseInput({ skillIds: ['skill.missing'] }),
          ),
          runId: missing.runId,
        }),
      ).toThrow('Frozen skill was not found: skill.missing');

      const replay = missing.fixture.data.runReplay.get(missing.runId);
      const ambiguousExecutor = createTargetStorageReadToolExecutor({
        canvas: missing.fixture.data.canvas,
        conversations: missing.fixture.data.conversations,
        delivery: missing.fixture.data.delivery,
        generation: missing.fixture.data.generation,
        history: missing.fixture.data.history,
        media: missing.fixture.data.media,
        memory: missing.fixture.data.memory,
        operations: missing.fixture.data.operations,
        production: missing.fixture.data.production,
        projects: missing.fixture.data.projects,
        results: missing.fixture.data.results,
        search: missing.fixture.data.search,
        runReplay: {
          inspect: missing.fixture.data.runReplay.inspect,
          get() {
            return {
              ...replay,
              catalog: {
                ...replay.catalog,
                skills: [
                  SKILLS[0],
                  { ...SKILLS[0], version: '2.0.0', contentHash: 'c'.repeat(64) },
                ],
              },
            } as typeof replay;
          },
        },
      });
      expect(() =>
        ambiguousExecutor.execute({
          ...toolExecution(
            missing.project.id,
            SkillLoadDefinition.id,
            SkillLoadDefinition.parseInput({ skillIds: ['skill.alpha'] }),
          ),
          runId: missing.runId,
        }),
      ).toThrow('Frozen skill identity is ambiguous: skill.alpha');
    } finally {
      missing.fixture.store.close();
      await rm(missing.fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects every mismatched Run replay identity and frozen skill.load version', async () => {
    const { fixture, project, runId } = await activeRuntimeFixture(SKILL_CATALOG);
    try {
      const replay = fixture.data.runReplay.get(runId);
      const execution = {
        ...toolExecution(
          project.id,
          SkillLoadDefinition.id,
          SkillLoadDefinition.parseInput({ skillIds: ['skill.alpha'] }),
        ),
        runId,
      };
      const mismatches = [
        { name: 'execution Run', execution: { ...execution, runId: 'run.other' }, replay },
        {
          name: 'execution Project',
          execution: { ...execution, projectId: 'project.other' },
          replay,
        },
        {
          name: 'Manifest Run',
          execution,
          replay: { ...replay, manifest: { ...replay.manifest, runId: 'run.other' } },
        },
        {
          name: 'Manifest Project',
          execution,
          replay: { ...replay, manifest: { ...replay.manifest, projectId: 'project.other' } },
        },
        {
          name: 'Manifest catalog ID',
          execution,
          replay: {
            ...replay,
            manifest: {
              ...replay.manifest,
              capabilityCatalogSnapshotId: 'catalog.other',
            },
          },
        },
        {
          name: 'Manifest catalog hash',
          execution,
          replay: {
            ...replay,
            manifest: { ...replay.manifest, capabilityCatalogHash: 'd'.repeat(64) },
          },
        },
        {
          name: 'catalog hash',
          execution,
          replay: {
            ...replay,
            catalog: { ...replay.catalog, catalogHash: 'd'.repeat(64) },
          },
        },
        {
          name: 'skill catalog digest',
          execution,
          replay: {
            ...replay,
            catalog: { ...replay.catalog, skillCatalogDigest: 'd'.repeat(64) },
          },
        },
        {
          name: 'skill.load version',
          execution,
          replay: {
            ...replay,
            catalog: {
              ...replay.catalog,
              tools: replay.catalog.tools.map((tool) =>
                tool.id === SkillLoadDefinition.id ? { ...tool, version: '2.0.0' } : tool,
              ),
            },
          },
        },
      ];

      for (const mismatch of mismatches) {
        let replayReads = 0;
        const executor = createTargetStorageReadToolExecutor({
          canvas: fixture.data.canvas,
          conversations: fixture.data.conversations,
          delivery: fixture.data.delivery,
          generation: fixture.data.generation,
          history: fixture.data.history,
          media: fixture.data.media,
          memory: fixture.data.memory,
          operations: fixture.data.operations,
          production: fixture.data.production,
          projects: fixture.data.projects,
          results: fixture.data.results,
          search: fixture.data.search,
          runReplay: {
            inspect: fixture.data.runReplay.inspect,
            get() {
              replayReads += 1;
              return mismatch.replay as typeof replay;
            },
          },
        });
        expect(
          () => executor.execute(mismatch.execution),
          `Expected ${mismatch.name} mismatch to fail`,
        ).toThrow();
        expect(replayReads).toBe(1);
      }
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    { name: 'empty', toolIds: [] as readonly ToolId[] },
    {
      name: 'duplicate',
      toolIds: [HistoryQueryDefinition.id, HistoryQueryDefinition.id] as readonly ToolId[],
    },
    { name: 'unknown', toolIds: ['unknown.read' as ToolId] as readonly ToolId[] },
    { name: 'unsafe', toolIds: [GenerationSubmitDefinition.id] as readonly ToolId[] },
  ])(
    'rejects $name executor toolIds before any write or model call',
    async ({ toolIds }) => {
      const { fixture, context, runId } = await activeRuntimeFixture();
      const model = new FakeModelAdapter();
      let executeCount = 0;
      try {
        const before = fixture.data.harness.loadActivation(runId, 1);
        await expect(
          runTargetActivation(
            {
              persistence: fixture.data.harness,
              model,
              toolExecutor: fakeToolExecutor(toolIds, () => {
                executeCount += 1;
                throw new Error('Illegal executor capabilities must not execute');
              }),
            },
            {
              runId,
              activationNumber: 1,
              limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
              context,
            },
          ),
        ).rejects.toThrow();
        expect(fixture.data.harness.loadActivation(runId, 1)).toEqual(before);
        expect(model.quoted).toEqual([]);
        expect(model.streamed).toEqual([]);
        expect(executeCount).toBe(0);
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('propagates storage failures and leaves the prepared dispatch recoverable', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter();
    const storageFailure = new Error('simulated public history read failure');
    try {
      await expect(
        runTargetActivation(
          {
            persistence: fixture.data.harness,
            model,
            toolExecutor: createTargetStorageReadToolExecutor({
              canvas: fixture.data.canvas,
              conversations: fixture.data.conversations,
              delivery: fixture.data.delivery,
              generation: fixture.data.generation,
              history: {
                query() {
                  throw storageFailure;
                },
              },
              media: fixture.data.media,
              memory: fixture.data.memory,
              operations: fixture.data.operations,
              production: fixture.data.production,
              projects: fixture.data.projects,
              results: fixture.data.results,
              search: fixture.data.search,
              runReplay: fixture.data.runReplay,
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toBe(storageFailure);
      const after = fixture.data.harness.loadActivation(runId, 1);
      expect(model.quoted).toHaveLength(1);
      expect(model.streamed).toHaveLength(1);
      expect(after.modelAttempts).toMatchObject([{ state: 'succeeded' }]);
      expect(after.dispatches).toMatchObject([
        {
          key: { toolId: 'history.query', authorityWatermarkHash: null },
          outcome: null,
          outcomeHash: null,
        },
      ]);
      expect(after.facts.map(({ type }) => type)).toEqual(['message', 'tool_call']);
      expect(
        after.journal.flatMap(({ payloadState }) =>
          payloadState.state === 'available' && payloadState.payload.type === 'tool_result_ref'
            ? [payloadState.payload]
            : [],
        ),
      ).toEqual([]);
      expect(after.recoveryRequired).toBe(true);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('runs project.search through both attempts and returns its durable facts to the model', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(
      toolResponse(ProjectSearchDefinition.id, ProjectSearchDefinition.examples.input),
    );
    const executions: TargetToolExecution[] = [];
    try {
      const finalSnapshot = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], (execution) => {
            executions.push(execution);
            ProjectSearchDefinition.parseInput(execution.input);
            return ProjectSearchDefinition.parseOutcome({
              status: 'succeeded',
              data: { items: [], nextCursor: null },
            });
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(executions).toHaveLength(1);
      expect(executions[0]).toMatchObject({
        toolId: 'project.search',
        input: ProjectSearchDefinition.examples.input,
        authorityWatermarkHash: null,
      });
      expect(executions[0]!.operationFingerprint).toBe(
        finalSnapshot.dispatches[0]!.key.fingerprint,
      );
      expect(executions[0]).not.toHaveProperty('idempotencyKey');
      expect(model.streamed).toHaveLength(2);
      expect(model.streamed[0]!.facts.map(({ type }) => type)).toEqual(['message']);
      expect(model.streamed[1]!.facts.map(({ type }) => type)).toEqual([
        'message',
        'tool_call',
        'tool_result',
      ]);
      expect(finalSnapshot.facts.map(({ type }) => type)).toEqual([
        'message',
        'tool_call',
        'tool_result',
        'message',
      ]);
      expect(finalSnapshot.modelAttempts.map(({ state }) => state)).toEqual([
        'succeeded',
        'succeeded',
      ]);
      expect(finalSnapshot.dispatches).toMatchObject([
        { key: { toolId: 'project.search' }, outcome: { status: 'succeeded' } },
      ]);
      expect(finalSnapshot.run.status).toBe('completed');
      expect(finalSnapshot.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('runs a run.inspect read through the generalized executor', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(
      toolResponse(RunInspectDefinition.id, RunInspectDefinition.examples.input),
    );
    const executions: TargetToolExecution[] = [];
    try {
      const finalSnapshot = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([RunInspectDefinition.id], (execution) => {
            executions.push(execution);
            RunInspectDefinition.parseInput(execution.input);
            return RunInspectDefinition.parseOutcome({
              status: 'succeeded',
              data: RunInspectDefinition.examples.success,
            });
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(executions).toMatchObject([{ toolId: 'run.inspect' }]);
      expect(finalSnapshot.modelAttempts).toHaveLength(2);
      expect(finalSnapshot.dispatches).toMatchObject([
        { key: { toolId: 'run.inspect' }, outcome: { status: 'succeeded' } },
      ]);
      expect(finalSnapshot.run.status).toBe('completed');
      expect(finalSnapshot.activation.state).toBe('ended');
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    ProjectSearchDefinition.parseOutcome({
      status: 'retryable_failure',
      code: 'temporarily_unavailable',
      message: 'Retry after the next model decision.',
      retryAfterMs: 1_000,
    }),
    ProjectSearchDefinition.parseOutcome({
      status: 'validation_failed',
      issues: [
        {
          fieldSegments: ['query'],
          code: 'invalid_query',
          message: 'The query must be revised.',
        },
      ],
    }),
  ] satisfies readonly RuntimeLoopOutcome[])(
    'persists expected $status and still gives the model a second round',
    async (outcome) => {
      const { fixture, context, runId } = await activeRuntimeFixture();
      const model = new FakeModelAdapter(
        toolResponse(ProjectSearchDefinition.id, ProjectSearchDefinition.examples.input),
      );
      try {
        const finalSnapshot = await runTargetActivation(
          {
            persistence: fixture.data.harness,
            model,
            toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], () => outcome),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        );
        expect(model.streamed).toHaveLength(2);
        expect(finalSnapshot.modelAttempts).toHaveLength(2);
        expect(finalSnapshot.dispatches[0]!.outcome).toEqual(outcome);
        expect(finalSnapshot.run.status).toBe('completed');
        expect(finalSnapshot.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
        expect(model.streamed[1]!.facts.map(({ type }) => type)).toEqual([
          'message',
          'tool_call',
          'tool_result',
        ]);
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('completes directly when the first Model Attempt stops without tool work', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(FINAL_RESPONSE);
    let executeCount = 0;
    try {
      const before = fixture.data.conversations.listMessages({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3k1.invalid.messages.before',
        method: 'message.list',
        input: {
          chatId: fixture.data.harness.loadActivation(runId, 1).run.chatId,
          beforeSequence: null,
          page: { cursor: null, limit: 100 },
        },
      }).result.items;

      const after = await runTargetActivation(
        {
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ProjectGetDefinition.id], async () => {
            executeCount += 1;
            throw new Error('The ToolExecutor must not run for a direct final response');
          }),
        },
        {
          runId,
          activationNumber: 1,
          limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
          context,
        },
      );

      expect(model.quoted).toHaveLength(1);
      expect(model.streamed).toHaveLength(1);
      expect(executeCount).toBe(0);
      expect(after.modelAttempts).toHaveLength(1);
      expect(after.modelAttempts[0]).toMatchObject({ state: 'succeeded' });
      expect(after.dispatches).toEqual([]);
      expect(after.run).toMatchObject({
        status: 'completed',
        terminalOutcome: { status: 'completed', summary: 'The read completed.' },
      });
      expect(after.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
      expect(after.recoveryRequired).toBe(false);
      const messagesAfter = fixture.data.conversations.listMessages({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3k1.direct.messages.after',
        method: 'message.list',
        input: {
          chatId: after.run.chatId,
          beforeSequence: null,
          page: { cursor: null, limit: 100 },
        },
      }).result.items;
      expect(messagesAfter).toHaveLength(before.length + 1);
      expect(messagesAfter.at(-1)).toMatchObject({
        role: 'assistant',
        status: 'completed',
        originatingRunId: runId,
        blocks: [{ type: 'text', text: 'The read completed.' }],
      });
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('settles a terminal model_failed response as a failed Run without entering a tool boundary', async () => {
    const { fixture, context, runId } = await acceptedRuntimeFixture();
    const model = new FakeModelAdapter([
      { type: 'usage', usage: USAGE },
      {
        type: 'model_failed',
        typedCode: 'provider_rejected',
        retrySafety: 'never',
        providerState: 'terminal',
      },
    ]);
    let executeCount = 0;
    try {
      const result = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model,
          toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], () => {
            executeCount += 1;
            throw new Error('A model failure must not execute a tool');
          }),
        },
        { runId, limits: { maxInputTokens: 2_000, maxOutputTokens: 500 }, context },
      );

      if (result.kind !== 'executed') throw new Error('Expected the failed Run to settle');
      expect(executeCount).toBe(0);
      expect(model.streamed).toHaveLength(1);
      expect(result.snapshot.modelAttempts).toMatchObject([
        {
          state: 'failed',
          response: {
            events: [
              { type: 'usage', usage: USAGE },
              { type: 'model_failed', typedCode: 'provider_rejected', providerState: 'terminal' },
            ],
          },
        },
      ]);
      expect(result.snapshot.dispatches).toEqual([]);
      expect(result.snapshot.run).toMatchObject({
        status: 'failed',
        terminalOutcome: { status: 'failed', summary: 'Model attempt failed: provider_rejected.' },
      });
      expect(result.snapshot.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
      expect(result.snapshot.recoveryRequired).toBe(false);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('forwards one abort signal to an in-flight Model Attempt without scheduling a retry', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const controller = new AbortController();
    let quoteSignal: AbortSignal | undefined;
    let streamSignal: AbortSignal | undefined;
    let markStreamStarted: (() => void) | undefined;
    const streamStarted = new Promise<void>((resolve) => {
      markStreamStarted = resolve;
    });
    const model: TargetModelAdapter = {
      provider: {
        providerId: PROVIDER_ID,
        model: PROVIDER_MODEL,
        reasoningStrength: null,
      },
      async quote(_request, _privateContext, signal?: AbortSignal) {
        quoteSignal = signal;
        return USAGE;
      },
      async *stream(_request, _privateContext, signal?: AbortSignal) {
        streamSignal = signal;
        markStreamStarted?.();
        if (signal === undefined) {
          yield* FINAL_RESPONSE;
          return;
        }
        if (!signal.aborted) {
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', resolve, { once: true }),
          );
        }
      },
    };
    const running = runTargetActivation(
      {
        persistence: fixture.data.harness,
        model,
        toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], () => {
          throw new Error('An aborted Model Attempt must not execute a tool');
        }),
      },
      {
        runId,
        activationNumber: 1,
        limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
        context,
        signal: controller.signal,
      },
    );
    try {
      await streamStarted;
      expect(quoteSignal).toBe(controller.signal);
      expect(streamSignal).toBe(controller.signal);
      controller.abort();

      const after = await running;
      expect(after.modelAttempts).toMatchObject([{ state: 'running', response: null }]);
      expect(after.run).toMatchObject({ status: 'running' });
      expect(after.activation).toMatchObject({ state: 'active' });
      expect(after.recoveryRequired).toBe(true);
      expect(fixture.data.harness.loadActivation(runId, 1).modelAttempts).toHaveLength(1);
    } finally {
      controller.abort();
      await running;
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('forwards abort to a generation owner and leaves its boundary unsettled for recovery', async () => {
    let markSubmissionStarted: (() => void) | undefined;
    const submissionStarted = new Promise<void>((resolve) => {
      markSubmissionStarted = resolve;
    });
    const provider = new (class extends FakeGenerationProvider {
      seenSignal: AbortSignal | undefined;

      async submit(_request: unknown, signal?: AbortSignal): Promise<GenerationProviderState> {
        this.submitCalls += 1;
        this.seenSignal = signal;
        markSubmissionStarted?.();
        if (signal === undefined)
          throw new Error('Generation owner did not receive an AbortSignal');
        if (!signal.aborted) {
          await new Promise<void>((resolve) =>
            signal.addEventListener('abort', resolve, { once: true }),
          );
        }
        throw new Error('simulated generation provider interruption');
      }
    })();
    const dependencies = {
      ...createJourneyDependencies(),
      generation: provider,
    } satisfies JourneyDependencies;
    const state = await acceptedRuntimeFixture(ROOT_CATALOG, dependencies);
    const { fixture, context, runId } = state;
    const input = await seedGenerationSubmitInput(state);
    const controller = new AbortController();
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        ToolGetDefinition.parseInput({ names: [GenerationSubmitDefinition.id] }),
        'provider-call.tool-get.generation-abort',
      ),
      [toolResponse(GenerationSubmitDefinition.id, input, 'provider-call.generation-submit.abort')],
    );
    const running = coordinateRun(
      {
        runs: fixture.data.runs,
        persistence: fixture.data.harness,
        model,
        toolExecutor: createTargetStorageReadToolExecutor(fixture.data),
        generation: fixture.data.generation,
      },
      {
        runId,
        limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
        context,
        signal: controller.signal,
      },
    );
    try {
      await submissionStarted;
      expect(provider.seenSignal).toBe(controller.signal);
      controller.abort();

      const result = await running;
      if (result.kind !== 'executed')
        throw new Error('Expected aborted generation owner execution');
      const snapshot = fixture.data.harness.loadActivation(runId, 1);
      expect(
        snapshot.dispatches.find(({ key }) => key.toolId === GenerationSubmitDefinition.id),
      ).toMatchObject({
        outcome: null,
      });
      expect(snapshot).toMatchObject({
        run: { status: 'running' },
        activation: { state: 'active' },
        recoveryRequired: true,
      });
      expect(
        getJourneyTestDatabase(fixture.store)
          .prepare('SELECT state FROM generation_attempts')
          .get(),
      ).toEqual({ state: 'unknown' });
    } finally {
      controller.abort();
      await running;
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 60_000);

  it('settles an in-flight Model Attempt on pause, then resumes the same Activation without a stranded reservation', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    let releaseStream!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    let markStreamStarted!: () => void;
    const streamStarted = new Promise<void>((resolve) => {
      markStreamStarted = resolve;
    });
    const executor = fakeToolExecutor([HistoryQueryDefinition.id], () => {
      throw new Error('A paused Run must not start its prepared Tool dispatch');
    });
    const pausedModel = new FakeModelAdapter(
      toolResponse(
        HistoryQueryDefinition.id,
        HISTORY_QUERY_INPUT,
        'provider-call.pause-safe-boundary',
      ),
      [],
      async () => {
        markStreamStarted();
        await release;
      },
    );
    const running = runTargetActivation(
      {
        persistence: fixture.data.harness,
        model: pausedModel,
        toolExecutor: executor,
      },
      {
        runId,
        activationNumber: 1,
        limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
        context,
      },
    );
    try {
      await streamStarted;
      const beforePause = fixture.data.harness.loadActivation(runId, 1).run;
      const pause = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.pause.in-flight-model',
          method: 'run.control',
          input: {
            runId,
            expectedRevision: beforePause.revision,
            action: 'pause',
            expectedStatus: 'running',
          },
        },
        userContext,
      );
      expect(pause.result.status).toBe('paused');
      releaseStream();

      const paused = await running;
      expect(paused.run.status).toBe('paused');
      expect(paused.activation).toMatchObject({ state: 'active', activationNumber: 1 });
      expect(paused.modelAttempts).toMatchObject([{ state: 'cancelled' }]);
      expect(paused.dispatches).toEqual([]);
      expect(paused.resourceExposure).toMatchObject({ inputTokens: 120n, outputTokens: 24n });

      const resume = fixture.data.runs.control(
        {
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.runtime.resume.in-flight-model',
          method: 'run.control',
          input: {
            runId,
            expectedRevision: pause.result.revision,
            action: 'resume',
            expectedStatus: 'paused',
          },
        },
        userContext,
      );
      expect(resume.result.status).toBe('running');
      const resumedModel = new FakeModelAdapter(FINAL_RESPONSE);
      const completed = await coordinateRun(
        {
          runs: fixture.data.runs,
          persistence: fixture.data.harness,
          model: resumedModel,
          toolExecutor: executor,
        },
        { runId, limits: { maxInputTokens: 2_000, maxOutputTokens: 500 }, context },
      );
      if (completed.kind !== 'executed') throw new Error('Expected the paused Run to resume');
      expect(completed.snapshot.run.status).toBe('completed');
      expect(completed.snapshot.activation).toMatchObject({
        state: 'ended',
        endReason: 'terminal',
      });
      expect(completed.snapshot.modelAttempts).toHaveLength(2);
      expect(completed.snapshot.recoveryRequired).toBe(false);
    } finally {
      releaseStream();
      await running.catch(() => undefined);
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it.each(['length', 'content_filter'] as const)(
    'keeps settled work durable when a later Model Attempt ends with %s',
    async (finishReason) => {
      const { fixture, context, runId } = await activeRuntimeFixture();
      const model = new FakeModelAdapter(
        toolResponse(
          ProjectSearchDefinition.id,
          ProjectSearchDefinition.examples.input,
          'provider-call.project-search.before-interruption',
        ),
        [interruptedResponse(finishReason)],
      );
      let executeCount = 0;
      try {
        await expect(
          runTargetActivation(
            {
              persistence: fixture.data.harness,
              model,
              toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], () => {
                executeCount += 1;
                return ProjectSearchDefinition.parseOutcome({
                  status: 'succeeded',
                  data: { items: [], nextCursor: null },
                });
              }),
            },
            {
              runId,
              activationNumber: 1,
              limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
              context,
            },
          ),
        ).rejects.toThrow('stop or request exactly one');

        const after = fixture.data.harness.loadActivation(runId, 1);
        expect(model.streamed).toHaveLength(2);
        expect(executeCount).toBe(1);
        expect(after.modelAttempts).toMatchObject([
          { state: 'succeeded' },
          { state: 'running', response: null },
        ]);
        expect(after.dispatches).toMatchObject([{ outcome: { status: 'succeeded' } }]);
        expect(after.facts.map(({ type }) => type)).toEqual([
          'message',
          'tool_call',
          'tool_result',
        ]);
        expect(after.run.status).toBe('running');
        expect(after.activation.state).toBe('active');
        expect(after.recoveryRequired).toBe(true);
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.each([
    {
      name: 'receipt-aware operation.get',
      events: toolResponse(OperationGetDefinition.id, OperationGetDefinition.examples.input),
    },
    {
      name: 'unmaterialized generation.submit',
      events: toolResponse(
        GenerationSubmitDefinition.id,
        GenerationSubmitDefinition.examples.input,
      ),
    },
    {
      name: 'invalid project.search input',
      events: toolResponse(ProjectSearchDefinition.id, {
        ...ProjectSearchDefinition.examples.input,
        query: '',
      }),
    },
    {
      name: 'two safe R calls',
      events: [
        {
          type: 'tool_call' as const,
          providerCallId: 'provider-call.project-search.first',
          toolId: ProjectSearchDefinition.id,
          canonicalArguments: ProjectSearchDefinition.examples.input,
        },
        {
          type: 'tool_call' as const,
          providerCallId: 'provider-call.run-inspect.second',
          toolId: RunInspectDefinition.id,
          canonicalArguments: RunInspectDefinition.examples.input,
        },
        { type: 'usage' as const, usage: USAGE },
        { type: 'model_completed' as const, finishReason: 'tool_calls' as const },
      ],
    },
  ])(
    'rejects $name before model settlement or executor work',
    async ({ events }) => {
      const { fixture, context, runId } = await activeRuntimeFixture();
      const model = new FakeModelAdapter(events);
      let executeCount = 0;
      try {
        await expect(
          runTargetActivation(
            {
              persistence: fixture.data.harness,
              model,
              toolExecutor: fakeToolExecutor(
                [ProjectSearchDefinition.id, RunInspectDefinition.id],
                async () => {
                  executeCount += 1;
                  throw new Error('Invalid first response must not reach the executor');
                },
              ),
            },
            {
              runId,
              activationNumber: 1,
              limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
              context,
            },
          ),
        ).rejects.toThrow();
        const after = fixture.data.harness.loadActivation(runId, 1);
        expect(executeCount).toBe(0);
        expect(after.modelAttempts).toMatchObject([{ state: 'running', response: null }]);
        expect(after.dispatches).toEqual([]);
        expect(after.recoveryRequired).toBe(true);
      } finally {
        fixture.store.close();
        await rm(fixture.directory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('closes a running Model Attempt and accepts exactly one queued retry without model seams', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(LENGTH_RESPONSE);
    let executeCount = 0;
    try {
      await expect(
        runTargetActivation(
          {
            persistence: fixture.data.harness,
            model,
            toolExecutor: fakeToolExecutor([ProjectGetDefinition.id], async () => {
              executeCount += 1;
              throw new Error('Recovery fixture must not execute project.get');
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('exactly one');
      const interrupted = fixture.data.harness.loadActivation(runId, 1);
      expect(interrupted.modelAttempts).toMatchObject([{ state: 'running' }]);
      const input = recoveryInput(interrupted, context, 'running');
      const { calls, dependencies } = recoveryDependencies(fixture.data.harness);
      const modelCalls = { quoted: model.quoted.length, streamed: model.streamed.length };

      const first = recoverTargetActivation(dependencies, input);
      expect(first.closed).toMatchObject({
        run: { id: runId, status: 'blocked' },
        activation: { state: 'ended', endReason: 'process_exit' },
        frontier: { kind: 'model_attempt', state: 'running' },
      });
      expect(first.retry).toMatchObject({
        created: true,
        sourceRun: { id: runId, status: 'blocked' },
        retryRun: { status: 'accepted', retryOfRunId: runId },
        inbox: { state: 'queued' },
      });
      expect(fixture.data.runs.listActivations(first.retry.retryRun.id)).toEqual([]);

      const second = recoverTargetActivation(dependencies, input);
      expect(second.retry).toMatchObject({
        created: false,
        retryRun: { id: first.retry.retryRun.id },
        inbox: { state: 'queued' },
      });
      expect(calls).toEqual({ close: 2, retry: 2 });
      expect(model.quoted).toHaveLength(modelCalls.quoted);
      expect(model.streamed).toHaveLength(modelCalls.streamed);
      expect(executeCount).toBe(0);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('closes an open project.search dispatch and accepts one queued retry without replaying it', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(
      toolResponse(ProjectSearchDefinition.id, ProjectSearchDefinition.examples.input),
    );
    let executeCount = 0;
    try {
      await expect(
        runTargetActivation(
          {
            persistence: fixture.data.harness,
            model,
            toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], async () => {
              executeCount += 1;
              throw new Error('simulated process exit after durable dispatch preparation');
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit');
      const interrupted = fixture.data.harness.loadActivation(runId, 1);
      expect(interrupted.dispatches).toMatchObject([
        { key: { toolId: 'project.search' }, outcome: null },
      ]);
      const input = recoveryInput(interrupted, context, 'dispatch');
      const { calls, dependencies } = recoveryDependencies(fixture.data.harness);
      const modelCalls = { quoted: model.quoted.length, streamed: model.streamed.length };

      const first = recoverTargetActivation(dependencies, input);
      expect(first.closed).toMatchObject({
        run: { id: runId, status: 'blocked' },
        activation: { state: 'ended', endReason: 'process_exit' },
        frontier: { kind: 'dispatch', toolId: 'project.search' },
      });
      expect(first.retry).toMatchObject({
        created: true,
        retryRun: { status: 'accepted', retryOfRunId: runId },
        inbox: { state: 'queued' },
      });
      expect(fixture.data.runs.listActivations(first.retry.retryRun.id)).toEqual([]);

      const second = recoverTargetActivation(dependencies, input);
      expect(second.retry).toMatchObject({
        created: false,
        retryRun: { id: first.retry.retryRun.id },
        inbox: { state: 'queued' },
      });
      expect(calls).toEqual({ close: 2, retry: 2 });
      expect(model.quoted).toHaveLength(modelCalls.quoted);
      expect(model.streamed).toHaveLength(modelCalls.streamed);
      expect(executeCount).toBe(1);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('recovers a committed model tool call when persistence throws after settlement', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(
      toolResponse(ProjectSearchDefinition.id, ProjectSearchDefinition.examples.input),
    );
    let executeCount = 0;
    let interruptedAfterSettlement = false;
    const persistence = {
      ...fixture.data.harness,
      settleModelAttempt(input, commandContext) {
        const committed = fixture.data.harness.settleModelAttempt(input, commandContext);
        if (!interruptedAfterSettlement) {
          interruptedAfterSettlement = true;
          throw new Error('simulated process exit after durable model settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], async () => {
              executeCount += 1;
              throw new Error('Committed undispatched recovery must not execute the tool');
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after durable model settlement');
      const interrupted = fixture.data.harness.loadActivation(runId, 1);
      expect(interrupted).toMatchObject({
        recoveryRequired: true,
        modelAttempts: [{ state: 'succeeded' }],
        dispatches: [],
      });
      const input = recoveryInput(interrupted, context, 'undispatched');
      const { calls, dependencies } = recoveryDependencies(fixture.data.harness);
      const modelCalls = { quoted: model.quoted.length, streamed: model.streamed.length };

      const first = recoverTargetActivation(dependencies, input);
      expect(first.closed).toMatchObject({
        run: { id: runId, status: 'blocked' },
        activation: { state: 'ended', endReason: 'process_exit' },
        frontier: { kind: 'dispatch', toolId: 'project.search' },
      });
      expect(first.retry).toMatchObject({
        created: true,
        retryRun: { status: 'accepted', retryOfRunId: runId },
        inbox: { state: 'queued' },
      });
      const second = recoverTargetActivation(dependencies, input);
      expect(second.retry).toMatchObject({
        created: false,
        retryRun: { id: first.retry.retryRun.id },
      });
      expect(calls).toEqual({ close: 2, retry: 2 });
      expect(model.quoted).toHaveLength(modelCalls.quoted);
      expect(model.streamed).toHaveLength(modelCalls.streamed);
      expect(executeCount).toBe(0);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);

  it('fails closed without replaying a committed undispatched receipt-aware operation.get', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const toolGetInput = ToolGetDefinition.parseInput({ names: [OperationGetDefinition.id] });
    const operationGetInput = OperationGetDefinition.parseInput(
      OperationGetDefinition.examples.input,
    );
    const model = new FakeModelAdapter(
      toolResponse(
        ToolGetDefinition.id,
        toolGetInput,
        'provider-call.tool-get.before-operation-recovery',
      ),
      [
        toolResponse(
          OperationGetDefinition.id,
          operationGetInput,
          'provider-call.operation-get.before-recovery',
        ),
      ],
    );
    let settlementCount = 0;
    let operationExecuteCount = 0;
    const persistence = {
      ...fixture.data.harness,
      settleModelAttempt(input, commandContext) {
        const committed = fixture.data.harness.settleModelAttempt(input, commandContext);
        settlementCount += 1;
        if (settlementCount === 2) {
          throw new Error('simulated process exit before operation.get dispatch');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    const reads = createTargetStorageReadToolExecutor(fixture.data);
    const executor = fakeToolExecutor(
      reads.toolIds,
      (execution) => {
        if (execution.toolId === OperationGetDefinition.id) {
          operationExecuteCount += 1;
          throw new Error('Receipt-aware recovery must not replay operation.get');
        }
        return reads.execute(execution);
      },
      reads.initialToolIds,
    );
    try {
      await expect(
        runTargetActivation(
          { persistence, model, toolExecutor: executor },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit before operation.get dispatch');
      const interrupted = fixture.data.harness.loadActivation(runId, 1);
      expect(interrupted).toMatchObject({
        recoveryRequired: true,
        modelAttempts: [{ state: 'succeeded' }, { state: 'succeeded' }],
        dispatches: [{ key: { toolId: ToolGetDefinition.id }, outcome: { status: 'succeeded' } }],
      });
      const input = recoveryInput(interrupted, context, 'operation-get-undispatched');
      const { calls, dependencies } = recoveryDependencies(fixture.data.harness);
      const modelCalls = { quoted: model.quoted.length, streamed: model.streamed.length };

      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect(() => recoverTargetActivation(dependencies, input)).toThrowError(
          expect.objectContaining({
            code: 'INVALID_REQUEST',
            message: 'Only one latest committed undispatched frozen safe R call can be recovered',
          }),
        );
      }
      expect(fixture.data.harness.loadActivation(runId, 1)).toEqual(interrupted);
      expect(calls).toEqual({ close: 2, retry: 0 });
      expect(model.quoted).toHaveLength(modelCalls.quoted);
      expect(model.streamed).toHaveLength(modelCalls.streamed);
      expect(operationExecuteCount).toBe(0);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 90_000);

  it('keeps a committed terminal settlement readable and replay-safe when the caller crashes', async () => {
    const { fixture, context, runId } = await activeRuntimeFixture();
    const model = new FakeModelAdapter(
      toolResponse(ProjectSearchDefinition.id, ProjectSearchDefinition.examples.input),
    );
    let settlementCount = 0;
    let terminalSettlement:
      Parameters<HarnessPersistenceAuthority['settleModelAttempt']>[0] | undefined;
    const persistence = {
      ...fixture.data.harness,
      settleModelAttempt(input, commandContext) {
        const committed = fixture.data.harness.settleModelAttempt(input, commandContext);
        settlementCount += 1;
        if (settlementCount === 2) {
          terminalSettlement = input;
          throw new Error('simulated process exit after durable terminal settlement');
        }
        return committed;
      },
    } satisfies HarnessPersistenceAuthority;
    try {
      await expect(
        runTargetActivation(
          {
            persistence,
            model,
            toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], () =>
              ProjectSearchDefinition.parseOutcome({
                status: 'succeeded',
                data: { items: [], nextCursor: null },
              }),
            ),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('simulated process exit after durable terminal settlement');

      const completed = fixture.data.harness.loadActivation(runId, 1);
      expect(completed.run).toMatchObject({
        status: 'completed',
        terminalOutcome: { summary: 'The read completed.' },
      });
      expect(completed.activation).toMatchObject({ state: 'ended', endReason: 'terminal' });
      expect(completed.recoveryRequired).toBe(false);
      const journalLength = completed.journal.length;
      const messages = fixture.data.conversations.listMessages({
        wireVersion: 1,
        kind: 'request',
        requestId: 'request.i3k4.messages.before-replay',
        method: 'message.list',
        input: {
          chatId: completed.run.chatId,
          beforeSequence: null,
          page: { cursor: null, limit: 100 },
        },
      }).result.items;
      expect(terminalSettlement).toBeDefined();
      expect(fixture.data.harness.settleModelAttempt(terminalSettlement!, context).events).toEqual(
        [],
      );
      expect(fixture.data.harness.loadActivation(runId, 1).journal).toHaveLength(journalLength);
      expect(
        fixture.data.conversations.listMessages({
          wireVersion: 1,
          kind: 'request',
          requestId: 'request.i3k4.messages.after-replay',
          method: 'message.list',
          input: {
            chatId: completed.run.chatId,
            beforeSequence: null,
            page: { cursor: null, limit: 100 },
          },
        }).result.items,
      ).toEqual(messages);

      await expect(
        runTargetActivation(
          {
            persistence: fixture.data.harness,
            model,
            toolExecutor: fakeToolExecutor([ProjectSearchDefinition.id], () => {
              throw new Error('A completed Activation must not rerun');
            }),
          },
          {
            runId,
            activationNumber: 1,
            limits: { maxInputTokens: 2_000, maxOutputTokens: 500 },
            context,
          },
        ),
      ).rejects.toThrow('active running Activation');
      expect(model.streamed).toHaveLength(2);
    } finally {
      fixture.store.close();
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }, 30_000);
});
