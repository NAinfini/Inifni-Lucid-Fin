import {
  CapabilityCatalogSnapshotV1Schema,
  ContextManifestSchema,
  ContextMediaRefSchema,
  EntityIdSchema,
  ProviderModelSchema,
  RunInboxMessageSchema,
  RunSchema,
  WireSuccessV1Schema,
  assertRunContextManifest,
  canonicalJson,
  crashRetrySeedHashInput,
  parseCanonical,
  strictObject,
  z,
  type CapabilityCatalogSnapshotV1,
  type ContextManifest,
  type EventHead,
  type Chat,
  type Message,
  type Run,
  type RunInboxMessage,
  type WireRequestV1,
  type WireSuccessV1,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { getProject, getSettings } from '../authorities/projects.js';
import { TargetStorageError } from '../kernel/errors.js';
import {
  appendMessageInTransaction,
  loadChat,
  loadMessage,
  type AppendMessageInTransactionIdentity,
} from './conversation-write.js';
import {
  executeWireMutation,
  readWireMutationReceipt,
  type TargetCommandContext,
} from './command.js';
import { requireCurrentDomainObject } from './domain-object-resolver.js';
import type { TargetStorageEnvironment } from './environment.js';
import { hashCanonical, hashContentObject } from './hashes.js';
import { loadGlobalMediaAsset } from './media-records.js';
import { historyWatermark } from '../read-models/history.js';
import { loadHead } from '../read-models/memory.js';
import { insertRunInboxMessage } from './run-inbox.js';
import { insertAcceptedRunSnapshot } from './run-snapshot-write.js';
import { listRunInbox } from './run-inbox.js';
import { loadRunActivation } from './run-activation-records.js';
import { loadRunEvents } from './run-journal.js';
import { loadRun } from './run-records.js';
import { loadRunSnapshots } from './run-snapshots.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import { buildRootCapabilityCatalog } from './root-capability-catalog.js';

type MessageSendRequest = Extract<WireRequestV1, { method: 'message.send' }>;
type MessageSendSuccess = Extract<WireSuccessV1, { method: 'message.send' }>;
type ContextMediaRef = ContextManifest['projectMedia'][number];
type MemoryContext = ContextManifest['memory'];
type SelectedContextRef = ContextManifest['selectedContext'][number];
type AcceptedUserMessage = Extract<Message, { role: 'user' }>;

const ProjectMediaSelectionSchema = strictObject({
  projectMediaRefId: EntityIdSchema,
  role: z.enum(['reference', 'input']),
});
const ProjectMediaSelectionsSchema = z
  .array(ProjectMediaSelectionSchema)
  .max(1_000)
  .superRefine((selections, context) => {
    const keys = selections.map(
      ({ projectMediaRefId, role }) => `${projectMediaRefId}\u0000${role}`,
    );
    if (keys.some((key, index) => index > 0 && keys[index - 1]! >= key)) {
      context.addIssue({
        code: 'custom',
        message: 'Project Media selections must be unique and sorted by ID and role',
      });
    }
  });
const CitedMemoryEntryIdsSchema = z
  .array(EntityIdSchema)
  .max(1_000)
  .superRefine((ids, context) => {
    if (ids.some((id, index) => index > 0 && ids[index - 1]! >= id)) {
      context.addIssue({
        code: 'custom',
        message: 'Cited Memory entry IDs must be unique and sorted',
      });
    }
  });

export const MessageSendAcceptanceSeedSchema = strictObject({
  model: ProviderModelSchema,
  locale: z
    .string()
    .min(2)
    .max(35)
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/),
  timeZone: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9._+-]+(?:\/[A-Za-z0-9._+-]+)*$/),
  capabilityCatalog: CapabilityCatalogSnapshotV1Schema,
  projectMediaSelections: ProjectMediaSelectionsSchema,
  citedMemoryEntryIds: CitedMemoryEntryIdsSchema,
});

export type MessageSendAcceptanceSeed = z.output<typeof MessageSendAcceptanceSeedSchema>;

export const PROCESS_INTERRUPTION_SUMMARY =
  'Recovery required after process interruption. Uncommitted provider or tool work was not replayed.';

