import type { GenerationRequest } from './generation.js';
import type { PromptAssemblyPurpose, PromptAssemblyRecord } from './prompt-assembly.js';
import type { VisualStyleGrammar } from './visual-style.js';

export const TaskListStatus = {
  Pending: 'pending',
  AwaitingApproval: 'awaiting_approval',
  Blocked: 'blocked',
  Ready: 'ready',
  Queued: 'queued',
  Preparing: 'preparing',
  Running: 'running',
  Paused: 'paused',
  Completed: 'completed',
  CompletedWithErrors: 'completed_with_errors',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Dead: 'dead',
} as const;

export type TaskListStatus = (typeof TaskListStatus)[keyof typeof TaskListStatus];

/** Task Lists in these states no longer own an active Commander session. */
export const TASK_LIST_TERMINAL_STATUSES = [
  TaskListStatus.Completed,
  TaskListStatus.CompletedWithErrors,
  TaskListStatus.Failed,
  TaskListStatus.Cancelled,
  TaskListStatus.Dead,
] as const satisfies readonly TaskListStatus[];

export function isTaskListTerminalStatus(status: TaskListStatus): boolean {
  return (TASK_LIST_TERMINAL_STATUSES as readonly TaskListStatus[]).includes(status);
}

/** The only approval gates supported by the persistent video task list. */
export const PlanApprovalGateKey = {
  ProductionPlan: 'production_plan',
  VisualConstitution: 'visual_constitution',
  Delivery: 'delivery',
} as const;

export type PlanApprovalGateKey = (typeof PlanApprovalGateKey)[keyof typeof PlanApprovalGateKey];

export const PlanDocumentStatus = {
  Draft: 'draft',
  Active: 'active',
  Superseded: 'superseded',
  Invalidated: 'invalidated',
} as const;

export type PlanDocumentStatus = (typeof PlanDocumentStatus)[keyof typeof PlanDocumentStatus];

export const PlanApprovalStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Invalidated: 'invalidated',
} as const;

export type PlanApprovalStatus = (typeof PlanApprovalStatus)[keyof typeof PlanApprovalStatus];

export const TaskStatus = {
  Pending: 'pending',
  Blocked: 'blocked',
  Ready: 'ready',
  Running: 'running',
  AwaitingProvider: 'awaiting_provider',
  RetryableFailed: 'retryable_failed',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Skipped: 'skipped',
} as const;

export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const TaskKind = {
  AdapterGeneration: 'adapter_generation',
  ProviderPoll: 'provider_poll',
  Transform: 'transform',
  Validation: 'validation',
  AssetResolve: 'asset_resolve',
  MetadataExtract: 'metadata_extract',
  Export: 'export',
  Cleanup: 'cleanup',
} as const;

export type TaskKind = (typeof TaskKind)[keyof typeof TaskKind];

export interface TaskBlueprint {
  id: string;
  name: string;
  phaseKey: string;
  phaseName: string;
  phaseOrder: number;
  kind: TaskKind;
  providerHint?: string;
  dependsOnTaskIds?: string[];
  maxRetries: number;
  timeoutMs?: number;
  inputBinding?: Record<string, unknown>;
  outputBinding?: Record<string, unknown>;
  allowPartialSuccess?: boolean;
  requiredForCompletion?: boolean;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMs?: number;
  retryableStatuses?: string[];
}

export interface CancellationPolicy {
  allowCancellation: boolean;
  gracePeriodMs?: number;
}

export interface ResumePolicy {
  allowResume: boolean;
  maxResumeAttempts?: number;
}

export interface TaskListBlueprint {
  id: string;
  name: string;
  version: number;
  kind: string;
  description: string;
  tasks: TaskBlueprint[];
  retryPolicy?: RetryPolicy;
  cancellationPolicy?: CancellationPolicy;
  resumePolicy?: ResumePolicy;
}

