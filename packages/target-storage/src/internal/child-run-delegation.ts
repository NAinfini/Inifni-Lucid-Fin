import {
  AgentSpawnDefinition,
  CapabilityCatalogSnapshotV1Schema,
  ContextManifestSchema,
  EntityIdSchema,
  RevisionSchema,
  RunInboxMessageSchema,
  RunSchema,
  RunTerminalStateSchema,
  SelectedContextRefSchema,
  ToolProgramInputSchema,
  type ToolId,
  type ToolProgramInput,
  assertCapabilityCatalogLineage,
  assertPolicyNarrowing,
  assertRunContextManifest,
  capabilityCatalogHashInput,
  capabilityIndexDigestInput,
  canonicalJson,
  parseCanonical,
  skillCatalogDigestInput,
  strictObject,
  toolCatalogDigestInput,
  z,
  type CapabilityCatalogSnapshotV1,
  type ContextManifest,
  type ResourceBudget,
  type Run,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import type { PrivateRecoveryCodec } from '../kernel/private-recovery-codec.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import type { TargetStorageEnvironment } from './environment.js';
import { hashCanonical, hashContentObject, hashUtf8 } from './hashes.js';
import {
  appendChildObjectiveRecovery,
  appendToolProgramRecovery,
  durableToolProgramInput,
  materializePrivateModelContext,
  materializePrivateToolProgramContext,
} from './private-recovery.js';
import { insertRunInboxMessage, listRunInbox } from './run-inbox.js';
import { appendRunEventBatch, loadPublicRunEventForCommand } from './run-journal.js';
import { advanceRunJournalHead, loadRun } from './run-records.js';
import { insertAcceptedRunSnapshot } from './run-snapshot-write.js';
import { loadRunSnapshots } from './run-snapshots.js';
import { assertSelectedContext } from './root-run-acceptance.js';
import { TargetCommandContextSchema, type TargetCommandContext } from './command.js';

const ChildDelegationInputSchema = strictObject({
  parentRunId: EntityIdSchema,
  expectedParentRevision: RevisionSchema,
  commandId: EntityIdSchema,
  spawnInput: AgentSpawnDefinition.inputSchema,
}).superRefine((input, context) => {
  if (input.expectedParentRevision !== input.spawnInput.expectedParentRevision) {
    context.addIssue({
      code: 'custom',
      path: ['spawnInput', 'expectedParentRevision'],
      message: 'Host and agent.spawn parent revisions must match',
    });
  }
});

export type ChildDelegationInput = z.output<typeof ChildDelegationInputSchema>;
export type ChildDelegationResult = z.output<typeof AgentSpawnDefinition.successSchema>;

export interface ObservedParentRunRef {
  readonly id: string;
  readonly revision: number;
  readonly contentHash: string;
  readonly publicEventHead: Run['publicEventHead'];
}

export interface DelegateChildRunInTransactionInput {
  readonly delegation: ChildDelegationInput;
  readonly observedParent: ObservedParentRunRef;
  readonly currentParent: ObservedParentRunRef;
  readonly parentDispatchOperationId: string | null;
}

export interface ChildDelegationCommit {
  readonly result: ChildDelegationResult;
  readonly parent: Run;
  readonly child: Run;
}

function invalid(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'INVALID_REQUEST',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function conflict(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'IDEMPOTENCY_CONFLICT',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function parseInput(value: ChildDelegationInput): ChildDelegationInput {
  try {
    return parseCanonical(ChildDelegationInputSchema, value);
  } catch (cause) {
    throw invalid('Child delegation input is invalid', cause);
  }
}

function operationFingerprint(
  input: ChildDelegationInput,
  context: TargetCommandContext,
  directionHash: string,
): string {
  return hashCanonical({
    operation: 'agent.spawn',
    parentRunId: input.parentRunId,
    expectedParentRevision: input.expectedParentRevision,
    displayName: input.spawnInput.displayName,
    publicSummary: input.spawnInput.publicSummary,
    directionHash,
    contextRefs: input.spawnInput.contextRefs,
    toolAllowlist: input.spawnInput.toolAllowlist,
    permissionCeiling: input.spawnInput.permissionCeiling,
    budgetCaps: input.spawnInput.budgetCaps,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
  });
}

function derivePolicy(
  parent: Run,
  source: Readonly<{
    permissionCeiling: Run['permissionMode'] | null;
    budgetCaps: ResourceBudget | null;
  }>,
): { permissionMode: Run['permissionMode']; budget: ResourceBudget } {
  const permissionMode = source.permissionCeiling ?? parent.permissionMode;
  const budget = source.budgetCaps ?? parent.budget;
  try {
    assertPolicyNarrowing(parent.permissionMode, parent.budget, permissionMode, budget);
  } catch (cause) {
    throw invalid('Child Run policy exceeds its parent Run', cause);
  }
  return { permissionMode, budget };
}

function deriveCatalog(
  parent: CapabilityCatalogSnapshotV1,
  allowlist: readonly ToolId[] | null,
): CapabilityCatalogSnapshotV1 {
  const toolIds = allowlist ?? parent.tools.map(({ id }) => id);
  if (toolIds.some((id, index) => index > 0 && toolIds[index - 1]! >= id)) {
    throw invalid('Child tool allowlist must be sorted and unique');
  }
  const parentTools = new Map(parent.tools.map((tool) => [tool.id, tool]));
  const parentIndex = new Map(parent.capabilityIndex.map((entry) => [entry.name, entry]));
  const tools = toolIds.map((id) => {
    const tool = parentTools.get(id);
    if (tool === undefined) throw invalid(`Child tool ${id} is not available to its parent Run`);
    return tool;
  });
  const capabilityIndex = toolIds.map((id) => {
    const entry = parentIndex.get(id);
    if (entry === undefined) {
      throw new TargetStorageError('CORRUPT_DATA', `Parent catalog index is missing ${id}`);
    }
    return entry;
  });
  const withoutHash = {
    version: 1 as const,
    parserPolicyVersion: parent.parserPolicyVersion,
    parentCatalogHash: parent.catalogHash,
    toolCatalogDigest: hashUtf8(toolCatalogDigestInput(tools)),
    skillCatalogDigest: hashUtf8(skillCatalogDigestInput(parent.skills)),
    capabilityIndexDigest: hashUtf8(capabilityIndexDigestInput(capabilityIndex)),
    tools,
    skills: parent.skills,
    capabilityIndex,
  };
  const catalog = parseCanonical(CapabilityCatalogSnapshotV1Schema, {
    ...withoutHash,
    catalogHash: hashUtf8(capabilityCatalogHashInput(withoutHash)),
  });
  try {
    assertCapabilityCatalogLineage(parent, catalog);
  } catch (cause) {
    throw new TargetStorageError('CORRUPT_DATA', 'Derived child catalog is not a parent subset', {
      cause,
    });
  }
  if (canonicalJson(catalog.skills) !== canonicalJson(parent.skills)) {
    throw new TargetStorageError('CORRUPT_DATA', 'Derived child catalog changed parent skills');
  }
  return catalog;
}

function assertAuthorizedContext(
  database: DatabaseSync,
  parent: Run,
  manifest: ContextManifest,
  selected: readonly z.output<typeof SelectedContextRefSchema>[],
): void {
  assertSelectedContext(database, parent.projectId, selected);
  const allowed = new Set(manifest.selectedContext.map((entry) => canonicalJson(entry)));
  const unauthorized = selected.find((entry) => !allowed.has(canonicalJson(entry)));
  if (unauthorized !== undefined) {
    throw invalid('Child context must be an exact subset of parent selected context');
  }
}

function initialChildResult(
  child: Run,
  manifestHash: string,
  catalogHash: string,
): ChildDelegationResult {
  if (child.privateRecoveryHead?.sequence !== 1) {
    throw conflict('Existing delegation child has no initial private recovery envelope');
  }
  const initialWithoutHash = {
    ...child,
    revision: 1,
    contentHash: '',
    status: 'accepted' as const,
    publicEventHead: null,
    privateRecoveryHead: child.privateRecoveryHead,
    terminalOutcome: null,
  };
  const initial = parseCanonical(RunSchema, {
    ...initialWithoutHash,
    contentHash: hashContentObject(initialWithoutHash),
  });
  if (initial.parentRunId === null || initial.acceptedSource.kind !== 'parent_direction') {
    throw conflict('Existing delegation child is not a child Run');
  }
  return AgentSpawnDefinition.parseSuccess({
    child: {
      childRunId: initial.id,
      revision: initial.revision,
      contentHash: initial.contentHash,
      state: initial.status,
      objectiveHash: initial.acceptedSource.directionHash,
    },
    manifestHash,
    capabilityCatalogHash: catalogHash,
  });
}

interface DelegatedChildSemantics {
  readonly displayName: string;
  readonly publicSummary: string;
  readonly selectedContext: readonly z.output<typeof SelectedContextRefSchema>[];
  readonly toolAllowlist: readonly ToolId[] | null;
  readonly permissionCeiling: Run['permissionMode'] | null;
  readonly budgetCaps: ResourceBudget | null;
  readonly directionHash: string;
}

function assertDelegatedChildReplay(
  database: DatabaseSync,
  parent: Run,
  parentManifest: ContextManifest,
  parentCatalog: CapabilityCatalogSnapshotV1,
  child: Run,
  event: NonNullable<ReturnType<typeof loadPublicRunEventForCommand>>,
  semantics: DelegatedChildSemantics,
): void {
  const policy = derivePolicy(parent, semantics);
  const catalog = deriveCatalog(parentCatalog, semantics.toolAllowlist);
  const stored = loadRunSnapshots(database, child);
  const acceptedSource = {
    kind: 'parent_direction' as const,
    parentRunId: parent.id,
    parentEventId: event.eventId,
    directionHash: semantics.directionHash,
  };
  const expectedManifest = parseCanonical(ContextManifestSchema, {
    authority: 'context_manifest',
    id: stored.manifest.id,
    runId: child.id,
    retryOfRunId: null,
    retrySeedHash: null,
    projectId: parent.projectId,
    projectRevision: parentManifest.projectRevision,
    projectSettings: parentManifest.projectSettings,
    chatId: parent.chatId,
    acceptedSource,
    locale: parentManifest.locale,
    timeZone: parentManifest.timeZone,
    selectedContext: semantics.selectedContext,
    projectMedia: parentManifest.projectMedia,
    attachments: parentManifest.attachments,
    historyWatermark: parentManifest.historyWatermark,
    memory: parentManifest.memory,
    model: parentManifest.model,
    permissionMode: policy.permissionMode,
    budget: policy.budget,
    capabilityCatalogSnapshotId: stored.manifest.capabilityCatalogSnapshotId,
    capabilityCatalogHash: catalog.catalogHash,
    capabilityIndex: catalog.capabilityIndex,
    capabilityIndexDigest: catalog.capabilityIndexDigest,
    skillCatalogDigest: catalog.skillCatalogDigest,
    createdAt: child.acceptedAt,
  });
  const immutableChild = {
    rootRunId: child.rootRunId,
    parentRunId: child.parentRunId,
    retryOfRunId: child.retryOfRunId,
    retrySeedHash: child.retrySeedHash,
    projectId: child.projectId,
    chatId: child.chatId,
    acceptedSource: child.acceptedSource,
    model: child.model,
    permissionMode: child.permissionMode,
    budget: child.budget,
    contextManifestId: child.contextManifestId,
    contextManifestHash: child.contextManifestHash,
    capabilityCatalogSnapshotId: child.capabilityCatalogSnapshotId,
    capabilityCatalogHash: child.capabilityCatalogHash,
    acceptedAt: child.acceptedAt,
    displayName: child.parentRunId === null ? null : child.displayName,
    publicSummary: child.parentRunId === null ? null : child.publicSummary,
  };
  const expectedChild = {
    rootRunId: parent.rootRunId,
    parentRunId: parent.id,
    retryOfRunId: null,
    retrySeedHash: null,
    projectId: parent.projectId,
    chatId: parent.chatId,
    acceptedSource,
    model: parentManifest.model,
    permissionMode: policy.permissionMode,
    budget: policy.budget,
    contextManifestId: stored.manifest.id,
    contextManifestHash: hashCanonical(expectedManifest),
    capabilityCatalogSnapshotId: stored.manifest.capabilityCatalogSnapshotId,
    capabilityCatalogHash: catalog.catalogHash,
    acceptedAt: event.occurredAt,
    displayName: semantics.displayName,
    publicSummary: semantics.publicSummary,
  };
  const firstInbox = listRunInbox(database, child.id)[0];
  if (
    canonicalJson(immutableChild) !== canonicalJson(expectedChild) ||
    canonicalJson(stored.manifest) !== canonicalJson(expectedManifest) ||
    canonicalJson(stored.catalog) !== canonicalJson(catalog) ||
    firstInbox === undefined ||
    firstInbox.sequence !== 1 ||
    firstInbox.actor !== 'commander' ||
    canonicalJson(firstInbox.source) !== canonicalJson(acceptedSource) ||
    canonicalJson(firstInbox.selectedContext) !== canonicalJson(semantics.selectedContext) ||
    firstInbox.contentHash !== semantics.directionHash ||
    firstInbox.createdAt !== child.acceptedAt
  ) {
    throw conflict('Delegated child persisted different semantics');
  }
}

function replayExisting(
  database: DatabaseSync,
  parent: Run,
  parentManifest: ContextManifest,
  parentCatalog: CapabilityCatalogSnapshotV1,
  input: ChildDelegationInput,
  event: NonNullable<ReturnType<typeof loadPublicRunEventForCommand>>,
  directionHash: string,
  expectedOperationFingerprint: string,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
): ChildDelegationResult {
  const payload = event.payloadState.state === 'available' ? event.payloadState.payload : null;
  if (
    payload === null ||
    payload.type !== 'child_run_delegated' ||
    payload.displayName !== input.spawnInput.displayName ||
    payload.publicSummary !== input.spawnInput.publicSummary ||
    payload.directionHash !== directionHash ||
    payload.operationFingerprint !== expectedOperationFingerprint
  ) {
    throw conflict(`Child delegation command ${input.commandId} has different semantics`);
  }
  try {
    const child = loadRun(database, payload.childRunId);
    const privateContext = materializePrivateModelContext(database, privateRecoveryCodec, child);
    if (
      privateContext.parentDirections.length !== 1 ||
      privateContext.parentDirections[0]!.objective !== input.spawnInput.objective
    ) {
      throw conflict(`Child delegation command ${input.commandId} has a different objective`);
    }
    assertDelegatedChildReplay(database, parent, parentManifest, parentCatalog, child, event, {
      displayName: input.spawnInput.displayName,
      publicSummary: input.spawnInput.publicSummary,
      selectedContext: input.spawnInput.contextRefs,
      toolAllowlist: input.spawnInput.toolAllowlist,
      permissionCeiling: input.spawnInput.permissionCeiling,
      budgetCaps: input.spawnInput.budgetCaps,
      directionHash,
    });
    return initialChildResult(child, child.contextManifestHash, child.capabilityCatalogHash);
  } catch (cause) {
    if (
      cause instanceof TargetStorageError &&
      (cause.code === 'IDEMPOTENCY_CONFLICT' ||
        cause.code === 'CORRUPT_DATA' ||
        cause.code === 'SECURITY_CONFIGURATION_FAILED')
    ) {
      throw cause;
    }
    throw conflict(`Child delegation command ${input.commandId} cannot be replayed exactly`, cause);
  }
}

interface DelegatedChildSource extends DelegatedChildSemantics {
  readonly commandId: string;
  readonly operationFingerprint: string;
}

function createDelegatedChildInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  parent: Run,
  parentManifest: ContextManifest,
  parentCatalog: CapabilityCatalogSnapshotV1,
  source: DelegatedChildSource,
  context: TargetCommandContext,
  appendRecovery: (
    input: Readonly<{
      envelopeId: string;
      child: Run;
      inbox: z.output<typeof RunInboxMessageSchema>;
      createdAt: string;
    }>,
  ) => { readonly run: Run },
): {
  readonly parent: Run;
  readonly child: Run;
  readonly manifestHash: string;
  readonly catalogHash: string;
} {
  const policy = derivePolicy(parent, source);
  const catalog = deriveCatalog(parentCatalog, source.toolAllowlist);
  const acceptedAt = environment.now();
  const childRunId = environment.createId('run');
  const manifestId = environment.createId('context_manifest');
  const catalogSnapshotId = environment.createId('capability_catalog_snapshot');
  const inboxMessageId = environment.createId('run_inbox_message');
  const eventId = environment.createId('run_event');
  const recoveryEnvelopeId = environment.createId('private_recovery_envelope');
  const [event] = appendRunEventBatch(database, {
    runId: parent.id,
    commandId: source.commandId,
    events: [
      {
        eventId,
        visibility: 'public',
        occurredAt: acceptedAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'child_run_delegated',
          childRunId,
          displayName: source.displayName,
          publicSummary: source.publicSummary,
          directionHash: source.directionHash,
          operationFingerprint: source.operationFingerprint,
        },
      },
    ],
  });
  if (event === undefined) {
    throw new TargetStorageError('CORRUPT_DATA', 'Child delegation event was not appended');
  }
  const delegatedParent = advanceRunJournalHead(database, parent, {
    eventId: event.eventId,
    sequence: event.sequence,
    eventHash: event.eventHash,
  });
  const acceptedSource = {
    kind: 'parent_direction' as const,
    parentRunId: parent.id,
    parentEventId: event.eventId,
    directionHash: source.directionHash,
  };
  const manifest = parseCanonical(ContextManifestSchema, {
    authority: 'context_manifest',
    id: manifestId,
    runId: childRunId,
    retryOfRunId: null,
    retrySeedHash: null,
    projectId: parent.projectId,
    projectRevision: parentManifest.projectRevision,
    projectSettings: parentManifest.projectSettings,
    chatId: parent.chatId,
    acceptedSource,
    locale: parentManifest.locale,
    timeZone: parentManifest.timeZone,
    selectedContext: source.selectedContext,
    projectMedia: parentManifest.projectMedia,
    attachments: parentManifest.attachments,
    historyWatermark: parentManifest.historyWatermark,
    memory: parentManifest.memory,
    model: parentManifest.model,
    permissionMode: policy.permissionMode,
    budget: policy.budget,
    capabilityCatalogSnapshotId: catalogSnapshotId,
    capabilityCatalogHash: catalog.catalogHash,
    capabilityIndex: catalog.capabilityIndex,
    capabilityIndexDigest: catalog.capabilityIndexDigest,
    skillCatalogDigest: catalog.skillCatalogDigest,
    createdAt: acceptedAt,
  });
  const manifestHash = hashCanonical(manifest);
  const childWithoutHash = {
    authority: 'run' as const,
    id: childRunId,
    revision: 0,
    contentHash: '',
    rootRunId: parent.rootRunId,
    parentRunId: parent.id,
    retryOfRunId: null,
    retrySeedHash: null,
    projectId: parent.projectId,
    chatId: parent.chatId,
    acceptedSource,
    status: 'accepted' as const,
    model: parentManifest.model,
    permissionMode: policy.permissionMode,
    budget: policy.budget,
    contextManifestId: manifest.id,
    contextManifestHash: manifestHash,
    capabilityCatalogSnapshotId: catalogSnapshotId,
    capabilityCatalogHash: catalog.catalogHash,
    publicEventHead: null,
    privateRecoveryHead: null,
    acceptedAt,
    terminalOutcome: null,
    displayName: source.displayName,
    publicSummary: source.publicSummary,
  };
  const child = parseCanonical(RunSchema, {
    ...childWithoutHash,
    contentHash: hashContentObject(childWithoutHash),
  });
  const inbox = parseCanonical(RunInboxMessageSchema, {
    id: inboxMessageId,
    runId: child.id,
    sequence: 1,
    actor: 'commander',
    source: acceptedSource,
    selectedContext: source.selectedContext,
    exportDestinationGrant: null,
    contentHash: source.directionHash,
    state: 'queued',
    createdAt: acceptedAt,
  });
  try {
    assertRunContextManifest(child, manifest, catalog);
    assertCapabilityCatalogLineage(parentCatalog, catalog);
  } catch (cause) {
    throw new TargetStorageError('CORRUPT_DATA', 'Child delegation snapshot is inconsistent', {
      cause,
    });
  }
  insertAcceptedRunSnapshot(database, child, manifest, catalog);
  insertRunInboxMessage(database, inbox);
  const recovered = appendRecovery({
    envelopeId: recoveryEnvelopeId,
    child,
    inbox,
    createdAt: acceptedAt,
  });
  return {
    parent: delegatedParent,
    child: recovered.run,
    manifestHash,
    catalogHash: catalog.catalogHash,
  };
}

export function delegateChildRunInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  transactionInput: DelegateChildRunInTransactionInput,
  contextValue: TargetCommandContext,
): ChildDelegationCommit {
  if (!database.isTransaction) {
    throw invalid('Child delegation requires an active transaction');
  }
  const input = parseInput(transactionInput.delegation);
  const context = parseCanonical(TargetCommandContextSchema, contextValue);
  const directionHash = hashUtf8(input.spawnInput.objective);
  const fingerprint = operationFingerprint(input, context, directionHash);
  const parent = loadRun(database, input.parentRunId);
  const parentSnapshots = loadRunSnapshots(database, parent);
  const existing = loadPublicRunEventForCommand(database, parent.id, input.commandId);
  if (existing !== undefined) {
    const result = replayExisting(
      database,
      parent,
      parentSnapshots.manifest,
      parentSnapshots.catalog,
      input,
      existing,
      directionHash,
      fingerprint,
      privateRecoveryCodec,
    );
    return { result, parent, child: loadRun(database, result.child.childRunId) };
  }
  if (
    transactionInput.observedParent.id !== parent.id ||
    transactionInput.observedParent.revision !== input.expectedParentRevision ||
    transactionInput.currentParent.id !== parent.id ||
    transactionInput.currentParent.revision !== parent.revision ||
    transactionInput.currentParent.contentHash !== parent.contentHash ||
    canonicalJson(transactionInput.currentParent.publicEventHead) !==
      canonicalJson(parent.publicEventHead)
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      'Child delegation parent CAS baseline changed',
    );
  }
  const observed = parseCanonical(RunSchema, {
    ...parent,
    revision: transactionInput.observedParent.revision,
    contentHash: transactionInput.observedParent.contentHash,
    publicEventHead: transactionInput.observedParent.publicEventHead,
  });
  if (hashContentObject(observed) !== transactionInput.observedParent.contentHash) {
    throw new TargetStorageError('REVISION_CONFLICT', 'Child delegation observed parent changed');
  }
  if (RunTerminalStateSchema.safeParse(parent.status).success) {
    throw invalid(`Terminal parent Run ${parent.id} cannot delegate a child`);
  }
  assertAuthorizedContext(database, parent, parentSnapshots.manifest, input.spawnInput.contextRefs);
  const delegated = createDelegatedChildInTransaction(
    database,
    environment,
    parent,
    parentSnapshots.manifest,
    parentSnapshots.catalog,
    {
      commandId: input.commandId,
      displayName: input.spawnInput.displayName,
      publicSummary: input.spawnInput.publicSummary,
      selectedContext: input.spawnInput.contextRefs,
      toolAllowlist: input.spawnInput.toolAllowlist,
      permissionCeiling: input.spawnInput.permissionCeiling,
      budgetCaps: input.spawnInput.budgetCaps,
      directionHash,
      operationFingerprint: fingerprint,
    },
    context,
    ({ envelopeId, child, inbox, createdAt }) =>
      appendChildObjectiveRecovery(database, privateRecoveryCodec, {
        envelopeId,
        child,
        inbox,
        parentDispatchOperationId: transactionInput.parentDispatchOperationId,
        objective: input.spawnInput.objective,
        createdAt,
      }),
  );
  return {
    result: initialChildResult(delegated.child, delegated.manifestHash, delegated.catalogHash),
    parent: delegated.parent,
    child: delegated.child,
  };
}

