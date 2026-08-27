import { randomUUID } from 'node:crypto';
import {
  AgentCancelDefinition,
  AgentResultDefinition,
  AgentSendDefinition,
  AgentSpawnDefinition,
  AgentWaitDefinition,
  CanonicalModelRequestV1Schema,
  CanonicalModelResponseV1Schema,
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
  EntityIdSchema,
  EvaluationRunDefinition,
  GenerationQuoteDefinition,
  GenerationOperationRefSchema,
  GenerationSubmitDefinition,
  HistoryQueryDefinition,
  InteractionAskDefinition,
  MediaAttachDefinition,
  MediaDeriveDefinition,
  MediaInspectDefinition,
  MediaLinkDefinition,
  MediaQueryDefinition,
  MemoryQueryDefinition,
  MINIMAL_SYSTEM_PROMPT_VERSION,
  ModelAdapterEventSchema,
  OperationCancelDefinition,
  OperationGetDefinition,
  ProductionMutateDefinition,
  ProductionQueryDefinition,
  ProjectGetDefinition,
  ProjectSearchDefinition,
  ProviderCapabilitiesDefinition,
  ResultAssessmentOperationRefSchema,
  ResultQueryDefinition,
  RunInspectDefinition,
  RuntimeLoopOutcomeSchema,
  SkillLoadDefinition,
  SkillProposeDefinition,
  TaskManageDefinition,
  ToolGetDefinition,
  ToolProgramDefinition,
  canonicalJson,
  executableToolDefinition,
  parseCanonical,
  skillIndexFromSkills,
  type CanonicalModelRequestV1,
  type CanonicalModelResponseV1,
  type CapabilityCatalogSnapshotV1,
  type ModelAdapterEvent,
  type ModelResourceQuoteV1,
  type RuntimeLoopOutcome,
  type Run,
  type RunInboxMessage,
  type ToolId,
  type ToolProgramInput,
} from '@lucid-fin/target-contracts';
import {
  TargetStorageError,
  isRecoverySafeRuntimeReadTool,
  isRuntimeReadTool,
  type HarnessActivationSnapshot,
  type HarnessCommit,
  type HarnessPersistenceAuthority,
  type DeliveryOperationsAuthority,
  type GenerationAuthority,
  type MediaDerivationsAuthority,
  type OperationsAuthority,
  type PendingOperationCancellation,
  type ResultAssessmentsAuthority,
  type PrivateModelContext,
  type RunsAuthority,
  type TargetCommandContext,
  type TargetDataAccess,
} from '@lucid-fin/target-storage';

export interface TargetModelAdapter {
  readonly provider: CanonicalModelRequestV1['provider'];
  readonly quote: (
    request: CanonicalModelRequestV1,
    privateContext: PrivateModelContext,
    signal?: AbortSignal,
  ) => Promise<ModelResourceQuoteV1>;
  readonly stream: (
    request: CanonicalModelRequestV1,
    privateContext: PrivateModelContext,
    signal?: AbortSignal,
  ) => AsyncIterable<ModelAdapterEvent>;
}

export type TargetToolExecutionOrigin =
  | {
      readonly kind: 'model';
      readonly modelAttemptId: string;
      readonly providerCallId: string;
    }
  | {
      readonly kind: 'tool_program';
      readonly parentDispatchOperationId: string;
      readonly programStepId: string;
      readonly programCallIndex: number;
    };

export interface TargetToolExecution {
  readonly dispatchOperationId: string;
  readonly operationFingerprint: string;
  readonly origin: TargetToolExecutionOrigin;
  readonly runId: string;
  readonly projectId: string;
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly authorityWatermarkHash: null;
  readonly input: unknown;
}

export interface TargetToolExecutor {
  readonly toolIds: readonly ToolId[];
  readonly initialToolIds: readonly ToolId[];
  readonly execute: (
    execution: TargetToolExecution,
  ) => RuntimeLoopOutcome | Promise<RuntimeLoopOutcome>;
}

export interface TargetStorageReadDataAccess {
  readonly canvas: Pick<TargetDataAccess['canvas'], 'queryTool'>;
  readonly conversations: Pick<TargetDataAccess['conversations'], 'queryMessages'>;
  readonly delivery: Pick<TargetDataAccess['delivery'], 'queryTool'>;
  readonly generation: Pick<TargetDataAccess['generation'], 'quote'>;
  readonly history: Pick<TargetDataAccess['history'], 'query'>;
  readonly mediaInspection: Pick<TargetDataAccess['mediaInspection'], 'inspect'>;
  readonly media: Pick<TargetDataAccess['media'], 'query'>;
  readonly memory: Pick<TargetDataAccess['memory'], 'query'>;
  readonly operations: Pick<TargetDataAccess['operations'], 'query'>;
  readonly production: Pick<TargetDataAccess['production'], 'queryTool'>;
  readonly providerCapabilities: Pick<TargetDataAccess['providerCapabilities'], 'query'>;
  readonly projects: Pick<TargetDataAccess['projects'], 'getTool'>;
  readonly search: Pick<TargetDataAccess['search'], 'query'>;
  readonly results: Pick<TargetDataAccess['results'], 'query'>;
  readonly runReplay: Pick<TargetDataAccess['runReplay'], 'get' | 'inspect'>;
}

const TARGET_STORAGE_READ_TOOL_IDS = Object.freeze([
  CanvasQueryDefinition.id,
  ChatQueryDefinition.id,
  DeliveryQueryDefinition.id,
  GenerationQuoteDefinition.id,
  HistoryQueryDefinition.id,
  MediaInspectDefinition.id,
  MediaQueryDefinition.id,
  MemoryQueryDefinition.id,
  OperationGetDefinition.id,
  ProjectGetDefinition.id,
  ProjectSearchDefinition.id,
  ProductionQueryDefinition.id,
  ProviderCapabilitiesDefinition.id,
  ResultQueryDefinition.id,
  RunInspectDefinition.id,
  SkillLoadDefinition.id,
  ToolGetDefinition.id,
] satisfies readonly ToolId[]);
const TARGET_STORAGE_INITIAL_TOOL_IDS = Object.freeze([
  HistoryQueryDefinition.id,
  MemoryQueryDefinition.id,
  ResultQueryDefinition.id,
  SkillLoadDefinition.id,
  ToolGetDefinition.id,
] satisfies readonly ToolId[]);

function frozenRunReplay(
  dataAccess: TargetStorageReadDataAccess,
  execution: TargetToolExecution,
  toolId:
    | typeof ChatQueryDefinition.id
    | typeof RunInspectDefinition.id
    | typeof SkillLoadDefinition.id
    | typeof ToolGetDefinition.id,
): ReturnType<TargetStorageReadDataAccess['runReplay']['get']> {
  const replay = dataAccess.runReplay.get(execution.runId);
  const { run, manifest, catalog } = replay;
  if (
    run.id !== execution.runId ||
    run.projectId !== execution.projectId ||
    manifest.runId !== run.id ||
    manifest.projectId !== run.projectId ||
    manifest.capabilityCatalogSnapshotId !== run.capabilityCatalogSnapshotId ||
    manifest.capabilityCatalogHash !== run.capabilityCatalogHash ||
    catalog.catalogHash !== run.capabilityCatalogHash ||
    catalog.skillCatalogDigest !== manifest.skillCatalogDigest
  ) {
    throw new Error(`${toolId} Run replay identity mismatch`);
  }
  return replay;
}

function frozenRunCatalog(
  dataAccess: TargetStorageReadDataAccess,
  execution: TargetToolExecution,
  toolId: typeof SkillLoadDefinition.id | typeof ToolGetDefinition.id,
): CapabilityCatalogSnapshotV1 {
  return frozenRunReplay(dataAccess, execution, toolId).catalog;
}

function loadFrozenTools(
  dataAccess: TargetStorageReadDataAccess,
  execution: TargetToolExecution,
): RuntimeLoopOutcome {
  const catalog = frozenRunCatalog(dataAccess, execution, ToolGetDefinition.id);
  const frozenDefinitions = catalog.tools.filter(({ id }) => id === ToolGetDefinition.id);
  if (
    frozenDefinitions.length !== 1 ||
    frozenDefinitions[0]!.version !== ToolGetDefinition.version
  ) {
    throw new Error('Frozen tool.get version does not match the live definition');
  }
  const input = ToolGetDefinition.parseInput(execution.input as Record<string, unknown>);
  const definitions = input.names.map((name) => {
    const matches = catalog.tools.filter(({ id }) => id === name);
    if (matches.length === 0) throw new Error(`Frozen tool was not found: ${name}`);
    if (matches.length !== 1) throw new Error(`Frozen tool identity is ambiguous: ${name}`);
    return matches[0]!;
  });
  return ToolGetDefinition.parseOutcome({
    status: 'succeeded',
    data: { definitions, catalogHash: catalog.catalogHash },
  });
}

function loadFrozenSkills(
  dataAccess: TargetStorageReadDataAccess,
  execution: TargetToolExecution,
): RuntimeLoopOutcome {
  const catalog = frozenRunCatalog(dataAccess, execution, SkillLoadDefinition.id);
  const frozenDefinitions = catalog.tools.filter(({ id }) => id === SkillLoadDefinition.id);
  if (
    frozenDefinitions.length !== 1 ||
    frozenDefinitions[0]!.version !== SkillLoadDefinition.version
  ) {
    throw new Error('Frozen skill.load version does not match the live definition');
  }
  const input = SkillLoadDefinition.parseInput(execution.input as Record<string, unknown>);
  const skills = input.skillIds.map((skillId) => {
    const matches = catalog.skills.filter((skill) => skill.skillId === skillId);
    if (matches.length === 0) throw new Error(`Frozen skill was not found: ${skillId}`);
    if (matches.length !== 1) throw new Error(`Frozen skill identity is ambiguous: ${skillId}`);
    return matches[0]!;
  });
  return SkillLoadDefinition.parseOutcome({
    status: 'succeeded',
    data: { skills, skillCatalogDigest: catalog.skillCatalogDigest },
  });
}

