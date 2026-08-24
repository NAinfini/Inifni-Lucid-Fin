import {
  AgentSendDurableInputSchema,
  AgentSpawnDurableInputSchema,
  CapabilityCatalogSnapshotV1Schema,
  ConfirmationTargetSchema,
  DeliveryExportDefinition,
  EntityIdSchema,
  IsoTimestampSchema,
  OperationFingerprintSourceSchema,
  OperationKindSchema,
  RuntimeLoopOutcomeSchema,
  Sha256Schema,
  ToolProgramDurableInputSchema,
  ToolIdSchema,
  ToolVersionSchema,
  canonicalJson,
  executableToolDefinition,
  operationFingerprintInput,
  parseCanonical,
  runtimeLoopOutcomeHashInput,
  strictObject,
  type OperationKind,
  type OperationPublicView,
  type OperationRef,
  type Run,
  type RuntimeLoopOutcome,
  type ToolId,
  z,
} from '@lucid-fin/target-contracts';
import type { DatabaseSync } from 'node:sqlite';
import { TargetStorageError } from '../kernel/errors.js';
import { decodeCanonicalRecord, encodeCanonicalRecord } from './canonical-codecs.js';
import { TargetCommandContextSchema, type TargetCommandContext } from './command.js';
import type { TargetStorageEnvironment } from './environment.js';
import { capabilityCatalogIntegrityError } from './capability-catalog-integrity.js';
import { hashCanonical, hashUtf8 } from './hashes.js';
import {
  loadOperationOwnerRecord,
  operationPublicViewForOwner,
  operationRefForOwner,
  type OperationOwnerAuthority,
  type OperationOwnerRecord,
} from './operation-owner-records.js';
import { appendRunEventBatch, type AppendRunEventBatchInput } from './run-journal.js';
import { advanceRunJournalHead, loadRun } from './run-records.js';
import { loadModelAttemptRecord } from './model-attempt-records.js';
import {
  isProtectedMutationTool,
  type ProtectedMutationToolId,
} from './protected-mutation-tool-ids.js';

const GuardOutcomeSchema = z.enum(['allowed', 'confirmation_required', 'denied']);
const ConfirmationDecisionSchema = z.enum(['approved', 'denied']);
const ProgramDispatchStoredInputSchema = strictObject({ inputHash: Sha256Schema });
const OperationDispatchKeyInputSchema = strictObject({
  runId: EntityIdSchema,
  toolId: ToolIdSchema,
  toolVersion: ToolVersionSchema.optional(),
  authorityWatermarkHash: Sha256Schema.nullable().optional(),
  input: z.unknown(),
});
type ConfirmationTarget = z.output<typeof ConfirmationTargetSchema>;

export interface OperationDispatchKey {
  readonly projectId: string;
  readonly runId: string;
  readonly capabilityCatalogSnapshotId: string;
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly authorityWatermarkHash: string | null;
  readonly input: unknown;
  readonly inputJson: string;
  readonly inputHash: string;
  readonly fingerprint: string;
}

export type OperationDispatchOrigin =
  | { readonly kind: 'host' }
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

