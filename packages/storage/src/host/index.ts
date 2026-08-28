import {
  CapabilityCatalogSnapshotV1Schema,
  ConfirmationTargetSchema,
  DeliveryExportDefinition,
  EntityIdSchema,
  InteractionAskDefinition,
  IsoTimestampSchema,
  RunInboxMessageSchema,
  SkillProposeDefinition,
  WireSuccessV1Schema,
  assertRunStateTransition,
  canonicalJson,
  parseCanonical,
  parseRequestV1,
  strictObject,
  type CapabilityCatalogSnapshotV1,
  type WireRequestV1,
  type WireSuccessV1,
  z,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  getProject,
  getSettings,
  updateProjectSettingsInTransaction,
} from '../authorities/projects.js';
import {
  completePendingDeliveryExportConfirmationInTransaction,
  completePendingProtectedMutationStepInTransaction,
} from '../authorities/harness-runtime.js';
import { appendMessageInTransaction } from '../internal/conversation-write.js';
import {
  executeWireMutation,
  CommandContextSchema,
  type CommandContext,
} from '../internal/command.js';
import { getStoreDatabase } from '../internal/database-access.js';
import {
  resolveStorageEnvironment,
  type StorageEnvironmentOptions,
} from '../internal/environment.js';
import { hashCanonical, hashUtf8 } from '../internal/hashes.js';
import {
  bindRuntimeDispatchProjectEvent,
  loadOperationDispatch,
  settleRuntimeDispatch,
  transitionRuntimeDispatchGuard,
} from '../internal/operation-dispatch.js';
import {
  assertProtectedMutationPendingBinding,
  assertProtectedMutationPlanMatchesTarget,
  commitPlannedProtectedMutationInTransaction,
  planProtectedMutationInTransaction,
  protectedMutationConfirmationEffectFor,
  protectedMutationDeniedOutcome,
  protectedMutationOutcome,
  protectedMutationProjectEventId,
  type PlannedProtectedMutation,
} from '../internal/protected-mutations.js';
import { appendProjectEvent } from '../internal/project-events.js';
import { insertRunInboxMessage, nextRunInboxSequence } from '../internal/run-inbox.js';
import { appendRunEventBatch, type AppendRunEventBatchInput } from '../internal/run-journal.js';
import { advanceRunJournalHead, loadRun } from '../internal/run-records.js';
import {
  SkillRegistrationBatchInputSchema,
  SkillRegistrationInputSchema,
  registerGlobalSkillInTransaction,
  writeSkillRegistrationInTransaction,
  type SkillRegistrationBatchInput,
  type SkillRegistrationBatchResult,
  type SkillRegistrationInput,
  type SkillRegistrationResult,
} from '../internal/skill-registration.js';
import { StorageError } from '../kernel/errors.js';
import { loadCanonicalBuiltInSkillPack } from '../kernel/artifacts.js';
import type { Store } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import { buildRootCapabilityCatalog as buildRootCapabilityCatalogFromDatabase } from '../internal/root-capability-catalog.js';

export type {
  SkillRegistrationBatchInput,
  SkillRegistrationBatchResult,
  SkillRegistrationInput,
  SkillRegistrationResult,
} from '../internal/skill-registration.js';

const ProviderProfileProvisioningSeedSchema = strictObject({
  id: EntityIdSchema,
  displayName: z.string().trim().min(1).max(240),
  providerKind: z.string().trim().min(1).max(80),
  model: z.string().trim().min(1).max(200),
  status: z.enum(['ready', 'unavailable', 'disabled']),
});

export type ProviderProfileProvisioningSeed = z.output<
  typeof ProviderProfileProvisioningSeedSchema
>;

interface ProviderProfileRow {
  id: string;
  display_name: string;
  provider_kind: string;
  model: string;
  reasoning_strength: string | null;
  endpoint_origin: string | null;
  credential_handle: string | null;
  status: ProviderProfileProvisioningSeed['status'];
  configuration_v1_json: string;
  revision: number;
}

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function conflict(message: string): StorageError {
  return new StorageError('IDEMPOTENCY_CONFLICT', message);
}

function providerFromRow(row: ProviderProfileRow): ProviderProfileProvisioningSeed {
  if (
    row.reasoning_strength !== null ||
    row.endpoint_origin !== null ||
    row.credential_handle !== null ||
    row.configuration_v1_json !== '{}' ||
    row.revision !== 0
  ) {
    throw corrupt(`Host Provider Profile ${row.id} contains non-provisioning configuration`);
  }
  try {
    return parseCanonical(ProviderProfileProvisioningSeedSchema, {
      id: row.id,
      displayName: row.display_name,
      providerKind: row.provider_kind,
      model: row.model,
      status: row.status,
    });
  } catch (cause) {
    throw corrupt(`Host Provider Profile ${row.id} is invalid`, cause);
  }
}

export interface HostCatalogProvisioning {
  registerProviderProfile(seed: ProviderProfileProvisioningSeed): ProviderProfileProvisioningSeed;
  registerSkill(input: SkillRegistrationInput): SkillRegistrationResult;
  registerSkillBatch(input: SkillRegistrationBatchInput): SkillRegistrationBatchResult;
  buildRootCapabilityCatalog(input: {
    readonly projectId: string;
    readonly baseCatalog: CapabilityCatalogSnapshotV1;
  }): CapabilityCatalogSnapshotV1;
}

export interface HostCatalogProvisioningOptions {
  readonly now?: () => string;
}