export function createTargetStorageReadToolExecutor(
  dataAccess: TargetStorageReadDataAccess,
): TargetToolExecutor {
  return Object.freeze({
    toolIds: TARGET_STORAGE_READ_TOOL_IDS,
    initialToolIds: TARGET_STORAGE_INITIAL_TOOL_IDS,
    execute(execution: TargetToolExecution) {
      const definition = executableToolDefinition(
        execution.toolId,
        execution.toolVersion,
      ) as unknown as RuntimeToolDefinition | undefined;
      if (definition === undefined) {
        throw new Error(
          `Target storage read tool ${execution.toolId}@${execution.toolVersion} is unavailable`,
        );
      }
      const parsedInput = definition.parseInput(execution.input);
      if (canonicalJson(parsedInput) !== canonicalJson(execution.input)) {
        throw new Error(
          `Target storage read tool ${execution.toolId}@${execution.toolVersion} input is not canonical`,
        );
      }
      switch (execution.toolId) {
        case CanvasQueryDefinition.id: {
          const input = CanvasQueryDefinition.parseInput(
            execution.input as Record<string, unknown>,
          );
          const data = dataAccess.canvas.queryTool(execution.projectId, input);
          const includeForKind = {
            placement: 'placements',
            group: 'groups',
            edge: 'edges',
            annotation: 'annotations',
            saved_view: 'saved_views',
          } as const;
          if (
            data.page.items.some(
              ({ object }) => !input.include.includes(includeForKind[object.kind]),
            )
          ) {
            throw new Error('canvas.query storage returned an unrequested item kind');
          }
          return CanvasQueryDefinition.parseOutcome({ status: 'succeeded', data });
        }
        case ChatQueryDefinition.id: {
          const { run } = frozenRunReplay(dataAccess, execution, ChatQueryDefinition.id);
          return ChatQueryDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.conversations.queryMessages(
              execution.projectId,
              run.chatId,
              ChatQueryDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        }
        case DeliveryQueryDefinition.id:
          return DeliveryQueryDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.delivery.queryTool(
              execution.projectId,
              DeliveryQueryDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        case GenerationQuoteDefinition.id:
          return dataAccess.generation
            .quote({
              runId: execution.runId,
              request: GenerationQuoteDefinition.parseInput(
                execution.input as Record<string, unknown>,
              ),
            })
            .then((data) => GenerationQuoteDefinition.parseOutcome({ status: 'succeeded', data }));
        case HistoryQueryDefinition.id:
          return HistoryQueryDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.history.query(
              execution.projectId,
              HistoryQueryDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        case MediaInspectDefinition.id:
          return dataAccess.mediaInspection
            .inspect(
              execution.runId,
              MediaInspectDefinition.parseInput(execution.input as Record<string, unknown>),
            )
            .then((data) => MediaInspectDefinition.parseOutcome({ status: 'succeeded', data }));
        case MediaQueryDefinition.id:
          return MediaQueryDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.media.query(
              execution.projectId,
              MediaQueryDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        case MemoryQueryDefinition.id:
          return MemoryQueryDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.memory.query(
              execution.projectId,
              MemoryQueryDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        case OperationGetDefinition.id:
          return OperationGetDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.operations.query(
              execution.projectId,
              execution.runId,
              OperationGetDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        case ProjectGetDefinition.id: {
          const input = ProjectGetDefinition.parseInput(execution.input as Record<string, unknown>);
          const data = dataAccess.projects.getTool(execution.projectId, input);
          if (
            data.sections.length !== input.include.length ||
            data.sections.some(({ section }, index) => section !== input.include[index])
          ) {
            throw new Error('project.get storage sections do not match requested includes');
          }
          return ProjectGetDefinition.parseOutcome({ status: 'succeeded', data });
        }
        case ProjectSearchDefinition.id:
          return ProjectSearchDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.search.query(
              execution.projectId,
              ProjectSearchDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        case ProductionQueryDefinition.id: {
          const input = ProductionQueryDefinition.parseInput(
            execution.input as Record<string, unknown>,
          );
          const data = dataAccess.production.queryTool(execution.projectId, input);
          if (
            data.items.some(
              (item) =>
                item.sections.length !== input.include.length ||
                item.sections.some(({ section }, index) => section !== input.include[index]),
            )
          ) {
            throw new Error('production.query storage sections do not match requested includes');
          }
          return ProductionQueryDefinition.parseOutcome({ status: 'succeeded', data });
        }
        case ProviderCapabilitiesDefinition.id:
          return dataAccess.providerCapabilities
            .query(
              ProviderCapabilitiesDefinition.parseInput(execution.input as Record<string, unknown>),
            )
            .then((data) =>
              ProviderCapabilitiesDefinition.parseOutcome({ status: 'succeeded', data }),
            );
        case ResultQueryDefinition.id:
          return ResultQueryDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.results.query(
              execution.projectId,
              ResultQueryDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        case RunInspectDefinition.id: {
          const { run } = frozenRunReplay(dataAccess, execution, RunInspectDefinition.id);
          return RunInspectDefinition.parseOutcome({
            status: 'succeeded',
            data: dataAccess.runReplay.inspect(
              run.id,
              RunInspectDefinition.parseInput(execution.input as Record<string, unknown>),
            ),
          });
        }
        case SkillLoadDefinition.id:
          return loadFrozenSkills(dataAccess, execution);
        case ToolGetDefinition.id:
          return loadFrozenTools(dataAccess, execution);
        default:
          throw new Error(`Unsupported target storage read tool: ${execution.toolId}`);
      }
    },
  });
}

export interface TargetRuntimeDependencies {
  readonly persistence: HarnessPersistenceAuthority;
  readonly model: TargetModelAdapter;
  readonly toolExecutor: TargetToolExecutor;
  readonly onOperationCancellationError?: (cause: unknown) => void;
  readonly operations?: Pick<OperationsAuthority, 'listCancellationRequested'>;
  readonly deliveryOperations?: Pick<
    DeliveryOperationsAuthority,
    'acknowledgeCancellation' | 'export' | 'preview'
  >;
  readonly resultAssessments?: Pick<
    ResultAssessmentsAuthority,
    'acknowledgeCancellation' | 'start' | 'executeLocal' | 'submitProvider' | 'reconcileProvider'
  >;
  readonly generation?: Pick<GenerationAuthority, 'submit' | 'reconcile'>;
  readonly mediaDerivations?: Pick<MediaDerivationsAuthority, 'start' | 'continue'>;
}

function cancellationContext(runId: string): TargetCommandContext {
  return {
    actor: 'commander',
    causation: { kind: 'run', runId },
    correlationId: id('correlation'),
  };
}

function assertOperationCancellationDependencies(dependencies: TargetRuntimeDependencies): void {
  const missing = [
    dependencies.operations === undefined ? 'operations' : null,
    dependencies.generation === undefined ? 'generation' : null,
    dependencies.mediaDerivations === undefined ? 'mediaDerivations' : null,
    dependencies.resultAssessments === undefined ? 'resultAssessments' : null,
    dependencies.deliveryOperations === undefined ? 'deliveryOperations' : null,
    dependencies.onOperationCancellationError === undefined ? 'onOperationCancellationError' : null,
  ].filter((value): value is string => value !== null);
  if (missing.length > 0) {
    throw new Error(`Operation cancellation drain requires ${missing.join(', ')}`);
  }
}

async function drainRequestedOperationCancellation(
  dependencies: TargetRuntimeDependencies,
  candidate: PendingOperationCancellation,
): Promise<void> {
  const { operation, runId } = candidate;
  const context = cancellationContext(runId);
  const commandId = id('command');
  switch (operation.kind) {
    case 'generation_attempt': {
      const generation = dependencies.generation;
      if (generation === undefined)
        throw new Error('Generation cancellation authority is unavailable');
      await generation.reconcile(
        { operation, expectedRevision: operation.revision, commandId },
        context,
      );
      return;
    }
    case 'media_derivation': {
      const mediaDerivations = dependencies.mediaDerivations;
      if (mediaDerivations === undefined) {
        throw new Error('Media Derivation cancellation authority is unavailable');
      }
      await mediaDerivations.continue({ dispatchOperationId: operation.id, commandId }, context);
      return;
    }
    case 'result_assessment': {
      const resultAssessments = dependencies.resultAssessments;
      if (resultAssessments === undefined) {
        throw new Error('Result Assessment cancellation authority is unavailable');
      }
      await resultAssessments.acknowledgeCancellation(
        { operation, expectedRevision: operation.revision, commandId },
        context,
      );
      return;
    }
    case 'review_cut_attempt':
    case 'delivery_export': {
      const deliveryOperations = dependencies.deliveryOperations;
      if (deliveryOperations === undefined) {
        throw new Error('Delivery cancellation authority is unavailable');
      }
      await deliveryOperations.acknowledgeCancellation(
        { operation, expectedRevision: operation.revision, commandId },
        context,
      );
      return;
    }
  }
}

async function collectOperationCancellationFailures(
  dependencies: TargetRuntimeDependencies,
  candidates: readonly PendingOperationCancellation[],
): Promise<unknown[]> {
  const failures: unknown[] = [];
  for (const candidate of candidates) {
    try {
      await drainRequestedOperationCancellation(dependencies, candidate);
    } catch (cause) {
      if (cause instanceof TargetStorageError && cause.code === 'REVISION_CONFLICT') continue;
      failures.push(cause);
    }
  }
  return failures;
}

function throwOperationCancellationFailures(failures: readonly unknown[]): void {
  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more requested Operation cancellations failed');
  }
}

async function drainKnownOperationCancellations(
  dependencies: TargetRuntimeDependencies,
  candidates: readonly PendingOperationCancellation[],
): Promise<void> {
  throwOperationCancellationFailures(
    await collectOperationCancellationFailures(dependencies, candidates),
  );
}

async function reportImmediateOperationCancellationFailures(
  dependencies: TargetRuntimeDependencies,
  drain: () => Promise<void>,
): Promise<void> {
  try {
    await drain();
  } catch (cause) {
    try {
      dependencies.onOperationCancellationError!(cause);
    } catch {
      // A host observer cannot retroactively fail a committed cancellation boundary.
    }
  }
}

/**
 * Drives durable owner cancellation intent outside the mutation transaction.
 * A later durable notification or process restart retries owners that remain nonterminal.
 */
export async function drainRequestedOperationCancellations(
  dependencies: TargetRuntimeDependencies,
  runIds: readonly string[] | null = null,
): Promise<void> {
  const operations = dependencies.operations;
  if (operations === undefined) {
    throw new Error('Operation cancellation drain requires operations');
  }
  const failures: unknown[] = [];
  let afterOperationId: string | null = null;
  do {
    const page = operations.listCancellationRequested({ afterOperationId, limit: 100, runIds });
    failures.push(...(await collectOperationCancellationFailures(dependencies, page.operations)));
    afterOperationId = page.nextAfterOperationId;
  } while (afterOperationId !== null);
  throwOperationCancellationFailures(failures);
}

export interface RunTargetActivationInput {
  readonly runId: string;
  readonly activationNumber: number;
  readonly limits: CanonicalModelRequestV1['limits'];
  readonly context: TargetCommandContext;
  readonly signal?: AbortSignal;
}

type RunSchedulingAuthority = Pick<
  RunsAuthority,
  | 'get'
  | 'isSchedulingAllowed'
  | 'listInbox'
  | 'listActivations'
  | 'transitionInbox'
  | 'startActivation'
  | 'terminalize'
>;

export interface RunCoordinatorDependencies extends TargetRuntimeDependencies {
  readonly runs: RunSchedulingAuthority;
}

export type CoordinateRunInput = Omit<RunTargetActivationInput, 'activationNumber'>;

export type RunCoordinationResult =
  | {
      readonly kind: 'executed';
      readonly runId: string;
      readonly activationNumber: number;
      readonly triggerInboxMessageId: string;
      readonly snapshot: HarnessActivationSnapshot;
    }
  | {
      readonly kind: 'deferred';
      readonly run: Run;
      readonly pendingInbox: RunInboxMessage | null;
      readonly reason:
        | 'active_activation'
        | 'paused_control_subtree'
        | 'run_not_running'
        | 'terminal_run_requires_new_root';
    }
  | {
      readonly kind: 'idle';
      readonly run: Run;
      readonly reason: 'no_pending_inbox' | 'terminal';
    };

type RecoveryPersistence = Pick<
  HarnessPersistenceAuthority,
  'closeInterruptedActivation' | 'acceptCrashRetryRun'
>;

export interface RecoverTargetActivationDependencies {
  readonly persistence: RecoveryPersistence;
}

export interface RecoverTargetActivationInput {
  readonly close: Parameters<RecoveryPersistence['closeInterruptedActivation']>[0];
  readonly retryCommandId: string;
  readonly context: TargetCommandContext;
}

export interface RecoverTargetActivationResult {
  readonly closed: ReturnType<RecoveryPersistence['closeInterruptedActivation']>;
  readonly retry: ReturnType<RecoveryPersistence['acceptCrashRetryRun']>;
}

export function recoverTargetActivation(
  { persistence }: RecoverTargetActivationDependencies,
  input: RecoverTargetActivationInput,
): RecoverTargetActivationResult {
  const retryCommandId = parseCanonical(EntityIdSchema, input.retryCommandId);
  const closed = persistence.closeInterruptedActivation(input.close, input.context);
  const expectedSourceEventHead = closed.run.publicEventHead;
  if (expectedSourceEventHead === null) {
    throw new Error('Closed recovery Run has no public event head');
  }
  const retry = persistence.acceptCrashRetryRun(
    {
      sourceRunId: closed.run.id,
      expectedSourceRevision: closed.run.revision,
      expectedSourceContentHash: closed.run.contentHash,
      expectedSourceEventHead,
      commandId: retryCommandId,
    },
    input.context,
  );
  return { closed, retry };
}

interface ModelStep {
  readonly turnNumber: number;
  readonly stepNumber: number;
}

interface RuntimeToolDefinition {
  readonly version: string;
  readonly parseInput: (input: unknown) => unknown;
  readonly parseOutcome: (outcome: unknown) => unknown;
}

interface RuntimeToolCall {
  readonly call: Extract<ModelAdapterEvent, { type: 'tool_call' }>;
  readonly definition: RuntimeToolDefinition;
  readonly input: unknown;
}

type RuntimeModelBoundary =
  | { readonly kind: 'completed' }
  | { readonly kind: 'failed' }
  | ({ readonly kind: 'tool_call' } & RuntimeToolCall);

interface CompletedModelAttemptResult {
  readonly kind: 'attempt';
  readonly request: CanonicalModelRequestV1;
  readonly response: CanonicalModelResponseV1;
  readonly modelAttemptId: string;
  readonly requestHash: string;
  readonly step: ModelStep;
  readonly boundary: RuntimeModelBoundary;
}

type ModelAttemptResult =
  | { readonly kind: 'aborted' }
  | { readonly kind: 'yielded' }
  | { readonly kind: 'spawned' }
  | { readonly kind: 'sent' }
  | { readonly kind: 'waiting'; readonly dispatchOperationId: string }
  | { readonly kind: 'resulted' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'interaction_asked' }
  | { readonly kind: 'delivery_export_waiting' }
  | { readonly kind: 'delivery_frozen' }
  | { readonly kind: 'delivery_previewed' }
  | { readonly kind: 'evaluation_run' }
  | { readonly kind: 'generation_submitted' }
  | { readonly kind: 'media_derived' }
  | { readonly kind: 'media_attached' }
  | { readonly kind: 'media_linked' }
  | { readonly kind: 'canvas_mutated' }
  | { readonly kind: 'operation_cancelled' }
  | { readonly kind: 'task_managed' }
  | { readonly kind: 'tool_program'; readonly parentDispatchOperationId: string }
  | CompletedModelAttemptResult;

function id(prefix: string): string {
  return `${prefix}.${randomUUID()}`;
}

function requestFor(
  snapshot: HarnessActivationSnapshot,
  limits: CanonicalModelRequestV1['limits'],
  materializedTools: CanonicalModelRequestV1['materializedTools'],
): CanonicalModelRequestV1 {
  return parseCanonical(CanonicalModelRequestV1Schema, {
    version: 1,
    runId: snapshot.run.id,
    modelAttemptId: id('ma'),
    activationId: snapshot.activationId,
    activationNumber: snapshot.activation.activationNumber,
    attemptNumber: snapshot.modelAttempts.length + 1,
    provider: snapshot.run.model,
    contextManifest: { id: snapshot.manifest.id, hash: snapshot.run.contextManifestHash },
    capabilityCatalog: {
      id: snapshot.run.capabilityCatalogSnapshotId,
      hash: snapshot.run.capabilityCatalogHash,
    },
    runRevision: snapshot.run.revision,
    runContentHash: snapshot.run.contentHash,
    eventHead: snapshot.run.publicEventHead,
    compactionView:
      snapshot.compactionView === null
        ? null
        : {
            id: snapshot.compactionView.id,
            hash: snapshot.compactionView.derivedViewHash,
            summary: snapshot.compactionView.summary,
          },
    facts: snapshot.facts,
    capabilityIndex: snapshot.catalog.capabilityIndex,
    skillIndex: skillIndexFromSkills(snapshot.catalog.skills),
    materializedTools,
    locale: snapshot.manifest.locale,
    timeZone: snapshot.manifest.timeZone,
    limits,
    reasoningStrength: snapshot.run.model.reasoningStrength,
    systemPromptVersion: MINIMAL_SYSTEM_PROMPT_VERSION,
  });
}

function preparedModelStep(commit: HarnessCommit<unknown>): ModelStep {
  const steps = commit.events.flatMap((event) => {
    if (event.payloadState.state !== 'available') return [];
    const payload = event.payloadState.payload;
    return payload.type === 'step_started' && payload.kind === 'model'
      ? [{ turnNumber: payload.turnNumber, stepNumber: payload.stepNumber }]
      : [];
  });
  if (steps.length !== 1) throw new Error('Prepared Model Attempt did not create one model step');
  return steps[0]!;
}

async function responseFrom(
  model: TargetModelAdapter,
  request: CanonicalModelRequestV1,
  privateContext: PrivateModelContext,
  signal?: AbortSignal,
): Promise<CanonicalModelResponseV1 | null> {
  if (signal?.aborted) return null;
  const events: ModelAdapterEvent[] = [];
  try {
    for await (const event of model.stream(request, privateContext, signal)) {
      if (signal?.aborted) return null;
      if (events.length === 10_000) throw new Error('Model Adapter exceeded 10,000 events');
      events.push(parseCanonical(ModelAdapterEventSchema, event));
    }
  } catch (cause) {
    if (signal?.aborted) return null;
    throw cause;
  }
  if (signal?.aborted) return null;
  return parseCanonical(CanonicalModelResponseV1Schema, { version: 1, events });
}

async function runModelAttempt(
  dependencies: TargetRuntimeDependencies,
  snapshot: HarnessActivationSnapshot,
  input: RunTargetActivationInput,
  materializedTools: CanonicalModelRequestV1['materializedTools'],
  privateContext: PrivateModelContext,
): Promise<ModelAttemptResult> {
  if (
    input.signal?.aborted ||
    !dependencies.persistence.isRunActivationActive(input.runId, input.activationNumber)
  ) {
    return { kind: 'aborted' };
  }
  const request = requestFor(snapshot, input.limits, materializedTools);
  const quote = await dependencies.model.quote(request, privateContext, input.signal);
  if (
    input.signal?.aborted ||
    !dependencies.persistence.isRunActivationActive(input.runId, input.activationNumber)
  ) {
    return { kind: 'aborted' };
  }
  const preparation = dependencies.persistence.prepareModelBoundary(
    { request, quote, commandId: id('cmd') },
    input.context,
  );
  if (preparation.kind === 'yielded') return { kind: 'yielded' };
  const prepared = preparation.commit;
  const step = preparedModelStep(prepared);
  if (
    input.signal?.aborted ||
    !dependencies.persistence.isRunActivationActive(input.runId, input.activationNumber)
  ) {
    return { kind: 'aborted' };
  }
  dependencies.persistence.markModelAttemptRunning(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      commandId: id('cmd'),
    },
    input.context,
  );
  const response = await responseFrom(dependencies.model, request, privateContext, input.signal);
  if (
    response === null ||
    !dependencies.persistence.isRunActivationActive(input.runId, input.activationNumber)
  ) {
    return { kind: 'aborted' };
  }
  const boundary = runtimeModelBoundary(response, request);
  if (boundary.kind === 'tool_call' && boundary.call.toolId === AgentSpawnDefinition.id) {
    dependencies.persistence.settleAgentSpawnBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'spawned' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === AgentSendDefinition.id) {
    dependencies.persistence.settleAgentSendBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'sent' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === AgentWaitDefinition.id) {
    const settled = dependencies.persistence.settleAgentWaitStartBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'waiting', dispatchOperationId: settled.value.dispatch.id };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === AgentResultDefinition.id) {
    dependencies.persistence.settleAgentResultBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'resulted' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === AgentCancelDefinition.id) {
    assertOperationCancellationDependencies(dependencies);
    const settled = dependencies.persistence.settleAgentCancelBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    await reportImmediateOperationCancellationFailures(dependencies, () =>
      drainRequestedOperationCancellations(
        dependencies,
        settled.value.result.children.map(({ child }) => child.childRunId),
      ),
    );
    return { kind: 'cancelled' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === InteractionAskDefinition.id) {
    dependencies.persistence.settleInteractionAskBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'interaction_asked' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === DeliveryExportDefinition.id) {
    dependencies.persistence.settleDeliveryExportStartBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'delivery_export_waiting' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === DeliveryFreezeDefinition.id) {
    dependencies.persistence.settleDeliveryFreezeBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'delivery_frozen' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === DeliveryPreviewDefinition.id) {
    const started = dependencies.persistence.settleDeliveryPreviewStartBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    await executeDeliveryPreviewBoundary(dependencies, input, started.value.dispatch.id);
    return { kind: 'delivery_previewed' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === EvaluationRunDefinition.id) {
    const started = dependencies.persistence.settleEvaluationRunStartBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    await executeEvaluationRunBoundary(dependencies, input, started.value.dispatch.id);
    return { kind: 'evaluation_run' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === GenerationSubmitDefinition.id) {
    const started = dependencies.persistence.settleGenerationSubmitStartBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    await executeGenerationSubmitBoundary(dependencies, input, started.value.dispatch.id);
    return { kind: 'generation_submitted' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === MediaDeriveDefinition.id) {
    const started = dependencies.persistence.settleMediaDeriveStartBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    await executeMediaDeriveBoundary(dependencies, input, started.value.dispatch.id);
    return { kind: 'media_derived' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === MediaAttachDefinition.id) {
    dependencies.persistence.settleMediaAttachBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'media_attached' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === MediaLinkDefinition.id) {
    dependencies.persistence.settleMediaLinkBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'media_linked' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === CanvasMutateDefinition.id) {
    dependencies.persistence.settleCanvasMutateBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'canvas_mutated' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === OperationCancelDefinition.id) {
    assertOperationCancellationDependencies(dependencies);
    const settled = dependencies.persistence.settleOperationCancelBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    await reportImmediateOperationCancellationFailures(dependencies, () =>
      drainKnownOperationCancellations(
        dependencies,
        settled.value.result.operations.map(({ ref }) => ({ runId: input.runId, operation: ref })),
      ),
    );
    return { kind: 'operation_cancelled' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === TaskManageDefinition.id) {
    dependencies.persistence.settleTaskManageBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'task_managed' };
  }
  if (boundary.kind === 'tool_call' && boundary.call.toolId === ToolProgramDefinition.id) {
    assertRuntimeToolProgramEligibility(
      snapshot.catalog,
      ToolProgramDefinition.parseInput(boundary.input as Record<string, unknown>),
      dependencies.toolExecutor,
    );
    const settled = dependencies.persistence.settleToolProgramBoundary(
      {
        attemptId: prepared.value.id,
        requestHash: prepared.value.requestHash,
        response,
        providerCallId: boundary.call.providerCallId,
        activationNumber: input.activationNumber,
        turnNumber: step.turnNumber,
        stepNumber: step.stepNumber,
        settledAt: new Date().toISOString(),
      },
      input.context,
    );
    return { kind: 'tool_program', parentDispatchOperationId: settled.value.dispatch.id };
  }
  dependencies.persistence.settleModelAttempt(
    {
      attemptId: prepared.value.id,
      requestHash: prepared.value.requestHash,
      response,
      settledAt: new Date().toISOString(),
      commandId: id('cmd'),
    },
    input.context,
  );
  return {
    kind: 'attempt',
    request,
    response,
    modelAttemptId: prepared.value.id,
    requestHash: prepared.value.requestHash,
    step,
    boundary,
  };
}

function runtimeToolCall(
  response: CanonicalModelResponseV1,
  request: CanonicalModelRequestV1,
): RuntimeToolCall {
  const terminal = response.events.at(-1);
  const calls = response.events.filter((event) => event.type === 'tool_call');
  if (
    terminal?.type !== 'model_completed' ||
    terminal.finishReason !== 'tool_calls' ||
    calls.length !== 1
  ) {
    throw new Error(
      'Model Attempt must complete with stop or request exactly one materialized tool call',
    );
  }
  const call = calls[0]!;
  const frozen = request.materializedTools.find(({ id: toolId }) => toolId === call.toolId);
  const definition =
    frozen === undefined
      ? undefined
      : (executableToolDefinition(call.toolId, frozen.version) as unknown as
          RuntimeToolDefinition | undefined);
  if (frozen === undefined || definition === undefined || frozen.version !== definition.version) {
    throw new Error(`Tool ${call.toolId} is not a live materialized definition`);
  }
  const input = definition.parseInput(call.canonicalArguments);
  if (canonicalJson(input) !== canonicalJson(call.canonicalArguments)) {
    throw new Error(`Tool ${call.toolId} input is not canonical`);
  }
  return { call, definition, input };
}

function assertFinalResponse(response: CanonicalModelResponseV1): void {
  const terminal = response.events.at(-1);
  if (terminal?.type !== 'model_completed' || terminal.finishReason !== 'stop') {
    throw new Error(
      'Model Attempt must complete with stop or request exactly one materialized tool call',
    );
  }
  const finalText = response.events
    .filter((event) => event.type === 'assistant_delta')
    .map(({ publicText }) => publicText)
    .join('')
    .trim();
  if (finalText.length === 0 || finalText.length > 100_000) {
    throw new Error('Final Model Attempt text must contain 1 to 100,000 characters');
  }
}

function runtimeModelBoundary(
  response: CanonicalModelResponseV1,
  request: CanonicalModelRequestV1,
): RuntimeModelBoundary {
  const terminal = response.events.at(-1);
  if (terminal?.type === 'model_completed' && terminal.finishReason === 'stop') {
    assertFinalResponse(response);
    return { kind: 'completed' };
  }
  if (terminal?.type === 'model_failed') return { kind: 'failed' };
  const toolCall = runtimeToolCall(response, request);
  return { kind: 'tool_call', ...toolCall };
}

function assertInitialBoundary(
  snapshot: HarnessActivationSnapshot,
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
) {
  if (
    snapshot.run.id !== input.runId ||
    snapshot.run.status !== 'running' ||
    snapshot.activation.state !== 'active' ||
    snapshot.activation.activationNumber !== input.activationNumber
  ) {
    throw new Error('Target runtime requires the requested active running Activation');
  }
  if (canonicalJson(dependencies.model.provider) !== canonicalJson(snapshot.run.model)) {
    throw new Error('Model Adapter provider does not match the committed Run provider');
  }
}

function continuesActivation(
  snapshot: HarnessActivationSnapshot,
  input: RunTargetActivationInput,
): boolean {
  if (
    snapshot.run.id !== input.runId ||
    snapshot.activation.activationNumber !== input.activationNumber
  ) {
    throw new Error('Target runtime reloaded a different Run Activation');
  }
  if (input.signal?.aborted) return false;
  if (snapshot.activation.state === 'ended') return false;
  if (snapshot.run.status !== 'running') return false;
  if (snapshot.recoveryRequired) {
    throw new Error('Target runtime cannot continue across an unresolved recovery frontier');
  }
  return true;
}

function materializedToolIdsFromToolGet(
  snapshot: HarnessActivationSnapshot,
  executableToolIds: ReadonlySet<ToolId>,
): ReadonlySet<ToolId> {
  const calls = new Map<
    string,
    { readonly providerCallId: string; readonly canonicalArguments: unknown }
  >();
  const settled = new Set<string>();
  const materialized = new Set<ToolId>();
  const mismatch = (cause?: unknown): never => {
    throw new Error(
      'tool.get result does not match the frozen Capability Catalog',
      cause === undefined ? undefined : { cause },
    );
  };

  for (const fact of snapshot.facts) {
    if (fact.type === 'tool_call' && fact.toolId === ToolGetDefinition.id) {
      if (calls.has(fact.dispatchOperationId)) mismatch();
      calls.set(fact.dispatchOperationId, {
        providerCallId: fact.providerCallId,
        canonicalArguments: fact.canonicalArguments,
      });
      continue;
    }
    if (fact.type !== 'tool_result' || fact.toolId !== ToolGetDefinition.id) continue;
    const call = calls.get(fact.dispatchOperationId);
    if (
      call === undefined ||
      call.providerCallId !== fact.providerCallId ||
      settled.has(fact.dispatchOperationId)
    ) {
      return mismatch();
    }
    settled.add(fact.dispatchOperationId);
    if (fact.outcome.status !== 'succeeded') continue;

    const { input, success } = (() => {
      try {
        return {
          input: ToolGetDefinition.parseInput(
            call.canonicalArguments as Parameters<typeof ToolGetDefinition.parseInput>[0],
          ),
          success: ToolGetDefinition.parseSuccess(
            fact.outcome.data as Parameters<typeof ToolGetDefinition.parseSuccess>[0],
          ),
        };
      } catch (cause) {
        return mismatch(cause);
      }
    })();
    if (
      success.catalogHash !== snapshot.catalog.catalogHash ||
      canonicalJson(input.names) !== canonicalJson(success.definitions.map(({ id }) => id))
    ) {
      mismatch();
    }
    for (const definition of success.definitions) {
      const matches = snapshot.catalog.tools.filter(({ id }) => id === definition.id);
      if (matches.length !== 1 || canonicalJson(matches[0]) !== canonicalJson(definition)) {
        mismatch();
      }
      if (executableToolIds.has(definition.id)) materialized.add(definition.id);
    }
  }
  return materialized;
}

function materializedToolsFor(
  snapshot: HarnessActivationSnapshot,
  dependencies: TargetRuntimeDependencies,
): CanonicalModelRequestV1['materializedTools'] {
  const executor = dependencies.toolExecutor;
  if (executor.toolIds.length === 0) {
    throw new Error('Target ToolExecutor must declare at least one toolId');
  }
  const executableToolIds = new Set<ToolId>();
  for (const toolId of executor.toolIds) {
    if (executableToolIds.has(toolId)) {
      throw new Error(`Target ToolExecutor declares duplicate toolId ${toolId}`);
    }
    const frozen = snapshot.catalog.tools.find(({ id }) => id === toolId);
    const live =
      frozen === undefined
        ? undefined
        : (executableToolDefinition(toolId, frozen.version) as unknown as
            RuntimeToolDefinition | undefined);
    if (
      frozen === undefined ||
      live === undefined ||
      frozen.version !== live.version ||
      !isRuntimeReadTool(frozen)
    ) {
      throw new Error(`Target ToolExecutor toolId ${toolId} is not a live bounded R definition`);
    }
    executableToolIds.add(toolId);
  }
  const mediaAttach = snapshot.catalog.tools.find(({ id }) => id === MediaAttachDefinition.id);
  if (
    mediaAttach === undefined ||
    mediaAttach.version !== MediaAttachDefinition.version ||
    mediaAttach.metadata.profile !== 'RW' ||
    mediaAttach.metadata.domain !== 'media' ||
    mediaAttach.metadata.confirmation.mode !== 'none' ||
    mediaAttach.metadata.variantDiscriminant !== 'action' ||
    mediaAttach.metadata.variants.length !== 0
  ) {
    throw new Error('Frozen media.attach definition is unavailable or invalid');
  }
  executableToolIds.add(MediaAttachDefinition.id);
  const mediaDerive = snapshot.catalog.tools.find(({ id }) => id === MediaDeriveDefinition.id);
  if (
    mediaDerive === undefined ||
    mediaDerive.version !== MediaDeriveDefinition.version ||
    canonicalJson(mediaDerive.metadata) !== canonicalJson(MediaDeriveDefinition.metadata)
  ) {
    throw new Error('Frozen media.derive definition is unavailable or invalid');
  }
  executableToolIds.add(MediaDeriveDefinition.id);
  const mediaLink = snapshot.catalog.tools.find(({ id }) => id === MediaLinkDefinition.id);
  if (
    mediaLink === undefined ||
    mediaLink.version !== MediaLinkDefinition.version ||
    mediaLink.metadata.profile !== 'RW' ||
    mediaLink.metadata.domain !== 'media' ||
    mediaLink.metadata.confirmation.mode !== 'none' ||
    mediaLink.metadata.variantDiscriminant !== 'mode' ||
    canonicalJson(mediaLink.metadata.variants) !==
      canonicalJson(MediaLinkDefinition.metadata.variants)
  ) {
    throw new Error('Frozen media.link definition is unavailable or invalid');
  }
  executableToolIds.add(MediaLinkDefinition.id);
  const canvasMutate = snapshot.catalog.tools.find(({ id }) => id === CanvasMutateDefinition.id);
  if (
    canvasMutate === undefined ||
    canvasMutate.version !== CanvasMutateDefinition.version ||
    canonicalJson(canvasMutate.metadata) !== canonicalJson(CanvasMutateDefinition.metadata)
  ) {
    throw new Error('Frozen canvas.mutate definition is unavailable or invalid');
  }
  executableToolIds.add(CanvasMutateDefinition.id);
  const evaluationRun = snapshot.catalog.tools.find(({ id }) => id === EvaluationRunDefinition.id);
  if (
    evaluationRun === undefined ||
    evaluationRun.version !== EvaluationRunDefinition.version ||
    canonicalJson(evaluationRun.metadata) !== canonicalJson(EvaluationRunDefinition.metadata)
  ) {
    throw new Error('Frozen evaluation.run definition is unavailable or invalid');
  }
  executableToolIds.add(EvaluationRunDefinition.id);
  const generationSubmit = snapshot.catalog.tools.find(
    ({ id }) => id === GenerationSubmitDefinition.id,
  );
  if (
    generationSubmit === undefined ||
    generationSubmit.version !== GenerationSubmitDefinition.version ||
    canonicalJson(generationSubmit.metadata) !== canonicalJson(GenerationSubmitDefinition.metadata)
  ) {
    throw new Error('Frozen generation.submit definition is unavailable or invalid');
  }
  executableToolIds.add(GenerationSubmitDefinition.id);
  const deliveryPreview = snapshot.catalog.tools.find(
    ({ id }) => id === DeliveryPreviewDefinition.id,
  );
  if (
    deliveryPreview === undefined ||
    deliveryPreview.version !== DeliveryPreviewDefinition.version ||
    canonicalJson(deliveryPreview.metadata) !== canonicalJson(DeliveryPreviewDefinition.metadata)
  ) {
    throw new Error('Frozen delivery.preview definition is unavailable or invalid');
  }
  executableToolIds.add(DeliveryPreviewDefinition.id);
  const deliveryExport = snapshot.catalog.tools.find(
    ({ id }) => id === DeliveryExportDefinition.id,
  );
  if (
    deliveryExport === undefined ||
    deliveryExport.version !== DeliveryExportDefinition.version ||
    canonicalJson(deliveryExport.metadata) !== canonicalJson(DeliveryExportDefinition.metadata)
  ) {
    throw new Error('Frozen delivery.export definition is unavailable or invalid');
  }
  executableToolIds.add(DeliveryExportDefinition.id);
  const deliveryFreeze = snapshot.catalog.tools.find(
    ({ id }) => id === DeliveryFreezeDefinition.id,
  );
  if (
    deliveryFreeze === undefined ||
    deliveryFreeze.version !== DeliveryFreezeDefinition.version ||
    canonicalJson(deliveryFreeze.metadata) !== canonicalJson(DeliveryFreezeDefinition.metadata)
  ) {
    throw new Error('Frozen delivery.freeze definition is unavailable or invalid');
  }
  executableToolIds.add(DeliveryFreezeDefinition.id);
  const deliveryMutate = snapshot.catalog.tools.find(
    ({ id }) => id === DeliveryMutateDefinition.id,
  );
  if (
    deliveryMutate === undefined ||
    deliveryMutate.version !== DeliveryMutateDefinition.version ||
    canonicalJson(deliveryMutate.metadata) !== canonicalJson(DeliveryMutateDefinition.metadata)
  ) {
    throw new Error('Frozen delivery.mutate definition is unavailable or invalid');
  }
  executableToolIds.add(DeliveryMutateDefinition.id);
  const decisionRecord = snapshot.catalog.tools.find(
    ({ id }) => id === DecisionRecordDefinition.id,
  );
  if (
    decisionRecord === undefined ||
    decisionRecord.version !== DecisionRecordDefinition.version ||
    canonicalJson(decisionRecord.metadata) !== canonicalJson(DecisionRecordDefinition.metadata)
  ) {
    throw new Error('Frozen decision.record definition is unavailable or invalid');
  }
  executableToolIds.add(DecisionRecordDefinition.id);
  const decisionProtect = snapshot.catalog.tools.find(
    ({ id }) => id === DecisionProtectDefinition.id,
  );
  if (
    decisionProtect === undefined ||
    decisionProtect.version !== DecisionProtectDefinition.version ||
    canonicalJson(decisionProtect.metadata) !== canonicalJson(DecisionProtectDefinition.metadata)
  ) {
    throw new Error('Frozen decision.protect definition is unavailable or invalid');
  }
  executableToolIds.add(DecisionProtectDefinition.id);
  const productionMutate = snapshot.catalog.tools.find(
    ({ id }) => id === ProductionMutateDefinition.id,
  );
  if (
    productionMutate === undefined ||
    productionMutate.version !== ProductionMutateDefinition.version ||
    canonicalJson(productionMutate.metadata) !== canonicalJson(ProductionMutateDefinition.metadata)
  ) {
    throw new Error('Frozen production.mutate definition is unavailable or invalid');
  }
  executableToolIds.add(ProductionMutateDefinition.id);
  if (executor.initialToolIds.length === 0) {
    throw new Error('Target ToolExecutor must initially materialize at least one toolId');
  }
  const toolIds = new Set<ToolId>();
  for (const toolId of executor.initialToolIds) {
    if (toolIds.has(toolId)) {
      throw new Error(`Target ToolExecutor initially materializes duplicate toolId ${toolId}`);
    }
    if (!executableToolIds.has(toolId)) {
      throw new Error(`Target ToolExecutor initially materializes unsupported toolId ${toolId}`);
    }
    toolIds.add(toolId);
  }
  const onDemandToolIds = materializedToolIdsFromToolGet(snapshot, executableToolIds);
  if (
    onDemandToolIds.has(EvaluationRunDefinition.id) &&
    dependencies.resultAssessments === undefined
  ) {
    throw new Error('Materialized evaluation.run requires ResultAssessmentsAuthority');
  }
  if (
    (toolIds.has(DeliveryPreviewDefinition.id) ||
      toolIds.has(DeliveryExportDefinition.id) ||
      onDemandToolIds.has(DeliveryPreviewDefinition.id) ||
      onDemandToolIds.has(DeliveryExportDefinition.id)) &&
    dependencies.deliveryOperations === undefined
  ) {
    throw new Error('Materialized delivery tools require DeliveryOperationsAuthority');
  }
  if (onDemandToolIds.has(GenerationSubmitDefinition.id) && dependencies.generation === undefined) {
    throw new Error('Materialized generation.submit requires GenerationAuthority');
  }
  if (
    (toolIds.has(MediaDeriveDefinition.id) || onDemandToolIds.has(MediaDeriveDefinition.id)) &&
    dependencies.mediaDerivations === undefined
  ) {
    throw new Error('Materialized media.derive requires MediaDerivationsAuthority');
  }
  for (const toolId of onDemandToolIds) {
    toolIds.add(toolId);
  }
  const skillProposal = snapshot.catalog.tools.find(({ id }) => id === SkillProposeDefinition.id);
  if (
    skillProposal === undefined ||
    skillProposal.version !== SkillProposeDefinition.version ||
    skillProposal.metadata.profile !== 'PROTECTED' ||
    skillProposal.metadata.domain !== 'project' ||
    skillProposal.metadata.confirmation.mode !== 'exact_protected'
  ) {
    throw new Error('Frozen skill.propose definition is unavailable or invalid');
  }
  toolIds.add(SkillProposeDefinition.id);
  const agentSpawn = snapshot.catalog.tools.find(({ id }) => id === AgentSpawnDefinition.id);
  if (
    agentSpawn === undefined ||
    agentSpawn.version !== AgentSpawnDefinition.version ||
    agentSpawn.metadata.profile !== 'CTRL' ||
    agentSpawn.metadata.domain !== 'agent' ||
    agentSpawn.metadata.confirmation.mode !== 'none'
  ) {
    throw new Error('Frozen agent.spawn definition is unavailable or invalid');
  }
  toolIds.add(AgentSpawnDefinition.id);
  const agentSend = snapshot.catalog.tools.find(({ id }) => id === AgentSendDefinition.id);
  if (
    agentSend === undefined ||
    agentSend.version !== AgentSendDefinition.version ||
    agentSend.metadata.profile !== 'CTRL' ||
    agentSend.metadata.domain !== 'agent' ||
    agentSend.metadata.confirmation.mode !== 'none'
  ) {
    throw new Error('Frozen agent.send definition is unavailable or invalid');
  }
  toolIds.add(AgentSendDefinition.id);
  const agentWait = snapshot.catalog.tools.find(({ id }) => id === AgentWaitDefinition.id);
  if (
    agentWait === undefined ||
    agentWait.version !== AgentWaitDefinition.version ||
    agentWait.metadata.profile !== 'CTRL' ||
    agentWait.metadata.domain !== 'agent' ||
    agentWait.metadata.confirmation.mode !== 'none'
  ) {
    throw new Error('Frozen agent.wait definition is unavailable or invalid');
  }
  toolIds.add(AgentWaitDefinition.id);
  const agentResult = snapshot.catalog.tools.find(({ id }) => id === AgentResultDefinition.id);
  if (
    agentResult === undefined ||
    agentResult.version !== AgentResultDefinition.version ||
    agentResult.metadata.profile !== 'CTRL' ||
    agentResult.metadata.domain !== 'agent' ||
    agentResult.metadata.confirmation.mode !== 'none'
  ) {
    throw new Error('Frozen agent.result definition is unavailable or invalid');
  }
  toolIds.add(AgentResultDefinition.id);
  const agentCancel = snapshot.catalog.tools.find(({ id }) => id === AgentCancelDefinition.id);
  if (
    agentCancel === undefined ||
    agentCancel.version !== AgentCancelDefinition.version ||
    agentCancel.metadata.profile !== 'CTRL' ||
    agentCancel.metadata.domain !== 'agent' ||
    agentCancel.metadata.confirmation.mode !== 'none'
  ) {
    throw new Error('Frozen agent.cancel definition is unavailable or invalid');
  }
  toolIds.add(AgentCancelDefinition.id);
  const operationCancel = snapshot.catalog.tools.find(
    ({ id }) => id === OperationCancelDefinition.id,
  );
  if (
    operationCancel === undefined ||
    operationCancel.version !== OperationCancelDefinition.version ||
    operationCancel.metadata.profile !== 'CTRL' ||
    operationCancel.metadata.domain !== 'operation' ||
    operationCancel.metadata.confirmation.mode !== 'none' ||
    operationCancel.metadata.variantDiscriminant !== 'operations.ref.kind' ||
    canonicalJson(operationCancel.metadata.variants) !==
      canonicalJson(OperationCancelDefinition.metadata.variants)
  ) {
    throw new Error('Frozen operation.cancel definition is unavailable or invalid');
  }
  toolIds.add(OperationCancelDefinition.id);
  const interactionAsk = snapshot.catalog.tools.find(
    ({ id }) => id === InteractionAskDefinition.id,
  );
  if (
    interactionAsk === undefined ||
    interactionAsk.version !== InteractionAskDefinition.version ||
    interactionAsk.metadata.profile !== 'CTRL' ||
    interactionAsk.metadata.domain !== 'interaction' ||
    interactionAsk.metadata.confirmation.mode !== 'none'
  ) {
    throw new Error('Frozen interaction.ask definition is unavailable or invalid');
  }
  toolIds.add(InteractionAskDefinition.id);
  const taskManage = snapshot.catalog.tools.find(({ id }) => id === TaskManageDefinition.id);
  if (
    taskManage === undefined ||
    taskManage.version !== TaskManageDefinition.version ||
    taskManage.metadata.profile !== 'CTRL' ||
    taskManage.metadata.domain !== 'task' ||
    taskManage.metadata.confirmation.mode !== 'none' ||
    taskManage.metadata.variantDiscriminant !== 'action' ||
    canonicalJson(taskManage.metadata.variants) !==
      canonicalJson(TaskManageDefinition.metadata.variants)
  ) {
    throw new Error('Frozen task.manage definition is unavailable or invalid');
  }
  toolIds.add(TaskManageDefinition.id);
  const toolProgram = snapshot.catalog.tools.find(({ id }) => id === ToolProgramDefinition.id);
  if (
    toolProgram === undefined ||
    toolProgram.version !== ToolProgramDefinition.version ||
    toolProgram.metadata.profile !== 'CTRL' ||
    toolProgram.metadata.domain !== 'program' ||
    toolProgram.metadata.confirmation.mode !== 'none'
  ) {
    throw new Error('Frozen tool.program definition is unavailable or invalid');
  }
  toolIds.add(ToolProgramDefinition.id);
  return snapshot.catalog.tools.filter(({ id }) => toolIds.has(id));
}

function unresolvedToolProgramDispatch(snapshot: HarnessActivationSnapshot) {
  const dispatches = snapshot.dispatches.filter(
    (dispatch) =>
      dispatch.key.toolId === ToolProgramDefinition.id &&
      dispatch.origin.kind === 'model' &&
      dispatch.outcome === null,
  );
  if (dispatches.length > 1) {
    throw new Error(`Run ${snapshot.run.id} has multiple unresolved tool.program dispatches`);
  }
  return dispatches[0] ?? null;
}

function unresolvedAgentWaitDispatch(snapshot: HarnessActivationSnapshot) {
  const dispatches = snapshot.dispatches.filter(
    (dispatch) =>
      dispatch.key.toolId === AgentWaitDefinition.id &&
      dispatch.origin.kind === 'model' &&
      dispatch.outcome === null,
  );
  if (dispatches.length > 1) {
    throw new Error(`Run ${snapshot.run.id} has multiple unresolved agent.wait dispatches`);
  }
  return dispatches[0] ?? null;
}

function unresolvedDeliveryPreviewDispatch(snapshot: HarnessActivationSnapshot) {
  const dispatches = snapshot.dispatches.filter(
    (dispatch) =>
      dispatch.key.toolId === DeliveryPreviewDefinition.id &&
      dispatch.origin.kind === 'model' &&
      dispatch.outcome === null,
  );
  if (dispatches.length > 1) {
    throw new Error(`Run ${snapshot.run.id} has multiple unresolved delivery.preview dispatches`);
  }
  return dispatches[0] ?? null;
}

function unresolvedDeliveryExportDispatch(snapshot: HarnessActivationSnapshot) {
  const dispatches = snapshot.dispatches.filter(
    (dispatch) =>
      dispatch.key.toolId === DeliveryExportDefinition.id &&
      dispatch.origin.kind === 'model' &&
      dispatch.guardOutcome === 'allowed' &&
      dispatch.outcome === null,
  );
  if (dispatches.length > 1) {
    throw new Error(`Run ${snapshot.run.id} has multiple unresolved delivery.export dispatches`);
  }
  return dispatches[0] ?? null;
}

function unresolvedEvaluationRunDispatch(snapshot: HarnessActivationSnapshot) {
  const dispatches = snapshot.dispatches.filter(
    (dispatch) =>
      dispatch.key.toolId === EvaluationRunDefinition.id &&
      dispatch.origin.kind === 'model' &&
      dispatch.outcome === null,
  );
  if (dispatches.length > 1) {
    throw new Error(`Run ${snapshot.run.id} has multiple unresolved evaluation.run dispatches`);
  }
  return dispatches[0] ?? null;
}

function unresolvedGenerationSubmitDispatch(snapshot: HarnessActivationSnapshot) {
  const dispatches = snapshot.dispatches.filter(
    (dispatch) =>
      dispatch.key.toolId === GenerationSubmitDefinition.id &&
      dispatch.origin.kind === 'model' &&
      dispatch.outcome === null,
  );
  if (dispatches.length > 1) {
    throw new Error(`Run ${snapshot.run.id} has multiple unresolved generation.submit dispatches`);
  }
  return dispatches[0] ?? null;
}

function unresolvedMediaDeriveDispatch(snapshot: HarnessActivationSnapshot) {
  const dispatches = snapshot.dispatches.filter(
    (dispatch) =>
      dispatch.key.toolId === MediaDeriveDefinition.id &&
      dispatch.origin.kind === 'model' &&
      dispatch.outcome === null,
  );
  if (dispatches.length > 1) {
    throw new Error(`Run ${snapshot.run.id} has multiple unresolved media.derive dispatches`);
  }
  return dispatches[0] ?? null;
}

function settledAgentControlContinuation(snapshot: HarnessActivationSnapshot): boolean {
  return (
    snapshot.run.status === 'running' &&
    snapshot.activation.state === 'active' &&
    !snapshot.recoveryRequired &&
    snapshot.dispatches.some(
      (dispatch) =>
        dispatch.origin.kind === 'model' &&
        ((dispatch.key.toolId === DeliveryExportDefinition.id &&
          (dispatch.outcome?.status === 'succeeded' ||
            dispatch.outcome?.status === 'permission_denied')) ||
          ((dispatch.key.toolId === AgentSendDefinition.id ||
            dispatch.key.toolId === AgentWaitDefinition.id ||
            dispatch.key.toolId === AgentResultDefinition.id ||
            dispatch.key.toolId === AgentCancelDefinition.id ||
            dispatch.key.toolId === DeliveryPreviewDefinition.id ||
            dispatch.key.toolId === EvaluationRunDefinition.id ||
            dispatch.key.toolId === GenerationSubmitDefinition.id ||
            dispatch.key.toolId === MediaDeriveDefinition.id) &&
            dispatch.outcome?.status === 'succeeded')),
    )
  );
}

const AGENT_WAIT_POLL_INTERVAL_MS = 25;

async function executeAbortableOwnerOperation<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T | null> {
  if (signal?.aborted) return null;
  try {
    const result = await operation();
    return signal?.aborted ? null : result;
  } catch (cause) {
    if (signal?.aborted) return null;
    throw cause;
  }
}

function waitForAgentWaitPoll(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timeout = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      finish();
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function executeAgentWaitBoundary(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
  dispatchOperationId: string,
): Promise<void> {
  for (;;) {
    if (input.signal?.aborted) return;
    const boundary = dependencies.persistence.loadAgentWaitBoundary(dispatchOperationId);
    if (boundary.dispatch.outcome !== null) return;
    if (boundary.parent.status !== 'running' || boundary.activation.state !== 'active') {
      return;
    }
    if (boundary.conditionMet || boundary.remainingMs === 0) {
      dependencies.persistence.settleAgentWaitBoundary(
        {
          dispatchOperationId,
          activationNumber: input.activationNumber,
          completedAt: boundary.observedAt,
          commandId: id('cmd'),
        },
        input.context,
      );
      return;
    }
    await waitForAgentWaitPoll(
      Math.min(AGENT_WAIT_POLL_INTERVAL_MS, boundary.remainingMs),
      input.signal,
    );
  }
}

async function executeDeliveryPreviewBoundary(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
  dispatchOperationId: string,
): Promise<void> {
  if (input.signal?.aborted) return;
  const boundary = dependencies.persistence.loadDeliveryPreviewBoundary(dispatchOperationId);
  if (boundary.dispatch.outcome !== null) return;
  if (boundary.parent.status !== 'running' || boundary.activation.state !== 'active') return;
  const deliveryOperations = dependencies.deliveryOperations;
  if (deliveryOperations === undefined) {
    throw new Error('delivery.preview requires DeliveryOperationsAuthority');
  }
  const request = DeliveryPreviewDefinition.parseInput(
    boundary.dispatch.key.input as Record<string, unknown>,
  );
  const ownerResult = await executeAbortableOwnerOperation(input.signal, () =>
    deliveryOperations.preview(
      {
        runId: boundary.parent.id,
        commandId: id('cmd'),
        request,
        dispatchOperationId,
      },
      input.context,
      input.signal,
    ),
  );
  if (ownerResult === null) return;
  const result = DeliveryPreviewDefinition.parseSuccess({ ...ownerResult });
  dependencies.persistence.settleDeliveryPreviewBoundary(
    {
      dispatchOperationId,
      activationNumber: input.activationNumber,
      result,
      completedAt: new Date().toISOString(),
      commandId: id('cmd'),
    },
    input.context,
  );
}

async function executeDeliveryExportBoundary(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
  dispatchOperationId: string,
): Promise<void> {
  if (input.signal?.aborted) return;
  const boundary = dependencies.persistence.loadDeliveryExportBoundary(dispatchOperationId);
  if (boundary.dispatch.outcome !== null) return;
  if (
    boundary.dispatch.guardOutcome !== 'allowed' ||
    boundary.parent.status !== 'running' ||
    boundary.activation.state !== 'active'
  ) {
    return;
  }
  const deliveryOperations = dependencies.deliveryOperations;
  if (deliveryOperations === undefined) {
    throw new Error('delivery.export requires DeliveryOperationsAuthority');
  }
  const request = DeliveryExportDefinition.parseInput(
    boundary.dispatch.key.input as Record<string, unknown>,
  );
  const ownerResult = await executeAbortableOwnerOperation(input.signal, () =>
    deliveryOperations.export(
      {
        runId: boundary.parent.id,
        commandId: id('cmd'),
        confirmationId: boundary.confirmationId,
        request,
        dispatchOperationId,
      },
      input.context,
      input.signal,
    ),
  );
  if (ownerResult === null) return;
  const result = DeliveryExportDefinition.parseSuccess({ ...ownerResult });
  dependencies.persistence.settleDeliveryExportBoundary(
    {
      dispatchOperationId,
      activationNumber: input.activationNumber,
      result,
      completedAt: new Date().toISOString(),
      commandId: id('cmd'),
    },
    input.context,
  );
}

async function executeEvaluationRunBoundary(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
  dispatchOperationId: string,
): Promise<void> {
  if (input.signal?.aborted) return;
  const boundary = dependencies.persistence.loadEvaluationRunBoundary(dispatchOperationId);
  if (boundary.dispatch.outcome !== null) return;
  if (boundary.parent.status !== 'running' || boundary.activation.state !== 'active') return;
  const resultAssessments = dependencies.resultAssessments;
  if (resultAssessments === undefined) {
    throw new Error('evaluation.run requires ResultAssessmentsAuthority');
  }
  const request = EvaluationRunDefinition.parseInput(
    boundary.dispatch.key.input as Record<string, unknown>,
  );
  const terminal = (state: string) => ['succeeded', 'failed', 'cancelled'].includes(state);
  const local = request.kind === 'technical_integrity' || request.kind === 'delivery_readiness';
  let result = boundary.result;
  if (result === null) {
    const started = await executeAbortableOwnerOperation(input.signal, () =>
      resultAssessments.start(
        {
          runId: boundary.parent.id,
          commandId: id('cmd'),
          request,
          dispatchOperationId,
        },
        input.context,
        input.signal,
      ),
    );
    if (started === null) return;
    result = EvaluationRunDefinition.parseSuccess(started);
  }
  const currentResult = result;
  if (!terminal(currentResult.state)) {
    const operation = parseCanonical(ResultAssessmentOperationRefSchema, currentResult.operation);
    const continuation = {
      operation,
      expectedRevision: operation.revision,
      commandId: id('cmd'),
    };
    const continued = await executeAbortableOwnerOperation(input.signal, () =>
      local
        ? resultAssessments.executeLocal(continuation, input.context)
        : currentResult.state === 'unknown' || currentResult.state === 'submitted'
          ? resultAssessments.reconcileProvider(continuation, input.context, input.signal)
          : resultAssessments.submitProvider(continuation, input.context, input.signal),
    );
    if (continued === null) return;
    result = EvaluationRunDefinition.parseSuccess(continued);
  }
  if (!local && !terminal(result.state)) {
    const operation = parseCanonical(ResultAssessmentOperationRefSchema, result.operation);
    const reconciled = await executeAbortableOwnerOperation(input.signal, () =>
      resultAssessments.reconcileProvider(
        {
          operation,
          expectedRevision: operation.revision,
          commandId: id('cmd'),
        },
        input.context,
        input.signal,
      ),
    );
    if (reconciled === null) return;
    result = EvaluationRunDefinition.parseSuccess(reconciled);
  }
  dependencies.persistence.settleEvaluationRunBoundary(
    {
      dispatchOperationId,
      activationNumber: input.activationNumber,
      result,
      completedAt: new Date().toISOString(),
      commandId: id('cmd'),
    },
    input.context,
  );
}

async function executeGenerationSubmitBoundary(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
  dispatchOperationId: string,
): Promise<void> {
  if (input.signal?.aborted) return;
  const boundary = dependencies.persistence.loadGenerationSubmitBoundary(dispatchOperationId);
  if (boundary.dispatch.outcome !== null) return;
  if (boundary.parent.status !== 'running' || boundary.activation.state !== 'active') return;
  const generation = dependencies.generation;
  if (generation === undefined) throw new Error('generation.submit requires GenerationAuthority');
  let result = boundary.result;
  if (result === null) {
    const submitted = await executeAbortableOwnerOperation(input.signal, () =>
      generation.submit(
        {
          runId: boundary.parent.id,
          commandId: id('cmd'),
          request: GenerationSubmitDefinition.parseInput(
            boundary.dispatch.key.input as Record<string, unknown>,
          ),
          dispatchOperationId,
        },
        input.context,
        input.signal,
      ),
    );
    if (submitted === null) return;
    result = GenerationSubmitDefinition.parseSuccess(submitted);
  }
  if (!['succeeded', 'failed', 'cancelled'].includes(result.state)) {
    const operation = parseCanonical(GenerationOperationRefSchema, result.operation);
    const reconciled = await executeAbortableOwnerOperation(input.signal, () =>
      generation.reconcile(
        {
          operation,
          expectedRevision: operation.revision,
          commandId: id('cmd'),
        },
        input.context,
        input.signal,
      ),
    );
    if (reconciled === null) return;
    result = GenerationSubmitDefinition.parseSuccess(reconciled);
  }
  dependencies.persistence.settleGenerationSubmitBoundary(
    {
      dispatchOperationId,
      activationNumber: input.activationNumber,
      result,
      completedAt: new Date().toISOString(),
      commandId: id('cmd'),
    },
    input.context,
  );
}

async function executeMediaDeriveBoundary(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
  dispatchOperationId: string,
): Promise<void> {
  if (input.signal?.aborted) return;
  const boundary = dependencies.persistence.loadMediaDeriveBoundary(dispatchOperationId);
  if (boundary.dispatch.outcome !== null) return;
  if (boundary.parent.status !== 'running' || boundary.activation.state !== 'active') return;
  const mediaDerivations = dependencies.mediaDerivations;
  if (mediaDerivations === undefined) {
    throw new Error('media.derive requires MediaDerivationsAuthority');
  }
  if (boundary.result === null) {
    const started = await executeAbortableOwnerOperation(input.signal, () =>
      mediaDerivations.start(
        {
          runId: boundary.parent.id,
          commandId: id('cmd'),
          input: MediaDeriveDefinition.parseInput(
            boundary.dispatch.key.input as Record<string, unknown>,
          ),
          dispatchOperationId,
        },
        input.context,
      ),
    );
    if (started === null) return;
  }
  const continued = await executeAbortableOwnerOperation(input.signal, () =>
    mediaDerivations.continue(
      { dispatchOperationId, commandId: id('cmd') },
      input.context,
      input.signal,
    ),
  );
  if (continued === null) return;
  const result = MediaDeriveDefinition.parseSuccess(continued);
  dependencies.persistence.settleMediaDeriveBoundary(
    {
      dispatchOperationId,
      activationNumber: input.activationNumber,
      result,
      completedAt: new Date().toISOString(),
      commandId: id('cmd'),
    },
    input.context,
  );
}

function toolProgramInvocations(program: ToolProgramInput) {
  return program.steps.flatMap((step) => {
    if (step.operation === 'call') return [step.invocation];
    if (step.operation === 'map' || step.operation === 'batch') return step.invocations;
    return [];
  });
}

function executableToolProgramInvocation(
  catalog: CapabilityCatalogSnapshotV1,
  invocation: { readonly toolId: ToolId; readonly toolVersion: string; readonly input: unknown },
  executor: TargetToolExecutor,
): { readonly definition: RuntimeToolDefinition; readonly input: unknown } {
  const frozen = catalog.tools.find(
    ({ id, version }) => id === invocation.toolId && version === invocation.toolVersion,
  );
  const definition = executableToolDefinition(
    invocation.toolId,
    invocation.toolVersion,
  ) as unknown as RuntimeToolDefinition | undefined;
  if (
    frozen === undefined ||
    definition === undefined ||
    !isRecoverySafeRuntimeReadTool(frozen) ||
    !executor.toolIds.includes(invocation.toolId)
  ) {
    throw new Error(
      `Tool Program child ${invocation.toolId} is not available as a frozen recovery-safe R tool`,
    );
  }
  let input: unknown;
  try {
    input = definition.parseInput(invocation.input);
  } catch {
    throw new Error(
      `Tool Program child ${invocation.toolId}@${invocation.toolVersion} input is invalid`,
    );
  }
  if (canonicalJson(input) !== canonicalJson(invocation.input)) {
    throw new Error(
      `Tool Program child ${invocation.toolId}@${invocation.toolVersion} input is not canonical`,
    );
  }
  return { definition, input };
}

function assertRuntimeToolProgramEligibility(
  catalog: CapabilityCatalogSnapshotV1,
  program: ToolProgramInput,
  executor: TargetToolExecutor,
): void {
  for (const invocation of toolProgramInvocations(program)) {
    executableToolProgramInvocation(catalog, invocation, executor);
  }
}

function childRunContext(context: TargetCommandContext, childRunId: string): TargetCommandContext {
  return {
    ...context,
    causation: { kind: 'run', runId: childRunId },
  };
}

async function executeToolProgramBoundary(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
  parentDispatchOperationId: string,
): Promise<void> {
  const boundary = dependencies.persistence.loadToolProgramBoundary(parentDispatchOperationId);
  if (boundary.child.parent.status !== 'running') return;
  const child = boundary.child.child;
  if (
    child.status === 'completed' ||
    child.status === 'blocked' ||
    child.status === 'failed' ||
    child.status === 'cancelled'
  ) {
    dependencies.persistence.settleToolProgramParent(
      {
        parentDispatchOperationId,
        activationNumber: input.activationNumber,
        completedAt: new Date().toISOString(),
        commandId: id('cmd'),
      },
      input.context,
    );
    return;
  }
  const scheduled = dependencies.persistence.startToolProgramChildActivation(
    parentDispatchOperationId,
    input.context,
  );
  const childContext = childRunContext(input.context, scheduled.childRunId);
  let childSnapshot = dependencies.persistence.loadActivation(
    scheduled.childRunId,
    scheduled.activation.activationNumber,
  );
  const trigger = childSnapshot.inbox.find(
    ({ id: inboxId, sequence }) =>
      inboxId === childSnapshot.activation.triggerInboxMessageId &&
      sequence === childSnapshot.activation.triggerInboxSequence,
  );
  if (trigger?.state === 'delivered') {
    dependencies.persistence.consumeInbox(
      {
        runId: childSnapshot.run.id,
        expectedRevision: childSnapshot.run.revision,
        inboxMessageId: trigger.id,
        sequence: trigger.sequence,
        commandId: id('cmd'),
      },
      childContext,
    );
    childSnapshot = dependencies.persistence.loadActivation(
      scheduled.childRunId,
      scheduled.activation.activationNumber,
    );
  } else if (trigger?.state !== 'consumed') {
    throw new Error('Tool Program child Activation trigger Inbox is not available');
  }
  for (;;) {
    const advanced = dependencies.persistence.advanceToolProgramChild(
      {
        runId: scheduled.childRunId,
        activationNumber: scheduled.activation.activationNumber,
        commandId: id('cmd'),
      },
      childContext,
    );
    if (advanced.value.kind === 'terminal') break;
    const execution = advanced.value;

    let nextCallIndex = 0;
    let firstFailure: unknown;
    let stopScheduling = false;
    const worker = async () => {
      while (!stopScheduling) {
        if (
          !dependencies.persistence.isRunActivationActive(
            scheduled.childRunId,
            scheduled.activation.activationNumber,
          )
        ) {
          stopScheduling = true;
          return;
        }
        const call = execution.calls[nextCallIndex];
        if (call === undefined) return;
        nextCallIndex += 1;
        try {
          if (call.toolVersion !== call.dispatch.key.toolVersion) {
            throw new Error(
              `Tool Program child ${call.dispatch.key.toolId} version does not match its Dispatch`,
            );
          }
          const resolved = executableToolProgramInvocation(
            childSnapshot.catalog,
            {
              toolId: call.dispatch.key.toolId,
              toolVersion: call.toolVersion,
              input: call.toolInput,
            },
            dependencies.toolExecutor,
          );
          const outcome = parseCanonical(
            RuntimeLoopOutcomeSchema,
            resolved.definition.parseOutcome(
              await dependencies.toolExecutor.execute({
                dispatchOperationId: call.dispatch.id,
                operationFingerprint: call.dispatch.key.fingerprint,
                origin: {
                  kind: 'tool_program',
                  parentDispatchOperationId: call.parentDispatchOperationId,
                  programStepId: call.programStepId,
                  programCallIndex: call.programCallIndex,
                },
                runId: call.childRunId,
                projectId: call.dispatch.key.projectId,
                toolId: call.dispatch.key.toolId,
                toolVersion: call.toolVersion,
                authorityWatermarkHash: null,
                input: resolved.input,
              }),
            ),
          );
          if (
            !dependencies.persistence.isRunActivationActive(
              scheduled.childRunId,
              scheduled.activation.activationNumber,
            )
          ) {
            stopScheduling = true;
            return;
          }
          dependencies.persistence.settleToolProgramChildCall(
            {
              dispatchOperationId: call.dispatch.id,
              activationNumber: call.activationNumber,
              turnNumber: call.turnNumber,
              stepNumber: call.stepNumber,
              outcome,
              completedAt: new Date().toISOString(),
              commandId: id('cmd'),
            },
            childContext,
          );
        } catch (cause) {
          if (
            dependencies.persistence.isRunActivationActive(
              scheduled.childRunId,
              scheduled.activation.activationNumber,
            )
          ) {
            firstFailure ??= cause;
          }
          stopScheduling = true;
          return;
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(execution.concurrency, execution.calls.length) }, worker),
    );
    if (firstFailure !== undefined) throw firstFailure;

    if (!dependencies.persistence.isRunActivationActive(input.runId, input.activationNumber))
      return;
  }

  if (!dependencies.persistence.isRunActivationActive(input.runId, input.activationNumber)) return;
  dependencies.persistence.settleToolProgramParent(
    {
      parentDispatchOperationId,
      activationNumber: input.activationNumber,
      completedAt: new Date().toISOString(),
      commandId: id('cmd'),
    },
    input.context,
  );
}

async function runTargetActivationWithPrivateContext(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
  privateContext: PrivateModelContext,
): Promise<HarnessActivationSnapshot> {
  let snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
  let currentPrivateContext = privateContext;
  assertInitialBoundary(snapshot, dependencies, input);
  materializedToolsFor(snapshot, dependencies);
  const recoveredProgram = unresolvedToolProgramDispatch(snapshot);
  if (recoveredProgram !== null) {
    await executeToolProgramBoundary(dependencies, input, recoveredProgram.id);
    snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
  }
  const recoveredWait = unresolvedAgentWaitDispatch(snapshot);
  if (recoveredWait !== null) {
    await executeAgentWaitBoundary(dependencies, input, recoveredWait.id);
    snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    if (!continuesActivation(snapshot, input)) return snapshot;
  }
  const recoveredPreview = unresolvedDeliveryPreviewDispatch(snapshot);
  if (recoveredPreview !== null) {
    await executeDeliveryPreviewBoundary(dependencies, input, recoveredPreview.id);
    snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    if (!continuesActivation(snapshot, input)) return snapshot;
  }
  const recoveredExport = unresolvedDeliveryExportDispatch(snapshot);
  if (recoveredExport !== null) {
    await executeDeliveryExportBoundary(dependencies, input, recoveredExport.id);
    snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    if (!continuesActivation(snapshot, input)) return snapshot;
  }
  const recoveredEvaluation = unresolvedEvaluationRunDispatch(snapshot);
  if (recoveredEvaluation !== null) {
    await executeEvaluationRunBoundary(dependencies, input, recoveredEvaluation.id);
    snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    if (!continuesActivation(snapshot, input)) return snapshot;
  }
  const recoveredGeneration = unresolvedGenerationSubmitDispatch(snapshot);
  if (recoveredGeneration !== null) {
    await executeGenerationSubmitBoundary(dependencies, input, recoveredGeneration.id);
    snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    if (!continuesActivation(snapshot, input)) return snapshot;
  }
  const recoveredMediaDerive = unresolvedMediaDeriveDispatch(snapshot);
  if (recoveredMediaDerive !== null) {
    await executeMediaDeriveBoundary(dependencies, input, recoveredMediaDerive.id);
    snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    if (!continuesActivation(snapshot, input)) return snapshot;
  }
  const trigger = snapshot.inbox.find(
    ({ id: inboxId, sequence }) =>
      inboxId === snapshot.activation.triggerInboxMessageId &&
      sequence === snapshot.activation.triggerInboxSequence,
  );
  if (trigger?.state === 'delivered') {
    dependencies.persistence.consumeInbox(
      {
        runId: input.runId,
        expectedRevision: snapshot.run.revision,
        inboxMessageId: trigger.id,
        sequence: trigger.sequence,
        commandId: id('cmd'),
      },
      input.context,
    );
  } else if (trigger?.state !== 'consumed') {
    throw new Error('Activation trigger Inbox message is not delivered');
  }

  snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
  for (;;) {
    const materializedTools = materializedToolsFor(snapshot, dependencies);
    const attempt = await runModelAttempt(
      dependencies,
      snapshot,
      input,
      materializedTools,
      currentPrivateContext,
    );
    if (attempt.kind === 'aborted') {
      return dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    }
    if (attempt.kind === 'yielded') {
      return dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    }
    if (attempt.kind === 'spawned') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      currentPrivateContext = dependencies.persistence.materializePrivateModelContext(input.runId);
      continue;
    }
    if (attempt.kind === 'sent') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      currentPrivateContext = dependencies.persistence.materializePrivateModelContext(input.runId);
      continue;
    }
    if (attempt.kind === 'waiting') {
      await executeAgentWaitBoundary(dependencies, input, attempt.dispatchOperationId);
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'resulted') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'cancelled') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'interaction_asked') {
      return dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    }
    if (attempt.kind === 'delivery_export_waiting') {
      return dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    }
    if (attempt.kind === 'delivery_frozen') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'delivery_previewed') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'evaluation_run') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'generation_submitted') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'media_derived') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'media_attached') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'media_linked') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'canvas_mutated') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'operation_cancelled') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'task_managed') {
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (attempt.kind === 'tool_program') {
      await executeToolProgramBoundary(dependencies, input, attempt.parentDispatchOperationId);
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (!continuesActivation(snapshot, input)) return snapshot;
      currentPrivateContext = dependencies.persistence.materializePrivateModelContext(input.runId);
      continue;
    }
    if (attempt.boundary.kind === 'completed' || attempt.boundary.kind === 'failed') {
      return dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    }

    const { call, input: toolInput } = attempt.boundary;
    if (
      call.toolId === DeliveryMutateDefinition.id ||
      call.toolId === DecisionRecordDefinition.id ||
      call.toolId === DecisionProtectDefinition.id ||
      call.toolId === ProductionMutateDefinition.id
    ) {
      const protectedMutationInput =
        call.toolId === DeliveryMutateDefinition.id
          ? DeliveryMutateDefinition.parseInput(toolInput as Record<string, unknown>)
          : call.toolId === DecisionRecordDefinition.id
            ? DecisionRecordDefinition.parseInput(toolInput as Record<string, unknown>)
            : call.toolId === DecisionProtectDefinition.id
              ? DecisionProtectDefinition.parseInput(toolInput as Record<string, unknown>)
              : ProductionMutateDefinition.parseInput(toolInput as Record<string, unknown>);
      const boundary = dependencies.persistence.prepareProtectedMutationBoundary(
        {
          runId: input.runId,
          modelAttemptId: attempt.modelAttemptId,
          providerCallId: call.providerCallId,
          input: protectedMutationInput,
          activationNumber: input.activationNumber,
          turnNumber: attempt.step.turnNumber,
          stepNumber: attempt.step.stepNumber + 1,
          commandId: id('cmd'),
        },
        input.context,
      );
      snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
      if (boundary.value.kind === 'waiting_confirmation') return snapshot;
      if (!continuesActivation(snapshot, input)) return snapshot;
      continue;
    }
    if (call.toolId === SkillProposeDefinition.id) {
      dependencies.persistence.prepareSkillProposal(
        {
          runId: input.runId,
          modelAttemptId: attempt.modelAttemptId,
          providerCallId: call.providerCallId,
          input: SkillProposeDefinition.parseInput(toolInput as Record<string, unknown>),
          activationNumber: input.activationNumber,
          turnNumber: attempt.step.turnNumber,
          stepNumber: attempt.step.stepNumber + 1,
          commandId: id('cmd'),
        },
        input.context,
      );
      return dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    }
    const dispatch = dependencies.persistence.prepareDispatch(
      {
        runId: input.runId,
        modelAttemptId: attempt.modelAttemptId,
        providerCallId: call.providerCallId,
        toolId: call.toolId,
        input: toolInput,
        authorityWatermarkHash: null,
        activationNumber: input.activationNumber,
        turnNumber: attempt.step.turnNumber,
        stepNumber: attempt.step.stepNumber + 1,
        commandId: id('cmd'),
      },
      input.context,
    );
    if (dispatch.value.guardOutcome !== 'allowed') {
      throw new Error(`Runtime R dispatch ${dispatch.value.id} was not allowed`);
    }
    const dispatchDefinition = executableToolDefinition(
      dispatch.value.key.toolId,
      dispatch.value.key.toolVersion,
    ) as unknown as RuntimeToolDefinition | undefined;
    if (dispatchDefinition === undefined) {
      throw new Error(
        `Runtime R dispatch ${dispatch.value.key.toolId}@${dispatch.value.key.toolVersion} is unavailable`,
      );
    }
    const outcome = parseCanonical(
      RuntimeLoopOutcomeSchema,
      dispatchDefinition.parseOutcome(
        await dependencies.toolExecutor.execute({
          dispatchOperationId: dispatch.value.id,
          operationFingerprint: dispatch.value.key.fingerprint,
          origin: {
            kind: 'model',
            modelAttemptId: attempt.modelAttemptId,
            providerCallId: call.providerCallId,
          },
          runId: input.runId,
          projectId: dispatch.value.key.projectId,
          toolId: call.toolId,
          toolVersion: dispatch.value.key.toolVersion,
          authorityWatermarkHash: null,
          input: toolInput,
        }),
      ),
    );
    dependencies.persistence.settleDispatch(
      {
        dispatchOperationId: dispatch.value.id,
        modelAttemptId: attempt.modelAttemptId,
        providerCallId: call.providerCallId,
        outcome,
        activationNumber: input.activationNumber,
        turnNumber: attempt.step.turnNumber,
        stepNumber: attempt.step.stepNumber + 1,
        completedAt: new Date().toISOString(),
        commandId: id('cmd'),
      },
      input.context,
    );

    snapshot = dependencies.persistence.loadActivation(input.runId, input.activationNumber);
    if (!continuesActivation(snapshot, input)) return snapshot;
  }
}