export interface OperationDispatchRecord {
  readonly id: string;
  readonly key: OperationDispatchKey;
  readonly idempotencyKey: string;
  readonly guardOutcome: z.output<typeof GuardOutcomeSchema>;
  readonly confirmationId: string | null;
  readonly operationKind: OperationKind | null;
  readonly ownerAuthority: OperationOwnerAuthority | null;
  readonly ownerId: string | null;
  readonly projectEventId: string | null;
  readonly originModelAttemptId: string | null;
  readonly originProviderCallId: string | null;
  readonly parentDispatchOperationId: string | null;
  readonly programStepId: string | null;
  readonly programCallIndex: number | null;
  readonly origin: OperationDispatchOrigin;
  readonly outcome: RuntimeLoopOutcome | null;
  readonly outcomeHash: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BoundOperationRecord {
  readonly dispatch: OperationDispatchRecord & {
    readonly operationKind: OperationKind;
    readonly ownerAuthority: OperationOwnerAuthority;
    readonly ownerId: string;
  };
  readonly owner: OperationOwnerRecord;
}

interface DispatchRow {
  id: string;
  run_id: string;
  tool_id: string;
  tool_version: string;
  guard_outcome: z.output<typeof GuardOutcomeSchema>;
  idempotency_key: string;
  input_hash: string;
  input_v1_json: string;
  authority_watermark_hash: string | null;
  origin_model_attempt_id: string | null;
  origin_provider_call_id: string | null;
  parent_dispatch_operation_id: string | null;
  program_step_id: string | null;
  program_call_index: number | null;
  confirmation_id: string | null;
  operation_kind: OperationKind | null;
  owner_authority: OperationOwnerAuthority | null;
  owner_id: string | null;
  project_event_id: string | null;
  outcome_v1_json: string | null;
  outcome_hash: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RunCatalogRow {
  project_id: string;
  capability_catalog_snapshot_id: string;
  capability_catalog_hash: string;
  catalog_hash: string;
  catalog_v1_json: string;
}

interface ExecutableToolDefinition {
  readonly version: string;
  readonly metadata: { readonly confirmation: { readonly mode: string } };
  readonly parseInput: (value: unknown) => unknown;
  readonly parseOutcome: (value: unknown) => unknown;
}

function executableDefinition(
  toolId: ToolId,
  toolVersion: string,
): ExecutableToolDefinition | undefined {
  return executableToolDefinition(toolId, toolVersion) as unknown as
    ExecutableToolDefinition | undefined;
}

const OWNER_BY_KIND = Object.freeze({
  generation_attempt: 'generation_attempt',
  media_derivation: 'media_derivation_attempt',
  result_assessment: 'result_assessment_attempt',
  review_cut_attempt: 'review_cut_attempt',
  delivery_export: 'delivery_export',
} satisfies Record<OperationKind, OperationOwnerAuthority>);

function corrupt(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'CORRUPT_DATA',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function invalid(message: string, cause?: unknown): TargetStorageError {
  return new TargetStorageError(
    'INVALID_REQUEST',
    message,
    cause === undefined ? undefined : { cause },
  );
}

function runCatalog(database: DatabaseSync, runId: string): RunCatalogRow {
  const row = database
    .prepare(
      `SELECT run.project_id, run.capability_catalog_snapshot_id, run.capability_catalog_hash,
              snapshot.catalog_hash, snapshot.catalog_v1_json
       FROM runs AS run
       JOIN capability_catalog_snapshots AS snapshot
         ON snapshot.id = run.capability_catalog_snapshot_id AND snapshot.run_id = run.id
       WHERE run.id = ?`,
    )
    .get(runId) as unknown as RunCatalogRow | undefined;
  if (row === undefined) throw new TargetStorageError('NOT_FOUND', `Run was not found: ${runId}`);
  if (row.catalog_hash !== row.capability_catalog_hash) {
    throw corrupt(`Run ${runId} Capability Catalog hash does not match its snapshot`);
  }
  return row;
}

export function resolveOperationDispatchKey(
  database: DatabaseSync,
  inputValue: z.input<typeof OperationDispatchKeyInputSchema>,
): OperationDispatchKey {
  let input: z.output<typeof OperationDispatchKeyInputSchema>;
  try {
    input = parseCanonical(OperationDispatchKeyInputSchema, inputValue);
  } catch (cause) {
    throw invalid('Operation dispatch key input is invalid', cause);
  }
  const row = runCatalog(database, input.runId);
  const snapshot = decodeCanonicalRecord(
    `Run ${input.runId} Capability Catalog`,
    CapabilityCatalogSnapshotV1Schema,
    row.catalog_v1_json,
  );
  if (snapshot.catalogHash !== row.catalog_hash) {
    throw corrupt(`Run ${input.runId} Capability Catalog content does not match its row`);
  }
  const integrityError = capabilityCatalogIntegrityError(snapshot);
  if (integrityError !== undefined) {
    throw corrupt(`Run ${input.runId} ${integrityError}`);
  }
  const catalogTool = snapshot.tools.find(({ id }) => id === input.toolId);
  const toolVersion = input.toolVersion ?? catalogTool?.version;
  const definition =
    toolVersion === undefined ? undefined : executableDefinition(input.toolId, toolVersion);
  if (catalogTool === undefined || definition === undefined) {
    throw invalid(`Tool ${input.toolId} is not available in Run ${input.runId}`);
  }
  if (catalogTool.version !== definition.version || toolVersion !== catalogTool.version) {
    throw invalid(`Tool ${input.toolId} version does not match the Run Capability Catalog`);
  }
  let parsedInput: unknown;
  try {
    parsedInput =
      input.toolId === 'agent.spawn'
        ? AgentSpawnDurableInputSchema.parse(input.input)
        : input.toolId === 'agent.send'
          ? AgentSendDurableInputSchema.parse(input.input)
          : input.toolId === 'tool.program'
            ? ToolProgramDurableInputSchema.parse(input.input)
            : definition.parseInput(input.input);
  } catch (cause) {
    throw invalid(`Tool ${input.toolId} input is invalid`, cause);
  }
  const inputJson = canonicalJson(parsedInput);
  const inputHash = hashUtf8(inputJson);
  const authorityWatermarkHash = input.authorityWatermarkHash ?? null;
  const source = parseCanonical(OperationFingerprintSourceSchema, {
    projectId: row.project_id,
    runId: input.runId,
    capabilityCatalogSnapshotId: row.capability_catalog_snapshot_id,
    toolId: input.toolId,
    toolVersion: catalogTool.version,
    inputHash,
  });
  return Object.freeze({
    projectId: source.projectId,
    runId: source.runId,
    capabilityCatalogSnapshotId: source.capabilityCatalogSnapshotId,
    toolId: input.toolId,
    toolVersion: source.toolVersion,
    inputHash: source.inputHash,
    input: parsedInput,
    inputJson,
    authorityWatermarkHash,
    fingerprint: hashCanonical(
      authorityWatermarkHash === null
        ? operationFingerprintInput(source)
        : { operation: operationFingerprintInput(source), authorityWatermarkHash },
    ),
  });
}

export interface ApprovedRunConfirmation {
  readonly id: string;
  readonly runId: string;
  readonly target: ConfirmationTarget;
  readonly immutableInputHash: string;
  readonly decidedByMessageId: string;
}

interface RunConfirmationBinding {
  readonly id: string;
  readonly runId: string;
  readonly target: ConfirmationTarget;
  readonly immutableInputHash: string;
  readonly decision: z.output<typeof ConfirmationDecisionSchema> | null;
  readonly decidedByMessageId: string | null;
  readonly interactionKind: string;
  readonly interactionState: string;
  readonly answerMessageId: string | null;
  readonly projectId: string;
  readonly chatId: string;
  readonly messageProjectId: string | null;
  readonly messageChatId: string | null;
  readonly messageRole: string | null;
  readonly messageStatus: string | null;
}

function loadRunConfirmationBinding(
  database: DatabaseSync,
  confirmationIdValue: string,
  key: OperationDispatchKey,
): RunConfirmationBinding {
  const confirmationId = parseCanonical(EntityIdSchema, confirmationIdValue);
  const row = database
    .prepare(
      `SELECT confirmation.run_id, confirmation.target_v1_json,
              confirmation.immutable_input_hash, confirmation.decision,
              confirmation.decided_by_message_id,
              interaction.kind AS interaction_kind, interaction.state AS interaction_state,
              interaction.answer_message_id, run.project_id, run.chat_id,
              message.project_id AS message_project_id, message.chat_id AS message_chat_id,
              message.role AS message_role, message.status AS message_status
       FROM run_confirmations AS confirmation
       JOIN run_interactions AS interaction ON interaction.id = confirmation.interaction_id
       JOIN runs AS run ON run.id = confirmation.run_id
       LEFT JOIN messages AS message ON message.id = confirmation.decided_by_message_id
       WHERE confirmation.id = ?`,
    )
    .get(confirmationId) as unknown as
    | {
        run_id: string;
        target_v1_json: string;
        immutable_input_hash: string;
        decision: string | null;
        decided_by_message_id: string | null;
        interaction_kind: string;
        interaction_state: string;
        answer_message_id: string | null;
        project_id: string;
        chat_id: string;
        message_project_id: string | null;
        message_chat_id: string | null;
        message_role: string | null;
        message_status: string | null;
      }
    | undefined;
  if (row === undefined) throw corrupt(`Run Confirmation was not found: ${confirmationId}`);
  let decision: z.output<typeof ConfirmationDecisionSchema> | null;
  try {
    decision =
      row.decision === null ? null : parseCanonical(ConfirmationDecisionSchema, row.decision);
  } catch (cause) {
    throw corrupt(`Run Confirmation ${confirmationId} decision is invalid`, cause);
  }
  if (row.run_id !== key.runId || row.immutable_input_hash !== key.inputHash) {
    throw corrupt(`Run Confirmation ${confirmationId} does not bind this Operation input`);
  }
  const target = decodeCanonicalRecord(
    `Run Confirmation ${confirmationId} target`,
    ConfirmationTargetSchema,
    row.target_v1_json,
  );
  return Object.freeze({
    id: confirmationId,
    runId: row.run_id,
    target,
    immutableInputHash: row.immutable_input_hash,
    decision,
    decidedByMessageId: row.decided_by_message_id,
    interactionKind: row.interaction_kind,
    interactionState: row.interaction_state,
    answerMessageId: row.answer_message_id,
    projectId: row.project_id,
    chatId: row.chat_id,
    messageProjectId: row.message_project_id,
    messageChatId: row.message_chat_id,
    messageRole: row.message_role,
    messageStatus: row.message_status,
  });
}

function assertConfirmationLifecycle(confirmation: RunConfirmationBinding): void {
  const isPending = confirmation.decision === null;
  if (
    confirmation.interactionKind !== 'confirmation' ||
    (isPending
      ? confirmation.interactionState !== 'pending' ||
        confirmation.decidedByMessageId !== null ||
        confirmation.answerMessageId !== null
      : confirmation.decidedByMessageId === null ||
        confirmation.interactionState !== 'answered' ||
        confirmation.answerMessageId !== confirmation.decidedByMessageId ||
        confirmation.messageProjectId !== confirmation.projectId ||
        confirmation.messageChatId !== confirmation.chatId ||
        confirmation.messageRole !== 'user' ||
        confirmation.messageStatus !== 'accepted')
  ) {
    throw corrupt(`Run Confirmation ${confirmation.id} lifecycle is invalid`);
  }
}

function approvedRunConfirmation(confirmation: RunConfirmationBinding): ApprovedRunConfirmation {
  assertConfirmationLifecycle(confirmation);
  if (confirmation.decision !== 'approved' || confirmation.decidedByMessageId === null) {
    throw corrupt(`Run Confirmation ${confirmation.id} is not approved`);
  }
  return Object.freeze({
    id: confirmation.id,
    runId: confirmation.runId,
    target: confirmation.target,
    immutableInputHash: confirmation.immutableInputHash,
    decidedByMessageId: confirmation.decidedByMessageId,
  });
}

function deniedRunConfirmation(confirmation: RunConfirmationBinding): void {
  assertConfirmationLifecycle(confirmation);
  if (confirmation.decision !== 'denied' || confirmation.decidedByMessageId === null) {
    throw corrupt(`Run Confirmation ${confirmation.id} is not denied`);
  }
}

export function loadApprovedRunConfirmation(
  database: DatabaseSync,
  confirmationIdValue: string,
  key: OperationDispatchKey,
): ApprovedRunConfirmation {
  return approvedRunConfirmation(loadRunConfirmationBinding(database, confirmationIdValue, key));
}

function assertConfirmation(
  database: DatabaseSync,
  confirmationId: string | null,
  key: OperationDispatchKey,
  guardOutcome: z.output<typeof GuardOutcomeSchema>,
): void {
  if (confirmationId === null) {
    if (guardOutcome === 'denied') {
      throw corrupt('Denied Dispatch must bind its denied Run Confirmation');
    }
    return;
  }
  const confirmation = loadRunConfirmationBinding(database, confirmationId, key);
  if (guardOutcome === 'confirmation_required') {
    assertConfirmationLifecycle(confirmation);
    return;
  }
  if (guardOutcome === 'allowed') {
    approvedRunConfirmation(confirmation);
    return;
  }
  if (guardOutcome === 'denied') {
    deniedRunConfirmation(confirmation);
    return;
  }
  throw corrupt(`Dispatch guard ${guardOutcome} cannot bind Run Confirmation ${confirmation.id}`);
}

function assertProjectEvent(
  database: DatabaseSync,
  projectEventId: string | null,
  projectId: string,
): void {
  if (projectEventId === null) return;
  const row = database
    .prepare('SELECT project_id FROM project_events WHERE id = ?')
    .get(projectEventId) as unknown as { project_id: string } | undefined;
  if (row === undefined || row.project_id !== projectId) {
    throw corrupt(`Dispatch ProjectEvent ${projectEventId} does not belong to its Project`);
  }
}

function runtimeDispatchIdempotencyKey(
  operationFingerprint: string,
  modelAttemptId: string,
  providerCallId: string,
): string {
  return hashCanonical({
    version: 1,
    kind: 'runtime_dispatch',
    operationFingerprint,
    modelAttemptId,
    providerCallId,
  });
}

function programRuntimeDispatchIdempotencyKey(
  operationFingerprint: string,
  parentDispatchOperationId: string,
  programStepId: string,
  programCallIndex: number,
): string {
  return hashCanonical({
    version: 1,
    kind: 'tool_program_dispatch',
    operationFingerprint,
    parentDispatchOperationId,
    programStepId,
    programCallIndex,
  });
}

function programDispatchKeyFromRow(
  database: DatabaseSync,
  row: DispatchRow,
  toolId: ToolId,
  toolVersion: string,
): OperationDispatchKey {
  let storedInput: z.output<typeof ProgramDispatchStoredInputSchema>;
  try {
    storedInput = parseCanonical(
      ProgramDispatchStoredInputSchema,
      JSON.parse(row.input_v1_json) as unknown,
    );
  } catch (cause) {
    throw corrupt(`Program Dispatch ${row.id} safe input is invalid`, cause);
  }
  if (storedInput.inputHash !== row.input_hash) {
    throw corrupt(`Program Dispatch ${row.id} safe input hash does not match`);
  }
  const catalog = runCatalog(database, row.run_id);
  const snapshot = decodeCanonicalRecord(
    `Run ${row.run_id} Capability Catalog`,
    CapabilityCatalogSnapshotV1Schema,
    catalog.catalog_v1_json,
  );
  if (
    snapshot.catalogHash !== catalog.catalog_hash ||
    capabilityCatalogIntegrityError(snapshot) !== undefined
  ) {
    throw corrupt(`Run ${row.run_id} Capability Catalog is invalid`);
  }
  const catalogTool = snapshot.tools.find(({ id }) => id === toolId);
  const definition = executableDefinition(toolId, toolVersion);
  if (
    catalogTool === undefined ||
    definition === undefined ||
    catalogTool.version !== definition.version ||
    catalogTool.version !== toolVersion
  ) {
    throw corrupt(`Program Dispatch ${row.id} tool is not available in its child Run catalog`);
  }
  const source = parseCanonical(OperationFingerprintSourceSchema, {
    projectId: catalog.project_id,
    runId: row.run_id,
    capabilityCatalogSnapshotId: catalog.capability_catalog_snapshot_id,
    toolId,
    toolVersion,
    inputHash: row.input_hash,
  });
  const authorityWatermarkHash = row.authority_watermark_hash;
  return Object.freeze({
    projectId: source.projectId,
    runId: source.runId,
    capabilityCatalogSnapshotId: source.capabilityCatalogSnapshotId,
    toolId,
    toolVersion,
    inputHash: source.inputHash,
    input: storedInput,
    inputJson: canonicalJson(storedInput),
    authorityWatermarkHash,
    fingerprint: hashCanonical(
      authorityWatermarkHash === null
        ? operationFingerprintInput(source)
        : { operation: operationFingerprintInput(source), authorityWatermarkHash },
    ),
  });
}

function programOriginFromRow(row: DispatchRow): OperationDispatchOrigin | null {
  const modelOriginComplete =
    row.origin_model_attempt_id !== null && row.origin_provider_call_id !== null;
  const modelOriginAbsent =
    row.origin_model_attempt_id === null && row.origin_provider_call_id === null;
  const programOriginComplete =
    row.parent_dispatch_operation_id !== null &&
    row.program_step_id !== null &&
    row.program_call_index !== null;
  const programOriginAbsent =
    row.parent_dispatch_operation_id === null &&
    row.program_step_id === null &&
    row.program_call_index === null;
  if (!modelOriginComplete && !modelOriginAbsent) {
    throw corrupt(`Dispatch Operation ${row.id} model origin is incomplete`);
  }
  if (!programOriginComplete && !programOriginAbsent) {
    throw corrupt(`Dispatch Operation ${row.id} Tool Program origin is incomplete`);
  }
  if (modelOriginComplete && programOriginAbsent) {
    return {
      kind: 'model',
      modelAttemptId: row.origin_model_attempt_id!,
      providerCallId: row.origin_provider_call_id!,
    };
  }
  if (modelOriginAbsent && programOriginComplete) {
    let parentDispatchOperationId: string;
    let programStepId: string;
    let programCallIndex: number;
    try {
      parentDispatchOperationId = parseCanonical(EntityIdSchema, row.parent_dispatch_operation_id);
      programStepId = parseCanonical(EntityIdSchema, row.program_step_id);
      programCallIndex = parseCanonical(z.number().int().nonnegative(), row.program_call_index);
    } catch (cause) {
      throw corrupt(`Dispatch Operation ${row.id} Tool Program origin is invalid`, cause);
    }
    return {
      kind: 'tool_program',
      parentDispatchOperationId,
      programStepId,
      programCallIndex,
    };
  }
  if (modelOriginAbsent && programOriginAbsent) return { kind: 'host' };
  throw corrupt(`Dispatch Operation ${row.id} mixes model and Tool Program origins`);
}

function assertProgramOriginBinding(
  database: DatabaseSync,
  row: DispatchRow,
  key: OperationDispatchKey,
  origin: Extract<OperationDispatchOrigin, { readonly kind: 'tool_program' }>,
): void {
  const parentRow = database
    .prepare(
      `SELECT run_id, tool_id, origin_model_attempt_id, origin_provider_call_id,
              parent_dispatch_operation_id, program_step_id, program_call_index,
              input_v1_json
       FROM dispatch_operations WHERE id = ?`,
    )
    .get(origin.parentDispatchOperationId) as
    | {
        readonly run_id: string;
        readonly tool_id: string;
        readonly origin_model_attempt_id: string | null;
        readonly origin_provider_call_id: string | null;
        readonly parent_dispatch_operation_id: string | null;
        readonly program_step_id: string | null;
        readonly program_call_index: number | null;
        readonly input_v1_json: string;
      }
    | undefined;
  if (
    parentRow === undefined ||
    parentRow.tool_id !== 'tool.program' ||
    parentRow.origin_model_attempt_id === null ||
    parentRow.origin_provider_call_id === null ||
    parentRow.parent_dispatch_operation_id !== null ||
    parentRow.program_step_id !== null ||
    parentRow.program_call_index !== null
  ) {
    throw corrupt(`Program Dispatch ${row.id} parent dispatch is invalid`);
  }
  const childRun = loadRun(database, key.runId);
  if (
    parentRow.run_id !== childRun.parentRunId ||
    childRun.acceptedSource.kind !== 'parent_direction'
  ) {
    throw corrupt(`Program Dispatch ${row.id} parent/child Run lineage is invalid`);
  }
  let program: z.output<typeof ToolProgramDurableInputSchema>;
  try {
    program = parseCanonical(
      ToolProgramDurableInputSchema,
      JSON.parse(parentRow.input_v1_json) as unknown,
    );
  } catch (cause) {
    throw corrupt(`Program Dispatch ${row.id} parent safe input is invalid`, cause);
  }
  const attempt = loadModelAttemptRecord(database, parentRow.origin_model_attempt_id);
  const parentCall = attempt.response?.events.find(
    (event) =>
      event.type === 'tool_call' && event.providerCallId === parentRow.origin_provider_call_id,
  );
  if (
    attempt.runId !== parentRow.run_id ||
    attempt.state !== 'succeeded' ||
    parentCall?.type !== 'tool_call' ||
    parentCall.toolId !== 'tool.program' ||
    canonicalJson(parentCall.canonicalArguments) !== canonicalJson(program)
  ) {
    throw corrupt(`Program Dispatch ${row.id} parent model origin is invalid`);
  }
  const projection = program.calls.find(
    ({ stepId, callIndex }) =>
      stepId === origin.programStepId && callIndex === origin.programCallIndex,
  );
  if (
    projection === undefined ||
    projection.toolId !== key.toolId ||
    projection.toolVersion !== key.toolVersion ||
    projection.inputHash !== key.inputHash ||
    childRun.acceptedSource.directionHash !== program.programHash
  ) {
    throw corrupt(`Program Dispatch ${row.id} does not match its durable parent projection`);
  }
}

function dispatchFromRow(database: DatabaseSync, row: DispatchRow): OperationDispatchRecord {
  let toolId: ToolId;
  let toolVersion: string;
  let guardOutcome: z.output<typeof GuardOutcomeSchema>;
  let operationKind: OperationKind | null;
  try {
    toolId = parseCanonical(ToolIdSchema, row.tool_id);
    toolVersion = parseCanonical(ToolVersionSchema, row.tool_version);
    guardOutcome = parseCanonical(GuardOutcomeSchema, row.guard_outcome);
    operationKind =
      row.operation_kind === null ? null : parseCanonical(OperationKindSchema, row.operation_kind);
    parseCanonical(EntityIdSchema, row.id);
    parseCanonical(Sha256Schema, row.idempotency_key);
    parseCanonical(IsoTimestampSchema, row.created_at);
    parseCanonical(IsoTimestampSchema, row.updated_at);
  } catch (cause) {
    throw corrupt(`Dispatch Operation ${row.id} scalar columns are invalid`, cause);
  }
  const origin = programOriginFromRow(row);
  let key: OperationDispatchKey;
  if (origin?.kind === 'tool_program') {
    key = programDispatchKeyFromRow(database, row, toolId, toolVersion);
  } else {
    let rawInput: unknown;
    try {
      rawInput = JSON.parse(row.input_v1_json) as unknown;
    } catch (cause) {
      throw corrupt(`Dispatch Operation ${row.id} input is not JSON`, cause);
    }
    key = resolveOperationDispatchKey(database, {
      runId: row.run_id,
      toolId,
      toolVersion,
      authorityWatermarkHash: row.authority_watermark_hash,
      input: rawInput,
    });
  }
  if (key.inputJson !== row.input_v1_json || key.inputHash !== row.input_hash) {
    throw corrupt(`Dispatch Operation ${row.id} input does not match`);
  }
  const mapped = operationKind !== null || row.owner_authority !== null || row.owner_id !== null;
  if (
    mapped &&
    (operationKind === null ||
      row.owner_authority === null ||
      row.owner_id === null ||
      OWNER_BY_KIND[operationKind] !== row.owner_authority)
  ) {
    throw corrupt(`Dispatch Operation ${row.id} owner mapping is invalid`);
  }
  if (mapped && guardOutcome !== 'allowed') {
    throw corrupt(`Dispatch Operation ${row.id} binds an owner without an allowed guard`);
  }
  assertConfirmation(database, row.confirmation_id, key, guardOutcome);
  assertProjectEvent(database, row.project_event_id, key.projectId);
  const expectedIdempotencyKey =
    origin?.kind === 'model'
      ? runtimeDispatchIdempotencyKey(key.fingerprint, origin.modelAttemptId, origin.providerCallId)
      : origin?.kind === 'tool_program'
        ? programRuntimeDispatchIdempotencyKey(
            key.fingerprint,
            origin.parentDispatchOperationId,
            origin.programStepId,
            origin.programCallIndex,
          )
        : key.fingerprint;
  if (row.idempotency_key !== expectedIdempotencyKey) {
    throw corrupt(`Dispatch Operation ${row.id} idempotency key does not match`);
  }
  if (origin?.kind === 'model') {
    const attempt = loadModelAttemptRecord(database, origin.modelAttemptId);
    const call = attempt.response?.events.find(
      (event) => event.type === 'tool_call' && event.providerCallId === origin.providerCallId,
    );
    if (
      attempt.runId !== key.runId ||
      attempt.state !== 'succeeded' ||
      call?.type !== 'tool_call' ||
      call.toolId !== key.toolId ||
      canonicalJson(call.canonicalArguments) !== key.inputJson
    ) {
      throw corrupt(`Dispatch Operation ${row.id} model origin does not match its tool call`);
    }
  }
  if (origin?.kind === 'tool_program') {
    assertProgramOriginBinding(database, row, key, origin);
  }
  const hasOutcome =
    row.outcome_v1_json !== null || row.outcome_hash !== null || row.completed_at !== null;
  if (
    hasOutcome &&
    (row.outcome_v1_json === null || row.outcome_hash === null || row.completed_at === null)
  ) {
    throw corrupt(`Dispatch Operation ${row.id} outcome is incomplete`);
  }
  let outcome: RuntimeLoopOutcome | null = null;
  if (row.outcome_v1_json !== null && row.outcome_hash !== null && row.completed_at !== null) {
    try {
      const rawOutcome = JSON.parse(row.outcome_v1_json) as unknown;
      const definition = executableDefinition(key.toolId, key.toolVersion);
      if (definition === undefined) {
        throw corrupt(`Dispatch Operation ${row.id} executable tool is unavailable`);
      }
      const parsedOutcome = definition.parseOutcome(rawOutcome);
      outcome = parseCanonical(RuntimeLoopOutcomeSchema, parsedOutcome);
      if (
        encodeCanonicalRecord(RuntimeLoopOutcomeSchema, outcome) !== row.outcome_v1_json ||
        hashCanonical(runtimeLoopOutcomeHashInput(outcome)) !== row.outcome_hash
      ) {
        throw corrupt(`Dispatch Operation ${row.id} outcome hash does not match`);
      }
      parseCanonical(IsoTimestampSchema, row.completed_at);
    } catch (cause) {
      if (cause instanceof TargetStorageError) throw cause;
      throw corrupt(`Dispatch Operation ${row.id} outcome is invalid`, cause);
    }
  }
  return Object.freeze({
    id: row.id,
    key,
    idempotencyKey: row.idempotency_key,
    guardOutcome,
    confirmationId: row.confirmation_id,
    operationKind,
    ownerAuthority: row.owner_authority,
    ownerId: row.owner_id,
    projectEventId: row.project_event_id,
    originModelAttemptId: row.origin_model_attempt_id,
    originProviderCallId: row.origin_provider_call_id,
    parentDispatchOperationId: row.parent_dispatch_operation_id,
    programStepId: row.program_step_id,
    programCallIndex: row.program_call_index,
    origin: origin ?? ({ kind: 'host' } as const),
    outcome,
    outcomeHash: row.outcome_hash,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

export function loadOperationDispatch(
  database: DatabaseSync,
  operationIdValue: string,
): OperationDispatchRecord {
  const operationId = parseCanonical(EntityIdSchema, operationIdValue);
  const row = database
    .prepare('SELECT * FROM dispatch_operations WHERE id = ?')
    .get(operationId) as unknown as DispatchRow | undefined;
  if (row === undefined) {
    throw new TargetStorageError('NOT_FOUND', `Operation was not found: ${operationId}`);
  }
  return dispatchFromRow(database, row);
}

export function listRuntimeDispatches(
  database: DatabaseSync,
  runIdValue: string,
  activationIdValue: string,
): OperationDispatchRecord[] {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const activationId = parseCanonical(EntityIdSchema, activationIdValue);
  return (
    database
      .prepare(
        `SELECT dispatch.*
         FROM dispatch_operations AS dispatch
         LEFT JOIN model_attempts AS attempt ON attempt.id = dispatch.origin_model_attempt_id
         WHERE dispatch.run_id = ?
           AND (attempt.activation_id = ? OR dispatch.parent_dispatch_operation_id IS NOT NULL)
         ORDER BY attempt.attempt_number, dispatch.rowid`,
      )
      .all(runId, activationId) as unknown as DispatchRow[]
  ).map((row) => dispatchFromRow(database, row));
}

export interface AllowedCommandDispatchInput {
  readonly dispatchOperationId: string;
  readonly projectId: string;
  readonly runId: string;
  readonly toolId: ToolId;
  readonly input: unknown;
}

export function loadAllowedCommandDispatch(
  database: DatabaseSync,
  input: AllowedCommandDispatchInput,
): OperationDispatchRecord {
  const dispatch = loadOperationDispatch(database, input.dispatchOperationId);
  const expected = resolveOperationDispatchKey(database, {
    runId: input.runId,
    toolId: input.toolId,
    authorityWatermarkHash: dispatch.key.authorityWatermarkHash,
    input: input.input,
  });
  if (
    dispatch.key.projectId !== input.projectId ||
    dispatch.key.runId !== input.runId ||
    dispatch.key.toolId !== input.toolId ||
    dispatch.key.toolVersion !== expected.toolVersion ||
    dispatch.key.inputHash !== expected.inputHash ||
    dispatch.key.inputJson !== expected.inputJson ||
    dispatch.key.fingerprint !== expected.fingerprint ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    dispatch.outcome !== null
  ) {
    throw invalid(`Dispatch ${dispatch.id} does not authorize this exact command`);
  }
  return dispatch;
}

export function findOperationByFingerprint(
  database: DatabaseSync,
  key: OperationDispatchKey,
  dispatchOperationId?: string,
): OperationDispatchRecord | undefined {
  let dispatch: OperationDispatchRecord | undefined;
  if (dispatchOperationId === undefined) {
    const row = database
      .prepare('SELECT * FROM dispatch_operations WHERE run_id = ? AND idempotency_key = ?')
      .get(key.runId, key.fingerprint) as unknown as DispatchRow | undefined;
    dispatch = row === undefined ? undefined : dispatchFromRow(database, row);
  } else {
    dispatch = loadOperationDispatch(database, dispatchOperationId);
  }
  if (dispatch === undefined) return undefined;
  if (
    dispatch.key.projectId !== key.projectId ||
    dispatch.key.runId !== key.runId ||
    dispatch.key.capabilityCatalogSnapshotId !== key.capabilityCatalogSnapshotId ||
    dispatch.key.toolId !== key.toolId ||
    dispatch.key.toolVersion !== key.toolVersion ||
    dispatch.key.authorityWatermarkHash !== key.authorityWatermarkHash ||
    dispatch.key.inputHash !== key.inputHash ||
    dispatch.key.inputJson !== key.inputJson ||
    dispatch.key.fingerprint !== key.fingerprint
  ) {
    throw new TargetStorageError(
      'IDEMPOTENCY_CONFLICT',
      `Operation fingerprint ${key.fingerprint} is bound to different semantics`,
    );
  }
  return dispatch;
}

export interface PrepareRuntimeDispatchInput {
  readonly modelAttemptId: string;
  readonly providerCallId: string;
  readonly authorityWatermarkHash: string | null;
  readonly occurredAt: string;
}

function prepareRuntimeDispatchInternal(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
  specialToolId:
    | 'agent.spawn'
    | 'agent.send'
    | 'agent.wait'
    | 'agent.result'
    | 'agent.cancel'
    | 'delivery.export'
    | 'delivery.freeze'
    | ProtectedMutationToolId
    | 'delivery.preview'
    | 'evaluation.run'
    | 'generation.submit'
    | 'interaction.ask'
    | 'media.attach'
    | 'media.derive'
    | 'media.link'
    | 'canvas.mutate'
    | 'operation.cancel'
    | 'task.manage'
    | 'tool.program'
    | null,
): OperationDispatchRecord {
  if (!database.isTransaction) throw invalid('Runtime dispatch preparation requires a transaction');
  const attempt = loadModelAttemptRecord(database, input.modelAttemptId);
  const providerCallId = parseCanonical(z.string().min(1).max(500), input.providerCallId);
  const authorityWatermarkHash =
    input.authorityWatermarkHash === null
      ? null
      : parseCanonical(Sha256Schema, input.authorityWatermarkHash);
  const occurredAt = parseCanonical(IsoTimestampSchema, input.occurredAt);
  const call = attempt.response?.events.find(
    (event) => event.type === 'tool_call' && event.providerCallId === providerCallId,
  );
  if (attempt.state !== 'succeeded' || call?.type !== 'tool_call') {
    throw invalid('Runtime dispatch requires one committed successful model tool call');
  }
  const isSpecial =
    call.toolId === 'agent.spawn' ||
    call.toolId === 'agent.send' ||
    call.toolId === 'agent.wait' ||
    call.toolId === 'agent.result' ||
    call.toolId === 'agent.cancel' ||
    call.toolId === 'delivery.export' ||
    call.toolId === 'delivery.freeze' ||
    isProtectedMutationTool(call.toolId) ||
    call.toolId === 'delivery.preview' ||
    call.toolId === 'evaluation.run' ||
    call.toolId === 'generation.submit' ||
    call.toolId === 'interaction.ask' ||
    call.toolId === 'media.attach' ||
    call.toolId === 'media.derive' ||
    call.toolId === 'media.link' ||
    call.toolId === 'canvas.mutate' ||
    call.toolId === 'operation.cancel' ||
    call.toolId === 'task.manage' ||
    call.toolId === 'tool.program';
  if (isSpecial && specialToolId !== call.toolId) {
    throw invalid(`${call.toolId} requires its dedicated durable settlement boundary`);
  }
  if (specialToolId !== null && call.toolId !== specialToolId) {
    throw invalid(`The dedicated ${specialToolId} dispatch accepts only ${specialToolId}`);
  }
  const key = resolveOperationDispatchKey(database, {
    runId: attempt.runId,
    toolId: call.toolId,
    authorityWatermarkHash,
    input: call.canonicalArguments,
  });
  const definition = executableDefinition(key.toolId, key.toolVersion);
  if (definition === undefined) {
    throw corrupt(`Runtime dispatch Tool ${key.toolId}@${key.toolVersion} is unavailable`);
  }
  const guardOutcome =
    definition.metadata.confirmation.mode === 'none'
      ? ('allowed' as const)
      : ('confirmation_required' as const);
  const existingRow = database
    .prepare(
      `SELECT * FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, providerCallId) as unknown as DispatchRow | undefined;
  if (existingRow !== undefined) {
    const existing = dispatchFromRow(database, existingRow);
    if (
      existing.originModelAttemptId !== attempt.id ||
      existing.originProviderCallId !== providerCallId ||
      existing.key.projectId !== key.projectId ||
      existing.key.runId !== key.runId ||
      existing.key.capabilityCatalogSnapshotId !== key.capabilityCatalogSnapshotId ||
      existing.key.toolId !== key.toolId ||
      existing.key.toolVersion !== key.toolVersion ||
      existing.key.authorityWatermarkHash !== key.authorityWatermarkHash ||
      existing.key.inputHash !== key.inputHash ||
      existing.key.inputJson !== key.inputJson ||
      existing.key.fingerprint !== key.fingerprint ||
      existing.guardOutcome !== guardOutcome
    ) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Model call ${attempt.id}/${providerCallId} is bound to different dispatch semantics`,
      );
    }
    return existing;
  }
  const idempotencyKey = runtimeDispatchIdempotencyKey(key.fingerprint, attempt.id, providerCallId);
  const id = parseCanonical(EntityIdSchema, environment.createId('dispatch_operation'));
  database
    .prepare(
      `INSERT INTO dispatch_operations (
         id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
         input_hash, input_v1_json, authority_watermark_hash,
         origin_model_attempt_id, origin_provider_call_id, confirmation_id,
         operation_kind, owner_authority, owner_id, project_event_id,
         outcome_v1_json, outcome_hash, completed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL,
                 NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      key.runId,
      key.toolId,
      key.toolVersion,
      guardOutcome,
      idempotencyKey,
      key.inputHash,
      key.inputJson,
      key.authorityWatermarkHash,
      attempt.id,
      providerCallId,
      occurredAt,
      occurredAt,
    );
  return loadOperationDispatch(database, id);
}

/** Generic runtime dispatches must never persist or execute special control tools. */
export function prepareRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, null);
}

/** Only the atomic agent.spawn model boundary may create this safe dispatch. */
export function prepareAgentSpawnRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'agent.spawn');
}

/** Only the atomic agent.send model boundary may create this safe dispatch. */
export function prepareAgentSendRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'agent.send');
}

/** Only the atomic agent.wait model boundary may create this safe dispatch. */
export function prepareAgentWaitRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'agent.wait');
}

/** Only the atomic agent.result model boundary may create this safe dispatch. */
export function prepareAgentResultRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'agent.result');
}

/** Only the atomic agent.cancel model boundary may create this safe dispatch. */
export function prepareAgentCancelRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'agent.cancel');
}

/** Only the atomic delivery.freeze model boundary may create this dispatch. */
export function prepareDeliveryFreezeRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'delivery.freeze');
}

/** Only the protected delivery.export model boundary may create this dispatch. */
export function prepareDeliveryExportRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'delivery.export');
}

/** Only the atomic protected-mutation model boundary may create these dispatches. */
export function prepareProtectedMutationRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  const attempt = loadModelAttemptRecord(database, input.modelAttemptId);
  const call = attempt.response?.events.find(
    (event) => event.type === 'tool_call' && event.providerCallId === input.providerCallId,
  );
  if (call?.type !== 'tool_call' || !isProtectedMutationTool(call.toolId)) {
    throw invalid('The protected mutation dispatch accepts only a protected mutation tool');
  }
  return prepareRuntimeDispatchInternal(database, environment, input, call.toolId);
}

/** Only the durable local delivery.preview model boundary may create this dispatch. */
export function prepareDeliveryPreviewRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'delivery.preview');
}

/** Only the durable evaluation.run model boundary may create this dispatch. */
export function prepareEvaluationRunRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'evaluation.run');
}

/** Only the durable generation.submit model boundary may create this dispatch. */
export function prepareGenerationSubmitRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'generation.submit');
}

/** Only the atomic interaction.ask model boundary may create this dispatch. */
export function prepareInteractionAskRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'interaction.ask');
}

/** Only the atomic media.attach model boundary may create this dispatch. */
export function prepareMediaAttachRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'media.attach');
}

/** Only the durable media.derive model boundary may create this dispatch. */
export function prepareMediaDeriveRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'media.derive');
}

/** Only the atomic media.link model boundary may create this dispatch. */
export function prepareMediaLinkRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'media.link');
}

/** Only the atomic canvas.mutate model boundary may create this dispatch. */
export function prepareCanvasMutateRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'canvas.mutate');
}

/** Only the atomic operation.cancel model boundary may create this dispatch. */
export function prepareOperationCancelRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'operation.cancel');
}

/** Only the atomic task.manage model boundary may create this safe dispatch. */
export function prepareTaskManageRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'task.manage');
}

/** Only the atomic tool.program model boundary may create this safe parent dispatch. */
export function prepareToolProgramRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareRuntimeDispatchInput,
): OperationDispatchRecord {
  return prepareRuntimeDispatchInternal(database, environment, input, 'tool.program');
}

export interface PrepareProgramRuntimeDispatchInput {
  readonly runId: string;
  readonly parentDispatchOperationId: string;
  readonly programStepId: string;
  readonly programCallIndex: number;
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly input: unknown;
  readonly authorityWatermarkHash: string | null;
  readonly occurredAt: string;
}

/**
 * Persists only the child input hash; the exact canonical input remains in the
 * encrypted Tool Program recovery envelope and is re-materialized by runtime.
 */
export function prepareProgramRuntimeDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: PrepareProgramRuntimeDispatchInput,
): OperationDispatchRecord {
  if (!database.isTransaction) throw invalid('Program dispatch preparation requires a transaction');
  const runId = parseCanonical(EntityIdSchema, input.runId);
  const parentDispatchOperationId = parseCanonical(EntityIdSchema, input.parentDispatchOperationId);
  const programStepId = parseCanonical(EntityIdSchema, input.programStepId);
  const programCallIndex = parseCanonical(z.number().int().nonnegative(), input.programCallIndex);
  const toolId = parseCanonical(ToolIdSchema, input.toolId);
  const toolVersion = parseCanonical(ToolVersionSchema, input.toolVersion);
  if (
    toolId === 'agent.spawn' ||
    toolId === 'agent.send' ||
    toolId === 'agent.wait' ||
    toolId === 'agent.result' ||
    toolId === 'agent.cancel' ||
    toolId === 'delivery.export' ||
    toolId === 'delivery.freeze' ||
    isProtectedMutationTool(toolId) ||
    toolId === 'delivery.preview' ||
    toolId === 'evaluation.run' ||
    toolId === 'generation.submit' ||
    toolId === 'interaction.ask' ||
    toolId === 'media.attach' ||
    toolId === 'media.derive' ||
    toolId === 'media.link' ||
    toolId === 'canvas.mutate' ||
    toolId === 'skill.propose' ||
    toolId === 'operation.cancel' ||
    toolId === 'task.manage' ||
    toolId === 'tool.program'
  ) {
    throw invalid(`Tool Program child tool ${toolId} is not eligible for program dispatch`);
  }
  const authorityWatermarkHash =
    input.authorityWatermarkHash === null
      ? null
      : parseCanonical(Sha256Schema, input.authorityWatermarkHash);
  const occurredAt = parseCanonical(IsoTimestampSchema, input.occurredAt);
  const definition = executableDefinition(toolId, toolVersion);
  if (definition === undefined) {
    throw invalid(`Tool Program child ${toolId}@${toolVersion} is not executable`);
  }
  let parsedInput: unknown;
  try {
    parsedInput = definition.parseInput(input.input);
  } catch (cause) {
    throw invalid(`Tool Program child ${toolId}@${toolVersion} input is invalid`, cause);
  }
  if (canonicalJson(parsedInput) !== canonicalJson(input.input)) {
    throw invalid(`Tool Program child ${toolId}@${toolVersion} input is not canonical`);
  }
  const key = resolveOperationDispatchKey(database, {
    runId,
    toolId,
    toolVersion,
    authorityWatermarkHash,
    input: parsedInput,
  });
  const parent = loadOperationDispatch(database, parentDispatchOperationId);
  const childRun = loadRun(database, runId);
  if (
    parent.key.toolId !== 'tool.program' ||
    parent.origin.kind !== 'model' ||
    childRun.parentRunId !== parent.key.runId ||
    childRun.acceptedSource.kind !== 'parent_direction'
  ) {
    throw invalid('Program dispatch parent/child Run lineage is invalid');
  }
  let program: z.output<typeof ToolProgramDurableInputSchema>;
  try {
    program = ToolProgramDurableInputSchema.parse(parent.key.input);
  } catch (cause) {
    throw invalid('Program dispatch parent safe input is invalid', cause);
  }
  const projection = program.calls.find(
    ({ stepId, callIndex }) => stepId === programStepId && callIndex === programCallIndex,
  );
  if (
    projection === undefined ||
    projection.toolId !== key.toolId ||
    projection.toolVersion !== key.toolVersion ||
    projection.inputHash !== key.inputHash ||
    childRun.acceptedSource.directionHash !== program.programHash
  ) {
    throw invalid('Program dispatch does not match its durable parent projection');
  }
  if (definition.metadata.confirmation.mode !== 'none') {
    throw invalid(`Tool Program child ${key.toolId} must not require confirmation`);
  }
  const existingRow = database
    .prepare(
      `SELECT * FROM dispatch_operations
       WHERE parent_dispatch_operation_id = ? AND program_step_id = ? AND program_call_index = ?`,
    )
    .get(parentDispatchOperationId, programStepId, programCallIndex) as DispatchRow | undefined;
  if (existingRow !== undefined) {
    const existing = dispatchFromRow(database, existingRow);
    if (
      existing.origin.kind !== 'tool_program' ||
      existing.origin.parentDispatchOperationId !== parentDispatchOperationId ||
      existing.origin.programStepId !== programStepId ||
      existing.origin.programCallIndex !== programCallIndex ||
      existing.key.projectId !== key.projectId ||
      existing.key.runId !== key.runId ||
      existing.key.capabilityCatalogSnapshotId !== key.capabilityCatalogSnapshotId ||
      existing.key.toolId !== key.toolId ||
      existing.key.toolVersion !== key.toolVersion ||
      existing.key.authorityWatermarkHash !== key.authorityWatermarkHash ||
      existing.key.inputHash !== key.inputHash ||
      existing.key.fingerprint !== key.fingerprint ||
      existing.guardOutcome !== 'allowed'
    ) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Tool Program call ${parentDispatchOperationId}/${programStepId}/${programCallIndex} changed semantics`,
      );
    }
    return existing;
  }
  const id = parseCanonical(EntityIdSchema, environment.createId('dispatch_operation'));
  const idempotencyKey = programRuntimeDispatchIdempotencyKey(
    key.fingerprint,
    parentDispatchOperationId,
    programStepId,
    programCallIndex,
  );
  const safeInput = parseCanonical(ProgramDispatchStoredInputSchema, { inputHash: key.inputHash });
  database
    .prepare(
      `INSERT INTO dispatch_operations (
         id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
         input_hash, input_v1_json, authority_watermark_hash,
         origin_model_attempt_id, origin_provider_call_id,
         parent_dispatch_operation_id, program_step_id, program_call_index,
         confirmation_id, operation_kind, owner_authority, owner_id, project_event_id,
         outcome_v1_json, outcome_hash, completed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'allowed', ?, ?, ?, ?, NULL, NULL, ?, ?, ?,
                 NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      id,
      key.runId,
      key.toolId,
      key.toolVersion,
      idempotencyKey,
      key.inputHash,
      canonicalJson(safeInput),
      key.authorityWatermarkHash,
      parentDispatchOperationId,
      programStepId,
      programCallIndex,
      occurredAt,
      occurredAt,
    );
  return loadOperationDispatch(database, id);
}

export interface BindRuntimeDispatchConfirmationInput {
  readonly dispatchOperationId: string;
  readonly confirmationId: string;
  readonly occurredAt: string;
}

export function bindRuntimeDispatchConfirmation(
  database: DatabaseSync,
  input: BindRuntimeDispatchConfirmationInput,
): OperationDispatchRecord {
  if (!database.isTransaction) {
    throw invalid('Runtime dispatch confirmation binding requires a transaction');
  }
  const dispatchOperationId = parseCanonical(EntityIdSchema, input.dispatchOperationId);
  const confirmationId = parseCanonical(EntityIdSchema, input.confirmationId);
  const occurredAt = parseCanonical(IsoTimestampSchema, input.occurredAt);
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  if (
    dispatch.origin.kind !== 'model' ||
    dispatch.guardOutcome !== 'confirmation_required' ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    dispatch.projectEventId !== null ||
    dispatch.outcome !== null
  ) {
    throw invalid(`Dispatch ${dispatch.id} cannot bind a Run Confirmation`);
  }
  const confirmation = loadRunConfirmationBinding(database, confirmationId, dispatch.key);
  assertConfirmationLifecycle(confirmation);
  if (confirmation.decision !== null) {
    throw invalid(`Run Confirmation ${confirmation.id} is already answered`);
  }
  const protectedMutationBinding =
    confirmation.target.kind === 'protected_mutation' &&
    confirmation.target.dispatch.operationId === dispatch.id &&
    confirmation.target.dispatch.toolId === dispatch.key.toolId &&
    confirmation.target.dispatch.toolVersion === dispatch.key.toolVersion &&
    confirmation.target.dispatch.inputHash === dispatch.key.inputHash &&
    confirmation.target.dispatch.fingerprint === dispatch.key.fingerprint &&
    confirmation.target.dispatch.authorityWatermarkHash === dispatch.key.authorityWatermarkHash;
  let deliveryExportBinding = false;
  if (
    dispatch.key.toolId === DeliveryExportDefinition.id &&
    confirmation.target.kind === 'domain_object'
  ) {
    let exportInput: ReturnType<typeof DeliveryExportDefinition.parseInput>;
    try {
      exportInput = DeliveryExportDefinition.parseInput(
        dispatch.key.input as Parameters<typeof DeliveryExportDefinition.parseInput>[0],
      );
    } catch (cause) {
      throw corrupt(`delivery.export Dispatch ${dispatch.id} input is invalid`, cause);
    }
    deliveryExportBinding =
      canonicalJson(confirmation.target.ref) === canonicalJson(exportInput.manifest);
  }
  if (!protectedMutationBinding && !deliveryExportBinding) {
    throw invalid(`Run Confirmation ${confirmation.id} does not bind exact Dispatch semantics`);
  }
  if (dispatch.confirmationId !== null) {
    if (dispatch.confirmationId !== confirmationId) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Dispatch ${dispatch.id} already binds another Run Confirmation`,
      );
    }
    return dispatch;
  }
  const update = database
    .prepare(
      `UPDATE dispatch_operations
       SET confirmation_id = ?, updated_at = ?
       WHERE id = ? AND guard_outcome = 'confirmation_required'
         AND confirmation_id IS NULL AND operation_kind IS NULL
         AND owner_authority IS NULL AND owner_id IS NULL AND project_event_id IS NULL
         AND outcome_v1_json IS NULL AND outcome_hash IS NULL AND completed_at IS NULL`,
    )
    .run(confirmationId, occurredAt, dispatch.id);
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Dispatch ${dispatch.id} confirmation binding changed`,
    );
  }
  return loadOperationDispatch(database, dispatch.id);
}

export interface TransitionRuntimeDispatchGuardInput {
  readonly dispatchOperationId: string;
  readonly outcome: 'allowed' | 'denied';
  readonly confirmationId: string | null;
  readonly occurredAt: string;
}

export function transitionRuntimeDispatchGuard(
  database: DatabaseSync,
  input: TransitionRuntimeDispatchGuardInput,
): OperationDispatchRecord {
  if (!database.isTransaction) {
    throw invalid('Runtime dispatch guard transition requires a transaction');
  }
  const dispatchOperationId = parseCanonical(EntityIdSchema, input.dispatchOperationId);
  const confirmationId =
    input.confirmationId === null ? null : parseCanonical(EntityIdSchema, input.confirmationId);
  const occurredAt = parseCanonical(IsoTimestampSchema, input.occurredAt);
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  if (
    dispatch.origin.kind !== 'model' ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    dispatch.projectEventId !== null ||
    dispatch.outcome !== null
  ) {
    throw invalid(`Dispatch ${dispatch.id} guard cannot transition`);
  }
  if (dispatch.guardOutcome === input.outcome) {
    if (dispatch.confirmationId !== confirmationId) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Dispatch ${dispatch.id} guard is bound to another Run Confirmation`,
      );
    }
    assertConfirmation(database, confirmationId, dispatch.key, input.outcome);
    return dispatch;
  }
  if (dispatch.guardOutcome !== 'confirmation_required') {
    throw invalid(`Dispatch ${dispatch.id} guard already resolved as ${dispatch.guardOutcome}`);
  }
  if (dispatch.confirmationId !== confirmationId) {
    throw invalid(`Dispatch ${dispatch.id} guard transition has the wrong Run Confirmation`);
  }
  if (input.outcome === 'denied' && confirmationId === null) {
    throw invalid('Denied Runtime dispatch requires its Run Confirmation');
  }
  assertConfirmation(database, confirmationId, dispatch.key, input.outcome);
  const update = database
    .prepare(
      `UPDATE dispatch_operations
       SET guard_outcome = ?, updated_at = ?
       WHERE id = ? AND guard_outcome = 'confirmation_required'
         AND confirmation_id IS ? AND operation_kind IS NULL
         AND owner_authority IS NULL AND owner_id IS NULL AND project_event_id IS NULL
         AND outcome_v1_json IS NULL AND outcome_hash IS NULL AND completed_at IS NULL`,
    )
    .run(input.outcome, occurredAt, dispatch.id, confirmationId);
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError('REVISION_CONFLICT', `Dispatch ${dispatch.id} guard changed`);
  }
  return loadOperationDispatch(database, dispatch.id);
}

