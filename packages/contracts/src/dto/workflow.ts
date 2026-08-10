import type { FinalExportFitMode } from './resolution.js';
import type { VisualStyleGrammar } from './visual-style.js';

export const WorkflowRunStatus = {
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

export type WorkflowRunStatus = (typeof WorkflowRunStatus)[keyof typeof WorkflowRunStatus];

/** The only approval gates supported by the persistent video workflow. */
export const WorkflowApprovalGateKey = {
  ProductionPlan: 'production_plan',
  VisualConstitution: 'visual_constitution',
  FinalExport: 'final_export',
} as const;

export type WorkflowApprovalGateKey =
  (typeof WorkflowApprovalGateKey)[keyof typeof WorkflowApprovalGateKey];

export const WorkflowDocumentStatus = {
  Draft: 'draft',
  Active: 'active',
  Superseded: 'superseded',
  Invalidated: 'invalidated',
} as const;

export type WorkflowDocumentStatus =
  (typeof WorkflowDocumentStatus)[keyof typeof WorkflowDocumentStatus];

export const WorkflowApprovalStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
  Invalidated: 'invalidated',
} as const;

export type WorkflowApprovalStatus =
  (typeof WorkflowApprovalStatus)[keyof typeof WorkflowApprovalStatus];

export const StageRunStatus = {
  Pending: 'pending',
  Blocked: 'blocked',
  Ready: 'ready',
  Running: 'running',
  Completed: 'completed',
  CompletedWithErrors: 'completed_with_errors',
  Failed: 'failed',
  Cancelled: 'cancelled',
  Skipped: 'skipped',
} as const;

export type StageRunStatus = (typeof StageRunStatus)[keyof typeof StageRunStatus];