export async function runTargetActivation(
  dependencies: TargetRuntimeDependencies,
  input: RunTargetActivationInput,
): Promise<HarnessActivationSnapshot> {
  const privateContext = dependencies.persistence.materializePrivateModelContext(input.runId);
  return runTargetActivationWithPrivateContext(dependencies, input, privateContext);
}

function coordinatorRun(runs: RunSchedulingAuthority, runId: string): Run {
  return runs.get({
    wireVersion: 1,
    kind: 'request',
    requestId: id('request'),
    method: 'run.get',
    input: { runId },
  }).result;
}

function coordinatorInbox(runs: RunSchedulingAuthority, runId: string) {
  return (
    runs.listInbox(runId).find(({ state }) => state !== 'consumed' && state !== 'cancelled') ?? null
  );
}

function terminalRun(run: Run): boolean {
  return (
    run.status === 'completed' ||
    run.status === 'blocked' ||
    run.status === 'failed' ||
    run.status === 'cancelled'
  );
}

function terminalModelFailure(
  snapshot: HarnessActivationSnapshot,
): Extract<ModelAdapterEvent, { readonly type: 'model_failed' }> | null {
  const terminal = snapshot.modelAttempts.at(-1)?.response?.events.at(-1);
  return terminal?.type === 'model_failed' ? terminal : null;
}