export interface TaskList {
  id: string;
  taskListType: string;
  entityType: string;
  entityId?: string;
  triggerSource: string;
  status: TaskListStatus;
  summary: string;
  progress: number;
  completedPhases: number;
  totalPhases: number;
  completedTasks: number;
  totalTasks: number;
  /** Stable phase key projected from the active Task; phases are not persisted entities. */
  currentPhaseKey?: string;
  currentTaskId?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  /** Optimistic-concurrency version for durable task-list transitions. */
  rowVersion?: number;
  /** Present only while the Task List is blocked at one of the three approval gates. */
  currentGate?: PlanApprovalGateKey;
  /** Runtime engine version that owns this aggregate. Defaults to `legacy`. */
  engineVersion?: string;
  /** Persisted task-list blueprint version. Defaults to `1`. */
  definitionVersion?: number;
  /** Current execution-engine lease. The monotonically increasing token fences stale owners. */
  leaseOwner?: string;
  leaseToken?: number;
  leaseExpiresAt?: number;
  heartbeatAt?: number;
}

/**
 * Commander ownership is durable Task List metadata, not a Canvas-level
 * association. Only a non-empty direct value establishes ownership.
 */
export function getCommanderSessionId(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  const value = metadata?.commanderSessionId;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

/** Host-owned report used to persist Commander context recovery health. */
export interface ContextRecoveryReport {
  taskListId: string;
  outcome: 'failed' | 'recovered';
  reason: 'compaction_failed' | 'persistent_context_reloaded' | 'hard_stop';
  /** The verified 92% ceiling pauses immediately instead of waiting for three failures. */
  forcePause?: boolean;
}

export interface ContextRecoveryReportResult {
  state: 'active' | 'recovering' | 'recovery_required';
  consecutiveFailures: number;
  changed: boolean;
}

/** Immutable, revisioned task-list artifact used as an approval subject. */
export interface PlanDocument {
  id: string;
  taskListId: string;
  logicalKey: string;
  documentType: string;
  revision: number;
  schemaVersion: number;
  content: Record<string, unknown>;
  /** Caller-computed SHA-256. Persistence stores and compares it verbatim. */
  contentHash: string;
  status: PlanDocumentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface PlanApproval {
  id: string;
  taskListId: string;
  gateKey: PlanApprovalGateKey;
  subjectLogicalKey: string;
  subjectRevision: number;
  /** Caller-computed SHA-256 of the exact subject revision. */
  subjectHash: string;
  /** Caller-computed SHA-256 of the approved generation/export manifest. */
  manifestHash: string;
  /** Caller-computed SHA-256 of the one-time resume token. */
  resumeTokenHash: string;
  status: PlanApprovalStatus;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
}

export type PlanGateRevisionAction = 'request_changes' | 'reject';

/** Immutable user-authored instruction attached to a same-gate document revision. */
export interface PlanGateRevisionRequest extends Record<string, unknown> {
  action: PlanGateRevisionAction;
  reason: string;
  previousRevision: number;
  requestedAt: number;
}

/** Approval metadata safe to expose outside the host process. */
export type PlanApprovalView = Omit<PlanApproval, 'resumeTokenHash'>;

export interface TaskEvent {
  taskListId: string;
  seq: number;
  eventId: string;
  actor: string;
  correlationId?: string;
  causationId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/** Durable state of one task-list-bound Commander question. */
export type TaskDecisionStatus = 'pending' | 'answered' | 'recovery_required';

export interface TaskDecisionOption {
  id: string;
  label: string;
  description?: string;
  /** Optional CAS image shown beside this choice in the host question UI. */
  previewAssetHash?: string;
}

/**
 * A persisted AskUser decision. `(taskListId, decisionKey, subjectRevision)`
 * is the stable idempotency identity; `questionId` is the canonical UI handle.
 */
export interface TaskDecision {
  id: string;
  taskListId: string;
  taskId: string;
  canvasId: string;
  questionId: string;
  decisionKey: string;
  subjectRevision: number;
  question: string;
  options: TaskDecisionOption[];
  allowFreeText: boolean;
  status: TaskDecisionStatus;
  answer?: string;
  selectedOptionId?: string;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
  answeredAt?: number;
}

export interface TaskDecisionFilter {
  taskListId?: string;
  canvasId?: string;
}

export interface ReserveTaskDecisionInput {
  decision: TaskDecision;
  expectedTaskListRowVersion: number;
  event: Omit<TaskEvent, 'seq'>;
}

export interface ReserveTaskDecisionResult {
  decision: TaskDecision;
  taskList: TaskList;
  task: Task;
  event?: TaskEvent;
  created: boolean;
}

export interface AnswerTaskDecisionInput {
  canvasId: string;
  questionId: string;
  answer: string;
  selectedOptionId?: string;
  status: Extract<TaskDecisionStatus, 'answered' | 'recovery_required'>;
  answeredAt: number;
  event: Omit<TaskEvent, 'seq'>;
}

export interface AnswerTaskDecisionResult {
  decision: TaskDecision;
  taskList: TaskList;
  task: Task;
  event?: TaskEvent;
  answered: boolean;
}

/** Host-facing view of the exact immutable revision awaiting human approval. */
export interface PlanApprovalContext {
  taskList: TaskList;
  approval: PlanApprovalView;
  document: PlanDocument;
}

/** Host-UI view of the latest durable visual audition and its CAS version. */
export interface VisualAuditionContext {
  taskList: TaskList;
  document: PlanDocument;
}

/** Creative grammar locked by the Visual Constitution approval. */
export type VisualConstitutionGrammar = VisualStyleGrammar;

/** Model-authored direction submitted to the bounded style-audition service. */
export interface VisualDirectionCandidateProposal {
  id: string;
  name: string;
  summary: string;
  prompt: string;
  negativePrompt?: string;
  seed: number;
  constitution: VisualConstitutionGrammar;
}

export interface VisualPreviewGrade {
  rubricVersion: string;
  promptAdherence: number;
  styleClarity: number;
  storyFit: number;
  lighting: number;
  composition: number;
  continuityPotential: number;
  total: number;
  verdict: 'pass' | 'repair' | 'human_review';
  strengths: string[];
  risks: string[];
  repairPrompt?: string;
  evidence: string;
  visionProviderId: string;
  visionModel?: string;
}

/** One immutable provider submission, including failures and ambiguous outcomes. */
export interface VisualPreviewAttempt {
  attempt: number;
  status: 'evaluation_pending' | 'completed' | 'failed' | 'ambiguous';
  /** Durable Commander-owned prompt assembly submitted to the image provider. */
  promptAssemblyId: string;
  prompt: string;
  promptHash: string;
  negativePrompt?: string;
  providerId: string;
  model?: string;
  requestedSeed: number;
  reportedSeed?: number;
  width: number;
  height: number;
  estimatedCostUsd: number;
  reportedActualCostUsd?: number;
  assetHash?: string;
  grade?: VisualPreviewGrade;
  error?: string;
  startedAt: number;
  completedAt: number;
}

export interface VisualAuditionCandidate extends VisualDirectionCandidateProposal {
  status:
    | 'pending'
    | 'awaiting_prompt_assembly'
    | 'evaluation_pending'
    | 'completed'
    | 'failed'
    | 'ambiguous';
  /** Prepared assembly for the next bounded attempt, before provider reservation. */
  pendingPromptAssemblyId?: string;
  attempts: VisualPreviewAttempt[];
  selectedAttempt?: number;
}

/** Content of the latest immutable `visual-auditions` plan document. */
export interface VisualAuditionDocumentContent extends Record<string, unknown> {
  status:
    | 'in_progress'
    | 'awaiting_prompt_assembly'
    | 'evaluation_pending'
    | 'complete'
    | 'failed'
    | 'ambiguous';
  requestHash: string;
  rubricVersion: string;
  productionPlan: { revision: number; contentHash: string };
  providerId: string;
  width: number;
  height: number;
  candidates: VisualAuditionCandidate[];
  recommendedCandidateId?: string;
  budget: {
    approvedStyleAuditionCostUsd: number;
    maxRegenerations: number;
    maxAttemptsPerCandidate: number;
    estimatedCommittedUsd: number;
    reportedActualUsd?: number;
    hasUnreportedActualCosts: boolean;
    unpricedOperations: string[];
  };
  failure?: { candidateId?: string; message: string; ambiguous: boolean };
}

/** Content of the immutable subject shown at the Visual Constitution gate. */
export interface VisualConstitutionDocumentContent extends Record<string, unknown> {
  productionPlan: { revision: number; contentHash: string };
  visualAuditions: { revision: number; contentHash: string };
  selectedCandidateId: string;
  selectedBy: 'user';
  selectedPreview: {
    assetHash: string;
    promptAssemblyId: string;
    providerId: string;
    model?: string;
    seed: number;
    prompt: string;
    promptHash: string;
    negativePrompt?: string;
  };
  locked: VisualConstitutionGrammar;
  candidates: VisualAuditionCandidate[];
  budget: VisualAuditionDocumentContent['budget'];
}

/** CAS-protected user choice sent only by the host approval UI. */
export interface SelectVisualConstitutionCandidateInput {
  taskListId: string;
  candidateId: string;
  expectedRowVersion: number;
  expectedAuditionRevision: number;
  expectedAuditionHash: string;
}

export interface VisualConstitutionSelectionResult {
  context: PlanApprovalContext;
  created: boolean;
}

/**
 * CAS-protected request to replace a complete visual audition before any
 * candidate is locked into the Visual Constitution.
 */
export interface RequestVisualAuditionChangesInput {
  taskListId: string;
  expectedRowVersion: number;
  expectedAuditionRevision: number;
  expectedAuditionHash: string;
  reason: string;
}

export interface RequestVisualAuditionChangesResult {
  taskList: TaskList;
}

/** Deterministic package naming chosen before Delivery approval. */
export interface DeliveryNamingPolicy {
  packageBaseName: string;
  orderPrefixWidth: number;
  separator: '_';
  overwritePolicy: 'fail';
}

/** Durable origin facts for one selected source video. */
export interface DeliveryProvenance {
  assetCreatedAt: number;
  nodeId?: string;
  taskId?: string;
  attemptId?: string;
  evaluationId?: string;
  promptAssemblyId?: string;
  providerId?: string;
  model?: string;
}

/** One source video in approved package order. Array position is authoritative. */
export interface DeliveryManifestItem {
  shotId: string;
  selectedVideoHash: string;
  packageFileName: string;
  sourceFileName: string;
  sourceFormat: string;
  sourceBytes: number;
  sourceDurationMs: number;
  sourceWidth?: number;
  sourceHeight?: number;
  hasEmbeddedAudio: boolean;
  trimInMs: number;
  trimOutMs: number;
  embeddedAudioEnabled: boolean;
  provenance: DeliveryProvenance;
}

/** Immutable subject of the Delivery approval gate. */
export interface DeliveryManifestContent extends Record<string, unknown> {
  taskListId: string;
  canvasId: string;
  productionPlan: { revision: number; contentHash: string };
  visualConstitution: { revision: number; contentHash: string };
  deliverySequence: { revision: number; contentHash: string };
  namingPolicy: DeliveryNamingPolicy;
  items: DeliveryManifestItem[];
}

/** The host derives ordered media facts; callers choose only the safe package name. */
export interface PrepareDeliveryManifestInput {
  taskListId: string;
  canvasId: string;
  expectedRowVersion: number;
  packageBaseName: string;
}

export type DeliveryPackageStatus =
  | 'queued'
  | 'running'
  | 'ready_to_publish'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'recovery_required';

/** Persistent idempotency ledger for one approved batch package. */
export interface DeliveryPackageTaskAttempt {
  kind: 'batch_export';
  id: string;
  taskListId: string;
  taskId?: string;
  manifestRevision: number;
  manifestHash: string;
  idempotencyKey: string;
  status: DeliveryPackageStatus;
  rowVersion: number;
  stagingPath?: string;
  destinationPath: string;
  packageHash?: string;
  packageBytes?: number;
  fileCount?: number;
  attempt: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** Durable Delivery state safe to expose to the renderer and Commander context. */
export interface DeliveryManifestContext {
  taskList: TaskList;
  manifest: PlanDocument;
  approval: PlanApprovalView;
  packageAttempt?: DeliveryPackageTaskAttempt;
}

export interface PrepareDeliveryManifestResult {
  context: DeliveryManifestContext;
  created: boolean;
}

/** Media types governed by the persistent production-quality loop. */
export type ProductionMediaType = 'image' | 'video';

/** Durable lifecycle of one provider submission. */
export type ProductionMediaTaskAttemptStatus =
  | 'reserved'
  | 'submitting'
  | 'awaiting_provider'
  | 'asset_ready'
  | 'evaluating'
  | 'accepted'
  | 'repair_required'
  | 'regenerate_required'
  | 'human_review'
  | 'failed'
  | 'ambiguous'
  | 'cancelled';

export type TaskEvaluationVerdict = 'pass' | 'repair' | 'regenerate' | 'human_review';

/**
 * Structured, reviewable change between immutable generation attempts.
 * The host applies this delta deterministically; models never replace the
 * already-approved story or Visual Constitution.
 */
export interface RepairDelta extends Record<string, unknown> {
  version: 1;
  reason: string;
  /** Stable machine-readable findings; prose belongs in reason. */
  reasonCodes: string[];
  promptAdditions: string[];
  negativeAdditions: string[];
  preserve: string[];
  seedStrategy: 'keep' | 'increment';
  parameterChanges?: Record<string, string | number | boolean>;
  /** Durable lineage for an additive change; omitted on legacy evaluator deltas. */
  source?: 'vision_evaluation' | 'user_feedback';
  /** Exact immutable attempt whose provider prompt is the base for this delta. */
  parentAttemptId?: string;
  /** SHA-256 of the exact provider prompt used by the parent attempt. */
  basePromptHash?: string;
  /** Verbatim human comment when the Commander initiated the refinement. */
  userFeedback?: string;
  /** Exact evaluation and artifact that produced this additive repair. */
  sourceEvaluationId?: string;
  sourceArtifactId?: string;
}

export type ProductionMediaReferenceRole =
  | 'source_image'
  | 'character'
  | 'equipment'
  | 'location'
  | 'generic_reference'
  | 'first_frame'
  | 'last_frame';

/** Ordered semantic labels for one reference image supplied to generation and grading. */
export interface ProductionMediaReferenceEvidence {
  order: number;
  assetHash: string;
  roles: Array<{ role: ProductionMediaReferenceRole; entityId?: string }>;
}

export type ProductionMediaScope = 'canvas' | 'style_audition' | 'production';

export type ProductionMediaAuthority =
  | { kind: 'task-list' }
  | {
      kind: 'task-list-production-plan';
      planId: string;
      planHash: string;
      candidateId: string;
    }
  | {
      kind: 'task-list-approved';
      planId: string;
      planHash: string;
      constitutionId: string;
      constitutionHash: string;
    };

export type ProductionMediaOperation =
  'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video';

export interface ProductionMediaLineage {
  purpose: PromptAssemblyPurpose;
  parentAttemptId?: string;
  sourceEvaluationId?: string;
  sourceArtifactId?: string;
  basePromptHash?: string;
  variantIndex: number;
  variantCount: number;
}

/** Immutable host-compiled request identity recorded before a provider call. */
export interface ProductionMediaGenerationSpec extends Record<string, unknown> {
  specVersion: 3;
  scope: ProductionMediaScope;
  authority: ProductionMediaAuthority;
  taskListId: string;
  taskId: string;
  canvasId: string;
  canvasUpdatedAt: number;
  nodeId: string;
  nodeUpdatedAt: number;
  /** Host-derived durable task identity; the model cannot select this binding. */
  task: {
    id: string;
    key: string;
    role: string;
    shotId?: string;
  };
  mediaType: ProductionMediaType;
  operation: ProductionMediaOperation;
  providerId: string;
  modelId: string;
  /** Durable Commander-owned prompt assembly that authored the final prompt. */
  promptAssemblyId: string;
  prompt: string;
  promptHash: string;
  negativePrompt?: string;
  /** Ordered exactly as the provider-conditioning request, with semantic roles retained. */
  referenceEvidence: ProductionMediaReferenceEvidence[];
  /** Exact host-owned provider request. Prompt fields mirror the assembly output byte-for-byte. */
  request: GenerationRequest;
  limits: {
    maxAttemptsPerShot: number;
    maxRegenerations: number;
    maxTotalCostUsd: number;
    styleAuditionCommittedCostUsd: number;
  };
  lineage: ProductionMediaLineage;
  createdAt: number;
}

/** One immutable provider submission reservation and its monotonic state. */
export interface ProductionMediaTaskAttempt {
  kind: 'production_media';
  id: string;
  taskListId: string;
  taskId: string;
  canvasId: string;
  nodeId: string;
  attempt: number;
  idempotencyKey: string;
  specHash: string;
  generationSpec: ProductionMediaGenerationSpec;
  repairDelta?: RepairDelta;
  scope: ProductionMediaScope;
  mediaType: ProductionMediaType;
  status: ProductionMediaTaskAttemptStatus;
  rowVersion: number;
  providerId: string;
  /** Durable Commander-owned prompt assembly that authored the final prompt. */
  promptAssemblyId: string;
  parentAttemptId?: string;
  submissionPurpose: PromptAssemblyPurpose;
  model: string;
  prompt: string;
  promptHash: string;
  negativePrompt?: string;
  seed?: number;
  estimatedCostUsd: number;
  reportedActualCostUsd?: number;
  providerJobId?: string;
  providerReceipt?: string;
  assetHash?: string;
  error?: string;
  createdAt: number;
  submittedAt?: number;
  submissionStartedAt?: number;
  cancelRequestedAt?: number;
  assetReadyAt?: number;
  evaluatedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

/** Fixed rubric scores used for both stills and timestamped video evidence. */
export interface TaskEvaluationScoreSet extends Record<string, number> {
  identity: number;
  style: number;
  scriptAlignment: number;
  continuity: number;
  composition: number;
  lighting: number;
  motion: number;
  technical: number;
  safety: number;
}

export interface TaskEvaluationFrameEvidence {
  timestampSeconds: number;
  assetHash: string;
}

/** Immutable vision/metadata evidence attached to exactly one attempt. */
export interface TaskEvaluation {
  kind: 'production_media';
  id: string;
  attemptId: string;
  taskListId: string;
  canvasId: string;
  nodeId: string;
  artifactId: string;
  assetHash: string;
  mediaType: ProductionMediaType;
  profile: 'canvas_media.v1' | 'style_audition.v1' | 'production_media.v1';
  sourcePromptHash: string;
  rubricVersion: string;
  evaluatorProviderId: string;
  evaluatorModel?: string;
  scores: TaskEvaluationScoreSet;
  total: number;
  verdict: TaskEvaluationVerdict;
  strengths: string[];
  risks: string[];
  evidence: string[];
  repairDelta?: RepairDelta;
  metadata: Record<string, unknown>;
  frameEvidence: TaskEvaluationFrameEvidence[];
  createdAt: number;
}

/** One bounded host/handler execution of a persisted Task. */
export interface TaskExecutionAttempt {
  kind: 'task';
  id: string;
  taskListId: string;
  taskId: string;
  attempt: number;
  idempotencyKey: string;
  status: TaskStatus;
  rowVersion: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  metadata: Record<string, unknown>;
  providerJobId?: string;
  assetHash?: string;
  error?: string;
  createdAt: number;
  submittedAt?: number;
  assetReadyAt?: number;
  updatedAt: number;
  completedAt?: number;
}

export type AudioTaskSubtype = 'voice' | 'music' | 'sfx';

/** Renderer- and Commander-safe projection of one durable Audio Studio request. */
export interface AudioTaskView {
  id: string;
  canvasId: string;
  subtype: AudioTaskSubtype;
  prompt: string;
  providerId: string;
  status: TaskListStatus;
  taskStatus: TaskStatus;
  progress: number;
  currentStep?: string;
  error?: string;
  attempt?: {
    id: string;
    status: TaskStatus;
    providerJobId?: string;
    assetHash?: string;
    error?: string;
    createdAt: number;
    updatedAt: number;
  };
  promptAssembly?: PromptAssemblyRecord;
  artifact?: {
    assetEntryId: string;
    assetHash: string;
    format: string;
    path?: string;
  };
  createdAt: number;
  updatedAt: number;
}

/** Every durable execution occurrence, discriminated by its concrete producer. */
export type TaskAttempt =
  TaskExecutionAttempt | DeliveryPackageTaskAttempt | ProductionMediaTaskAttempt;

export interface TaskCostSummary {
  attemptCount: number;
  regenerationCount: number;
  estimatedCostUsd: number;
  reportedActualCostUsd: number;
  committedCostUsd: number;
  hasUnreportedActualCosts: boolean;
}

/** Input accepted by the task list engine after the host UI records a real user action. */
export interface UserApprovePlanGateInput {
  taskListId: string;
  gateKey: PlanApprovalGateKey;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
}

interface UserRevisePlanGateInput {
  taskListId: string;
  gateKey: PlanApprovalGateKey;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
  /** Human-authored and required. Blank reasons are rejected by both engine and storage. */
  reason: string;
}

/** Host-facing request to keep the same gate open and ask for a revised subject. */
export type UserRequestPlanGateChangesInput = UserRevisePlanGateInput;

/** Host-facing rejection that keeps the same gate open on a new immutable revision. */
export type UserRejectPlanGateInput = UserRevisePlanGateInput;

export interface ApprovePlanGateInput {
  taskListId: string;
  gateKey: PlanApprovalGateKey;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
  resumeTokenHash: string;
  eventId: string;
  actor: string;
  correlationId?: string;
  causationId?: string;
  approvedAt: number;
  /** Engine-owned phase transition; never accepted directly from renderer or AI tools. */
  nextPhaseKey?: string;
  /** Engine-owned task transition; never accepted directly from renderer or AI tools. */
  nextTaskId?: string;
  /**
   * Engine-owned producer completion. Planning and visual direction become
   * complete only when the user approves their exact immutable revision.
   */
  completedProducerTaskId?: string;
}

export type ApprovePlanGateResult =
  | {
      ok: true;
      code: 'approved';
      taskList: TaskList;
      approval: PlanApproval;
      event: TaskEvent;
    }
  | { ok: false; code: 'task_list_not_found' }
  | { ok: false; code: 'no_approval' }
  | { ok: false; code: 'already_approved'; approval: PlanApproval }
  | {
      ok: false;
      code: 'approval_not_pending';
      status: Exclude<PlanApprovalStatus, 'pending' | 'approved'>;
    }
  | {
      ok: false;
      code: 'gate_not_current';
      actualGate?: PlanApprovalGateKey;
    }
  | { ok: false; code: 'stale_row_version'; actualRowVersion: number }
  | { ok: false; code: 'stale_subject_revision'; actualSubjectRevision: number }
  | { ok: false; code: 'subject_hash_mismatch' }
  | { ok: false; code: 'resume_token_mismatch' };

/** Storage-facing atomic same-gate revision input. The engine derives replacement rows. */
export interface RevisePlanGateInput {
  taskListId: string;
  gateKey: PlanApprovalGateKey;
  action: PlanGateRevisionAction;
  reason: string;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
  /** Existing external task that must produce a genuinely revised subject. */
  producerTaskId: string;
  eventId: string;
  actor: string;
  correlationId?: string;
  causationId?: string;
  revisedAt: number;
}

export type RevisePlanGateResult =
  | {
      ok: true;
      code: 'revision_requested';
      taskList: TaskList;
      previousApproval: PlanApproval;
      producerTask: Task;
      event: TaskEvent;
    }
  | { ok: false; code: 'task_list_not_found' }
  | { ok: false; code: 'no_approval' }
  | {
      ok: false;
      code: 'approval_not_pending';
      status: Exclude<PlanApprovalStatus, 'pending'>;
    }
  | { ok: false; code: 'gate_not_current'; actualGate?: PlanApprovalGateKey }
  | { ok: false; code: 'stale_row_version'; actualRowVersion: number }
  | { ok: false; code: 'stale_subject_revision'; actualSubjectRevision: number }
  | { ok: false; code: 'subject_hash_mismatch' };

export interface Task {
  id: string;
  taskListId: string;
  phaseKey: string;
  phaseName: string;
  phaseOrder: number;
  taskKey: string;
  name: string;
  kind: TaskKind;
  status: TaskStatus;
  provider?: string;
  dependencyIds: string[];
  attempts: number;
  maxRetries: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  providerTaskId?: string;
  assetId?: string;
  error?: string;
  progress: number;
  currentStep?: string;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

export interface TaskArtifact {
  id: string;
  taskListId: string;
  taskId: string;
  attemptId?: string;
  artifactType: string;
  entityType?: string;
  entityId?: string;
  assetHash?: string;
  path?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface TaskArtifactSummary {
  id: string;
  artifactType: string;
  attemptId?: string;
  entityType?: string;
  entityId?: string;
  assetHash?: string;
  path?: string;
  createdAt: number;
}

export interface TaskListSummary {
  id: string;
  /** The Commander session that owns this Task List, when Commander-created. */
  commanderSessionId?: string;
  taskListType: string;
  entityType: string;
  entityId?: string;
  triggerSource: string;
  status: TaskListStatus;
  summary: string;
  progress: number;
  completedPhases: number;
  totalPhases: number;
  completedTasks: number;
  totalTasks: number;
  currentPhaseKey?: string;
  currentTaskId?: string;
  displayCategory: string;
  displayLabel: string;
  /** Locale key for a host-authored label. Omitted for AI-authored labels. */
  displayLabelKey?: string;
  relatedEntityLabel?: string;
  provider?: string;
  modelKey?: string;
  promptTemplateId?: string;
  promptTemplateVersion?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  producedArtifacts?: TaskArtifactSummary[];
}

export interface TaskSummary {
  id: string;
  taskListId: string;
  phaseKey: string;
  phaseName: string;
  phaseOrder: number;
  taskKey: string;
  name?: string;
  kind: TaskKind;
  status: TaskStatus;
  progress?: number;
  currentStep?: string;
  displayCategory: string;
  displayLabel: string;
  /** Locale key for a host-authored label. Omitted for AI-authored labels. */
  displayLabelKey?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  relatedEntityLabel?: string;
  provider?: string;
  modelKey?: string;
  promptTemplateId?: string;
  promptTemplateVersion?: string;
  summary?: string;
  error?: string;
  attempts?: number;
  maxRetries?: number;
  assetId?: string;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  producedArtifacts?: TaskArtifactSummary[];
}

export interface TaskListUpdatedEvent {
  taskList: TaskListSummary;
}

export interface TaskUpdatedEvent {
  task: TaskSummary;
}

export interface TaskPhaseUpdatedEvent {
  taskListId: string;
  phaseKey: string;
}