export interface ToolProgramChildDelegationInput {
  readonly parentRunId: string;
  readonly expectedParentRevision: number;
  readonly commandId: string;
  readonly parentDispatchOperationId: string;
  readonly program: ToolProgramInput;
}

const ToolProgramChildDelegationInputSchema: z.ZodType<ToolProgramChildDelegationInput> =
  strictObject({
    parentRunId: EntityIdSchema,
    expectedParentRevision: RevisionSchema,
    commandId: EntityIdSchema,
    parentDispatchOperationId: EntityIdSchema,
    program: ToolProgramInputSchema,
  }).superRefine((input, context) => {
    if (input.program.expectedRunRevision !== input.expectedParentRevision) {
      context.addIssue({
        code: 'custom',
        path: ['program', 'expectedRunRevision'],
        message: 'Tool Program expected parent revision must match its delegation boundary',
      });
    }
  }) as unknown as z.ZodType<ToolProgramChildDelegationInput>;

export interface ToolProgramChildDelegationCommit {
  readonly parent: Run;
  readonly child: Run;
  readonly programHash: string;
}

function programSelectedContext(
  program: ToolProgramChildDelegationInput['program'],
  parentManifest: ContextManifest,
): readonly z.output<typeof SelectedContextRefSchema>[] {
  const requested = new Set(program.contextRefs.map((ref) => canonicalJson(ref)));
  const selected = parentManifest.selectedContext.filter((entry) =>
    requested.has(canonicalJson(entry.ref)),
  );
  const matched = new Set(selected.map((entry) => canonicalJson(entry.ref)));
  if (program.contextRefs.some((ref) => !matched.has(canonicalJson(ref)))) {
    throw invalid('Tool Program context must be a subset of parent selected context');
  }
  return selected;
}