export function createHostCatalogProvisioning(
  store: Store,
  options: HostCatalogProvisioningOptions = {},
): HostCatalogProvisioning {
  const now = options.now ?? (() => new Date().toISOString());
  return Object.freeze({
    registerProviderProfile(seedValue: ProviderProfileProvisioningSeed) {
      const seed = parseCanonical(ProviderProfileProvisioningSeedSchema, seedValue);
      const database = getStoreDatabase(store);
      const existing = database
        .prepare(
          `SELECT id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
                  credential_handle, status, configuration_v1_json, revision
           FROM provider_profiles WHERE id = ?`,
        )
        .get(seed.id) as unknown as ProviderProfileRow | undefined;
      if (existing !== undefined) {
        if (canonicalJson(providerFromRow(existing)) !== canonicalJson(seed)) {
          throw conflict(`Provider Profile ${seed.id} already exists with different content`);
        }
        return seed;
      }
      const createdAt = parseCanonical(IsoTimestampSchema, now());
      database
        .prepare(
          `INSERT INTO provider_profiles (
             id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
             credential_handle, status, configuration_v1_json, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, '{}', 0, ?, ?)`,
        )
        .run(
          seed.id,
          seed.displayName,
          seed.providerKind,
          seed.model,
          seed.status,
          createdAt,
          createdAt,
        );
      return providerFromRow(
        database
          .prepare(
            `SELECT id, display_name, provider_kind, model, reasoning_strength, endpoint_origin,
                    credential_handle, status, configuration_v1_json, revision
             FROM provider_profiles WHERE id = ?`,
          )
          .get(seed.id) as unknown as ProviderProfileRow,
      );
    },
    registerSkill(inputValue: SkillRegistrationInput) {
      let input: SkillRegistrationInput;
      try {
        input = parseCanonical(SkillRegistrationInputSchema, inputValue);
      } catch (cause) {
        throw new StorageError('INVALID_REQUEST', 'Skill registration is invalid', { cause });
      }
      const database = getStoreDatabase(store);
      return withImmediateTransaction(database, () =>
        registerGlobalSkillInTransaction(database, input, input.document.createdAt),
      );
    },
    registerSkillBatch(inputValue: SkillRegistrationBatchInput) {
      let input: SkillRegistrationBatchInput;
      try {
        input = parseCanonical(SkillRegistrationBatchInputSchema, inputValue);
      } catch (cause) {
        throw new StorageError('INVALID_REQUEST', 'Skill registration batch is invalid', {
          cause,
        });
      }
      if (hashUtf8(canonicalJson(input.entries)) !== input.sourceFingerprint) {
        throw new StorageError(
          'INVALID_REQUEST',
          'Skill registration batch source fingerprint does not match its entries',
        );
      }
      const database = getStoreDatabase(store);
      return withImmediateTransaction(database, () =>
        Object.freeze({
          sourceFingerprint: input.sourceFingerprint,
          results: Object.freeze(
            input.entries.map((entry) =>
              registerGlobalSkillInTransaction(database, entry, entry.document.createdAt),
            ),
          ),
        }),
      );
    },
    buildRootCapabilityCatalog(inputValue: {
      readonly projectId: string;
      readonly baseCatalog: CapabilityCatalogSnapshotV1;
    }) {
      const input = parseCanonical(
        strictObject({
          projectId: EntityIdSchema,
          baseCatalog: CapabilityCatalogSnapshotV1Schema,
        }),
        inputValue,
      );
      return buildRootCapabilityCatalogFromDatabase(getStoreDatabase(store), input);
    },
  });
}

export async function provisionCanonicalBuiltInSkills(
  store: Store,
): Promise<SkillRegistrationBatchResult> {
  const pack = await loadCanonicalBuiltInSkillPack();
  const entries: SkillRegistrationInput[] = pack.skills.map((document) => ({
    document,
    projectId: null,
  }));
  return createHostCatalogProvisioning(store).registerSkillBatch({
    sourceFingerprint: hashCanonical(entries),
    entries,
  });
}

type InteractionAnswerRequest = Extract<WireRequestV1, { readonly method: 'interaction.answer' }>;
type InteractionAnswerSuccess = Extract<WireSuccessV1, { readonly method: 'interaction.answer' }>;
type InteractionAnswerResult = InteractionAnswerSuccess['result'];

interface QuestionInteractionRow {
  readonly id: string;
  readonly run_id: string;
  readonly kind: string;
  readonly prompt: string;
  readonly options_v1_json: string;
  readonly context_refs_v1_json: string;
  readonly allow_free_text: number;
  readonly state: string;
  readonly answer_message_id: string | null;
  readonly created_at: string;
  readonly resolved_at: string | null;
}

interface PendingQuestionInteraction {
  readonly id: string;
  readonly run: ReturnType<typeof loadRun>;
  readonly input: ReturnType<typeof InteractionAskDefinition.parseInput>;
}

function interactionAnswerRequest(value: InteractionAnswerRequest): InteractionAnswerRequest {
  const request = parseRequestV1(value);
  if (request.method !== 'interaction.answer') {
    throw new StorageError('INVALID_REQUEST', 'Expected interaction.answer Wire request');
  }
  return request as InteractionAnswerRequest;
}

function interactionAnswerSuccess(
  request: InteractionAnswerRequest,
  result: InteractionAnswerResult,
): InteractionAnswerSuccess {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as InteractionAnswerSuccess;
}