function terminalizeModelFailure(
  dependencies: Pick<RunCoordinatorDependencies, 'persistence' | 'runs'>,
  snapshot: HarnessActivationSnapshot,
  context: TargetCommandContext,
): HarnessActivationSnapshot | null {
  const failure = terminalModelFailure(snapshot);
  if (
    failure === null ||
    failure.typedCode === 'process_interrupted' ||
    (failure.typedCode === 'cancelled' && failure.providerState !== 'terminal') ||
    snapshot.run.status !== 'running' ||
    snapshot.activation.state !== 'active'
  ) {
    return null;
  }
  const run = dependencies.runs.terminalize(
    {
      runId: snapshot.run.id,
      expectedRevision: snapshot.run.revision,
      status: failure.typedCode === 'cancelled' ? 'cancelled' : 'failed',
      summary: `Model attempt failed: ${failure.typedCode}.`,
      resultIds: [],
      commandId: id('cmd'),
    },
    context,
  );
  return dependencies.persistence.loadActivation(run.id, snapshot.activation.activationNumber);
}

function assertRunCoordinatorInput(input: CoordinateRunInput): string {
  const runId = parseCanonical(EntityIdSchema, input.runId);
  if (
    input.context.actor !== 'commander' ||
    input.context.causation.kind !== 'run' ||
    input.context.causation.runId !== runId
  ) {
    throw new Error('Run Coordinator requires Commander causation for the requested Run');
  }
  return runId;
}