export interface BindRuntimeDispatchProjectEventInput {
  readonly dispatchOperationId: string;
  readonly projectEventId: string | null;
  readonly occurredAt: string;
}

export function bindRuntimeDispatchProjectEvent(
  database: DatabaseSync,
  input: BindRuntimeDispatchProjectEventInput,
): OperationDispatchRecord {
  if (!database.isTransaction) {
    throw invalid('Runtime dispatch ProjectEvent binding requires a transaction');
  }
  const dispatchOperationId = parseCanonical(EntityIdSchema, input.dispatchOperationId);
  const projectEventId =
    input.projectEventId === null ? null : parseCanonical(EntityIdSchema, input.projectEventId);
  const occurredAt = parseCanonical(IsoTimestampSchema, input.occurredAt);
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  if (
    dispatch.origin.kind !== 'model' ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    dispatch.outcome !== null
  ) {
    throw invalid(`Dispatch ${dispatch.id} cannot bind a ProjectEvent`);
  }
  if (projectEventId === null) {
    if (dispatch.projectEventId !== null) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Dispatch ${dispatch.id} already binds a ProjectEvent`,
      );
    }
    return dispatch;
  }
  assertProjectEvent(database, projectEventId, dispatch.key.projectId);
  if (dispatch.projectEventId !== null) {
    if (dispatch.projectEventId !== projectEventId) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Dispatch ${dispatch.id} already binds another ProjectEvent`,
      );
    }
    return dispatch;
  }
  const update = database
    .prepare(
      `UPDATE dispatch_operations
       SET project_event_id = ?, updated_at = ?
       WHERE id = ? AND guard_outcome = 'allowed' AND project_event_id IS NULL
         AND operation_kind IS NULL AND owner_authority IS NULL AND owner_id IS NULL
         AND outcome_v1_json IS NULL AND outcome_hash IS NULL AND completed_at IS NULL`,
    )
    .run(projectEventId, occurredAt, dispatch.id);
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError(
      'REVISION_CONFLICT',
      `Dispatch ${dispatch.id} ProjectEvent binding changed`,
    );
  }
  return loadOperationDispatch(database, dispatch.id);
}