function pendingQuestionInteraction(
  database: DatabaseSync,
  interactionId: string,
): PendingQuestionInteraction {
  const row = database
    .prepare(
      `SELECT id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
              allow_free_text, state, answer_message_id, created_at, resolved_at
       FROM run_interactions WHERE id = ?`,
    )
    .get(interactionId) as unknown as QuestionInteractionRow | undefined;
  if (row === undefined) {
    throw new StorageError('NOT_FOUND', `Run Interaction ${interactionId} was not found`);
  }
  if (
    row.kind !== 'question' ||
    row.state !== 'pending' ||
    row.answer_message_id !== null ||
    row.resolved_at !== null
  ) {
    throw new StorageError(
      'INVALID_REQUEST',
      `Run Interaction ${interactionId} is not a pending question`,
    );
  }
  const dispatches = (
    database
      .prepare(
        `SELECT id FROM dispatch_operations
         WHERE run_id = ? AND tool_id = 'interaction.ask'`,
      )
      .all(row.run_id) as unknown as readonly { readonly id: string }[]
  )
    .map(({ id }) => loadOperationDispatch(database, id))
    .filter((dispatch) => {
      if (dispatch.outcome?.status !== 'succeeded') return false;
      try {
        return (
          InteractionAskDefinition.parseSuccess(dispatch.outcome.data).interactionId === row.id
        );
      } catch {
        return false;
      }
    });
  if (dispatches.length !== 1) {
    throw corrupt(
      `Run Interaction ${interactionId} must bind exactly one interaction.ask dispatch`,
    );
  }
  const dispatch = dispatches[0]!;
  const outcome = dispatch.outcome;
  if (outcome?.status !== 'succeeded') {
    throw corrupt(`interaction.ask Dispatch ${dispatch.id} lost its success outcome`);
  }
  let input: ReturnType<typeof InteractionAskDefinition.parseInput>;
  let result: ReturnType<typeof InteractionAskDefinition.parseSuccess>;
  try {
    input = InteractionAskDefinition.parseInput(
      dispatch.key.input as z.input<typeof InteractionAskDefinition.inputSchema>,
    );
    result = InteractionAskDefinition.parseSuccess(outcome.data);
  } catch (cause) {
    throw corrupt(`interaction.ask Dispatch ${dispatch.id} is invalid`, cause);
  }
  const run = loadRun(database, row.run_id);
  const pendingCount = database
    .prepare(
      "SELECT COUNT(*) AS count FROM run_interactions WHERE run_id = ? AND state = 'pending'",
    )
    .get(run.id) as { readonly count: number };
  if (
    dispatch.key.toolId !== InteractionAskDefinition.id ||
    dispatch.origin.kind !== 'model' ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.completedAt !== row.created_at ||
    row.prompt !== input.prompt ||
    row.options_v1_json !== canonicalJson(input.options) ||
    row.context_refs_v1_json !== canonicalJson(input.contextRefs) ||
    row.allow_free_text !== (input.allowFreeText ? 1 : 0) ||
    result.runRevision !== input.expectedRunRevision + 2 ||
    result.runRevision !== run.revision ||
    run.status !== 'waiting_question' ||
    pendingCount.count !== 1
  ) {
    throw corrupt(`Run Interaction ${interactionId} binding is invalid`);
  }
  return Object.freeze({ id: row.id, run, input });
}

function interactionAnswerText(
  question: PendingQuestionInteraction,
  answer: InteractionAnswerRequest['input']['answer'],
): string {
  if (answer.kind === 'free_text') {
    if (!question.input.allowFreeText) {
      throw new StorageError(
        'INVALID_REQUEST',
        `Run Interaction ${question.id} does not allow free text`,
      );
    }
    return answer.text;
  }
  if (new Set(answer.optionIds).size !== answer.optionIds.length) {
    throw new StorageError('INVALID_REQUEST', 'Interaction answer option IDs must be unique');
  }
  const options = new Map(question.input.options.map((option) => [option.optionId, option]));
  return answer.optionIds
    .map((optionId) => {
      const option = options.get(optionId);
      if (option === undefined) {
        throw new StorageError(
          'INVALID_REQUEST',
          `Run Interaction ${question.id} has no option ${optionId}`,
        );
      }
      return `[${option.optionId}] ${option.label}${option.description.length === 0 ? '' : ` — ${option.description}`}`;
    })
    .join('\n');
}

export interface HostInteractionAuthority {
  answer(request: InteractionAnswerRequest, context: CommandContext): InteractionAnswerSuccess;
}

export type HostInteractionAuthorityOptions = StorageEnvironmentOptions;