export async function coordinateRun(
  dependencies: RunCoordinatorDependencies,
  input: CoordinateRunInput,
): Promise<RunCoordinationResult> {
  const runId = assertRunCoordinatorInput(input);
  let run = coordinatorRun(dependencies.runs, runId);
  let pendingInbox = coordinatorInbox(dependencies.runs, runId);
  if (!dependencies.runs.isSchedulingAllowed(runId)) {
    return { kind: 'deferred', run, pendingInbox, reason: 'paused_control_subtree' };
  }
  const active = dependencies.runs.listActivations(runId).filter(({ state }) => state === 'active');
  if (active.length > 1) throw new Error(`Run ${runId} has multiple active Activations`);
  if (active.length === 1) {
    const activation = active[0]!;
    const snapshot = dependencies.persistence.loadActivation(runId, activation.activationNumber);
    if (run.status !== 'accepted' && run.status !== 'running') {
      return { kind: 'deferred', run, pendingInbox, reason: 'run_not_running' };
    }
    const failed = terminalizeModelFailure(dependencies, snapshot, input.context);
    if (failed !== null) {
      return {
        kind: 'executed',
        runId,
        activationNumber: activation.activationNumber,
        triggerInboxMessageId: activation.triggerInboxMessageId,
        snapshot: failed,
      };
    }
    const program = unresolvedToolProgramDispatch(snapshot);
    const wait = unresolvedAgentWaitDispatch(snapshot);
    const preview = unresolvedDeliveryPreviewDispatch(snapshot);
    const deliveryExport = unresolvedDeliveryExportDispatch(snapshot);
    const evaluation = unresolvedEvaluationRunDispatch(snapshot);
    const generation = unresolvedGenerationSubmitDispatch(snapshot);
    const mediaDerive = unresolvedMediaDeriveDispatch(snapshot);
    if (
      program !== null ||
      wait !== null ||
      preview !== null ||
      deliveryExport !== null ||
      evaluation !== null ||
      generation !== null ||
      mediaDerive !== null ||
      settledAgentControlContinuation(snapshot)
    ) {
      let resumed = await runTargetActivationWithPrivateContext(
        dependencies,
        {
          ...input,
          runId,
          activationNumber: activation.activationNumber,
        },
        dependencies.persistence.materializePrivateModelContext(runId),
      );
      resumed = terminalizeModelFailure(dependencies, resumed, input.context) ?? resumed;
      return {
        kind: 'executed',
        runId,
        activationNumber: activation.activationNumber,
        triggerInboxMessageId: activation.triggerInboxMessageId,
        snapshot: resumed,
      };
    }
    if (snapshot.recoveryRequired) {
      return { kind: 'deferred', run, pendingInbox, reason: 'active_activation' };
    }
    const resumed = await runTargetActivationWithPrivateContext(
      dependencies,
      {
        ...input,
        runId,
        activationNumber: activation.activationNumber,
      },
      dependencies.persistence.materializePrivateModelContext(runId),
    );
    return {
      kind: 'executed',
      runId,
      activationNumber: activation.activationNumber,
      triggerInboxMessageId: activation.triggerInboxMessageId,
      snapshot: terminalizeModelFailure(dependencies, resumed, input.context) ?? resumed,
    };
  }
  if (terminalRun(run)) {
    return pendingInbox === null
      ? { kind: 'idle', run, reason: 'terminal' }
      : { kind: 'deferred', run, pendingInbox, reason: 'terminal_run_requires_new_root' };
  }
  if (run.status !== 'accepted' && run.status !== 'running') {
    return { kind: 'deferred', run, pendingInbox, reason: 'run_not_running' };
  }
  if (pendingInbox === null) return { kind: 'idle', run, reason: 'no_pending_inbox' };
  for (;;) {
    if (pendingInbox.state === 'queued') {
      dependencies.persistence.materializePrivateRunContext(runId);
      pendingInbox = dependencies.runs.transitionInbox(
        {
          runId,
          expectedRevision: run.revision,
          inboxMessageId: pendingInbox.id,
          sequence: pendingInbox.sequence,
          action: 'deliver',
          commandId: id('cmd'),
        },
        input.context,
      );
      run = coordinatorRun(dependencies.runs, runId);
    }
    if (pendingInbox.state !== 'delivered') {
      throw new Error(`Run Coordinator cannot schedule Inbox state ${pendingInbox.state}`);
    }
    const privateContext = dependencies.persistence.materializePrivateModelContext(runId);
    const activation = dependencies.runs.startActivation(
      { runId, expectedRevision: run.revision, commandId: id('cmd') },
      input.context,
    );
    let snapshot = await runTargetActivationWithPrivateContext(
      dependencies,
      {
        ...input,
        runId,
        activationNumber: activation.activationNumber,
      },
      privateContext,
    );
    snapshot = terminalizeModelFailure(dependencies, snapshot, input.context) ?? snapshot;
    const executed: RunCoordinationResult = {
      kind: 'executed',
      runId,
      activationNumber: activation.activationNumber,
      triggerInboxMessageId: activation.triggerInboxMessageId,
      snapshot,
    };
    if (
      snapshot.recoveryRequired ||
      snapshot.run.status !== 'running' ||
      snapshot.activation.state !== 'ended' ||
      snapshot.activation.endReason !== 'safe_boundary'
    ) {
      return executed;
    }

    run = coordinatorRun(dependencies.runs, runId);
    pendingInbox = coordinatorInbox(dependencies.runs, runId);
    const nextActive = dependencies.runs
      .listActivations(runId)
      .filter(({ state }) => state === 'active');
    if (nextActive.length > 1) {
      throw new Error(`Run ${runId} has multiple active Activations`);
    }
    if (nextActive.length === 1 || run.status !== 'running' || pendingInbox === null) {
      return executed;
    }
  }
}