export interface CrashRetryAcceptanceInput {
  readonly sourceRunId: string;
  readonly expectedSourceRevision: number;
  readonly expectedSourceContentHash: string;
  readonly expectedSourceEventHead: EventHead;
  readonly commandId: string;
}

export interface CrashRetryAcceptanceResult {
  readonly created: boolean;
  readonly sourceRun: Run;
  readonly retryRun: Run;
  readonly manifest: ContextManifest;
  readonly catalog: CapabilityCatalogSnapshotV1;
  readonly inbox: RunInboxMessage;
}

interface AcceptanceIds {
  readonly runId: string;
  readonly contextManifestId: string;
  readonly capabilityCatalogSnapshotId: string;
  readonly inboxMessageId: string;
  readonly messageIdentity: AppendMessageInTransactionIdentity;
}

export interface RootRunAcceptanceInput {
  readonly chatId: string;
  readonly blocks: Message['blocks'];
  readonly attachments: Message['attachments'];
  readonly selectedContext: ContextManifest['selectedContext'];
  readonly exportDestinationGrant: RunInboxMessage['exportDestinationGrant'];
  readonly supersedesMessageId: string | null;
  readonly idempotencyKey: string;
}

export interface RootRunAcceptanceResult {
  readonly projectId: string;
  readonly message: AcceptedUserMessage;
  readonly chat: Chat;
  readonly run: Run;
  readonly inbox: RunInboxMessage;
}

interface ProviderProfileRow {
  id: string;
  model: string;
  reasoning_strength: string | null;
  status: 'ready' | 'unavailable' | 'disabled';
}

function invalid(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'INVALID_REQUEST',
    message,
    cause === undefined ? undefined : { cause },
  );
}

export function parseMessageSendAcceptanceSeed(
  input: MessageSendAcceptanceSeed,
): MessageSendAcceptanceSeed {
  try {
    return parseCanonical(MessageSendAcceptanceSeedSchema, input);
  } catch (cause) {
    throw invalid('Message acceptance seed is invalid', cause);
  }
}

function success(
  request: MessageSendRequest,
  message: MessageSendSuccess['result']['message'],
  chat: MessageSendSuccess['result']['chat'],
  run: Run,
): MessageSendSuccess {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result: { message, chat, acceptedRun: run },
  }) as MessageSendSuccess;
}