function programDelegationFingerprint(
  input: ToolProgramChildDelegationInput,
  context: TargetCommandContext,
  programHash: string,
): string {
  return hashCanonical({
    operation: 'tool.program',
    parentRunId: input.parentRunId,
    expectedParentRevision: input.expectedParentRevision,
    displayName: input.program.displayName,
    programHash,
    contextRefs: input.program.contextRefs,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
  });
}

interface ToolProgramCallProjection {
  readonly stepId: string;
  readonly callIndex: number;
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly inputHash: string;
}

function toolProgramCallProjections(
  program: ToolProgramInput,
): readonly ToolProgramCallProjection[] {
  return program.steps.flatMap((step) => {
    if (step.operation === 'call') {
      return [
        {
          stepId: step.stepId,
          callIndex: 0,
          toolId: step.invocation.toolId,
          toolVersion: step.invocation.toolVersion,
          inputHash: hashCanonical(step.invocation.input),
        },
      ];
    }
    if (step.operation === 'map' || step.operation === 'batch') {
      return step.invocations.map((invocation, callIndex) => ({
        stepId: step.stepId,
        callIndex,
        toolId: invocation.toolId,
        toolVersion: invocation.toolVersion,
        inputHash: hashCanonical(invocation.input),
      }));
    }
    return [];
  });
}