export function createHostInteractionAuthority(
  store: Store,
  options: HostInteractionAuthorityOptions = {},
): HostInteractionAuthority {
  const environment = resolveStorageEnvironment(options);
  return Object.freeze({
    answer(
      requestValue: InteractionAnswerRequest,
      contextValue: CommandContext,
    ): InteractionAnswerSuccess {
      const request = interactionAnswerRequest(requestValue);
      const context = parseCanonical(CommandContextSchema, contextValue);
      if (context.actor !== 'user') {
        throw new StorageError('INVALID_REQUEST', 'Only a user may answer a Run question');
      }
      const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
      const database = getStoreDatabase(store);
      return executeWireMutation(database, request, context, occurredAt, () => {
        const question = pendingQuestionInteraction(database, request.input.interactionId);
        const text = interactionAnswerText(question, request.input.answer);
        const { message } = appendMessageInTransaction(
          database,
          environment,
          context,
          {
            chatId: question.run.chatId,
            role: 'user',
            status: 'accepted',
            originatingRunId: null,
            blocks: [{ type: 'text', text }],
            attachments: [],
            supersedesMessageId: null,
            idempotencyKey: request.requestId,
          },
          {
            messageId: environment.createId('message'),
            eventId: environment.createId('project_event'),
            searchDocumentId: environment.createId('project_search_document'),
            createdAt: occurredAt,
          },
        );
        const answered = database
          .prepare(
            `UPDATE run_interactions
             SET state = 'answered', answer_message_id = ?, resolved_at = ?
             WHERE id = ? AND run_id = ? AND kind = 'question' AND state = 'pending'
               AND answer_message_id IS NULL AND resolved_at IS NULL`,
          )
          .run(message.id, occurredAt, question.id, question.run.id);
        if (Number(answered.changes) !== 1) {
          throw new StorageError('REVISION_CONFLICT', `Run Interaction ${question.id} changed`);
        }
        const inbox = parseCanonical(RunInboxMessageSchema, {
          id: environment.createId('run_inbox_message'),
          runId: question.run.id,
          sequence: nextRunInboxSequence(database, question.run.id),
          actor: 'user',
          source: { kind: 'message', messageId: message.id, contentHash: message.contentHash },
          selectedContext: [],
          exportDestinationGrant: null,
          contentHash: message.contentHash,
          state: 'queued',
          createdAt: occurredAt,
        });
        insertRunInboxMessage(database, inbox);
        try {
          assertRunStateTransition(question.run.status, 'running');
        } catch (cause) {
          throw new StorageError(
            'INVALID_REQUEST',
            `Run ${question.run.id} cannot resume after its question`,
            { cause },
          );
        }
        const events = appendRunEventBatch(database, {
          runId: question.run.id,
          commandId: request.requestId,
          events: [
            {
              eventId: environment.createId('run_event'),
              visibility: 'model_surface',
              occurredAt,
              actor: context.actor,
              causation: context.causation,
              correlationId: context.correlationId,
              payload: {
                type: 'interaction_answered',
                interactionId: question.id,
                messageId: message.id,
                messageHash: message.contentHash,
              },
            },
            {
              eventId: environment.createId('run_event'),
              visibility: 'public',
              occurredAt,
              actor: context.actor,
              causation: context.causation,
              correlationId: context.correlationId,
              payload: {
                type: 'inbox_state_changed',
                inboxMessageId: inbox.id,
                sequence: inbox.sequence,
                state: inbox.state,
              },
            },
            {
              eventId: environment.createId('run_event'),
              visibility: 'public',
              occurredAt,
              actor: context.actor,
              causation: context.causation,
              correlationId: context.correlationId,
              payload: {
                type: 'run_state_changed',
                previousState: question.run.status,
                state: 'running',
                runRevision: question.run.revision + 1,
              },
            },
          ],
        });
        const head = events.at(-1);
        if (head === undefined) {
          throw corrupt(`Run ${question.run.id} interaction answer emitted no events`);
        }
        advanceRunJournalHead(
          database,
          question.run,
          { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
          { status: 'running', terminalOutcome: null },
        );
        return {
          projectId: question.run.projectId,
          response: interactionAnswerSuccess(request, {
            interactionId: question.id,
            messageId: message.id,
            state: 'answered',
          }),
        };
      });
    },
  });
}

type ConfirmationRespondRequest = Extract<
  WireRequestV1,
  { readonly method: 'confirmation.respond' }
>;
type ConfirmationRespondSuccess = Extract<
  WireSuccessV1,
  { readonly method: 'confirmation.respond' }
>;
type ConfirmationRespondResult = ConfirmationRespondSuccess['result'];
type SkillRegistrationTarget = Extract<
  z.output<typeof ConfirmationTargetSchema>,
  { readonly kind: 'skill_registration' }
>;
type ProtectedMutationTarget = Extract<
  z.output<typeof ConfirmationTargetSchema>,
  { readonly kind: 'protected_mutation' }
>;
type DeliveryExportConfirmationTarget = Extract<
  z.output<typeof ConfirmationTargetSchema>,
  { readonly kind: 'delivery_export' }
>;

interface SkillConfirmationRow {
  id: string;
  run_id: string;
  interaction_id: string;
  target_v1_json: string;
  immutable_input_hash: string;
  decision: 'approved' | 'denied' | null;
  decided_by_message_id: string | null;
  requested_at: string;
  decided_at: string | null;
  interaction_run_id: string;
  interaction_kind: string;
  interaction_state: string;
  answer_message_id: string | null;
  resolved_at: string | null;
}

interface PendingSkillConfirmation {
  readonly id: string;
  readonly interactionId: string;
  readonly immutableInputHash: string;
  readonly requestedAt: string;
  readonly target: SkillRegistrationTarget;
  readonly dispatch: ReturnType<typeof loadOperationDispatch>;
}

interface PendingConfirmation {
  readonly id: string;
  readonly interactionId: string;
  readonly immutableInputHash: string;
  readonly requestedAt: string;
  readonly target: z.output<typeof ConfirmationTargetSchema>;
  readonly dispatch: ReturnType<typeof loadOperationDispatch>;
}

interface PendingProtectedMutationConfirmation extends Omit<PendingConfirmation, 'target'> {
  readonly target: ProtectedMutationTarget;
  readonly mutation: ReturnType<typeof assertProtectedMutationPendingBinding>;
}

interface PendingDeliveryExportConfirmation extends Omit<PendingConfirmation, 'target'> {
  readonly target: DeliveryExportConfirmationTarget;
  readonly input: ReturnType<typeof DeliveryExportDefinition.parseInput>;
}

function confirmationRequest(value: ConfirmationRespondRequest): ConfirmationRespondRequest {
  const request = parseRequestV1(value);
  if (request.method !== 'confirmation.respond') {
    throw new StorageError('INVALID_REQUEST', 'Expected confirmation.respond Wire request');
  }
  return request as ConfirmationRespondRequest;
}

function confirmationSuccess(
  request: ConfirmationRespondRequest,
  result: ConfirmationRespondResult,
): ConfirmationRespondSuccess {
  return parseCanonical(WireSuccessV1Schema, {
    wireVersion: 1,
    kind: 'success',
    requestId: request.requestId,
    method: request.method,
    result,
  }) as ConfirmationRespondSuccess;
}

function pendingConfirmation(
  database: DatabaseSync,
  request: ConfirmationRespondRequest,
): PendingConfirmation {
  const row = database
    .prepare(
      `SELECT confirmation.id, confirmation.run_id, confirmation.interaction_id,
              confirmation.target_v1_json, confirmation.immutable_input_hash,
              confirmation.decision, confirmation.decided_by_message_id,
              confirmation.requested_at, confirmation.decided_at,
              interaction.run_id AS interaction_run_id, interaction.kind AS interaction_kind,
              interaction.state AS interaction_state, interaction.answer_message_id,
              interaction.resolved_at
       FROM run_confirmations AS confirmation
       JOIN run_interactions AS interaction ON interaction.id = confirmation.interaction_id
       WHERE confirmation.id = ?`,
    )
    .get(request.input.confirmationId) as unknown as SkillConfirmationRow | undefined;
  if (row === undefined) {
    throw new StorageError(
      'NOT_FOUND',
      `Run Confirmation ${request.input.confirmationId} was not found`,
    );
  }
  let parsedTarget: z.output<typeof ConfirmationTargetSchema>;
  let requestedAt: string;
  try {
    parsedTarget = parseCanonical(
      ConfirmationTargetSchema,
      JSON.parse(row.target_v1_json) as unknown,
    );
    requestedAt = parseCanonical(IsoTimestampSchema, row.requested_at);
  } catch (cause) {
    throw corrupt(`Run Confirmation ${row.id} is invalid`, cause);
  }
  if (canonicalJson(parsedTarget) !== row.target_v1_json) {
    throw corrupt(`Run Confirmation ${row.id} target is not canonical`);
  }
  if (row.immutable_input_hash !== request.input.immutableInputHash) {
    throw new StorageError(
      'INVALID_REQUEST',
      `Run Confirmation ${row.id} input hash does not match`,
    );
  }
  if (
    row.interaction_state === 'cancelled' &&
    row.answer_message_id === null &&
    row.resolved_at !== null &&
    row.decision === null &&
    row.decided_by_message_id === null &&
    row.decided_at === null
  ) {
    const run = loadRun(database, row.run_id);
    if (run.status === 'cancelled') {
      throw new StorageError('INVALID_REQUEST', `Run Confirmation ${row.id} is no longer pending`);
    }
  }
  if (
    row.interaction_run_id !== row.run_id ||
    row.interaction_kind !== 'confirmation' ||
    row.interaction_state !== 'pending' ||
    row.answer_message_id !== null ||
    row.resolved_at !== null ||
    row.decision !== null ||
    row.decided_by_message_id !== null ||
    row.decided_at !== null
  ) {
    throw corrupt(`Run Confirmation ${row.id} pending lifecycle is invalid`);
  }
  const dispatchRows = database
    .prepare('SELECT id FROM dispatch_operations WHERE confirmation_id = ?')
    .all(row.id) as unknown as readonly { id: string }[];
  if (dispatchRows.length !== 1) {
    throw corrupt(`Run Confirmation ${row.id} must bind exactly one dispatch`);
  }
  const dispatch = loadOperationDispatch(database, dispatchRows[0]!.id);
  if (
    dispatch.guardOutcome !== 'confirmation_required' ||
    dispatch.confirmationId !== row.id ||
    dispatch.key.inputHash !== row.immutable_input_hash
  ) {
    throw corrupt(`Run Confirmation ${row.id} Dispatch binding is invalid`);
  }
  return Object.freeze({
    id: row.id,
    interactionId: row.interaction_id,
    immutableInputHash: row.immutable_input_hash,
    requestedAt,
    target: parsedTarget,
    dispatch,
  });
}

function skillConfirmation(confirmation: PendingConfirmation): PendingSkillConfirmation {
  if (confirmation.target.kind !== 'skill_registration') {
    throw new StorageError(
      'INVALID_REQUEST',
      `Run Confirmation ${confirmation.id} is not a Skill proposal`,
    );
  }
  const { dispatch } = confirmation;
  let proposalInput: ReturnType<typeof SkillProposeDefinition.parseInput>;
  try {
    proposalInput = SkillProposeDefinition.parseInput(
      dispatch.key.input as z.input<typeof SkillProposeDefinition.inputSchema>,
    );
  } catch (cause) {
    throw corrupt(`Skill proposal Dispatch ${dispatch.id} input is invalid`, cause);
  }
  if (
    dispatch.key.toolId !== 'skill.propose' ||
    dispatch.guardOutcome !== 'confirmation_required' ||
    dispatch.confirmationId !== confirmation.id ||
    dispatch.key.inputHash !== confirmation.immutableInputHash ||
    dispatch.outcome?.status !== 'permission_required' ||
    dispatch.outcome.confirmationId !== confirmation.id
  ) {
    throw corrupt(`Skill proposal Dispatch ${dispatch.id} binding is invalid`);
  }
  const skill = {
    skillId: `skill.project.${hashCanonical({ projectId: dispatch.key.projectId, dispatchId: dispatch.id })}`,
    name: proposalInput.name,
    description: proposalInput.description,
    version: '1.0.0',
    contentHash: hashUtf8(proposalInput.content),
    provenance: 'project' as const,
    trust: 'reviewed' as const,
    content: proposalInput.content,
    createdAt: confirmation.requestedAt,
  };
  if (
    confirmation.target.projectId !== dispatch.key.projectId ||
    canonicalJson(confirmation.target.skill) !== canonicalJson(skill) ||
    confirmation.target.proposedEffectHash !==
      hashCanonical({
        projectId: dispatch.key.projectId,
        skill,
        enable: true,
        expectedProjectSettings: {
          revision: confirmation.target.expectedProjectSettingsRevision,
          contentHash: confirmation.target.expectedProjectSettingsContentHash,
        },
      })
  ) {
    throw corrupt(
      `Run Confirmation ${confirmation.id} Skill proposal target does not match its dispatch`,
    );
  }
  return Object.freeze({
    ...confirmation,
    target: confirmation.target,
    dispatch,
  });
}

function protectedMutationConfirmation(
  confirmation: PendingConfirmation,
): PendingProtectedMutationConfirmation {
  if (confirmation.target.kind !== 'protected_mutation') {
    throw new StorageError(
      'INVALID_REQUEST',
      `Run Confirmation ${confirmation.id} is not a protected mutation`,
    );
  }
  const { dispatch, target } = confirmation;
  const mutation = assertProtectedMutationPendingBinding(dispatch, target);
  return Object.freeze({ ...confirmation, target, mutation });
}

function deliveryExportConfirmation(
  confirmation: PendingConfirmation,
): PendingDeliveryExportConfirmation {
  if (confirmation.target.kind !== 'delivery_export') {
    throw new StorageError(
      'INVALID_REQUEST',
      `Run Confirmation ${confirmation.id} is not a delivery export`,
    );
  }
  const { dispatch, target } = confirmation;
  let input: ReturnType<typeof DeliveryExportDefinition.parseInput>;
  try {
    input = DeliveryExportDefinition.parseInput(
      dispatch.key.input as Parameters<typeof DeliveryExportDefinition.parseInput>[0],
    );
  } catch (cause) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} input is invalid`, cause);
  }
  if (
    dispatch.key.toolId !== DeliveryExportDefinition.id ||
    dispatch.key.toolVersion !== DeliveryExportDefinition.version ||
    dispatch.key.authorityWatermarkHash !== null ||
    dispatch.guardOutcome !== 'confirmation_required' ||
    dispatch.confirmationId !== confirmation.id ||
    dispatch.outcome !== null ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    dispatch.projectEventId !== null ||
    dispatch.key.inputHash !== confirmation.immutableInputHash ||
    canonicalJson(target.manifest) !== canonicalJson(input.manifest) ||
    target.destination.kind !== input.destination.kind ||
    target.destination.displayLabel !== input.destination.displayLabel ||
    target.overwriteExisting !== input.overwriteExisting
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} binding is invalid`);
  }
  return Object.freeze({ ...confirmation, target, input });
}