export interface SettleRuntimeDispatchInput {
  readonly dispatchOperationId: string;
  readonly outcome: RuntimeLoopOutcome;
  readonly occurredAt: string;
}

export function settleValidatedRuntimeDispatch(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
  input: SettleRuntimeDispatchInput,
): OperationDispatchRecord {
  if (!database.isTransaction) throw invalid('Runtime dispatch settlement requires a transaction');
  if (dispatch.id !== input.dispatchOperationId) {
    throw invalid('Validated Runtime dispatch identity changed');
  }
  if (dispatch.origin.kind !== 'model' && dispatch.origin.kind !== 'tool_program') {
    throw invalid(`Dispatch ${dispatch.id} has no runtime origin`);
  }
  let outcome: RuntimeLoopOutcome;
  try {
    outcome = parseCanonical(
      RuntimeLoopOutcomeSchema,
      (() => {
        const definition = executableDefinition(dispatch.key.toolId, dispatch.key.toolVersion);
        if (definition === undefined) {
          throw invalid(
            `Dispatch ${dispatch.id} executable tool ${dispatch.key.toolId}@${dispatch.key.toolVersion} is unavailable`,
          );
        }
        return definition.parseOutcome(input.outcome);
      })(),
    );
  } catch (cause) {
    throw invalid(`Dispatch ${dispatch.id} outcome is invalid`, cause);
  }
  if (dispatch.guardOutcome !== 'allowed' && outcome.status === 'succeeded') {
    throw invalid(`Dispatch ${dispatch.id} cannot succeed before its guard is allowed`);
  }
  const outcomeHash = hashCanonical(runtimeLoopOutcomeHashInput(outcome));
  const occurredAt = parseCanonical(IsoTimestampSchema, input.occurredAt);
  if (dispatch.outcome !== null) {
    if (
      dispatch.outcomeHash !== outcomeHash ||
      canonicalJson(dispatch.outcome) !== canonicalJson(outcome)
    ) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Dispatch ${dispatch.id} was settled differently`,
      );
    }
    return dispatch;
  }
  const update = database
    .prepare(
      `UPDATE dispatch_operations
       SET outcome_v1_json = ?, outcome_hash = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND outcome_v1_json IS NULL AND outcome_hash IS NULL AND completed_at IS NULL`,
    )
    .run(
      encodeCanonicalRecord(RuntimeLoopOutcomeSchema, outcome),
      outcomeHash,
      occurredAt,
      occurredAt,
      dispatch.id,
    );
  if (Number(update.changes) !== 1) {
    throw new TargetStorageError('REVISION_CONFLICT', `Dispatch ${dispatch.id} changed`);
  }
  return Object.freeze({
    ...dispatch,
    outcome,
    outcomeHash,
    completedAt: occurredAt,
    updatedAt: occurredAt,
  });
}

export function settleRuntimeDispatch(
  database: DatabaseSync,
  input: SettleRuntimeDispatchInput,
): OperationDispatchRecord {
  if (!database.isTransaction) throw invalid('Runtime dispatch settlement requires a transaction');
  return settleValidatedRuntimeDispatch(
    database,
    loadOperationDispatch(database, input.dispatchOperationId),
    input,
  );
}

export function loadBoundOperation(
  database: DatabaseSync,
  operationId: string,
): BoundOperationRecord {
  const dispatch = loadOperationDispatch(database, operationId);
  if (
    dispatch.operationKind === null ||
    dispatch.ownerAuthority === null ||
    dispatch.ownerId === null
  ) {
    throw new TargetStorageError('NOT_FOUND', `Dispatch ${dispatch.id} is not an Operation`);
  }
  let owner: OperationOwnerRecord;
  try {
    owner = loadOperationOwnerRecord(database, dispatch.ownerAuthority, dispatch.ownerId);
  } catch (cause) {
    if (cause instanceof TargetStorageError && cause.code === 'NOT_FOUND') {
      throw corrupt(`Operation ${dispatch.id} owner was not found`, cause);
    }
    throw cause;
  }
  if (owner.projectId !== dispatch.key.projectId || owner.runId !== dispatch.key.runId) {
    throw corrupt(`Operation ${dispatch.id} owner belongs to another Project or Run`);
  }
  return {
    dispatch: dispatch as BoundOperationRecord['dispatch'],
    owner,
  };
}

export function assertOperationRefIdentity(
  operation: BoundOperationRecord,
  ref: OperationRef,
): void {
  if (
    ref.id !== operation.dispatch.id ||
    ref.kind !== operation.dispatch.operationKind ||
    ref.ownerRef.authority !== operation.dispatch.ownerAuthority ||
    ref.ownerRef.id !== operation.dispatch.ownerId
  ) {
    throw invalid(`Operation ref ${ref.id} does not match its immutable owner mapping`);
  }
}

export interface OperationOwnerTransition {
  readonly dispatch: BoundOperationRecord['dispatch'];
  readonly before: OperationOwnerRecord | null;
  readonly after: OperationOwnerRecord;
}

export interface PreparedOperationOwnerTransitionBatch {
  readonly run: Run;
  readonly eventDrafts: AppendRunEventBatchInput['events'];
  readonly operations: readonly OperationPublicView[];
}

export function prepareOperationOwnerTransitions(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  transitions: readonly OperationOwnerTransition[],
  occurredAtValue: string,
  contextValue: TargetCommandContext,
): PreparedOperationOwnerTransitionBatch {
  if (!database.isTransaction) {
    throw invalid('Operation transition recording requires a transaction');
  }
  if (transitions.length === 0) throw invalid('Operation transition batch cannot be empty');
  const occurredAt = parseCanonical(IsoTimestampSchema, occurredAtValue);
  const context = parseCanonical(TargetCommandContextSchema, contextValue);
  const first = transitions[0]!;
  const run = loadRun(database, first.dispatch.key.runId);
  if (run.projectId !== first.dispatch.key.projectId) {
    throw corrupt(`Run ${run.id} does not match Operation Project`);
  }
  for (const transition of transitions) {
    if (
      transition.dispatch.key.runId !== run.id ||
      transition.dispatch.key.projectId !== run.projectId ||
      transition.dispatch.ownerAuthority !== transition.after.authority ||
      transition.dispatch.ownerId !== transition.after.view.id ||
      transition.after.runId !== run.id ||
      transition.after.projectId !== run.projectId
    ) {
      throw invalid('Operation transition batch contains a different Project, Run, or owner');
    }
    if (
      transition.before === null
        ? transition.after.view.revision !== 0 || transition.after.view.cancelRequested
        : transition.before.authority !== transition.after.authority ||
          transition.before.view.id !== transition.after.view.id ||
          transition.before.view.revision + 1 !== transition.after.view.revision
    ) {
      throw invalid(`Operation ${transition.dispatch.id} transition boundary is invalid`);
    }
  }
  const eventDrafts = transitions.map((transition) => ({
    eventId: environment.createId('run_event'),
    visibility: 'public' as const,
    occurredAt,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
    payload: {
      type: 'operation_state_changed' as const,
      operation: operationRefForOwner(transition.dispatch.id, transition.after),
      previousRevision: transition.before?.view.revision ?? null,
      previousState: transition.before?.view.state ?? null,
      previousCancelRequested: transition.before?.view.cancelRequested ?? null,
      state: transition.after.view.state,
      cancelRequested: transition.after.view.cancelRequested,
      publicErrorCode: transition.after.view.publicErrorCode,
    },
  }));
  for (const transition of transitions) {
    const update = database
      .prepare('UPDATE dispatch_operations SET updated_at = ? WHERE id = ? AND run_id = ?')
      .run(occurredAt, transition.dispatch.id, run.id);
    if (Number(update.changes) !== 1) {
      throw corrupt(`Operation ${transition.dispatch.id} dispatch mapping disappeared`);
    }
  }
  return {
    run,
    eventDrafts,
    operations: transitions.map((transition) =>
      operationPublicViewForOwner(
        database,
        transition.dispatch.id,
        transition.after,
        transition.dispatch.key.input,
      ),
    ),
  };
}

export function commitOperationOwnerTransitions(
  database: DatabaseSync,
  prepared: PreparedOperationOwnerTransitionBatch,
  commandId: string,
) {
  if (!database.isTransaction) {
    throw invalid('Operation transition commit requires a transaction');
  }
  const events = appendRunEventBatch(database, {
    runId: prepared.run.id,
    commandId: parseCanonical(EntityIdSchema, commandId),
    events: prepared.eventDrafts,
  });
  const head = events.at(-1);
  if (head === undefined) throw corrupt('Operation transition event batch is empty');
  const updatedRun = advanceRunJournalHead(database, prepared.run, {
    eventId: head.eventId,
    sequence: head.sequence,
    eventHash: head.eventHash,
  });
  return {
    run: updatedRun,
    events,
    operations: prepared.operations,
  };
}

export function recordOperationOwnerTransitions(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  transitions: readonly OperationOwnerTransition[],
  commandId: string,
  occurredAtValue: string,
  contextValue: TargetCommandContext,
) {
  return commitOperationOwnerTransitions(
    database,
    prepareOperationOwnerTransitions(
      database,
      environment,
      transitions,
      occurredAtValue,
      contextValue,
    ),
    commandId,
  );
}

export interface RegisterOperationDispatchInput {
  readonly key: OperationDispatchKey;
  readonly existingDispatchOperationId?: string;
  readonly operationKind: OperationKind;
  readonly ownerAuthority: OperationOwnerAuthority;
  readonly ownerId: string;
  readonly confirmationId: string | null;
  readonly projectEventId: string | null;
  readonly commandId: string;
  readonly occurredAt: string;
}

export function registerOperationDispatch(
  database: DatabaseSync,
  environment: TargetStorageEnvironment,
  input: RegisterOperationDispatchInput,
  context: TargetCommandContext,
): BoundOperationRecord {
  if (!database.isTransaction) throw invalid('Operation registration requires a transaction');
  if (OWNER_BY_KIND[input.operationKind] !== input.ownerAuthority) {
    throw invalid('Operation kind and owner authority do not match');
  }
  const existing = findOperationByFingerprint(
    database,
    input.key,
    input.existingDispatchOperationId,
  );
  if (existing !== undefined) {
    const bindingDiffers =
      existing.operationKind !== input.operationKind ||
      existing.ownerAuthority !== input.ownerAuthority ||
      existing.ownerId !== input.ownerId ||
      existing.confirmationId !== input.confirmationId ||
      existing.projectEventId !== input.projectEventId;
    if (!bindingDiffers) return loadBoundOperation(database, existing.id);
    const unbound =
      existing.guardOutcome === 'allowed' &&
      existing.operationKind === null &&
      existing.ownerAuthority === null &&
      existing.ownerId === null &&
      existing.confirmationId === input.confirmationId &&
      existing.projectEventId === null &&
      existing.outcome === null;
    if (!unbound) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Operation fingerprint ${input.key.fingerprint} is already bound differently`,
      );
    }
    assertConfirmation(database, input.confirmationId, input.key, 'allowed');
    assertProjectEvent(database, input.projectEventId, input.key.projectId);
    const owner = loadOperationOwnerRecord(database, input.ownerAuthority, input.ownerId);
    if (owner.projectId !== input.key.projectId || owner.runId !== input.key.runId) {
      throw invalid('Operation owner belongs to another Project or Run');
    }
    if (owner.view.revision !== 0 || owner.view.cancelRequested) {
      throw invalid('A new Operation must bind an uncancelled revision-zero owner');
    }
    const update = database
      .prepare(
        `UPDATE dispatch_operations
         SET operation_kind = ?, owner_authority = ?, owner_id = ?, project_event_id = ?, updated_at = ?
         WHERE id = ? AND run_id = ? AND guard_outcome = 'allowed'
           AND operation_kind IS NULL AND owner_authority IS NULL AND owner_id IS NULL
           AND confirmation_id IS ? AND project_event_id IS NULL`,
      )
      .run(
        input.operationKind,
        input.ownerAuthority,
        input.ownerId,
        input.projectEventId,
        input.occurredAt,
        existing.id,
        input.key.runId,
        input.confirmationId,
      );
    if (Number(update.changes) !== 1) {
      throw new TargetStorageError(
        'IDEMPOTENCY_CONFLICT',
        `Operation fingerprint ${input.key.fingerprint} owner binding changed concurrently`,
      );
    }
    const dispatch = loadOperationDispatch(
      database,
      existing.id,
    ) as BoundOperationRecord['dispatch'];
    recordOperationOwnerTransitions(
      database,
      environment,
      [{ dispatch, before: null, after: owner }],
      input.commandId,
      input.occurredAt,
      context,
    );
    return loadBoundOperation(database, existing.id);
  }
  assertConfirmation(database, input.confirmationId, input.key, 'allowed');
  assertProjectEvent(database, input.projectEventId, input.key.projectId);
  const owner = loadOperationOwnerRecord(database, input.ownerAuthority, input.ownerId);
  if (owner.projectId !== input.key.projectId || owner.runId !== input.key.runId) {
    throw invalid('Operation owner belongs to another Project or Run');
  }
  if (owner.view.revision !== 0 || owner.view.cancelRequested) {
    throw invalid('A new Operation must bind an uncancelled revision-zero owner');
  }
  const id = environment.createId('dispatch_operation');
  const occurredAt = parseCanonical(IsoTimestampSchema, input.occurredAt);
  database
    .prepare(
      `INSERT INTO dispatch_operations (
         id, run_id, tool_id, tool_version, guard_outcome, idempotency_key,
         input_hash, input_v1_json, authority_watermark_hash, confirmation_id, operation_kind,
         owner_authority, owner_id, project_event_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'allowed', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.key.runId,
      input.key.toolId,
      input.key.toolVersion,
      input.key.fingerprint,
      input.key.inputHash,
      input.key.inputJson,
      input.key.authorityWatermarkHash,
      input.confirmationId,
      input.operationKind,
      input.ownerAuthority,
      input.ownerId,
      input.projectEventId,
      occurredAt,
      occurredAt,
    );
  const dispatch = loadOperationDispatch(database, id) as BoundOperationRecord['dispatch'];
  recordOperationOwnerTransitions(
    database,
    environment,
    [{ dispatch, before: null, after: owner }],
    input.commandId,
    occurredAt,
    context,
  );
  return loadBoundOperation(database, id);
}