function assertToolProgramDurableProjection(
  program: ToolProgramInput,
  programHash: string,
  durable: ReturnType<typeof durableToolProgramInput>,
): readonly ToolProgramCallProjection[] {
  const calls = toolProgramCallProjections(program);
  if (durable.programHash !== programHash || durable.calls.length !== calls.length) {
    throw invalid('Tool Program durable projection does not cover its complete program');
  }
  const durableByIdentity = new Map(
    durable.calls.map((call) => [`${call.stepId}/${call.callIndex}`, call]),
  );
  for (const call of calls) {
    const durableCall = durableByIdentity.get(`${call.stepId}/${call.callIndex}`);
    if (
      durableCall === undefined ||
      durableCall.toolId !== call.toolId ||
      durableCall.toolVersion !== call.toolVersion ||
      durableCall.inputHash !== call.inputHash
    ) {
      throw invalid('Tool Program durable projection does not match its call invocation');
    }
    durableByIdentity.delete(`${call.stepId}/${call.callIndex}`);
  }
  if (durableByIdentity.size !== 0) {
    throw invalid('Tool Program durable projection contains an unknown call invocation');
  }
  return calls;
}

function toolProgramAllowlist(calls: readonly ToolProgramCallProjection[]): readonly ToolId[] {
  return [...new Set(calls.map((call) => call.toolId))].sort();
}