function planConfirmedProtectedMutation(
  database: DatabaseSync,
  environment: ReturnType<typeof resolveStorageEnvironment>,
  confirmation: PendingProtectedMutationConfirmation,
  context: CommandContext,
): PlannedProtectedMutation {
  let planned: PlannedProtectedMutation;
  try {
    planned = planProtectedMutationInTransaction(
      database,
      environment,
      confirmation.dispatch,
      context,
      confirmation.requestedAt,
    );
  } catch (cause) {
    if (
      cause instanceof StorageError &&
      (cause.code === 'INVALID_REQUEST' ||
        cause.code === 'NOT_FOUND' ||
        cause.code === 'REVISION_CONFLICT')
    ) {
      throw new StorageError(
        'REVISION_CONFLICT',
        `Protected mutation ${confirmation.dispatch.id} changed before approval`,
        { cause },
      );
    }
    throw cause;
  }
  if (planned.projectId !== confirmation.dispatch.key.projectId) {
    throw corrupt(`Protected mutation Dispatch ${confirmation.dispatch.id} changed Project`);
  }
  assertProtectedMutationPlanMatchesTarget(confirmation.dispatch, confirmation.target, planned);
  return planned;
}

function answerConfirmation(
  database: DatabaseSync,
  confirmation: PendingConfirmation,
  decision: 'approved' | 'denied',
  messageId: string,
  occurredAt: string,
): void {
  const interaction = database
    .prepare(
      `UPDATE run_interactions
       SET state = 'answered', answer_message_id = ?, resolved_at = ?
       WHERE id = ? AND run_id = ? AND kind = 'confirmation' AND state = 'pending'
         AND answer_message_id IS NULL AND resolved_at IS NULL`,
    )
    .run(messageId, occurredAt, confirmation.interactionId, confirmation.dispatch.key.runId);
  if (Number(interaction.changes) !== 1) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `Run Interaction ${confirmation.interactionId} changed`,
    );
  }
  const updated = database
    .prepare(
      `UPDATE run_confirmations
       SET decision = ?, decided_by_message_id = ?, decided_at = ?
       WHERE id = ? AND run_id = ? AND immutable_input_hash = ? AND decision IS NULL
         AND decided_by_message_id IS NULL AND decided_at IS NULL`,
    )
    .run(
      decision,
      messageId,
      occurredAt,
      confirmation.id,
      confirmation.dispatch.key.runId,
      confirmation.immutableInputHash,
    );
  if (Number(updated.changes) !== 1) {
    throw new StorageError('REVISION_CONFLICT', `Run Confirmation ${confirmation.id} changed`);
  }
}