function validateProvider(database: DatabaseSync, seed: MessageSendAcceptanceSeed): void {
  const profile = database
    .prepare(
      `SELECT id, model, reasoning_strength, status
       FROM provider_profiles
       WHERE id = ?`,
    )
    .get(seed.model.providerId) as unknown as ProviderProfileRow | undefined;
  if (profile === undefined) {
    throw new TargetStorageError(
      'NOT_FOUND',
      `Provider profile was not found: ${seed.model.providerId}`,
    );
  }
  if (profile.status !== 'ready') {
    throw invalid(`Provider profile ${profile.id} is not ready`);
  }
  if (
    profile.model !== seed.model.model ||
    profile.reasoning_strength !== seed.model.reasoningStrength
  ) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Provider profile ${profile.id} no longer matches the selected model`,
    );
  }
}

export function findActiveRootRun(database: DatabaseSync, chatId: string): Run | null {
  const active = database
    .prepare(
      `SELECT id
       FROM runs
       WHERE chat_id = ? AND parent_run_id IS NULL
         AND status NOT IN ('completed', 'blocked', 'failed', 'cancelled')
       ORDER BY accepted_at, id
       LIMIT 2`,
    )
    .all(chatId) as unknown as { id: string }[];
  if (active.length > 1) {
    throw new TargetStorageError('CORRUPT_DATA', `Chat ${chatId} has multiple active root Runs`);
  }
  return active[0] === undefined ? null : loadRun(database, active[0].id);
}

function assertNoActiveRootRun(database: DatabaseSync, chatId: string): void {
  const active = findActiveRootRun(database, chatId);
  if (active !== null) throw invalid(`Chat ${chatId} already has an active root Run: ${active.id}`);
}

export function assertSelectedContext(
  database: DatabaseSync,
  projectId: string,
  selectedContext: readonly SelectedContextRef[],
): void {
  for (const selected of selectedContext) {
    requireCurrentDomainObject(database, projectId, selected.ref);
    if (selected.ref.authority === 'project_media_ref') {
      const row = database
        .prepare('SELECT lifecycle FROM project_media_refs WHERE id = ?')
        .get(selected.ref.id) as unknown as { lifecycle: 'active' | 'detached' };
      if (row.lifecycle !== 'active') {
        throw invalid(`Selected Project Media reference ${selected.ref.id} is detached`);
      }
    }
  }
}

function resolveProjectMedia(
  database: DatabaseSync,
  projectId: string,
  selections: readonly Pick<ContextMediaRef, 'projectMediaRefId' | 'role'>[],
): ContextMediaRef[] {
  return selections.map((selection) => {
    const row = database
      .prepare(
        `SELECT project_id, global_asset_id, lifecycle
         FROM project_media_refs
         WHERE id = ?`,
      )
      .get(selection.projectMediaRefId) as unknown as
      { project_id: string; global_asset_id: string; lifecycle: 'active' | 'detached' } | undefined;
    if (row === undefined) {
      throw new TargetStorageError(
        'NOT_FOUND',
        `Project Media reference was not found: ${selection.projectMediaRefId}`,
      );
    }
    if (row.project_id !== projectId) {
      throw invalid(
        `Project Media reference ${selection.projectMediaRefId} belongs to another Project`,
      );
    }
    if (row.lifecycle !== 'active') {
      throw invalid(`Project Media reference ${selection.projectMediaRefId} is detached`);
    }
    const asset = loadGlobalMediaAsset(database, row.global_asset_id);
    return parseCanonical(ContextMediaRefSchema, {
      projectMediaRefId: selection.projectMediaRefId,
      globalAssetId: asset.id,
      blobHash: asset.blobHash,
      role: selection.role,
    });
  });
}

function captureMemoryContext(
  database: DatabaseSync,
  projectId: string,
  baseHistoryWatermark: number,
  citedEntryIds: readonly string[],
): MemoryContext {
  const head = loadHead(database, projectId);
  if (head === null) {
    if (citedEntryIds.length > 0) {
      throw invalid('Unavailable Project Memory cannot supply cited entries');
    }
    const failed = database
      .prepare(
        `SELECT 1 FROM project_memory_versions
         WHERE project_id = ? AND completeness = 'failed'
         LIMIT 1`,
      )
      .get(projectId);
    return { state: 'unavailable', reason: failed === undefined ? 'not_built' : 'failed' };
  }
  if (head.activeHistoryWatermark !== baseHistoryWatermark) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      'Memory and History watermarks were not captured together',
    );
  }
  if (head.state === 'stale') {
    if (citedEntryIds.length > 0) {
      throw invalid('Stale Project Memory cannot supply cited entries');
    }
    return {
      state: 'stale',
      derivationVersion: head.index.derivationVersion,
      watermark: head.index.historyWatermark,
      activeHistoryWatermark: head.activeHistoryWatermark,
      sourceSetHash: head.index.sourceSetHash,
    };
  }
  const availableIds = new Set(head.index.entries.map(({ id }) => id));
  const missing = citedEntryIds.find((id) => !availableIds.has(id));
  if (missing !== undefined) {
    throw new TargetStorageError('NOT_FOUND', `Project Memory entry was not found: ${missing}`);
  }
  return {
    state: 'ready',
    derivationVersion: head.index.derivationVersion,
    watermark: head.index.historyWatermark,
    citedEntryIds: [...citedEntryIds],
    sourceSetHash: head.index.sourceSetHash,
  };
}

function createAcceptanceIds(
  environment: TargetStorageEnvironment,
  acceptedAt: string,
): AcceptanceIds {
  return {
    runId: environment.createId('run'),
    contextManifestId: environment.createId('context_manifest'),
    capabilityCatalogSnapshotId: environment.createId('capability_catalog_snapshot'),
    inboxMessageId: environment.createId('run_inbox_message'),
    messageIdentity: {
      messageId: environment.createId('message'),
      eventId: environment.createId('project_event'),
      searchDocumentId: environment.createId('project_search_document'),
      createdAt: acceptedAt,
    },
  };
}

function acceptRootRunInTransactionCore(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: RootRunAcceptanceInput,
  context: TargetCommandContext,
  seed: MessageSendAcceptanceSeed,
  ids: AcceptanceIds,
  acceptedAt: string,
): RootRunAcceptanceResult {
  if (!database.isTransaction) {
    throw new TargetStorageError(
      'INVALID_REQUEST',
      'Root Run acceptance requires an active transaction',
    );
  }
  const chat = loadChat(database, input.chatId);
  if (chat.lifecycle !== 'active') throw invalid(`Chat ${chat.id} is not active`);
  const project = getProject(database, chat.projectId);
  if (project.lifecycle !== 'active') throw invalid(`Project ${project.id} is not active`);
  const settings = getSettings(database, project.id);
  validateProvider(database, seed);
  const capabilityCatalog = buildRootCapabilityCatalog(database, {
    projectId: project.id,
    baseCatalog: seed.capabilityCatalog,
  });
  assertNoActiveRootRun(database, chat.id);
  assertSelectedContext(database, project.id, input.selectedContext);
  const projectMedia = resolveProjectMedia(database, project.id, seed.projectMediaSelections);
  const baseHistoryWatermark = historyWatermark(database, project.id);
  const memory = captureMemoryContext(
    database,
    project.id,
    baseHistoryWatermark,
    seed.citedMemoryEntryIds,
  );

  const { message } = appendMessageInTransaction(
    database,
    environment,
    context,
    {
      chatId: chat.id,
      role: 'user',
      status: 'accepted',
      originatingRunId: null,
      blocks: input.blocks,
      attachments: input.attachments,
      supersedesMessageId: input.supersedesMessageId,
      idempotencyKey: input.idempotencyKey,
    },
    ids.messageIdentity,
  );
  if (message.role !== 'user') {
    throw new TargetStorageError('CORRUPT_DATA', 'Root acceptance appended a non-user Message');
  }
  const updatedChat = loadChat(database, chat.id);
  const acceptedSource = {
    kind: 'message' as const,
    messageId: message.id,
    contentHash: message.contentHash,
  };
  const manifest = parseCanonical(ContextManifestSchema, {
    authority: 'context_manifest',
    id: ids.contextManifestId,
    runId: ids.runId,
    retryOfRunId: null,
    retrySeedHash: null,
    projectId: project.id,
    projectRevision: project.revision,
    projectSettings: settings,
    chatId: chat.id,
    acceptedSource,
    locale: seed.locale,
    timeZone: seed.timeZone,
    selectedContext: input.selectedContext,
    projectMedia,
    attachments: input.attachments,
    historyWatermark: baseHistoryWatermark,
    memory,
    model: seed.model,
    permissionMode: settings.permission,
    budget: settings.budget,
    capabilityCatalogSnapshotId: ids.capabilityCatalogSnapshotId,
    capabilityCatalogHash: capabilityCatalog.catalogHash,
    capabilityIndex: capabilityCatalog.capabilityIndex,
    capabilityIndexDigest: capabilityCatalog.capabilityIndexDigest,
    skillCatalogDigest: capabilityCatalog.skillCatalogDigest,
    createdAt: acceptedAt,
  });
  const manifestHash = hashCanonical(manifest);
  const runWithoutHash = {
    authority: 'run' as const,
    id: ids.runId,
    revision: 0,
    contentHash: '',
    rootRunId: ids.runId,
    parentRunId: null,
    retryOfRunId: null,
    retrySeedHash: null,
    projectId: project.id,
    chatId: chat.id,
    acceptedSource,
    status: 'accepted' as const,
    model: seed.model,
    permissionMode: settings.permission,
    budget: settings.budget,
    contextManifestId: manifest.id,
    contextManifestHash: manifestHash,
    capabilityCatalogSnapshotId: ids.capabilityCatalogSnapshotId,
    capabilityCatalogHash: capabilityCatalog.catalogHash,
    publicEventHead: null,
    privateRecoveryHead: null,
    acceptedAt,
    terminalOutcome: null,
  };
  const run = parseCanonical(RunSchema, {
    ...runWithoutHash,
    contentHash: hashContentObject(runWithoutHash),
  });
  const inbox = parseCanonical(RunInboxMessageSchema, {
    id: ids.inboxMessageId,
    runId: run.id,
    sequence: 1,
    actor: 'user',
    source: acceptedSource,
    selectedContext: input.selectedContext,
    exportDestinationGrant: input.exportDestinationGrant,
    contentHash: message.contentHash,
    state: 'queued',
    createdAt: acceptedAt,
  });
  try {
    assertRunContextManifest(run, manifest, capabilityCatalog);
  } catch (cause) {
    throw new TargetStorageError('CORRUPT_DATA', 'Run acceptance snapshot is inconsistent', {
      cause,
    });
  }

  insertAcceptedRunSnapshot(database, run, manifest, capabilityCatalog);
  insertRunInboxMessage(database, inbox);
  return { projectId: project.id, message, chat: updatedChat, run, inbox };
}

export function acceptRootRunInTransaction(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: RootRunAcceptanceInput,
  context: TargetCommandContext,
  seedInput: MessageSendAcceptanceSeed,
  acceptedAt: string,
): RootRunAcceptanceResult {
  const seed = parseMessageSendAcceptanceSeed(seedInput);
  return acceptRootRunInTransactionCore(
    database,
    environment,
    input,
    context,
    seed,
    createAcceptanceIds(environment, acceptedAt),
    acceptedAt,
  );
}

function executeAcceptance(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: MessageSendRequest,
  context: TargetCommandContext,
  seedInput: MessageSendAcceptanceSeed,
  acceptedAt: string,
): MessageSendSuccess {
  return executeWireMutation(
    database,
    request,
    context,
    acceptedAt,
    () => {
      const accepted = acceptRootRunInTransaction(
        database,
        environment,
        {
          chatId: request.input.chatId,
          blocks: request.input.blocks,
          attachments: request.input.attachments,
          selectedContext: request.input.selectedContext,
          exportDestinationGrant: request.input.exportDestinationGrant,
          supersedesMessageId: request.input.supersedesMessageId,
          idempotencyKey: request.requestId,
        },
        context,
        seedInput,
        acceptedAt,
      );
      return {
        projectId: accepted.projectId,
        response: success(request, accepted.message, accepted.chat, accepted.run),
      };
    },
    seedInput,
  );
}

export function acceptRootRunForMessage(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  request: MessageSendRequest,
  context: TargetCommandContext,
  seedInput: MessageSendAcceptanceSeed,
): MessageSendSuccess {
  const receipt = readWireMutationReceipt<MessageSendRequest, MessageSendSuccess>(
    database,
    request,
    context,
    seedInput,
  );
  if (receipt !== undefined) return receipt;

  const acceptedAt = environment.now();
  return executeAcceptance(database, environment, request, context, seedInput, acceptedAt);
}

function availablePublicPayload(event: ReturnType<typeof loadRunEvents>[number]) {
  if (event.visibility !== 'public' || event.payloadState.state !== 'available') {
    throw new TargetStorageError('CORRUPT_DATA', 'Recovery source journal tail is unavailable');
  }
  return event.payloadState.payload;
}

function assertExpectedRecoverySource(
  database: DatabaseSync,
  source: Run,
  input: CrashRetryAcceptanceInput,
): void {
  if (
    source.revision !== input.expectedSourceRevision ||
    source.contentHash !== input.expectedSourceContentHash ||
    canonicalJson(source.publicEventHead) !== canonicalJson(input.expectedSourceEventHead)
  ) {
    throw new TargetStorageError('REVISION_CONFLICT', `Recovery source Run ${source.id} changed`);
  }
  if (
    source.parentRunId !== null ||
    source.status !== 'blocked' ||
    source.acceptedSource.kind !== 'message' ||
    source.terminalOutcome?.status !== 'blocked' ||
    source.terminalOutcome.summary !== PROCESS_INTERRUPTION_SUMMARY
  ) {
    throw invalid(`Run ${source.id} is not an exact blocked recovery root`);
  }
  const journal = loadRunEvents(database, source.id);
  const publicEvents = journal.filter((event) => event.visibility === 'public');
  const terminal = publicEvents.at(-1);
  const stateChanged = publicEvents.at(-2);
  const activationChanged = publicEvents.at(-3);
  if (
    terminal === undefined ||
    stateChanged === undefined ||
    activationChanged === undefined ||
    journal.at(-1)?.eventId !== terminal.eventId ||
    terminal.eventId !== source.terminalOutcome.terminalEventId ||
    terminal.sequence !== input.expectedSourceEventHead.sequence ||
    terminal.eventHash !== input.expectedSourceEventHead.hash ||
    terminal.occurredAt !== source.terminalOutcome.finishedAt ||
    stateChanged.occurredAt !== source.terminalOutcome.finishedAt ||
    activationChanged.occurredAt !== source.terminalOutcome.finishedAt
  ) {
    throw new TargetStorageError('CORRUPT_DATA', `Recovery source Run ${source.id} head differs`);
  }
  const terminalPayload = availablePublicPayload(terminal);
  const statePayload = availablePublicPayload(stateChanged);
  const activationPayload = availablePublicPayload(activationChanged);
  if (
    terminalPayload.type !== 'terminal_summary' ||
    terminalPayload.status !== 'blocked' ||
    terminalPayload.summary !== PROCESS_INTERRUPTION_SUMMARY ||
    terminalPayload.resultIds.length !== 0 ||
    statePayload.type !== 'run_state_changed' ||
    (statePayload.previousState !== 'running' && statePayload.previousState !== 'recovering') ||
    statePayload.state !== 'blocked' ||
    statePayload.runRevision !== source.revision ||
    activationPayload.type !== 'activation_changed' ||
    activationPayload.state !== 'ended' ||
    activationPayload.endReason !== 'process_exit'
  ) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Recovery source Run ${source.id} tail is invalid`,
    );
  }
  let cursor = publicEvents.length - 4;
  const possibleTask = publicEvents[cursor];
  if (
    possibleTask !== undefined &&
    availablePublicPayload(possibleTask).type === 'task_list_changed'
  ) {
    cursor -= 1;
  }
  const turn = publicEvents[cursor];
  const blocker = publicEvents[cursor - 1];
  const turnPayload = turn === undefined ? null : availablePublicPayload(turn);
  const blockerPayload = blocker === undefined ? null : availablePublicPayload(blocker);
  if (
    turnPayload?.type !== 'turn_ended' ||
    turnPayload.outcome !== 'interrupted' ||
    blockerPayload?.type !== 'blocker' ||
    blockerPayload.code !== 'recovery_required' ||
    blockerPayload.message !== PROCESS_INTERRUPTION_SUMMARY
  ) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Recovery source Run ${source.id} recovery boundary is invalid`,
    );
  }
  const activation = loadRunActivation(
    database,
    source.id,
    activationPayload.activationNumber,
  )?.activation;
  if (
    activation === undefined ||
    activation.state !== 'ended' ||
    activation.endReason !== 'process_exit' ||
    activation.eventEndSequence !== activationChanged.sequence ||
    activation.endedAt !== source.terminalOutcome.finishedAt
  ) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Recovery source Run ${source.id} Activation is invalid`,
    );
  }
}