/** Creates the private child Run used by a bounded Tool Program. */
export function delegateToolProgramChildRunInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  inputValue: ToolProgramChildDelegationInput,
  observedParent: ObservedParentRunRef,
  currentParent: ObservedParentRunRef,
  contextValue: TargetCommandContext,
): ToolProgramChildDelegationCommit {
  if (!database.isTransaction)
    throw invalid('Tool Program child delegation requires a transaction');
  let input: ToolProgramChildDelegationInput;
  try {
    input = parseCanonical(ToolProgramChildDelegationInputSchema, inputValue);
  } catch (cause) {
    throw invalid('Tool Program child delegation input is invalid', cause);
  }
  const context = parseCanonical(TargetCommandContextSchema, contextValue);
  const programHash = hashCanonical(input.program);
  const durable = durableToolProgramInput(input.program);
  const calls = assertToolProgramDurableProjection(input.program, programHash, durable);
  const toolAllowlist = toolProgramAllowlist(calls);
  const fingerprint = programDelegationFingerprint(input, context, programHash);
  const parent = loadRun(database, input.parentRunId);
  const parentSnapshots = loadRunSnapshots(database, parent);
  const selectedContext = programSelectedContext(input.program, parentSnapshots.manifest);
  const existing = loadPublicRunEventForCommand(database, parent.id, input.commandId);
  if (existing !== undefined) {
    const payload =
      existing.payloadState.state === 'available' ? existing.payloadState.payload : null;
    if (
      payload === null ||
      payload.type !== 'child_run_delegated' ||
      payload.displayName !== input.program.displayName ||
      payload.publicSummary !== 'Execute a bounded Tool Program.' ||
      payload.directionHash !== programHash ||
      payload.operationFingerprint !== fingerprint
    ) {
      throw conflict(`Tool Program delegation command ${input.commandId} changed semantics`);
    }
    const child = loadRun(database, payload.childRunId);
    const privateProgram = materializePrivateToolProgramContext(
      database,
      privateRecoveryCodec,
      child,
    );
    if (
      privateProgram.parentDispatchOperationId !== input.parentDispatchOperationId ||
      privateProgram.programHash !== programHash ||
      canonicalJson(privateProgram.program) !== canonicalJson(input.program)
    ) {
      throw conflict(
        `Tool Program delegation command ${input.commandId} changed private semantics`,
      );
    }
    assertDelegatedChildReplay(
      database,
      parent,
      parentSnapshots.manifest,
      parentSnapshots.catalog,
      child,
      existing,
      {
        displayName: input.program.displayName,
        publicSummary: 'Execute a bounded Tool Program.',
        selectedContext,
        toolAllowlist,
        permissionCeiling: null,
        budgetCaps: null,
        directionHash: programHash,
      },
    );
    return { parent, child, programHash };
  }
  if (
    observedParent.id !== parent.id ||
    observedParent.revision !== input.expectedParentRevision ||
    currentParent.id !== parent.id ||
    currentParent.revision !== parent.revision ||
    currentParent.contentHash !== parent.contentHash ||
    canonicalJson(currentParent.publicEventHead) !== canonicalJson(parent.publicEventHead)
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      'Tool Program child parent CAS baseline changed',
    );
  }
  const observed = parseCanonical(RunSchema, {
    ...parent,
    revision: observedParent.revision,
    contentHash: observedParent.contentHash,
    publicEventHead: observedParent.publicEventHead,
  });
  if (hashContentObject(observed) !== observedParent.contentHash) {
    throw new TargetStorageError('REVISION_CONFLICT', 'Tool Program observed parent changed');
  }
  if (RunTerminalStateSchema.safeParse(parent.status).success) {
    throw invalid(`Terminal parent Run ${parent.id} cannot delegate a Tool Program child`);
  }
  assertAuthorizedContext(database, parent, parentSnapshots.manifest, selectedContext);
  const delegated = createDelegatedChildInTransaction(
    database,
    environment,
    parent,
    parentSnapshots.manifest,
    parentSnapshots.catalog,
    {
      commandId: input.commandId,
      displayName: input.program.displayName,
      publicSummary: 'Execute a bounded Tool Program.',
      selectedContext,
      toolAllowlist,
      permissionCeiling: null,
      budgetCaps: null,
      directionHash: programHash,
      operationFingerprint: fingerprint,
    },
    context,
    ({ envelopeId, child, inbox, createdAt }) =>
      appendToolProgramRecovery(database, privateRecoveryCodec, {
        envelopeId,
        child,
        inbox,
        parentDispatchOperationId: input.parentDispatchOperationId,
        programHash,
        program: input.program,
        createdAt,
      }),
  );
  return { parent: delegated.parent, child: delegated.child, programHash };
}

export function delegateChildRun(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  inputValue: ChildDelegationInput,
  contextValue: TargetCommandContext,
): ChildDelegationResult {
  const input = parseInput(inputValue);
  return withImmediateTransaction(database, () => {
    const parent = loadRun(database, input.parentRunId);
    return delegateChildRunInTransaction(
      database,
      environment,
      privateRecoveryCodec,
      {
        delegation: input,
        observedParent: {
          id: parent.id,
          revision: parent.revision,
          contentHash: parent.contentHash,
          publicEventHead: parent.publicEventHead,
        },
        currentParent: {
          id: parent.id,
          revision: parent.revision,
          contentHash: parent.contentHash,
          publicEventHead: parent.publicEventHead,
        },
        parentDispatchOperationId: null,
      },
      contextValue,
    ).result;
  });
}