function recordConfirmationAnswerInTransaction(
  database: DatabaseSync,
  environment: ReturnType<typeof resolveStorageEnvironment>,
  confirmation: PendingConfirmation,
  request: ConfirmationRespondRequest,
  context: CommandContext,
  run: ReturnType<typeof loadRun>,
  text: string,
  occurredAt: string,
) {
  const { message } = appendMessageInTransaction(
    database,
    environment,
    context,
    {
      chatId: run.chatId,
      role: 'user',
      status: 'accepted',
      originatingRunId: null,
      blocks: [{ type: 'text', text }],
      attachments: [],
      supersedesMessageId: null,
      idempotencyKey: request.requestId,
    },
    {
      messageId: environment.createId('message'),
      eventId: environment.createId('project_event'),
      searchDocumentId: environment.createId('project_search_document'),
      createdAt: occurredAt,
    },
  );
  answerConfirmation(database, confirmation, request.input.decision, message.id, occurredAt);
  const inbox = parseCanonical(RunInboxMessageSchema, {
    id: environment.createId('run_inbox_message'),
    runId: run.id,
    sequence: nextRunInboxSequence(database, run.id),
    actor: 'user',
    source: { kind: 'message', messageId: message.id, contentHash: message.contentHash },
    selectedContext: [],
    exportDestinationGrant: null,
    contentHash: message.contentHash,
    state: 'queued',
    createdAt: occurredAt,
  });
  insertRunInboxMessage(database, inbox);
  return Object.freeze({ message, inbox });
}

function recordDirectConfirmationAnswerInTransaction(
  database: DatabaseSync,
  environment: ReturnType<typeof resolveStorageEnvironment>,
  confirmation: PendingConfirmation,
  request: ConfirmationRespondRequest,
  context: CommandContext,
  run: ReturnType<typeof loadRun>,
  text: string,
  occurredAt: string,
) {
  const { message } = appendMessageInTransaction(
    database,
    environment,
    context,
    {
      chatId: run.chatId,
      role: 'user',
      status: 'accepted',
      originatingRunId: null,
      blocks: [{ type: 'text', text }],
      attachments: [],
      supersedesMessageId: null,
      idempotencyKey: request.requestId,
    },
    {
      messageId: environment.createId('message'),
      eventId: environment.createId('project_event'),
      searchDocumentId: environment.createId('project_search_document'),
      createdAt: occurredAt,
    },
  );
  answerConfirmation(database, confirmation, request.input.decision, message.id, occurredAt);
  return message;
}

function confirmationEventKey(requestId: string, suffix: 'skill' | 'settings'): string {
  return `confirmation.${suffix}.${hashCanonical(requestId)}`;
}

function enabledSkillsWith(
  enabledSkills: readonly { readonly id: string; readonly version: string }[],
  skill: { readonly skillId: string; readonly version: string },
) {
  if (enabledSkills.some(({ id, version }) => id === skill.skillId && version === skill.version)) {
    throw corrupt(`Project Settings already enable Skill ${skill.skillId}@${skill.version}`);
  }
  return [...enabledSkills, { id: skill.skillId, version: skill.version }].sort((left, right) => {
    const id = left.id.localeCompare(right.id);
    return id === 0 ? left.version.localeCompare(right.version) : id;
  });
}