function replayCrashRetry(
  database: DatabaseSync,
  source: Run,
  sourceSnapshots: ReturnType<typeof loadRunSnapshots>,
  sourceInbox: RunInboxMessage,
  objective: ReturnType<typeof loadMessage>,
  retrySeedHash: string,
): CrashRetryAcceptanceResult | null {
  if (source.acceptedSource.kind !== 'message') {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${source.id} retry source is not a Message`);
  }
  const rows = database
    .prepare('SELECT id FROM runs WHERE retry_of_run_id = ?')
    .all(source.id) as unknown as { id: string }[];
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TargetStorageError('CORRUPT_DATA', `Run ${source.id} has duplicate crash retries`);
  }
  const retryRun = loadRun(database, rows[0]!.id);
  const { manifest, catalog } = loadRunSnapshots(database, retryRun);
  const inbox = listRunInbox(database, retryRun.id)[0];
  if (
    retryRun.parentRunId !== null ||
    retryRun.retryOfRunId !== source.id ||
    retryRun.retrySeedHash !== retrySeedHash ||
    retryRun.projectId !== source.projectId ||
    retryRun.chatId !== source.chatId ||
    canonicalJson(retryRun.acceptedSource) !== canonicalJson(source.acceptedSource) ||
    canonicalJson(manifest.locale) !== canonicalJson(sourceSnapshots.manifest.locale) ||
    canonicalJson(manifest.timeZone) !== canonicalJson(sourceSnapshots.manifest.timeZone) ||
    canonicalJson(manifest.selectedContext) !==
      canonicalJson(sourceSnapshots.manifest.selectedContext) ||
    canonicalJson(manifest.projectMedia) !== canonicalJson(sourceSnapshots.manifest.projectMedia) ||
    canonicalJson(manifest.attachments) !== canonicalJson(sourceSnapshots.manifest.attachments) ||
    canonicalJson(manifest.model) !== canonicalJson(sourceSnapshots.manifest.model) ||
    canonicalJson(catalog) !== canonicalJson(sourceSnapshots.catalog) ||
    manifest.retryOfRunId !== source.id ||
    manifest.retrySeedHash !== retrySeedHash ||
    manifest.createdAt !== retryRun.acceptedAt ||
    inbox === undefined ||
    inbox.sequence !== 1 ||
    inbox.actor !== 'user' ||
    canonicalJson(inbox.source) !== canonicalJson(source.acceptedSource) ||
    canonicalJson(inbox.selectedContext) !== canonicalJson(manifest.selectedContext) ||
    canonicalJson(inbox.exportDestinationGrant) !==
      canonicalJson(sourceInbox.exportDestinationGrant) ||
    inbox.contentHash !== source.acceptedSource.contentHash ||
    inbox.createdAt !== retryRun.acceptedAt ||
    objective.role !== 'user' ||
    objective.projectId !== source.projectId ||
    objective.chatId !== source.chatId ||
    objective.id !== source.acceptedSource.messageId ||
    objective.contentHash !== source.acceptedSource.contentHash ||
    canonicalJson(objective.attachments) !== canonicalJson(sourceSnapshots.manifest.attachments)
  ) {
    throw new TargetStorageError(
      'CORRUPT_DATA',
      `Run ${source.id} crash retry does not match its source`,
    );
  }
  return { created: false, sourceRun: source, retryRun, manifest, catalog, inbox };
}

export function acceptCrashRetryRootRun(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: CrashRetryAcceptanceInput,
): CrashRetryAcceptanceResult {
  return withImmediateTransaction(database, () => {
    const source = loadRun(database, input.sourceRunId);
    assertExpectedRecoverySource(database, source, input);
    if (source.acceptedSource.kind !== 'message') {
      throw new TargetStorageError('CORRUPT_DATA', `Run ${source.id} source is not a Message`);
    }
    const acceptedSource = source.acceptedSource;
    const retrySeedHash = hashCanonical(
      crashRetrySeedHashInput({
        sourceRunId: source.id,
        sourceRunContentHash: source.contentHash,
      }),
    );
    const sourceSnapshots = loadRunSnapshots(database, source);
    const sourceInbox = listRunInbox(database, source.id)[0];
    if (
      sourceInbox === undefined ||
      sourceInbox.sequence !== 1 ||
      sourceInbox.actor !== 'user' ||
      canonicalJson(sourceInbox.source) !== canonicalJson(acceptedSource)
    ) {
      throw new TargetStorageError('CORRUPT_DATA', `Run ${source.id} source Inbox is invalid`);
    }
    const message = loadMessage(database, acceptedSource.messageId);
    const replay = replayCrashRetry(
      database,
      source,
      sourceSnapshots,
      sourceInbox,
      message,
      retrySeedHash,
    );
    if (replay !== null) return replay;

    const chat = loadChat(database, source.chatId);
    const project = getProject(database, source.projectId);
    const settings = getSettings(database, source.projectId);
    if (chat.lifecycle !== 'active' || project.lifecycle !== 'active') {
      throw invalid('Crash retry requires an active Chat and Project');
    }
    if (
      chat.projectId !== project.id ||
      message.role !== 'user' ||
      message.projectId !== project.id ||
      message.chatId !== chat.id ||
      message.contentHash !== acceptedSource.contentHash ||
      canonicalJson(message.attachments) !== canonicalJson(sourceSnapshots.manifest.attachments)
    ) {
      throw new TargetStorageError('CORRUPT_DATA', `Run ${source.id} objective Message changed`);
    }
    validateProvider(database, {
      ...sourceSnapshots.manifest,
      capabilityCatalog: sourceSnapshots.catalog,
      projectMediaSelections: [],
      citedMemoryEntryIds: [],
    });
    assertNoActiveRootRun(database, chat.id);
    assertSelectedContext(database, project.id, sourceSnapshots.manifest.selectedContext);
    let projectMedia: ContextManifest['projectMedia'];
    try {
      projectMedia = resolveProjectMedia(
        database,
        project.id,
        sourceSnapshots.manifest.projectMedia,
      );
    } catch (cause) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        'Crash retry media references are no longer current',
        { cause },
      );
    }
    if (canonicalJson(projectMedia) !== canonicalJson(sourceSnapshots.manifest.projectMedia)) {
      throw new TargetStorageError(
        'REVISION_CONFLICT',
        'Crash retry media references are no longer current',
      );
    }
    const baseHistoryWatermark = historyWatermark(database, project.id);
    const citedEntryIds =
      sourceSnapshots.manifest.memory.state === 'ready'
        ? sourceSnapshots.manifest.memory.citedEntryIds
        : [];
    const memory = captureMemoryContext(database, project.id, baseHistoryWatermark, citedEntryIds);
    const acceptedAt = environment.now();
    const runId = environment.createId('run');
    const manifestId = environment.createId('context_manifest');
    const catalogSnapshotId = environment.createId('capability_catalog_snapshot');
    const inboxId = environment.createId('run_inbox_message');
    const manifest = parseCanonical(ContextManifestSchema, {
      ...sourceSnapshots.manifest,
      id: manifestId,
      runId,
      retryOfRunId: source.id,
      retrySeedHash,
      projectRevision: project.revision,
      projectSettings: settings,
      historyWatermark: baseHistoryWatermark,
      memory,
      permissionMode: settings.permission,
      budget: settings.budget,
      capabilityCatalogSnapshotId: catalogSnapshotId,
      createdAt: acceptedAt,
    });
    const manifestHash = hashCanonical(manifest);
    const runWithoutHash = {
      authority: 'run' as const,
      id: runId,
      revision: 0,
      contentHash: '',
      rootRunId: runId,
      parentRunId: null,
      retryOfRunId: source.id,
      retrySeedHash,
      projectId: project.id,
      chatId: chat.id,
      acceptedSource,
      status: 'accepted' as const,
      model: sourceSnapshots.manifest.model,
      permissionMode: settings.permission,
      budget: settings.budget,
      contextManifestId: manifest.id,
      contextManifestHash: manifestHash,
      capabilityCatalogSnapshotId: catalogSnapshotId,
      capabilityCatalogHash: sourceSnapshots.catalog.catalogHash,
      publicEventHead: null,
      privateRecoveryHead: null,
      acceptedAt,
      terminalOutcome: null,
    };
    const retryRun = parseCanonical(RunSchema, {
      ...runWithoutHash,
      contentHash: hashContentObject(runWithoutHash),
    });
    const inbox = parseCanonical(RunInboxMessageSchema, {
      id: inboxId,
      runId,
      sequence: 1,
      actor: 'user',
      source: acceptedSource,
      selectedContext: manifest.selectedContext,
      exportDestinationGrant: sourceInbox.exportDestinationGrant,
      contentHash: acceptedSource.contentHash,
      state: 'queued',
      createdAt: acceptedAt,
    });
    insertAcceptedRunSnapshot(database, retryRun, manifest, sourceSnapshots.catalog);
    insertRunInboxMessage(database, inbox);
    return {
      created: true,
      sourceRun: source,
      retryRun,
      manifest,
      catalog: sourceSnapshots.catalog,
      inbox,
    };
  });
}
