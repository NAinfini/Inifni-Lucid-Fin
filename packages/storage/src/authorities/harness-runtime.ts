import {
  AgentCancelDefinition,
  AgentResultDefinition,
  AgentSendDefinition,
  AgentSendDurableInputSchema,
  AgentSpawnDefinition,
  AgentSpawnDurableInputSchema,
  AgentWaitDefinition,
  ArtifactRefSchema,
  AttemptTerminalStateSchema,
  CanonicalModelFactV1Schema,
  CanonicalModelRequestV1Schema,
  CanonicalModelResponseV1Schema,
  CanvasMutateDefinition,
  ConfirmationTargetSchema,
  DeliveryExportDefinition,
  DeliveryFreezeDefinition,
  DeliveryPreviewDefinition,
  EntityIdSchema,
  EvaluationRunDefinition,
  EventHeadSchema,
  DurableCanonicalModelResponseV1Schema,
  DomainObjectRefSchema,
  IsoTimestampSchema,
  InteractionAskDefinition,
  GenerationSubmitDefinition,
  MediaAttachDefinition,
  MediaDeriveDefinition,
  MediaLinkDefinition,
  MINIMAL_SYSTEM_PROMPT_VERSION,
  ModelResourceQuoteV1Schema,
  OperationCancelDefinition,
  RevisionSchema,
  ReviewCutAttemptSchema,
  RunInboxMessageSchema,
  RunSchema,
  RunTerminalStateSchema,
  RuntimeLoopOutcomeSchema,
  Sha256Schema,
  SkillProposeDefinition,
  TaskManageDefinition,
  ToolProgramDefinition,
  ToolProgramDurableInputSchema,
  ToolIdSchema,
  assertRunStateTransition,
  canonicalJson,
  executableToolDefinition,
  skillIndexFromSkills,
  canonicalModelRequestHashInput,
  parseCanonical,
  strictObject,
  type CapabilityCatalogSnapshotV1,
  type CanonicalModelFactV1,
  type CanonicalModelRequestV1,
  type CanonicalModelResponseV1,
  type DurableCanonicalModelResponseV1,
  type CountAmount,
  type ContextManifest,
  type ModelAttemptRecordV1,
  type ModelResourceQuoteV1,
  type ResourceAmount,
  type Run,
  type RunActivation,
  type RunEvent,
  type RunInboxMessage,
  type RuntimeLoopOutcome,
  type TaskList,
  type ToolId,
  z,
} from '@lucid-fin/contracts';
import type { DatabaseSync } from 'node:sqlite';
import {
  assertCompactionJournalProjection,
  loadCompactionTransactions,
  loadCompactionViews,
  type CompactionViewRecord,
} from '../internal/compaction-records.js';
import { CommandContextSchema, type CommandContext } from '../internal/command.js';
import { appendMessageInTransaction, loadMessage } from '../internal/conversation-write.js';
import { loadCanvasDocument } from '../internal/canvas-records.js';
import { getStoreDatabase } from '../internal/database-access.js';
import type { StorageEnvironment } from '../internal/environment.js';
import {
  addExactDecimals,
  compareExactDecimals,
  formatExactDecimal,
  parseExactDecimal,
  subtractExactDecimals,
} from '../internal/exact-decimal.js';
import { hashCanonical, hashContentObject, hashUtf8 } from '../internal/hashes.js';
import {
  insertPreparedModelAttempt,
  listModelAttemptRecords,
  loadModelAttemptRecord,
  markModelAttemptRecordRunning,
  settleModelAttemptRecord,
} from '../internal/model-attempt-records.js';
import {
  delegateChildRunInTransaction,
  delegateToolProgramChildRunInTransaction,
  type ChildDelegationResult,
  type ToolProgramChildDelegationCommit,
} from '../internal/child-run-delegation.js';
import {
  listRuntimeDispatches,
  loadBoundOperation,
  loadOperationDispatch,
  prepareAgentCancelRuntimeDispatch,
  prepareAgentSendRuntimeDispatch,
  prepareAgentResultRuntimeDispatch,
  prepareAgentSpawnRuntimeDispatch,
  prepareAgentWaitRuntimeDispatch,
  prepareCanvasMutateRuntimeDispatch,
  prepareDeliveryExportRuntimeDispatch,
  prepareDeliveryFreezeRuntimeDispatch,
  prepareProtectedMutationRuntimeDispatch,
  prepareDeliveryPreviewRuntimeDispatch,
  prepareEvaluationRunRuntimeDispatch,
  prepareGenerationSubmitRuntimeDispatch,
  prepareInteractionAskRuntimeDispatch,
  prepareMediaAttachRuntimeDispatch,
  prepareMediaDeriveRuntimeDispatch,
  prepareMediaLinkRuntimeDispatch,
  prepareOperationCancelRuntimeDispatch,
  prepareProgramRuntimeDispatch,
  prepareRuntimeDispatch,
  prepareTaskManageRuntimeDispatch,
  prepareToolProgramRuntimeDispatch,
  bindRuntimeDispatchConfirmation,
  bindRuntimeDispatchProjectEvent,
  settleRuntimeDispatch,
  settleValidatedRuntimeDispatch,
  transitionRuntimeDispatchGuard,
  type OperationDispatchRecord,
} from '../internal/operation-dispatch.js';
import {
  closeRunActivation,
  loadActiveRunActivation,
  loadRunActivation,
  loadRunActivations,
} from '../internal/run-activation-records.js';
import { loadRunBudgetExposure, type RunBudgetExposure } from '../internal/run-budget.js';
import {
  insertRunInboxMessage,
  listRunInbox,
  nextRunInboxSequence,
} from '../internal/run-inbox.js';
import {
  appendRunEventBatch,
  loadPublicRunEventForCommand,
  loadRunEventForCommand,
  loadRunEvents,
  type AppendRunEventBatchInput,
} from '../internal/run-journal.js';
import {
  advanceRunJournalAndPrivateRecoveryHead,
  advanceRunJournalHead,
  loadRun,
} from '../internal/run-records.js';
import {
  appendRunResourceEntry,
  loadRunResourceEntries,
  type RunResourceAmount,
  type RunResourceEntry,
  type RunResourceKind,
} from '../internal/run-resource-ledger.js';
import {
  loadDeliveryManifest,
  loadOperationOwnerRecord,
  operationPublicViewForOwner,
} from '../internal/operation-owner-records.js';
import { loadRunSnapshots } from '../internal/run-snapshots.js';
import { resolveRunMediaSource } from '../internal/media-source.js';
import { findProjectMediaRecordByAsset } from '../internal/media-records.js';
import { finalizeTaskList, loadTaskList, replaceTaskList } from '../internal/task-list-records.js';
import {
  PROCESS_INTERRUPTION_SUMMARY,
  acceptCrashRetryRootRun,
  assertSelectedContext,
} from '../internal/root-run-acceptance.js';
import {
  controlRunSubtreeInTransaction,
  countUnknownRunControlOperations,
  listRunControlSubtree,
} from '../internal/run-control.js';
import { StorageError } from '../kernel/errors.js';
import { requireCurrentDomainObject } from '../internal/domain-object-resolver.js';
import type { PrivateRecoveryCodec } from '../kernel/private-recovery-codec.js';
import type { Store } from '../kernel/store.js';
import { withImmediateTransaction } from '../kernel/transaction.js';
import {
  appendAgentSendRecovery,
  materializePrivateModelContext as materializePrivateModelContextForRun,
  materializePrivateRunContext as materializePrivateRunContextForRun,
  materializePrivateToolProgramContext,
  durableToolProgramInput,
  type PrivateModelContext,
  type PrivateRunContext,
  type ToolProgramPrivateRunContext,
} from '../internal/private-recovery.js';
import {
  terminalizeRunInTransaction,
  type InboxTransitionInput,
  type RunsAuthority,
} from './runs.js';
import { getProject, getSettings } from './projects.js';
import { cancelOperationsInTransaction } from './operations.js';
import { manageTaskListInTransaction } from './task-lists.js';
import { attachProjectMediaInTransaction, linkProjectMediaInTransaction } from './project-media.js';
import {
  canvasMutationToolSuccess,
  commitPlannedCanvasMutationInTransaction,
  planCanvasMutationInTransaction,
  plannedCanvasMutationIds,
} from './canvas.js';
import { deliveryFreezeCommandId, freezeDeliveryInTransaction } from './delivery.js';
import {
  assertProtectedMutationPendingBinding,
  assertProtectedMutationTargetBinding,
  commitPlannedProtectedMutationInTransaction,
  isProtectedMutationTool,
  parseProtectedMutationInput,
  planProtectedMutationInTransaction,
  protectedMutationCatalogTool,
  protectedMutationConfirmationTargetForPlan,
  protectedMutationInputFromDispatch,
  protectedMutationOutcome,
  protectedMutationProjectEventId,
  protectedMutationRequiresConfirmation,
  protectedMutationSuccessFromDispatch,
  type PlannedProtectedMutation,
  type ProtectedMutationInput,
  type ProtectedMutationSuccess,
} from '../internal/protected-mutations.js';
import {
  assertDeliveryExportModelBoundary,
  deliveryExportConfirmationTargetFor,
  deliveryExportSuccessForDispatch,
  prepareReviewCutInTransaction,
} from './delivery-operations.js';
import {
  assertGenerationSubmitModelBoundary,
  generationSubmissionSuccessForDispatch,
} from './generation.js';
import {
  assertMediaDeriveModelBoundary,
  mediaDeriveSuccessForDispatch,
} from './media-derivations.js';
import {
  assertEvaluationRunModelBoundary,
  resultAssessmentSuccessForDispatch,
} from './result-assessments.js';

const PrepareModelAttemptInputSchema = strictObject({
  request: CanonicalModelRequestV1Schema,
  quote: ModelResourceQuoteV1Schema,
  commandId: EntityIdSchema,
});
const MarkModelAttemptRunningInputSchema = strictObject({
  attemptId: EntityIdSchema,
  requestHash: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/),
  commandId: EntityIdSchema,
});
const SettleModelAttemptInputSchema = strictObject({
  attemptId: EntityIdSchema,
  requestHash: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/),
  response: CanonicalModelResponseV1Schema,
  settledAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const SettleAtomicModelToolBoundaryInputSchema = strictObject({
  attemptId: EntityIdSchema,
  requestHash: Sha256Schema,
  response: CanonicalModelResponseV1Schema,
  providerCallId: z.string().min(1).max(500),
  activationNumber: z.number().int().positive(),
  turnNumber: z.number().int().positive(),
  stepNumber: z.number().int().positive(),
  settledAt: IsoTimestampSchema,
});
const SettleAgentSpawnBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleAgentSendBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleAgentWaitStartBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleAgentResultBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleAgentCancelBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleInteractionAskBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleDeliveryExportStartBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleDeliveryFreezeBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleDeliveryPreviewStartBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleEvaluationRunStartBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleGenerationSubmitStartBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleMediaDeriveStartBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleMediaAttachBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleMediaLinkBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleCanvasMutateBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleOperationCancelBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleTaskManageBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleToolProgramBoundaryInputSchema = SettleAtomicModelToolBoundaryInputSchema;
const SettleAgentWaitBoundaryInputSchema = strictObject({
  dispatchOperationId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const SettleDeliveryPreviewBoundaryInputSchema = strictObject({
  dispatchOperationId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  result: DeliveryPreviewDefinition.successSchema,
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const SettleDeliveryExportBoundaryInputSchema = strictObject({
  dispatchOperationId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  result: DeliveryExportDefinition.successSchema,
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const SettleEvaluationRunBoundaryInputSchema = strictObject({
  dispatchOperationId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  result: EvaluationRunDefinition.successSchema,
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const SettleGenerationSubmitBoundaryInputSchema = strictObject({
  dispatchOperationId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  result: GenerationSubmitDefinition.successSchema,
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const SettleMediaDeriveBoundaryInputSchema = strictObject({
  dispatchOperationId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  result: MediaDeriveDefinition.successSchema,
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const AdvanceToolProgramChildInputSchema = strictObject({
  runId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  commandId: EntityIdSchema,
});
const SettleToolProgramChildCallInputSchema = strictObject({
  dispatchOperationId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  turnNumber: z.number().int().positive(),
  stepNumber: z.number().int().positive(),
  outcome: z.unknown(),
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const SettleToolProgramParentInputSchema = strictObject({
  parentDispatchOperationId: EntityIdSchema,
  activationNumber: z.number().int().positive(),
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const PrepareDispatchInputSchema = strictObject({
  runId: EntityIdSchema,
  modelAttemptId: EntityIdSchema,
  providerCallId: z.string().min(1).max(500),
  toolId: ToolIdSchema,
  input: z.unknown(),
  authorityWatermarkHash: z
    .string()
    .length(64)
    .regex(/^[0-9a-f]+$/)
    .nullable(),
  activationNumber: z.number().int().positive(),
  turnNumber: z.number().int().positive(),
  stepNumber: z.number().int().positive(),
  commandId: EntityIdSchema,
});
const PrepareSkillProposalInputSchema = strictObject({
  runId: EntityIdSchema,
  modelAttemptId: EntityIdSchema,
  providerCallId: z.string().min(1).max(500),
  input: SkillProposeDefinition.inputSchema,
  activationNumber: z.number().int().positive(),
  turnNumber: z.number().int().positive(),
  stepNumber: z.number().int().positive(),
  commandId: EntityIdSchema,
});
const PrepareProtectedMutationBoundaryInputSchema = strictObject({
  runId: EntityIdSchema,
  modelAttemptId: EntityIdSchema,
  providerCallId: z.string().min(1).max(500),
  input: z.unknown(),
  activationNumber: z.number().int().positive(),
  turnNumber: z.number().int().positive(),
  stepNumber: z.number().int().positive(),
  commandId: EntityIdSchema,
});
const SettleDispatchInputSchema = strictObject({
  dispatchOperationId: EntityIdSchema,
  modelAttemptId: EntityIdSchema,
  providerCallId: z.string().min(1).max(500),
  outcome: z.unknown(),
  activationNumber: z.number().int().positive(),
  turnNumber: z.number().int().positive(),
  stepNumber: z.number().int().positive(),
  completedAt: IsoTimestampSchema,
  commandId: EntityIdSchema,
});
const CloseInterruptedActivationInputSchema = strictObject({
  runId: EntityIdSchema,
  activationNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expectedRunRevision: RevisionSchema,
  expectedRunContentHash: Sha256Schema,
  expectedPublicEventHead: EventHeadSchema,
  commandId: EntityIdSchema,
});
const AcceptCrashRetryRunInputSchema = strictObject({
  sourceRunId: EntityIdSchema,
  expectedSourceRevision: RevisionSchema,
  expectedSourceContentHash: Sha256Schema,
  expectedSourceEventHead: EventHeadSchema,
  commandId: EntityIdSchema,
});
const RecoveryFrontierSchema = z.union([
  strictObject({
    kind: z.literal('model_attempt'),
    attemptId: EntityIdSchema,
    state: z.enum(['prepared', 'running', 'submitted', 'unknown']),
  }),
  strictObject({
    kind: z.literal('dispatch'),
    dispatchOperationId: EntityIdSchema,
    toolId: ToolIdSchema,
  }),
]);

export type PrepareModelAttemptInput = z.output<typeof PrepareModelAttemptInputSchema>;
export type MarkModelAttemptRunningInput = z.output<typeof MarkModelAttemptRunningInputSchema>;
export type SettleModelAttemptInput = z.output<typeof SettleModelAttemptInputSchema>;
export type SettleAgentSpawnBoundaryInput = z.output<typeof SettleAgentSpawnBoundaryInputSchema>;
export type SettleAgentSendBoundaryInput = z.output<typeof SettleAgentSendBoundaryInputSchema>;
export type SettleAgentWaitStartBoundaryInput = z.output<
  typeof SettleAgentWaitStartBoundaryInputSchema
>;
export type SettleAgentResultBoundaryInput = z.output<typeof SettleAgentResultBoundaryInputSchema>;
export type SettleAgentCancelBoundaryInput = z.output<typeof SettleAgentCancelBoundaryInputSchema>;
export type SettleInteractionAskBoundaryInput = z.output<
  typeof SettleInteractionAskBoundaryInputSchema
>;
export type SettleDeliveryExportStartBoundaryInput = z.output<
  typeof SettleDeliveryExportStartBoundaryInputSchema
>;
export type SettleDeliveryExportBoundaryInput = z.output<
  typeof SettleDeliveryExportBoundaryInputSchema
>;
export type SettleDeliveryFreezeBoundaryInput = z.output<
  typeof SettleDeliveryFreezeBoundaryInputSchema
>;
export type SettleDeliveryPreviewStartBoundaryInput = z.output<
  typeof SettleDeliveryPreviewStartBoundaryInputSchema
>;
export type SettleDeliveryPreviewBoundaryInput = z.output<
  typeof SettleDeliveryPreviewBoundaryInputSchema
>;
export type SettleEvaluationRunStartBoundaryInput = z.output<
  typeof SettleEvaluationRunStartBoundaryInputSchema
>;
export type SettleEvaluationRunBoundaryInput = z.output<
  typeof SettleEvaluationRunBoundaryInputSchema
>;
export type SettleGenerationSubmitStartBoundaryInput = z.output<
  typeof SettleGenerationSubmitStartBoundaryInputSchema
>;
export type SettleGenerationSubmitBoundaryInput = z.output<
  typeof SettleGenerationSubmitBoundaryInputSchema
>;
export type SettleMediaDeriveStartBoundaryInput = z.output<
  typeof SettleMediaDeriveStartBoundaryInputSchema
>;
export type SettleMediaDeriveBoundaryInput = z.output<typeof SettleMediaDeriveBoundaryInputSchema>;
export type SettleMediaAttachBoundaryInput = z.output<typeof SettleMediaAttachBoundaryInputSchema>;
export type SettleMediaLinkBoundaryInput = z.output<typeof SettleMediaLinkBoundaryInputSchema>;
export type SettleCanvasMutateBoundaryInput = z.output<
  typeof SettleCanvasMutateBoundaryInputSchema
>;
export type SettleOperationCancelBoundaryInput = z.output<
  typeof SettleOperationCancelBoundaryInputSchema
>;
export type SettleTaskManageBoundaryInput = z.output<typeof SettleTaskManageBoundaryInputSchema>;
export type SettleToolProgramBoundaryInput = z.output<typeof SettleToolProgramBoundaryInputSchema>;
export type SettleAgentWaitBoundaryInput = z.output<typeof SettleAgentWaitBoundaryInputSchema>;
export type AdvanceToolProgramChildInput = z.output<typeof AdvanceToolProgramChildInputSchema>;
export type SettleToolProgramChildCallInput = Omit<
  z.output<typeof SettleToolProgramChildCallInputSchema>,
  'outcome'
> & { readonly outcome: RuntimeLoopOutcome };
export type SettleToolProgramParentInput = z.output<typeof SettleToolProgramParentInputSchema>;
export type PrepareDispatchInput = z.output<typeof PrepareDispatchInputSchema>;
export type PrepareSkillProposalInput = z.output<typeof PrepareSkillProposalInputSchema>;
export type PrepareProtectedMutationBoundaryInput = z.output<
  typeof PrepareProtectedMutationBoundaryInputSchema
>;
export type SettleDispatchInput = Omit<z.output<typeof SettleDispatchInputSchema>, 'outcome'> & {
  readonly outcome: RuntimeLoopOutcome;
};
export type CloseInterruptedActivationInput = z.output<
  typeof CloseInterruptedActivationInputSchema
>;
export type AcceptCrashRetryRunInput = z.output<typeof AcceptCrashRetryRunInputSchema>;
export type RecoveryFrontier = z.output<typeof RecoveryFrontierSchema>;
export type InboxConsumeInput = Omit<InboxTransitionInput, 'action'>;

export interface HarnessCommit<Value> {
  readonly value: Value;
  readonly run: Run;
  readonly events: readonly RunEvent[];
}

export type PrepareModelBoundaryResult =
  | {
      readonly kind: 'prepared';
      readonly commit: HarnessCommit<ModelAttemptRecordV1>;
    }
  | {
      readonly kind: 'yielded';
      readonly run: Run;
      readonly events: readonly RunEvent[];
    };

type SkillRegistrationTarget = Extract<
  z.output<typeof ConfirmationTargetSchema>,
  { readonly kind: 'skill_registration' }
>;
type ProtectedMutationTarget = Extract<
  z.output<typeof ConfirmationTargetSchema>,
  { readonly kind: 'protected_mutation' }
>;
type DeliveryExportConfirmationTarget = ReturnType<typeof deliveryExportConfirmationTargetFor>;

export interface SkillProposalRecord {
  readonly dispatch: OperationDispatchRecord;
  readonly confirmationId: string;
  readonly immutableInputHash: string;
  readonly target: SkillRegistrationTarget;
}

export type ProtectedMutationBoundaryRecord =
  | {
      readonly kind: 'succeeded';
      readonly dispatch: OperationDispatchRecord;
      readonly result: ProtectedMutationSuccess;
    }
  | {
      readonly kind: 'waiting_confirmation';
      readonly dispatch: OperationDispatchRecord;
      readonly confirmationId: string;
      readonly target: ProtectedMutationTarget;
    };

export interface CompletePendingProtectedMutationStepInput {
  readonly dispatch: OperationDispatchRecord;
  readonly confirmation: {
    readonly id: string;
    readonly approved: boolean;
    readonly messageId: string;
    readonly messageHash: string;
  };
  readonly inbox: {
    readonly id: string;
    readonly sequence: number;
  };
  readonly occurredAt: string;
  readonly commandId: string;
}

export interface CompletePendingProtectedMutationStepResult {
  readonly run: Run;
  readonly events: readonly RunEvent[];
}

export interface CompletePendingDeliveryExportConfirmationInput {
  readonly dispatch: OperationDispatchRecord;
  readonly confirmation: {
    readonly id: string;
    readonly approved: boolean;
    readonly messageId: string;
    readonly messageHash: string;
  };
  readonly occurredAt: string;
  readonly commandId: string;
}

export interface CompletePendingDeliveryExportConfirmationResult {
  readonly run: Run;
  readonly events: readonly RunEvent[];
}

export interface HarnessActivationSnapshot {
  readonly run: Run;
  readonly activationId: string;
  readonly activation: RunActivation;
  readonly manifest: ContextManifest;
  readonly catalog: CapabilityCatalogSnapshotV1;
  readonly inbox: readonly RunInboxMessage[];
  readonly journal: readonly RunEvent[];
  readonly facts: readonly CanonicalModelFactV1[];
  readonly modelAttempts: readonly ModelAttemptRecordV1[];
  readonly dispatches: readonly OperationDispatchRecord[];
  readonly taskList: TaskList | null;
  readonly compactionView: CompactionViewRecord | null;
  readonly resourceExposure: RunBudgetExposure;
  readonly recoveryRequired: boolean;
}

export interface AgentSpawnBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly child: ChildDelegationResult;
}

export interface AgentSendBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly sent: z.output<typeof AgentSendDefinition.successSchema>;
}

export interface AgentWaitBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly parent: Run;
  readonly activation: RunActivation;
  readonly children: z.output<typeof AgentWaitDefinition.successSchema>['children'];
  readonly conditionMet: boolean;
  readonly deadlineAt: string;
  readonly observedAt: string;
  readonly remainingMs: number;
  readonly result: z.output<typeof AgentWaitDefinition.successSchema> | null;
}

export interface AgentResultBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof AgentResultDefinition.successSchema>;
}

export interface AgentCancelBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof AgentCancelDefinition.successSchema>;
}

export interface InteractionAskBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof InteractionAskDefinition.successSchema>;
}

export interface DeliveryFreezeBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof DeliveryFreezeDefinition.successSchema>;
}

export interface DeliveryExportBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly parent: Run;
  readonly activation: RunActivation;
  readonly confirmationId: string;
  readonly target: DeliveryExportConfirmationTarget;
  readonly result: z.output<typeof DeliveryExportDefinition.successSchema> | null;
}

export interface DeliveryPreviewBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly parent: Run;
  readonly activation: RunActivation;
  readonly result: z.output<typeof DeliveryPreviewDefinition.successSchema> | null;
}

export interface EvaluationRunBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly parent: Run;
  readonly activation: RunActivation;
  readonly result: z.output<typeof EvaluationRunDefinition.successSchema> | null;
}

export interface GenerationSubmitBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly parent: Run;
  readonly activation: RunActivation;
  readonly result: z.output<typeof GenerationSubmitDefinition.successSchema> | null;
}

export interface MediaDeriveBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly parent: Run;
  readonly activation: RunActivation;
  readonly result: z.output<typeof MediaDeriveDefinition.successSchema> | null;
}

export interface MediaAttachBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof MediaAttachDefinition.successSchema>;
}

export interface MediaLinkBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof MediaLinkDefinition.successSchema>;
}

export interface CanvasMutateBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof CanvasMutateDefinition.successSchema>;
}

export interface OperationCancelBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof OperationCancelDefinition.successSchema>;
}

export interface TaskManageBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly result: z.output<typeof TaskManageDefinition.successSchema>;
}

export interface ToolProgramBoundaryRecord {
  readonly attempt: ModelAttemptRecordV1;
  readonly dispatch: OperationDispatchRecord;
  readonly child: ToolProgramChildDelegationCommit;
}

export interface ToolProgramChildDispatchRecord {
  readonly dispatch: OperationDispatchRecord;
  readonly childRunId: string;
  readonly parentDispatchOperationId: string;
  readonly programStepId: string;
  readonly programCallIndex: number;
  readonly toolVersion: string;
  readonly toolInput: unknown;
  readonly activationNumber: number;
  readonly turnNumber: number;
  readonly stepNumber: number;
}

export type ToolProgramChildAdvance =
  | {
      readonly kind: 'execute';
      readonly childRunId: string;
      readonly parentDispatchOperationId: string;
      readonly programStepId: string;
      readonly operation: 'call' | 'map' | 'batch';
      readonly concurrency: number;
      readonly activationNumber: number;
      readonly turnNumber: number;
      readonly stepNumber: number;
      readonly calls: readonly ToolProgramChildDispatchRecord[];
    }
  | {
      readonly kind: 'terminal';
      readonly childRunId: string;
      readonly state: 'succeeded' | 'blocked' | 'failed' | 'cancelled';
    };

export interface ToolProgramChildActivationRecord {
  readonly childRunId: string;
  readonly activation: RunActivation;
}

export interface CloseInterruptedActivationResult {
  readonly run: Run;
  readonly activation: RunActivation;
  readonly frontier: RecoveryFrontier;
  readonly events: readonly RunEvent[];
}

export interface AcceptCrashRetryRunResult {
  readonly created: boolean;
  readonly sourceRun: Run;
  readonly retryRun: Run;
  readonly manifest: ContextManifest;
  readonly catalog: CapabilityCatalogSnapshotV1;
  readonly inbox: RunInboxMessage;
}

function invalid(message: string, cause?: unknown): StorageError {
  return new StorageError('INVALID_REQUEST', message, cause === undefined ? undefined : { cause });
}

function corrupt(message: string, cause?: unknown): StorageError {
  return new StorageError('CORRUPT_DATA', message, cause === undefined ? undefined : { cause });
}

function activeActivation(database: DatabaseSync, runId: string, activationNumber: number) {
  const record = loadRunActivation(database, runId, activationNumber);
  if (record === null) {
    throw new StorageError(
      'NOT_FOUND',
      `Run Activation was not found: ${runId}/${activationNumber}`,
    );
  }
  if (record.activation.state !== 'active') {
    throw invalid(`Run Activation ${runId}/${activationNumber} is not active`);
  }
  return record;
}

function availablePayload(event: RunEvent) {
  if (event.payloadState.state !== 'available') {
    throw corrupt(`Run event ${event.eventId} payload is not available to the runtime`);
  }
  return event.payloadState.payload;
}

function assertAgentSendParentDirection(
  database: DatabaseSync,
  run: Run,
  inbox: RunInboxMessage,
): void {
  if (inbox.source.kind !== 'parent_direction') {
    throw corrupt(`Run ${run.id} agent.send Inbox has no parent direction`);
  }
  const source = inbox.source;
  const parent = loadRun(database, source.parentRunId);
  const parentEvent = loadRunEvents(database, parent.id).find(
    ({ eventId }) => eventId === source.parentEventId,
  );
  const parentPayload =
    parentEvent?.visibility === 'model_surface' && parentEvent.payloadState.state === 'available'
      ? parentEvent.payloadState.payload
      : null;
  if (
    parentPayload === null ||
    parentPayload.type !== 'tool_call_ref' ||
    parentPayload.toolName !== 'agent.send'
  ) {
    throw corrupt(`Run ${run.id} agent.send parent event is invalid`);
  }
  const dispatch = loadOperationDispatch(database, parentPayload.inputPayloadId);
  let input: z.output<typeof AgentSendDurableInputSchema>;
  let result: z.output<typeof AgentSendDefinition.successSchema>;
  try {
    input = AgentSendDurableInputSchema.parse(dispatch.key.input);
    result =
      dispatch.outcome?.status === 'succeeded'
        ? AgentSendDefinition.parseSuccess(dispatch.outcome.data)
        : (() => {
            throw new Error('agent.send outcome is not a success');
          })();
  } catch (cause) {
    throw corrupt(`Run ${run.id} agent.send dispatch is invalid`, cause);
  }
  if (
    parent.projectId !== run.projectId ||
    !isStrictDescendant(database, parent.id, run.id) ||
    dispatch.key.toolId !== 'agent.send' ||
    dispatch.origin.kind !== 'model' ||
    dispatch.key.runId !== parent.id ||
    parentPayload.callId !== dispatch.id ||
    parentPayload.inputPayloadId !== dispatch.id ||
    parentPayload.inputHash !== dispatch.key.inputHash ||
    parentPayload.capabilityCatalogSnapshotId !== parent.capabilityCatalogSnapshotId ||
    input.childRunId !== run.id ||
    input.messageHash !== source.directionHash ||
    inbox.contentHash !== source.directionHash ||
    result.inboxMessageId !== inbox.id ||
    result.inboxSequence !== inbox.sequence ||
    result.deliveryState !== 'queued' ||
    result.child.childRunId !== run.id ||
    result.child.revision !== input.expectedChildRevision + 1
  ) {
    throw corrupt(`Run ${run.id} agent.send direction binding is invalid`);
  }
  const { manifest } = loadRunSnapshots(database, parent);
  if (
    canonicalJson(agentSendSelectedContext(input, manifest)) !==
    canonicalJson(inbox.selectedContext)
  ) {
    throw corrupt(`Run ${run.id} agent.send context binding is invalid`);
  }
}

function modelFacts(
  database: DatabaseSync,
  run: Run,
  catalog: CapabilityCatalogSnapshotV1,
  journal: readonly RunEvent[],
): CanonicalModelFactV1[] {
  const facts: CanonicalModelFactV1[] = [];
  const inbox = listRunInbox(database, run.id);
  for (const message of inbox) {
    if (message.state !== 'consumed' || message.exportDestinationGrant === null) continue;
    if (message.actor !== 'user' || message.source.kind !== 'message') {
      throw corrupt(`Run Inbox ${message.id} export destination source is invalid`);
    }
    const source = message.source;
    const consumedEvents = journal.filter((event) => {
      if (event.visibility !== 'model_surface' || event.payloadState.state !== 'available') {
        return false;
      }
      const payload = event.payloadState.payload;
      return payload.type === 'inbox_consumed' && payload.inboxMessageId === message.id;
    });
    const messageRefs = journal.filter((event) => {
      if (event.visibility !== 'model_surface' || event.payloadState.state !== 'available') {
        return false;
      }
      const payload = event.payloadState.payload;
      return payload.type === 'message_ref' && payload.messageId === source.messageId;
    });
    const matchingRefs = journal.filter((event) => {
      if (event.visibility !== 'model_surface' || event.payloadState.state !== 'available') {
        return false;
      }
      const payload = event.payloadState.payload;
      return payload.type === 'delivery_destination_ref' && payload.inboxMessageId === message.id;
    });
    if (
      consumedEvents.length !== 1 ||
      messageRefs.length !== 1 ||
      matchingRefs.length !== 1 ||
      consumedEvents[0]!.sequence >= messageRefs[0]!.sequence ||
      messageRefs[0]!.sequence >= matchingRefs[0]!.sequence
    ) {
      throw corrupt(
        `Run Inbox ${message.id} export destination model-surface references are incomplete or out of order`,
      );
    }
  }
  for (const event of journal) {
    if (event.visibility !== 'model_surface') continue;
    const payload = availablePayload(event);
    if (payload.type === 'inbox_consumed') {
      const inbox = listRunInbox(database, run.id).find(
        ({ id, sequence }) => id === payload.inboxMessageId && sequence === payload.sequence,
      );
      if (
        inbox === undefined ||
        inbox.state !== 'consumed' ||
        inbox.contentHash !== payload.contentHash
      ) {
        throw corrupt(`Run event ${event.eventId} Inbox reference does not match its authority`);
      }
      if (inbox.source.kind === 'parent_direction') {
        const source = inbox.source;
        const parentEvent = loadRunEvents(database, source.parentRunId).find(
          ({ eventId }) => eventId === source.parentEventId,
        );
        const parentPayload =
          parentEvent?.visibility === 'public' && parentEvent.payloadState.state === 'available'
            ? parentEvent.payloadState.payload
            : null;
        const initialDirection =
          run.parentRunId !== null &&
          run.acceptedSource.kind === 'parent_direction' &&
          canonicalJson(run.acceptedSource) === canonicalJson(source);
        if (initialDirection) {
          if (
            inbox.contentHash !== source.directionHash ||
            parentPayload === null ||
            parentPayload.type !== 'child_run_delegated' ||
            parentPayload.childRunId !== run.id ||
            parentPayload.directionHash !== source.directionHash
          ) {
            throw corrupt(`Run event ${event.eventId} initial parent direction is invalid`);
          }
        } else {
          assertAgentSendParentDirection(database, run, inbox);
        }
        facts.push(
          parseCanonical(CanonicalModelFactV1Schema, {
            type: 'parent_direction',
            eventSequence: event.sequence,
            inboxMessageId: inbox.id,
            parentRunId: source.parentRunId,
            parentEventId: source.parentEventId,
            directionHash: source.directionHash,
          }),
        );
      }
      continue;
    }
    if (payload.type === 'message_ref') {
      const message = loadMessage(database, payload.messageId);
      if (
        message.projectId !== run.projectId ||
        message.chatId !== run.chatId ||
        message.role !== payload.role ||
        message.contentHash !== payload.messageHash
      ) {
        throw corrupt(`Run event ${event.eventId} Message reference does not match its authority`);
      }
      facts.push(
        parseCanonical(CanonicalModelFactV1Schema, {
          type: 'message',
          eventSequence: event.sequence,
          messageId: message.id,
          role: message.role,
          messageHash: message.contentHash,
          blocks: message.blocks,
          attachments: message.attachments,
        }),
      );
      continue;
    }
    if (payload.type === 'delivery_destination_ref') {
      const sourceInbox = inbox.find(({ id }) => id === payload.inboxMessageId);
      if (
        sourceInbox === undefined ||
        sourceInbox.state !== 'consumed' ||
        sourceInbox.actor !== 'user' ||
        sourceInbox.source.kind !== 'message' ||
        sourceInbox.exportDestinationGrant === null ||
        hashCanonical(sourceInbox.exportDestinationGrant) !== payload.grantBindingHash
      ) {
        throw corrupt(
          `Run event ${event.eventId} Delivery destination reference does not match its Inbox authority`,
        );
      }
      facts.push(
        parseCanonical(CanonicalModelFactV1Schema, {
          type: 'delivery_destination',
          eventSequence: event.sequence,
          inboxMessageId: sourceInbox.id,
          destination: sourceInbox.exportDestinationGrant.destination,
          expiresAt: sourceInbox.exportDestinationGrant.expiresAt,
          grantBindingHash: payload.grantBindingHash,
        }),
      );
      continue;
    }
    if (payload.type !== 'tool_call_ref' && payload.type !== 'tool_result_ref') continue;
    const dispatch = loadOperationDispatch(
      database,
      payload.type === 'tool_call_ref' ? payload.inputPayloadId : payload.outputPayloadId,
    );
    const tool = catalog.tools.find(({ id }) => id === dispatch.key.toolId);
    if (dispatch.origin.kind === 'tool_program') {
      if (run.parentRunId === null || dispatch.key.runId !== run.id || tool === undefined) {
        throw corrupt(`Run event ${event.eventId} Tool Program child reference is invalid`);
      }
      continue;
    }
    if (
      tool === undefined ||
      dispatch.key.runId !== run.id ||
      dispatch.originProviderCallId === null ||
      payload.callId !== dispatch.id ||
      payload.toolName !== dispatch.key.toolId
    ) {
      throw corrupt(`Run event ${event.eventId} tool reference does not match its dispatch`);
    }
    if (payload.type === 'tool_call_ref') {
      if (
        payload.capabilityCatalogSnapshotId !== run.capabilityCatalogSnapshotId ||
        payload.inputSchemaHash !== tool.inputSchema.sha256 ||
        payload.inputHash !== dispatch.key.inputHash
      ) {
        throw corrupt(`Run event ${event.eventId} tool input reference is invalid`);
      }
      facts.push(
        parseCanonical(CanonicalModelFactV1Schema, {
          type: 'tool_call',
          eventSequence: event.sequence,
          dispatchOperationId: dispatch.id,
          providerCallId: dispatch.originProviderCallId,
          toolId: dispatch.key.toolId,
          canonicalArguments: dispatch.key.input,
          argumentsHash: dispatch.key.inputHash,
        }),
      );
    } else {
      if (
        dispatch.outcome === null ||
        dispatch.outcomeHash === null ||
        payload.outputSchemaHash !== tool.outcomeSchema.sha256 ||
        payload.outputHash !== dispatch.outcomeHash ||
        payload.success !== (dispatch.outcome.status === 'succeeded')
      ) {
        throw corrupt(`Run event ${event.eventId} tool outcome reference is invalid`);
      }
      facts.push(
        parseCanonical(CanonicalModelFactV1Schema, {
          type: 'tool_result',
          eventSequence: event.sequence,
          dispatchOperationId: dispatch.id,
          providerCallId: dispatch.originProviderCallId,
          toolId: dispatch.key.toolId,
          outcome: dispatch.outcome,
          outcomeHash: dispatch.outcomeHash,
        }),
      );
    }
  }
  return facts;
}

function currentCompactionView(database: DatabaseSync, runId: string): CompactionViewRecord | null {
  assertCompactionJournalProjection(database, runId);
  const completed = loadCompactionTransactions(database, runId)
    .filter(({ state }) => state === 'completed')
    .at(-1);
  if (completed === undefined) return null;
  const view = loadCompactionViews(database, runId).find(
    ({ transactionId }) => transactionId === completed.id,
  );
  if (view === undefined) throw corrupt(`Completed compaction ${completed.id} has no view`);
  return view;
}

type ModelToolCall = Extract<
  CanonicalModelResponseV1['events'][number],
  { readonly type: 'tool_call' }
>;

interface UndispatchedModelCall {
  readonly attempt: ModelAttemptRecordV1;
  readonly call: ModelToolCall;
}

function undispatchedModelCalls(
  attempts: readonly ModelAttemptRecordV1[],
  dispatches: readonly OperationDispatchRecord[],
): UndispatchedModelCall[] {
  return attempts.flatMap((attempt) =>
    attempt.state !== 'succeeded' || attempt.response === null
      ? []
      : attempt.response.events.flatMap((event) =>
          event.type !== 'tool_call' ||
          dispatches.some(
            ({ originModelAttemptId, originProviderCallId }) =>
              originModelAttemptId === attempt.id && originProviderCallId === event.providerCallId,
          )
            ? []
            : [{ attempt, call: event }],
        ),
  );
}

function pendingProtectedMutationSuspension(
  database: DatabaseSync,
  environment: StorageEnvironment,
  run: Run,
  activationId: string,
  activation: RunActivation,
  attempts: readonly ModelAttemptRecordV1[],
  dispatches: readonly OperationDispatchRecord[],
): boolean {
  if (run.status !== 'waiting_confirmation' || activation.state !== 'active') return false;
  const open = dispatches.filter(({ outcome }) => outcome === null);
  if (
    open.length !== 1 ||
    attempts.some(
      ({ state }) =>
        state === 'prepared' || state === 'running' || state === 'submitted' || state === 'unknown',
    ) ||
    undispatchedModelCalls(attempts, dispatches).length !== 0
  ) {
    return false;
  }
  const dispatch = open[0]!;
  const origin = dispatch.origin;
  if (!isProtectedMutationTool(dispatch.key.toolId) || origin.kind !== 'model') {
    return false;
  }
  const modelAttemptId = origin.modelAttemptId;
  const providerCallId = origin.providerCallId;
  const attempt = loadModelAttemptRecord(database, modelAttemptId);
  const call = attempt.response?.events.find(
    (event) => event.type === 'tool_call' && event.providerCallId === providerCallId,
  );
  if (
    attempt.state !== 'succeeded' ||
    attempt.runId !== run.id ||
    attempt.activationId !== activationId ||
    attempt.request.activationNumber !== activation.activationNumber ||
    call?.type !== 'tool_call' ||
    call.toolId !== dispatch.key.toolId ||
    canonicalJson(call.canonicalArguments) !== canonicalJson(dispatch.key.input)
  ) {
    return false;
  }
  protectedMutationCatalogToolForAttempt(database, run, attempt, dispatch.key.toolId);
  const confirmation = pendingProtectedMutationConfirmation(database, dispatch);
  const commanderContext = parseCanonical(CommandContextSchema, {
    actor: 'commander',
    causation: { kind: 'run', runId: run.id },
    correlationId: dispatch.id,
  });
  const plan = () =>
    planProtectedMutationInTransaction(
      database,
      environment,
      dispatch,
      commanderContext,
      confirmation.requestedAt,
    );
  let planned: PlannedProtectedMutation;
  try {
    planned = database.isTransaction ? plan() : withImmediateTransaction(database, plan);
  } catch (cause) {
    if (cause instanceof StorageError && cause.code === 'REVISION_CONFLICT') return false;
    throw cause;
  }
  if (
    !protectedMutationRequiresConfirmation(planned) ||
    canonicalJson(protectedMutationConfirmationTargetForPlan(dispatch, planned)) !==
      canonicalJson(confirmation.target)
  ) {
    return false;
  }
  openDispatchStep(loadRunEvents(database, run.id), activation.activationNumber, dispatch.id);
  return true;
}

function loadActivationSnapshot(
  database: DatabaseSync,
  environment: StorageEnvironment,
  runIdValue: string,
  activationNumber: number,
): HarnessActivationSnapshot {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const run = loadRun(database, runId);
  const storedActivation = loadRunActivation(database, run.id, activationNumber);
  if (storedActivation === null) {
    throw new StorageError(
      'NOT_FOUND',
      `Run Activation was not found: ${run.id}/${activationNumber}`,
    );
  }
  const { manifest, catalog } = loadRunSnapshots(database, run);
  const journal = loadRunEvents(database, run.id);
  const modelAttempts = listModelAttemptRecords(database, run.id, storedActivation.id);
  const dispatches = listRuntimeDispatches(database, run.id, storedActivation.id);
  const suspendedProtectedMutation = pendingProtectedMutationSuspension(
    database,
    environment,
    run,
    storedActivation.id,
    storedActivation.activation,
    modelAttempts,
    dispatches,
  );
  return Object.freeze({
    run,
    activationId: storedActivation.id,
    activation: storedActivation.activation,
    manifest,
    catalog,
    inbox: listRunInbox(database, run.id),
    journal,
    facts: modelFacts(database, run, catalog, journal),
    modelAttempts,
    dispatches,
    taskList: loadTaskList(database, run.id),
    compactionView: currentCompactionView(database, run.id),
    resourceExposure: loadRunBudgetExposure(database, run),
    recoveryRequired:
      modelAttempts.some(
        ({ state }) =>
          state === 'prepared' ||
          state === 'running' ||
          state === 'submitted' ||
          state === 'unknown',
      ) ||
      (dispatches.some(({ outcome }) => outcome === null) && !suspendedProtectedMutation) ||
      undispatchedModelCalls(modelAttempts, dispatches).length > 0,
  });
}

function reservationKey(modelAttemptId: string, kind: RunResourceKind, phase: string): string {
  return hashCanonical({ kind, modelAttemptId, phase });
}

function quoteAmount(quote: ModelResourceQuoteV1, kind: RunResourceKind): RunResourceAmount {
  if (kind === 'input_tokens') return quote.inputTokens;
  if (kind === 'output_tokens') return quote.outputTokens;
  if (kind === 'cost') return quote.cost;
  throw corrupt(`Model Attempt cannot reserve ${kind}`);
}

const MODEL_RESOURCE_KINDS = ['input_tokens', 'output_tokens', 'cost'] as const;

function modelAttemptReservations(
  database: DatabaseSync,
  runId: string,
  modelAttemptId: string,
): RunResourceEntry[] {
  return loadRunResourceEntries(database, runId).filter(
    (entry) =>
      entry.source.kind === 'model_attempt' &&
      entry.source.id === modelAttemptId &&
      entry.phase === 'reserved',
  );
}

function assertReplayQuote(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  quote: ModelResourceQuoteV1,
): void {
  const reservations = modelAttemptReservations(database, attempt.runId, attempt.id);
  if (
    reservations.length !== MODEL_RESOURCE_KINDS.length ||
    MODEL_RESOURCE_KINDS.some((kind) => {
      const reservation = reservations.find((entry) => entry.kind === kind);
      return (
        reservation === undefined ||
        canonicalJson(reservation.amount) !== canonicalJson(quoteAmount(quote, kind))
      );
    })
  ) {
    throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${attempt.id} quote changed`);
  }
}

function assertBudget(
  run: Run,
  exposure: RunBudgetExposure,
  request: CanonicalModelRequestV1,
  quote: ModelResourceQuoteV1,
): void {
  for (const [kind, amount, limit, used, ceiling] of [
    [
      'input',
      quote.inputTokens,
      request.limits.maxInputTokens,
      exposure.inputTokens,
      run.budget.maxInputTokens,
    ],
    [
      'output',
      quote.outputTokens,
      request.limits.maxOutputTokens,
      exposure.outputTokens,
      run.budget.maxOutputTokens,
    ],
  ] as const) {
    if (used === null) throw invalid(`Model ${kind} token exposure is unknown`);
    if (used + BigInt(limit) > BigInt(ceiling)) {
      throw invalid(`Model Attempt exceeds the Run ${kind} token budget`);
    }
    if (amount.state !== 'unknown' && amount.value > limit) {
      throw invalid(`Model ${kind} token quote exceeds its request limit`);
    }
  }
  if (quote.cost.currency !== exposure.costCurrency) {
    throw invalid('Model cost quote currency does not match the Run budget');
  }
  if (run.budget.costUsd.state === 'unknown') return;
  if (quote.cost.state === 'unknown' || exposure.cost === null) {
    throw invalid('Model Attempt with unknown cost is denied by the finite Run budget');
  }
  if (
    compareExactDecimals(
      addExactDecimals(exposure.cost, parseExactDecimal(quote.cost.value)),
      parseExactDecimal(run.budget.costUsd.value),
    ) > 0
  ) {
    throw invalid('Model Attempt exceeds the Run cost budget');
  }
}

function appendModelReservations(
  database: DatabaseSync,
  environment: StorageEnvironment,
  attempt: ModelAttemptRecordV1,
  quote: ModelResourceQuoteV1,
): void {
  for (const kind of MODEL_RESOURCE_KINDS) {
    appendRunResourceEntry(database, environment, {
      runId: attempt.runId,
      source: { kind: 'model_attempt', id: attempt.id },
      phase: 'reserved',
      reservationEntryId: null,
      kind,
      amount: quoteAmount(quote, kind),
      idempotencyKey: reservationKey(attempt.id, kind, 'reserved'),
      recordedAt: attempt.createdAt,
    });
  }
}

interface BoundaryCursor {
  readonly turnNumber: number;
  readonly stepNumber: number;
  readonly startsTurn: boolean;
}

function nextModelBoundary(journal: readonly RunEvent[], activationNumber: number): BoundaryCursor {
  let latestTurn = 0;
  let openTurn: number | null = null;
  const openSteps = new Set<number>();
  let latestStep = 0;
  for (const event of journal) {
    if (event.visibility !== 'public') continue;
    const payload = availablePayload(event);
    if (!('activationNumber' in payload) || payload.activationNumber !== activationNumber) continue;
    if (payload.type === 'turn_started') {
      if (openTurn !== null || payload.turnNumber <= latestTurn) {
        throw corrupt(`Run turn ${payload.turnNumber} ordering is invalid`);
      }
      openTurn = payload.turnNumber;
      latestTurn = payload.turnNumber;
      latestStep = 0;
      openSteps.clear();
    } else if (payload.type === 'turn_ended') {
      if (openTurn !== payload.turnNumber || openSteps.size !== 0) {
        throw corrupt(`Run turn ${payload.turnNumber} closed out of order`);
      }
      openTurn = null;
    } else if (payload.type === 'step_started') {
      if (openTurn !== payload.turnNumber || payload.stepNumber !== latestStep + 1) {
        throw corrupt(`Run step ${payload.turnNumber}/${payload.stepNumber} ordering is invalid`);
      }
      latestStep = payload.stepNumber;
      openSteps.add(payload.stepNumber);
    } else if (payload.type === 'step_ended') {
      if (openTurn !== payload.turnNumber || !openSteps.delete(payload.stepNumber)) {
        throw corrupt(`Run step ${payload.turnNumber}/${payload.stepNumber} closed out of order`);
      }
    }
  }
  if (openSteps.size !== 0) throw invalid('The previous Run step has not ended');
  return openTurn === null
    ? { turnNumber: latestTurn + 1, stepNumber: 1, startsTurn: true }
    : { turnNumber: openTurn, stepNumber: latestStep + 1, startsTurn: false };
}

function assertRequestMatchesSnapshot(
  snapshot: HarnessActivationSnapshot,
  request: CanonicalModelRequestV1,
  exactEventHead: boolean,
): void {
  const expectedCompaction =
    snapshot.compactionView === null
      ? null
      : {
          id: snapshot.compactionView.id,
          hash: snapshot.compactionView.derivedViewHash,
          summary: snapshot.compactionView.summary,
        };
  if (
    request.runId !== snapshot.run.id ||
    request.activationId !== snapshot.activationId ||
    request.activationNumber !== snapshot.activation.activationNumber ||
    request.attemptNumber !== snapshot.modelAttempts.length + 1 ||
    (exactEventHead &&
      (request.runRevision !== snapshot.run.revision ||
        request.runContentHash !== snapshot.run.contentHash)) ||
    canonicalJson(request.provider) !== canonicalJson(snapshot.run.model) ||
    canonicalJson(request.contextManifest) !==
      canonicalJson({ id: snapshot.manifest.id, hash: snapshot.run.contextManifestHash }) ||
    canonicalJson(request.capabilityCatalog) !==
      canonicalJson({
        id: snapshot.run.capabilityCatalogSnapshotId,
        hash: snapshot.run.capabilityCatalogHash,
      }) ||
    (exactEventHead &&
      canonicalJson(request.eventHead) !== canonicalJson(snapshot.run.publicEventHead)) ||
    canonicalJson(request.compactionView) !== canonicalJson(expectedCompaction) ||
    canonicalJson(request.facts) !== canonicalJson(snapshot.facts) ||
    canonicalJson(request.capabilityIndex) !== canonicalJson(snapshot.catalog.capabilityIndex) ||
    canonicalJson(request.skillIndex) !==
      canonicalJson(skillIndexFromSkills(snapshot.catalog.skills)) ||
    request.materializedTools.some(
      (tool) =>
        canonicalJson(tool) !==
        canonicalJson(snapshot.catalog.tools.find(({ id }) => id === tool.id)),
    ) ||
    request.locale !== snapshot.manifest.locale ||
    request.timeZone !== snapshot.manifest.timeZone ||
    request.reasoningStrength !== snapshot.run.model.reasoningStrength ||
    request.systemPromptVersion !== MINIMAL_SYSTEM_PROMPT_VERSION
  ) {
    throw invalid('Canonical Model request does not match the committed Run snapshot');
  }
}

function validateRequest(
  snapshot: HarnessActivationSnapshot,
  request: CanonicalModelRequestV1,
  quote: ModelResourceQuoteV1,
): void {
  assertRequestMatchesSnapshot(snapshot, request, true);
  assertBudget(snapshot.run, snapshot.resourceExposure, request, quote);
}

function assertRequestSupersededOnlyByPendingInbox(
  snapshot: HarnessActivationSnapshot,
  request: CanonicalModelRequestV1,
): void {
  assertRequestMatchesSnapshot(snapshot, request, false);
  const requestHeadIndex = snapshot.journal.findIndex(
    ({ sequence, eventHash }) =>
      sequence === request.eventHead.sequence && eventHash === request.eventHead.hash,
  );
  if (requestHeadIndex < 0) {
    throw invalid('Canonical Model request event head is not an ancestor of the current Run head');
  }
  const latestInboxState = new Map<string, RunInboxMessage['state']>();
  for (const event of snapshot.journal.slice(requestHeadIndex + 1)) {
    if (event.visibility !== 'public' || event.payloadState.state !== 'available') {
      throw invalid('Canonical Model request was superseded by a non-Inbox Run event');
    }
    const payload = event.payloadState.payload;
    if (
      payload.type !== 'inbox_state_changed' ||
      (payload.state !== 'queued' && payload.state !== 'delivered') ||
      payload.sequence <= snapshot.activation.triggerInboxSequence
    ) {
      throw invalid('Canonical Model request was superseded by a non-pending Inbox event');
    }
    const inbox = snapshot.inbox.find(
      ({ id, sequence }) => id === payload.inboxMessageId && sequence === payload.sequence,
    );
    if (inbox === undefined) {
      throw corrupt(`Run ${snapshot.run.id} Inbox event has no authoritative row`);
    }
    latestInboxState.set(inbox.id, payload.state);
  }
  for (const [inboxId, state] of latestInboxState) {
    const inbox = snapshot.inbox.find(({ id }) => id === inboxId);
    if (inbox?.state !== state) {
      throw invalid('Canonical Model request Inbox suffix does not match current Inbox state');
    }
  }
}

function prepareModelBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: PrepareModelAttemptInput,
  contextValue: CommandContext,
): PrepareModelBoundaryResult {
  const input = parseCanonical(PrepareModelAttemptInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const requestHash = hashCanonical(canonicalModelRequestHashInput(input.request));
  const existingRow = database
    .prepare('SELECT 1 FROM model_attempts WHERE id = ?')
    .get(input.request.modelAttemptId);
  if (existingRow !== undefined) {
    const attempt = loadModelAttemptRecord(database, input.request.modelAttemptId);
    if (attempt.requestHash !== requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${attempt.id} request changed`);
    }
    assertReplayQuote(database, attempt, input.quote);
    return {
      kind: 'prepared',
      commit: { value: attempt, run: loadRun(database, attempt.runId), events: [] },
    };
  }
  const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
  return withImmediateTransaction(database, () => {
    const snapshot = loadActivationSnapshot(
      database,
      environment,
      input.request.runId,
      input.request.activationNumber,
    );
    if (
      snapshot.modelAttempts.some(
        ({ state }) =>
          state === 'prepared' ||
          state === 'running' ||
          state === 'submitted' ||
          state === 'unknown',
      )
    ) {
      throw invalid('Activation already has an unresolved Model Attempt');
    }
    if (snapshot.recoveryRequired) {
      throw invalid('Model Attempt preparation cannot cross a recovery frontier');
    }
    if (snapshot.run.status !== 'running' || snapshot.activation.state !== 'active') {
      throw invalid('Model Attempt preparation requires an active running Activation');
    }
    const pendingInbox = earliestPendingInboxAfterTrigger(database, snapshot.activation);
    if (pendingInbox !== null) {
      assertRequestSupersededOnlyByPendingInbox(snapshot, input.request);
      const cursor = nextModelBoundary(snapshot.journal, snapshot.activation.activationNumber);
      const storedActivation = loadRunActivation(
        database,
        snapshot.run.id,
        snapshot.activation.activationNumber,
      );
      if (storedActivation === null || storedActivation.id !== snapshot.activationId) {
        throw corrupt(`Run ${snapshot.run.id} pending-Inbox Activation identity changed`);
      }
      const drafts: AppendRunEventBatchInput['events'] = [
        ...(cursor.startsTurn
          ? []
          : [
              {
                eventId: environment.createId('run_event'),
                visibility: 'public' as const,
                occurredAt,
                actor: context.actor,
                causation: context.causation,
                correlationId: context.correlationId,
                payload: {
                  type: 'turn_ended' as const,
                  activationNumber: snapshot.activation.activationNumber,
                  turnNumber: cursor.turnNumber,
                  outcome: 'interrupted' as const,
                },
              },
            ]),
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'activation_changed',
            activationNumber: snapshot.activation.activationNumber,
            state: 'ended',
            endReason: 'safe_boundary',
          },
        },
      ];
      const events = appendRunEventBatch(database, {
        runId: snapshot.run.id,
        commandId: input.commandId,
        events: drafts,
      });
      const activationEvent = events.at(-1);
      if (activationEvent === undefined) {
        throw corrupt(`Run ${snapshot.run.id} pending-Inbox boundary events are incomplete`);
      }
      closeRunActivation(
        database,
        storedActivation,
        activationEvent.sequence,
        occurredAt,
        'safe_boundary',
      );
      const run = advanceRunJournalHead(database, snapshot.run, {
        eventId: activationEvent.eventId,
        sequence: activationEvent.sequence,
        eventHash: activationEvent.eventHash,
      });
      return { kind: 'yielded', run, events };
    }
    validateRequest(snapshot, input.request, input.quote);
    const attempt = insertPreparedModelAttempt(database, {
      id: input.request.modelAttemptId,
      runId: input.request.runId,
      activationId: input.request.activationId,
      attemptNumber: input.request.attemptNumber,
      provider: input.request.provider,
      state: 'prepared',
      request: input.request,
      requestHash,
      response: null,
      responseHash: null,
      usage: null,
      createdAt: occurredAt,
      finishedAt: null,
    });
    appendModelReservations(database, environment, attempt, input.quote);
    const cursor = nextModelBoundary(snapshot.journal, snapshot.activation.activationNumber);
    const drafts = [
      ...(cursor.startsTurn
        ? [
            {
              eventId: environment.createId('run_event'),
              visibility: 'public' as const,
              occurredAt,
              actor: context.actor,
              causation: context.causation,
              correlationId: context.correlationId,
              payload: {
                type: 'turn_started' as const,
                activationNumber: snapshot.activation.activationNumber,
                turnNumber: cursor.turnNumber,
                inboxMessageId: snapshot.activation.triggerInboxMessageId,
              },
            },
          ]
        : []),
      {
        eventId: environment.createId('run_event'),
        visibility: 'public' as const,
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'step_started' as const,
          activationNumber: snapshot.activation.activationNumber,
          turnNumber: cursor.turnNumber,
          stepNumber: cursor.stepNumber,
          kind: 'model' as const,
        },
      },
    ];
    const events = appendRunEventBatch(database, {
      runId: snapshot.run.id,
      commandId: input.commandId,
      events: drafts,
    });
    const head = events.at(-1)!;
    const run = advanceRunJournalHead(database, snapshot.run, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return { kind: 'prepared', commit: { value: attempt, run, events } };
  });
}

function markModelAttemptRunning(
  database: DatabaseSync,
  inputValue: MarkModelAttemptRunningInput,
): HarnessCommit<ModelAttemptRecordV1> {
  const input = parseCanonical(MarkModelAttemptRunningInputSchema, inputValue);
  return withImmediateTransaction(database, () => {
    const attempt = markModelAttemptRecordRunning(database, input.attemptId, input.requestHash);
    return { value: attempt, run: loadRun(database, attempt.runId), events: [] };
  });
}

function compatibleClosure(reservation: RunResourceAmount, actual: RunResourceAmount): boolean {
  if (reservation.state === 'unknown' || actual.state === 'unknown') return false;
  if ('currency' in reservation || 'currency' in actual) {
    return (
      'currency' in reservation &&
      'currency' in actual &&
      reservation.currency === actual.currency &&
      compareExactDecimals(parseExactDecimal(actual.value), parseExactDecimal(reservation.value)) <=
        0
    );
  }
  return actual.value <= reservation.value;
}

function releasedRemainder(
  reservation: RunResourceAmount,
  actual: RunResourceAmount,
): RunResourceAmount {
  if (reservation.state === 'unknown' || actual.state === 'unknown') {
    throw corrupt('Unknown Model resource amount has no numeric remainder');
  }
  if ('currency' in reservation && 'currency' in actual) {
    return {
      state: 'known',
      value: formatExactDecimal(
        subtractExactDecimals(
          parseExactDecimal(reservation.value!),
          parseExactDecimal(actual.value!),
        ),
      ),
      currency: reservation.currency,
    } satisfies ResourceAmount;
  }
  if (!('currency' in reservation) && !('currency' in actual)) {
    return {
      state: 'known',
      value: reservation.value! - actual.value!,
    } satisfies CountAmount;
  }
  throw corrupt('Model resource reservation kind changed');
}

function closeModelResources(
  database: DatabaseSync,
  environment: StorageEnvironment,
  attempt: ModelAttemptRecordV1,
  usage: ModelResourceQuoteV1,
  recordedAt: string,
): void {
  const reservations = modelAttemptReservations(database, attempt.runId, attempt.id);
  if (reservations.length !== MODEL_RESOURCE_KINDS.length) {
    throw corrupt(`Model Attempt ${attempt.id} resource reservations are incomplete`);
  }
  for (const kind of MODEL_RESOURCE_KINDS) {
    const reservation = reservations.find((entry) => entry.kind === kind)!;
    const actual = quoteAmount(usage, kind);
    const source = { kind: 'model_attempt' as const, id: attempt.id };
    if (compatibleClosure(reservation.amount, actual)) {
      appendRunResourceEntry(database, environment, {
        runId: attempt.runId,
        source,
        phase: 'consumed',
        reservationEntryId: reservation.id,
        kind,
        amount: actual,
        idempotencyKey: reservationKey(attempt.id, kind, 'consumed'),
        recordedAt,
      });
      appendRunResourceEntry(database, environment, {
        runId: attempt.runId,
        source,
        phase: 'released',
        reservationEntryId: reservation.id,
        kind,
        amount: releasedRemainder(reservation.amount, actual),
        idempotencyKey: reservationKey(attempt.id, kind, 'released'),
        recordedAt,
      });
      continue;
    }
    appendRunResourceEntry(database, environment, {
      runId: attempt.runId,
      source,
      phase: 'released',
      reservationEntryId: reservation.id,
      kind,
      amount: reservation.amount,
      idempotencyKey: reservationKey(attempt.id, kind, 'released'),
      recordedAt,
    });
    appendRunResourceEntry(database, environment, {
      runId: attempt.runId,
      source,
      phase: 'consumed',
      reservationEntryId: null,
      kind,
      amount: actual,
      idempotencyKey: reservationKey(attempt.id, kind, 'consumed'),
      recordedAt,
    });
  }
}

function attemptModelStep(
  journal: readonly RunEvent[],
  activationNumber: number,
  attemptNumber: number,
): { turnNumber: number; stepNumber: number } {
  const starts = journal.flatMap((event) => {
    if (event.visibility !== 'public') return [];
    const payload = availablePayload(event);
    return payload.type === 'step_started' &&
      payload.activationNumber === activationNumber &&
      payload.kind === 'model'
      ? [{ turnNumber: payload.turnNumber, stepNumber: payload.stepNumber }]
      : [];
  });
  const step = starts[attemptNumber - 1];
  if (step === undefined) throw corrupt(`Model Attempt ${attemptNumber} has no Run step`);
  return step;
}

function assertOpenStep(
  journal: readonly RunEvent[],
  activationNumber: number,
  turnNumber: number,
  stepNumber: number,
  kind: 'model' | 'tool',
): void {
  let started = false;
  let ended = false;
  for (const event of journal) {
    if (event.visibility !== 'public') continue;
    const payload = availablePayload(event);
    if (
      payload.type === 'step_started' &&
      payload.activationNumber === activationNumber &&
      payload.turnNumber === turnNumber &&
      payload.stepNumber === stepNumber
    ) {
      if (payload.kind !== kind || started) throw corrupt('Run step identity is inconsistent');
      started = true;
    }
    if (
      payload.type === 'step_ended' &&
      payload.activationNumber === activationNumber &&
      payload.turnNumber === turnNumber &&
      payload.stepNumber === stepNumber
    ) {
      if (!started || ended) throw corrupt('Run step closure is inconsistent');
      ended = true;
    }
  }
  if (!started || ended) throw invalid(`Run step ${turnNumber}/${stepNumber} is not open`);
}

function earliestPendingInboxAfterTrigger(
  database: DatabaseSync,
  activation: RunActivation,
): RunInboxMessage | null {
  const inbox = listRunInbox(database, activation.runId);
  const trigger = inbox[activation.triggerInboxSequence - 1];
  if (
    trigger === undefined ||
    trigger.id !== activation.triggerInboxMessageId ||
    trigger.sequence !== activation.triggerInboxSequence
  ) {
    throw corrupt(
      `Activation ${activation.activationNumber} trigger does not match Run ${activation.runId} Inbox`,
    );
  }
  if (trigger.state !== 'consumed') {
    throw corrupt(`Activation ${activation.activationNumber} trigger is not consumed`);
  }
  return (
    inbox
      .slice(activation.triggerInboxSequence)
      .find(({ state }) => state === 'queued' || state === 'delivered') ?? null
  );
}

function agentSpawnCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly spawnInput: z.output<typeof AgentSpawnDefinition.inputSchema>;
  readonly durableInput: z.output<typeof AgentSpawnDurableInputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'agent.spawn') {
    throw invalid('agent.spawn settlement requires exactly one matching model tool call');
  }
  let spawnInput: z.output<typeof AgentSpawnDefinition.inputSchema>;
  try {
    spawnInput = AgentSpawnDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('agent.spawn model input is invalid', cause);
  }
  const durableInput = AgentSpawnDurableInputSchema.parse({
    displayName: spawnInput.displayName,
    objectiveHash: hashUtf8(spawnInput.objective),
    publicSummary: spawnInput.publicSummary,
    contextRefs: spawnInput.contextRefs,
    toolAllowlist: spawnInput.toolAllowlist,
    permissionCeiling: spawnInput.permissionCeiling,
    budgetCaps: spawnInput.budgetCaps,
    expectedParentRevision: spawnInput.expectedParentRevision,
  });
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, {
    ...response,
    events: response.events.map((event) =>
      event.type === 'tool_call' ? { ...event, canonicalArguments: durableInput } : event,
    ),
  });
  return { call, spawnInput, durableInput, durableResponse };
}

function agentSendCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly sendInput: z.output<typeof AgentSendDefinition.inputSchema>;
  readonly durableInput: z.output<typeof AgentSendDurableInputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'agent.send') {
    throw invalid('agent.send settlement requires exactly one matching model tool call');
  }
  let sendInput: z.output<typeof AgentSendDefinition.inputSchema>;
  try {
    sendInput = AgentSendDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('agent.send model input is invalid', cause);
  }
  const durableInput = AgentSendDurableInputSchema.parse({
    childRunId: sendInput.childRunId,
    expectedChildRevision: sendInput.expectedChildRevision,
    messageHash: hashUtf8(sendInput.message),
    contextRefs: sendInput.contextRefs,
  });
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, {
    ...response,
    events: response.events.map((event) =>
      event.type === 'tool_call' ? { ...event, canonicalArguments: durableInput } : event,
    ),
  });
  return { call, sendInput, durableInput, durableResponse };
}

function agentResultCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly resultInput: z.output<typeof AgentResultDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'agent.result') {
    throw invalid('agent.result settlement requires exactly one matching model tool call');
  }
  let resultInput: z.output<typeof AgentResultDefinition.inputSchema>;
  try {
    resultInput = AgentResultDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('agent.result model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, resultInput, durableResponse };
}

function agentWaitCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly waitInput: z.output<typeof AgentWaitDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'agent.wait') {
    throw invalid('agent.wait settlement requires exactly one matching model tool call');
  }
  let waitInput: z.output<typeof AgentWaitDefinition.inputSchema>;
  try {
    waitInput = AgentWaitDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('agent.wait model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, waitInput, durableResponse };
}

function agentCancelCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly cancelInput: z.output<typeof AgentCancelDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'agent.cancel') {
    throw invalid('agent.cancel settlement requires exactly one matching model tool call');
  }
  let cancelInput: z.output<typeof AgentCancelDefinition.inputSchema>;
  try {
    cancelInput = AgentCancelDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('agent.cancel model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, cancelInput, durableResponse };
}

function interactionAskCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly askInput: z.output<typeof InteractionAskDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'interaction.ask') {
    throw invalid('interaction.ask settlement requires exactly one matching model tool call');
  }
  let askInput: z.output<typeof InteractionAskDefinition.inputSchema>;
  try {
    askInput = InteractionAskDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('interaction.ask model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, askInput, durableResponse };
}

function mediaAttachCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly attachInput: z.output<typeof MediaAttachDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'media.attach') {
    throw invalid('media.attach settlement requires exactly one matching model tool call');
  }
  let attachInput: z.output<typeof MediaAttachDefinition.inputSchema>;
  try {
    attachInput = MediaAttachDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('media.attach model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, attachInput, durableResponse };
}

function deliveryFreezeCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly freezeInput: z.output<typeof DeliveryFreezeDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'delivery.freeze') {
    throw invalid('delivery.freeze settlement requires exactly one matching model tool call');
  }
  let freezeInput: z.output<typeof DeliveryFreezeDefinition.inputSchema>;
  try {
    freezeInput = DeliveryFreezeDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('delivery.freeze model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, freezeInput, durableResponse };
}

function deliveryPreviewCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly previewInput: z.output<typeof DeliveryPreviewDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'delivery.preview') {
    throw invalid('delivery.preview settlement requires exactly one matching model tool call');
  }
  let previewInput: z.output<typeof DeliveryPreviewDefinition.inputSchema>;
  try {
    previewInput = DeliveryPreviewDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('delivery.preview model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, previewInput, durableResponse };
}

function deliveryExportCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly exportInput: z.output<typeof DeliveryExportDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'delivery.export') {
    throw invalid('delivery.export settlement requires exactly one matching model tool call');
  }
  let exportInput: z.output<typeof DeliveryExportDefinition.inputSchema>;
  try {
    exportInput = DeliveryExportDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('delivery.export model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, exportInput, durableResponse };
}

function evaluationRunCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly evaluationInput: z.output<typeof EvaluationRunDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'evaluation.run') {
    throw invalid('evaluation.run settlement requires exactly one matching model tool call');
  }
  let evaluationInput: z.output<typeof EvaluationRunDefinition.inputSchema>;
  try {
    evaluationInput = EvaluationRunDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('evaluation.run model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, evaluationInput, durableResponse };
}

function generationSubmitCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly submitInput: z.output<typeof GenerationSubmitDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'generation.submit') {
    throw invalid('generation.submit settlement requires exactly one matching model tool call');
  }
  let submitInput: z.output<typeof GenerationSubmitDefinition.inputSchema>;
  try {
    submitInput = GenerationSubmitDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('generation.submit model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, submitInput, durableResponse };
}

function mediaDeriveCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly deriveInput: z.output<typeof MediaDeriveDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'media.derive') {
    throw invalid('media.derive settlement requires exactly one matching model tool call');
  }
  let deriveInput: z.output<typeof MediaDeriveDefinition.inputSchema>;
  try {
    deriveInput = MediaDeriveDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('media.derive model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, deriveInput, durableResponse };
}

function mediaLinkCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly linkInput: z.output<typeof MediaLinkDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'media.link') {
    throw invalid('media.link settlement requires exactly one matching model tool call');
  }
  let linkInput: z.output<typeof MediaLinkDefinition.inputSchema>;
  try {
    linkInput = MediaLinkDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('media.link model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, linkInput, durableResponse };
}

function canvasMutateCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly canvasInput: z.output<typeof CanvasMutateDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'canvas.mutate') {
    throw invalid('canvas.mutate settlement requires exactly one matching model tool call');
  }
  let canvasInput: z.output<typeof CanvasMutateDefinition.inputSchema>;
  try {
    canvasInput = CanvasMutateDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('canvas.mutate model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, canvasInput, durableResponse };
}

function operationCancelCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly cancelInput: z.output<typeof OperationCancelDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'operation.cancel') {
    throw invalid('operation.cancel settlement requires exactly one matching model tool call');
  }
  let cancelInput: z.output<typeof OperationCancelDefinition.inputSchema>;
  try {
    cancelInput = OperationCancelDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('operation.cancel model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, cancelInput, durableResponse };
}

function taskManageCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly taskInput: z.output<typeof TaskManageDefinition.inputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'task.manage') {
    throw invalid('task.manage settlement requires exactly one matching model tool call');
  }
  let taskInput: z.output<typeof TaskManageDefinition.inputSchema>;
  try {
    taskInput = TaskManageDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('task.manage model input is invalid', cause);
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, response);
  return { call, taskInput, durableResponse };
}

function toolProgramCall(
  response: CanonicalModelResponseV1,
  providerCallId: string,
): {
  readonly call: Extract<
    CanonicalModelResponseV1['events'][number],
    { readonly type: 'tool_call' }
  >;
  readonly program: z.output<typeof ToolProgramDefinition.inputSchema>;
  readonly durableInput: z.output<typeof ToolProgramDurableInputSchema>;
  readonly durableResponse: DurableCanonicalModelResponseV1;
} {
  const calls = response.events.filter((event) => event.type === 'tool_call');
  const call = calls.find((event) => event.providerCallId === providerCallId);
  if (calls.length !== 1 || call?.type !== 'tool_call' || call.toolId !== 'tool.program') {
    throw invalid('tool.program settlement requires exactly one matching model tool call');
  }
  let program: z.output<typeof ToolProgramDefinition.inputSchema>;
  try {
    program = ToolProgramDefinition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid('tool.program model input is invalid', cause);
  }
  if (canonicalJson(program) !== canonicalJson(call.canonicalArguments)) {
    throw invalid('tool.program model input is not canonical');
  }
  const durableInput = durableToolProgramInput(program);
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, {
    ...response,
    events: response.events.map((event) =>
      event.type === 'tool_call' ? { ...event, canonicalArguments: durableInput } : event,
    ),
  });
  return { call, program, durableInput, durableResponse };
}

function assertAtomicModelToolPreparationSuffix(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  run: Run,
  activation: RunActivation,
  input: SettleAgentSpawnBoundaryInput,
  toolId:
    | 'agent.spawn'
    | 'agent.send'
    | 'agent.wait'
    | 'agent.result'
    | 'agent.cancel'
    | 'delivery.export'
    | 'delivery.freeze'
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
    | 'tool.program',
): {
  readonly turnNumber: number;
  readonly stepNumber: number;
  readonly observedRun: Run;
} {
  const request = attempt.request;
  if (
    attempt.state !== 'running' ||
    attempt.runId !== run.id ||
    request.runId !== run.id ||
    request.activationId !== attempt.activationId ||
    request.activationNumber !== activation.activationNumber ||
    input.activationNumber !== activation.activationNumber ||
    run.status !== 'running' ||
    run.revision !== request.runRevision + 1
  ) {
    throw invalid(`${toolId} settlement does not match an active running model boundary`);
  }
  const journal = loadRunEvents(database, run.id);
  const requestHeadIndex = journal.findIndex(
    ({ sequence, eventHash }) =>
      sequence === request.eventHead.sequence && eventHash === request.eventHead.hash,
  );
  const currentHead = journal.at(-1);
  if (
    requestHeadIndex < 0 ||
    currentHead === undefined ||
    canonicalJson(run.publicEventHead) !==
      canonicalJson({
        sequence: currentHead.sequence,
        hash: currentHead.eventHash,
      })
  ) {
    throw invalid(`${toolId} request event head is not bound to the current Run journal`);
  }
  let observed: Run;
  try {
    observed = parseCanonical(RunSchema, {
      ...run,
      revision: request.runRevision,
      contentHash: request.runContentHash,
      publicEventHead: request.eventHead,
    });
  } catch (cause) {
    throw invalid(`${toolId} request Run snapshot is invalid`, cause);
  }
  if (hashContentObject(observed) !== request.runContentHash) {
    throw invalid(`${toolId} request Run snapshot no longer matches durable content`);
  }
  const suffix = journal.slice(requestHeadIndex + 1);
  const payloads = suffix.map((event) => {
    if (event.visibility !== 'public' || event.payloadState.state !== 'available') {
      throw invalid(`${toolId} request was superseded outside its internal model boundary`);
    }
    return event.payloadState.payload;
  });
  const step = attemptModelStep(journal, activation.activationNumber, attempt.attemptNumber);
  const isModelStep = (payload: (typeof payloads)[number]) =>
    payload.type === 'step_started' &&
    payload.activationNumber === activation.activationNumber &&
    payload.turnNumber === step.turnNumber &&
    payload.stepNumber === step.stepNumber &&
    payload.kind === 'model';
  const legalSuffix =
    (payloads.length === 1 && isModelStep(payloads[0]!)) ||
    (payloads.length === 2 &&
      payloads[0]!.type === 'turn_started' &&
      payloads[0]!.activationNumber === activation.activationNumber &&
      payloads[0]!.turnNumber === step.turnNumber &&
      isModelStep(payloads[1]!));
  if (
    !legalSuffix ||
    input.turnNumber !== step.turnNumber ||
    input.stepNumber !== step.stepNumber
  ) {
    throw invalid(`${toolId} request suffix is not the legal internal model boundary`);
  }
  assertOpenStep(journal, activation.activationNumber, step.turnNumber, step.stepNumber, 'model');
  return { ...step, observedRun: observed };
}

function agentSpawnSettlementCommandId(dispatchOperationId: string): string {
  return `agent-spawn.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function replayAgentSpawnBoundary(
  database: DatabaseSync,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  attempt: ModelAttemptRecordV1,
  input: SettleAgentSpawnBoundaryInput,
  spawn: ReturnType<typeof agentSpawnCall>,
): HarnessCommit<AgentSpawnBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    spawn.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, spawn.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`agent.spawn Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== 'agent.spawn' ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== spawn.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(spawn.durableInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.spawn Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const child = AgentSpawnDefinition.parseSuccess(dispatch.outcome.data);
  const privateContext = materializePrivateModelContextForRun(
    database,
    privateRecoveryCodec,
    loadRun(database, attempt.runId),
  );
  const objective = privateContext.spawnObjectives.find(
    (entry) =>
      entry.dispatchOperationId === dispatch.id &&
      entry.childRunId === child.child.childRunId &&
      entry.objectiveHash === spawn.durableInput.objectiveHash,
  );
  if (objective?.objective !== spawn.spawnInput.objective) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.spawn Model Attempt ${attempt.id} replay changed its private objective`,
    );
  }
  return {
    value: { attempt: replayAttempt, dispatch, child },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleAgentSpawnBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  inputValue: SettleAgentSpawnBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<AgentSpawnBoundaryRecord> {
  const input = parseCanonical(SettleAgentSpawnBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const spawn = agentSpawnCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (spawn.spawnInput.expectedParentRevision !== before.request.runRevision) {
      throw invalid(
        'agent.spawn expected parent revision must equal its Model Attempt request snapshot',
      );
    }
    if (before.response !== null) {
      return replayAgentSpawnBoundary(database, privateRecoveryCodec, before, input, spawn);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`agent.spawn Model Attempt ${before.id} Activation identity changed`);
    }
    const run = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      run,
      storedActivation.activation,
      input,
      'agent.spawn',
    );
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      spawn.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`agent.spawn Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareAgentSpawnRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: spawn.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(spawn.durableInput)
    ) {
      throw corrupt(`agent.spawn Dispatch ${preparedDispatch.id} is not a safe unbound dispatch`);
    }
    const delegated = delegateChildRunInTransaction(
      database,
      environment,
      privateRecoveryCodec,
      {
        delegation: {
          parentRunId: run.id,
          expectedParentRevision: before.request.runRevision,
          commandId: preparedDispatch.id,
          spawnInput: spawn.spawnInput,
        },
        observedParent: {
          id: run.id,
          revision: before.request.runRevision,
          contentHash: before.request.runContentHash,
          publicEventHead: before.request.eventHead,
        },
        currentParent: {
          id: run.id,
          revision: run.revision,
          contentHash: run.contentHash,
          publicEventHead: run.publicEventHead,
        },
        parentDispatchOperationId: preparedDispatch.id,
      },
      context,
    );
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: AgentSpawnDefinition.parseOutcome({
        status: 'succeeded',
        data: delegated.result,
      }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`agent.spawn Dispatch ${dispatch.id} settlement disappeared`);
    }
    const { catalog } = loadRunSnapshots(database, delegated.parent);
    const tool = catalog.tools.find(({ id }) => id === 'agent.spawn');
    if (tool === undefined)
      throw corrupt(`agent.spawn Dispatch ${dispatch.id} left its frozen catalog`);
    const events = appendRunEventBatch(database, {
      runId: delegated.parent.id,
      commandId: agentSpawnSettlementCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...dispatchStartDrafts(
          environment,
          context,
          delegated.parent,
          dispatch,
          tool,
          input.activationNumber,
          step.turnNumber,
          step.stepNumber + 1,
          input.settledAt,
        ),
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: 'agent.spawn',
            status: 'succeeded',
            summary: 'Tool agent.spawn succeeded',
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber + 1,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined)
      throw corrupt(`agent.spawn Dispatch ${dispatch.id} emitted no settlement events`);
    const updatedRun = advanceRunJournalHead(database, delegated.parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: { attempt, dispatch, child: delegated.result },
      run: updatedRun,
      events,
    };
  });
}

function agentSendSettlementCommandId(dispatchOperationId: string): string {
  return `agent-send.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function agentSendChildCommandId(dispatchOperationId: string): string {
  return `agent-send.${hashCanonical({ dispatchOperationId, phase: 'child-inbox' })}`;
}

function isStrictDescendant(
  database: DatabaseSync,
  parentRunId: string,
  childRunId: string,
): boolean {
  return (
    database
      .prepare(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM runs WHERE parent_run_id = ?
           UNION
           SELECT child.id
           FROM runs AS child
           JOIN descendants AS parent ON child.parent_run_id = parent.id
         )
         SELECT 1 FROM descendants WHERE id = ? LIMIT 1`,
      )
      .get(parentRunId, childRunId) !== undefined
  );
}

function agentSendSelectedContext(
  input: Pick<z.output<typeof AgentSendDefinition.inputSchema>, 'contextRefs'>,
  manifest: ContextManifest,
) {
  return input.contextRefs.map((ref) => {
    const matches = manifest.selectedContext.filter(
      (entry) => canonicalJson(entry.ref) === canonicalJson(ref),
    );
    if (matches.length !== 1) {
      throw invalid(`agent.send context ${ref.id} is not uniquely authorized by its parent Run`);
    }
    return matches[0]!;
  });
}

function nextAgentSendActivationNumber(database: DatabaseSync, runId: string): number {
  const latest = loadRunActivations(database, runId).at(-1)?.activationNumber ?? 0;
  const pending = listRunInbox(database, runId).filter(
    ({ state }) => state === 'queued' || state === 'delivered',
  ).length;
  return latest + pending;
}

function agentSendChildRef(child: Run) {
  if (child.acceptedSource.kind !== 'parent_direction') {
    throw corrupt(`agent.send child ${child.id} has no parent direction source`);
  }
  return {
    childRunId: child.id,
    revision: child.revision,
    contentHash: child.contentHash,
    state: child.status,
    objectiveHash: child.acceptedSource.directionHash,
  };
}

function replayAgentSendBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleAgentSendBoundaryInput,
  send: ReturnType<typeof agentSendCall>,
): HarnessCommit<AgentSendBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    send.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, send.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`agent.send Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== 'agent.send' ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== send.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(send.durableInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.send Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const sent = AgentSendDefinition.parseSuccess(dispatch.outcome.data);
  if (
    sent.child.childRunId !== send.durableInput.childRunId ||
    sent.child.revision !== send.durableInput.expectedChildRevision + 1
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.send Model Attempt ${attempt.id} replay changed its target child`,
    );
  }
  return {
    value: { attempt: replayAttempt, dispatch, sent },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleAgentSendBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  inputValue: SettleAgentSendBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<AgentSendBoundaryRecord> {
  const input = parseCanonical(SettleAgentSendBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const send = agentSendCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayAgentSendBoundary(database, before, input, send);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`agent.send Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      'agent.send',
    );
    const child = loadRun(database, send.sendInput.childRunId);
    if (
      parent.projectId !== child.projectId ||
      !isStrictDescendant(database, parent.id, child.id) ||
      RunTerminalStateSchema.safeParse(child.status).success
    ) {
      throw invalid('agent.send target must be a nonterminal descendant in the same Project');
    }
    if (child.revision !== send.sendInput.expectedChildRevision) {
      throw new StorageError(
        'REVISION_CONFLICT',
        `agent.send target Run ${child.id} revision does not match`,
      );
    }
    if (
      materializePrivateRunContextForRun(database, privateRecoveryCodec, child).kind ===
      'tool_program'
    ) {
      throw invalid(`agent.send target ${child.id} cannot be a Tool Program child`);
    }
    const { manifest, catalog } = loadRunSnapshots(database, parent);
    const selectedContext = agentSendSelectedContext(send.sendInput, manifest);
    assertSelectedContext(database, child.projectId, selectedContext);
    const tool = catalog.tools.find(({ id }) => id === 'agent.send');
    if (tool === undefined || tool.version !== AgentSendDefinition.version) {
      throw corrupt(`agent.send is absent from parent Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      send.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`agent.send Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareAgentSendRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: send.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(send.durableInput)
    ) {
      throw corrupt(`agent.send Dispatch ${preparedDispatch.id} is not a safe unbound dispatch`);
    }
    const parentDispatchDrafts = dispatchStartDrafts(
      environment,
      context,
      parent,
      preparedDispatch,
      tool,
      input.activationNumber,
      step.turnNumber,
      step.stepNumber + 1,
      input.settledAt,
    );
    const parentCallEvent = parentDispatchDrafts.find(
      (draft) =>
        draft.visibility === 'model_surface' &&
        draft.payload.type === 'tool_call_ref' &&
        draft.payload.callId === preparedDispatch.id,
    );
    if (parentCallEvent === undefined) {
      throw corrupt(`agent.send Dispatch ${preparedDispatch.id} has no parent tool-call event`);
    }
    const childInbox = parseCanonical(RunInboxMessageSchema, {
      id: environment.createId('run_inbox_message'),
      runId: child.id,
      sequence: nextRunInboxSequence(database, child.id),
      actor: 'commander',
      source: {
        kind: 'parent_direction',
        parentRunId: parent.id,
        parentEventId: parentCallEvent.eventId,
        directionHash: send.durableInput.messageHash,
      },
      selectedContext,
      exportDestinationGrant: null,
      contentHash: send.durableInput.messageHash,
      state: 'queued',
      createdAt: input.settledAt,
    });
    insertRunInboxMessage(database, childInbox);
    const activationNumber = nextAgentSendActivationNumber(database, child.id);
    const envelope = appendAgentSendRecovery(database, privateRecoveryCodec, {
      envelopeId: environment.createId('private_recovery_envelope'),
      child,
      inbox: childInbox,
      parentRunId: parent.id,
      parentEventId: parentCallEvent.eventId,
      parentDispatchOperationId: preparedDispatch.id,
      activationNumber,
      message: send.sendInput.message,
      createdAt: input.settledAt,
    });
    const [childEvent] = appendRunEventBatch(database, {
      runId: child.id,
      commandId: agentSendChildCommandId(preparedDispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'inbox_state_changed',
            inboxMessageId: childInbox.id,
            sequence: childInbox.sequence,
            state: 'queued',
          },
        },
      ],
    });
    if (childEvent === undefined) {
      throw corrupt(`agent.send child ${child.id} emitted no Inbox event`);
    }
    const updatedChild = advanceRunJournalAndPrivateRecoveryHead(
      database,
      child,
      {
        eventId: childEvent.eventId,
        sequence: childEvent.sequence,
        eventHash: childEvent.eventHash,
      },
      { sequence: envelope.sequence, hash: envelope.envelopeHash },
    );
    const sent = AgentSendDefinition.parseSuccess({
      inboxMessageId: childInbox.id,
      inboxSequence: childInbox.sequence,
      activationNumber,
      deliveryState: 'queued',
      child: agentSendChildRef(updatedChild),
    });
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: AgentSendDefinition.parseOutcome({ status: 'succeeded', data: sent }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`agent.send Dispatch ${dispatch.id} settlement disappeared`);
    }
    const events = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: agentSendSettlementCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...parentDispatchDrafts,
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: 'agent.send',
            status: 'succeeded',
            summary: 'Tool agent.send succeeded',
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber + 1,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined) {
      throw corrupt(`agent.send Dispatch ${dispatch.id} emitted no settlement events`);
    }
    const updatedParent = advanceRunJournalHead(database, parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: { attempt, dispatch, sent },
      run: updatedParent,
      events,
    };
  });
}

function agentResultSettlementCommandId(dispatchOperationId: string): string {
  return `agent-result.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function childRunPublicLinks(database: DatabaseSync, child: Run) {
  const resultRefs = new Map<string, z.output<typeof DomainObjectRefSchema>>();
  const artifacts = new Map<string, z.output<typeof ArtifactRefSchema>>();
  const rows = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE run_id = ? AND outcome_v1_json IS NOT NULL
       ORDER BY rowid`,
    )
    .all(child.id) as unknown as Array<{ readonly id: string }>;

  const addResultRef = (value: unknown) => {
    const ref = parseCanonical(DomainObjectRefSchema, value);
    resultRefs.set(`${ref.authority}:${ref.id}`, ref);
  };
  const addArtifact = (value: unknown) => {
    const artifact = parseCanonical(ArtifactRefSchema, value);
    artifacts.set(`${artifact.kind}:${artifact.id}`, artifact);
  };

  for (const row of rows) {
    const dispatch = loadOperationDispatch(database, row.id);
    if (
      dispatch.key.runId !== child.id ||
      dispatch.key.projectId !== child.projectId ||
      dispatch.outcome === null
    ) {
      throw corrupt(`Child Run ${child.id} Dispatch ${dispatch.id} binding is invalid`);
    }
    if (dispatch.ownerAuthority !== null && dispatch.ownerId !== null) {
      const owner = loadOperationOwnerRecord(database, dispatch.ownerAuthority, dispatch.ownerId);
      if (owner.runId !== child.id || owner.projectId !== child.projectId) {
        throw corrupt(`Child Run ${child.id} Operation ${dispatch.id} owner is out of scope`);
      }
      const view = operationPublicViewForOwner(database, dispatch.id, owner, dispatch.key.input);
      view.resultRefs.forEach(addResultRef);
      view.artifacts.forEach(addArtifact);
    }
    if (
      dispatch.key.toolId !== AgentResultDefinition.id &&
      dispatch.outcome.status === 'succeeded' &&
      typeof dispatch.outcome.data === 'object' &&
      dispatch.outcome.data !== null &&
      !Array.isArray(dispatch.outcome.data)
    ) {
      const data = dispatch.outcome.data as Record<string, unknown>;
      if (Array.isArray(data.resultRefs)) data.resultRefs.forEach(addResultRef);
      if (Array.isArray(data.artifacts)) data.artifacts.forEach(addArtifact);
    }
  }

  return {
    resultRefs: [...resultRefs.values()].slice(-100),
    artifacts: [...artifacts.values()].slice(-100),
  };
}

function knownUsageCount(value: bigint, label: string): CountAmount {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw corrupt(`${label} exceeds the canonical safe-integer range`);
  }
  return { state: 'known', value: Number(value) };
}

type AgentChildSummaryToolId = 'agent.wait' | 'agent.result' | 'agent.cancel';
type ParentDirectedRun = Run & {
  readonly parentRunId: string;
  readonly acceptedSource: Extract<Run['acceptedSource'], { readonly kind: 'parent_direction' }>;
  readonly displayName: string;
  readonly publicSummary: string;
};

function strictDescendantChild(
  database: DatabaseSync,
  parent: Run,
  childRunId: string,
  toolId: AgentChildSummaryToolId,
): ParentDirectedRun {
  const child = loadRun(database, childRunId);
  if (
    child.projectId !== parent.projectId ||
    !isStrictDescendant(database, parent.id, child.id) ||
    child.parentRunId === null ||
    child.acceptedSource.kind !== 'parent_direction'
  ) {
    throw invalid(`${toolId} target must be a descendant in the same Project`);
  }
  return child as ParentDirectedRun;
}

function childRunUsage(database: DatabaseSync, child: Run) {
  const exposure = loadRunBudgetExposure(database, child);
  return {
    costUsd:
      exposure.cost === null
        ? { state: 'unknown' as const, currency: exposure.costCurrency }
        : {
            state: 'known' as const,
            value: formatExactDecimal(exposure.cost),
            currency: exposure.costCurrency,
          },
    generationCount: knownUsageCount(exposure.generationCount, 'Generation usage'),
    inputTokens:
      exposure.inputTokens === null
        ? { state: 'unknown' as const }
        : knownUsageCount(exposure.inputTokens, 'Input-token usage'),
    outputTokens:
      exposure.outputTokens === null
        ? { state: 'unknown' as const }
        : knownUsageCount(exposure.outputTokens, 'Output-token usage'),
  };
}

function childRunSummary(
  database: DatabaseSync,
  parent: Run,
  childRunId: string,
  toolId: AgentChildSummaryToolId,
) {
  const child = strictDescendantChild(database, parent, childRunId, toolId);
  const journal = loadRunEvents(database, child.id);
  const terminal = RunTerminalStateSchema.safeParse(child.status).success;
  let summary = child.publicSummary;
  if (terminal) {
    if (child.terminalOutcome === null) {
      throw corrupt(`Terminal child Run ${child.id} has no terminal outcome`);
    }
    const terminalEvent = journal.find(
      ({ eventId }) => eventId === child.terminalOutcome?.terminalEventId,
    );
    const terminalPayload = terminalEvent === undefined ? null : availablePayload(terminalEvent);
    if (
      terminalEvent?.visibility !== 'public' ||
      terminalPayload?.type !== 'terminal_summary' ||
      terminalPayload.status !== child.status ||
      terminalPayload.summary !== child.terminalOutcome.summary
    ) {
      throw corrupt(`Terminal child Run ${child.id} summary binding is invalid`);
    }
    summary = child.terminalOutcome.summary;
  } else {
    const progress = [...journal].reverse().flatMap((event) => {
      if (event.visibility !== 'public') return [];
      const payload = availablePayload(event);
      return payload.type === 'progress' ? [payload.summary] : [];
    })[0];
    if (progress !== undefined) summary = progress;
  }
  const blockers = journal.flatMap((event) => {
    if (event.visibility !== 'public') return [];
    const payload = availablePayload(event);
    return payload.type === 'blocker' ? [payload.message] : [];
  });
  const links = childRunPublicLinks(database, child);
  return {
    child: {
      childRunId: child.id,
      revision: child.revision,
      contentHash: child.contentHash,
      state: child.status,
      objectiveHash: child.acceptedSource.directionHash,
    },
    displayName: child.displayName,
    summary,
    resultRefs: links.resultRefs,
    artifacts: links.artifacts,
    blockers: [...new Set(blockers)].slice(-100),
    usage: childRunUsage(database, child),
  };
}

function terminalChildRunSummary(
  database: DatabaseSync,
  parent: Run,
  childRunId: string,
  toolId: 'agent.result' | 'agent.cancel',
) {
  const child = strictDescendantChild(database, parent, childRunId, toolId);
  if (!RunTerminalStateSchema.safeParse(child.status).success) {
    throw invalid(`${toolId} target must be a terminal descendant in the same Project`);
  }
  return childRunSummary(database, parent, childRunId, toolId);
}

function agentWaitChildrenVector(
  database: DatabaseSync,
  parent: Run,
  childRunIds: readonly string[],
) {
  return childRunIds.map((childRunId) => {
    const child = strictDescendantChild(database, parent, childRunId, 'agent.wait');
    return {
      childRunId: child.id,
      revision: child.revision,
      contentHash: child.contentHash,
      state: child.status,
    };
  });
}

function agentWaitWatermarkHash(children: ReturnType<typeof agentWaitChildrenVector>): string {
  return hashCanonical({ kind: 'agent_wait_v1', children });
}

function agentWaitConditionMet(
  input: z.output<typeof AgentWaitDefinition.inputSchema>,
  children: ReturnType<typeof agentWaitChildrenVector>,
  baseline: string,
): boolean {
  if (input.condition === 'any_terminal') {
    return children.some(({ state }) => RunTerminalStateSchema.safeParse(state).success);
  }
  if (input.condition === 'all_terminal') {
    return children.every(({ state }) => RunTerminalStateSchema.safeParse(state).success);
  }
  return agentWaitWatermarkHash(children) !== baseline;
}

function agentWaitDeadlineAt(
  dispatch: OperationDispatchRecord,
  input: z.output<typeof AgentWaitDefinition.inputSchema>,
): string {
  const createdAt = Date.parse(dispatch.createdAt);
  if (!Number.isFinite(createdAt)) {
    throw corrupt(`agent.wait Dispatch ${dispatch.id} createdAt is invalid`);
  }
  return new Date(createdAt + (input.timeoutMs ?? 300_000)).toISOString();
}

function agentWaitDeadlineReached(deadlineAt: string, completedAt: string): boolean {
  const deadline = Date.parse(deadlineAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(completed)) {
    throw corrupt('agent.wait deadline comparison is invalid');
  }
  return completed >= deadline;
}

function agentWaitCompletedAfterStart(startedAt: string, completedAt: string): boolean {
  const started = Date.parse(startedAt);
  const completed = Date.parse(completedAt);
  if (!Number.isFinite(started) || !Number.isFinite(completed)) {
    throw corrupt('agent.wait completion time is invalid');
  }
  return completed >= started;
}

function agentWaitRemainingMs(deadlineAt: string, observedAt: string): number {
  const deadline = Date.parse(deadlineAt);
  const observed = Date.parse(observedAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(observed)) {
    throw corrupt('agent.wait observation time is invalid');
  }
  return Math.max(0, deadline - observed);
}

function settleSuccessfulControlEvents(
  database: DatabaseSync,
  environment: StorageEnvironment,
  context: CommandContext,
  parent: Run,
  dispatch: OperationDispatchRecord,
  tool: CapabilityCatalogSnapshotV1['tools'][number],
  usage: ModelResourceQuoteV1,
  activationNumber: number,
  step: { readonly turnNumber: number; readonly stepNumber: number },
  occurredAt: string,
  commandId: string,
  domainEvents: AppendRunEventBatchInput['events'] = [],
) {
  if (dispatch.outcome === null || dispatch.outcomeHash === null) {
    throw corrupt(`${dispatch.key.toolId} Dispatch ${dispatch.id} is not settled`);
  }
  const events = appendRunEventBatch(database, {
    runId: parent.id,
    commandId,
    events: [
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: { type: 'usage', ...usage },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'step_ended',
          activationNumber,
          turnNumber: step.turnNumber,
          stepNumber: step.stepNumber,
          outcome: 'completed',
        },
      },
      ...dispatchStartDrafts(
        environment,
        context,
        parent,
        dispatch,
        tool,
        activationNumber,
        step.turnNumber,
        step.stepNumber + 1,
        occurredAt,
      ),
      ...domainEvents,
      {
        eventId: environment.createId('run_event'),
        visibility: 'model_surface',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'tool_result_ref',
          callId: dispatch.id,
          toolName: dispatch.key.toolId,
          outputPayloadId: dispatch.id,
          outputSchemaHash: tool.outcomeSchema.sha256,
          outputHash: dispatch.outcomeHash,
          success: true,
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
          type: 'tool_summary',
          toolName: dispatch.key.toolId,
          status: 'succeeded',
          summary: `Tool ${dispatch.key.toolId} succeeded`,
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
          type: 'step_ended',
          activationNumber,
          turnNumber: step.turnNumber,
          stepNumber: step.stepNumber + 1,
          outcome: 'completed',
        },
      },
    ],
  });
  const head = events.at(-1);
  if (head === undefined) {
    throw corrupt(`${dispatch.key.toolId} Dispatch ${dispatch.id} emitted no settlement events`);
  }
  const run = advanceRunJournalHead(database, parent, {
    eventId: head.eventId,
    sequence: head.sequence,
    eventHash: head.eventHash,
  });
  return { events, run };
}

function replayAgentResultBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleAgentResultBoundaryInput,
  resultCall: ReturnType<typeof agentResultCall>,
): HarnessCommit<AgentResultBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    resultCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, resultCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`agent.result Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== AgentResultDefinition.id ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== resultCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(resultCall.resultInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.result Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const result = AgentResultDefinition.parseSuccess(dispatch.outcome.data);
  if (
    canonicalJson(result.children.map(({ child }) => child.childRunId)) !==
    canonicalJson(resultCall.resultInput.childRunIds)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.result Model Attempt ${attempt.id} replay changed its target children`,
    );
  }
  return {
    value: { attempt: replayAttempt, dispatch, result },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleAgentResultBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleAgentResultBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<AgentResultBoundaryRecord> {
  const input = parseCanonical(SettleAgentResultBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const resultCall = agentResultCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayAgentResultBoundary(database, before, input, resultCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`agent.result Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      'agent.result',
    );
    const result = AgentResultDefinition.parseSuccess({
      children: resultCall.resultInput.childRunIds.map((childRunId) =>
        terminalChildRunSummary(database, parent, childRunId, 'agent.result'),
      ),
    });
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === AgentResultDefinition.id);
    if (tool === undefined || tool.version !== AgentResultDefinition.version) {
      throw corrupt(`agent.result is absent from parent Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      resultCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`agent.result Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareAgentResultRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: resultCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(resultCall.resultInput)
    ) {
      throw corrupt(`agent.result Dispatch ${preparedDispatch.id} is not a safe unbound dispatch`);
    }
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: AgentResultDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`agent.result Dispatch ${dispatch.id} settlement disappeared`);
    }
    const settledEvents = settleSuccessfulControlEvents(
      database,
      environment,
      context,
      parent,
      dispatch,
      tool,
      attempt.usage,
      input.activationNumber,
      step,
      input.settledAt,
      agentResultSettlementCommandId(dispatch.id),
    );
    return {
      value: { attempt, dispatch, result },
      run: settledEvents.run,
      events: settledEvents.events,
    };
  });
}

function agentWaitStartCommandId(dispatchOperationId: string): string {
  return `agent-wait.${hashCanonical({ dispatchOperationId, phase: 'start' })}`;
}

function agentWaitSettlementCommandId(dispatchOperationId: string): string {
  return `agent-wait.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function agentWaitCatalogTool(
  database: DatabaseSync,
  parent: Run,
): CapabilityCatalogSnapshotV1['tools'][number] {
  const { catalog } = loadRunSnapshots(database, parent);
  const tool = catalog.tools.find(({ id }) => id === AgentWaitDefinition.id);
  if (tool === undefined || tool.version !== AgentWaitDefinition.version) {
    throw corrupt(`agent.wait is absent from parent Run ${parent.id}'s frozen catalog`);
  }
  return tool;
}

function loadAgentWaitBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  dispatchOperationId: string,
): AgentWaitBoundaryRecord {
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  const origin = dispatch.origin;
  if (dispatch.key.toolId !== AgentWaitDefinition.id || origin.kind !== 'model') {
    throw invalid(`Dispatch ${dispatch.id} is not an agent.wait model dispatch`);
  }
  const attempt = loadModelAttemptRecord(database, origin.modelAttemptId);
  const parent = loadRun(database, dispatch.key.runId);
  const activation = loadRunActivation(database, parent.id, attempt.request.activationNumber);
  if (
    attempt.state !== 'succeeded' ||
    attempt.response === null ||
    attempt.runId !== parent.id ||
    origin.providerCallId === '' ||
    activation === null ||
    activation.id !== attempt.activationId
  ) {
    throw corrupt(`agent.wait Dispatch ${dispatch.id} has an invalid model boundary`);
  }
  const call = attempt.response.events.find(
    (event) => event.type === 'tool_call' && event.providerCallId === origin.providerCallId,
  );
  if (
    call?.type !== 'tool_call' ||
    call.toolId !== AgentWaitDefinition.id ||
    canonicalJson(call.canonicalArguments) !== canonicalJson(dispatch.key.input)
  ) {
    throw corrupt(`agent.wait Dispatch ${dispatch.id} does not match its model call`);
  }
  let waitInput: z.output<typeof AgentWaitDefinition.inputSchema>;
  try {
    waitInput = AgentWaitDefinition.parseInput(dispatch.key.input as Record<string, unknown>);
  } catch (cause) {
    throw corrupt(`agent.wait Dispatch ${dispatch.id} input is invalid`, cause);
  }
  const baseline = dispatch.key.authorityWatermarkHash;
  if (baseline === null || !Sha256Schema.safeParse(baseline).success) {
    throw corrupt(`agent.wait Dispatch ${dispatch.id} has no durable baseline`);
  }
  agentWaitCatalogTool(database, parent);
  const observedAt = parseCanonical(IsoTimestampSchema, environment.now());
  const vector = agentWaitChildrenVector(database, parent, waitInput.childRunIds);
  const children = waitInput.childRunIds.map((childRunId) =>
    childRunSummary(database, parent, childRunId, 'agent.wait'),
  );
  let result: z.output<typeof AgentWaitDefinition.successSchema> | null = null;
  if (dispatch.outcome !== null) {
    if (dispatch.outcome.status !== 'succeeded') {
      throw corrupt(`agent.wait Dispatch ${dispatch.id} has a non-success outcome`);
    }
    try {
      result = AgentWaitDefinition.parseSuccess(dispatch.outcome.data);
    } catch (cause) {
      throw corrupt(`agent.wait Dispatch ${dispatch.id} outcome is invalid`, cause);
    }
    if (
      canonicalJson(result.children.map(({ child }) => child.childRunId)) !==
      canonicalJson(waitInput.childRunIds)
    ) {
      throw corrupt(`agent.wait Dispatch ${dispatch.id} outcome target children changed`);
    }
  }
  const deadlineAt = agentWaitDeadlineAt(dispatch, waitInput);
  return Object.freeze({
    attempt,
    dispatch,
    parent,
    activation: activation.activation,
    children: AgentWaitDefinition.parseSuccess({ children, timedOut: false }).children,
    conditionMet: agentWaitConditionMet(waitInput, vector, baseline),
    deadlineAt,
    observedAt,
    remainingMs: agentWaitRemainingMs(deadlineAt, observedAt),
    result,
  });
}

function replayAgentWaitStartBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  attempt: ModelAttemptRecordV1,
  input: SettleAgentWaitStartBoundaryInput,
  waitCall: ReturnType<typeof agentWaitCall>,
): HarnessCommit<AgentWaitBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    waitCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, waitCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`agent.wait Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== AgentWaitDefinition.id ||
    dispatch.origin.kind !== 'model' ||
    dispatch.origin.modelAttemptId !== attempt.id ||
    dispatch.origin.providerCallId !== waitCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(waitCall.waitInput) ||
    dispatch.key.authorityWatermarkHash === null ||
    (dispatch.outcome !== null && dispatch.outcome.status !== 'succeeded')
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.wait Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const boundary = loadAgentWaitBoundary(database, environment, dispatch.id);
  return {
    value: { ...boundary, attempt: replayAttempt },
    run: boundary.parent,
    events: [],
  };
}

function settleAgentWaitStartBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleAgentWaitStartBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<AgentWaitBoundaryRecord> {
  const input = parseCanonical(SettleAgentWaitStartBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const waitCall = agentWaitCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayAgentWaitStartBoundary(database, environment, before, input, waitCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`agent.wait Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      'agent.wait',
    );
    const vector = agentWaitChildrenVector(database, parent, waitCall.waitInput.childRunIds);
    const baseline = agentWaitWatermarkHash(vector);
    const tool = agentWaitCatalogTool(database, parent);
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      waitCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`agent.wait Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const startedAt = parseCanonical(IsoTimestampSchema, environment.now());
    const dispatch = prepareAgentWaitRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: waitCall.call.providerCallId,
      authorityWatermarkHash: baseline,
      occurredAt: startedAt,
    });
    if (
      dispatch.guardOutcome !== 'allowed' ||
      dispatch.outcome !== null ||
      dispatch.key.authorityWatermarkHash !== baseline ||
      canonicalJson(dispatch.key.input) !== canonicalJson(waitCall.waitInput)
    ) {
      throw corrupt(`agent.wait Dispatch ${dispatch.id} is not a safe open wait dispatch`);
    }
    const events = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: agentWaitStartCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...dispatchStartDrafts(
          environment,
          context,
          parent,
          dispatch,
          tool,
          input.activationNumber,
          step.turnNumber,
          step.stepNumber + 1,
          input.settledAt,
        ),
      ],
    });
    const head = events.at(-1);
    if (head === undefined)
      throw corrupt(`agent.wait Dispatch ${dispatch.id} emitted no start events`);
    const run = advanceRunJournalHead(database, parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    const boundary = loadAgentWaitBoundary(database, environment, dispatch.id);
    return {
      value: { ...boundary, attempt, parent: run },
      run,
      events,
    };
  });
}

function settleAgentWaitBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleAgentWaitBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<AgentWaitBoundaryRecord> {
  const input = parseCanonical(SettleAgentWaitBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const boundary = loadAgentWaitBoundary(database, environment, input.dispatchOperationId);
    if (input.activationNumber !== boundary.attempt.request.activationNumber) {
      throw invalid(`agent.wait Dispatch ${boundary.dispatch.id} belongs to another Activation`);
    }
    if (!agentWaitCompletedAfterStart(boundary.dispatch.createdAt, input.completedAt)) {
      throw invalid(`agent.wait Dispatch ${boundary.dispatch.id} completed before it started`);
    }
    if (boundary.dispatch.outcome !== null) {
      if (boundary.result === null) {
        throw corrupt(`agent.wait Dispatch ${boundary.dispatch.id} replay has no result`);
      }
      return { value: boundary, run: boundary.parent, events: [] };
    }
    if (boundary.parent.status !== 'running') {
      throw invalid(`agent.wait parent Run ${boundary.parent.id} is not running`);
    }
    const storedActivation = activeActivation(database, boundary.parent.id, input.activationNumber);
    if (storedActivation.id !== boundary.attempt.activationId) {
      throw invalid(`agent.wait Dispatch ${boundary.dispatch.id} belongs to another Activation`);
    }
    const waitInput = AgentWaitDefinition.parseInput(
      boundary.dispatch.key.input as Record<string, unknown>,
    );
    const baseline = boundary.dispatch.key.authorityWatermarkHash;
    if (baseline === null)
      throw corrupt(`agent.wait Dispatch ${boundary.dispatch.id} has no baseline`);
    const vector = agentWaitChildrenVector(database, boundary.parent, waitInput.childRunIds);
    const conditionMet = agentWaitConditionMet(waitInput, vector, baseline);
    const deadlineAt = agentWaitDeadlineAt(boundary.dispatch, waitInput);
    if (!conditionMet && !agentWaitDeadlineReached(deadlineAt, input.completedAt)) {
      throw invalid(`agent.wait Dispatch ${boundary.dispatch.id} condition has not been met`);
    }
    const children = waitInput.childRunIds.map((childRunId) =>
      childRunSummary(database, boundary.parent, childRunId, 'agent.wait'),
    );
    const result = AgentWaitDefinition.parseSuccess({
      children,
      timedOut: !conditionMet,
    });
    const journal = loadRunEvents(database, boundary.parent.id);
    const open = openDispatchStep(journal, input.activationNumber, boundary.dispatch.id);
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: boundary.dispatch.id,
      outcome: AgentWaitDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`agent.wait Dispatch ${dispatch.id} settlement disappeared`);
    }
    const tool = agentWaitCatalogTool(database, boundary.parent);
    const events = appendRunEventBatch(database, {
      runId: boundary.parent.id,
      commandId: agentWaitSettlementCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: AgentWaitDefinition.id,
            status: 'succeeded',
            summary: `Tool ${AgentWaitDefinition.id} succeeded`,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: open.turnNumber,
            stepNumber: open.stepNumber,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined)
      throw corrupt(`agent.wait Dispatch ${dispatch.id} emitted no settlement events`);
    const run = advanceRunJournalHead(database, boundary.parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: {
        attempt: boundary.attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        children: result.children,
        conditionMet,
        deadlineAt,
        observedAt: input.completedAt,
        remainingMs: agentWaitRemainingMs(deadlineAt, input.completedAt),
        result,
      },
      run,
      events,
    };
  });
}

function agentCancelSettlementCommandId(dispatchOperationId: string): string {
  return `agent-cancel.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function agentCancelChildCommandId(
  dispatchOperationId: string,
  childRunId: string,
  phase: 'operations' | 'terminal',
): string {
  return `agent-cancel.${hashCanonical({ childRunId, dispatchOperationId, phase })}`;
}

function agentCancelTarget(
  database: DatabaseSync,
  parent: Run,
  childRunId: string,
  expectedRevision: number,
): Run {
  const target = loadRun(database, childRunId);
  if (
    target.projectId !== parent.projectId ||
    !isStrictDescendant(database, parent.id, target.id) ||
    target.acceptedSource.kind !== 'parent_direction'
  ) {
    throw invalid('agent.cancel target must be a descendant in the same Project');
  }
  if (target.revision !== expectedRevision) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `agent.cancel target Run ${target.id} revision does not match`,
    );
  }
  if (RunTerminalStateSchema.safeParse(target.status).success) {
    throw invalid(`agent.cancel target Run ${target.id} is already terminal`);
  }
  const subtree = listRunControlSubtree(database, target);
  if (
    subtree.some(
      ({ run }) =>
        run.projectId !== parent.projectId || run.acceptedSource.kind !== 'parent_direction',
    )
  ) {
    throw corrupt(`agent.cancel target Run ${target.id} has invalid descendant lineage`);
  }
  return target;
}

function replayAgentCancelBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleAgentCancelBoundaryInput,
  cancelCall: ReturnType<typeof agentCancelCall>,
): HarnessCommit<AgentCancelBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    cancelCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, cancelCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`agent.cancel Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== AgentCancelDefinition.id ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== cancelCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(cancelCall.cancelInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.cancel Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const result = AgentCancelDefinition.parseSuccess(dispatch.outcome.data);
  const target = result.children[0]?.child;
  if (
    target?.childRunId !== cancelCall.cancelInput.childRunId ||
    target.state !== 'cancelled' ||
    new Set(result.children.map(({ child }) => child.childRunId)).size !== result.children.length
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `agent.cancel Model Attempt ${attempt.id} replay changed its target subtree`,
    );
  }
  return {
    value: { attempt: replayAttempt, dispatch, result },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleAgentCancelBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleAgentCancelBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<AgentCancelBoundaryRecord> {
  const input = parseCanonical(SettleAgentCancelBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const cancelCall = agentCancelCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayAgentCancelBoundary(database, before, input, cancelCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`agent.cancel Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      'agent.cancel',
    );
    const target = agentCancelTarget(
      database,
      parent,
      cancelCall.cancelInput.childRunId,
      cancelCall.cancelInput.expectedRevision,
    );
    const subtree = listRunControlSubtree(database, target);
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === AgentCancelDefinition.id);
    if (tool === undefined || tool.version !== AgentCancelDefinition.version) {
      throw corrupt(`agent.cancel is absent from parent Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      cancelCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`agent.cancel Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareAgentCancelRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: cancelCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(cancelCall.cancelInput)
    ) {
      throw corrupt(`agent.cancel Dispatch ${preparedDispatch.id} is not a safe unbound dispatch`);
    }

    const terminalSummary = cancelCall.cancelInput.reason.trim() || 'Cancelled by the parent Run.';
    controlRunSubtreeInTransaction(database, environment, {
      root: target,
      action: 'cancel',
      occurredAt: input.settledAt,
      context,
      subtree,
      settleActivation(run, action) {
        return settleRunControlActivationInTransaction(
          database,
          environment,
          run,
          action,
          input.settledAt,
          context,
        );
      },
      transition() {
        throw corrupt('agent.cancel cannot transition a Run without terminalizing it');
      },
      terminalize(run, commandId, terminal) {
        return terminalizeRunInTransaction(
          database,
          environment,
          run,
          'cancelled',
          commandId,
          input.settledAt,
          context,
          { summary: terminal.summary, resultIds: [...terminal.resultIds] },
        ).run;
      },
      operationCommandId: (run) =>
        agentCancelChildCommandId(preparedDispatch.id, run.id, 'operations'),
      transitionCommandId: (run) =>
        agentCancelChildCommandId(preparedDispatch.id, run.id, 'terminal'),
      terminalCommandId: (run) =>
        agentCancelChildCommandId(preparedDispatch.id, run.id, 'terminal'),
      terminalSummary,
      resultIdsForRun: (run) => childRunPublicLinks(database, run).resultRefs.map(({ id }) => id),
    });

    const children = subtree.map(({ run }) =>
      terminalChildRunSummary(database, parent, run.id, 'agent.cancel'),
    );
    const retainedArtifacts = new Set(
      children.flatMap(({ artifacts }) =>
        artifacts.map(({ kind, id, contentHash }) => `${kind}:${id}:${contentHash}`),
      ),
    );
    const result = AgentCancelDefinition.parseSuccess({
      children,
      retainedArtifactCount: retainedArtifacts.size,
      unknownOperationCount: countUnknownRunControlOperations(database, subtree),
    });
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: AgentCancelDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`agent.cancel Dispatch ${dispatch.id} settlement disappeared`);
    }
    const settledEvents = settleSuccessfulControlEvents(
      database,
      environment,
      context,
      parent,
      dispatch,
      tool,
      attempt.usage,
      input.activationNumber,
      step,
      input.settledAt,
      agentCancelSettlementCommandId(dispatch.id),
    );
    return {
      value: { attempt, dispatch, result },
      run: settledEvents.run,
      events: settledEvents.events,
    };
  });
}

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

function interactionAskResultFromDispatch(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): z.output<typeof InteractionAskDefinition.successSchema> {
  if (
    dispatch.key.toolId !== InteractionAskDefinition.id ||
    dispatch.origin.kind !== 'model' ||
    dispatch.outcome?.status !== 'succeeded' ||
    dispatch.completedAt === null
  ) {
    throw corrupt(`Dispatch ${dispatch.id} is not a settled interaction.ask`);
  }
  let askInput: z.output<typeof InteractionAskDefinition.inputSchema>;
  let result: z.output<typeof InteractionAskDefinition.successSchema>;
  try {
    askInput = InteractionAskDefinition.parseInput(dispatch.key.input as Record<string, unknown>);
    result = InteractionAskDefinition.parseSuccess(dispatch.outcome.data);
  } catch (cause) {
    throw corrupt(`interaction.ask Dispatch ${dispatch.id} payload is invalid`, cause);
  }
  const row = database
    .prepare(
      `SELECT id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
              allow_free_text, state, answer_message_id, created_at, resolved_at
       FROM run_interactions WHERE id = ?`,
    )
    .get(result.interactionId) as unknown as QuestionInteractionRow | undefined;
  if (row === undefined) {
    throw corrupt(`interaction.ask Run Interaction ${result.interactionId} was not found`);
  }
  const validResolution =
    (row.state === 'pending' && row.answer_message_id === null && row.resolved_at === null) ||
    (row.state === 'answered' && row.answer_message_id !== null && row.resolved_at !== null) ||
    (row.state === 'cancelled' && row.answer_message_id === null && row.resolved_at !== null);
  const attempt = loadModelAttemptRecord(database, dispatch.origin.modelAttemptId);
  if (
    row.run_id !== dispatch.key.runId ||
    row.kind !== 'question' ||
    row.prompt !== askInput.prompt ||
    row.options_v1_json !== canonicalJson(askInput.options) ||
    row.context_refs_v1_json !== canonicalJson(askInput.contextRefs) ||
    row.allow_free_text !== (askInput.allowFreeText ? 1 : 0) ||
    row.created_at !== dispatch.completedAt ||
    !validResolution ||
    result.state !== 'pending' ||
    result.runState !== 'waiting_question' ||
    result.runRevision !== attempt.request.runRevision + 2
  ) {
    throw corrupt(`interaction.ask Run Interaction ${result.interactionId} binding is invalid`);
  }
  return result;
}

function interactionAskSettlementCommandId(dispatchOperationId: string): string {
  return `interaction-ask.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function replayInteractionAskBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleInteractionAskBoundaryInput,
  askCall: ReturnType<typeof interactionAskCall>,
): HarnessCommit<InteractionAskBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    askCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, askCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`interaction.ask Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== InteractionAskDefinition.id ||
    dispatch.key.runId !== attempt.runId ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== askCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(askCall.askInput)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `interaction.ask Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  return {
    value: {
      attempt: replayAttempt,
      dispatch,
      result: interactionAskResultFromDispatch(database, dispatch),
    },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleInteractionAskBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleInteractionAskBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<InteractionAskBoundaryRecord> {
  const input = parseCanonical(SettleInteractionAskBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const askCall = interactionAskCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayInteractionAskBoundary(database, before, input, askCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`interaction.ask Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      InteractionAskDefinition.id,
    );
    if (askCall.askInput.expectedRunRevision !== step.observedRun.revision) {
      throw new StorageError(
        'REVISION_CONFLICT',
        `interaction.ask expected Run revision ${askCall.askInput.expectedRunRevision} changed`,
      );
    }
    if (!askCall.askInput.allowFreeText && askCall.askInput.options.length === 0) {
      throw invalid('interaction.ask without free text requires at least one option');
    }
    const optionIds = askCall.askInput.options.map(({ optionId }) => optionId);
    if (new Set(optionIds).size !== optionIds.length) {
      throw invalid('interaction.ask option IDs must be unique');
    }
    for (const ref of askCall.askInput.contextRefs) {
      requireCurrentDomainObject(database, parent.projectId, ref);
    }
    const pending = database
      .prepare("SELECT id FROM run_interactions WHERE run_id = ? AND state = 'pending' LIMIT 1")
      .get(parent.id) as { readonly id: string } | undefined;
    if (pending !== undefined) {
      throw invalid(`Run ${parent.id} already has pending Interaction ${pending.id}`);
    }
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === InteractionAskDefinition.id);
    if (tool === undefined || tool.version !== InteractionAskDefinition.version) {
      throw corrupt(`interaction.ask is absent from Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      askCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`interaction.ask Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareInteractionAskRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: askCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(askCall.askInput)
    ) {
      throw corrupt(
        `interaction.ask Dispatch ${preparedDispatch.id} is not an atomic unbound dispatch`,
      );
    }
    const interactionId = parseCanonical(EntityIdSchema, environment.createId('run_interaction'));
    database
      .prepare(
        `INSERT INTO run_interactions (
           id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
           allow_free_text, state, answer_message_id, created_at, resolved_at
         ) VALUES (?, ?, 'question', ?, ?, ?, ?, 'pending', NULL, ?, NULL)`,
      )
      .run(
        interactionId,
        parent.id,
        askCall.askInput.prompt,
        canonicalJson(askCall.askInput.options),
        canonicalJson(askCall.askInput.contextRefs),
        askCall.askInput.allowFreeText ? 1 : 0,
        input.settledAt,
      );
    const result = InteractionAskDefinition.parseSuccess({
      interactionId,
      state: 'pending',
      runState: 'waiting_question',
      runRevision: parent.revision + 1,
    });
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: InteractionAskDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`interaction.ask Dispatch ${dispatch.id} settlement disappeared`);
    }
    try {
      assertRunStateTransition(parent.status, 'waiting_question');
    } catch (cause) {
      throw invalid(`Run ${parent.id} cannot wait for a question`, cause);
    }
    const drafts: AppendRunEventBatchInput['events'] = [
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: { type: 'usage', ...attempt.usage },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'step_ended',
          activationNumber: input.activationNumber,
          turnNumber: step.turnNumber,
          stepNumber: step.stepNumber,
          outcome: 'completed',
        },
      },
      ...dispatchStartDrafts(
        environment,
        context,
        parent,
        dispatch,
        tool,
        input.activationNumber,
        step.turnNumber,
        step.stepNumber + 1,
        input.settledAt,
      ),
      {
        eventId: environment.createId('run_event'),
        visibility: 'model_surface',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'tool_result_ref',
          callId: dispatch.id,
          toolName: dispatch.key.toolId,
          outputPayloadId: dispatch.id,
          outputSchemaHash: tool.outcomeSchema.sha256,
          outputHash: dispatch.outcomeHash,
          success: true,
        },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'tool_summary',
          toolName: dispatch.key.toolId,
          status: 'succeeded',
          summary: askCall.askInput.prompt,
        },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'step_ended',
          activationNumber: input.activationNumber,
          turnNumber: step.turnNumber,
          stepNumber: step.stepNumber + 1,
          outcome: 'completed',
        },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'activation_changed',
          activationNumber: input.activationNumber,
          state: 'ended',
          endReason: 'waiting',
        },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'run_state_changed',
          previousState: parent.status,
          state: 'waiting_question',
          runRevision: parent.revision + 1,
        },
      },
    ];
    const activationOrdinal = drafts.length - 2;
    const events = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: interactionAskSettlementCommandId(dispatch.id),
      events: drafts,
    });
    const activationEvent = events[activationOrdinal];
    const head = events.at(-1);
    if (activationEvent === undefined || head === undefined) {
      throw corrupt(`Run ${parent.id} interaction.ask events are incomplete`);
    }
    closeRunActivation(
      database,
      storedActivation,
      activationEvent.sequence,
      input.settledAt,
      'waiting',
    );
    const run = advanceRunJournalHead(
      database,
      parent,
      { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
      { status: 'waiting_question', terminalOutcome: null },
    );
    if (run.revision !== result.runRevision) {
      throw corrupt(`interaction.ask Run ${run.id} revision changed during settlement`);
    }
    return { value: { attempt, dispatch, result }, run, events };
  });
}

function deliveryFreezeSettlementCommandId(dispatchOperationId: string): string {
  return `delivery-freeze.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function replayDeliveryFreezeBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleDeliveryFreezeBoundaryInput,
  freezeCall: ReturnType<typeof deliveryFreezeCall>,
): HarnessCommit<DeliveryFreezeBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    freezeCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, freezeCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`delivery.freeze Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== DeliveryFreezeDefinition.id ||
    dispatch.key.runId !== attempt.runId ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== freezeCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(freezeCall.freezeInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `delivery.freeze Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const result = DeliveryFreezeDefinition.parseSuccess(dispatch.outcome.data);
  if (
    result.sourcePlan.id !== freezeCall.freezeInput.plan.id ||
    result.sourcePlan.revision !== freezeCall.freezeInput.plan.revision ||
    result.sourcePlan.contentHash !== freezeCall.freezeInput.plan.contentHash ||
    canonicalJson(loadDeliveryManifest(database, result.id)) !== canonicalJson(result)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `delivery.freeze Dispatch ${dispatch.id} replay changed its Manifest`,
    );
  }
  const event = database
    .prepare(
      `SELECT event.project_id, event.event_type, event.subject_authority, event.subject_id,
              payload.payload_v1_json
       FROM project_events AS event
       JOIN project_event_payloads AS payload ON payload.project_event_id = event.id
       WHERE event.project_id = ? AND event.idempotency_key = ?`,
    )
    .get(result.projectId, deliveryFreezeCommandId(freezeCall.freezeInput)) as
    | {
        readonly project_id: string;
        readonly event_type: string;
        readonly subject_authority: string;
        readonly subject_id: string;
        readonly payload_v1_json: string | null;
      }
    | undefined;
  if (
    event === undefined ||
    event.project_id !== result.projectId ||
    event.event_type !== 'delivery_changed' ||
    event.subject_authority !== 'delivery' ||
    event.subject_id !== result.sourcePlan.id ||
    event.payload_v1_json !==
      canonicalJson({
        type: 'delivery_changed',
        deliveryId: result.sourcePlan.id,
        beforeRevision: result.sourcePlan.revision,
        afterRevision: result.sourcePlan.revision,
        manifestHash: result.contentHash,
      })
  ) {
    throw corrupt(`delivery.freeze Dispatch ${dispatch.id} Project event binding is invalid`);
  }
  return {
    value: { attempt: replayAttempt, dispatch, result },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleDeliveryFreezeBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleDeliveryFreezeBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<DeliveryFreezeBoundaryRecord> {
  const input = parseCanonical(SettleDeliveryFreezeBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const freezeCall = deliveryFreezeCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayDeliveryFreezeBoundary(database, before, input, freezeCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`delivery.freeze Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      DeliveryFreezeDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(
        `delivery.freeze Model Attempt ${before.id} requires its Commander Run context`,
      );
    }
    requireCurrentDomainObject(database, parent.projectId, freezeCall.freezeInput.plan);
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === DeliveryFreezeDefinition.id);
    if (tool === undefined || tool.version !== DeliveryFreezeDefinition.version) {
      throw corrupt(`delivery.freeze is absent from Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      freezeCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`delivery.freeze Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareDeliveryFreezeRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: freezeCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(freezeCall.freezeInput)
    ) {
      throw corrupt(
        `delivery.freeze Dispatch ${preparedDispatch.id} is not an atomic unbound dispatch`,
      );
    }
    const result = freezeDeliveryInTransaction(
      database,
      environment,
      freezeCall.freezeInput,
      context,
      input.settledAt,
    );
    if (
      result.projectId !== parent.projectId ||
      result.sourcePlan.id !== freezeCall.freezeInput.plan.id ||
      result.sourcePlan.revision !== freezeCall.freezeInput.plan.revision ||
      result.sourcePlan.contentHash !== freezeCall.freezeInput.plan.contentHash
    ) {
      throw corrupt(`delivery.freeze Dispatch ${preparedDispatch.id} changed its Project owner`);
    }
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: DeliveryFreezeDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`delivery.freeze Dispatch ${dispatch.id} settlement disappeared`);
    }
    const settledEvents = settleSuccessfulControlEvents(
      database,
      environment,
      context,
      parent,
      dispatch,
      tool,
      attempt.usage,
      input.activationNumber,
      step,
      input.settledAt,
      deliveryFreezeSettlementCommandId(dispatch.id),
    );
    return {
      value: { attempt, dispatch, result },
      run: settledEvents.run,
      events: settledEvents.events,
    };
  });
}

function deliveryExportStartCommandId(dispatchOperationId: string): string {
  return `delivery-export.${hashCanonical({ dispatchOperationId, phase: 'start' })}`;
}

function deliveryExportSettlementCommandId(dispatchOperationId: string): string {
  return `delivery-export.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function deliveryExportCatalogTool(
  database: DatabaseSync,
  parent: Run,
): CapabilityCatalogSnapshotV1['tools'][number] {
  const { catalog } = loadRunSnapshots(database, parent);
  const tool = catalog.tools.find(({ id }) => id === DeliveryExportDefinition.id);
  if (
    tool === undefined ||
    tool.version !== DeliveryExportDefinition.version ||
    canonicalJson(tool.metadata) !== canonicalJson(DeliveryExportDefinition.metadata)
  ) {
    throw corrupt(`delivery.export is absent or invalid in Run ${parent.id}'s frozen catalog`);
  }
  return tool;
}

function deliveryExportExpectedResult(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): z.output<typeof DeliveryExportDefinition.successSchema> | null {
  if (
    dispatch.key.toolId !== DeliveryExportDefinition.id ||
    dispatch.key.authorityWatermarkHash !== null
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} has invalid dispatch semantics`);
  }
  const unbound =
    dispatch.operationKind === null &&
    dispatch.ownerAuthority === null &&
    dispatch.ownerId === null &&
    dispatch.projectEventId === null;
  if (unbound) return null;
  if (
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.operationKind !== 'delivery_export' ||
    dispatch.ownerAuthority !== 'delivery_export' ||
    dispatch.ownerId === null ||
    dispatch.projectEventId !== null
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} has an invalid Export owner`);
  }
  const result = DeliveryExportDefinition.parseSuccess({
    ...deliveryExportSuccessForDispatch(database, dispatch.id),
  });
  if (
    result.operation.id !== dispatch.id ||
    result.operation.kind !== 'delivery_export' ||
    result.operation.ownerRef.authority !== 'delivery_export' ||
    result.operation.ownerRef.id !== dispatch.ownerId ||
    result.exportId !== dispatch.ownerId
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} public Operation is invalid`);
  }
  return result;
}

interface DeliveryExportConfirmationRecord {
  readonly id: string;
  readonly interactionId: string;
  readonly immutableInputHash: string;
  readonly requestedAt: string;
  readonly decision: 'approved' | 'denied' | null;
  readonly messageId: string | null;
  readonly decidedAt: string | null;
  readonly target: DeliveryExportConfirmationTarget;
}

function deliveryExportConfirmationTarget(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
  exportInput: z.output<typeof DeliveryExportDefinition.inputSchema>,
): DeliveryExportConfirmationTarget {
  const manifest = loadDeliveryManifest(database, exportInput.manifest.id);
  if (
    manifest.projectId !== dispatch.key.projectId ||
    manifest.revision !== exportInput.manifest.revision ||
    manifest.contentHash !== exportInput.manifest.contentHash
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} Manifest changed during confirmation`);
  }
  return deliveryExportConfirmationTargetFor(manifest, exportInput);
}

function deliveryExportConfirmation(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
  exportInput: z.output<typeof DeliveryExportDefinition.inputSchema>,
): DeliveryExportConfirmationRecord {
  if (dispatch.confirmationId === null) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} has no Run Confirmation`);
  }
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
    .get(dispatch.confirmationId) as unknown as
    | {
        readonly id: string;
        readonly run_id: string;
        readonly interaction_id: string;
        readonly target_v1_json: string;
        readonly immutable_input_hash: string;
        readonly decision: 'approved' | 'denied' | null;
        readonly decided_by_message_id: string | null;
        readonly requested_at: string;
        readonly decided_at: string | null;
        readonly interaction_run_id: string;
        readonly interaction_kind: string;
        readonly interaction_state: string;
        readonly answer_message_id: string | null;
        readonly resolved_at: string | null;
      }
    | undefined;
  if (row === undefined) {
    throw corrupt(`delivery.export Confirmation ${dispatch.confirmationId} was not found`);
  }
  let target: z.output<typeof ConfirmationTargetSchema>;
  let requestedAt: string;
  let decidedAt: string | null;
  try {
    target = parseCanonical(ConfirmationTargetSchema, JSON.parse(row.target_v1_json) as unknown);
    requestedAt = parseCanonical(IsoTimestampSchema, row.requested_at);
    decidedAt = row.decided_at === null ? null : parseCanonical(IsoTimestampSchema, row.decided_at);
  } catch (cause) {
    throw corrupt(`delivery.export Confirmation ${row.id} is invalid`, cause);
  }
  const pending =
    dispatch.guardOutcome === 'confirmation_required' &&
    dispatch.outcome === null &&
    row.interaction_state === 'pending' &&
    row.answer_message_id === null &&
    row.resolved_at === null &&
    row.decision === null &&
    row.decided_by_message_id === null &&
    decidedAt === null;
  const approved =
    dispatch.guardOutcome === 'allowed' &&
    row.interaction_state === 'answered' &&
    row.answer_message_id !== null &&
    row.resolved_at !== null &&
    row.decision === 'approved' &&
    row.decided_by_message_id === row.answer_message_id &&
    decidedAt !== null;
  const denied =
    dispatch.guardOutcome === 'denied' &&
    dispatch.outcome?.status === 'permission_denied' &&
    dispatch.outcome.code === 'protected_denied' &&
    row.interaction_state === 'answered' &&
    row.answer_message_id !== null &&
    row.resolved_at !== null &&
    row.decision === 'denied' &&
    row.decided_by_message_id === row.answer_message_id &&
    decidedAt !== null;
  const expectedTarget = deliveryExportConfirmationTarget(database, dispatch, exportInput);
  if (
    row.run_id !== dispatch.key.runId ||
    row.interaction_run_id !== dispatch.key.runId ||
    row.interaction_kind !== 'confirmation' ||
    row.immutable_input_hash !== dispatch.key.inputHash ||
    canonicalJson(target) !== row.target_v1_json ||
    target.kind !== 'delivery_export' ||
    canonicalJson(target) !== canonicalJson(expectedTarget) ||
    (!pending && !approved && !denied)
  ) {
    throw corrupt(`delivery.export Confirmation ${row.id} binding is invalid`);
  }
  return Object.freeze({
    id: row.id,
    interactionId: row.interaction_id,
    immutableInputHash: row.immutable_input_hash,
    requestedAt,
    decision: row.decision,
    messageId: row.answer_message_id,
    decidedAt,
    target,
  });
}

function assertDeliveryExportResultOwner(
  dispatch: OperationDispatchRecord,
  result: z.output<typeof DeliveryExportDefinition.successSchema>,
): void {
  if (
    dispatch.ownerId === null ||
    result.operation.id !== dispatch.id ||
    result.operation.kind !== 'delivery_export' ||
    result.operation.ownerRef.authority !== 'delivery_export' ||
    result.operation.ownerRef.id !== dispatch.ownerId ||
    result.exportId !== dispatch.ownerId
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} result changed its owner`);
  }
}

function loadDeliveryExportBoundary(
  database: DatabaseSync,
  dispatchOperationId: string,
): DeliveryExportBoundaryRecord {
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  const origin = dispatch.origin;
  if (dispatch.key.toolId !== DeliveryExportDefinition.id || origin.kind !== 'model') {
    throw invalid(`Dispatch ${dispatch.id} is not a delivery.export model dispatch`);
  }
  const attempt = loadModelAttemptRecord(database, origin.modelAttemptId);
  const parent = loadRun(database, dispatch.key.runId);
  const storedActivation = loadRunActivation(database, parent.id, attempt.request.activationNumber);
  if (
    attempt.state !== 'succeeded' ||
    attempt.response === null ||
    attempt.runId !== parent.id ||
    storedActivation === null ||
    storedActivation.id !== attempt.activationId
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} has an invalid model boundary`);
  }
  const call = deliveryExportCall(attempt.response, origin.providerCallId);
  if (
    canonicalJson(call.exportInput) !== canonicalJson(dispatch.key.input) ||
    dispatch.key.projectId !== parent.projectId
  ) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} does not match its model call`);
  }
  deliveryExportCatalogTool(database, parent);
  const confirmation = deliveryExportConfirmation(database, dispatch, call.exportInput);
  const expected = deliveryExportExpectedResult(database, dispatch);
  let result: z.output<typeof DeliveryExportDefinition.successSchema> | null = expected;
  if (dispatch.outcome !== null) {
    if (dispatch.outcome.status === 'succeeded') {
      if (expected === null) {
        throw corrupt(`delivery.export Dispatch ${dispatch.id} succeeded without an owner`);
      }
      result = DeliveryExportDefinition.parseSuccess(dispatch.outcome.data);
      assertDeliveryExportResultOwner(dispatch, result);
    } else if (
      dispatch.outcome.status === 'permission_denied' &&
      dispatch.guardOutcome === 'denied' &&
      dispatch.outcome.code === 'protected_denied' &&
      expected === null
    ) {
      result = null;
    } else {
      throw corrupt(`delivery.export Dispatch ${dispatch.id} has an invalid outcome`);
    }
  }
  return Object.freeze({
    attempt,
    dispatch,
    parent,
    activation: storedActivation.activation,
    confirmationId: confirmation.id,
    target: confirmation.target,
    result,
  });
}

function replayDeliveryExportStartBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleDeliveryExportStartBoundaryInput,
  exportCall: ReturnType<typeof deliveryExportCall>,
): HarnessCommit<DeliveryExportBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    exportCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, exportCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`delivery.export Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const boundary = loadDeliveryExportBoundary(database, row.id);
  if (
    boundary.dispatch.origin.kind !== 'model' ||
    boundary.dispatch.origin.modelAttemptId !== attempt.id ||
    boundary.dispatch.origin.providerCallId !== exportCall.call.providerCallId ||
    canonicalJson(boundary.dispatch.key.input) !== canonicalJson(exportCall.exportInput)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `delivery.export Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  return {
    value: { ...boundary, attempt: replayAttempt },
    run: boundary.parent,
    events: [],
  };
}

function settleDeliveryExportStartBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleDeliveryExportStartBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<DeliveryExportBoundaryRecord> {
  const input = parseCanonical(SettleDeliveryExportStartBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const exportCall = deliveryExportCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayDeliveryExportStartBoundary(database, before, input, exportCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`delivery.export Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      DeliveryExportDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(
        `delivery.export Model Attempt ${before.id} requires its Commander Run context`,
      );
    }
    assertDeliveryExportModelBoundary(database, parent, exportCall.exportInput);
    const tool = deliveryExportCatalogTool(database, parent);
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      exportCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`delivery.export Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const initialDispatch = prepareDeliveryExportRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: exportCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      initialDispatch.guardOutcome !== 'confirmation_required' ||
      initialDispatch.confirmationId !== null ||
      initialDispatch.outcome !== null ||
      initialDispatch.operationKind !== null ||
      initialDispatch.ownerAuthority !== null ||
      initialDispatch.ownerId !== null ||
      initialDispatch.projectEventId !== null ||
      canonicalJson(initialDispatch.key.input) !== canonicalJson(exportCall.exportInput)
    ) {
      throw corrupt(`delivery.export Dispatch ${initialDispatch.id} is not safely unbound`);
    }
    const target = deliveryExportConfirmationTarget(
      database,
      initialDispatch,
      exportCall.exportInput,
    );
    const interactionId = parseCanonical(EntityIdSchema, environment.createId('run_interaction'));
    const confirmationId = parseCanonical(EntityIdSchema, environment.createId('run_confirmation'));
    const summary = `Approve delivery export to ${exportCall.exportInput.destination.displayLabel}.`;
    database
      .prepare(
        `INSERT INTO run_interactions (
           id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
           allow_free_text, state, answer_message_id, created_at, resolved_at
         ) VALUES (?, ?, 'confirmation', ?, '[]', '[]', 0, 'pending', NULL, ?, NULL)`,
      )
      .run(interactionId, parent.id, summary, input.settledAt);
    database
      .prepare(
        `INSERT INTO run_confirmations (
           id, run_id, interaction_id, target_v1_json, immutable_input_hash,
           decision, decided_by_message_id, requested_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
      )
      .run(
        confirmationId,
        parent.id,
        interactionId,
        canonicalJson(target),
        initialDispatch.key.inputHash,
        input.settledAt,
      );
    const dispatch = bindRuntimeDispatchConfirmation(database, {
      dispatchOperationId: initialDispatch.id,
      confirmationId,
      occurredAt: input.settledAt,
    });
    try {
      assertRunStateTransition(parent.status, 'waiting_confirmation');
    } catch (cause) {
      throw invalid(`Run ${parent.id} cannot wait for delivery export confirmation`, cause);
    }
    const events = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: deliveryExportStartCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...dispatchStartDrafts(
          environment,
          context,
          parent,
          dispatch,
          tool,
          input.activationNumber,
          step.turnNumber,
          step.stepNumber + 1,
          input.settledAt,
        ),
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'confirmation_requested',
            interactionId,
            confirmationId,
            summary,
            target,
            immutableInputHash: dispatch.key.inputHash,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'run_state_changed',
            previousState: parent.status,
            state: 'waiting_confirmation',
            runRevision: parent.revision + 1,
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined) {
      throw corrupt(`delivery.export Dispatch ${dispatch.id} emitted no confirmation events`);
    }
    const run = advanceRunJournalHead(
      database,
      parent,
      { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
      { status: 'waiting_confirmation', terminalOutcome: null },
    );
    return {
      value: {
        attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        confirmationId,
        target,
        result: null,
      },
      run,
      events,
    };
  });
}

function settleDeliveryExportBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleDeliveryExportBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<DeliveryExportBoundaryRecord> {
  const input = parseCanonical(SettleDeliveryExportBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const boundary = loadDeliveryExportBoundary(database, input.dispatchOperationId);
    if (input.activationNumber !== boundary.attempt.request.activationNumber) {
      throw invalid(
        `delivery.export Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    if (boundary.dispatch.outcome !== null) {
      if (
        boundary.dispatch.outcome.status !== 'succeeded' ||
        boundary.result === null ||
        canonicalJson(input.result) !== canonicalJson(boundary.result)
      ) {
        throw new StorageError(
          'IDEMPOTENCY_CONFLICT',
          `delivery.export Dispatch ${boundary.dispatch.id} replay changed its result`,
        );
      }
      return { value: boundary, run: boundary.parent, events: [] };
    }
    if (boundary.dispatch.guardOutcome !== 'allowed') {
      throw invalid(`delivery.export Dispatch ${boundary.dispatch.id} is not approved`);
    }
    if (boundary.parent.status !== 'running') {
      throw invalid(`delivery.export Run ${boundary.parent.id} is not running`);
    }
    const storedActivation = activeActivation(database, boundary.parent.id, input.activationNumber);
    if (storedActivation.id !== boundary.attempt.activationId) {
      throw invalid(
        `delivery.export Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    const expected = deliveryExportExpectedResult(database, boundary.dispatch);
    if (expected === null || canonicalJson(input.result) !== canonicalJson(expected)) {
      throw corrupt(`delivery.export Dispatch ${boundary.dispatch.id} result changed its owner`);
    }
    const journal = loadRunEvents(database, boundary.parent.id);
    const open = openDispatchStep(journal, input.activationNumber, boundary.dispatch.id);
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: boundary.dispatch.id,
      outcome: DeliveryExportDefinition.parseOutcome({ status: 'succeeded', data: expected }),
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`delivery.export Dispatch ${dispatch.id} settlement disappeared`);
    }
    const tool = deliveryExportCatalogTool(database, boundary.parent);
    const events = appendRunEventBatch(database, {
      runId: boundary.parent.id,
      commandId: deliveryExportSettlementCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: DeliveryExportDefinition.id,
            status: 'succeeded',
            summary: `Tool ${DeliveryExportDefinition.id} succeeded`,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: open.turnNumber,
            stepNumber: open.stepNumber,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined) {
      throw corrupt(`delivery.export Dispatch ${dispatch.id} emitted no settlement events`);
    }
    const run = advanceRunJournalHead(database, boundary.parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: {
        attempt: boundary.attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        confirmationId: boundary.confirmationId,
        target: boundary.target,
        result: expected,
      },
      run,
      events,
    };
  });
}

function deliveryPreviewStartCommandId(dispatchOperationId: string): string {
  return `delivery-preview.${hashCanonical({ dispatchOperationId, phase: 'start' })}`;
}

function deliveryPreviewSettlementCommandId(dispatchOperationId: string): string {
  return `delivery-preview.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function deliveryPreviewCatalogTool(
  database: DatabaseSync,
  parent: Run,
): CapabilityCatalogSnapshotV1['tools'][number] {
  const { catalog } = loadRunSnapshots(database, parent);
  const tool = catalog.tools.find(({ id }) => id === DeliveryPreviewDefinition.id);
  if (
    tool === undefined ||
    tool.version !== DeliveryPreviewDefinition.version ||
    canonicalJson(tool.metadata) !== canonicalJson(DeliveryPreviewDefinition.metadata)
  ) {
    throw corrupt(`delivery.preview is absent or invalid in Run ${parent.id}'s frozen catalog`);
  }
  return tool;
}

function deliveryPreviewExpectedResult(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): z.output<typeof DeliveryPreviewDefinition.successSchema> {
  const bound = loadBoundOperation(database, dispatch.id);
  if (
    dispatch.key.toolId !== DeliveryPreviewDefinition.id ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.operationKind !== 'review_cut_attempt' ||
    dispatch.ownerAuthority !== 'review_cut_attempt' ||
    bound.owner.authority !== 'review_cut_attempt' ||
    bound.owner.projectId !== dispatch.key.projectId ||
    bound.owner.runId !== dispatch.key.runId
  ) {
    throw corrupt(`delivery.preview Dispatch ${dispatch.id} has an invalid Review Cut owner`);
  }
  const input = DeliveryPreviewDefinition.parseInput(dispatch.key.input as Record<string, unknown>);
  const owner = parseCanonical(ReviewCutAttemptSchema, bound.owner.view);
  const manifest = loadDeliveryManifest(database, owner.manifest.id);
  if (
    manifest.projectId !== dispatch.key.projectId ||
    manifest.revision !== owner.manifest.revision ||
    manifest.contentHash !== owner.manifest.contentHash ||
    canonicalJson(manifest.sourcePlan) !== canonicalJson(input.plan) ||
    canonicalJson(owner.request.range) !== canonicalJson(input.range)
  ) {
    throw corrupt(`delivery.preview Dispatch ${dispatch.id} changed its exact source`);
  }
  const publicView = operationPublicViewForOwner(
    database,
    dispatch.id,
    bound.owner,
    dispatch.key.input,
  );
  if (
    publicView.ref.kind !== 'review_cut_attempt' ||
    publicView.ref.ownerRef.authority !== 'review_cut_attempt' ||
    publicView.ref.ownerRef.id !== owner.id ||
    publicView.artifacts.length > 1
  ) {
    throw corrupt(`delivery.preview Dispatch ${dispatch.id} public Operation is invalid`);
  }
  return DeliveryPreviewDefinition.parseSuccess({
    operation: publicView.ref,
    attemptId: owner.id,
    state: owner.state,
    artifact: publicView.artifacts[0] ?? null,
    warnings: [],
    usage: { state: 'known', value: '0', currency: 'USD' },
  });
}

function loadDeliveryPreviewBoundary(
  database: DatabaseSync,
  dispatchOperationId: string,
): DeliveryPreviewBoundaryRecord {
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  const origin = dispatch.origin;
  if (dispatch.key.toolId !== DeliveryPreviewDefinition.id || origin.kind !== 'model') {
    throw invalid(`Dispatch ${dispatch.id} is not a delivery.preview model dispatch`);
  }
  const attempt = loadModelAttemptRecord(database, origin.modelAttemptId);
  const parent = loadRun(database, dispatch.key.runId);
  const storedActivation = loadRunActivation(database, parent.id, attempt.request.activationNumber);
  if (
    attempt.state !== 'succeeded' ||
    attempt.response === null ||
    attempt.runId !== parent.id ||
    storedActivation === null ||
    storedActivation.id !== attempt.activationId
  ) {
    throw corrupt(`delivery.preview Dispatch ${dispatch.id} has an invalid model boundary`);
  }
  const call = deliveryPreviewCall(attempt.response, origin.providerCallId);
  if (
    canonicalJson(call.previewInput) !== canonicalJson(dispatch.key.input) ||
    dispatch.key.projectId !== parent.projectId
  ) {
    throw corrupt(`delivery.preview Dispatch ${dispatch.id} does not match its model call`);
  }
  deliveryPreviewCatalogTool(database, parent);
  const expected = deliveryPreviewExpectedResult(database, dispatch);
  let result: z.output<typeof DeliveryPreviewDefinition.successSchema> | null = null;
  if (dispatch.outcome !== null) {
    if (dispatch.outcome.status !== 'succeeded') {
      throw corrupt(`delivery.preview Dispatch ${dispatch.id} has a non-success outcome`);
    }
    result = DeliveryPreviewDefinition.parseSuccess(dispatch.outcome.data);
    if (canonicalJson(result) !== canonicalJson(expected)) {
      throw corrupt(`delivery.preview Dispatch ${dispatch.id} outcome changed its owner result`);
    }
  }
  return Object.freeze({
    attempt,
    dispatch,
    parent,
    activation: storedActivation.activation,
    result,
  });
}

function replayDeliveryPreviewStartBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleDeliveryPreviewStartBoundaryInput,
  previewCall: ReturnType<typeof deliveryPreviewCall>,
): HarnessCommit<DeliveryPreviewBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    previewCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, previewCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`delivery.preview Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const boundary = loadDeliveryPreviewBoundary(database, row.id);
  if (
    boundary.dispatch.origin.kind !== 'model' ||
    boundary.dispatch.origin.modelAttemptId !== attempt.id ||
    boundary.dispatch.origin.providerCallId !== previewCall.call.providerCallId ||
    canonicalJson(boundary.dispatch.key.input) !== canonicalJson(previewCall.previewInput)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `delivery.preview Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  return {
    value: { ...boundary, attempt: replayAttempt },
    run: boundary.parent,
    events: [],
  };
}

function settleDeliveryPreviewStartBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleDeliveryPreviewStartBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<DeliveryPreviewBoundaryRecord> {
  const input = parseCanonical(SettleDeliveryPreviewStartBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const previewCall = deliveryPreviewCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayDeliveryPreviewStartBoundary(database, before, input, previewCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`delivery.preview Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      DeliveryPreviewDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(
        `delivery.preview Model Attempt ${before.id} requires its Commander Run context`,
      );
    }
    requireCurrentDomainObject(database, parent.projectId, previewCall.previewInput.plan);
    const tool = deliveryPreviewCatalogTool(database, parent);
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      previewCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`delivery.preview Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const dispatch = prepareDeliveryPreviewRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: previewCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      dispatch.guardOutcome !== 'allowed' ||
      dispatch.outcome !== null ||
      dispatch.operationKind !== null ||
      dispatch.ownerAuthority !== null ||
      dispatch.ownerId !== null ||
      canonicalJson(dispatch.key.input) !== canonicalJson(previewCall.previewInput)
    ) {
      throw corrupt(`delivery.preview Dispatch ${dispatch.id} is not a safe unbound dispatch`);
    }
    const startEvents = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: deliveryPreviewStartCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...dispatchStartDrafts(
          environment,
          context,
          parent,
          dispatch,
          tool,
          input.activationNumber,
          step.turnNumber,
          step.stepNumber + 1,
          input.settledAt,
        ),
      ],
    });
    const startHead = startEvents.at(-1);
    if (startHead === undefined) {
      throw corrupt(`delivery.preview Dispatch ${dispatch.id} emitted no start events`);
    }
    advanceRunJournalHead(database, parent, {
      eventId: startHead.eventId,
      sequence: startHead.sequence,
      eventHash: startHead.eventHash,
    });
    const manifest = freezeDeliveryInTransaction(
      database,
      environment,
      { plan: previewCall.previewInput.plan },
      context,
      input.settledAt,
    );
    prepareReviewCutInTransaction(
      database,
      environment,
      dispatch.key,
      previewCall.previewInput,
      manifest,
      deliveryPreviewStartCommandId(dispatch.id),
      context,
      dispatch.id,
    );
    const boundary = loadDeliveryPreviewBoundary(database, dispatch.id);
    return {
      value: { ...boundary, attempt },
      run: boundary.parent,
      events: startEvents,
    };
  });
}

function settleDeliveryPreviewBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleDeliveryPreviewBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<DeliveryPreviewBoundaryRecord> {
  const input = parseCanonical(SettleDeliveryPreviewBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const boundary = loadDeliveryPreviewBoundary(database, input.dispatchOperationId);
    if (input.activationNumber !== boundary.attempt.request.activationNumber) {
      throw invalid(
        `delivery.preview Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    const expected = deliveryPreviewExpectedResult(database, boundary.dispatch);
    if (canonicalJson(input.result) !== canonicalJson(expected)) {
      throw corrupt(`delivery.preview Dispatch ${boundary.dispatch.id} result changed its owner`);
    }
    if (boundary.dispatch.outcome !== null) {
      if (boundary.result === null) {
        throw corrupt(`delivery.preview Dispatch ${boundary.dispatch.id} replay has no result`);
      }
      return { value: boundary, run: boundary.parent, events: [] };
    }
    if (boundary.parent.status !== 'running') {
      throw invalid(`delivery.preview Run ${boundary.parent.id} is not running`);
    }
    const storedActivation = activeActivation(database, boundary.parent.id, input.activationNumber);
    if (storedActivation.id !== boundary.attempt.activationId) {
      throw invalid(
        `delivery.preview Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    const journal = loadRunEvents(database, boundary.parent.id);
    const open = openDispatchStep(journal, input.activationNumber, boundary.dispatch.id);
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: boundary.dispatch.id,
      outcome: DeliveryPreviewDefinition.parseOutcome({ status: 'succeeded', data: expected }),
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`delivery.preview Dispatch ${dispatch.id} settlement disappeared`);
    }
    const tool = deliveryPreviewCatalogTool(database, boundary.parent);
    const events = appendRunEventBatch(database, {
      runId: boundary.parent.id,
      commandId: deliveryPreviewSettlementCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: DeliveryPreviewDefinition.id,
            status: 'succeeded',
            summary: `Tool ${DeliveryPreviewDefinition.id} succeeded`,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: open.turnNumber,
            stepNumber: open.stepNumber,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined) {
      throw corrupt(`delivery.preview Dispatch ${dispatch.id} emitted no settlement events`);
    }
    const run = advanceRunJournalHead(database, boundary.parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: {
        attempt: boundary.attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        result: expected,
      },
      run,
      events,
    };
  });
}

function evaluationRunStartCommandId(dispatchOperationId: string): string {
  return `evaluation-run.${hashCanonical({ dispatchOperationId, phase: 'start' })}`;
}

function evaluationRunSettlementCommandId(dispatchOperationId: string): string {
  return `evaluation-run.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function evaluationRunCatalogTool(
  database: DatabaseSync,
  parent: Run,
): CapabilityCatalogSnapshotV1['tools'][number] {
  const { catalog } = loadRunSnapshots(database, parent);
  const tool = catalog.tools.find(({ id }) => id === EvaluationRunDefinition.id);
  if (
    tool === undefined ||
    tool.version !== EvaluationRunDefinition.version ||
    canonicalJson(tool.metadata) !== canonicalJson(EvaluationRunDefinition.metadata)
  ) {
    throw corrupt(`evaluation.run is absent or invalid in Run ${parent.id}'s frozen catalog`);
  }
  return tool;
}

function evaluationRunExpectedResult(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): z.output<typeof EvaluationRunDefinition.successSchema> | null {
  if (
    dispatch.key.toolId !== EvaluationRunDefinition.id ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.key.authorityWatermarkHash !== null
  ) {
    throw corrupt(`evaluation.run Dispatch ${dispatch.id} has invalid dispatch semantics`);
  }
  const unbound =
    dispatch.operationKind === null &&
    dispatch.ownerAuthority === null &&
    dispatch.ownerId === null &&
    dispatch.projectEventId === null;
  if (unbound) return null;
  if (
    dispatch.operationKind !== 'result_assessment' ||
    dispatch.ownerAuthority !== 'result_assessment_attempt' ||
    dispatch.ownerId === null
  ) {
    throw corrupt(`evaluation.run Dispatch ${dispatch.id} has an invalid Assessment owner`);
  }
  const result = EvaluationRunDefinition.parseSuccess(
    resultAssessmentSuccessForDispatch(database, dispatch.id),
  );
  if (
    result.operation.id !== dispatch.id ||
    result.operation.kind !== 'result_assessment' ||
    result.operation.ownerRef.authority !== 'result_assessment_attempt' ||
    result.operation.ownerRef.id !== dispatch.ownerId ||
    result.assessmentId !== dispatch.ownerId
  ) {
    throw corrupt(`evaluation.run Dispatch ${dispatch.id} public Operation is invalid`);
  }
  return result;
}

function loadEvaluationRunBoundary(
  database: DatabaseSync,
  dispatchOperationId: string,
): EvaluationRunBoundaryRecord {
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  const origin = dispatch.origin;
  if (dispatch.key.toolId !== EvaluationRunDefinition.id || origin.kind !== 'model') {
    throw invalid(`Dispatch ${dispatch.id} is not an evaluation.run model dispatch`);
  }
  const attempt = loadModelAttemptRecord(database, origin.modelAttemptId);
  const parent = loadRun(database, dispatch.key.runId);
  const storedActivation = loadRunActivation(database, parent.id, attempt.request.activationNumber);
  if (
    attempt.state !== 'succeeded' ||
    attempt.response === null ||
    attempt.runId !== parent.id ||
    storedActivation === null ||
    storedActivation.id !== attempt.activationId
  ) {
    throw corrupt(`evaluation.run Dispatch ${dispatch.id} has an invalid model boundary`);
  }
  const call = evaluationRunCall(attempt.response, origin.providerCallId);
  if (
    canonicalJson(call.evaluationInput) !== canonicalJson(dispatch.key.input) ||
    dispatch.key.projectId !== parent.projectId
  ) {
    throw corrupt(`evaluation.run Dispatch ${dispatch.id} does not match its model call`);
  }
  evaluationRunCatalogTool(database, parent);
  const expected = evaluationRunExpectedResult(database, dispatch);
  let result = expected;
  if (dispatch.outcome !== null) {
    if (dispatch.outcome.status !== 'succeeded' || expected === null) {
      throw corrupt(`evaluation.run Dispatch ${dispatch.id} has an invalid outcome`);
    }
    const settled = EvaluationRunDefinition.parseSuccess(dispatch.outcome.data);
    if (canonicalJson(settled) !== canonicalJson(expected)) {
      throw corrupt(`evaluation.run Dispatch ${dispatch.id} outcome changed its owner result`);
    }
    result = settled;
  }
  return Object.freeze({
    attempt,
    dispatch,
    parent,
    activation: storedActivation.activation,
    result,
  });
}

function replayEvaluationRunStartBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleEvaluationRunStartBoundaryInput,
  evaluationCall: ReturnType<typeof evaluationRunCall>,
): HarnessCommit<EvaluationRunBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    evaluationCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, evaluationCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`evaluation.run Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const boundary = loadEvaluationRunBoundary(database, row.id);
  if (
    boundary.dispatch.origin.kind !== 'model' ||
    boundary.dispatch.origin.modelAttemptId !== attempt.id ||
    boundary.dispatch.origin.providerCallId !== evaluationCall.call.providerCallId ||
    canonicalJson(boundary.dispatch.key.input) !== canonicalJson(evaluationCall.evaluationInput)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `evaluation.run Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  return {
    value: { ...boundary, attempt: replayAttempt },
    run: boundary.parent,
    events: [],
  };
}

function settleEvaluationRunStartBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleEvaluationRunStartBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<EvaluationRunBoundaryRecord> {
  const input = parseCanonical(SettleEvaluationRunStartBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const evaluationCall = evaluationRunCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayEvaluationRunStartBoundary(database, before, input, evaluationCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`evaluation.run Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      EvaluationRunDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(`evaluation.run Model Attempt ${before.id} requires its Commander Run context`);
    }
    assertEvaluationRunModelBoundary(database, parent, evaluationCall.evaluationInput);
    const tool = evaluationRunCatalogTool(database, parent);
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      evaluationCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`evaluation.run Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const dispatch = prepareEvaluationRunRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: evaluationCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      dispatch.guardOutcome !== 'allowed' ||
      dispatch.outcome !== null ||
      dispatch.operationKind !== null ||
      dispatch.ownerAuthority !== null ||
      dispatch.ownerId !== null ||
      canonicalJson(dispatch.key.input) !== canonicalJson(evaluationCall.evaluationInput)
    ) {
      throw corrupt(`evaluation.run Dispatch ${dispatch.id} is not a safe unbound dispatch`);
    }
    const startEvents = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: evaluationRunStartCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...dispatchStartDrafts(
          environment,
          context,
          parent,
          dispatch,
          tool,
          input.activationNumber,
          step.turnNumber,
          step.stepNumber + 1,
          input.settledAt,
        ),
      ],
    });
    const startHead = startEvents.at(-1);
    if (startHead === undefined) {
      throw corrupt(`evaluation.run Dispatch ${dispatch.id} emitted no start events`);
    }
    const run = advanceRunJournalHead(database, parent, {
      eventId: startHead.eventId,
      sequence: startHead.sequence,
      eventHash: startHead.eventHash,
    });
    return {
      value: {
        attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        result: null,
      },
      run,
      events: startEvents,
    };
  });
}

function settleEvaluationRunBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleEvaluationRunBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<EvaluationRunBoundaryRecord> {
  const input = parseCanonical(SettleEvaluationRunBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const boundary = loadEvaluationRunBoundary(database, input.dispatchOperationId);
    if (input.activationNumber !== boundary.attempt.request.activationNumber) {
      throw invalid(
        `evaluation.run Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    const expected = evaluationRunExpectedResult(database, boundary.dispatch);
    if (expected === null) {
      throw invalid(`evaluation.run Dispatch ${boundary.dispatch.id} has no Assessment owner`);
    }
    if (canonicalJson(input.result) !== canonicalJson(expected)) {
      throw corrupt(`evaluation.run Dispatch ${boundary.dispatch.id} result changed its owner`);
    }
    if (boundary.dispatch.outcome !== null) {
      if (boundary.result === null) {
        throw corrupt(`evaluation.run Dispatch ${boundary.dispatch.id} replay has no result`);
      }
      return { value: boundary, run: boundary.parent, events: [] };
    }
    if (boundary.parent.status !== 'running') {
      throw invalid(`evaluation.run Run ${boundary.parent.id} is not running`);
    }
    const storedActivation = activeActivation(database, boundary.parent.id, input.activationNumber);
    if (storedActivation.id !== boundary.attempt.activationId) {
      throw invalid(
        `evaluation.run Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    const journal = loadRunEvents(database, boundary.parent.id);
    const open = openDispatchStep(journal, input.activationNumber, boundary.dispatch.id);
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: boundary.dispatch.id,
      outcome: EvaluationRunDefinition.parseOutcome({ status: 'succeeded', data: expected }),
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`evaluation.run Dispatch ${dispatch.id} settlement disappeared`);
    }
    const tool = evaluationRunCatalogTool(database, boundary.parent);
    const events = appendRunEventBatch(database, {
      runId: boundary.parent.id,
      commandId: evaluationRunSettlementCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: EvaluationRunDefinition.id,
            status: 'succeeded',
            summary: `Tool ${EvaluationRunDefinition.id} succeeded`,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: open.turnNumber,
            stepNumber: open.stepNumber,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined) {
      throw corrupt(`evaluation.run Dispatch ${dispatch.id} emitted no settlement events`);
    }
    const run = advanceRunJournalHead(database, boundary.parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: {
        attempt: boundary.attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        result: expected,
      },
      run,
      events,
    };
  });
}

function generationSubmitStartCommandId(dispatchOperationId: string): string {
  return `generation-submit.${hashCanonical({ dispatchOperationId, phase: 'start' })}`;
}

function generationSubmitSettlementCommandId(dispatchOperationId: string): string {
  return `generation-submit.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function generationSubmitCatalogTool(
  database: DatabaseSync,
  parent: Run,
): CapabilityCatalogSnapshotV1['tools'][number] {
  const { catalog } = loadRunSnapshots(database, parent);
  const tool = catalog.tools.find(({ id }) => id === GenerationSubmitDefinition.id);
  if (
    tool === undefined ||
    tool.version !== GenerationSubmitDefinition.version ||
    canonicalJson(tool.metadata) !== canonicalJson(GenerationSubmitDefinition.metadata)
  ) {
    throw corrupt(`generation.submit is absent or invalid in Run ${parent.id}'s frozen catalog`);
  }
  return tool;
}

function generationSubmitExpectedResult(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): z.output<typeof GenerationSubmitDefinition.successSchema> | null {
  if (
    dispatch.key.toolId !== GenerationSubmitDefinition.id ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.key.authorityWatermarkHash !== null
  ) {
    throw corrupt(`generation.submit Dispatch ${dispatch.id} has invalid dispatch semantics`);
  }
  const unbound =
    dispatch.operationKind === null &&
    dispatch.ownerAuthority === null &&
    dispatch.ownerId === null &&
    dispatch.projectEventId === null;
  if (unbound) return null;
  if (
    dispatch.operationKind !== 'generation_attempt' ||
    dispatch.ownerAuthority !== 'generation_attempt' ||
    dispatch.ownerId === null
  ) {
    throw corrupt(`generation.submit Dispatch ${dispatch.id} has an invalid Generation owner`);
  }
  const result = GenerationSubmitDefinition.parseSuccess(
    generationSubmissionSuccessForDispatch(database, dispatch.id),
  );
  if (
    result.operation.id !== dispatch.id ||
    result.operation.kind !== 'generation_attempt' ||
    result.operation.ownerRef.authority !== 'generation_attempt' ||
    result.operation.ownerRef.id !== dispatch.ownerId ||
    result.attemptId !== dispatch.ownerId
  ) {
    throw corrupt(`generation.submit Dispatch ${dispatch.id} public Operation is invalid`);
  }
  return result;
}

function loadGenerationSubmitBoundary(
  database: DatabaseSync,
  dispatchOperationId: string,
): GenerationSubmitBoundaryRecord {
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  const origin = dispatch.origin;
  if (dispatch.key.toolId !== GenerationSubmitDefinition.id || origin.kind !== 'model') {
    throw invalid(`Dispatch ${dispatch.id} is not a generation.submit model dispatch`);
  }
  const attempt = loadModelAttemptRecord(database, origin.modelAttemptId);
  const parent = loadRun(database, dispatch.key.runId);
  const storedActivation = loadRunActivation(database, parent.id, attempt.request.activationNumber);
  if (
    attempt.state !== 'succeeded' ||
    attempt.response === null ||
    attempt.runId !== parent.id ||
    storedActivation === null ||
    storedActivation.id !== attempt.activationId
  ) {
    throw corrupt(`generation.submit Dispatch ${dispatch.id} has an invalid model boundary`);
  }
  const call = generationSubmitCall(attempt.response, origin.providerCallId);
  if (
    canonicalJson(call.submitInput) !== canonicalJson(dispatch.key.input) ||
    dispatch.key.projectId !== parent.projectId
  ) {
    throw corrupt(`generation.submit Dispatch ${dispatch.id} does not match its model call`);
  }
  generationSubmitCatalogTool(database, parent);
  const expected = generationSubmitExpectedResult(database, dispatch);
  let result = expected;
  if (dispatch.outcome !== null) {
    if (dispatch.outcome.status !== 'succeeded' || expected === null) {
      throw corrupt(`generation.submit Dispatch ${dispatch.id} has an invalid outcome`);
    }
    const settled = GenerationSubmitDefinition.parseSuccess(dispatch.outcome.data);
    if (canonicalJson(settled) !== canonicalJson(expected)) {
      throw corrupt(`generation.submit Dispatch ${dispatch.id} outcome changed its owner result`);
    }
    result = settled;
  }
  return Object.freeze({
    attempt,
    dispatch,
    parent,
    activation: storedActivation.activation,
    result,
  });
}

function replayGenerationSubmitStartBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleGenerationSubmitStartBoundaryInput,
  submitCall: ReturnType<typeof generationSubmitCall>,
): HarnessCommit<GenerationSubmitBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    submitCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, submitCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`generation.submit Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const boundary = loadGenerationSubmitBoundary(database, row.id);
  if (
    boundary.dispatch.origin.kind !== 'model' ||
    boundary.dispatch.origin.modelAttemptId !== attempt.id ||
    boundary.dispatch.origin.providerCallId !== submitCall.call.providerCallId ||
    canonicalJson(boundary.dispatch.key.input) !== canonicalJson(submitCall.submitInput)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `generation.submit Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  return {
    value: { ...boundary, attempt: replayAttempt },
    run: boundary.parent,
    events: [],
  };
}

function settleGenerationSubmitStartBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleGenerationSubmitStartBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<GenerationSubmitBoundaryRecord> {
  const input = parseCanonical(SettleGenerationSubmitStartBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const submitCall = generationSubmitCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayGenerationSubmitStartBoundary(database, before, input, submitCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`generation.submit Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      GenerationSubmitDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(
        `generation.submit Model Attempt ${before.id} requires its Commander Run context`,
      );
    }
    assertGenerationSubmitModelBoundary(database, parent, submitCall.submitInput);
    const tool = generationSubmitCatalogTool(database, parent);
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      submitCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`generation.submit Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const dispatch = prepareGenerationSubmitRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: submitCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      dispatch.guardOutcome !== 'allowed' ||
      dispatch.outcome !== null ||
      dispatch.operationKind !== null ||
      dispatch.ownerAuthority !== null ||
      dispatch.ownerId !== null ||
      canonicalJson(dispatch.key.input) !== canonicalJson(submitCall.submitInput)
    ) {
      throw corrupt(`generation.submit Dispatch ${dispatch.id} is not a safe unbound dispatch`);
    }
    const startEvents = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: generationSubmitStartCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...dispatchStartDrafts(
          environment,
          context,
          parent,
          dispatch,
          tool,
          input.activationNumber,
          step.turnNumber,
          step.stepNumber + 1,
          input.settledAt,
        ),
      ],
    });
    const startHead = startEvents.at(-1);
    if (startHead === undefined) {
      throw corrupt(`generation.submit Dispatch ${dispatch.id} emitted no start events`);
    }
    const run = advanceRunJournalHead(database, parent, {
      eventId: startHead.eventId,
      sequence: startHead.sequence,
      eventHash: startHead.eventHash,
    });
    return {
      value: {
        attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        result: null,
      },
      run,
      events: startEvents,
    };
  });
}

function settleGenerationSubmitBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleGenerationSubmitBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<GenerationSubmitBoundaryRecord> {
  const input = parseCanonical(SettleGenerationSubmitBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const boundary = loadGenerationSubmitBoundary(database, input.dispatchOperationId);
    if (input.activationNumber !== boundary.attempt.request.activationNumber) {
      throw invalid(
        `generation.submit Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    const expected = generationSubmitExpectedResult(database, boundary.dispatch);
    if (expected === null) {
      throw invalid(`generation.submit Dispatch ${boundary.dispatch.id} has no Generation owner`);
    }
    if (canonicalJson(input.result) !== canonicalJson(expected)) {
      throw corrupt(`generation.submit Dispatch ${boundary.dispatch.id} result changed its owner`);
    }
    if (boundary.dispatch.outcome !== null) {
      if (boundary.result === null) {
        throw corrupt(`generation.submit Dispatch ${boundary.dispatch.id} replay has no result`);
      }
      return { value: boundary, run: boundary.parent, events: [] };
    }
    if (boundary.parent.status !== 'running') {
      throw invalid(`generation.submit Run ${boundary.parent.id} is not running`);
    }
    const storedActivation = activeActivation(database, boundary.parent.id, input.activationNumber);
    if (storedActivation.id !== boundary.attempt.activationId) {
      throw invalid(
        `generation.submit Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    const journal = loadRunEvents(database, boundary.parent.id);
    const open = openDispatchStep(journal, input.activationNumber, boundary.dispatch.id);
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: boundary.dispatch.id,
      outcome: GenerationSubmitDefinition.parseOutcome({ status: 'succeeded', data: expected }),
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`generation.submit Dispatch ${dispatch.id} settlement disappeared`);
    }
    const tool = generationSubmitCatalogTool(database, boundary.parent);
    const events = appendRunEventBatch(database, {
      runId: boundary.parent.id,
      commandId: generationSubmitSettlementCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: GenerationSubmitDefinition.id,
            status: 'succeeded',
            summary: `Tool ${GenerationSubmitDefinition.id} succeeded`,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: open.turnNumber,
            stepNumber: open.stepNumber,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined) {
      throw corrupt(`generation.submit Dispatch ${dispatch.id} emitted no settlement events`);
    }
    const run = advanceRunJournalHead(database, boundary.parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: {
        attempt: boundary.attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        result: expected,
      },
      run,
      events,
    };
  });
}

function mediaDeriveStartCommandId(dispatchOperationId: string): string {
  return `media-derive.${hashCanonical({ dispatchOperationId, phase: 'start' })}`;
}

function mediaDeriveSettlementCommandId(dispatchOperationId: string): string {
  return `media-derive.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function mediaDeriveCatalogTool(
  database: DatabaseSync,
  parent: Run,
): CapabilityCatalogSnapshotV1['tools'][number] {
  const { catalog } = loadRunSnapshots(database, parent);
  const tool = catalog.tools.find(({ id }) => id === MediaDeriveDefinition.id);
  if (
    tool === undefined ||
    tool.version !== MediaDeriveDefinition.version ||
    canonicalJson(tool.metadata) !== canonicalJson(MediaDeriveDefinition.metadata)
  ) {
    throw corrupt(`media.derive is absent or invalid in Run ${parent.id}'s frozen catalog`);
  }
  return tool;
}

function mediaDeriveExpectedResult(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): z.output<typeof MediaDeriveDefinition.successSchema> | null {
  if (
    dispatch.key.toolId !== MediaDeriveDefinition.id ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.key.authorityWatermarkHash !== null
  ) {
    throw corrupt(`media.derive Dispatch ${dispatch.id} has invalid dispatch semantics`);
  }
  const unbound =
    dispatch.operationKind === null &&
    dispatch.ownerAuthority === null &&
    dispatch.ownerId === null &&
    dispatch.projectEventId === null;
  if (unbound) return null;
  if (
    dispatch.operationKind !== 'media_derivation' ||
    dispatch.ownerAuthority !== 'media_derivation_attempt' ||
    dispatch.ownerId === null
  ) {
    throw corrupt(`media.derive Dispatch ${dispatch.id} has an invalid Derivation owner`);
  }
  const result = MediaDeriveDefinition.parseSuccess(
    mediaDeriveSuccessForDispatch(database, dispatch.id),
  );
  assertMediaDeriveResultOwner(database, dispatch, result);
  return result;
}

function assertMediaDeriveResultOwner(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
  result: z.output<typeof MediaDeriveDefinition.successSchema>,
): void {
  const bound = loadBoundOperation(database, dispatch.id);
  if (bound.owner.view.authority !== 'media_derivation_attempt') {
    throw corrupt(`media.derive Dispatch ${dispatch.id} owner is invalid`);
  }
  if (
    result.operation.id !== dispatch.id ||
    result.operation.kind !== 'media_derivation' ||
    result.operation.ownerRef.authority !== 'media_derivation_attempt' ||
    result.operation.ownerRef.id !== dispatch.ownerId ||
    result.attemptId !== dispatch.ownerId ||
    result.derivationId !== bound.owner.view.derivation.id ||
    result.requestHash !== bound.owner.view.derivation.requestHash
  ) {
    throw corrupt(`media.derive Dispatch ${dispatch.id} public Operation is invalid`);
  }
}

function loadMediaDeriveBoundary(
  database: DatabaseSync,
  dispatchOperationId: string,
): MediaDeriveBoundaryRecord {
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  const origin = dispatch.origin;
  if (dispatch.key.toolId !== MediaDeriveDefinition.id || origin.kind !== 'model') {
    throw invalid(`Dispatch ${dispatch.id} is not a media.derive model dispatch`);
  }
  const attempt = loadModelAttemptRecord(database, origin.modelAttemptId);
  const parent = loadRun(database, dispatch.key.runId);
  const storedActivation = loadRunActivation(database, parent.id, attempt.request.activationNumber);
  if (
    attempt.state !== 'succeeded' ||
    attempt.response === null ||
    attempt.runId !== parent.id ||
    storedActivation === null ||
    storedActivation.id !== attempt.activationId
  ) {
    throw corrupt(`media.derive Dispatch ${dispatch.id} has an invalid model boundary`);
  }
  const call = mediaDeriveCall(attempt.response, origin.providerCallId);
  if (
    canonicalJson(call.deriveInput) !== canonicalJson(dispatch.key.input) ||
    dispatch.key.projectId !== parent.projectId
  ) {
    throw corrupt(`media.derive Dispatch ${dispatch.id} does not match its model call`);
  }
  mediaDeriveCatalogTool(database, parent);
  let result: z.output<typeof MediaDeriveDefinition.successSchema> | null;
  if (dispatch.outcome !== null) {
    if (dispatch.outcome.status !== 'succeeded') {
      throw corrupt(`media.derive Dispatch ${dispatch.id} has an invalid outcome`);
    }
    const settled = MediaDeriveDefinition.parseSuccess(dispatch.outcome.data);
    assertMediaDeriveResultOwner(database, dispatch, settled);
    result = settled;
  } else {
    result = mediaDeriveExpectedResult(database, dispatch);
  }
  return Object.freeze({
    attempt,
    dispatch,
    parent,
    activation: storedActivation.activation,
    result,
  });
}

function replayMediaDeriveStartBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleMediaDeriveStartBoundaryInput,
  deriveCall: ReturnType<typeof mediaDeriveCall>,
): HarnessCommit<MediaDeriveBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    deriveCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, deriveCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`media.derive Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const boundary = loadMediaDeriveBoundary(database, row.id);
  if (
    boundary.dispatch.origin.kind !== 'model' ||
    boundary.dispatch.origin.modelAttemptId !== attempt.id ||
    boundary.dispatch.origin.providerCallId !== deriveCall.call.providerCallId ||
    canonicalJson(boundary.dispatch.key.input) !== canonicalJson(deriveCall.deriveInput)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `media.derive Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  return {
    value: { ...boundary, attempt: replayAttempt },
    run: boundary.parent,
    events: [],
  };
}

function settleMediaDeriveStartBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleMediaDeriveStartBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<MediaDeriveBoundaryRecord> {
  const input = parseCanonical(SettleMediaDeriveStartBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const deriveCall = mediaDeriveCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayMediaDeriveStartBoundary(database, before, input, deriveCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`media.derive Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      MediaDeriveDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(`media.derive Model Attempt ${before.id} requires its Commander Run context`);
    }
    assertMediaDeriveModelBoundary(database, parent, deriveCall.deriveInput);
    const tool = mediaDeriveCatalogTool(database, parent);
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      deriveCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`media.derive Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const dispatch = prepareMediaDeriveRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: deriveCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      dispatch.guardOutcome !== 'allowed' ||
      dispatch.outcome !== null ||
      dispatch.operationKind !== null ||
      dispatch.ownerAuthority !== null ||
      dispatch.ownerId !== null ||
      canonicalJson(dispatch.key.input) !== canonicalJson(deriveCall.deriveInput)
    ) {
      throw corrupt(`media.derive Dispatch ${dispatch.id} is not a safe unbound dispatch`);
    }
    const startEvents = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: mediaDeriveStartCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...dispatchStartDrafts(
          environment,
          context,
          parent,
          dispatch,
          tool,
          input.activationNumber,
          step.turnNumber,
          step.stepNumber + 1,
          input.settledAt,
        ),
      ],
    });
    const startHead = startEvents.at(-1);
    if (startHead === undefined) {
      throw corrupt(`media.derive Dispatch ${dispatch.id} emitted no start events`);
    }
    const run = advanceRunJournalHead(database, parent, {
      eventId: startHead.eventId,
      sequence: startHead.sequence,
      eventHash: startHead.eventHash,
    });
    return {
      value: {
        attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        result: null,
      },
      run,
      events: startEvents,
    };
  });
}

function assertMediaDeriveSettlementState(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): void {
  const bound = loadBoundOperation(database, dispatch.id);
  if (bound.owner.view.authority !== 'media_derivation_attempt') {
    throw corrupt(`media.derive Dispatch ${dispatch.id} owner is invalid`);
  }
  const { state, derivation } = bound.owner.view;
  const terminal = AttemptTerminalStateSchema.safeParse(state).success;
  if (derivation.transform.operation === 'transcribe') {
    if (state === 'prepared' || state === 'running') {
      throw invalid(`media.derive Dispatch ${dispatch.id} transcription is not externally stable`);
    }
  } else if (!terminal) {
    throw invalid(`media.derive Dispatch ${dispatch.id} local work is not terminal`);
  }
}

function settleMediaDeriveBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleMediaDeriveBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<MediaDeriveBoundaryRecord> {
  const input = parseCanonical(SettleMediaDeriveBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const boundary = loadMediaDeriveBoundary(database, input.dispatchOperationId);
    if (input.activationNumber !== boundary.attempt.request.activationNumber) {
      throw invalid(`media.derive Dispatch ${boundary.dispatch.id} belongs to another Activation`);
    }
    if (boundary.dispatch.outcome !== null) {
      if (boundary.result === null) {
        throw corrupt(`media.derive Dispatch ${boundary.dispatch.id} replay has no result`);
      }
      if (canonicalJson(input.result) !== canonicalJson(boundary.result)) {
        throw corrupt(`media.derive Dispatch ${boundary.dispatch.id} result changed its outcome`);
      }
      return { value: boundary, run: boundary.parent, events: [] };
    }
    const expected = mediaDeriveExpectedResult(database, boundary.dispatch);
    if (expected === null) {
      throw invalid(`media.derive Dispatch ${boundary.dispatch.id} has no Derivation owner`);
    }
    if (canonicalJson(input.result) !== canonicalJson(expected)) {
      throw corrupt(`media.derive Dispatch ${boundary.dispatch.id} result changed its owner`);
    }
    assertMediaDeriveSettlementState(database, boundary.dispatch);
    if (boundary.parent.status !== 'running') {
      throw invalid(`media.derive Run ${boundary.parent.id} is not running`);
    }
    const storedActivation = activeActivation(database, boundary.parent.id, input.activationNumber);
    if (storedActivation.id !== boundary.attempt.activationId) {
      throw invalid(`media.derive Dispatch ${boundary.dispatch.id} belongs to another Activation`);
    }
    const journal = loadRunEvents(database, boundary.parent.id);
    const open = openDispatchStep(journal, input.activationNumber, boundary.dispatch.id);
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: boundary.dispatch.id,
      outcome: MediaDeriveDefinition.parseOutcome({ status: 'succeeded', data: expected }),
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`media.derive Dispatch ${dispatch.id} settlement disappeared`);
    }
    const tool = mediaDeriveCatalogTool(database, boundary.parent);
    const events = appendRunEventBatch(database, {
      runId: boundary.parent.id,
      commandId: mediaDeriveSettlementCommandId(dispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: MediaDeriveDefinition.id,
            status: 'succeeded',
            summary: `Tool ${MediaDeriveDefinition.id} succeeded`,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: open.turnNumber,
            stepNumber: open.stepNumber,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined) {
      throw corrupt(`media.derive Dispatch ${dispatch.id} emitted no settlement events`);
    }
    const run = advanceRunJournalHead(database, boundary.parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: {
        attempt: boundary.attempt,
        dispatch,
        parent: run,
        activation: storedActivation.activation,
        result: expected,
      },
      run,
      events,
    };
  });
}

function mediaAttachSettlementCommandId(dispatchOperationId: string): string {
  return `media-attach.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function replayMediaAttachBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleMediaAttachBoundaryInput,
  attachCall: ReturnType<typeof mediaAttachCall>,
): HarnessCommit<MediaAttachBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    attachCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, attachCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`media.attach Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== MediaAttachDefinition.id ||
    dispatch.key.runId !== attempt.runId ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== attachCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(attachCall.attachInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `media.attach Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const result = MediaAttachDefinition.parseSuccess(dispatch.outcome.data);
  const event = database
    .prepare(
      `SELECT project_id, event_type, subject_authority, subject_id, idempotency_key
       FROM project_events WHERE id = ?`,
    )
    .get(result.eventId) as
    | {
        readonly project_id: string;
        readonly event_type: string;
        readonly subject_authority: string;
        readonly subject_id: string;
        readonly idempotency_key: string;
      }
    | undefined;
  if (
    event === undefined ||
    event.project_id !== result.object.projectId ||
    event.event_type !== 'media_attached' ||
    event.subject_authority !== 'project_media_ref' ||
    event.subject_id !== result.object.id ||
    event.idempotency_key !== mediaAttachSettlementCommandId(dispatch.id)
  ) {
    throw corrupt(`media.attach Dispatch ${dispatch.id} Project event binding is invalid`);
  }
  return {
    value: { attempt: replayAttempt, dispatch, result },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleMediaAttachBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleMediaAttachBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<MediaAttachBoundaryRecord> {
  const input = parseCanonical(SettleMediaAttachBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const attachCall = mediaAttachCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayMediaAttachBoundary(database, before, input, attachCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`media.attach Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      MediaAttachDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(`media.attach Model Attempt ${before.id} requires its Commander Run context`);
    }
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === MediaAttachDefinition.id);
    if (tool === undefined || tool.version !== MediaAttachDefinition.version) {
      throw corrupt(`media.attach is absent from Run ${parent.id}'s frozen catalog`);
    }
    const source = resolveRunMediaSource(database, parent.id, attachCall.attachInput.source);
    if (
      source.globalAsset.blobHash !== source.blob.hash ||
      (source.projectMediaRef !== null &&
        (source.projectMediaRef.projectId !== parent.projectId ||
          source.projectMediaRef.globalAssetId !== source.globalAsset.id))
    ) {
      throw corrupt(`media.attach source identity does not match Run ${parent.id}`);
    }
    const existing = findProjectMediaRecordByAsset(
      database,
      parent.projectId,
      source.globalAsset.id,
    );
    if (source.projectMediaRef !== null && existing?.id !== source.projectMediaRef.id) {
      throw corrupt(`media.attach source relationship does not match Project ${parent.projectId}`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      attachCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`media.attach Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareMediaAttachRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: attachCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(attachCall.attachInput)
    ) {
      throw corrupt(
        `media.attach Dispatch ${preparedDispatch.id} is not an atomic unbound dispatch`,
      );
    }
    const commandId = mediaAttachSettlementCommandId(preparedDispatch.id);
    const result = attachProjectMediaInTransaction(
      database,
      environment,
      {
        wireVersion: 1,
        kind: 'request',
        requestId: commandId,
        method: 'media.project.attach',
        input: {
          projectId: parent.projectId,
          expectedProjectRevision: attachCall.attachInput.expectedProjectRevision,
          globalAssetId: source.globalAsset.id,
          expectedExistingRef:
            existing === undefined
              ? null
              : {
                  id: existing.id,
                  expectedRevision: existing.revision,
                  expectedContentHash: existing.contentHash,
                },
          label: attachCall.attachInput.label,
          collections: attachCall.attachInput.collections,
          roles: attachCall.attachInput.roles,
          notes: attachCall.attachInput.notes,
        },
      },
      context,
      input.settledAt,
    );
    if (
      result.object.projectId !== parent.projectId ||
      result.object.globalAssetId !== source.globalAsset.id ||
      result.previousRevision !== (existing?.revision ?? null)
    ) {
      throw corrupt(`media.attach Dispatch ${preparedDispatch.id} changed its Project owner`);
    }
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: MediaAttachDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`media.attach Dispatch ${dispatch.id} settlement disappeared`);
    }
    const settledEvents = settleSuccessfulControlEvents(
      database,
      environment,
      context,
      parent,
      dispatch,
      tool,
      attempt.usage,
      input.activationNumber,
      step,
      input.settledAt,
      commandId,
    );
    return {
      value: { attempt, dispatch, result },
      run: settledEvents.run,
      events: settledEvents.events,
    };
  });
}

function mediaLinkSettlementCommandId(dispatchOperationId: string): string {
  return `media-link.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function canvasMutateSettlementCommandId(dispatchOperationId: string): string {
  return `canvas-mutate.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function replayCanvasMutateBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleCanvasMutateBoundaryInput,
  canvasCall: ReturnType<typeof canvasMutateCall>,
): HarnessCommit<CanvasMutateBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    canvasCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, canvasCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`canvas.mutate Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== CanvasMutateDefinition.id ||
    dispatch.key.runId !== attempt.runId ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== canvasCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(canvasCall.canvasInput) ||
    dispatch.outcome?.status !== 'succeeded' ||
    dispatch.projectEventId === null
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `canvas.mutate Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const result = CanvasMutateDefinition.parseSuccess(dispatch.outcome.data);
  const receiptEventIds = new Set(result.receipts.map(({ eventId }) => eventId));
  if (receiptEventIds.size !== 1 || !receiptEventIds.has(dispatch.projectEventId)) {
    throw corrupt(`canvas.mutate Dispatch ${dispatch.id} receipts do not share its ProjectEvent`);
  }
  const event = database
    .prepare(
      `SELECT project_id, event_type, subject_authority, subject_id, idempotency_key
       FROM project_events WHERE id = ?`,
    )
    .get(dispatch.projectEventId) as
    | {
        readonly project_id: string;
        readonly event_type: string;
        readonly subject_authority: string;
        readonly subject_id: string;
        readonly idempotency_key: string;
      }
    | undefined;
  const canvas = loadCanvasDocument(database, canvasCall.canvasInput.canvas.id);
  if (
    event === undefined ||
    event.project_id !== dispatch.key.projectId ||
    event.event_type !== 'object_revision_changed' ||
    event.subject_authority !== 'canvas' ||
    event.subject_id !== canvas.id ||
    event.idempotency_key !== dispatch.projectEventId
  ) {
    throw corrupt(`canvas.mutate Dispatch ${dispatch.id} Project event binding is invalid`);
  }
  return {
    value: { attempt: replayAttempt, dispatch, result },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleCanvasMutateBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleCanvasMutateBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<CanvasMutateBoundaryRecord> {
  const input = parseCanonical(SettleCanvasMutateBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const canvasCall = canvasMutateCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayCanvasMutateBoundary(database, before, input, canvasCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`canvas.mutate Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      CanvasMutateDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(`canvas.mutate Model Attempt ${before.id} requires its Commander Run context`);
    }
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === CanvasMutateDefinition.id);
    if (
      tool === undefined ||
      tool.version !== CanvasMutateDefinition.version ||
      canonicalJson(tool.metadata) !== canonicalJson(CanvasMutateDefinition.metadata)
    ) {
      throw corrupt(`canvas.mutate is absent from Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      canvasCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`canvas.mutate Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareCanvasMutateRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: canvasCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(canvasCall.canvasInput)
    ) {
      throw corrupt(
        `canvas.mutate Dispatch ${preparedDispatch.id} is not an atomic unbound dispatch`,
      );
    }
    const commandId = canvasMutateSettlementCommandId(preparedDispatch.id);
    const planned = planCanvasMutationInTransaction(
      database,
      environment,
      parent.projectId,
      canvasCall.canvasInput,
      input.settledAt,
      plannedCanvasMutationIds(preparedDispatch.id, canvasCall.canvasInput),
    );
    const committed = commitPlannedCanvasMutationInTransaction(
      database,
      environment,
      planned,
      context,
    );
    const result = canvasMutationToolSuccess(committed);
    const receiptEventIds = new Set(result.receipts.map(({ eventId }) => eventId));
    if (receiptEventIds.size !== 1 || !receiptEventIds.has(committed.projectEventId)) {
      throw corrupt(`canvas.mutate Dispatch ${preparedDispatch.id} emitted divergent receipts`);
    }
    const boundDispatch = bindRuntimeDispatchProjectEvent(database, {
      dispatchOperationId: preparedDispatch.id,
      projectEventId: committed.projectEventId,
      occurredAt: input.settledAt,
    });
    if (boundDispatch.projectEventId !== committed.projectEventId) {
      throw corrupt(`canvas.mutate Dispatch ${preparedDispatch.id} lost its ProjectEvent binding`);
    }
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: CanvasMutateDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`canvas.mutate Dispatch ${dispatch.id} settlement disappeared`);
    }
    const settledEvents = settleSuccessfulControlEvents(
      database,
      environment,
      context,
      parent,
      dispatch,
      tool,
      attempt.usage,
      input.activationNumber,
      step,
      input.settledAt,
      commandId,
    );
    return {
      value: { attempt, dispatch, result },
      run: settledEvents.run,
      events: settledEvents.events,
    };
  });
}

function replayMediaLinkBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleMediaLinkBoundaryInput,
  linkCall: ReturnType<typeof mediaLinkCall>,
): HarnessCommit<MediaLinkBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    linkCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, linkCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`media.link Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== MediaLinkDefinition.id ||
    dispatch.key.runId !== attempt.runId ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== linkCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(linkCall.linkInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `media.link Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const result = MediaLinkDefinition.parseSuccess(dispatch.outcome.data);
  const event = database
    .prepare(
      `SELECT project_id, event_type, subject_authority, subject_id, idempotency_key
       FROM project_events WHERE id = ?`,
    )
    .get(result.eventId) as
    | {
        readonly project_id: string;
        readonly event_type: string;
        readonly subject_authority: string;
        readonly subject_id: string;
        readonly idempotency_key: string;
      }
    | undefined;
  if (
    event === undefined ||
    event.project_id !== result.object.projectId ||
    event.event_type !== 'object_revision_changed' ||
    event.subject_authority !== 'project_media_ref' ||
    event.subject_id !== result.object.id ||
    event.idempotency_key !== mediaLinkSettlementCommandId(dispatch.id)
  ) {
    throw corrupt(`media.link Dispatch ${dispatch.id} Project event binding is invalid`);
  }
  return {
    value: { attempt: replayAttempt, dispatch, result },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleMediaLinkBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleMediaLinkBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<MediaLinkBoundaryRecord> {
  const input = parseCanonical(SettleMediaLinkBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const linkCall = mediaLinkCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayMediaLinkBoundary(database, before, input, linkCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`media.link Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      MediaLinkDefinition.id,
    );
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== parent.id
    ) {
      throw invalid(`media.link Model Attempt ${before.id} requires its Commander Run context`);
    }
    requireCurrentDomainObject(database, parent.projectId, linkCall.linkInput.mediaRef);
    requireCurrentDomainObject(database, parent.projectId, linkCall.linkInput.target);
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === MediaLinkDefinition.id);
    if (tool === undefined || tool.version !== MediaLinkDefinition.version) {
      throw corrupt(`media.link is absent from Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      linkCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`media.link Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareMediaLinkRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: linkCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(linkCall.linkInput)
    ) {
      throw corrupt(`media.link Dispatch ${preparedDispatch.id} is not an atomic unbound dispatch`);
    }
    const commandId = mediaLinkSettlementCommandId(preparedDispatch.id);
    const result = linkProjectMediaInTransaction(
      database,
      environment,
      linkCall.linkInput,
      context,
      input.settledAt,
      commandId,
    );
    if (
      result.object.projectId !== parent.projectId ||
      result.object.id !== linkCall.linkInput.mediaRef.id ||
      result.previousRevision !== linkCall.linkInput.mediaRef.revision
    ) {
      throw corrupt(`media.link Dispatch ${preparedDispatch.id} changed its Project owner`);
    }
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: MediaLinkDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`media.link Dispatch ${dispatch.id} settlement disappeared`);
    }
    const settledEvents = settleSuccessfulControlEvents(
      database,
      environment,
      context,
      parent,
      dispatch,
      tool,
      attempt.usage,
      input.activationNumber,
      step,
      input.settledAt,
      commandId,
    );
    return {
      value: { attempt, dispatch, result },
      run: settledEvents.run,
      events: settledEvents.events,
    };
  });
}

function operationCancelSettlementCommandId(dispatchOperationId: string): string {
  return `operation-cancel.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function replayOperationCancelBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleOperationCancelBoundaryInput,
  cancelCall: ReturnType<typeof operationCancelCall>,
): HarnessCommit<OperationCancelBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    cancelCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, cancelCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`operation.cancel Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== OperationCancelDefinition.id ||
    dispatch.key.runId !== attempt.runId ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== cancelCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(cancelCall.cancelInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `operation.cancel Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const result = OperationCancelDefinition.parseSuccess(dispatch.outcome.data);
  if (
    result.operations.length !== cancelCall.cancelInput.operations.length ||
    result.operations.some((operation, index) => {
      const requested = cancelCall.cancelInput.operations[index]!;
      return (
        operation.ref.id !== requested.ref.id ||
        operation.ref.kind !== requested.ref.kind ||
        operation.ref.ownerRef.authority !== requested.ref.ownerRef.authority ||
        operation.ref.ownerRef.id !== requested.ref.ownerRef.id ||
        operation.ref.revision !== requested.expectedRevision + 1 ||
        operation.state !== requested.expectedState ||
        !operation.cancelRequested
      );
    })
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `operation.cancel Model Attempt ${attempt.id} replay changed cancellation results`,
    );
  }
  return {
    value: { attempt: replayAttempt, dispatch, result },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleOperationCancelBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleOperationCancelBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<OperationCancelBoundaryRecord> {
  const input = parseCanonical(SettleOperationCancelBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const cancelCall = operationCancelCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayOperationCancelBoundary(database, before, input, cancelCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`operation.cancel Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      OperationCancelDefinition.id,
    );
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === OperationCancelDefinition.id);
    if (tool === undefined || tool.version !== OperationCancelDefinition.version) {
      throw corrupt(`operation.cancel is absent from Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      cancelCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`operation.cancel Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareOperationCancelRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: cancelCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(cancelCall.cancelInput)
    ) {
      throw corrupt(
        `operation.cancel Dispatch ${preparedDispatch.id} is not an atomic unbound dispatch`,
      );
    }
    const commandId = operationCancelSettlementCommandId(preparedDispatch.id);
    const cancellation = cancelOperationsInTransaction(
      database,
      environment,
      cancelCall.cancelInput,
      input.settledAt,
      context,
    );
    if (
      cancellation.projectId !== parent.projectId ||
      cancellation.runId !== parent.id ||
      canonicalJson(cancellation.run) !== canonicalJson(parent)
    ) {
      throw invalid('operation.cancel target belongs to another Project or Run');
    }
    const result = OperationCancelDefinition.parseSuccess(cancellation.result);
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: OperationCancelDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`operation.cancel Dispatch ${dispatch.id} settlement disappeared`);
    }
    const settledEvents = settleSuccessfulControlEvents(
      database,
      environment,
      context,
      parent,
      dispatch,
      tool,
      attempt.usage,
      input.activationNumber,
      step,
      input.settledAt,
      commandId,
      cancellation.eventDrafts,
    );
    return {
      value: { attempt, dispatch, result },
      run: settledEvents.run,
      events: settledEvents.events,
    };
  });
}

function taskManageSettlementCommandId(dispatchOperationId: string): string {
  return `task-manage.${hashCanonical({ dispatchOperationId, phase: 'settlement' })}`;
}

function replayTaskManageBoundary(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
  input: SettleTaskManageBoundaryInput,
  taskCall: ReturnType<typeof taskManageCall>,
): HarnessCommit<TaskManageBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    taskCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, taskCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`task.manage Model Attempt ${attempt.id} has no durable dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== TaskManageDefinition.id ||
    dispatch.originModelAttemptId !== attempt.id ||
    dispatch.originProviderCallId !== taskCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(taskCall.taskInput) ||
    dispatch.outcome?.status !== 'succeeded'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `task.manage Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const result = TaskManageDefinition.parseSuccess(dispatch.outcome.data);
  return {
    value: { attempt: replayAttempt, dispatch, result },
    run: loadRun(database, attempt.runId),
    events: [],
  };
}

function settleTaskManageBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleTaskManageBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<TaskManageBoundaryRecord> {
  const input = parseCanonical(SettleTaskManageBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const taskCall = taskManageCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (before.response !== null) {
      return replayTaskManageBoundary(database, before, input, taskCall);
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`task.manage Model Attempt ${before.id} Activation identity changed`);
    }
    const parent = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      parent,
      storedActivation.activation,
      input,
      TaskManageDefinition.id,
    );
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === TaskManageDefinition.id);
    if (tool === undefined || tool.version !== TaskManageDefinition.version) {
      throw corrupt(`task.manage is absent from Run ${parent.id}'s frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      taskCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`task.manage Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareTaskManageRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: taskCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(taskCall.taskInput)
    ) {
      throw corrupt(
        `task.manage Dispatch ${preparedDispatch.id} is not an atomic unbound dispatch`,
      );
    }
    const commandId = taskManageSettlementCommandId(preparedDispatch.id);
    const managed = manageTaskListInTransaction(
      database,
      environment,
      parent.id,
      taskCall.taskInput,
      { commandId, context },
      input.settledAt,
      step.observedRun,
    );
    if (canonicalJson(managed.run) !== canonicalJson(parent)) {
      throw corrupt(`task.manage changed Run ${parent.id} before journal settlement`);
    }
    const result = TaskManageDefinition.parseSuccess(managed.result);
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: preparedDispatch.id,
      outcome: TaskManageDefinition.parseOutcome({ status: 'succeeded', data: result }),
      occurredAt: input.settledAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`task.manage Dispatch ${dispatch.id} settlement disappeared`);
    }
    const settledEvents = settleSuccessfulControlEvents(
      database,
      environment,
      context,
      parent,
      dispatch,
      tool,
      attempt.usage,
      input.activationNumber,
      step,
      input.settledAt,
      commandId,
      managed.event === null ? [] : [managed.event],
    );
    return {
      value: { attempt, dispatch, result },
      run: settledEvents.run,
      events: settledEvents.events,
    };
  });
}

function programChildForParentDispatch(
  database: DatabaseSync,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  parentRunId: string,
  parentDispatchOperationId: string,
  programHash: string,
): { readonly child: Run; readonly privateProgram: ToolProgramPrivateRunContext } {
  const event = loadPublicRunEventForCommand(database, parentRunId, parentDispatchOperationId);
  const payload = event?.payloadState.state === 'available' ? event.payloadState.payload : null;
  if (payload === null || payload.type !== 'child_run_delegated') {
    throw corrupt(
      `Tool Program dispatch ${parentDispatchOperationId} has no child delegation event`,
    );
  }
  const child = loadRun(database, payload.childRunId);
  const privateProgram = materializePrivateToolProgramContext(
    database,
    privateRecoveryCodec,
    child,
  );
  if (
    privateProgram.parentDispatchOperationId !== parentDispatchOperationId ||
    privateProgram.programHash !== programHash ||
    child.parentRunId !== parentRunId ||
    child.acceptedSource.kind !== 'parent_direction' ||
    child.acceptedSource.directionHash !== programHash
  ) {
    throw corrupt(`Tool Program dispatch ${parentDispatchOperationId} child binding is invalid`);
  }
  return { child, privateProgram };
}

function toolProgramSettlementCommandId(dispatchOperationId: string): string {
  return `tool-program.${hashCanonical({ dispatchOperationId, phase: 'prepare' })}`;
}

type ToolProgramInput = z.output<typeof ToolProgramDefinition.inputSchema>;
type ToolProgramStep = ToolProgramInput['steps'][number];
type ToolProgramCallStep = Extract<
  ToolProgramStep,
  { readonly operation: 'call' | 'map' | 'batch' }
>;
interface ToolProgramInvocation {
  readonly toolId: ToolId;
  readonly toolVersion: string;
  readonly input: unknown;
}

function toolProgramStepInvocations(step: ToolProgramStep): readonly ToolProgramInvocation[] {
  if (step.operation === 'call') return [step.invocation];
  if (step.operation === 'map' || step.operation === 'batch') return step.invocations;
  return [];
}

function recoverySafeToolProgramInvocation(
  catalog: CapabilityCatalogSnapshotV1,
  invocation: ToolProgramInvocation,
): {
  readonly frozen: CapabilityCatalogSnapshotV1['tools'][number];
  readonly definition: { readonly parseInput: (input: unknown) => unknown };
  readonly input: unknown;
} {
  const frozen = catalog.tools.find(
    ({ id, version }) => id === invocation.toolId && version === invocation.toolVersion,
  );
  const definition = executableToolDefinition(
    invocation.toolId,
    invocation.toolVersion,
  ) as unknown as { readonly parseInput: (input: unknown) => unknown } | undefined;
  if (frozen === undefined || definition === undefined || !isRecoverySafeRuntimeReadTool(frozen)) {
    throw invalid(
      `Tool Program child ${invocation.toolId}@${invocation.toolVersion} is not a frozen recovery-safe R tool`,
    );
  }
  let input: unknown;
  try {
    input = definition.parseInput(invocation.input);
  } catch (cause) {
    throw invalid(
      `Tool Program child ${invocation.toolId}@${invocation.toolVersion} input is invalid`,
      cause,
    );
  }
  if (canonicalJson(input) !== canonicalJson(invocation.input)) {
    throw invalid(
      `Tool Program child ${invocation.toolId}@${invocation.toolVersion} input is not canonical`,
    );
  }
  return { frozen, definition, input };
}

function assertRecoverySafeToolProgram(
  catalog: CapabilityCatalogSnapshotV1,
  program: ToolProgramInput,
): void {
  for (const step of program.steps) {
    for (const invocation of toolProgramStepInvocations(step)) {
      recoverySafeToolProgramInvocation(catalog, invocation);
    }
  }
}

function replayToolProgramBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  attempt: ModelAttemptRecordV1,
  input: SettleToolProgramBoundaryInput,
  programCall: ReturnType<typeof toolProgramCall>,
  context: CommandContext,
): HarnessCommit<ToolProgramBoundaryRecord> {
  const replayAttempt = settleModelAttemptRecord(
    database,
    attempt.id,
    input.requestHash,
    programCall.durableResponse,
    input.settledAt,
  );
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
    )
    .get(attempt.id, programCall.call.providerCallId) as { readonly id: string } | undefined;
  if (row === undefined) {
    throw corrupt(`Tool Program Model Attempt ${attempt.id} has no durable parent dispatch`);
  }
  const dispatch = loadOperationDispatch(database, row.id);
  if (
    dispatch.key.toolId !== 'tool.program' ||
    dispatch.origin.kind !== 'model' ||
    dispatch.origin.modelAttemptId !== attempt.id ||
    dispatch.origin.providerCallId !== programCall.call.providerCallId ||
    canonicalJson(dispatch.key.input) !== canonicalJson(programCall.durableInput)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `Tool Program Model Attempt ${attempt.id} replay changed durable semantics`,
    );
  }
  const parent = loadRun(database, attempt.runId);
  const delegated = delegateToolProgramChildRunInTransaction(
    database,
    environment,
    privateRecoveryCodec,
    {
      parentRunId: parent.id,
      expectedParentRevision: attempt.request.runRevision,
      commandId: dispatch.id,
      parentDispatchOperationId: dispatch.id,
      program: programCall.program,
    },
    {
      id: parent.id,
      revision: attempt.request.runRevision,
      contentHash: attempt.request.runContentHash,
      publicEventHead: attempt.request.eventHead,
    },
    {
      id: parent.id,
      revision: parent.revision,
      contentHash: parent.contentHash,
      publicEventHead: parent.publicEventHead,
    },
    context,
  );
  return {
    value: {
      attempt: replayAttempt,
      dispatch,
      child: {
        parent: delegated.parent,
        child: delegated.child,
        programHash: programCall.durableInput.programHash,
      },
    },
    run: delegated.parent,
    events: [],
  };
}

function settleToolProgramBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  inputValue: SettleToolProgramBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<ToolProgramBoundaryRecord> {
  const input = parseCanonical(SettleToolProgramBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const programCall = toolProgramCall(input.response, input.providerCallId);
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.requestHash !== input.requestHash) {
      throw new StorageError('IDEMPOTENCY_CONFLICT', `Model Attempt ${before.id} request changed`);
    }
    if (programCall.program.expectedRunRevision !== before.request.runRevision) {
      throw invalid(
        'Tool Program expected parent revision must equal its Model Attempt request snapshot',
      );
    }
    if (before.response !== null) {
      return replayToolProgramBoundary(
        database,
        environment,
        privateRecoveryCodec,
        before,
        input,
        programCall,
        context,
      );
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`Tool Program Model Attempt ${before.id} Activation identity changed`);
    }
    const run = loadRun(database, before.runId);
    const step = assertAtomicModelToolPreparationSuffix(
      database,
      before,
      run,
      storedActivation.activation,
      input,
      'tool.program',
    );
    const { catalog } = loadRunSnapshots(database, run);
    assertRecoverySafeToolProgram(catalog, programCall.program);
    const parentTool = catalog.tools.find(({ id }) => id === 'tool.program');
    if (parentTool === undefined) {
      throw corrupt(`Tool Program Dispatch ${before.id} left its frozen catalog`);
    }
    const attempt = settleModelAttemptRecord(
      database,
      before.id,
      input.requestHash,
      programCall.durableResponse,
      input.settledAt,
    );
    if (attempt.state !== 'succeeded' || attempt.usage === null) {
      throw corrupt(`Tool Program Model Attempt ${attempt.id} did not settle successfully`);
    }
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const preparedDispatch = prepareToolProgramRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: programCall.call.providerCallId,
      authorityWatermarkHash: null,
      occurredAt: input.settledAt,
    });
    if (
      preparedDispatch.guardOutcome !== 'allowed' ||
      preparedDispatch.outcome !== null ||
      canonicalJson(preparedDispatch.key.input) !== canonicalJson(programCall.durableInput)
    ) {
      throw corrupt(`Tool Program Dispatch ${preparedDispatch.id} is not a safe unbound dispatch`);
    }
    const child = delegateToolProgramChildRunInTransaction(
      database,
      environment,
      privateRecoveryCodec,
      {
        parentRunId: run.id,
        expectedParentRevision: before.request.runRevision,
        commandId: preparedDispatch.id,
        parentDispatchOperationId: preparedDispatch.id,
        program: programCall.program,
      },
      {
        id: run.id,
        revision: before.request.runRevision,
        contentHash: before.request.runContentHash,
        publicEventHead: before.request.eventHead,
      },
      {
        id: run.id,
        revision: run.revision,
        contentHash: run.contentHash,
        publicEventHead: run.publicEventHead,
      },
      context,
    );
    const events = appendRunEventBatch(database, {
      runId: child.parent.id,
      commandId: toolProgramSettlementCommandId(preparedDispatch.id),
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: { type: 'usage', ...attempt.usage },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'completed',
          },
        },
        ...dispatchStartDrafts(
          environment,
          context,
          child.parent,
          preparedDispatch,
          parentTool,
          input.activationNumber,
          step.turnNumber,
          step.stepNumber + 1,
          input.settledAt,
        ),
      ],
    });
    const head = events.at(-1);
    if (head === undefined)
      throw corrupt(`Tool Program Dispatch ${preparedDispatch.id} emitted no events`);
    const updatedRun = advanceRunJournalHead(database, child.parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return {
      value: { attempt, dispatch: preparedDispatch, child },
      run: updatedRun,
      events,
    };
  });
}

function programChildDispatchId(
  database: DatabaseSync,
  parentDispatchOperationId: string,
  programStepId: string,
  programCallIndex: number,
): string | null {
  const row = database
    .prepare(
      `SELECT id FROM dispatch_operations
       WHERE parent_dispatch_operation_id = ?
         AND program_step_id = ?
         AND program_call_index = ?`,
    )
    .get(parentDispatchOperationId, programStepId, programCallIndex) as
    { readonly id: string } | undefined;
  return row?.id ?? null;
}

function recordedToolStep(
  journal: readonly RunEvent[],
  dispatchOperationId: string,
): { readonly activationNumber: number; readonly turnNumber: number; readonly stepNumber: number } {
  const callIndex = journal.findIndex((event) => {
    if (event.visibility !== 'model_surface') return false;
    const payload = availablePayload(event);
    return payload.type === 'tool_call_ref' && payload.callId === dispatchOperationId;
  });
  if (callIndex < 0) {
    throw corrupt(`Dispatch ${dispatchOperationId} has no recorded Tool Program child call`);
  }
  const start = [...journal.slice(0, callIndex)].reverse().find((event) => {
    if (event.visibility !== 'public') return false;
    const payload = availablePayload(event);
    return payload.type === 'step_started' && payload.kind === 'tool';
  });
  if (start === undefined || start.visibility !== 'public') {
    throw corrupt(`Dispatch ${dispatchOperationId} has no recorded Tool Program child step`);
  }
  const payload = availablePayload(start);
  if (payload.type !== 'step_started') {
    throw corrupt(`Dispatch ${dispatchOperationId} Tool Program child step is invalid`);
  }
  return {
    activationNumber: payload.activationNumber,
    turnNumber: payload.turnNumber,
    stepNumber: payload.stepNumber,
  };
}

interface ToolProgramChildContext {
  readonly child: Run;
  readonly parent: Run;
  readonly parentDispatchOperationId: string;
  readonly privateProgram: ToolProgramPrivateRunContext;
  readonly catalog: CapabilityCatalogSnapshotV1;
}

function validatedToolProgramChildContext(
  database: DatabaseSync,
  child: Run,
  parent: Run,
  privateProgram: ToolProgramPrivateRunContext,
): ToolProgramChildContext {
  if (privateProgram.parentRunId !== parent.id || child.parentRunId !== parent.id) {
    throw corrupt(`Tool Program child Run ${child.id} parent dispatch is invalid`);
  }
  const { catalog } = loadRunSnapshots(database, child);
  assertRecoverySafeToolProgram(catalog, privateProgram.program);
  return {
    child,
    parent,
    parentDispatchOperationId: privateProgram.parentDispatchOperationId,
    privateProgram,
    catalog,
  };
}

function toolProgramChildContext(
  database: DatabaseSync,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  childRunId: string,
): ToolProgramChildContext {
  const child = loadRun(database, childRunId);
  const privateProgram = materializePrivateToolProgramContext(
    database,
    privateRecoveryCodec,
    child,
  );
  const parent = loadRun(database, privateProgram.parentRunId);
  return validatedToolProgramChildContext(database, child, parent, privateProgram);
}

function toolProgramCallAt(
  program: ToolProgramInput,
  stepId: string,
  callIndex: number,
): { readonly step: ToolProgramCallStep; readonly invocation: ToolProgramInvocation } {
  const step = program.steps.find(({ stepId: candidate }) => candidate === stepId);
  if (
    step === undefined ||
    (step.operation !== 'call' && step.operation !== 'map' && step.operation !== 'batch')
  ) {
    throw corrupt(`Tool Program step ${stepId} is not a call-bearing step`);
  }
  const invocation = toolProgramStepInvocations(step)[callIndex];
  if (invocation === undefined) {
    throw corrupt(`Tool Program call ${stepId}/${callIndex} is outside its private program`);
  }
  return { step, invocation };
}

function toolProgramChildDispatchRecordForContext(
  database: DatabaseSync,
  context: ToolProgramChildContext,
  dispatch: OperationDispatchRecord,
): ToolProgramChildDispatchRecord {
  if (dispatch.origin.kind !== 'tool_program') {
    throw invalid(`Dispatch ${dispatch.id} is not a Tool Program child dispatch`);
  }
  const { step, invocation } = toolProgramCallAt(
    context.privateProgram.program,
    dispatch.origin.programStepId,
    dispatch.origin.programCallIndex,
  );
  if (
    dispatch.key.runId !== context.child.id ||
    dispatch.origin.parentDispatchOperationId !== context.parentDispatchOperationId ||
    dispatch.origin.programStepId !== step.stepId ||
    dispatch.key.toolId !== invocation.toolId ||
    dispatch.key.toolVersion !== invocation.toolVersion ||
    dispatch.key.inputHash !== hashCanonical(invocation.input)
  ) {
    throw corrupt(`Tool Program child Dispatch ${dispatch.id} does not match its private program`);
  }
  const recorded = recordedToolStep(loadRunEvents(database, context.child.id), dispatch.id);
  return Object.freeze({
    dispatch,
    childRunId: context.child.id,
    parentDispatchOperationId: context.parentDispatchOperationId,
    programStepId: step.stepId,
    programCallIndex: dispatch.origin.programCallIndex,
    toolVersion: invocation.toolVersion,
    toolInput: invocation.input,
    activationNumber: recorded.activationNumber,
    turnNumber: recorded.turnNumber,
    stepNumber: recorded.stepNumber,
  });
}

function toolProgramChildSettlementRecord(
  database: DatabaseSync,
  dispatchOperationId: string,
): {
  readonly dispatch: OperationDispatchRecord;
  readonly child: Run;
  readonly activationNumber: number;
  readonly turnNumber: number;
  readonly stepNumber: number;
} {
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  if (dispatch.origin.kind !== 'tool_program') {
    throw invalid(`Dispatch ${dispatch.id} is not a Tool Program child dispatch`);
  }
  const child = loadRun(database, dispatch.key.runId);
  const recorded = recordedToolStep(loadRunEvents(database, child.id), dispatch.id);
  return { dispatch, child, ...recorded };
}

function loadToolProgramBoundaryContext(
  database: DatabaseSync,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  parentDispatchOperationId: string,
): {
  readonly boundary: ToolProgramBoundaryRecord;
  readonly privateProgram: ToolProgramPrivateRunContext;
} {
  const dispatch = loadOperationDispatch(database, parentDispatchOperationId);
  if (dispatch.key.toolId !== 'tool.program' || dispatch.origin.kind !== 'model') {
    throw invalid(`Dispatch ${dispatch.id} is not a Tool Program parent dispatch`);
  }
  let durableInput: z.output<typeof ToolProgramDurableInputSchema>;
  try {
    durableInput = ToolProgramDurableInputSchema.parse(dispatch.key.input);
  } catch (cause) {
    throw corrupt(`Tool Program parent Dispatch ${dispatch.id} safe input is invalid`, cause);
  }
  const { child, privateProgram } = programChildForParentDispatch(
    database,
    privateRecoveryCodec,
    dispatch.key.runId,
    dispatch.id,
    durableInput.programHash,
  );
  const boundary = Object.freeze({
    attempt: loadModelAttemptRecord(database, dispatch.origin.modelAttemptId),
    dispatch,
    child: Object.freeze({
      parent: loadRun(database, dispatch.key.runId),
      child,
      programHash: durableInput.programHash,
    }),
  });
  return { boundary, privateProgram };
}

function loadToolProgramBoundary(
  database: DatabaseSync,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  parentDispatchOperationId: string,
): ToolProgramBoundaryRecord {
  return loadToolProgramBoundaryContext(database, privateRecoveryCodec, parentDispatchOperationId)
    .boundary;
}

function isRunActivationActive(
  database: DatabaseSync,
  runIdValue: string,
  activationNumber: number,
): boolean {
  const runId = parseCanonical(EntityIdSchema, runIdValue);
  const parsedActivationNumber = parseCanonical(z.number().int().positive(), activationNumber);
  const run = loadRun(database, runId);
  const activation = loadRunActivation(database, run.id, parsedActivationNumber);
  return run.status === 'running' && activation?.activation.state === 'active';
}

interface ToolProgramJournalCursor {
  readonly turnStarted: boolean;
  readonly turnEnded: boolean;
  readonly turnNumber: number;
  readonly completedStepCount: number;
  readonly openStepNumber: number | null;
}

function toolProgramJournalCursor(
  journal: readonly RunEvent[],
  activationNumber: number,
): ToolProgramJournalCursor {
  let turnStarted = false;
  let turnEnded = false;
  let completedStepCount = 0;
  let openStepNumber: number | null = null;
  for (const event of journal) {
    if (event.visibility !== 'public') continue;
    const payload = availablePayload(event);
    if (!('activationNumber' in payload) || payload.activationNumber !== activationNumber) continue;
    if (payload.type === 'turn_started') {
      if (turnStarted || turnEnded || payload.turnNumber !== 1) {
        throw corrupt(`Tool Program child Run turn ${payload.turnNumber} ordering is invalid`);
      }
      turnStarted = true;
    } else if (payload.type === 'step_started') {
      if (
        !turnStarted ||
        turnEnded ||
        payload.turnNumber !== 1 ||
        payload.kind !== 'tool' ||
        openStepNumber !== null ||
        payload.stepNumber !== completedStepCount + 1
      ) {
        throw corrupt(
          `Tool Program child Run step ${payload.turnNumber}/${payload.stepNumber} ordering is invalid`,
        );
      }
      openStepNumber = payload.stepNumber;
    } else if (payload.type === 'step_ended') {
      if (
        !turnStarted ||
        turnEnded ||
        payload.turnNumber !== 1 ||
        openStepNumber !== payload.stepNumber
      ) {
        throw corrupt(
          `Tool Program child Run step ${payload.turnNumber}/${payload.stepNumber} closed out of order`,
        );
      }
      completedStepCount = payload.stepNumber;
      openStepNumber = null;
    } else if (payload.type === 'turn_ended') {
      if (!turnStarted || turnEnded || payload.turnNumber !== 1 || openStepNumber !== null) {
        throw corrupt(`Tool Program child Run turn ${payload.turnNumber} closed out of order`);
      }
      turnEnded = true;
    }
  }
  return { turnStarted, turnEnded, turnNumber: 1, completedStepCount, openStepNumber };
}

type ToolProgramState = 'succeeded' | 'blocked' | 'failed' | 'cancelled';

function toolProgramStateForOutcome(outcome: RuntimeLoopOutcome): ToolProgramState {
  if (outcome.status === 'succeeded') return 'succeeded';
  if (outcome.status === 'cancelled') return 'cancelled';
  return toolSummaryStatus(outcome) === 'blocked' ? 'blocked' : 'failed';
}

function combineToolProgramStates(states: readonly ToolProgramState[]): ToolProgramState {
  if (states.includes('cancelled')) return 'cancelled';
  if (states.includes('failed')) return 'failed';
  if (states.includes('blocked')) return 'blocked';
  return 'succeeded';
}

interface ToolProgramItem {
  readonly record: ToolProgramChildDispatchRecord;
  readonly outcome: RuntimeLoopOutcome;
}

interface ToolProgramStepEvaluation {
  readonly state: ToolProgramState;
  readonly items: readonly ToolProgramItem[];
  readonly validationFailed: boolean;
}

function settledToolProgramItem(record: ToolProgramChildDispatchRecord): ToolProgramItem {
  if (record.dispatch.outcome === null || record.dispatch.outcomeHash === null) {
    throw invalid(`Tool Program child Dispatch ${record.dispatch.id} is not settled`);
  }
  return { record, outcome: record.dispatch.outcome };
}

function toolProgramStepRecords(
  database: DatabaseSync,
  context: ToolProgramChildContext,
  step: ToolProgramCallStep,
  requireAll: boolean,
): ToolProgramChildDispatchRecord[] {
  const records = toolProgramStepInvocations(step).flatMap((_invocation, callIndex) => {
    const id = programChildDispatchId(
      database,
      context.parentDispatchOperationId,
      step.stepId,
      callIndex,
    );
    if (id === null) return [];
    return [
      toolProgramChildDispatchRecordForContext(
        database,
        context,
        loadOperationDispatch(database, id),
      ),
    ];
  });
  if (requireAll && records.length !== toolProgramStepInvocations(step).length) {
    throw corrupt(`Tool Program step ${step.stepId} is missing a child Dispatch`);
  }
  return records;
}

function compareProgramText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function evaluatePureToolProgramStep(
  step: Exclude<ToolProgramStep, ToolProgramCallStep>,
  values: ReadonlyMap<string, readonly ToolProgramItem[]>,
): ToolProgramStepEvaluation {
  const source = values.get(step.sourceStepId);
  if (source === undefined) {
    throw corrupt(`Tool Program step ${step.stepId} source ${step.sourceStepId} is unavailable`);
  }
  if (step.operation === 'filter') {
    const include = new Set(step.predicate.include);
    return {
      state: 'succeeded',
      items: source.filter(({ outcome }) => include.has(outcome.status)),
      validationFailed: false,
    };
  }
  if (step.operation === 'sort') {
    const decorated = source.map((item, index) => ({ item, index }));
    decorated.sort((left, right) => {
      const leftKey =
        step.key === 'tool_id' ? left.item.record.dispatch.key.toolId : left.item.outcome.status;
      const rightKey =
        step.key === 'tool_id' ? right.item.record.dispatch.key.toolId : right.item.outcome.status;
      const compared = compareProgramText(leftKey, rightKey);
      return (step.direction === 'ascending' ? compared : -compared) || left.index - right.index;
    });
    return {
      state: 'succeeded',
      items: decorated.map(({ item }) => item),
      validationFailed: false,
    };
  }
  if (step.operation === 'take') {
    return { state: 'succeeded', items: source.slice(0, step.count), validationFailed: false };
  }
  const valid =
    step.rule.kind === 'all_succeeded'
      ? source.every(({ outcome }) => outcome.status === 'succeeded')
      : step.rule.kind === 'none_blocked'
        ? source.every(({ outcome }) => toolSummaryStatus(outcome) !== 'blocked')
        : source.length <= step.rule.maximum;
  return {
    state: valid ? 'succeeded' : 'failed',
    items: source,
    validationFailed: !valid,
  };
}

function evaluateToolProgramPrefix(
  database: DatabaseSync,
  context: ToolProgramChildContext,
  completedStepCount: number,
): ReadonlyMap<string, ToolProgramStepEvaluation> {
  const evaluations = new Map<string, ToolProgramStepEvaluation>();
  for (let index = 0; index < completedStepCount; index += 1) {
    const step = context.privateProgram.program.steps[index];
    if (step === undefined) throw corrupt(`Tool Program completed an unknown step ${index + 1}`);
    let evaluation: ToolProgramStepEvaluation;
    if (step.operation === 'call' || step.operation === 'map' || step.operation === 'batch') {
      const items = toolProgramStepRecords(database, context, step, true).map(
        settledToolProgramItem,
      );
      evaluation = {
        state: combineToolProgramStates(
          items.map(({ outcome }) => toolProgramStateForOutcome(outcome)),
        ),
        items,
        validationFailed: false,
      };
    } else {
      evaluation = evaluatePureToolProgramStep(
        step,
        new Map([...evaluations].map(([stepId, value]) => [stepId, value.items])),
      );
    }
    evaluations.set(step.stepId, evaluation);
    if (evaluation.validationFailed && index + 1 !== completedStepCount) {
      throw corrupt(`Tool Program continued after failed validation step ${step.stepId}`);
    }
  }
  return evaluations;
}

function programStepStartedDraft(
  environment: StorageEnvironment,
  context: CommandContext,
  activationNumber: number,
  stepNumber: number,
  occurredAt: string,
): AppendRunEventBatchInput['events'][number] {
  return {
    eventId: environment.createId('run_event'),
    visibility: 'public',
    occurredAt,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
    payload: {
      type: 'step_started',
      activationNumber,
      turnNumber: 1,
      stepNumber,
      kind: 'tool',
    },
  };
}

function programCallStartedDraft(
  environment: StorageEnvironment,
  context: CommandContext,
  child: Run,
  dispatch: OperationDispatchRecord,
  tool: CapabilityCatalogSnapshotV1['tools'][number],
  occurredAt: string,
): AppendRunEventBatchInput['events'][number] {
  return {
    eventId: environment.createId('run_event'),
    visibility: 'model_surface',
    occurredAt,
    actor: context.actor,
    causation: context.causation,
    correlationId: context.correlationId,
    payload: {
      type: 'tool_call_ref',
      callId: dispatch.id,
      toolName: dispatch.key.toolId,
      capabilityCatalogSnapshotId: child.capabilityCatalogSnapshotId,
      inputPayloadId: dispatch.id,
      inputSchemaHash: tool.inputSchema.sha256,
      inputHash: dispatch.key.inputHash,
    },
  };
}

function programCallSettlementDrafts(
  environment: StorageEnvironment,
  context: CommandContext,
  record: ToolProgramChildDispatchRecord,
  tool: CapabilityCatalogSnapshotV1['tools'][number],
  occurredAt: string,
): AppendRunEventBatchInput['events'] {
  const outcome = record.dispatch.outcome;
  const outcomeHash = record.dispatch.outcomeHash;
  if (outcome === null || outcomeHash === null) {
    throw corrupt(`Tool Program child Dispatch ${record.dispatch.id} settlement disappeared`);
  }
  const status = toolSummaryStatus(outcome);
  return [
    {
      eventId: environment.createId('run_event'),
      visibility: 'model_surface',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'tool_result_ref',
        callId: record.dispatch.id,
        toolName: record.dispatch.key.toolId,
        outputPayloadId: record.dispatch.id,
        outputSchemaHash: tool.outcomeSchema.sha256,
        outputHash: outcomeHash,
        success: outcome.status === 'succeeded',
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
        type: 'tool_summary',
        toolName: record.dispatch.key.toolId,
        status,
        summary: `Tool ${record.dispatch.key.toolId} ${status}`,
      },
    },
  ];
}

function terminalToolProgramState(run: Run): ToolProgramState {
  if (run.status === 'completed') return 'succeeded';
  if (run.status === 'blocked' || run.status === 'failed' || run.status === 'cancelled') {
    return run.status;
  }
  throw invalid(`Tool Program child Run ${run.id} is not terminal`);
}

function toolProgramTerminalSummary(state: ToolProgramState, validationStepId?: string): string {
  if (validationStepId !== undefined) {
    return `Tool Program validation failed at step ${validationStepId}`;
  }
  if (state === 'succeeded') return 'Tool Program completed';
  return `Tool Program ${state}`;
}

function terminalizeToolProgramChild(
  database: DatabaseSync,
  environment: StorageEnvironment,
  child: Run,
  state: ToolProgramState,
  commandId: string,
  occurredAt: string,
  context: CommandContext,
  leadingEvents: AppendRunEventBatchInput['events'],
  resultIds: readonly string[],
  validationStepId?: string,
): HarnessCommit<ToolProgramChildAdvance> {
  const terminal = terminalizeRunInTransaction(
    database,
    environment,
    child,
    state === 'succeeded' ? 'completed' : state,
    commandId,
    occurredAt,
    context,
    {
      summary: toolProgramTerminalSummary(state, validationStepId),
      resultIds: [...resultIds].slice(-100),
    },
    leadingEvents,
  );
  return {
    value: { kind: 'terminal', childRunId: child.id, state },
    run: terminal.run,
    events: terminal.events,
  };
}

function advanceToolProgramChild(
  database: DatabaseSync,
  environment: StorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  inputValue: AdvanceToolProgramChildInput,
  contextValue: CommandContext,
): HarnessCommit<ToolProgramChildAdvance> {
  const input = parseCanonical(AdvanceToolProgramChildInputSchema, inputValue);
  const commandContext = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const child = loadRun(database, input.runId);
    const context = toolProgramChildContext(database, privateRecoveryCodec, child.id);
    if (
      child.status === 'completed' ||
      child.status === 'blocked' ||
      child.status === 'failed' ||
      child.status === 'cancelled'
    ) {
      return {
        value: { kind: 'terminal', childRunId: child.id, state: terminalToolProgramState(child) },
        run: child,
        events: [],
      };
    }
    if (child.status !== 'running')
      throw invalid(`Tool Program child Run ${child.id} is not running`);
    const storedActivation = activeActivation(database, child.id, input.activationNumber);
    const trigger = listRunInbox(database, child.id).find(
      ({ id, sequence }) =>
        id === storedActivation.activation.triggerInboxMessageId &&
        sequence === storedActivation.activation.triggerInboxSequence,
    );
    if (trigger?.state !== 'consumed' || trigger.id !== context.privateProgram.inboxMessageId) {
      throw invalid(`Tool Program child Run ${child.id} trigger Inbox is not consumed`);
    }
    const journal = loadRunEvents(database, child.id);
    const cursor = toolProgramJournalCursor(journal, input.activationNumber);
    if (cursor.turnEnded)
      throw corrupt(`Running Tool Program child Run ${child.id} already ended its turn`);
    if (cursor.completedStepCount > context.privateProgram.program.steps.length) {
      throw corrupt(`Tool Program child Run ${child.id} completed too many steps`);
    }
    const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
    const drafts: AppendRunEventBatchInput['events'] = [];
    let turnStarted = cursor.turnStarted;
    let completedStepCount = cursor.completedStepCount;
    let openStepNumber = cursor.openStepNumber;
    const evaluations = new Map(evaluateToolProgramPrefix(database, context, completedStepCount));

    const ensureTurnStarted = () => {
      if (turnStarted) return;
      drafts.push({
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt,
        actor: commandContext.actor,
        causation: commandContext.causation,
        correlationId: commandContext.correlationId,
        payload: {
          type: 'turn_started',
          activationNumber: input.activationNumber,
          turnNumber: 1,
          inboxMessageId: trigger.id,
        },
      });
      turnStarted = true;
    };

    for (;;) {
      if (openStepNumber !== null) {
        const openStep = context.privateProgram.program.steps[openStepNumber - 1];
        if (
          openStep === undefined ||
          (openStep.operation !== 'call' &&
            openStep.operation !== 'map' &&
            openStep.operation !== 'batch')
        ) {
          throw corrupt(`Tool Program child Run ${child.id} has an invalid open step`);
        }
        const records = toolProgramStepRecords(database, context, openStep, true);
        const pending = records.filter(({ dispatch }) => dispatch.outcome === null);
        if (pending.length !== 0) {
          if (drafts.length !== 0) {
            throw corrupt(
              `Tool Program child Run ${child.id} mixed durable and pending step state`,
            );
          }
          return {
            value: {
              kind: 'execute',
              childRunId: child.id,
              parentDispatchOperationId: context.parentDispatchOperationId,
              programStepId: openStep.stepId,
              operation: openStep.operation,
              concurrency: openStep.operation === 'map' ? openStep.concurrency : 1,
              activationNumber: input.activationNumber,
              turnNumber: 1,
              stepNumber: openStepNumber,
              calls: pending,
            },
            run: child,
            events: [],
          };
        }
        const state = combineToolProgramStates(
          records.map(({ dispatch }) => toolProgramStateForOutcome(dispatch.outcome!)),
        );
        evaluations.set(openStep.stepId, {
          state,
          items: records.map(settledToolProgramItem),
          validationFailed: false,
        });
        for (const record of records) {
          const tool = context.catalog.tools.find(({ id }) => id === record.dispatch.key.toolId);
          if (tool === undefined) {
            throw corrupt(
              `Tool Program child ${record.dispatch.key.toolId} left its frozen catalog`,
            );
          }
          drafts.push(
            ...programCallSettlementDrafts(environment, commandContext, record, tool, occurredAt),
          );
        }
        drafts.push({
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt,
          actor: commandContext.actor,
          causation: commandContext.causation,
          correlationId: commandContext.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: 1,
            stepNumber: openStepNumber,
            outcome:
              state === 'succeeded' ? 'completed' : state === 'cancelled' ? 'interrupted' : state,
          },
        });
        completedStepCount = openStepNumber;
        openStepNumber = null;
        if (state === 'cancelled') {
          drafts.push({
            eventId: environment.createId('run_event'),
            visibility: 'public',
            occurredAt,
            actor: commandContext.actor,
            causation: commandContext.causation,
            correlationId: commandContext.correlationId,
            payload: {
              type: 'turn_ended',
              activationNumber: input.activationNumber,
              turnNumber: 1,
              outcome: 'completed',
            },
          });
          return terminalizeToolProgramChild(
            database,
            environment,
            child,
            'cancelled',
            input.commandId,
            occurredAt,
            commandContext,
            drafts,
            records.map(({ dispatch }) => dispatch.id),
          );
        }
        continue;
      }

      const step = context.privateProgram.program.steps[completedStepCount];
      if (step === undefined) {
        const state = combineToolProgramStates(
          [...evaluations.values()].map(({ state: stepState }) => stepState),
        );
        if (turnStarted) {
          drafts.push({
            eventId: environment.createId('run_event'),
            visibility: 'public',
            occurredAt,
            actor: commandContext.actor,
            causation: commandContext.causation,
            correlationId: commandContext.correlationId,
            payload: {
              type: 'turn_ended',
              activationNumber: input.activationNumber,
              turnNumber: 1,
              outcome: 'completed',
            },
          });
        }
        const resultIds = [
          ...new Set(
            [...evaluations.values()].flatMap(({ items }) =>
              items.map(({ record }) => record.dispatch.id),
            ),
          ),
        ];
        return terminalizeToolProgramChild(
          database,
          environment,
          child,
          state,
          input.commandId,
          occurredAt,
          commandContext,
          drafts,
          resultIds,
        );
      }

      ensureTurnStarted();
      const stepNumber = completedStepCount + 1;
      drafts.push(
        programStepStartedDraft(
          environment,
          commandContext,
          input.activationNumber,
          stepNumber,
          occurredAt,
        ),
      );
      if (step.operation === 'call' || step.operation === 'map' || step.operation === 'batch') {
        const records = toolProgramStepInvocations(step).map((invocation, callIndex) => {
          const resolved = recoverySafeToolProgramInvocation(context.catalog, invocation);
          const dispatch = prepareProgramRuntimeDispatch(database, environment, {
            runId: child.id,
            parentDispatchOperationId: context.parentDispatchOperationId,
            programStepId: step.stepId,
            programCallIndex: callIndex,
            toolId: invocation.toolId,
            toolVersion: invocation.toolVersion,
            input: resolved.input,
            authorityWatermarkHash: null,
            occurredAt,
          });
          drafts.push(
            programCallStartedDraft(
              environment,
              commandContext,
              child,
              dispatch,
              resolved.frozen,
              occurredAt,
            ),
          );
          return Object.freeze({
            dispatch,
            childRunId: child.id,
            parentDispatchOperationId: context.parentDispatchOperationId,
            programStepId: step.stepId,
            programCallIndex: callIndex,
            toolVersion: invocation.toolVersion,
            toolInput: resolved.input,
            activationNumber: input.activationNumber,
            turnNumber: 1,
            stepNumber,
          });
        });
        const events = appendRunEventBatch(database, {
          runId: child.id,
          commandId: input.commandId,
          events: drafts,
        });
        const head = events.at(-1);
        if (head === undefined) throw corrupt(`Tool Program step ${step.stepId} emitted no events`);
        const run = advanceRunJournalHead(database, child, {
          eventId: head.eventId,
          sequence: head.sequence,
          eventHash: head.eventHash,
        });
        return {
          value: {
            kind: 'execute',
            childRunId: child.id,
            parentDispatchOperationId: context.parentDispatchOperationId,
            programStepId: step.stepId,
            operation: step.operation,
            concurrency: step.operation === 'map' ? step.concurrency : 1,
            activationNumber: input.activationNumber,
            turnNumber: 1,
            stepNumber,
            calls: records,
          },
          run,
          events,
        };
      }

      const evaluation = evaluatePureToolProgramStep(
        step,
        new Map([...evaluations].map(([stepId, value]) => [stepId, value.items])),
      );
      evaluations.set(step.stepId, evaluation);
      const summaryStatus = evaluation.validationFailed ? 'failed' : 'succeeded';
      drafts.push(
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt,
          actor: commandContext.actor,
          causation: commandContext.causation,
          correlationId: commandContext.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: 'tool.program',
            status: summaryStatus,
            summary: evaluation.validationFailed
              ? 'Tool Program validation failed'
              : `Tool Program ${step.operation} produced ${evaluation.items.length} items`,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt,
          actor: commandContext.actor,
          causation: commandContext.causation,
          correlationId: commandContext.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: 1,
            stepNumber,
            outcome: evaluation.validationFailed ? 'failed' : 'completed',
          },
        },
      );
      completedStepCount = stepNumber;
      if (evaluation.validationFailed) {
        drafts.push({
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt,
          actor: commandContext.actor,
          causation: commandContext.causation,
          correlationId: commandContext.correlationId,
          payload: {
            type: 'turn_ended',
            activationNumber: input.activationNumber,
            turnNumber: 1,
            outcome: 'completed',
          },
        });
        return terminalizeToolProgramChild(
          database,
          environment,
          child,
          'failed',
          input.commandId,
          occurredAt,
          commandContext,
          drafts,
          [
            ...new Set(
              [...evaluations.values()].flatMap(({ items }) =>
                items.map(({ record }) => record.dispatch.id),
              ),
            ),
          ],
          step.stepId,
        );
      }
    }
  });
}

function settleToolProgramChildCall(
  database: DatabaseSync,
  _environment: StorageEnvironment,
  _privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  inputValue: SettleToolProgramChildCallInput,
  contextValue: CommandContext,
): HarnessCommit<OperationDispatchRecord> {
  const parsed = parseCanonical(SettleToolProgramChildCallInputSchema, inputValue);
  const input: SettleToolProgramChildCallInput = { ...parsed, outcome: inputValue.outcome };
  parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const record = toolProgramChildSettlementRecord(database, input.dispatchOperationId);
    const before = record.dispatch;
    if (before.outcome !== null) {
      const replay = settleValidatedRuntimeDispatch(database, before, {
        dispatchOperationId: before.id,
        outcome: input.outcome,
        occurredAt: input.completedAt,
      });
      return { value: replay, run: loadRun(database, replay.key.runId), events: [] };
    }
    const child = loadRun(database, record.child.id);
    if (child.status !== 'running') {
      throw invalid(`Tool Program child Run ${child.id} is not running`);
    }
    if (
      record.activationNumber !== input.activationNumber ||
      record.turnNumber !== input.turnNumber ||
      record.stepNumber !== input.stepNumber
    ) {
      throw invalid(`Tool Program child Dispatch ${before.id} does not match its active step`);
    }
    activeActivation(database, record.child.id, input.activationNumber);
    const journal = loadRunEvents(database, child.id);
    const open = openDispatchStep(journal, input.activationNumber, before.id);
    if (open.turnNumber !== input.turnNumber || open.stepNumber !== input.stepNumber) {
      throw corrupt(`Tool Program child Dispatch ${before.id} open step changed`);
    }
    const dispatch = settleValidatedRuntimeDispatch(database, before, {
      dispatchOperationId: before.id,
      outcome: input.outcome,
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`Tool Program child Dispatch ${dispatch.id} settlement disappeared`);
    }
    return { value: dispatch, run: child, events: [] };
  });
}

function toolProgramAggregateOutcome(
  database: DatabaseSync,
  context: ToolProgramChildContext,
  child: Run,
): RuntimeLoopOutcome {
  const activation = loadRunActivations(database, child.id)[0];
  const cursor =
    activation === undefined
      ? {
          turnStarted: false,
          turnEnded: false,
          turnNumber: 1,
          completedStepCount: 0,
          openStepNumber: null,
        }
      : toolProgramJournalCursor(loadRunEvents(database, child.id), activation.activationNumber);
  const evaluations = evaluateToolProgramPrefix(database, context, cursor.completedStepCount);
  const openProgramStep =
    cursor.openStepNumber === null
      ? undefined
      : context.privateProgram.program.steps[cursor.openStepNumber - 1];
  const openRecords =
    openProgramStep !== undefined &&
    (openProgramStep.operation === 'call' ||
      openProgramStep.operation === 'map' ||
      openProgramStep.operation === 'batch')
      ? toolProgramStepRecords(database, context, openProgramStep, true)
      : [];
  const steps = context.privateProgram.program.steps.map((step, index) => {
    const completed = evaluations.get(step.stepId);
    if (completed !== undefined) {
      return {
        stepId: step.stepId,
        operation: step.operation,
        state: completed.state,
        itemCount: completed.items.length,
      };
    }
    if (
      cursor.openStepNumber === index + 1 &&
      (step.operation === 'call' || step.operation === 'map' || step.operation === 'batch')
    ) {
      return {
        stepId: step.stepId,
        operation: step.operation,
        state: child.status === 'cancelled' ? ('cancelled' as const) : ('running' as const),
        itemCount: openRecords.filter(({ dispatch }) => dispatch.outcome !== null).length,
      };
    }
    return {
      stepId: step.stepId,
      operation: step.operation,
      state: 'pending' as const,
      itemCount: 0,
    };
  });
  const childCalls = context.privateProgram.program.steps.flatMap((step) => {
    if (step.operation !== 'call' && step.operation !== 'map' && step.operation !== 'batch') {
      return [];
    }
    const completed = evaluations.get(step.stepId);
    const records =
      completed === undefined
        ? step.stepId === openProgramStep?.stepId
          ? openRecords
          : []
        : completed.items.map(({ record }) => record);
    return records.flatMap((record) => {
      const outcome = record.dispatch.outcome;
      const outcomeHash = record.dispatch.outcomeHash;
      if (outcome === null || outcomeHash === null) return [];
      return [
        {
          stepId: record.programStepId,
          callIndex: record.programCallIndex,
          toolId: record.dispatch.key.toolId,
          toolVersion: record.toolVersion,
          outcomeStatus: outcome.status,
          operationFingerprint: record.dispatch.key.fingerprint,
          outcome,
          outcomeHash,
        },
      ];
    });
  });
  const state = terminalToolProgramState(child);
  if (
    child.status === 'completed' &&
    cursor.completedStepCount !== context.privateProgram.program.steps.length
  ) {
    throw corrupt(`Completed Tool Program child Run ${child.id} has incomplete steps`);
  }
  const usage = childRunUsage(database, child);
  const parentDispatch = loadOperationDispatch(database, context.parentDispatchOperationId);
  const parentDefinition = executableToolDefinition(
    parentDispatch.key.toolId,
    parentDispatch.key.toolVersion,
  ) as unknown as { readonly parseOutcome: (outcome: unknown) => unknown } | undefined;
  if (parentDispatch.key.toolId !== 'tool.program' || parentDefinition === undefined) {
    throw corrupt(
      `Tool Program parent ${parentDispatch.key.toolId}@${parentDispatch.key.toolVersion} is unavailable`,
    );
  }
  return parseCanonical(
    RuntimeLoopOutcomeSchema,
    parentDefinition.parseOutcome({
      status: 'succeeded',
      data: {
        programRunId: child.id,
        state,
        steps,
        childCalls,
        resultRefs: [],
        artifacts: [],
        usage: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cost: usage.costUsd,
        },
        blocker:
          state === 'succeeded' ? '' : (child.terminalOutcome?.summary ?? `Tool Program ${state}`),
      },
    }),
  );
}

function settleCancelledToolProgramCalls(
  database: DatabaseSync,
  context: ToolProgramChildContext,
  occurredAt: string,
): void {
  if (context.child.status !== 'cancelled') return;
  const message = context.child.terminalOutcome?.summary ?? 'Tool Program child was cancelled';
  for (const step of context.privateProgram.program.steps) {
    if (step.operation !== 'call' && step.operation !== 'map' && step.operation !== 'batch')
      continue;
    for (const record of toolProgramStepRecords(database, context, step, false)) {
      if (record.dispatch.outcome !== null) continue;
      const definition = executableToolDefinition(
        record.dispatch.key.toolId,
        record.dispatch.key.toolVersion,
      ) as unknown as { readonly parseOutcome: (outcome: unknown) => unknown } | undefined;
      if (definition === undefined) {
        throw corrupt(
          `Tool Program child ${record.dispatch.key.toolId}@${record.dispatch.key.toolVersion} is unavailable`,
        );
      }
      settleValidatedRuntimeDispatch(database, record.dispatch, {
        dispatchOperationId: record.dispatch.id,
        outcome: parseCanonical(
          RuntimeLoopOutcomeSchema,
          definition.parseOutcome({ status: 'cancelled', message, retainedOperations: [] }),
        ),
        occurredAt,
      });
    }
  }
}

function settleToolProgramParent(
  database: DatabaseSync,
  environment: StorageEnvironment,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  inputValue: SettleToolProgramParentInput,
  contextValue: CommandContext,
): HarnessCommit<OperationDispatchRecord> {
  const input = parseCanonical(SettleToolProgramParentInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const loaded = loadToolProgramBoundaryContext(
      database,
      privateRecoveryCodec,
      input.parentDispatchOperationId,
    );
    const boundary = loaded.boundary;
    const child = boundary.child.child;
    if (
      child.status === 'accepted' ||
      child.status === 'running' ||
      child.status === 'recovering'
    ) {
      throw invalid(`Tool Program child Run ${child.id} is not terminal`);
    }
    const childContext = validatedToolProgramChildContext(
      database,
      child,
      boundary.child.parent,
      loaded.privateProgram,
    );
    settleCancelledToolProgramCalls(database, childContext, input.completedAt);
    const aggregate = toolProgramAggregateOutcome(database, childContext, child);
    if (boundary.dispatch.outcome !== null) {
      const replay = settleValidatedRuntimeDispatch(database, boundary.dispatch, {
        dispatchOperationId: boundary.dispatch.id,
        outcome: aggregate,
        occurredAt: input.completedAt,
      });
      return { value: replay, run: loadRun(database, replay.key.runId), events: [] };
    }
    const parent = loadRun(database, boundary.dispatch.key.runId);
    const storedActivation = activeActivation(database, parent.id, input.activationNumber);
    if (storedActivation.id !== boundary.attempt.activationId) {
      throw invalid(
        `Tool Program parent Dispatch ${boundary.dispatch.id} belongs to another Activation`,
      );
    }
    const journal = loadRunEvents(database, parent.id);
    const open = openDispatchStep(journal, input.activationNumber, boundary.dispatch.id);
    const dispatch = settleValidatedRuntimeDispatch(database, boundary.dispatch, {
      dispatchOperationId: boundary.dispatch.id,
      outcome: aggregate,
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`Tool Program parent Dispatch ${dispatch.id} settlement disappeared`);
    }
    const { catalog } = loadRunSnapshots(database, parent);
    const tool = catalog.tools.find(({ id }) => id === 'tool.program');
    if (tool === undefined || tool.version !== ToolProgramDefinition.version) {
      throw corrupt(`Tool Program parent Dispatch ${dispatch.id} left its frozen catalog`);
    }
    const events = appendRunEventBatch(database, {
      runId: parent.id,
      commandId: input.commandId,
      events: [
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: true,
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_summary',
            toolName: 'tool.program',
            status: 'succeeded',
            summary: 'Tool tool.program succeeded',
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'step_ended',
            activationNumber: input.activationNumber,
            turnNumber: open.turnNumber,
            stepNumber: open.stepNumber,
            outcome: 'completed',
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined)
      throw corrupt(`Tool Program parent Dispatch ${dispatch.id} emitted no events`);
    const run = advanceRunJournalHead(database, parent, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return { value: dispatch, run, events };
  });
}

function toolProgramChildScheduleCommandId(
  parentDispatchOperationId: string,
  phase: 'deliver' | 'activate',
): string {
  return `tool-program.${hashCanonical({ parentDispatchOperationId, phase })}`;
}

function startToolProgramChildActivation(
  database: DatabaseSync,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
  runs: RunsAuthority,
  parentDispatchOperationId: string,
  contextValue: CommandContext,
): ToolProgramChildActivationRecord {
  const parentDispatchId = parseCanonical(EntityIdSchema, parentDispatchOperationId);
  const parentContext = parseCanonical(CommandContextSchema, contextValue);
  const boundary = loadToolProgramBoundary(database, privateRecoveryCodec, parentDispatchId);
  const child = boundary.child.child;
  const childContext = parseCanonical(CommandContextSchema, {
    ...parentContext,
    causation: { kind: 'run', runId: child.id },
  });
  const active = runs.listActivations(child.id).filter(({ state }) => state === 'active');
  if (active.length > 1) {
    throw corrupt(`Tool Program child Run ${child.id} has multiple active Activations`);
  }
  if (active.length === 1) {
    return Object.freeze({ childRunId: child.id, activation: active[0]! });
  }
  if (
    child.status === 'completed' ||
    child.status === 'blocked' ||
    child.status === 'failed' ||
    child.status === 'cancelled'
  ) {
    throw invalid(`Tool Program child Run ${child.id} is already terminal`);
  }
  const privateProgram = materializePrivateToolProgramContext(
    database,
    privateRecoveryCodec,
    child,
  );
  let inbox = runs.listInbox(child.id).find(({ id }) => id === privateProgram.inboxMessageId);
  if (inbox === undefined) throw corrupt(`Tool Program child Run ${child.id} Inbox is missing`);
  if (inbox.state === 'queued') {
    const beforeDelivery = loadRun(database, child.id);
    inbox = runs.transitionInbox(
      {
        runId: child.id,
        expectedRevision: beforeDelivery.revision,
        inboxMessageId: inbox.id,
        sequence: inbox.sequence,
        action: 'deliver',
        commandId: toolProgramChildScheduleCommandId(parentDispatchId, 'deliver'),
      },
      childContext,
    );
  }
  if (inbox.state !== 'delivered') {
    throw invalid(`Tool Program child Run ${child.id} Inbox is ${inbox.state}, not delivered`);
  }
  const beforeActivation = loadRun(database, child.id);
  const activation = runs.startActivation(
    {
      runId: child.id,
      expectedRevision: beforeActivation.revision,
      commandId: toolProgramChildScheduleCommandId(parentDispatchId, 'activate'),
    },
    childContext,
  );
  return Object.freeze({ childRunId: child.id, activation });
}

function settleModelAttempt(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: SettleModelAttemptInput,
  contextValue: CommandContext,
): HarnessCommit<ModelAttemptRecordV1> {
  const input = parseCanonical(SettleModelAttemptInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  if (
    input.response.events.some(
      (event) =>
        event.type === 'tool_call' &&
        (event.toolId === 'agent.spawn' ||
          event.toolId === 'agent.send' ||
          event.toolId === 'agent.wait' ||
          event.toolId === 'agent.result' ||
          event.toolId === 'agent.cancel' ||
          event.toolId === 'delivery.export' ||
          event.toolId === 'delivery.freeze' ||
          event.toolId === 'delivery.preview' ||
          event.toolId === 'evaluation.run' ||
          event.toolId === 'generation.submit' ||
          event.toolId === 'interaction.ask' ||
          event.toolId === 'media.attach' ||
          event.toolId === 'media.derive' ||
          event.toolId === 'media.link' ||
          event.toolId === 'canvas.mutate' ||
          event.toolId === 'operation.cancel' ||
          event.toolId === 'task.manage' ||
          event.toolId === 'tool.program'),
    )
  ) {
    throw invalid(
      'delivery.export, delivery.freeze, delivery.preview, evaluation.run, generation.submit, media.attach, media.derive, media.link, canvas.mutate, agent.spawn, agent.send, agent.wait, agent.result, agent.cancel, interaction.ask, operation.cancel, task.manage, and tool.program require dedicated durable settlement boundaries',
    );
  }
  const durableResponse = parseCanonical(DurableCanonicalModelResponseV1Schema, input.response);
  const terminal = input.response.events.at(-1)!;
  const publicText = input.response.events
    .filter((event) => event.type === 'assistant_delta')
    .map(({ publicText: text }) => text)
    .join('');
  const finalAssistant =
    terminal.type === 'model_completed' && terminal.finishReason !== 'tool_calls';
  const completesRun = terminal.type === 'model_completed' && terminal.finishReason === 'stop';
  const assistantText = completesRun ? publicText.trim() : publicText;
  if (finalAssistant && assistantText.length === 0) {
    throw invalid('A final model response requires public assistant text');
  }
  if (completesRun && assistantText.length > 100_000) {
    throw invalid('A final model response exceeds 100,000 characters');
  }
  return withImmediateTransaction(database, () => {
    const before = loadModelAttemptRecord(database, input.attemptId);
    if (before.response !== null) {
      const replay = settleModelAttemptRecord(
        database,
        input.attemptId,
        input.requestHash,
        durableResponse,
        input.settledAt,
      );
      const replayRun = loadRun(database, replay.runId);
      if (completesRun) {
        const replayActivation = loadRunActivation(
          database,
          replay.runId,
          replay.request.activationNumber,
        );
        const activationEndReason =
          replayActivation !== null &&
          replayActivation.id === replay.activationId &&
          replayActivation.activation.state === 'ended'
            ? replayActivation.activation.endReason
            : null;
        const terminalSettlement =
          activationEndReason === 'terminal' &&
          replayRun.status === 'completed' &&
          replayRun.terminalOutcome?.summary === assistantText;
        const safeBoundarySettlement = activationEndReason === 'safe_boundary';
        if (!terminalSettlement && !safeBoundarySettlement) {
          throw corrupt(`Final Model Attempt ${replay.id} has no atomic Run terminalization`);
        }
      }
      return { value: replay, run: replayRun, events: [] };
    }
    const storedActivation = activeActivation(
      database,
      before.runId,
      before.request.activationNumber,
    );
    if (storedActivation.id !== before.activationId) {
      throw corrupt(`Model Attempt ${before.id} Activation identity changed`);
    }
    const run = loadRun(database, before.runId);
    const pendingInbox = completesRun
      ? earliestPendingInboxAfterTrigger(database, storedActivation.activation)
      : null;
    const journal = loadRunEvents(database, run.id);
    const step = attemptModelStep(
      journal,
      storedActivation.activation.activationNumber,
      before.attemptNumber,
    );
    assertOpenStep(
      journal,
      storedActivation.activation.activationNumber,
      step.turnNumber,
      step.stepNumber,
      'model',
    );
    const attempt = settleModelAttemptRecord(
      database,
      input.attemptId,
      input.requestHash,
      durableResponse,
      input.settledAt,
    );
    if (attempt.usage === null) throw corrupt(`Settled Model Attempt ${attempt.id} has no usage`);
    closeModelResources(database, environment, attempt, attempt.usage, input.settledAt);
    const message =
      finalAssistant && pendingInbox === null
        ? appendMessageInTransaction(
            database,
            environment,
            context,
            {
              chatId: run.chatId,
              role: 'assistant',
              status: terminal.finishReason === 'stop' ? 'completed' : 'interrupted',
              originatingRunId: run.id,
              blocks: [{ type: 'text', text: assistantText }],
              attachments: [],
              supersedesMessageId: null,
              idempotencyKey: input.commandId,
            },
            {
              messageId: environment.createId('message'),
              eventId: environment.createId('project_event'),
              searchDocumentId: environment.createId('project_search_document'),
              createdAt: input.settledAt,
            },
          ).message
        : null;
    const stepOutcome =
      attempt.state === 'succeeded'
        ? ('completed' as const)
        : attempt.state === 'unknown'
          ? ('interrupted' as const)
          : ('failed' as const);
    const settlementEvents: AppendRunEventBatchInput['events'] = [
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: { type: 'usage', ...attempt.usage },
      },
      ...(message === null
        ? []
        : [
            {
              eventId: environment.createId('run_event'),
              visibility: 'model_surface' as const,
              occurredAt: input.settledAt,
              actor: context.actor,
              causation: context.causation,
              correlationId: context.correlationId,
              payload: {
                type: 'message_ref' as const,
                role: 'assistant' as const,
                messageId: message.id,
                messageHash: message.contentHash,
              },
            },
          ]),
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'step_ended',
          activationNumber: storedActivation.activation.activationNumber,
          turnNumber: step.turnNumber,
          stepNumber: step.stepNumber,
          outcome: stepOutcome,
        },
      },
    ];
    if (completesRun) {
      if (run.status !== 'running') throw invalid(`Run ${run.id} is not running`);
      settlementEvents.push({
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.settledAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'turn_ended',
          activationNumber: storedActivation.activation.activationNumber,
          turnNumber: step.turnNumber,
          outcome: 'completed',
        },
      });
      if (pendingInbox !== null) {
        const activationEventOrdinal = settlementEvents.length;
        settlementEvents.push({
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.settledAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'activation_changed',
            activationNumber: storedActivation.activation.activationNumber,
            state: 'ended',
            endReason: 'safe_boundary',
          },
        });
        const events = appendRunEventBatch(database, {
          runId: run.id,
          commandId: input.commandId,
          events: settlementEvents,
        });
        const activationEvent = events[activationEventOrdinal];
        const head = events.at(-1);
        if (activationEvent === undefined || head === undefined) {
          throw corrupt(`Run ${run.id} safe-boundary Model settlement events are incomplete`);
        }
        closeRunActivation(
          database,
          storedActivation,
          activationEvent.sequence,
          input.settledAt,
          'safe_boundary',
        );
        const updatedRun = advanceRunJournalHead(database, run, {
          eventId: head.eventId,
          sequence: head.sequence,
          eventHash: head.eventHash,
        });
        return { value: attempt, run: updatedRun, events };
      }
      const completed = terminalizeRunInTransaction(
        database,
        environment,
        run,
        'completed',
        input.commandId,
        input.settledAt,
        context,
        { summary: assistantText, resultIds: [] },
        settlementEvents,
      );
      return { value: attempt, run: completed.run, events: completed.events };
    }
    const events = appendRunEventBatch(database, {
      runId: run.id,
      commandId: input.commandId,
      events: settlementEvents,
    });
    const head = events.at(-1)!;
    const updatedRun = advanceRunJournalHead(database, run, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return { value: attempt, run: updatedRun, events };
  });
}

function dispatchStartDrafts(
  environment: StorageEnvironment,
  context: CommandContext,
  run: Run,
  dispatch: OperationDispatchRecord,
  tool: CapabilityCatalogSnapshotV1['tools'][number],
  activationNumber: number,
  turnNumber: number,
  stepNumber: number,
  occurredAt: string,
): AppendRunEventBatchInput['events'] {
  return [
    {
      eventId: environment.createId('run_event'),
      visibility: 'public',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'step_started',
        activationNumber,
        turnNumber,
        stepNumber,
        kind: 'tool',
      },
    },
    {
      eventId: environment.createId('run_event'),
      visibility: 'model_surface',
      occurredAt,
      actor: context.actor,
      causation: context.causation,
      correlationId: context.correlationId,
      payload: {
        type: 'tool_call_ref',
        callId: dispatch.id,
        toolName: dispatch.key.toolId,
        capabilityCatalogSnapshotId: run.capabilityCatalogSnapshotId,
        inputPayloadId: dispatch.id,
        inputSchemaHash: tool.inputSchema.sha256,
        inputHash: dispatch.key.inputHash,
      },
    },
  ];
}

function prepareDispatch(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: PrepareDispatchInput,
  contextValue: CommandContext,
): HarnessCommit<OperationDispatchRecord> {
  const input = parseCanonical(PrepareDispatchInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  if (
    input.toolId === 'agent.spawn' ||
    input.toolId === 'agent.send' ||
    input.toolId === 'agent.wait' ||
    input.toolId === 'agent.result' ||
    input.toolId === 'agent.cancel' ||
    input.toolId === 'delivery.export' ||
    input.toolId === 'delivery.freeze' ||
    isProtectedMutationTool(input.toolId) ||
    input.toolId === 'delivery.preview' ||
    input.toolId === 'evaluation.run' ||
    input.toolId === 'generation.submit' ||
    input.toolId === 'interaction.ask' ||
    input.toolId === 'media.attach' ||
    input.toolId === 'media.derive' ||
    input.toolId === 'media.link' ||
    input.toolId === 'canvas.mutate' ||
    input.toolId === 'operation.cancel' ||
    input.toolId === 'task.manage' ||
    input.toolId === 'tool.program'
  ) {
    throw invalid(`${input.toolId} requires its dedicated durable settlement boundary`);
  }
  return withImmediateTransaction(database, () => {
    const attempt = loadModelAttemptRecord(database, input.modelAttemptId);
    if (attempt.runId !== input.runId) throw invalid('Model Attempt belongs to another Run');
    const call = attempt.response?.events.find(
      (event) => event.type === 'tool_call' && event.providerCallId === input.providerCallId,
    );
    if (
      call?.type !== 'tool_call' ||
      call.toolId !== input.toolId ||
      canonicalJson(call.canonicalArguments) !== canonicalJson(input.input)
    ) {
      throw invalid('Dispatch input does not match its canonical model tool call');
    }
    const storedActivation = activeActivation(database, attempt.runId, input.activationNumber);
    if (storedActivation.id !== attempt.activationId) {
      throw invalid('Dispatch Model Attempt belongs to another Activation');
    }
    const run = loadRun(database, attempt.runId);
    const existingRow = database
      .prepare(
        `SELECT id FROM dispatch_operations
         WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
      )
      .get(attempt.id, input.providerCallId) as unknown as { id: string } | undefined;
    if (existingRow !== undefined) {
      const existing = prepareRuntimeDispatch(database, environment, {
        modelAttemptId: attempt.id,
        providerCallId: input.providerCallId,
        authorityWatermarkHash: input.authorityWatermarkHash,
        occurredAt: environment.now(),
      });
      return { value: existing, run, events: [] };
    }
    const journal = loadRunEvents(database, run.id);
    const cursor = nextModelBoundary(journal, input.activationNumber);
    if (
      cursor.startsTurn ||
      cursor.turnNumber !== input.turnNumber ||
      cursor.stepNumber !== input.stepNumber
    ) {
      throw invalid('Dispatch tool step does not follow the committed Run boundary');
    }
    const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
    const dispatch = prepareRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: input.providerCallId,
      authorityWatermarkHash: input.authorityWatermarkHash,
      occurredAt,
    });
    const { catalog } = loadRunSnapshots(database, run);
    const tool = catalog.tools.find(({ id }) => id === dispatch.key.toolId);
    if (tool === undefined) throw corrupt(`Dispatch ${dispatch.id} tool left its frozen catalog`);
    const events = appendRunEventBatch(database, {
      runId: run.id,
      commandId: input.commandId,
      events: dispatchStartDrafts(
        environment,
        context,
        run,
        dispatch,
        tool,
        input.activationNumber,
        input.turnNumber,
        input.stepNumber,
        occurredAt,
      ),
    });
    const head = events.at(-1)!;
    const updatedRun = advanceRunJournalHead(database, run, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return { value: dispatch, run: updatedRun, events };
  });
}

function skillProposalFromDispatch(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): SkillProposalRecord {
  if (
    dispatch.key.toolId !== 'skill.propose' ||
    dispatch.guardOutcome !== 'confirmation_required' ||
    dispatch.confirmationId === null ||
    dispatch.outcome?.status !== 'permission_required' ||
    dispatch.outcome.confirmationId !== dispatch.confirmationId
  ) {
    throw corrupt(`Dispatch ${dispatch.id} is not a complete Skill proposal`);
  }
  const row = database
    .prepare(
      `SELECT confirmation.run_id, confirmation.target_v1_json,
              confirmation.immutable_input_hash, interaction.run_id AS interaction_run_id,
              interaction.kind AS interaction_kind
       FROM run_confirmations AS confirmation
       JOIN run_interactions AS interaction ON interaction.id = confirmation.interaction_id
       WHERE confirmation.id = ?`,
    )
    .get(dispatch.confirmationId) as unknown as
    | {
        run_id: string;
        target_v1_json: string;
        immutable_input_hash: string;
        interaction_run_id: string;
        interaction_kind: string;
      }
    | undefined;
  if (row === undefined) {
    throw corrupt(`Skill proposal Confirmation ${dispatch.confirmationId} was not found`);
  }
  let target: z.output<typeof ConfirmationTargetSchema>;
  try {
    target = parseCanonical(ConfirmationTargetSchema, JSON.parse(row.target_v1_json) as unknown);
  } catch (cause) {
    throw corrupt(
      `Skill proposal Confirmation ${dispatch.confirmationId} target is invalid`,
      cause,
    );
  }
  if (
    row.run_id !== dispatch.key.runId ||
    row.interaction_run_id !== dispatch.key.runId ||
    row.interaction_kind !== 'confirmation' ||
    row.immutable_input_hash !== dispatch.key.inputHash ||
    canonicalJson(target) !== row.target_v1_json ||
    target.kind !== 'skill_registration' ||
    target.projectId !== dispatch.key.projectId
  ) {
    throw corrupt(`Skill proposal Confirmation ${dispatch.confirmationId} binding is invalid`);
  }
  return Object.freeze({
    dispatch,
    confirmationId: dispatch.confirmationId,
    immutableInputHash: row.immutable_input_hash,
    target,
  });
}

function prepareSkillProposal(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: PrepareSkillProposalInput,
  contextValue: CommandContext,
): HarnessCommit<SkillProposalRecord> {
  const input = parseCanonical(PrepareSkillProposalInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const attempt = loadModelAttemptRecord(database, input.modelAttemptId);
    if (attempt.runId !== input.runId) throw invalid('Model Attempt belongs to another Run');
    const call = attempt.response?.events.find(
      (event) => event.type === 'tool_call' && event.providerCallId === input.providerCallId,
    );
    if (
      attempt.state !== 'succeeded' ||
      call?.type !== 'tool_call' ||
      call.toolId !== 'skill.propose' ||
      canonicalJson(call.canonicalArguments) !== canonicalJson(input.input)
    ) {
      throw invalid('Skill proposal does not match its committed canonical model tool call');
    }

    const existingRow = database
      .prepare(
        `SELECT id FROM dispatch_operations
         WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
      )
      .get(attempt.id, input.providerCallId) as unknown as { id: string } | undefined;
    if (existingRow !== undefined) {
      const dispatch = loadOperationDispatch(database, existingRow.id);
      return {
        value: skillProposalFromDispatch(database, dispatch),
        run: loadRun(database, dispatch.key.runId),
        events: [],
      };
    }

    const run = loadRun(database, attempt.runId);
    if (run.status !== 'running') throw invalid(`Run ${run.id} is not running`);
    const storedActivation = activeActivation(database, run.id, input.activationNumber);
    if (storedActivation.id !== attempt.activationId) {
      throw invalid('Skill proposal Model Attempt belongs to another Activation');
    }
    const project = getProject(database, run.projectId);
    if (project.lifecycle !== 'active') {
      throw invalid(`Project ${project.id} is not active`);
    }
    const settings = getSettings(database, project.id);
    if (run.permissionMode === 'read_only' || settings.permission === 'read_only') {
      throw invalid('Skill proposal requires Project write and Run control permission');
    }

    const journal = loadRunEvents(database, run.id);
    const cursor = nextModelBoundary(journal, input.activationNumber);
    if (
      cursor.startsTurn ||
      cursor.turnNumber !== input.turnNumber ||
      cursor.stepNumber !== input.stepNumber
    ) {
      throw invalid('Skill proposal tool step does not follow the committed Run boundary');
    }
    const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
    const initialDispatch = prepareRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: input.providerCallId,
      authorityWatermarkHash: null,
      occurredAt,
    });
    if (
      initialDispatch.key.toolId !== 'skill.propose' ||
      initialDispatch.guardOutcome !== 'confirmation_required' ||
      initialDispatch.confirmationId !== null ||
      initialDispatch.outcome !== null
    ) {
      throw corrupt(`Dispatch ${initialDispatch.id} has invalid Skill proposal guard state`);
    }

    const skill = {
      skillId: `skill.project.${hashCanonical({ projectId: project.id, dispatchId: initialDispatch.id })}`,
      name: input.input.name,
      description: input.input.description,
      version: '1.0.0',
      contentHash: hashUtf8(input.input.content),
      provenance: 'project' as const,
      trust: 'reviewed' as const,
      content: input.input.content,
      createdAt: occurredAt,
    };
    const target = parseCanonical(ConfirmationTargetSchema, {
      kind: 'skill_registration',
      projectId: project.id,
      skill,
      expectedProjectSettingsRevision: settings.revision,
      expectedProjectSettingsContentHash: settings.contentHash,
      proposedEffectHash: hashCanonical({
        projectId: project.id,
        skill,
        enable: true,
        expectedProjectSettings: {
          revision: settings.revision,
          contentHash: settings.contentHash,
        },
      }),
    });
    if (target.kind !== 'skill_registration') {
      throw corrupt('Skill proposal target lost its registration kind');
    }
    const interactionId = parseCanonical(EntityIdSchema, environment.createId('run_interaction'));
    const confirmationId = parseCanonical(EntityIdSchema, environment.createId('run_confirmation'));
    const summary = `Register Project Skill "${skill.name}" for future root Runs.`;
    database
      .prepare(
        `INSERT INTO run_interactions (
           id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
           allow_free_text, state, answer_message_id, created_at, resolved_at
         ) VALUES (?, ?, 'confirmation', ?, '[]', '[]', 0, 'pending', NULL, ?, NULL)`,
      )
      .run(interactionId, run.id, summary, occurredAt);
    database
      .prepare(
        `INSERT INTO run_confirmations (
           id, run_id, interaction_id, target_v1_json, immutable_input_hash,
           decision, decided_by_message_id, requested_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
      )
      .run(
        confirmationId,
        run.id,
        interactionId,
        canonicalJson(target),
        initialDispatch.key.inputHash,
        occurredAt,
      );
    const bound = database
      .prepare(
        `UPDATE dispatch_operations
         SET confirmation_id = ?, updated_at = ?
         WHERE id = ? AND guard_outcome = 'confirmation_required'
           AND confirmation_id IS NULL AND outcome_v1_json IS NULL`,
      )
      .run(confirmationId, occurredAt, initialDispatch.id);
    if (Number(bound.changes) !== 1) {
      throw new StorageError(
        'REVISION_CONFLICT',
        `Dispatch ${initialDispatch.id} confirmation binding changed`,
      );
    }
    const outcome = SkillProposeDefinition.parseOutcome({
      status: 'permission_required',
      confirmationId,
      summary,
    });
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: initialDispatch.id,
      outcome,
      occurredAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`Dispatch ${dispatch.id} Skill proposal settlement disappeared`);
    }
    const { catalog } = loadRunSnapshots(database, run);
    const tool = catalog.tools.find(({ id }) => id === dispatch.key.toolId);
    if (tool === undefined) throw corrupt(`Dispatch ${dispatch.id} tool left its frozen catalog`);
    try {
      assertRunStateTransition(run.status, 'waiting_confirmation');
    } catch (cause) {
      throw invalid(`Run ${run.id} cannot wait for Skill confirmation`, cause);
    }
    const drafts: AppendRunEventBatchInput['events'] = [
      ...dispatchStartDrafts(
        environment,
        context,
        run,
        dispatch,
        tool,
        input.activationNumber,
        input.turnNumber,
        input.stepNumber,
        occurredAt,
      ),
      {
        eventId: environment.createId('run_event'),
        visibility: 'model_surface',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'tool_result_ref',
          callId: dispatch.id,
          toolName: dispatch.key.toolId,
          outputPayloadId: dispatch.id,
          outputSchemaHash: tool.outcomeSchema.sha256,
          outputHash: dispatch.outcomeHash,
          success: false,
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
          type: 'tool_summary',
          toolName: dispatch.key.toolId,
          status: 'blocked',
          summary,
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
          type: 'step_ended',
          activationNumber: input.activationNumber,
          turnNumber: input.turnNumber,
          stepNumber: input.stepNumber,
          outcome: 'blocked',
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
          type: 'confirmation_requested',
          interactionId,
          confirmationId,
          summary,
          target,
          immutableInputHash: dispatch.key.inputHash,
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
          type: 'activation_changed',
          activationNumber: input.activationNumber,
          state: 'ended',
          endReason: 'waiting',
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
          state: 'waiting_confirmation',
          runRevision: run.revision + 1,
        },
      },
    ];
    const activationOrdinal = drafts.length - 2;
    const events = appendRunEventBatch(database, {
      runId: run.id,
      commandId: input.commandId,
      events: drafts,
    });
    const activationEvent = events[activationOrdinal];
    const head = events.at(-1);
    if (activationEvent === undefined || head === undefined) {
      throw corrupt(`Run ${run.id} Skill proposal events are incomplete`);
    }
    closeRunActivation(database, storedActivation, activationEvent.sequence, occurredAt, 'waiting');
    const updatedRun = advanceRunJournalHead(
      database,
      run,
      { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
      { status: 'waiting_confirmation', terminalOutcome: null },
    );
    const record = skillProposalFromDispatch(database, dispatch);
    return { value: record, run: updatedRun, events };
  });
}

function protectedMutationCatalogToolForAttempt(
  database: DatabaseSync,
  run: Run,
  attempt: ModelAttemptRecordV1,
  toolId: Parameters<typeof protectedMutationCatalogTool>[2],
): CapabilityCatalogSnapshotV1['tools'][number] {
  const { catalog } = loadRunSnapshots(database, run);
  return protectedMutationCatalogTool(catalog, attempt.request.materializedTools, toolId);
}

interface PendingProtectedMutationConfirmation {
  readonly id: string;
  readonly interactionId: string;
  readonly immutableInputHash: string;
  readonly requestedAt: string;
  readonly target: ProtectedMutationTarget;
}

function pendingProtectedMutationConfirmation(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
): PendingProtectedMutationConfirmation {
  if (dispatch.confirmationId === null) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} has no Run Confirmation`);
  }
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
    .get(dispatch.confirmationId) as unknown as
    | {
        readonly id: string;
        readonly run_id: string;
        readonly interaction_id: string;
        readonly target_v1_json: string;
        readonly immutable_input_hash: string;
        readonly decision: string | null;
        readonly decided_by_message_id: string | null;
        readonly requested_at: string;
        readonly decided_at: string | null;
        readonly interaction_run_id: string;
        readonly interaction_kind: string;
        readonly interaction_state: string;
        readonly answer_message_id: string | null;
        readonly resolved_at: string | null;
      }
    | undefined;
  if (row === undefined) {
    throw corrupt(`Protected mutation Confirmation ${dispatch.confirmationId} was not found`);
  }
  let target: z.output<typeof ConfirmationTargetSchema>;
  let requestedAt: string;
  try {
    target = parseCanonical(ConfirmationTargetSchema, JSON.parse(row.target_v1_json) as unknown);
    requestedAt = parseCanonical(IsoTimestampSchema, row.requested_at);
  } catch (cause) {
    throw corrupt(`Protected mutation Confirmation ${row.id} is invalid`, cause);
  }
  protectedMutationInputFromDispatch(dispatch);
  const expectedDispatch = {
    operationId: dispatch.id,
    toolId: dispatch.key.toolId,
    toolVersion: dispatch.key.toolVersion,
    inputHash: dispatch.key.inputHash,
    fingerprint: dispatch.key.fingerprint,
    authorityWatermarkHash: dispatch.key.authorityWatermarkHash,
  };
  if (
    !isProtectedMutationTool(dispatch.key.toolId) ||
    dispatch.origin.kind !== 'model' ||
    dispatch.guardOutcome !== 'confirmation_required' ||
    dispatch.outcome !== null ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    dispatch.projectEventId !== null ||
    row.id !== dispatch.confirmationId ||
    row.run_id !== dispatch.key.runId ||
    row.interaction_run_id !== dispatch.key.runId ||
    row.interaction_kind !== 'confirmation' ||
    row.interaction_state !== 'pending' ||
    row.answer_message_id !== null ||
    row.resolved_at !== null ||
    row.decision !== null ||
    row.decided_by_message_id !== null ||
    row.decided_at !== null ||
    row.immutable_input_hash !== dispatch.key.inputHash ||
    canonicalJson(target) !== row.target_v1_json ||
    target.kind !== 'protected_mutation' ||
    canonicalJson(target.dispatch) !== canonicalJson(expectedDispatch)
  ) {
    throw corrupt(`Protected mutation Confirmation ${row.id} binding is invalid`);
  }
  assertProtectedMutationPendingBinding(dispatch, target);
  return Object.freeze({
    id: row.id,
    interactionId: row.interaction_id,
    immutableInputHash: row.immutable_input_hash,
    requestedAt,
    target,
  });
}

function protectedMutationBoundaryFromDispatch(
  database: DatabaseSync,
  dispatch: OperationDispatchRecord,
  input: ProtectedMutationInput,
): ProtectedMutationBoundaryRecord {
  if (
    dispatch.key.toolId !== input.toolId ||
    dispatch.origin.kind !== 'model' ||
    canonicalJson(dispatch.key.input) !== canonicalJson(input.command)
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `Protected mutation Dispatch ${dispatch.id} changed durable semantics`,
    );
  }
  if (dispatch.outcome?.status === 'succeeded') {
    return Object.freeze({
      kind: 'succeeded',
      dispatch,
      result: protectedMutationSuccessFromDispatch(dispatch),
    });
  }
  if (dispatch.outcome === null) {
    const confirmation = pendingProtectedMutationConfirmation(database, dispatch);
    return Object.freeze({
      kind: 'waiting_confirmation',
      dispatch,
      confirmationId: confirmation.id,
      target: confirmation.target,
    });
  }
  throw new StorageError(
    'IDEMPOTENCY_CONFLICT',
    `Protected mutation Dispatch ${dispatch.id} was settled with a different outcome`,
  );
}

function prepareProtectedMutationBoundary(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: PrepareProtectedMutationBoundaryInput,
  contextValue: CommandContext,
): HarnessCommit<ProtectedMutationBoundaryRecord> {
  const input = parseCanonical(PrepareProtectedMutationBoundaryInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const attempt = loadModelAttemptRecord(database, input.modelAttemptId);
    if (
      attempt.runId !== input.runId ||
      attempt.state !== 'succeeded' ||
      attempt.response === null
    ) {
      throw invalid('Protected mutation requires its committed successful model call');
    }
    const call = attempt.response.events.find(
      (event) => event.type === 'tool_call' && event.providerCallId === input.providerCallId,
    );
    if (call?.type !== 'tool_call' || call.canonicalArguments === undefined) {
      throw invalid('Protected mutation model call was not found');
    }
    let mutation: ProtectedMutationInput;
    try {
      mutation = parseProtectedMutationInput(call.toolId, call.canonicalArguments);
    } catch (cause) {
      throw invalid('Protected mutation model input is invalid', cause);
    }
    if (
      !isProtectedMutationTool(call.toolId) ||
      canonicalJson(mutation.command) !== canonicalJson(call.canonicalArguments) ||
      canonicalJson(mutation.command) !== canonicalJson(input.input)
    ) {
      throw invalid('Protected mutation does not match its canonical model tool call');
    }
    const existingRow = database
      .prepare(
        `SELECT id FROM dispatch_operations
         WHERE origin_model_attempt_id = ? AND origin_provider_call_id = ?`,
      )
      .get(attempt.id, input.providerCallId) as unknown as { readonly id: string } | undefined;
    if (existingRow !== undefined) {
      const dispatch = loadOperationDispatch(database, existingRow.id);
      return {
        value: protectedMutationBoundaryFromDispatch(database, dispatch, mutation),
        run: loadRun(database, dispatch.key.runId),
        events: [],
      };
    }
    const run = loadRun(database, attempt.runId);
    if (run.status !== 'running') throw invalid(`Run ${run.id} is not running`);
    if (
      context.actor !== 'commander' ||
      context.causation.kind !== 'run' ||
      context.causation.runId !== run.id
    ) {
      throw invalid(`${mutation.toolId} requires its Commander Run context`);
    }
    const storedActivation = activeActivation(database, run.id, input.activationNumber);
    if (storedActivation.id !== attempt.activationId) {
      throw invalid(`${mutation.toolId} Model Attempt belongs to another Activation`);
    }
    const project = getProject(database, run.projectId);
    const settings = getSettings(database, project.id);
    if (project.lifecycle !== 'active') throw invalid(`Project ${project.id} is not active`);
    if (run.permissionMode === 'read_only' || settings.permission === 'read_only') {
      throw invalid(`${mutation.toolId} requires Project write and Run control permission`);
    }
    const journal = loadRunEvents(database, run.id);
    const cursor = nextModelBoundary(journal, input.activationNumber);
    if (
      cursor.startsTurn ||
      cursor.turnNumber !== input.turnNumber ||
      cursor.stepNumber !== input.stepNumber
    ) {
      throw invalid(`${mutation.toolId} tool step does not follow the committed Run boundary`);
    }
    const tool = protectedMutationCatalogToolForAttempt(database, run, attempt, mutation.toolId);
    const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
    const initialDispatch = prepareProtectedMutationRuntimeDispatch(database, environment, {
      modelAttemptId: attempt.id,
      providerCallId: input.providerCallId,
      authorityWatermarkHash: null,
      occurredAt,
    });
    if (
      initialDispatch.key.toolId !== mutation.toolId ||
      initialDispatch.guardOutcome !== 'confirmation_required' ||
      initialDispatch.confirmationId !== null ||
      initialDispatch.outcome !== null ||
      canonicalJson(initialDispatch.key.input) !== canonicalJson(mutation.command)
    ) {
      throw corrupt(
        `Protected mutation Dispatch ${initialDispatch.id} is not an unbound protected dispatch`,
      );
    }
    const planned = planProtectedMutationInTransaction(
      database,
      environment,
      initialDispatch,
      context,
      occurredAt,
    );
    if (
      planned.projectId !== run.projectId ||
      canonicalJson(planned.command) !== canonicalJson(mutation.command)
    ) {
      throw corrupt(
        `Protected mutation Dispatch ${initialDispatch.id} planning changed its target`,
      );
    }
    if (!protectedMutationRequiresConfirmation(planned)) {
      const allowed = transitionRuntimeDispatchGuard(database, {
        dispatchOperationId: initialDispatch.id,
        outcome: 'allowed',
        confirmationId: null,
        occurredAt,
      });
      const committed = commitPlannedProtectedMutationInTransaction(
        database,
        environment,
        planned,
        context,
        { dispatchOperationId: allowed.id },
      );
      const bound = bindRuntimeDispatchProjectEvent(database, {
        dispatchOperationId: allowed.id,
        projectEventId: protectedMutationProjectEventId(committed),
        occurredAt,
      });
      const result = committed.result;
      const dispatch = settleRuntimeDispatch(database, {
        dispatchOperationId: bound.id,
        outcome: protectedMutationOutcome(committed),
        occurredAt,
      });
      if (dispatch.outcome === null || dispatch.outcomeHash === null) {
        throw corrupt(`Protected mutation Dispatch ${dispatch.id} settlement disappeared`);
      }
      const events = appendRunEventBatch(database, {
        runId: run.id,
        commandId: input.commandId,
        events: [
          ...dispatchStartDrafts(
            environment,
            context,
            run,
            dispatch,
            tool,
            input.activationNumber,
            input.turnNumber,
            input.stepNumber,
            occurredAt,
          ),
          {
            eventId: environment.createId('run_event'),
            visibility: 'model_surface',
            occurredAt,
            actor: context.actor,
            causation: context.causation,
            correlationId: context.correlationId,
            payload: {
              type: 'tool_result_ref',
              callId: dispatch.id,
              toolName: dispatch.key.toolId,
              outputPayloadId: dispatch.id,
              outputSchemaHash: tool.outcomeSchema.sha256,
              outputHash: dispatch.outcomeHash,
              success: true,
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
              type: 'tool_summary',
              toolName: dispatch.key.toolId,
              status: 'succeeded',
              summary: `Tool ${dispatch.key.toolId} succeeded`,
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
              type: 'step_ended',
              activationNumber: input.activationNumber,
              turnNumber: input.turnNumber,
              stepNumber: input.stepNumber,
              outcome: 'completed',
            },
          },
        ],
      });
      const head = events.at(-1);
      if (head === undefined) {
        throw corrupt(`Protected mutation Dispatch ${dispatch.id} emitted no settlement events`);
      }
      const updatedRun = advanceRunJournalHead(database, run, {
        eventId: head.eventId,
        sequence: head.sequence,
        eventHash: head.eventHash,
      });
      return {
        value: Object.freeze({ kind: 'succeeded', dispatch, result }),
        run: updatedRun,
        events,
      };
    }

    const target = protectedMutationConfirmationTargetForPlan(initialDispatch, planned);
    const interactionId = parseCanonical(EntityIdSchema, environment.createId('run_interaction'));
    const confirmationId = parseCanonical(EntityIdSchema, environment.createId('run_confirmation'));
    const summary = `Approve protected ${initialDispatch.key.toolId} mutation.`;
    database
      .prepare(
        `INSERT INTO run_interactions (
           id, run_id, kind, prompt, options_v1_json, context_refs_v1_json,
           allow_free_text, state, answer_message_id, created_at, resolved_at
         ) VALUES (?, ?, 'confirmation', ?, '[]', '[]', 0, 'pending', NULL, ?, NULL)`,
      )
      .run(interactionId, run.id, summary, occurredAt);
    database
      .prepare(
        `INSERT INTO run_confirmations (
           id, run_id, interaction_id, target_v1_json, immutable_input_hash,
           decision, decided_by_message_id, requested_at, decided_at
         ) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL)`,
      )
      .run(
        confirmationId,
        run.id,
        interactionId,
        canonicalJson(target),
        initialDispatch.key.inputHash,
        occurredAt,
      );
    const dispatch = bindRuntimeDispatchConfirmation(database, {
      dispatchOperationId: initialDispatch.id,
      confirmationId,
      occurredAt,
    });
    try {
      assertRunStateTransition(run.status, 'waiting_confirmation');
    } catch (cause) {
      throw invalid(`Run ${run.id} cannot wait for a protected mutation confirmation`, cause);
    }
    const events = appendRunEventBatch(database, {
      runId: run.id,
      commandId: input.commandId,
      events: [
        ...dispatchStartDrafts(
          environment,
          context,
          run,
          dispatch,
          tool,
          input.activationNumber,
          input.turnNumber,
          input.stepNumber,
          occurredAt,
        ),
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'confirmation_requested',
            interactionId,
            confirmationId,
            summary,
            target,
            immutableInputHash: dispatch.key.inputHash,
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
            state: 'waiting_confirmation',
            runRevision: run.revision + 1,
          },
        },
      ],
    });
    const head = events.at(-1);
    if (head === undefined) {
      throw corrupt(`Protected mutation Dispatch ${dispatch.id} emitted no confirmation events`);
    }
    const updatedRun = advanceRunJournalHead(
      database,
      run,
      { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
      { status: 'waiting_confirmation', terminalOutcome: null },
    );
    return {
      value: Object.freeze({
        kind: 'waiting_confirmation',
        dispatch,
        confirmationId,
        target,
      }),
      run: updatedRun,
      events,
    };
  });
}

function productionMutationReceiptEventIds(
  plannedIds: Extract<
    ProtectedMutationTarget['plannedIds'],
    { readonly tool: 'production.mutate' }
  >,
): readonly string[] {
  switch (plannedIds.variant) {
    case 'production_create':
      return plannedIds.parentEventId === null
        ? [plannedIds.objectEventId]
        : [plannedIds.objectEventId, plannedIds.parentEventId];
    case 'production_update':
    case 'production_archive':
    case 'production_restore':
    case 'production_cite':
      return [plannedIds.objectEventId];
    case 'production_relate_link':
    case 'production_relate_unlink':
      return [plannedIds.sourceEventId];
  }
}

export function completePendingProtectedMutationStepInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: CompletePendingProtectedMutationStepInput,
  contextValue: CommandContext,
): CompletePendingProtectedMutationStepResult {
  if (!database.isTransaction) {
    throw invalid('Pending protected mutation completion requires an active transaction');
  }
  const context = parseCanonical(CommandContextSchema, contextValue);
  const dispatchOperationId = parseCanonical(EntityIdSchema, inputValue.dispatch.id);
  const confirmationId = parseCanonical(EntityIdSchema, inputValue.confirmation.id);
  const messageId = parseCanonical(EntityIdSchema, inputValue.confirmation.messageId);
  const messageHash = parseCanonical(Sha256Schema, inputValue.confirmation.messageHash);
  const inboxMessageId = parseCanonical(EntityIdSchema, inputValue.inbox.id);
  const commandId = parseCanonical(EntityIdSchema, inputValue.commandId);
  const occurredAt = parseCanonical(IsoTimestampSchema, inputValue.occurredAt);
  if (!Number.isInteger(inputValue.inbox.sequence) || inputValue.inbox.sequence <= 0) {
    throw invalid('Pending protected mutation completion Inbox sequence is invalid');
  }
  if (context.actor !== 'user') {
    throw invalid('Only a user may complete a pending protected mutation confirmation');
  }
  const dispatch = loadOperationDispatch(database, dispatchOperationId);
  const origin = dispatch.origin;
  const mutation = protectedMutationInputFromDispatch(dispatch);
  if (
    origin.kind !== 'model' ||
    dispatch.confirmationId !== confirmationId ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    (inputValue.confirmation.approved
      ? dispatch.guardOutcome !== 'allowed' || dispatch.outcome?.status !== 'succeeded'
      : dispatch.guardOutcome !== 'denied' ||
        dispatch.outcome?.status !== 'permission_denied' ||
        dispatch.outcome.code !== 'protected_denied' ||
        dispatch.projectEventId !== null)
  ) {
    throw invalid(
      `Protected mutation Dispatch ${dispatch.id} is not settled for this confirmation`,
    );
  }
  const confirmation = database
    .prepare(
      `SELECT confirmation.run_id, confirmation.interaction_id, confirmation.target_v1_json,
              confirmation.immutable_input_hash, confirmation.decision,
              confirmation.decided_by_message_id, confirmation.requested_at,
              confirmation.decided_at, interaction.run_id AS interaction_run_id,
              interaction.kind AS interaction_kind, interaction.state AS interaction_state,
              interaction.answer_message_id, interaction.resolved_at
       FROM run_confirmations AS confirmation
       JOIN run_interactions AS interaction ON interaction.id = confirmation.interaction_id
       WHERE confirmation.id = ?`,
    )
    .get(confirmationId) as unknown as
    | {
        readonly run_id: string;
        readonly interaction_id: string;
        readonly target_v1_json: string;
        readonly immutable_input_hash: string;
        readonly decision: string | null;
        readonly decided_by_message_id: string | null;
        readonly requested_at: string;
        readonly decided_at: string | null;
        readonly interaction_run_id: string;
        readonly interaction_kind: string;
        readonly interaction_state: string;
        readonly answer_message_id: string | null;
        readonly resolved_at: string | null;
      }
    | undefined;
  if (confirmation === undefined) {
    throw corrupt(`Protected mutation Confirmation ${confirmationId} was not found`);
  }
  let target: z.output<typeof ConfirmationTargetSchema>;
  try {
    target = parseCanonical(
      ConfirmationTargetSchema,
      JSON.parse(confirmation.target_v1_json) as unknown,
    );
    parseCanonical(IsoTimestampSchema, confirmation.requested_at);
    if (confirmation.decided_at === null) throw new Error('missing decision timestamp');
    parseCanonical(IsoTimestampSchema, confirmation.decided_at);
  } catch (cause) {
    throw corrupt(`Protected mutation Confirmation ${confirmationId} is invalid`, cause);
  }
  const expectedDispatch = {
    operationId: dispatch.id,
    toolId: dispatch.key.toolId,
    toolVersion: dispatch.key.toolVersion,
    inputHash: dispatch.key.inputHash,
    fingerprint: dispatch.key.fingerprint,
    authorityWatermarkHash: dispatch.key.authorityWatermarkHash,
  };
  const expectedDecision = inputValue.confirmation.approved ? 'approved' : 'denied';
  if (
    confirmation.run_id !== dispatch.key.runId ||
    confirmation.interaction_run_id !== dispatch.key.runId ||
    confirmation.interaction_kind !== 'confirmation' ||
    confirmation.interaction_state !== 'answered' ||
    confirmation.answer_message_id !== messageId ||
    confirmation.resolved_at === null ||
    confirmation.decision !== expectedDecision ||
    confirmation.decided_by_message_id !== messageId ||
    confirmation.immutable_input_hash !== dispatch.key.inputHash ||
    canonicalJson(target) !== confirmation.target_v1_json ||
    target.kind !== 'protected_mutation' ||
    canonicalJson(target.dispatch) !== canonicalJson(expectedDispatch)
  ) {
    throw corrupt(`Protected mutation Confirmation ${confirmationId} binding is invalid`);
  }
  assertProtectedMutationTargetBinding(dispatch, target);
  if (inputValue.confirmation.approved) {
    const result = protectedMutationSuccessFromDispatch(dispatch);
    if (target.plannedIds.tool === 'production.mutate') {
      if (!('receipts' in result)) {
        throw corrupt(
          `Production protected mutation Confirmation ${confirmationId} result changed`,
        );
      }
      const expectedEventIds = productionMutationReceiptEventIds(target.plannedIds);
      const actualEventIds = result.receipts.map(({ eventId }) => eventId);
      if (actualEventIds.length === 0) {
        if (dispatch.projectEventId !== null) {
          throw corrupt(
            `Production protected mutation Confirmation ${confirmationId} bound an event`,
          );
        }
      } else if (
        canonicalJson(actualEventIds) !== canonicalJson(expectedEventIds) ||
        dispatch.projectEventId !== expectedEventIds.at(-1)
      ) {
        throw corrupt(
          `Production protected mutation Confirmation ${confirmationId} planned IDs changed`,
        );
      }
    } else if (
      !('choice' in result) ||
      result.choice.id !== target.plannedIds.userChoiceId ||
      dispatch.projectEventId !== target.plannedIds.projectEventId
    ) {
      throw corrupt(`Protected mutation Confirmation ${confirmationId} planned IDs changed`);
    }
  }
  const run = loadRun(database, dispatch.key.runId);
  if (run.status !== 'waiting_confirmation') {
    throw invalid(`Run ${run.id} is not waiting for protected mutation confirmation`);
  }
  if (origin.kind !== 'model') {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} origin changed`);
  }
  if (dispatch.outcomeHash === null) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} outcome hash is missing`);
  }
  const modelAttemptId = origin.modelAttemptId;
  const providerCallId = origin.providerCallId;
  const attempt = loadModelAttemptRecord(database, modelAttemptId);
  const call = attempt.response?.events.find(
    (event) => event.type === 'tool_call' && event.providerCallId === providerCallId,
  );
  if (
    attempt.state !== 'succeeded' ||
    attempt.runId !== run.id ||
    call?.type !== 'tool_call' ||
    call.toolId !== mutation.toolId ||
    canonicalJson(call.canonicalArguments) !== canonicalJson(mutation.command)
  ) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} model boundary is invalid`);
  }
  const storedActivation = activeActivation(database, run.id, attempt.request.activationNumber);
  if (storedActivation.id !== attempt.activationId) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} activation identity changed`);
  }
  const tool = protectedMutationCatalogToolForAttempt(database, run, attempt, mutation.toolId);
  const message = loadMessage(database, messageId);
  if (
    message.projectId !== run.projectId ||
    message.chatId !== run.chatId ||
    message.role !== 'user' ||
    message.status !== 'accepted' ||
    message.contentHash !== messageHash
  ) {
    throw corrupt(`Protected mutation Confirmation ${confirmationId} answer Message is invalid`);
  }
  const inbox = listRunInbox(database, run.id).find(
    ({ id, sequence }) => id === inboxMessageId && sequence === inputValue.inbox.sequence,
  );
  if (
    inbox === undefined ||
    inbox.state !== 'queued' ||
    inbox.source.kind !== 'message' ||
    inbox.source.messageId !== message.id ||
    inbox.contentHash !== message.contentHash
  ) {
    throw corrupt(`Protected mutation Confirmation ${confirmationId} queued Inbox is invalid`);
  }
  const journal = loadRunEvents(database, run.id);
  const step = openDispatchStep(journal, storedActivation.activation.activationNumber, dispatch.id);
  try {
    assertRunStateTransition(run.status, 'running');
  } catch (cause) {
    throw invalid(`Run ${run.id} cannot resume after protected mutation confirmation`, cause);
  }
  const summaryStatus = inputValue.confirmation.approved ? 'succeeded' : 'failed';
  const stepOutcome = inputValue.confirmation.approved ? 'completed' : 'failed';
  const events = appendRunEventBatch(database, {
    runId: run.id,
    commandId,
    events: [
      {
        eventId: environment.createId('run_event'),
        visibility: 'model_surface',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'confirmation_answered',
          confirmationId,
          approved: inputValue.confirmation.approved,
          messageId: message.id,
          messageHash: message.contentHash,
        },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'model_surface',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'tool_result_ref',
          callId: dispatch.id,
          toolName: dispatch.key.toolId,
          outputPayloadId: dispatch.id,
          outputSchemaHash: tool.outcomeSchema.sha256,
          outputHash: dispatch.outcomeHash!,
          success: inputValue.confirmation.approved,
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
          type: 'tool_summary',
          toolName: dispatch.key.toolId,
          status: summaryStatus,
          summary: `Tool ${dispatch.key.toolId} ${summaryStatus}`,
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
          type: 'step_ended',
          activationNumber: storedActivation.activation.activationNumber,
          turnNumber: step.turnNumber,
          stepNumber: step.stepNumber,
          outcome: stepOutcome,
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
          type: 'activation_changed',
          activationNumber: storedActivation.activation.activationNumber,
          state: 'ended',
          endReason: 'waiting',
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
    ],
  });
  const activationEvent = events[4];
  const head = events.at(-1);
  if (activationEvent === undefined || head === undefined) {
    throw corrupt(`Protected mutation Dispatch ${dispatch.id} completion events are incomplete`);
  }
  closeRunActivation(database, storedActivation, activationEvent.sequence, occurredAt, 'waiting');
  const updatedRun = advanceRunJournalHead(
    database,
    run,
    { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
    { status: 'running', terminalOutcome: null },
  );
  return Object.freeze({ run: updatedRun, events });
}

export function completePendingDeliveryExportConfirmationInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: CompletePendingDeliveryExportConfirmationInput,
  contextValue: CommandContext,
): CompletePendingDeliveryExportConfirmationResult {
  if (!database.isTransaction) {
    throw invalid('Pending delivery export confirmation completion requires an active transaction');
  }
  const context = parseCanonical(CommandContextSchema, contextValue);
  const dispatchOperationId = parseCanonical(EntityIdSchema, inputValue.dispatch.id);
  const confirmationId = parseCanonical(EntityIdSchema, inputValue.confirmation.id);
  const messageId = parseCanonical(EntityIdSchema, inputValue.confirmation.messageId);
  const messageHash = parseCanonical(Sha256Schema, inputValue.confirmation.messageHash);
  const commandId = parseCanonical(EntityIdSchema, inputValue.commandId);
  const occurredAt = parseCanonical(IsoTimestampSchema, inputValue.occurredAt);
  if (context.actor !== 'user') {
    throw invalid('Only a user may complete a pending delivery export confirmation');
  }
  const boundary = loadDeliveryExportBoundary(database, dispatchOperationId);
  const dispatch = boundary.dispatch;
  if (canonicalJson(inputValue.dispatch) !== canonicalJson(dispatch)) {
    throw new StorageError(
      'REVISION_CONFLICT',
      `delivery.export Dispatch ${dispatch.id} changed during confirmation`,
    );
  }
  const call = deliveryExportCall(
    boundary.attempt.response!,
    dispatch.origin.kind === 'model' ? dispatch.origin.providerCallId : '',
  );
  const confirmation = deliveryExportConfirmation(database, dispatch, call.exportInput);
  if (
    confirmation.id !== confirmationId ||
    confirmation.decision !== (inputValue.confirmation.approved ? 'approved' : 'denied') ||
    confirmation.messageId !== messageId ||
    (inputValue.confirmation.approved
      ? dispatch.guardOutcome !== 'allowed' ||
        dispatch.outcome !== null ||
        deliveryExportExpectedResult(database, dispatch) !== null
      : dispatch.guardOutcome !== 'denied' ||
        dispatch.outcome?.status !== 'permission_denied' ||
        dispatch.outcome.code !== 'protected_denied' ||
        dispatch.outcomeHash === null ||
        deliveryExportExpectedResult(database, dispatch) !== null)
  ) {
    throw invalid(`delivery.export Dispatch ${dispatch.id} is not settled for this confirmation`);
  }
  const run = boundary.parent;
  if (run.status !== 'waiting_confirmation') {
    throw invalid(`Run ${run.id} is not waiting for delivery export confirmation`);
  }
  const storedActivation = activeActivation(
    database,
    run.id,
    boundary.attempt.request.activationNumber,
  );
  if (storedActivation.id !== boundary.attempt.activationId) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} activation identity changed`);
  }
  const message = loadMessage(database, messageId);
  if (
    message.projectId !== run.projectId ||
    message.chatId !== run.chatId ||
    message.role !== 'user' ||
    message.status !== 'accepted' ||
    message.contentHash !== messageHash
  ) {
    throw corrupt(`delivery.export Confirmation ${confirmationId} answer Message is invalid`);
  }
  const journal = loadRunEvents(database, run.id);
  const step = openDispatchStep(journal, storedActivation.activation.activationNumber, dispatch.id);
  try {
    assertRunStateTransition(run.status, 'running');
  } catch (cause) {
    throw invalid(`Run ${run.id} cannot resume after delivery export confirmation`, cause);
  }
  const tool = deliveryExportCatalogTool(database, run);
  const deniedEvents: AppendRunEventBatchInput['events'] = inputValue.confirmation.approved
    ? []
    : [
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash!,
            success: false,
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
            type: 'tool_summary',
            toolName: dispatch.key.toolId,
            status: 'failed',
            summary: `Tool ${dispatch.key.toolId} denied`,
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
            type: 'step_ended',
            activationNumber: storedActivation.activation.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'failed',
          },
        },
      ];
  const events = appendRunEventBatch(database, {
    runId: run.id,
    commandId,
    events: [
      {
        eventId: environment.createId('run_event'),
        visibility: 'model_surface',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'confirmation_answered',
          confirmationId,
          approved: inputValue.confirmation.approved,
          messageId: message.id,
          messageHash: message.contentHash,
        },
      },
      ...deniedEvents,
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
    ],
  });
  const head = events.at(-1);
  if (head === undefined) {
    throw corrupt(`delivery.export Dispatch ${dispatch.id} confirmation events are incomplete`);
  }
  const updatedRun = advanceRunJournalHead(
    database,
    run,
    { eventId: head.eventId, sequence: head.sequence, eventHash: head.eventHash },
    { status: 'running', terminalOutcome: null },
  );
  return Object.freeze({ run: updatedRun, events });
}

function toolSummaryStatus(outcome: RuntimeLoopOutcome): 'succeeded' | 'failed' | 'blocked' {
  if (outcome.status === 'succeeded') return 'succeeded';
  return outcome.status === 'permission_required' ||
    outcome.status === 'budget_blocked' ||
    outcome.status === 'conflict' ||
    outcome.status === 'recovery_required'
    ? 'blocked'
    : 'failed';
}

function settleDispatch(
  database: DatabaseSync,
  inputValue: SettleDispatchInput,
  contextValue: CommandContext,
  environment: StorageEnvironment,
): HarnessCommit<OperationDispatchRecord> {
  const parsed = parseCanonical(SettleDispatchInputSchema, inputValue);
  const input: SettleDispatchInput = { ...parsed, outcome: inputValue.outcome };
  const context = parseCanonical(CommandContextSchema, contextValue);
  return withImmediateTransaction(database, () => {
    const before = loadOperationDispatch(database, input.dispatchOperationId);
    if (
      before.key.toolId === DeliveryExportDefinition.id ||
      before.key.toolId === DeliveryPreviewDefinition.id ||
      before.key.toolId === EvaluationRunDefinition.id ||
      before.key.toolId === GenerationSubmitDefinition.id ||
      before.key.toolId === MediaDeriveDefinition.id ||
      isProtectedMutationTool(before.key.toolId)
    ) {
      throw invalid(`${before.key.toolId} requires its dedicated durable settlement boundary`);
    }
    if (
      before.originModelAttemptId !== input.modelAttemptId ||
      before.originProviderCallId !== input.providerCallId
    ) {
      throw invalid('Dispatch origin does not match its model call');
    }
    if (before.outcome !== null) {
      const replay = settleRuntimeDispatch(database, {
        dispatchOperationId: before.id,
        outcome: input.outcome,
        occurredAt: input.completedAt,
      });
      return { value: replay, run: loadRun(database, replay.key.runId), events: [] };
    }
    const storedActivation = activeActivation(database, before.key.runId, input.activationNumber);
    const attempt = loadModelAttemptRecord(database, input.modelAttemptId);
    if (storedActivation.id !== attempt.activationId) {
      throw invalid('Dispatch belongs to another Activation');
    }
    const run = loadRun(database, before.key.runId);
    const journal = loadRunEvents(database, run.id);
    assertOpenStep(journal, input.activationNumber, input.turnNumber, input.stepNumber, 'tool');
    const dispatch = settleRuntimeDispatch(database, {
      dispatchOperationId: before.id,
      outcome: input.outcome,
      occurredAt: input.completedAt,
    });
    if (dispatch.outcome === null || dispatch.outcomeHash === null) {
      throw corrupt(`Dispatch ${dispatch.id} settlement disappeared`);
    }
    const { catalog } = loadRunSnapshots(database, run);
    const tool = catalog.tools.find(({ id }) => id === dispatch.key.toolId);
    if (tool === undefined) throw corrupt(`Dispatch ${dispatch.id} tool left its frozen catalog`);
    const summaryStatus = toolSummaryStatus(dispatch.outcome);
    const pendingInbox = earliestPendingInboxAfterTrigger(database, storedActivation.activation);
    const settlementEvents: AppendRunEventBatchInput['events'] = [
      {
        eventId: environment.createId('run_event'),
        visibility: 'model_surface',
        occurredAt: input.completedAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'tool_result_ref',
          callId: dispatch.id,
          toolName: dispatch.key.toolId,
          outputPayloadId: dispatch.id,
          outputSchemaHash: tool.outcomeSchema.sha256,
          outputHash: dispatch.outcomeHash,
          success: dispatch.outcome.status === 'succeeded',
        },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.completedAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'tool_summary',
          toolName: dispatch.key.toolId,
          status: summaryStatus,
          summary: `Tool ${dispatch.key.toolId} ${summaryStatus}`,
        },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt: input.completedAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'step_ended',
          activationNumber: input.activationNumber,
          turnNumber: input.turnNumber,
          stepNumber: input.stepNumber,
          outcome: summaryStatus === 'succeeded' ? 'completed' : summaryStatus,
        },
      },
    ];
    if (pendingInbox !== null) {
      settlementEvents.push(
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'turn_ended',
            activationNumber: input.activationNumber,
            turnNumber: input.turnNumber,
            outcome: 'interrupted',
          },
        },
        {
          eventId: environment.createId('run_event'),
          visibility: 'public',
          occurredAt: input.completedAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'activation_changed',
            activationNumber: input.activationNumber,
            state: 'ended',
            endReason: 'safe_boundary',
          },
        },
      );
    }
    const activationEventOrdinal = pendingInbox === null ? null : settlementEvents.length - 1;
    const events = appendRunEventBatch(database, {
      runId: run.id,
      commandId: input.commandId,
      events: settlementEvents,
    });
    const head = events.at(-1)!;
    if (activationEventOrdinal !== null) {
      const activationEvent = events[activationEventOrdinal];
      if (activationEvent === undefined) {
        throw corrupt(`Run ${run.id} safe-boundary Dispatch settlement events are incomplete`);
      }
      closeRunActivation(
        database,
        storedActivation,
        activationEvent.sequence,
        input.completedAt,
        'safe_boundary',
      );
    }
    const updatedRun = advanceRunJournalHead(database, run, {
      eventId: head.eventId,
      sequence: head.sequence,
      eventHash: head.eventHash,
    });
    return { value: dispatch, run: updatedRun, events };
  });
}

function commandEvents(database: DatabaseSync, runId: string, commandId: string): RunEvent[] {
  const events: RunEvent[] = [];
  for (let ordinal = 0; ordinal < 100; ordinal += 1) {
    const event = loadRunEventForCommand(database, runId, commandId, ordinal);
    if (event === undefined) break;
    events.push(event);
  }
  return events;
}

function assertRecoveryRunIdentity(run: Run, input: CloseInterruptedActivationInput): void {
  if (
    run.revision !== input.expectedRunRevision ||
    run.contentHash !== input.expectedRunContentHash ||
    canonicalJson(run.publicEventHead) !== canonicalJson(input.expectedPublicEventHead)
  ) {
    throw new StorageError('REVISION_CONFLICT', `Run ${run.id} changed before recovery`);
  }
  if (run.parentRunId !== null || (run.status !== 'running' && run.status !== 'recovering')) {
    throw invalid(`Run ${run.id} is not an active recovery root`);
  }
}

function assertTailOpenStep(
  journal: readonly RunEvent[],
  activationNumber: number,
  turnNumber: number,
  stepNumber: number,
  kind: 'model' | 'tool',
): void {
  assertOpenStep(journal, activationNumber, turnNumber, stepNumber, kind);
  const startIndex = journal.findIndex((event) => {
    if (event.visibility !== 'public') return false;
    const payload = availablePayload(event);
    return (
      payload.type === 'step_started' &&
      payload.activationNumber === activationNumber &&
      payload.turnNumber === turnNumber &&
      payload.stepNumber === stepNumber
    );
  });
  if (
    startIndex < 0 ||
    journal.slice(startIndex + 1).some((event) => {
      if (event.visibility !== 'public') return false;
      const payload = availablePayload(event);
      return (
        payload.type === 'step_started' ||
        payload.type === 'step_ended' ||
        payload.type === 'turn_ended'
      );
    })
  ) {
    throw invalid('Recovery frontier is not the tail Run step');
  }
}

function assertClosedUnknownTail(
  journal: readonly RunEvent[],
  activationNumber: number,
  attempt: ModelAttemptRecordV1,
): { turnNumber: number; stepNumber: number } {
  if (attempt.response === null || attempt.usage === null) {
    throw corrupt(`Unknown Model Attempt ${attempt.id} has no canonical settlement`);
  }
  const terminal = attempt.response.events.at(-1);
  if (
    terminal?.type !== 'model_failed' ||
    (terminal.providerState !== 'unknown' && terminal.providerState !== 'submitted')
  ) {
    throw corrupt(`Unknown Model Attempt ${attempt.id} has no unresolved provider state`);
  }
  const step = attemptModelStep(journal, activationNumber, attempt.attemptNumber);
  const startIndex = journal.findIndex((event) => {
    if (event.visibility !== 'public') return false;
    const payload = availablePayload(event);
    return (
      payload.type === 'step_started' &&
      payload.activationNumber === activationNumber &&
      payload.turnNumber === step.turnNumber &&
      payload.stepNumber === step.stepNumber
    );
  });
  const endIndex = journal.findIndex((event, index) => {
    if (index <= startIndex || event.visibility !== 'public') return false;
    const payload = availablePayload(event);
    return (
      payload.type === 'step_ended' &&
      payload.activationNumber === activationNumber &&
      payload.turnNumber === step.turnNumber &&
      payload.stepNumber === step.stepNumber &&
      payload.outcome === 'interrupted'
    );
  });
  const hasUsage = journal.slice(startIndex + 1, endIndex).some((event) => {
    if (event.visibility !== 'public') return false;
    const payload = availablePayload(event);
    return (
      payload.type === 'usage' &&
      canonicalJson(payload) ===
        canonicalJson({
          type: 'usage',
          ...attempt.usage,
        })
    );
  });
  if (
    startIndex < 0 ||
    endIndex < 0 ||
    !hasUsage ||
    journal.slice(endIndex + 1).some((event) => {
      if (event.visibility !== 'public') return false;
      const payload = availablePayload(event);
      return (
        payload.type === 'step_started' ||
        payload.type === 'step_ended' ||
        payload.type === 'turn_ended'
      );
    })
  ) {
    throw corrupt(`Unknown Model Attempt ${attempt.id} Run boundary is incomplete`);
  }
  return step;
}

function openDispatchStep(
  journal: readonly RunEvent[],
  activationNumber: number,
  dispatchId: string,
): { turnNumber: number; stepNumber: number } {
  const callIndex = journal.findIndex((event) => {
    if (event.visibility !== 'model_surface') return false;
    const payload = availablePayload(event);
    return payload.type === 'tool_call_ref' && payload.callId === dispatchId;
  });
  if (callIndex < 0) throw corrupt(`Dispatch ${dispatchId} has no model call event`);
  const start = [...journal.slice(0, callIndex)].reverse().find((event) => {
    if (event.visibility !== 'public') return false;
    const payload = availablePayload(event);
    return payload.type === 'step_started' && payload.kind === 'tool';
  });
  if (start === undefined || start.visibility !== 'public') {
    throw corrupt(`Dispatch ${dispatchId} has no tool step`);
  }
  const payload = availablePayload(start);
  if (payload.type !== 'step_started') throw corrupt(`Dispatch ${dispatchId} step is invalid`);
  assertTailOpenStep(journal, activationNumber, payload.turnNumber, payload.stepNumber, 'tool');
  return { turnNumber: payload.turnNumber, stepNumber: payload.stepNumber };
}

function hasSafeRecoveryCost(mode: string, unknownCost: string, dimension: string): boolean {
  return (
    (mode === 'none' && unknownCost === 'not_applicable' && dimension === 'none') ||
    (mode === 'quote_only' && unknownCost === 'project_policy' && dimension === 'cost')
  );
}

export function isRuntimeReadTool(tool: CapabilityCatalogSnapshotV1['tools'][number]): boolean {
  const metadata = tool.metadata;
  return (
    metadata.profile === 'R' &&
    metadata.category === 'read' &&
    !metadata.effect.domainMutation &&
    !metadata.effect.runMutation &&
    !metadata.effect.externalSideEffect &&
    !metadata.effect.destructive &&
    !metadata.effect.credentialMutation &&
    metadata.permission.required.length === 1 &&
    metadata.permission.required[0] === 'project.read' &&
    !metadata.permission.dynamicProtection &&
    metadata.confirmation.mode === 'none' &&
    !metadata.confirmation.globallyWaivable &&
    metadata.cas.mode === 'none' &&
    metadata.cas.expectedFields.length === 0 &&
    metadata.fingerprint.mode === 'canonical_read' &&
    !metadata.fingerprint.hostAssignedIdempotency &&
    metadata.retry.mode === 'safe' &&
    metadata.retry.technicalAttemptLimit === 1 &&
    metadata.timeout.mode === 'bounded_read' &&
    metadata.timeout.maximumMs === 30_000 &&
    metadata.cancellation.mode === 'read_only' &&
    metadata.cancellation.preservesCommittedResults &&
    (metadata.recovery.mode === 'authority_reread' || metadata.recovery.mode === 'run_state') &&
    !metadata.recovery.unknownStateNeverResubmit &&
    hasSafeRecoveryCost(metadata.cost.mode, metadata.cost.unknownCost, metadata.cost.dimension) &&
    metadata.secretPaths.length === 0 &&
    metadata.variants.every(
      (variant) =>
        variant.profile === 'R' &&
        variant.effect === 'read' &&
        variant.permissions.length === 1 &&
        variant.permissions[0] === 'project.read' &&
        variant.confirmation === 'none' &&
        variant.cas === 'none' &&
        variant.idempotency === 'read_fingerprint' &&
        variant.timeout === 'bounded_read' &&
        variant.cancellation === 'read_only' &&
        hasSafeRecoveryCost(variant.cost, variant.unknownCost, metadata.cost.dimension) &&
        ((variant.retry === 'safe' &&
          (variant.recovery === 'authority_reread' || variant.recovery === 'run_state') &&
          !variant.unknownStateNeverResubmit) ||
          (variant.retry === 'receipt_reconcile_only' &&
            variant.recovery === 'provider_receipt' &&
            variant.unknownStateNeverResubmit)),
    )
  );
}

export function isRecoverySafeRuntimeReadTool(
  tool: CapabilityCatalogSnapshotV1['tools'][number],
): boolean {
  return (
    isRuntimeReadTool(tool) &&
    tool.metadata.variants.every(
      (variant) =>
        variant.retry === 'safe' &&
        (variant.recovery === 'authority_reread' || variant.recovery === 'run_state') &&
        !variant.unknownStateNeverResubmit,
    )
  );
}

function recoverySafeDispatchTool(
  catalog: CapabilityCatalogSnapshotV1,
  dispatch: OperationDispatchRecord,
): CapabilityCatalogSnapshotV1['tools'][number] {
  const tool = catalog.tools.find(({ id }) => id === dispatch.key.toolId);
  if (
    dispatch.originModelAttemptId === null ||
    dispatch.originProviderCallId === null ||
    dispatch.guardOutcome !== 'allowed' ||
    dispatch.confirmationId !== null ||
    dispatch.operationKind !== null ||
    dispatch.ownerAuthority !== null ||
    dispatch.ownerId !== null ||
    dispatch.projectEventId !== null ||
    dispatch.key.authorityWatermarkHash !== null ||
    tool === undefined ||
    tool.version !== dispatch.key.toolVersion ||
    !isRecoverySafeRuntimeReadTool(tool)
  ) {
    throw invalid('Only an unowned frozen safe R dispatch can be recovery-closed');
  }
  return tool;
}

function undispatchedRecoveryCall(
  candidate: UndispatchedModelCall,
  attempts: readonly ModelAttemptRecordV1[],
  dispatches: readonly OperationDispatchRecord[],
  catalog: CapabilityCatalogSnapshotV1,
  journal: readonly RunEvent[],
  activationNumber: number,
): {
  readonly step: { readonly turnNumber: number; readonly stepNumber: number };
  readonly tool: CapabilityCatalogSnapshotV1['tools'][number];
} {
  const { attempt, call } = candidate;
  const terminal = attempt.response?.events.at(-1);
  const calls = attempt.response?.events.filter((event) => event.type === 'tool_call') ?? [];
  const tool = catalog.tools.find(({ id }) => id === call.toolId);
  const materialized = attempt.request.materializedTools.find(({ id }) => id === call.toolId);
  const definition =
    tool === undefined
      ? undefined
      : (executableToolDefinition(call.toolId, tool.version) as unknown as
          | {
              readonly version: string;
              readonly parseInput: (input: unknown) => unknown;
            }
          | undefined);
  if (
    attempts.at(-1)?.id !== attempt.id ||
    attempt.state !== 'succeeded' ||
    terminal?.type !== 'model_completed' ||
    terminal.finishReason !== 'tool_calls' ||
    calls.length !== 1 ||
    calls[0]!.providerCallId !== call.providerCallId ||
    dispatches.some(
      ({ originModelAttemptId, originProviderCallId }) =>
        originModelAttemptId === attempt.id && originProviderCallId === call.providerCallId,
    ) ||
    tool === undefined ||
    materialized === undefined ||
    canonicalJson(materialized) !== canonicalJson(tool) ||
    definition === undefined ||
    definition.version !== tool.version ||
    !isRecoverySafeRuntimeReadTool(tool)
  ) {
    throw invalid('Only one latest committed undispatched frozen safe R call can be recovered');
  }
  let parsedInput: unknown;
  try {
    parsedInput = definition.parseInput(call.canonicalArguments);
  } catch (cause) {
    throw invalid(`Recovery tool ${call.toolId} input is invalid`, cause);
  }
  if (canonicalJson(parsedInput) !== canonicalJson(call.canonicalArguments)) {
    throw invalid(`Recovery tool ${call.toolId} input is not canonical`);
  }
  const step = attemptModelStep(journal, activationNumber, attempt.attemptNumber);
  const cursor = nextModelBoundary(journal, activationNumber);
  if (
    cursor.startsTurn ||
    cursor.turnNumber !== step.turnNumber ||
    cursor.stepNumber !== step.stepNumber + 1
  ) {
    throw invalid('Committed undispatched recovery call is not the tail Run boundary');
  }
  return { step: { turnNumber: cursor.turnNumber, stepNumber: cursor.stepNumber }, tool };
}

function syntheticInterruptedResponse(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
): CanonicalModelResponseV1 {
  const reservations = modelAttemptReservations(database, attempt.runId, attempt.id);
  const cost = reservations.find(({ kind }) => kind === 'cost')?.amount;
  if (reservations.length !== 3 || cost === undefined || !('currency' in cost)) {
    throw corrupt(`Model Attempt ${attempt.id} resource reservations are incomplete`);
  }
  const usage: ModelResourceQuoteV1 =
    attempt.state === 'prepared'
      ? {
          inputTokens: { state: 'known', value: 0 },
          outputTokens: { state: 'known', value: 0 },
          cost: { state: 'known', value: '0', currency: cost.currency },
        }
      : {
          inputTokens: { state: 'unknown' },
          outputTokens: { state: 'unknown' },
          cost: { state: 'unknown', currency: cost.currency },
        };
  return parseCanonical(CanonicalModelResponseV1Schema, {
    version: 1,
    events: [
      { type: 'usage', usage },
      attempt.state === 'prepared'
        ? {
            type: 'model_failed',
            typedCode: 'process_interrupted',
            retrySafety: 'before_submission',
            providerState: 'not_submitted',
          }
        : {
            type: 'model_failed',
            typedCode: 'provider_state_unknown',
            retrySafety: 'never',
            providerState: attempt.state === 'submitted' ? 'submitted' : 'unknown',
          },
    ],
  });
}

function syntheticRunControlInterruptedResponse(
  database: DatabaseSync,
  attempt: ModelAttemptRecordV1,
): CanonicalModelResponseV1 {
  const reservations = modelAttemptReservations(database, attempt.runId, attempt.id);
  const inputTokens = reservations.find(({ kind }) => kind === 'input_tokens')?.amount;
  const outputTokens = reservations.find(({ kind }) => kind === 'output_tokens')?.amount;
  const cost = reservations.find(({ kind }) => kind === 'cost')?.amount;
  if (
    reservations.length !== 3 ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    cost === undefined ||
    'currency' in inputTokens ||
    'currency' in outputTokens ||
    !('currency' in cost)
  ) {
    throw corrupt(`Model Attempt ${attempt.id} resource reservations are incomplete`);
  }
  const usage: ModelResourceQuoteV1 =
    attempt.state === 'prepared'
      ? {
          inputTokens: { state: 'known', value: 0 },
          outputTokens: { state: 'known', value: 0 },
          cost: { state: 'known', value: '0', currency: cost.currency },
        }
      : {
          // A locally cancelled in-flight request has no provider receipt. Account for its reserved
          // upper bound as an estimate so resume remains safe without inventing exact zero usage.
          inputTokens:
            inputTokens.state === 'unknown'
              ? { state: 'unknown' }
              : { state: 'estimated', value: inputTokens.value },
          outputTokens:
            outputTokens.state === 'unknown'
              ? { state: 'unknown' }
              : { state: 'estimated', value: outputTokens.value },
          cost:
            cost.state === 'unknown'
              ? { state: 'unknown', currency: cost.currency }
              : { state: 'estimated', value: cost.value, currency: cost.currency },
        };
  return parseCanonical(CanonicalModelResponseV1Schema, {
    version: 1,
    events: [
      { type: 'usage', usage },
      attempt.state === 'prepared'
        ? {
            type: 'model_failed',
            typedCode: 'process_interrupted',
            retrySafety: 'before_submission',
            providerState: 'not_submitted',
          }
        : {
            type: 'model_failed',
            typedCode: 'cancelled',
            retrySafety: 'never',
            providerState: attempt.state === 'submitted' ? 'submitted' : 'unknown',
          },
    ],
  });
}

export function settleRunControlActivationInTransaction(
  database: DatabaseSync,
  environment: StorageEnvironment,
  run: Run,
  action: 'pause' | 'cancel',
  occurredAt: string,
  context: CommandContext,
): Run {
  const activation = loadActiveRunActivation(database, run.id);
  if (activation === null) return run;
  const attempts = listModelAttemptRecords(database, run.id, activation.id);
  const unresolved = attempts.filter(
    ({ state }) => state === 'prepared' || state === 'running' || state === 'submitted',
  );
  if (unresolved.length === 0) return run;
  if (unresolved.length !== 1) {
    throw corrupt(`Run ${run.id} has multiple active Model Attempts during ${action}`);
  }
  const before = unresolved[0]!;
  const journal = loadRunEvents(database, run.id);
  const step = attemptModelStep(
    journal,
    activation.activation.activationNumber,
    before.attemptNumber,
  );
  assertTailOpenStep(
    journal,
    activation.activation.activationNumber,
    step.turnNumber,
    step.stepNumber,
    'model',
  );
  const attempt = settleModelAttemptRecord(
    database,
    before.id,
    before.requestHash,
    syntheticRunControlInterruptedResponse(database, before),
    occurredAt,
  );
  if (attempt.usage === null) {
    throw corrupt(`Run control Model Attempt ${attempt.id} has no usage`);
  }
  closeModelResources(database, environment, attempt, attempt.usage, occurredAt);
  const events = appendRunEventBatch(database, {
    runId: run.id,
    commandId: `run-control.${hashCanonical({ action, attemptId: attempt.id, phase: 'interrupted' })}`,
    events: [
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: { type: 'usage', ...attempt.usage },
      },
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'step_ended',
          activationNumber: activation.activation.activationNumber,
          turnNumber: step.turnNumber,
          stepNumber: step.stepNumber,
          outcome: 'interrupted',
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
          type: 'turn_ended',
          activationNumber: activation.activation.activationNumber,
          turnNumber: step.turnNumber,
          outcome: 'interrupted',
        },
      },
    ],
  });
  const head = events.at(-1);
  if (head === undefined)
    throw corrupt(`Run control Model Attempt ${attempt.id} emitted no events`);
  return advanceRunJournalHead(database, run, {
    eventId: head.eventId,
    sequence: head.sequence,
    eventHash: head.eventHash,
  });
}

function recoveryFrontierFromReplay(
  database: DatabaseSync,
  runId: string,
  activationId: string,
  activationNumber: number,
  events: readonly RunEvent[],
): RecoveryFrontier {
  const toolResult = events.find((event) => {
    if (event.visibility !== 'model_surface') return false;
    return availablePayload(event).type === 'tool_result_ref';
  });
  if (toolResult !== undefined && toolResult.visibility === 'model_surface') {
    const payload = availablePayload(toolResult);
    if (payload.type !== 'tool_result_ref') throw corrupt('Recovery dispatch replay is invalid');
    const dispatch = loadOperationDispatch(database, payload.callId);
    return parseCanonical(RecoveryFrontierSchema, {
      kind: 'dispatch',
      dispatchOperationId: dispatch.id,
      toolId: dispatch.key.toolId,
    });
  }
  const attempts = listModelAttemptRecords(database, runId, activationId);
  const stepEnded = events.find((event) => {
    if (event.visibility !== 'public') return false;
    return availablePayload(event).type === 'step_ended';
  });
  if (stepEnded !== undefined && stepEnded.visibility === 'public') {
    const payload = availablePayload(stepEnded);
    if (payload.type !== 'step_ended') throw corrupt('Recovery model replay is invalid');
    const attempt = attempts.find((candidate) => {
      const step = attemptModelStep(
        loadRunEvents(database, runId),
        activationNumber,
        candidate.attemptNumber,
      );
      return step.turnNumber === payload.turnNumber && step.stepNumber === payload.stepNumber;
    });
    const terminal = attempt?.response?.events.at(-1);
    if (attempt === undefined || terminal?.type !== 'model_failed') {
      throw corrupt('Recovery model replay cannot identify its frontier');
    }
    const state =
      terminal.typedCode === 'process_interrupted'
        ? 'prepared'
        : terminal.providerState === 'submitted'
          ? 'submitted'
          : 'running';
    return parseCanonical(RecoveryFrontierSchema, {
      kind: 'model_attempt',
      attemptId: attempt.id,
      state,
    });
  }
  const unknown = attempts.filter(({ state }) => state === 'unknown');
  if (unknown.length !== 1) throw corrupt('Recovery replay has no unique unknown frontier');
  return parseCanonical(RecoveryFrontierSchema, {
    kind: 'model_attempt',
    attemptId: unknown[0]!.id,
    state: 'unknown',
  });
}

function replayInterruptedActivation(
  database: DatabaseSync,
  input: CloseInterruptedActivationInput,
  context: CommandContext,
): CloseInterruptedActivationResult | null {
  const events = commandEvents(database, input.runId, input.commandId);
  if (events.length === 0) return null;
  if (
    events.some(
      (event) =>
        event.actor !== context.actor ||
        canonicalJson(event.causation) !== canonicalJson(context.causation) ||
        event.correlationId !== context.correlationId,
    )
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `Recovery command ${input.commandId} was already used with a different context`,
    );
  }
  const run = loadRun(database, input.runId);
  const first = events[0]!;
  const terminal = events.at(-1)!;
  const stateEvent = events.find((event) => {
    if (event.visibility !== 'public') return false;
    return availablePayload(event).type === 'run_state_changed';
  });
  const activationEvent = events.find((event) => {
    if (event.visibility !== 'public') return false;
    return availablePayload(event).type === 'activation_changed';
  });
  if (
    run.status !== 'blocked' ||
    run.terminalOutcome?.summary !== PROCESS_INTERRUPTION_SUMMARY ||
    run.publicEventHead?.sequence !== terminal.sequence ||
    run.publicEventHead.hash !== terminal.eventHash ||
    first.sequence !== input.expectedPublicEventHead.sequence + 1 ||
    first.previousEventHash !== input.expectedPublicEventHead.hash ||
    stateEvent === undefined ||
    activationEvent === undefined ||
    stateEvent.visibility !== 'public' ||
    activationEvent.visibility !== 'public'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `Recovery command ${input.commandId} has different semantics`,
    );
  }
  const statePayload = availablePayload(stateEvent);
  const activationPayload = availablePayload(activationEvent);
  if (
    statePayload.type !== 'run_state_changed' ||
    statePayload.runRevision !== input.expectedRunRevision + 1 ||
    statePayload.state !== 'blocked' ||
    (statePayload.previousState !== 'running' && statePayload.previousState !== 'recovering') ||
    activationPayload.type !== 'activation_changed' ||
    activationPayload.activationNumber !== input.activationNumber ||
    activationPayload.state !== 'ended' ||
    activationPayload.endReason !== 'process_exit'
  ) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `Recovery command ${input.commandId} changed its boundary`,
    );
  }
  const before = parseCanonical(RunSchema, {
    ...run,
    revision: input.expectedRunRevision,
    contentHash: input.expectedRunContentHash,
    status: statePayload.previousState,
    publicEventHead: input.expectedPublicEventHead,
    terminalOutcome: null,
  });
  if (hashContentObject(before) !== input.expectedRunContentHash) {
    throw new StorageError(
      'IDEMPOTENCY_CONFLICT',
      `Recovery command ${input.commandId} changed its source Run`,
    );
  }
  const storedActivation = loadRunActivation(database, run.id, input.activationNumber);
  if (
    storedActivation === null ||
    storedActivation.activation.state !== 'ended' ||
    storedActivation.activation.endReason !== 'process_exit' ||
    storedActivation.activation.eventEndSequence !== activationEvent.sequence
  ) {
    throw corrupt(`Recovery command ${input.commandId} Activation is invalid`);
  }
  return {
    run,
    activation: storedActivation.activation,
    frontier: recoveryFrontierFromReplay(
      database,
      run.id,
      storedActivation.id,
      input.activationNumber,
      events,
    ),
    events,
  };
}

function closeInterruptedActivation(
  database: DatabaseSync,
  environment: StorageEnvironment,
  inputValue: CloseInterruptedActivationInput,
  contextValue: CommandContext,
): CloseInterruptedActivationResult {
  const input = parseCanonical(CloseInterruptedActivationInputSchema, inputValue);
  const context = parseCanonical(CommandContextSchema, contextValue);
  const replay = replayInterruptedActivation(database, input, context);
  if (replay !== null) return replay;
  return withImmediateTransaction(database, () => {
    const before = loadRun(database, input.runId);
    const pendingActivation = loadRunActivation(database, before.id, input.activationNumber);
    if (pendingActivation !== null) {
      const pendingAttempts = listModelAttemptRecords(database, before.id, pendingActivation.id);
      const pendingDispatches = listRuntimeDispatches(database, before.id, pendingActivation.id);
      if (
        pendingProtectedMutationSuspension(
          database,
          environment,
          before,
          pendingActivation.id,
          pendingActivation.activation,
          pendingAttempts,
          pendingDispatches,
        )
      ) {
        throw invalid(
          `Run ${before.id} is waiting for an exact protected mutation confirmation, not a recovery frontier`,
        );
      }
    }
    assertRecoveryRunIdentity(before, input);
    const storedActivation = activeActivation(database, before.id, input.activationNumber);
    const attempts = listModelAttemptRecords(database, before.id, storedActivation.id);
    const dispatches = listRuntimeDispatches(database, before.id, storedActivation.id);
    const unresolvedAttempts = attempts.filter(
      ({ state }) =>
        state === 'prepared' || state === 'running' || state === 'submitted' || state === 'unknown',
    );
    const openDispatches = dispatches.filter(({ outcome }) => outcome === null);
    const undispatchedCalls = undispatchedModelCalls(attempts, dispatches);
    if (unresolvedAttempts.length + openDispatches.length + undispatchedCalls.length !== 1) {
      throw invalid(
        'Recovery requires exactly one unresolved Model Attempt, dispatch, or committed tool call',
      );
    }
    const occurredAt = parseCanonical(IsoTimestampSchema, environment.now());
    const journal = loadRunEvents(database, before.id);
    const drafts: AppendRunEventBatchInput['events'] = [];
    let frontier: RecoveryFrontier;
    let turnNumber: number;

    const attemptBefore = unresolvedAttempts[0];
    if (attemptBefore !== undefined) {
      frontier = parseCanonical(RecoveryFrontierSchema, {
        kind: 'model_attempt',
        attemptId: attemptBefore.id,
        state: attemptBefore.state,
      });
      const step =
        attemptBefore.state === 'unknown'
          ? assertClosedUnknownTail(
              journal,
              storedActivation.activation.activationNumber,
              attemptBefore,
            )
          : attemptModelStep(
              journal,
              storedActivation.activation.activationNumber,
              attemptBefore.attemptNumber,
            );
      turnNumber = step.turnNumber;
      if (attemptBefore.state !== 'unknown') {
        assertTailOpenStep(
          journal,
          storedActivation.activation.activationNumber,
          step.turnNumber,
          step.stepNumber,
          'model',
        );
        const response = syntheticInterruptedResponse(database, attemptBefore);
        const attempt = settleModelAttemptRecord(
          database,
          attemptBefore.id,
          attemptBefore.requestHash,
          response,
          occurredAt,
        );
        if (attempt.usage === null)
          throw corrupt(`Recovered Model Attempt ${attempt.id} has no usage`);
        closeModelResources(database, environment, attempt, attempt.usage, occurredAt);
        drafts.push(
          {
            eventId: environment.createId('run_event'),
            visibility: 'public',
            occurredAt,
            actor: context.actor,
            causation: context.causation,
            correlationId: context.correlationId,
            payload: { type: 'usage', ...attempt.usage },
          },
          {
            eventId: environment.createId('run_event'),
            visibility: 'public',
            occurredAt,
            actor: context.actor,
            causation: context.causation,
            correlationId: context.correlationId,
            payload: {
              type: 'step_ended',
              activationNumber: storedActivation.activation.activationNumber,
              turnNumber: step.turnNumber,
              stepNumber: step.stepNumber,
              outcome: 'interrupted',
            },
          },
        );
      }
    } else {
      const { catalog } = loadRunSnapshots(database, before);
      let dispatchBefore = openDispatches[0];
      let synthesized = false;
      let step: { turnNumber: number; stepNumber: number };
      if (dispatchBefore === undefined) {
        const candidate = undispatchedCalls[0]!;
        const recovery = undispatchedRecoveryCall(
          candidate,
          attempts,
          dispatches,
          catalog,
          journal,
          storedActivation.activation.activationNumber,
        );
        step = recovery.step;
        dispatchBefore = prepareRuntimeDispatch(database, environment, {
          modelAttemptId: candidate.attempt.id,
          providerCallId: candidate.call.providerCallId,
          authorityWatermarkHash: null,
          occurredAt,
        });
        synthesized = true;
      } else {
        step = openDispatchStep(
          journal,
          storedActivation.activation.activationNumber,
          dispatchBefore.id,
        );
      }
      const tool = recoverySafeDispatchTool(catalog, dispatchBefore);
      if (synthesized) {
        drafts.push(
          ...dispatchStartDrafts(
            environment,
            context,
            before,
            dispatchBefore,
            tool,
            storedActivation.activation.activationNumber,
            step.turnNumber,
            step.stepNumber,
            occurredAt,
          ),
        );
      }
      frontier = parseCanonical(RecoveryFrontierSchema, {
        kind: 'dispatch',
        dispatchOperationId: dispatchBefore.id,
        toolId: dispatchBefore.key.toolId,
      });
      turnNumber = step.turnNumber;
      const dispatch = settleRuntimeDispatch(database, {
        dispatchOperationId: dispatchBefore.id,
        outcome: {
          status: 'recovery_required',
          operation: null,
          message: PROCESS_INTERRUPTION_SUMMARY,
        },
        occurredAt,
      });
      if (dispatch.outcomeHash === null)
        throw corrupt(`Dispatch ${dispatch.id} outcome disappeared`);
      drafts.push(
        {
          eventId: environment.createId('run_event'),
          visibility: 'model_surface',
          occurredAt,
          actor: context.actor,
          causation: context.causation,
          correlationId: context.correlationId,
          payload: {
            type: 'tool_result_ref',
            callId: dispatch.id,
            toolName: dispatch.key.toolId,
            outputPayloadId: dispatch.id,
            outputSchemaHash: tool.outcomeSchema.sha256,
            outputHash: dispatch.outcomeHash,
            success: false,
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
            type: 'tool_summary',
            toolName: dispatch.key.toolId,
            status: 'blocked',
            summary: PROCESS_INTERRUPTION_SUMMARY,
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
            type: 'step_ended',
            activationNumber: storedActivation.activation.activationNumber,
            turnNumber: step.turnNumber,
            stepNumber: step.stepNumber,
            outcome: 'interrupted',
          },
        },
      );
    }

    drafts.push(
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'blocker',
          code: 'recovery_required',
          message: PROCESS_INTERRUPTION_SUMMARY,
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
          type: 'turn_ended',
          activationNumber: storedActivation.activation.activationNumber,
          turnNumber,
          outcome: 'interrupted',
        },
      },
    );
    const taskBefore = loadTaskList(database, before.id);
    if (taskBefore?.state === 'active') {
      const taskAfter = finalizeTaskList({
        ...taskBefore,
        state: 'cancelled',
        revision: taskBefore.revision + 1,
        updatedAt: occurredAt,
        terminalizedAt: occurredAt,
      });
      replaceTaskList(database, taskBefore, taskAfter);
      drafts.push({
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'task_list_changed',
          taskListId: taskAfter.id,
          revision: taskAfter.revision,
          publicSummary: PROCESS_INTERRUPTION_SUMMARY,
        },
      });
    }
    const activationOrdinal = drafts.length;
    drafts.push(
      {
        eventId: environment.createId('run_event'),
        visibility: 'public',
        occurredAt,
        actor: context.actor,
        causation: context.causation,
        correlationId: context.correlationId,
        payload: {
          type: 'activation_changed',
          activationNumber: storedActivation.activation.activationNumber,
          state: 'ended',
          endReason: 'process_exit',
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
          previousState: before.status,
          state: 'blocked',
          runRevision: before.revision + 1,
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
          type: 'terminal_summary',
          status: 'blocked',
          summary: PROCESS_INTERRUPTION_SUMMARY,
          resultIds: [],
        },
      },
    );
    try {
      assertRunStateTransition(before.status, 'blocked');
    } catch (cause) {
      throw invalid(`Run ${before.id} cannot be blocked for recovery`, cause);
    }
    const events = appendRunEventBatch(database, {
      runId: before.id,
      commandId: input.commandId,
      events: drafts,
    });
    const activationEvent = events[activationOrdinal]!;
    const terminalEvent = events.at(-1)!;
    closeRunActivation(
      database,
      storedActivation,
      activationEvent.sequence,
      occurredAt,
      'process_exit',
    );
    const run = advanceRunJournalHead(
      database,
      before,
      {
        eventId: terminalEvent.eventId,
        sequence: terminalEvent.sequence,
        eventHash: terminalEvent.eventHash,
      },
      {
        status: 'blocked',
        terminalOutcome: {
          status: 'blocked',
          summary: PROCESS_INTERRUPTION_SUMMARY,
          terminalEventId: terminalEvent.eventId,
          finishedAt: occurredAt,
        },
      },
    );
    const activation = loadRunActivation(
      database,
      before.id,
      storedActivation.activation.activationNumber,
    )?.activation;
    if (activation === undefined) throw corrupt(`Run ${before.id} Activation closure disappeared`);
    return { run, activation, frontier, events };
  });
}

export interface HarnessPersistenceAuthority {
  readonly loadActivation: (runId: string, activationNumber: number) => HarnessActivationSnapshot;
  readonly materializePrivateRunContext: (runId: string) => PrivateRunContext;
  readonly materializePrivateModelContext: (runId: string) => PrivateModelContext;
  readonly consumeInbox: (
    input: InboxConsumeInput,
    context: CommandContext,
  ) => HarnessCommit<RunInboxMessage>;
  readonly prepareModelBoundary: (
    input: PrepareModelAttemptInput,
    context: CommandContext,
  ) => PrepareModelBoundaryResult;
  readonly markModelAttemptRunning: (
    input: MarkModelAttemptRunningInput,
    context: CommandContext,
  ) => HarnessCommit<ModelAttemptRecordV1>;
  readonly settleModelAttempt: (
    input: SettleModelAttemptInput,
    context: CommandContext,
  ) => HarnessCommit<ModelAttemptRecordV1>;
  readonly settleAgentSpawnBoundary: (
    input: SettleAgentSpawnBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<AgentSpawnBoundaryRecord>;
  readonly settleAgentSendBoundary: (
    input: SettleAgentSendBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<AgentSendBoundaryRecord>;
  readonly settleAgentWaitStartBoundary: (
    input: SettleAgentWaitStartBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<AgentWaitBoundaryRecord>;
  readonly loadAgentWaitBoundary: (dispatchOperationId: string) => AgentWaitBoundaryRecord;
  readonly settleAgentWaitBoundary: (
    input: SettleAgentWaitBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<AgentWaitBoundaryRecord>;
  readonly settleAgentResultBoundary: (
    input: SettleAgentResultBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<AgentResultBoundaryRecord>;
  readonly settleAgentCancelBoundary: (
    input: SettleAgentCancelBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<AgentCancelBoundaryRecord>;
  readonly settleInteractionAskBoundary: (
    input: SettleInteractionAskBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<InteractionAskBoundaryRecord>;
  readonly settleDeliveryFreezeBoundary: (
    input: SettleDeliveryFreezeBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<DeliveryFreezeBoundaryRecord>;
  readonly settleDeliveryExportStartBoundary: (
    input: SettleDeliveryExportStartBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<DeliveryExportBoundaryRecord>;
  readonly loadDeliveryExportBoundary: (
    dispatchOperationId: string,
  ) => DeliveryExportBoundaryRecord;
  readonly settleDeliveryExportBoundary: (
    input: SettleDeliveryExportBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<DeliveryExportBoundaryRecord>;
  readonly settleDeliveryPreviewStartBoundary: (
    input: SettleDeliveryPreviewStartBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<DeliveryPreviewBoundaryRecord>;
  readonly loadDeliveryPreviewBoundary: (
    dispatchOperationId: string,
  ) => DeliveryPreviewBoundaryRecord;
  readonly settleDeliveryPreviewBoundary: (
    input: SettleDeliveryPreviewBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<DeliveryPreviewBoundaryRecord>;
  readonly settleEvaluationRunStartBoundary: (
    input: SettleEvaluationRunStartBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<EvaluationRunBoundaryRecord>;
  readonly loadEvaluationRunBoundary: (dispatchOperationId: string) => EvaluationRunBoundaryRecord;
  readonly settleEvaluationRunBoundary: (
    input: SettleEvaluationRunBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<EvaluationRunBoundaryRecord>;
  readonly settleGenerationSubmitStartBoundary: (
    input: SettleGenerationSubmitStartBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<GenerationSubmitBoundaryRecord>;
  readonly loadGenerationSubmitBoundary: (
    dispatchOperationId: string,
  ) => GenerationSubmitBoundaryRecord;
  readonly settleGenerationSubmitBoundary: (
    input: SettleGenerationSubmitBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<GenerationSubmitBoundaryRecord>;
  readonly settleMediaDeriveStartBoundary: (
    input: SettleMediaDeriveStartBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<MediaDeriveBoundaryRecord>;
  readonly loadMediaDeriveBoundary: (dispatchOperationId: string) => MediaDeriveBoundaryRecord;
  readonly settleMediaDeriveBoundary: (
    input: SettleMediaDeriveBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<MediaDeriveBoundaryRecord>;
  readonly settleMediaAttachBoundary: (
    input: SettleMediaAttachBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<MediaAttachBoundaryRecord>;
  readonly settleMediaLinkBoundary: (
    input: SettleMediaLinkBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<MediaLinkBoundaryRecord>;
  readonly settleCanvasMutateBoundary: (
    input: SettleCanvasMutateBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<CanvasMutateBoundaryRecord>;
  readonly settleOperationCancelBoundary: (
    input: SettleOperationCancelBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<OperationCancelBoundaryRecord>;
  readonly settleTaskManageBoundary: (
    input: SettleTaskManageBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<TaskManageBoundaryRecord>;
  readonly settleToolProgramBoundary: (
    input: SettleToolProgramBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<ToolProgramBoundaryRecord>;
  readonly loadToolProgramBoundary: (
    parentDispatchOperationId: string,
  ) => ToolProgramBoundaryRecord;
  readonly isRunActivationActive: (runId: string, activationNumber: number) => boolean;
  readonly advanceToolProgramChild: (
    input: AdvanceToolProgramChildInput,
    context: CommandContext,
  ) => HarnessCommit<ToolProgramChildAdvance>;
  readonly startToolProgramChildActivation: (
    parentDispatchOperationId: string,
    context: CommandContext,
  ) => ToolProgramChildActivationRecord;
  readonly settleToolProgramChildCall: (
    input: SettleToolProgramChildCallInput,
    context: CommandContext,
  ) => HarnessCommit<OperationDispatchRecord>;
  readonly settleToolProgramParent: (
    input: SettleToolProgramParentInput,
    context: CommandContext,
  ) => HarnessCommit<OperationDispatchRecord>;
  readonly prepareDispatch: (
    input: PrepareDispatchInput,
    context: CommandContext,
  ) => HarnessCommit<OperationDispatchRecord>;
  readonly prepareSkillProposal: (
    input: PrepareSkillProposalInput,
    context: CommandContext,
  ) => HarnessCommit<SkillProposalRecord>;
  readonly prepareProtectedMutationBoundary: (
    input: PrepareProtectedMutationBoundaryInput,
    context: CommandContext,
  ) => HarnessCommit<ProtectedMutationBoundaryRecord>;
  readonly settleDispatch: (
    input: SettleDispatchInput,
    context: CommandContext,
  ) => HarnessCommit<OperationDispatchRecord>;
  readonly closeInterruptedActivation: (
    input: CloseInterruptedActivationInput,
    context: CommandContext,
  ) => CloseInterruptedActivationResult;
  readonly acceptCrashRetryRun: (
    input: AcceptCrashRetryRunInput,
    context: CommandContext,
  ) => AcceptCrashRetryRunResult;
}

export function createHarnessPersistenceAuthority(
  store: Store,
  environment: StorageEnvironment,
  runs: RunsAuthority,
  privateRecoveryCodec: PrivateRecoveryCodec | undefined,
): HarnessPersistenceAuthority {
  const authority: HarnessPersistenceAuthority = {
    loadActivation(runId, activationNumber) {
      return loadActivationSnapshot(getStoreDatabase(store), environment, runId, activationNumber);
    },
    materializePrivateRunContext(runId) {
      const database = getStoreDatabase(store);
      return materializePrivateRunContextForRun(
        database,
        privateRecoveryCodec,
        loadRun(database, runId),
      );
    },
    materializePrivateModelContext(runId) {
      const database = getStoreDatabase(store);
      return materializePrivateModelContextForRun(
        database,
        privateRecoveryCodec,
        loadRun(database, runId),
      );
    },
    consumeInbox(input, context) {
      const database = getStoreDatabase(store);
      const before = loadRun(database, input.runId);
      const existing = runs
        .listInbox(input.runId)
        .find(({ id, sequence }) => id === input.inboxMessageId && sequence === input.sequence);
      if (existing?.state === 'consumed') {
        return { value: existing, run: before, events: [] };
      }
      const value = runs.transitionInbox({ ...input, action: 'consume' }, context);
      const run = loadRun(database, input.runId);
      const previousSequence = before.publicEventHead?.sequence ?? 0;
      return {
        value,
        run,
        events: loadRunEvents(database, run.id).filter(
          ({ sequence }) => sequence > previousSequence,
        ),
      };
    },
    prepareModelBoundary(input, context) {
      return prepareModelBoundary(getStoreDatabase(store), environment, input, context);
    },
    markModelAttemptRunning(input, _context) {
      return markModelAttemptRunning(getStoreDatabase(store), input);
    },
    settleModelAttempt(input, context) {
      return settleModelAttempt(getStoreDatabase(store), environment, input, context);
    },
    settleAgentSpawnBoundary(input, context) {
      return settleAgentSpawnBoundary(
        getStoreDatabase(store),
        environment,
        privateRecoveryCodec,
        input,
        context,
      );
    },
    settleAgentSendBoundary(input, context) {
      return settleAgentSendBoundary(
        getStoreDatabase(store),
        environment,
        privateRecoveryCodec,
        input,
        context,
      );
    },
    settleAgentWaitStartBoundary(input, context) {
      return settleAgentWaitStartBoundary(getStoreDatabase(store), environment, input, context);
    },
    loadAgentWaitBoundary(dispatchOperationId) {
      return loadAgentWaitBoundary(getStoreDatabase(store), environment, dispatchOperationId);
    },
    settleAgentWaitBoundary(input, context) {
      return settleAgentWaitBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleAgentResultBoundary(input, context) {
      return settleAgentResultBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleAgentCancelBoundary(input, context) {
      return settleAgentCancelBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleInteractionAskBoundary(input, context) {
      return settleInteractionAskBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleDeliveryFreezeBoundary(input, context) {
      return settleDeliveryFreezeBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleDeliveryExportStartBoundary(input, context) {
      return settleDeliveryExportStartBoundary(
        getStoreDatabase(store),
        environment,
        input,
        context,
      );
    },
    loadDeliveryExportBoundary(dispatchOperationId) {
      return loadDeliveryExportBoundary(getStoreDatabase(store), dispatchOperationId);
    },
    settleDeliveryExportBoundary(input, context) {
      return settleDeliveryExportBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleDeliveryPreviewStartBoundary(input, context) {
      return settleDeliveryPreviewStartBoundary(
        getStoreDatabase(store),
        environment,
        input,
        context,
      );
    },
    loadDeliveryPreviewBoundary(dispatchOperationId) {
      return loadDeliveryPreviewBoundary(getStoreDatabase(store), dispatchOperationId);
    },
    settleDeliveryPreviewBoundary(input, context) {
      return settleDeliveryPreviewBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleEvaluationRunStartBoundary(input, context) {
      return settleEvaluationRunStartBoundary(getStoreDatabase(store), environment, input, context);
    },
    loadEvaluationRunBoundary(dispatchOperationId) {
      return loadEvaluationRunBoundary(getStoreDatabase(store), dispatchOperationId);
    },
    settleEvaluationRunBoundary(input, context) {
      return settleEvaluationRunBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleGenerationSubmitStartBoundary(input, context) {
      return settleGenerationSubmitStartBoundary(
        getStoreDatabase(store),
        environment,
        input,
        context,
      );
    },
    loadGenerationSubmitBoundary(dispatchOperationId) {
      return loadGenerationSubmitBoundary(getStoreDatabase(store), dispatchOperationId);
    },
    settleGenerationSubmitBoundary(input, context) {
      return settleGenerationSubmitBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleMediaDeriveStartBoundary(input, context) {
      return settleMediaDeriveStartBoundary(getStoreDatabase(store), environment, input, context);
    },
    loadMediaDeriveBoundary(dispatchOperationId) {
      return loadMediaDeriveBoundary(getStoreDatabase(store), dispatchOperationId);
    },
    settleMediaDeriveBoundary(input, context) {
      return settleMediaDeriveBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleMediaAttachBoundary(input, context) {
      return settleMediaAttachBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleMediaLinkBoundary(input, context) {
      return settleMediaLinkBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleCanvasMutateBoundary(input, context) {
      return settleCanvasMutateBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleOperationCancelBoundary(input, context) {
      return settleOperationCancelBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleTaskManageBoundary(input, context) {
      return settleTaskManageBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleToolProgramBoundary(input, context) {
      return settleToolProgramBoundary(
        getStoreDatabase(store),
        environment,
        privateRecoveryCodec,
        input,
        context,
      );
    },
    loadToolProgramBoundary(parentDispatchOperationId) {
      return loadToolProgramBoundary(
        getStoreDatabase(store),
        privateRecoveryCodec,
        parentDispatchOperationId,
      );
    },
    isRunActivationActive(runId, activationNumber) {
      return isRunActivationActive(getStoreDatabase(store), runId, activationNumber);
    },
    advanceToolProgramChild(input, context) {
      return advanceToolProgramChild(
        getStoreDatabase(store),
        environment,
        privateRecoveryCodec,
        input,
        context,
      );
    },
    startToolProgramChildActivation(parentDispatchOperationId, context) {
      return startToolProgramChildActivation(
        getStoreDatabase(store),
        privateRecoveryCodec,
        runs,
        parentDispatchOperationId,
        context,
      );
    },
    settleToolProgramChildCall(input, context) {
      return settleToolProgramChildCall(
        getStoreDatabase(store),
        environment,
        privateRecoveryCodec,
        input,
        context,
      );
    },
    settleToolProgramParent(input, context) {
      return settleToolProgramParent(
        getStoreDatabase(store),
        environment,
        privateRecoveryCodec,
        input,
        context,
      );
    },
    prepareDispatch(input, context) {
      return prepareDispatch(getStoreDatabase(store), environment, input, context);
    },
    prepareSkillProposal(input, context) {
      return prepareSkillProposal(getStoreDatabase(store), environment, input, context);
    },
    prepareProtectedMutationBoundary(input, context) {
      return prepareProtectedMutationBoundary(getStoreDatabase(store), environment, input, context);
    },
    settleDispatch(input, context) {
      return settleDispatch(getStoreDatabase(store), input, context, environment);
    },
    closeInterruptedActivation(input, context) {
      return closeInterruptedActivation(getStoreDatabase(store), environment, input, context);
    },
    acceptCrashRetryRun(inputValue, contextValue) {
      const input = parseCanonical(AcceptCrashRetryRunInputSchema, inputValue);
      parseCanonical(CommandContextSchema, contextValue);
      return acceptCrashRetryRootRun(getStoreDatabase(store), environment, input);
    },
  };
  return Object.freeze(authority);
}