function respondProtectedMutationConfirmationInTransaction(
  database: DatabaseSync,
  environment: ReturnType<typeof resolveStorageEnvironment>,
  request: ConfirmationRespondRequest,
  context: CommandContext,
  pending: PendingConfirmation,
  occurredAt: string,
) {
  const confirmation = protectedMutationConfirmation(pending);
  const run = loadRun(database, confirmation.dispatch.key.runId);
  if (
    run.projectId !== confirmation.dispatch.key.projectId ||
    run.status !== 'waiting_confirmation'
  ) {
    throw new StorageError(
      'INVALID_REQUEST',
      `Run ${run.id} is not awaiting this protected mutation confirmation`,
    );
  }
  const project = getProject(database, run.projectId);
  if (project.lifecycle !== 'active') {
    throw new StorageError('INVALID_REQUEST', `Project ${project.id} is not active`);
  }
  const commanderContext = parseCanonical(CommandContextSchema, {
    actor: 'commander',
    causation: { kind: 'run', runId: run.id },
    correlationId: confirmation.dispatch.id,
  });
  const planned =
    request.input.decision === 'approved'
      ? planConfirmedProtectedMutation(database, environment, confirmation, commanderContext)
      : null;
  const { message, inbox } = recordConfirmationAnswerInTransaction(
    database,
    environment,
    confirmation,
    request,
    context,
    run,
    request.input.decision === 'approved'
      ? `Approved protected ${confirmation.mutation.toolId} change.`
      : `Denied protected ${confirmation.mutation.toolId} change.`,
    occurredAt,
  );
  const guarded = transitionRuntimeDispatchGuard(database, {
    dispatchOperationId: confirmation.dispatch.id,
    outcome: request.input.decision === 'approved' ? 'allowed' : 'denied',
    confirmationId: confirmation.id,
    occurredAt,
  });

  let effect: ConfirmationRespondResult['effect'] = null;
  let settled: ReturnType<typeof loadOperationDispatch>;
  if (planned === null) {
    settled = settleRuntimeDispatch(database, {
      dispatchOperationId: guarded.id,
      outcome: protectedMutationDeniedOutcome(confirmation.mutation.toolId),
      occurredAt,
    });
  } else {
    const committed = commitPlannedProtectedMutationInTransaction(
      database,
      environment,
      planned,
      commanderContext,
      { dispatchOperationId: guarded.id },
    );
    const bound = bindRuntimeDispatchProjectEvent(database, {
      dispatchOperationId: guarded.id,
      projectEventId: protectedMutationProjectEventId(committed),
      occurredAt,
    });
    settled = settleRuntimeDispatch(database, {
      dispatchOperationId: bound.id,
      outcome: protectedMutationOutcome(committed),
      occurredAt,
    });
    effect = protectedMutationConfirmationEffectFor(settled, committed);
  }
  if (settled.outcome === null || settled.outcomeHash === null) {
    throw corrupt(`Protected mutation Dispatch ${settled.id} settlement disappeared`);
  }
  completePendingProtectedMutationStepInTransaction(
    database,
    environment,
    {
      dispatch: settled,
      confirmation: {
        id: confirmation.id,
        approved: request.input.decision === 'approved',
        messageId: message.id,
        messageHash: message.contentHash,
      },
      inbox: { id: inbox.id, sequence: inbox.sequence },
      occurredAt,
      commandId: request.requestId,
    },
    context,
  );
  return {
    projectId: project.id,
    response: confirmationSuccess(request, {
      confirmationId: confirmation.id,
      messageId: message.id,
      decision: request.input.decision,
      effect,
    }),
  };
}