export const TaskRunStatus = {
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

export type TaskRunStatus = (typeof TaskRunStatus)[keyof typeof TaskRunStatus];

export const TaskKind = {
  AdapterGeneration: 'adapter_generation',
  ProviderPoll: 'provider_poll',
  Transform: 'transform',
  Validation: 'validation',
  AssetResolve: 'asset_resolve',
  MetadataExtract: 'metadata_extract',
  TimelineAssembly: 'timeline_assembly',
  Export: 'export',
  Cleanup: 'cleanup',
} as const;

export type TaskKind = (typeof TaskKind)[keyof typeof TaskKind];

export interface WorkflowTaskDefinition {
  id: string;
  name: string;
  kind: TaskKind;
  providerHint?: string;
  dependsOnTaskIds?: string[];
  maxRetries: number;
  timeoutMs?: number;
  inputBinding?: Record<string, unknown>;
  outputBinding?: Record<string, unknown>;
}

export interface WorkflowStageDefinition {
  id: string;
  name: string;
  order: number;
  dependsOnStageIds?: string[];
  allowPartialSuccess?: boolean;
  requiredForCompletion?: boolean;
  tasks: WorkflowTaskDefinition[];
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

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: number;
  kind: string;
  description: string;
  stages: WorkflowStageDefinition[];
  retryPolicy?: RetryPolicy;
  cancellationPolicy?: CancellationPolicy;
  resumePolicy?: ResumePolicy;
}

export interface WorkflowRun {
  id: string;
  workflowType: string;
  entityType: string;
  entityId?: string;
  triggerSource: string;
  status: WorkflowRunStatus;
  summary: string;
  progress: number;
  completedStages: number;
  totalStages: number;
  completedTasks: number;
  totalTasks: number;
  /** ID of a persisted WorkflowStageRun, never a logical WorkflowStageDefinition ID. */
  currentStageId?: string;
  currentTaskId?: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  /** Optimistic-concurrency version for durable workflow transitions. */
  rowVersion?: number;
  /** Present only while the run is blocked at one of the three approval gates. */
  currentGate?: WorkflowApprovalGateKey;
  /** Runtime engine version that owns this aggregate. Defaults to `legacy`. */
  engineVersion?: string;
  /** Persisted workflow-definition version. Defaults to `1`. */
  definitionVersion?: number;
}

/** Host-owned report used to persist Commander context recovery health. */
export interface ContextRecoveryReport {
  workflowRunId: string;
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

/** Immutable, revisioned workflow artifact used as an approval subject. */
export interface WorkflowDocument {
  id: string;
  workflowRunId: string;
  logicalKey: string;
  documentType: string;
  revision: number;
  schemaVersion: number;
  content: Record<string, unknown>;
  /** Caller-computed SHA-256. Persistence stores and compares it verbatim. */
  contentHash: string;
  status: WorkflowDocumentStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowApproval {
  id: string;
  workflowRunId: string;
  gateKey: WorkflowApprovalGateKey;
  subjectLogicalKey: string;
  subjectRevision: number;
  /** Caller-computed SHA-256 of the exact subject revision. */
  subjectHash: string;
  /** Caller-computed SHA-256 of the approved generation/export manifest. */
  manifestHash: string;
  /** Caller-computed SHA-256 of the one-time resume token. */
  resumeTokenHash: string;
  status: WorkflowApprovalStatus;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
}

export type WorkflowGateRevisionAction = 'request_changes' | 'reject';

/** Immutable user-authored instruction attached to a same-gate document revision. */
export interface WorkflowGateRevisionRequest extends Record<string, unknown> {
  action: WorkflowGateRevisionAction;
  reason: string;
  previousRevision: number;
  requestedAt: number;
}

/** Approval metadata safe to expose outside the host process. */
export type WorkflowApprovalView = Omit<WorkflowApproval, 'resumeTokenHash'>;

export interface WorkflowEvent {
  workflowRunId: string;
  seq: number;
  eventId: string;
  actor: string;
  correlationId?: string;
  causationId?: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/** Durable state of one workflow-bound Commander question. */
export type WorkflowDecisionStatus = 'pending' | 'answered' | 'recovery_required';

export interface WorkflowDecisionOption {
  id: string;
  label: string;
  description?: string;
}

/**
 * A persisted AskUser decision. `(workflowRunId, decisionKey, subjectRevision)`
 * is the stable idempotency identity; `questionId` is the canonical UI handle.
 */
export interface WorkflowDecision {
  id: string;
  workflowRunId: string;
  taskRunId: string;
  canvasId: string;
  questionId: string;
  decisionKey: string;
  subjectRevision: number;
  question: string;
  options: WorkflowDecisionOption[];
  allowFreeText: boolean;
  status: WorkflowDecisionStatus;
  answer?: string;
  selectedOptionId?: string;
  rowVersion: number;
  createdAt: number;
  updatedAt: number;
  answeredAt?: number;
}

export interface WorkflowDecisionFilter {
  workflowRunId?: string;
  canvasId?: string;
}

export interface ReserveWorkflowDecisionInput {
  decision: WorkflowDecision;
  expectedRunRowVersion: number;
  event: Omit<WorkflowEvent, 'seq'>;
}

export interface ReserveWorkflowDecisionResult {
  decision: WorkflowDecision;
  run: WorkflowRun;
  task: WorkflowTaskRun;
  event?: WorkflowEvent;
  created: boolean;
}

export interface AnswerWorkflowDecisionInput {
  canvasId: string;
  questionId: string;
  answer: string;
  selectedOptionId?: string;
  status: Extract<WorkflowDecisionStatus, 'answered' | 'recovery_required'>;
  answeredAt: number;
  event: Omit<WorkflowEvent, 'seq'>;
}

export interface AnswerWorkflowDecisionResult {
  decision: WorkflowDecision;
  run: WorkflowRun;
  task: WorkflowTaskRun;
  event?: WorkflowEvent;
  answered: boolean;
}

/** Host-facing view of the exact immutable revision awaiting human approval. */
export interface WorkflowApprovalContext {
  run: WorkflowRun;
  approval: WorkflowApprovalView;
  document: WorkflowDocument;
}

/** Host-UI view of the latest durable visual audition and its CAS version. */
export interface WorkflowVisualAuditionContext {
  run: WorkflowRun;
  document: WorkflowDocument;
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
  status: 'completed' | 'failed' | 'ambiguous';
  prompt: string;
  promptHash: string;
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
  status: 'pending' | 'completed' | 'failed' | 'ambiguous';
  attempts: VisualPreviewAttempt[];
  selectedAttempt?: number;
}

/** Content of the latest immutable `visual-auditions` workflow document. */
export interface VisualAuditionDocumentContent extends Record<string, unknown> {
  status: 'in_progress' | 'complete' | 'failed' | 'ambiguous';
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
    providerId: string;
    model?: string;
    seed: number;
    prompt: string;
    promptHash: string;
  };
  locked: VisualConstitutionGrammar;
  candidates: VisualAuditionCandidate[];
  budget: VisualAuditionDocumentContent['budget'];
}

/** CAS-protected user choice sent only by the host approval UI. */
export interface SelectVisualConstitutionCandidateInput {
  workflowRunId: string;
  candidateId: string;
  expectedRowVersion: number;
  expectedAuditionRevision: number;
  expectedAuditionHash: string;
}

export interface VisualConstitutionSelectionResult {
  context: WorkflowApprovalContext;
  created: boolean;
}

export type FinalExportContainer = 'mp4' | 'mov';
export type FinalExportCodec = 'h264' | 'h265' | 'prores';
export type FinalExportQuality = 'draft' | 'standard' | 'high';

/** One exact selected canvas clip locked into the final movie manifest. */
export interface FinalExportManifestSegment {
  order: number;
  nodeId: string;
  nodeUpdatedAt: number;
  title: string;
  assetHash: string;
  assetFormat: string;
  selectedVariantIndex: number;
  trimInMs: number;
  trimOutMs: number;
  sourceDurationMs: number;
  sourceStartSeconds: number;
  durationSeconds: number;
  speed: number;
  /** Verified dimensions recorded on the selected source asset (v2 manifests). */
  sourceWidth?: number;
  sourceHeight?: number;
}

export type FinalExportResolutionRiskCode =
  'aspect_padding' | 'aspect_crop' | 'aspect_distortion' | 'upscale';

export interface FinalExportResolutionRisk {
  code: FinalExportResolutionRiskCode;
  severity: 'info' | 'warning';
  nodeId: string;
  message: string;
  source: { width: number; height: number };
  output: { width: number; height: number };
}

export interface FinalExportOutputSettings {
  container: FinalExportContainer;
  codec: FinalExportCodec;
  quality: FinalExportQuality;
  width: number;
  height: number;
  fps: number;
  logicalFileName: string;
  audioCodec: 'aac' | 'pcm_s24le';
  pixelFormat: 'yuv420p' | 'yuva444p10le';
  overwritePolicy: 'fail';
  /** v1 omitted this and used stretch; v2 defaults to contain. */
  fitMode?: FinalExportFitMode;
  backgroundColor?: string;
}

/** Immutable subject of the third and final host approval gate. */
export interface FinalExportManifestContent extends Record<string, unknown> {
  manifestVersion: 1 | 2;
  workflowRunId: string;
  productionPlan: { revision: number; contentHash: string };
  visualConstitution: { revision: number; contentHash: string };
  canvasId: string;
  assemblySnapshotHash: string;
  segments: FinalExportManifestSegment[];
  audioTracks: [];
  subtitleTracks: [];
  output: FinalExportOutputSettings;
  expectedDurationMs: number;
  estimatedDurationSeconds: number;
  maxRenderAttempts: number;
  resolutionRisks?: FinalExportResolutionRisk[];
  capabilities: {
    embeddedClipAudio: true;
    separateAudioMix: false;
    subtitles: false;
  };
}

/** AI-authored output choices; the host derives all media inputs from the canvas and CAS. */
export interface PrepareFinalExportManifestInput {
  workflowRunId: string;
  canvasId: string;
  expectedRowVersion: number;
  output: Pick<FinalExportOutputSettings, 'codec' | 'quality' | 'width' | 'height' | 'fps'> & {
    fitMode?: FinalExportFitMode;
    backgroundColor?: string;
  };
}

export type FinalExportExecutionStatus =
  | 'queued'
  | 'running'
  | 'ready_to_publish'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'recovery_required';

/** Persistent idempotency ledger for one approved Manifest render. */
export interface WorkflowExportExecution {
  id: string;
  workflowRunId: string;
  manifestRevision: number;
  manifestHash: string;
  idempotencyKey: string;
  status: FinalExportExecutionStatus;
  rowVersion: number;
  stagingPath?: string;
  destinationPath: string;
  outputAssetHash?: string;
  outputHash?: string;
  outputSize?: number;
  attempt: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** Immutable snapshots of one bounded local render execution. */
export interface FinalExportExecutionDocumentContent extends Record<string, unknown> {
  manifest: { revision: number; contentHash: string };
  jobId: string;
  attempt: number;
  status: FinalExportExecutionStatus;
  outputPath: string;
  outputAssetHash?: string;
  outputHash?: string;
  outputFormat?: string;
  outputBytes?: number;
  error?: string;
  toolchain: {
    ffmpegBinary: string;
    expectedPackagedVersion: string;
    license: 'LGPL';
  };
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** Durable Final Export state safe to expose to the renderer and Commander context. */
export interface WorkflowFinalExportContext {
  run: WorkflowRun;
  manifest: WorkflowDocument;
  approval: WorkflowApprovalView;
  execution?: WorkflowExportExecution;
}

export interface PrepareFinalExportManifestResult {
  context: WorkflowFinalExportContext;
  created: boolean;
}

/** Media types governed by the persistent production-quality loop. */
export type ProductionMediaType = 'image' | 'video';

/** Durable lifecycle of one provider submission. */
export type WorkflowMediaAttemptStatus =
  | 'reserved'
  | 'submitted'
  | 'asset_ready'
  | 'evaluating'
  | 'accepted'
  | 'repair_required'
  | 'regenerate_required'
  | 'human_review'
  | 'failed'
  | 'ambiguous'
  | 'cancelled';

export type WorkflowMediaEvaluationVerdict = 'pass' | 'repair' | 'regenerate' | 'human_review';

/**
 * Structured, reviewable change between immutable generation attempts.
 * The host applies this delta deterministically; models never replace the
 * already-approved story or Visual Constitution.
 */
export interface RepairDelta extends Record<string, unknown> {
  version: 1;
  reason: string;
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

/** Immutable host-compiled request identity recorded before a provider call. */
export interface ProductionMediaGenerationSpec extends Record<string, unknown> {
  specVersion: 1 | 2;
  workflowRunId: string;
  canvasId: string;
  nodeId: string;
  nodeUpdatedAt: number;
  /** Host-derived durable task identity; the model cannot select this binding. */
  workflowTask: {
    taskRunId: string;
    taskId: string;
    role: string;
    shotId?: string;
  };
  mediaType: ProductionMediaType;
  generationType: 'image' | 'video';
  mode: 'text-to-image' | 'image-to-image' | 'text-to-video' | 'image-to-video';
  productionPlan: { revision: number; contentHash: string };
  visualConstitution: { revision: number; contentHash: string };
  providerId: string;
  prompt: string;
  negativePrompt?: string;
  /** Ordered exactly as the provider-conditioning request, with semantic roles retained. */
  referenceEvidence?: ProductionMediaReferenceEvidence[];
  referenceAssetHashes: string[];
  frameReferenceHashes?: { first?: string; last?: string };
  /** v2 immutable resolution plan; actual pixels are recorded on the Asset. */
  resolution?: import('./resolution.js').ResolutionAudit;
  request: {
    width?: number;
    height?: number;
    duration?: number;
    fps?: number;
    seed?: number;
    sourceImageHash?: string;
    referenceImages?: string[];
    audio?: boolean;
    quality?: string;
    steps?: number;
    cfgScale?: number;
    scheduler?: string;
    img2imgStrength?: number;
    params?: Record<string, unknown>;
    resolution?: import('./resolution.js').ResolvedResolution;
  };
  limits: {
    maxAttemptsPerShot: number;
    maxRegenerations: number;
    maxTotalCostUsd: number;
    styleAuditionCommittedCostUsd: number;
  };
  createdAt: number;
}

/** One immutable provider submission reservation and its monotonic state. */
export interface WorkflowMediaAttempt {
  id: string;
  workflowRunId: string;
  canvasId: string;
  nodeId: string;
  attempt: number;
  idempotencyKey: string;
  specHash: string;
  generationSpec: ProductionMediaGenerationSpec;
  repairDelta?: RepairDelta;
  mediaType: ProductionMediaType;
  status: WorkflowMediaAttemptStatus;
  rowVersion: number;
  providerId: string;
  model?: string;
  prompt: string;
  promptHash: string;
  negativePrompt?: string;
  seed?: number;
  estimatedCostUsd: number;
  reportedActualCostUsd?: number;
  providerJobId?: string;
  assetHash?: string;
  error?: string;
  createdAt: number;
  submittedAt?: number;
  assetReadyAt?: number;
  evaluatedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

/** Fixed rubric scores used for both stills and timestamped video evidence. */
export interface WorkflowMediaScoreSet extends Record<string, number> {
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

export interface WorkflowMediaFrameEvidence {
  timestampSeconds: number;
  assetHash: string;
}

/** Immutable vision/metadata evidence attached to exactly one attempt. */
export interface WorkflowMediaEvaluation {
  id: string;
  attemptId: string;
  workflowRunId: string;
  canvasId: string;
  nodeId: string;
  assetHash: string;
  mediaType: ProductionMediaType;
  rubricVersion: string;
  evaluatorProviderId: string;
  evaluatorModel?: string;
  scores: WorkflowMediaScoreSet;
  total: number;
  verdict: WorkflowMediaEvaluationVerdict;
  strengths: string[];
  risks: string[];
  evidence: string[];
  repairDelta?: RepairDelta;
  metadata: Record<string, unknown>;
  frameEvidence: WorkflowMediaFrameEvidence[];
  createdAt: number;
}

export interface WorkflowMediaCostSummary {
  attemptCount: number;
  regenerationCount: number;
  estimatedCostUsd: number;
  reportedActualCostUsd: number;
  committedCostUsd: number;
  hasUnreportedActualCosts: boolean;
}

/** Input accepted by the workflow engine after the host UI records a real user action. */
export interface UserApproveWorkflowGateInput {
  workflowRunId: string;
  gateKey: WorkflowApprovalGateKey;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
}

interface UserReviseWorkflowGateInput {
  workflowRunId: string;
  gateKey: WorkflowApprovalGateKey;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
  /** Human-authored and required. Blank reasons are rejected by both engine and storage. */
  reason: string;
}

/** Host-facing request to keep the same gate open and ask for a revised subject. */
export type UserRequestWorkflowGateChangesInput = UserReviseWorkflowGateInput;

/** Host-facing rejection that keeps the same gate open on a new immutable revision. */
export type UserRejectWorkflowGateInput = UserReviseWorkflowGateInput;

export interface ApproveWorkflowGateInput {
  workflowRunId: string;
  gateKey: WorkflowApprovalGateKey;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
  resumeTokenHash: string;
  eventId: string;
  actor: string;
  correlationId?: string;
  causationId?: string;
  approvedAt: number;
  /** Engine-owned stage transition; never accepted directly from renderer or AI tools. */
  nextStageId?: string;
  /** Engine-owned task transition; never accepted directly from renderer or AI tools. */
  nextTaskId?: string;
  /**
   * Engine-owned producer completion. Planning and visual direction become
   * complete only when the user approves their exact immutable revision.
   */
  completedProducerTaskRunId?: string;
}

export type ApproveWorkflowGateResult =
  | {
      ok: true;
      code: 'approved';
      run: WorkflowRun;
      approval: WorkflowApproval;
      event: WorkflowEvent;
    }
  | { ok: false; code: 'run_not_found' }
  | { ok: false; code: 'no_approval' }
  | { ok: false; code: 'already_approved'; approval: WorkflowApproval }
  | {
      ok: false;
      code: 'approval_not_pending';
      status: Exclude<WorkflowApprovalStatus, 'pending' | 'approved'>;
    }
  | {
      ok: false;
      code: 'gate_not_current';
      actualGate?: WorkflowApprovalGateKey;
    }
  | { ok: false; code: 'stale_row_version'; actualRowVersion: number }
  | { ok: false; code: 'stale_subject_revision'; actualSubjectRevision: number }
  | { ok: false; code: 'subject_hash_mismatch' }
  | { ok: false; code: 'resume_token_mismatch' };

/** Storage-facing atomic same-gate revision input. The engine derives replacement rows. */
export interface ReviseWorkflowGateInput {
  workflowRunId: string;
  gateKey: WorkflowApprovalGateKey;
  action: WorkflowGateRevisionAction;
  reason: string;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
  /** Existing external task that must produce a genuinely revised subject. */
  producerTaskRunId: string;
  eventId: string;
  actor: string;
  correlationId?: string;
  causationId?: string;
  revisedAt: number;
}

export type ReviseWorkflowGateResult =
  | {
      ok: true;
      code: 'revision_requested';
      run: WorkflowRun;
      previousApproval: WorkflowApproval;
      producerTask: WorkflowTaskRun;
      event: WorkflowEvent;
    }
  | { ok: false; code: 'run_not_found' }
  | { ok: false; code: 'no_approval' }
  | {
      ok: false;
      code: 'approval_not_pending';
      status: Exclude<WorkflowApprovalStatus, 'pending'>;
    }
  | { ok: false; code: 'gate_not_current'; actualGate?: WorkflowApprovalGateKey }
  | { ok: false; code: 'stale_row_version'; actualRowVersion: number }
  | { ok: false; code: 'stale_subject_revision'; actualSubjectRevision: number }
  | { ok: false; code: 'subject_hash_mismatch' };

export interface WorkflowStageRun {
  id: string;
  workflowRunId: string;
  stageId: string;
  name: string;
  status: StageRunStatus;
  order: number;
  progress: number;
  completedTasks: number;
  totalTasks: number;
  error?: string;
  metadata: Record<string, unknown>;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
}

export interface WorkflowTaskRun {
  id: string;
  workflowRunId: string;
  stageRunId: string;
  taskId: string;
  name: string;
  kind: TaskKind;
  status: TaskRunStatus;
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

export interface WorkflowArtifact {
  id: string;
  workflowRunId: string;
  taskRunId: string;
  artifactType: string;
  entityType?: string;
  entityId?: string;
  assetHash?: string;
  path?: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface WorkflowArtifactSummary {
  id: string;
  artifactType: string;
  entityType?: string;
  entityId?: string;
  assetHash?: string;
  path?: string;
  createdAt: number;
}

export interface WorkflowActivitySummary {
  id: string;
  workflowType: string;
  entityType: string;
  entityId?: string;
  triggerSource: string;
  status: WorkflowRunStatus;
  summary: string;
  progress: number;
  completedStages: number;
  totalStages: number;
  completedTasks: number;
  totalTasks: number;
  currentStageId?: string;
  currentTaskId?: string;
  displayCategory: string;
  displayLabel: string;
  relatedEntityLabel?: string;
  provider?: string;
  modelKey?: string;
  promptTemplateId?: string;
  promptTemplateVersion?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  updatedAt: number;
  producedArtifacts?: WorkflowArtifactSummary[];
}

export interface WorkflowTaskSummary {
  id: string;
  workflowRunId: string;
  stageRunId: string;
  taskId: string;
  stageId?: string;
  name?: string;
  kind: TaskKind;
  status: TaskRunStatus;
  progress?: number;
  currentStep?: string;
  displayCategory: string;
  displayLabel: string;
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
  producedArtifacts?: WorkflowArtifactSummary[];
}

export interface WorkflowUpdatedEvent {
  workflow: WorkflowActivitySummary;
}

export interface WorkflowTaskUpdatedEvent {
  task: WorkflowTaskSummary;
}

export interface WorkflowStageUpdatedEvent {
  workflowRunId: string;
  stageId: string;
}