function respondDeliveryExportConfirmationInTransaction(
  database: DatabaseSync,
  environment: ReturnType<typeof resolveStorageEnvironment>,
  request: ConfirmationRespondRequest,
  context: CommandContext,
  pending: PendingConfirmation,
  occurredAt: string,
) {
  const confirmation = deliveryExportConfirmation(pending);
  const run = loadRun(database, confirmation.dispatch.key.runId);
  if (
    run.projectId !== confirmation.dispatch.key.projectId ||
    run.status !== 'waiting_confirmation'
  ) {
    throw new StorageError(
      'INVALID_REQUEST',
      `Run ${run.id} is not awaiting this delivery export confirmation`,
    );
  }
  const project = getProject(database, run.projectId);
  if (project.lifecycle !== 'active') {
    throw new StorageError('INVALID_REQUEST', `Project ${project.id} is not active`);
  }
  const message = recordDirectConfirmationAnswerInTransaction(
    database,
    environment,
    confirmation,
    request,
    context,
    run,
    request.input.decision === 'approved'
      ? `Approved delivery export to ${confirmation.input.destination.displayLabel}.`
      : `Denied delivery export to ${confirmation.input.destination.displayLabel}.`,
    occurredAt,
  );
  const guarded = transitionRuntimeDispatchGuard(database, {
    dispatchOperationId: confirmation.dispatch.id,
    outcome: request.input.decision === 'approved' ? 'allowed' : 'denied',
    confirmationId: confirmation.id,
    occurredAt,
  });
  const dispatch =
    request.input.decision === 'approved'
      ? guarded
      : settleRuntimeDispatch(database, {
          dispatchOperationId: guarded.id,
          outcome: DeliveryExportDefinition.parseOutcome({
            status: 'permission_denied',
            code: 'protected_denied',
            message: 'Delivery export was denied.',
          }),
          occurredAt,
        });
  if (
    request.input.decision === 'denied' &&
    (dispatch.outcome?.status !== 'permission_denied' || dispatch.outcomeHash === null)
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} denial settlement disappeared`);
  }
  completePendingDeliveryExportConfirmationInTransaction(
    database,
    environment,
    {
      dispatch,
      confirmation: {
        id: confirmation.id,
        approved: request.input.decision === 'approved',
        messageId: message.id,
        messageHash: message.contentHash,
      },
      occurredAt,
      commandId: request.requestId,
    },
    context,
  );
  return {
    projectId: project.id,
    response: confirmationSuccess(request, {
      confirmationId: confirmation.id,
      messageId: message.id,
      decision: request.input.decision,
      effect: null,
    }),
  };
}

export interface HostConfirmationAuthority {
  respond(request: ConfirmationRespondRequest, context: CommandContext): ConfirmationRespondSuccess;
}

export type HostConfirmationAuthorityOptions = StorageEnvironmentOptions;

export function createHostConfirmationAuthority(
  store: Store,
  options: HostConfirmationAuthorityOptions = {},
): HostConfirmationAuthority {
  const environment = resolveStorageEnvironment(options);
  return Object.freeze({
    respond(
      requestValue: ConfirmationRespondRequest,
      contextValue: CommandContext,
    ): ConfirmationRespondSuccess {
      const request = confirmationRequest(requestValue);
      const context = parseCanonical(CommandContextSchema, contextValue);
      if (context.actor !== 'user') {
        throw new StorageError('INVALID_REQUEST', 'Only a user may answer a confirmation');
      }
      const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
      const database = getStoreDatabase(store);
      return executeWireMutation(database, request, context, occurredAt, () => {
        const pending = pendingConfirmation(database, request);
        if (pending.target.kind === 'protected_mutation') {
          return respondProtectedMutationConfirmationInTransaction(
            database,
            environment,
            request,
            context,
            pending,
            occurredAt,
          );
        }
        if (pending.target.kind === 'delivery_export') {
          return respondDeliveryExportConfirmationInTransaction(
            database,
            environment,
            request,
            context,
            pending,
            occurredAt,
          );
        }
        const confirmation = skillConfirmation(pending);
        const run = loadRun(database, confirmation.dispatch.key.runId);
        if (
          run.projectId !== confirmation.target.projectId ||
          run.projectId !== confirmation.dispatch.key.projectId ||
          run.status !== 'waiting_confirmation'
        ) {
          throw new StorageError(
            'INVALID_REQUEST',
            `Run ${run.id} is not awaiting this Skill confirmation`,
          );
        }
        const project = getProject(database, run.projectId);
        if (project.lifecycle !== 'active') {
          throw new StorageError('INVALID_REQUEST', `Project ${project.id} is not active`);
        }
        const settings = getSettings(database, project.id);
        if (
          settings.revision !== confirmation.target.expectedProjectSettingsRevision ||
          settings.contentHash !== confirmation.target.expectedProjectSettingsContentHash
        ) {
          throw new StorageError(
            'REVISION_CONFLICT',
            `Project settings ${settings.projectId} revision changed`,
          );
        }
        let effect: ConfirmationRespondResult['effect'] = null;
        if (request.input.decision === 'approved') {
          writeSkillRegistrationInTransaction(
            database,
            { document: confirmation.target.skill, projectId: project.id },
            {
              createdByConfirmationId: confirmation.id,
              effectiveAt: occurredAt,
              allowExactExisting: false,
              activateEffectiveVersion: true,
            },
          );
          appendProjectEvent(database, {
            eventId: environment.createId('project_event'),
            projectId: project.id,
            occurredAt,
            actor: context.actor,
            subject: { authority: 'skill', id: confirmation.target.skill.skillId },
            causation: context.causation,
            correlationId: context.correlationId,
            idempotencyKey: confirmationEventKey(request.requestId, 'skill'),
            payload: {
              type: 'object_created',
              revision: 0,
              contentHash: confirmation.target.skill.contentHash,
            },
          });
          const nextSettings = updateProjectSettingsInTransaction(
            database,
            environment,
            {
              projectId: project.id,
              expectedRevision: confirmation.target.expectedProjectSettingsRevision,
              expectedContentHash: confirmation.target.expectedProjectSettingsContentHash,
              values: {
                defaultProviderProfileId: settings.defaultProviderProfileId,
                formatPolicy: settings.formatPolicy,
                permission: settings.permission,
                budget: settings.budget,
                enabledSkills: enabledSkillsWith(settings.enabledSkills, confirmation.target.skill),
              },
              occurredAt,
              eventIdempotencyKey: confirmationEventKey(request.requestId, 'settings'),
            },
            context,
          );
          effect = {
            kind: 'skill_registered',
            projectId: project.id,
            skillId: confirmation.target.skill.skillId,
            version: confirmation.target.skill.version,
            contentHash: confirmation.target.skill.contentHash,
            projectSettingsRevision: nextSettings.revision,
            projectSettingsContentHash: nextSettings.contentHash,
            effectiveFrom: 'next_root_run',
          };
        }
        const { message, inbox } = recordConfirmationAnswerInTransaction(
          database,
          environment,
          confirmation,
          request,
          context,
          run,
          request.input.decision === 'approved'
            ? `Approved Project Skill "${confirmation.target.skill.name}".`
            : `Denied Project Skill "${confirmation.target.skill.name}".`,
          occurredAt,
        );
        try {
          assertRunStateTransition(run.status, 'running');
        } catch (cause) {
          throw new StorageError(
            'INVALID_REQUEST',
            `Run transition ${run.status} -> running is invalid`,
            { cause },
          );
        }
        const events: AppendRunEventBatchInput['events'] = [
          {
            eventId: environment.createId('run_event'),
            visibility: 'model_surface',
            occurredAt,
            actor: context.actor,
            causation: context.causation,
            correlationId: context.correlationId,
            payload: {
              type: 'confirmation_answered',
              confirmationId: confirmation.id,
              approved: request.input.decision === 'approved',
              messageId: message.id,
              messageHash: message.contentHash,
            },
          },
          {
            eventId: environment.createId('run_event'),
            visibility: 'public',
            occurredAt,
            actor: context.actor,
            causation: context.causation,
            correlationId: context.correlationId,
            payload: {
              type: 'inbox_state_changed',
              inboxMessageId: inbox.id,
              sequence: inbox.sequence,
              state: inbox.state,
            },
          },
          {
            eventId: environment.createId('run_event'),
            visibility: 'public',
            occurredAt,
            actor: context.actor,
            causation: context.causation,
            correlationId: context.correlationId,
            payload: {
              type: 'run_state_changed',
              previousState: run.status,
              state: 'running',
              runRevision: run.revision + 1,
            },
          },
        ];
        const runEvents = appendRunEventBatch(database, {
          runId: run.id,
          commandId: request.requestId,
          events,
        });
        const head = runEvents.at(-1);
        if (head === undefined) {
          throw corrupt(`Run ${run.id} confirmation response did not append an event`);
        }
        advanceRunJournalHead(
          database,
          run,
          { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
          { status: 'running', terminalOutcome: null },
        );
        return {
          projectId: project.id,
          response: confirmationSuccess(request, {
            confirmationId: confirmation.id,
            messageId: message.id,
            decision: request.input.decision,
            effect,
          }),
        };
      });
    },
  });
}
