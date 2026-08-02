import { createHash, randomUUID } from 'node:crypto';
import {
  TaskRunStatus,
  WorkflowApprovalGateKey,
  WorkflowRunStatus,
  type ApproveWorkflowGateResult,
  type FinalExportManifestContent,
  type FinalExportManifestSegment,
  type FinalExportOutputSettings,
  type PrepareFinalExportManifestInput,
  type PrepareFinalExportManifestResult,
  type UserApproveWorkflowGateInput,
  type SelectVisualConstitutionCandidateInput,
  type VisualAuditionCandidate,
  type VisualAuditionDocumentContent,
  type VisualConstitutionSelectionResult as ContractVisualConstitutionSelectionResult,
  type VisualConstitutionDocumentContent,
  type VisualDirectionCandidateProposal,
  type WorkflowApproval,
  type WorkflowApprovalContext,
  type WorkflowDocument,
  type WorkflowEvent,
  type WorkflowFinalExportContext,
  type WorkflowRun,
  type WorkflowRunId,
  type WorkflowVisualAuditionContext,
  type WorkflowStageId,
  type WorkflowStageRun,
  type WorkflowTaskId,
  type WorkflowTaskRun,
} from '@lucid-fin/contracts';
import type { IStorageLayer, WorkflowRepository } from '@lucid-fin/storage';
import type { WorkflowTaskExecutionResult, WorkflowTaskHandler } from './task-handler.js';
import { WorkflowPlanner } from './workflow-planner.js';
import type { WorkflowRegistry } from './workflow-registry.js';

export interface WorkflowStartRequest {
  workflowType: string;
  entityType: string;
  entityId?: string;
  triggerSource?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ProductionPlanCreateRequest {
  canvasId: string;
  idea: string;
  plan: Record<string, unknown>;
}

export interface ProductionPlanCreateResult {
  workflowRunId: string;
  gate: 'production_plan';
  status: 'awaiting_approval';
  revision: number;
  contentHash: string;
}

export interface ContextCheckpointCreateResult {
  workflowRunId: string;
  revision: number;
  contentHash: string;
}

export interface ProductionMediaWorkflowContext {
  run: WorkflowRun;
  productionPlan: WorkflowDocument;
  visualConstitution: WorkflowDocument;
}

export interface VisualAuditionStartRequest {
  canvasId: string;
  workflowRunId: string;
  providerId: string;
  width: number;
  height: number;
  candidates: VisualDirectionCandidateProposal[];
}

export interface VisualAuditionStartResult {
  document: WorkflowDocument;
  resumed: boolean;
}

export interface VisualAuditionSnapshotRequest {
  workflowRunId: string;
  expectedRevision: number;
  content: VisualAuditionDocumentContent;
}

export type VisualConstitutionSelectionResult = ContractVisualConstitutionSelectionResult;

export type FinalExportManifestResult = PrepareFinalExportManifestResult;

export interface WorkflowEngineOptions {
  db: IStorageLayer;
  registry: WorkflowRegistry;
  handlers: WorkflowTaskHandler[];
  planner?: WorkflowPlanner;
  idFactory?: () => string;
  now?: () => number;
  maxConcurrentTasks?: number;
}

type WorkflowStateRecord = {
  workflowRun: WorkflowRun;
  stageRun: WorkflowStageRun;
  taskRun: WorkflowTaskRun;
};

const TASK_SUCCESS_STATUSES = new Set<WorkflowTaskRun['status']>([
  TaskRunStatus.Completed,
  TaskRunStatus.Skipped,
]);

const TASK_TERMINAL_STATUSES = new Set<WorkflowTaskRun['status']>([
  TaskRunStatus.Completed,
  TaskRunStatus.Skipped,
  TaskRunStatus.Failed,
  TaskRunStatus.RetryableFailed,
  TaskRunStatus.Cancelled,
]);

const WORKFLOW_TERMINAL_STATUSES = new Set<WorkflowRun['status']>([
  WorkflowRunStatus.Completed,
  WorkflowRunStatus.CompletedWithErrors,
  WorkflowRunStatus.Failed,
  WorkflowRunStatus.Cancelled,
  WorkflowRunStatus.Dead,
]);

export const VISUAL_PREVIEW_RUBRIC_VERSION = 'visual-preview-rubric-v1';

export class WorkflowEngine {
  private readonly planner: WorkflowPlanner;
  private readonly handlers = new Map<string, WorkflowTaskHandler>();
  private readonly now: () => number;
  private readonly idFactory?: () => string;
  private autoPump: Promise<number> | undefined;
  private tick = 0;
  private readonly maxConcurrentTasks: number;
  private activeTasks = 0;

  constructor(private readonly options: WorkflowEngineOptions) {
    this.planner = options.planner ?? new WorkflowPlanner();
    this.now = options.now ?? (() => Date.now());
    this.idFactory = options.idFactory;

    for (const handler of options.handlers) {
      this.handlers.set(handler.id, handler);
    }

    this.maxConcurrentTasks = options.maxConcurrentTasks ?? 5;
  }

  private get wf(): WorkflowRepository {
    return this.options.db.repos.workflows;
  }

  // Engine-internal ID cast helpers. The engine only ever round-trips IDs that
  // the database itself generated, so we brand them at the access boundary
  // rather than threading brand types through every method signature.
  private runId(id: string | undefined): WorkflowRunId | undefined {
    return id as WorkflowRunId | undefined;
  }
  private stageId(id: string): WorkflowStageId {
    return id as WorkflowStageId;
  }
  private taskId(id: string): WorkflowTaskId {
    return id as WorkflowTaskId;
  }

  start(request: WorkflowStartRequest): string {
    const definition = this.options.registry.get(request.workflowType);
    if (!definition) {
      throw new Error(`Workflow "${request.workflowType}" is not registered`);
    }

    const planned = this.planner.plan({
      definition,
      entityType: request.entityType,
      entityId: request.entityId,
      triggerSource: request.triggerSource,
      input: request.input,
      metadata: request.metadata,
      now: this.nextTimestamp(),
      idFactory: this.idFactory,
    });

    this.wf.insertRun(planned.workflowRun);
    for (const stageRun of planned.stageRuns) {
      this.wf.insertStageRun(stageRun);
    }
    for (const taskRun of planned.taskRuns) {
      this.wf.insertTaskRun(taskRun);
    }

    // Auto-pump: begin executing the workflow immediately so callers don't need
    // to manually call pump() after start().
    this.autoPump = this.pump(planned.workflowRun.id);

    return planned.workflowRun.id;
  }

  list(filter?: { status?: string; workflowType?: string; entityType?: string }): WorkflowRun[] {
    return this.wf.listRuns(filter).rows;
  }

  get(id: string): WorkflowRun | undefined {
    return this.wf.getRun(this.runId(id) as WorkflowRunId);
  }

  getStages(workflowRunId: string): WorkflowStageRun[] {
    return this.wf.listStageRuns(this.runId(workflowRunId) as WorkflowRunId).rows;
  }

  getTasks(workflowRunId: string): WorkflowTaskRun[] {
    return this.wf.listTaskRuns(this.runId(workflowRunId) as WorkflowRunId).rows;
  }

  /**
   * Persists the AI-expanded plan and first approval gate as one transaction.
   * Deliberately does not call start(), pump(), a provider, canvas, or media code.
   */
  createProductionPlan(request: ProductionPlanCreateRequest): ProductionPlanCreateResult {
    const canvasId = request.canvasId.trim();
    if (!canvasId) throw new TypeError('Production plan canvasId must not be empty');
    const idea = request.idea.trim();
    if (!idea) throw new TypeError('Production plan idea must not be empty');
    const existing = this.wf
      .listRuns({ workflowType: 'movie.production.v2', entityType: 'canvas' })
      .rows.find(
        (candidate) =>
          candidate.entityId === canvasId && !WORKFLOW_TERMINAL_STATUSES.has(candidate.status),
      );
    if (existing) {
      throw new Error(
        `Persistent video workflow "${existing.id}" is already active for canvas "${canvasId}"`,
      );
    }

    const createdAt = this.nextTimestamp();
    const workflowRunId = this.nextId();
    const documentId = this.nextId();
    const approvalId = this.nextId();
    const correlationId = this.nextId();
    const resumeToken = this.nextId();
    const content = { ...request.plan, originalIdea: idea, canvasId };
    const contentHash = sha256(canonicalJson(content));
    const manifestHash = sha256(
      canonicalJson({
        gateKey: WorkflowApprovalGateKey.ProductionPlan,
        subjectHash: contentHash,
        budget: request.plan.budget ?? null,
      }),
    );

    const run: WorkflowRun = {
      id: workflowRunId,
      workflowType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: canvasId,
      triggerSource: 'commander',
      status: WorkflowRunStatus.Pending,
      summary: 'Production plan awaiting approval',
      progress: 0,
      completedStages: 0,
      totalStages: 0,
      completedTasks: 0,
      totalTasks: 0,
      input: { idea },
      output: {},
      metadata: {
        displayCategory: 'Production',
        displayLabel:
          typeof request.plan.title === 'string' && request.plan.title.trim()
            ? request.plan.title.trim()
            : 'Untitled production',
        productionPhase: 'production-plan',
      },
      createdAt,
      updatedAt: createdAt,
      rowVersion: 0,
      engineVersion: 'persistent-hybrid-v1',
      definitionVersion: 1,
    };
    const document: WorkflowDocument = {
      id: documentId,
      workflowRunId,
      logicalKey: 'production-plan',
      documentType: 'production_plan',
      revision: 1,
      schemaVersion: 1,
      content,
      contentHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    };
    const approval: WorkflowApproval = {
      id: approvalId,
      workflowRunId,
      gateKey: WorkflowApprovalGateKey.ProductionPlan,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: contentHash,
      manifestHash,
      resumeTokenHash: sha256(resumeToken),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    const events: WorkflowEvent[] = [
      {
        workflowRunId,
        seq: 1,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId,
        payload: {
          type: 'workflow.created',
          workflowType: run.workflowType,
          source: run.triggerSource,
        },
        timestamp: createdAt,
      },
      {
        workflowRunId,
        seq: 2,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId,
        payload: {
          type: 'workflow.gate.requested',
          gateKey: approval.gateKey,
          approvalId,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: contentHash,
        },
        timestamp: this.nextTimestamp(),
      },
    ];

    this.wf.createApprovalGateBundle({ run, document, approval, events });
    return {
      workflowRunId,
      gate: WorkflowApprovalGateKey.ProductionPlan,
      status: 'awaiting_approval',
      revision: document.revision,
      contentHash,
    };
  }

  /**
   * Persist a verified immutable projection of the durable workflow facts
   * immediately before context handoff compaction.
   */
  createContextCheckpoint(
    workflowRunId: string,
    facts: Record<string, unknown>,
  ): ContextCheckpointCreateResult {
    const runId = this.runId(workflowRunId) as WorkflowRunId;
    if (!this.wf.getRun(runId)) {
      throw new Error(`Workflow "${workflowRunId}" not found`);
    }
    const latest = this.wf.getLatestDocument(runId, 'context-checkpoint');
    const revision = (latest?.revision ?? 0) + 1;
    const createdAt = this.nextTimestamp();
    const content = { ...facts, workflowRunId, checkpointedAt: createdAt };
    const contentHash = sha256(canonicalJson(content));
    const document: WorkflowDocument = {
      id: this.nextId(),
      workflowRunId,
      logicalKey: 'context-checkpoint',
      documentType: 'context_checkpoint',
      revision,
      schemaVersion: 1,
      content,
      contentHash,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    };
    this.wf.createDocument(document);
    const verified = this.wf.getDocumentRevision(runId, document.logicalKey, document.revision);
    if (!verified || verified.contentHash !== contentHash) {
      throw new Error(`Context checkpoint verification failed for workflow "${workflowRunId}"`);
    }
    return { workflowRunId, revision, contentHash };
  }

  getLatestVisualAudition(workflowRunId: string): WorkflowDocument | undefined {
    return this.wf.getLatestDocument(
      this.runId(workflowRunId) as WorkflowRunId,
      'visual-auditions',
    );
  }

  getVisualAuditionContext(workflowRunId: string): WorkflowVisualAuditionContext | undefined {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) return undefined;
    const document = this.getLatestVisualAudition(workflowRunId);
    return document ? { run, document } : undefined;
  }

  getApprovedProductionPlan(workflowRunId: string): WorkflowDocument {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    return this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
  }

  getApprovedVisualConstitution(workflowRunId: string): WorkflowDocument {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    return this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.VisualConstitution,
    );
  }

  requireProductionMediaContext(
    workflowRunId: string,
    canvasId: string,
    expectedRowVersion?: number,
  ): ProductionMediaWorkflowContext {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (
      run.workflowType !== 'movie.production.v2' ||
      run.entityType !== 'canvas' ||
      run.entityId !== canvasId
    ) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if (expectedRowVersion !== undefined && (run.rowVersion ?? 0) !== expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }
    if (run.currentGate) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    if (
      run.currentStageId !== 'media-generation' ||
      (run.status !== WorkflowRunStatus.Ready && run.status !== WorkflowRunStatus.Running)
    ) {
      throw new Error(
        `Workflow "${workflowRunId}" is not ready for media generation (status=${run.status}, stage=${run.currentStageId ?? 'none'})`,
      );
    }
    return {
      run,
      productionPlan: this.requireExactApprovedDocument(
        run.id as WorkflowRunId,
        WorkflowApprovalGateKey.ProductionPlan,
      ),
      visualConstitution: this.requireExactApprovedDocument(
        run.id as WorkflowRunId,
        WorkflowApprovalGateKey.VisualConstitution,
      ),
    };
  }

  /**
   * Creates or resumes the durable candidate set before any provider call.
   * A repeated call is resumable only when every creative/provider input is
   * byte-for-byte equivalent to the existing request hash.
   */
  beginVisualAudition(request: VisualAuditionStartRequest): VisualAuditionStartResult {
    const run = this.requireStyleExplorationRun(request.workflowRunId, request.canvasId);
    const productionPlan = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    const providerId = requireNonEmptyString(request.providerId, 'providerId');
    const width = requirePositiveInteger(request.width, 'width');
    const height = requirePositiveInteger(request.height, 'height');
    validateVisualCandidateProposals(request.candidates);

    const planBudget = asRecord(productionPlan.content.budget);
    const approvedStyleAuditionCostUsd = requireNonNegativeNumber(
      planBudget.styleAuditionCostUsd,
      'Production Plan budget.styleAuditionCostUsd',
    );
    const maxRegenerations = requireNonNegativeInteger(
      planBudget.maxRegenerations,
      'Production Plan budget.maxRegenerations',
    );
    const planAttempts = requireNonNegativeInteger(
      planBudget.maxAttemptsPerShot,
      'Production Plan budget.maxAttemptsPerShot',
    );
    const maxAttemptsPerCandidate = Math.max(1, Math.min(2, planAttempts || 1));
    const requestIdentity = {
      productionPlan: {
        revision: productionPlan.revision,
        contentHash: productionPlan.contentHash,
      },
      providerId,
      width,
      height,
      rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
      candidates: request.candidates,
    };
    const requestHash = sha256(canonicalJson(requestIdentity));
    const existing = this.getLatestVisualAudition(run.id);
    if (existing) {
      const existingContent = existing.content as VisualAuditionDocumentContent;
      if (existingContent.requestHash !== requestHash) {
        throw new Error(
          'A different visual audition already exists for this workflow; inspect or resolve it before submitting another candidate set',
        );
      }
      return {
        document: existing,
        resumed: existingContent.status !== 'complete',
      };
    }

    const createdAt = this.nextTimestamp();
    const candidates: VisualAuditionCandidate[] = request.candidates.map((candidate) => ({
      ...cloneJson(candidate),
      status: 'pending',
      attempts: [],
    }));
    const content: VisualAuditionDocumentContent = {
      status: 'in_progress',
      requestHash,
      rubricVersion: VISUAL_PREVIEW_RUBRIC_VERSION,
      productionPlan: requestIdentity.productionPlan,
      providerId,
      width,
      height,
      candidates,
      budget: {
        approvedStyleAuditionCostUsd,
        maxRegenerations,
        maxAttemptsPerCandidate,
        estimatedCommittedUsd: 0,
        hasUnreportedActualCosts: false,
        unpricedOperations: ['vision-grade'],
      },
    };
    const document = this.createWorkflowDocument(
      run.id,
      'visual-auditions',
      'visual_auditions',
      1,
      content,
      createdAt,
    );
    this.wf.createDocument(document);
    return { document, resumed: false };
  }

  /** Append a verified immutable snapshot after each provider/vision attempt. */
  saveVisualAuditionSnapshot(request: VisualAuditionSnapshotRequest): WorkflowDocument {
    const run = this.requireStyleExplorationRun(request.workflowRunId);
    const latest = this.getLatestVisualAudition(run.id);
    if (!latest) throw new Error(`Workflow "${run.id}" has no visual audition to update`);
    if (latest.revision !== request.expectedRevision) {
      throw new Error(
        `Visual audition revision changed: expected ${request.expectedRevision}, got ${latest.revision}`,
      );
    }
    validateVisualAuditionSnapshot(
      request.content,
      latest.content as VisualAuditionDocumentContent,
      (assetHash) => Boolean(this.options.db.repos.assets.findByHash(assetHash)),
    );

    const createdAt = this.nextTimestamp();
    const document = this.createWorkflowDocument(
      run.id,
      'visual-auditions',
      'visual_auditions',
      latest.revision + 1,
      cloneJson(request.content),
      createdAt,
    );
    this.wf.createDocument(document);
    const verified = this.wf.getDocumentRevision(
      run.id as WorkflowRunId,
      document.logicalKey,
      document.revision,
    );
    if (!verified || verified.contentHash !== document.contentHash) {
      throw new Error(`Visual audition verification failed for workflow "${run.id}"`);
    }
    return verified;
  }

  /**
   * A real host-UI choice creates the exact immutable Visual Constitution and
   * opens the second approval gate. Selection and approval remain separate.
   */
  selectVisualConstitutionCandidateFromUser(
    input: SelectVisualConstitutionCandidateInput,
  ): VisualConstitutionSelectionResult {
    const run = this.wf.getRun(this.runId(input.workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${input.workflowRunId}" not found`);
    if (run.workflowType !== 'movie.production.v2') {
      throw new Error(`Workflow "${input.workflowRunId}" is not a persistent video workflow`);
    }
    if (run.currentStageId !== 'style-exploration') {
      throw new Error('Visual candidates can be selected only during style exploration');
    }
    if (run.currentGate && run.currentGate !== WorkflowApprovalGateKey.VisualConstitution) {
      throw new Error(`Workflow is blocked at ${run.currentGate}`);
    }
    if ((run.rowVersion ?? 0) !== input.expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${input.expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }

    const productionPlan = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    const audition = this.getLatestVisualAudition(run.id);
    if (!audition) throw new Error('No visual auditions are available for selection');
    if (audition.revision !== input.expectedAuditionRevision) {
      throw new Error(
        `Visual audition revision changed: expected ${input.expectedAuditionRevision}, got ${audition.revision}`,
      );
    }
    if (audition.contentHash !== input.expectedAuditionHash) {
      throw new Error('Visual audition content hash changed');
    }
    const auditionContent = audition.content as VisualAuditionDocumentContent;
    if (auditionContent.status !== 'complete') {
      throw new Error('Visual auditions are not complete');
    }
    const candidate = auditionContent.candidates.find(
      (entry) => entry.id === input.candidateId && entry.status === 'completed',
    );
    if (!candidate || candidate.selectedAttempt === undefined) {
      throw new Error(`Completed visual candidate "${input.candidateId}" not found`);
    }
    const attempt = candidate.attempts.find(
      (entry) => entry.attempt === candidate.selectedAttempt && entry.status === 'completed',
    );
    if (!attempt?.assetHash || !attempt.grade) {
      throw new Error(`Visual candidate "${input.candidateId}" has no graded preview`);
    }
    if (!this.options.db.repos.assets.findByHash(attempt.assetHash)) {
      throw new Error(`Visual preview asset "${attempt.assetHash}" is missing`);
    }

    const currentPending =
      run.currentGate === WorkflowApprovalGateKey.VisualConstitution
        ? this.getPendingApprovalContext(run.id)
        : undefined;
    const currentContent = currentPending?.document.content as
      VisualConstitutionDocumentContent | undefined;
    if (
      currentPending &&
      currentContent?.selectedCandidateId === candidate.id &&
      currentContent.visualAuditions.revision === audition.revision &&
      currentContent.visualAuditions.contentHash === audition.contentHash
    ) {
      return { context: currentPending, created: false };
    }

    const latestConstitution = this.wf.getLatestDocument(
      run.id as WorkflowRunId,
      'visual-constitution',
    );
    const revision = (latestConstitution?.revision ?? 0) + 1;
    const createdAt = this.nextTimestamp();
    const content: VisualConstitutionDocumentContent = {
      productionPlan: {
        revision: productionPlan.revision,
        contentHash: productionPlan.contentHash,
      },
      visualAuditions: { revision: audition.revision, contentHash: audition.contentHash },
      selectedCandidateId: candidate.id,
      selectedBy: 'user',
      selectedPreview: {
        assetHash: attempt.assetHash,
        providerId: attempt.providerId,
        ...(attempt.model ? { model: attempt.model } : {}),
        seed: attempt.reportedSeed ?? attempt.requestedSeed,
        prompt: attempt.prompt,
        promptHash: attempt.promptHash,
      },
      locked: cloneJson(candidate.constitution),
      candidates: cloneJson(auditionContent.candidates),
      budget: cloneJson(auditionContent.budget),
    };
    const document = this.createWorkflowDocument(
      run.id,
      'visual-constitution',
      'visual_constitution',
      revision,
      content,
      createdAt,
    );
    const resumeToken = this.nextId();
    const approval: WorkflowApproval = {
      id: this.nextId(),
      workflowRunId: run.id,
      gateKey: WorkflowApprovalGateKey.VisualConstitution,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: document.contentHash,
      manifestHash: sha256(
        canonicalJson({
          productionPlan: content.productionPlan,
          visualAuditions: content.visualAuditions,
          selectedCandidateId: content.selectedCandidateId,
          selectedPreview: content.selectedPreview,
          budget: content.budget,
        }),
      ),
      resumeTokenHash: sha256(resumeToken),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    this.wf.createApprovalGateRevision({
      expectedRowVersion: input.expectedRowVersion,
      document,
      approval,
      event: {
        workflowRunId: run.id,
        eventId: this.nextId(),
        actor: 'user',
        correlationId: this.nextId(),
        payload: {
          type: 'workflow.gate.requested',
          gateKey: approval.gateKey,
          approvalId: approval.id,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: document.contentHash,
          selectedCandidateId: candidate.id,
          auditionRevision: audition.revision,
          auditionHash: audition.contentHash,
        },
        timestamp: createdAt,
      },
    });
    const context = this.getPendingApprovalContext(run.id);
    if (!context) throw new Error('Visual Constitution approval gate was not persisted');
    return { context, created: true };
  }

  /**
   * Derives the exact final movie inputs from the persisted canvas and CAS
   * index. The caller can choose output settings, but can never supply media
   * paths, ordering, or asset hashes.
   */
  prepareFinalExportManifest(
    input: PrepareFinalExportManifestInput,
  ): PrepareFinalExportManifestResult {
    const run = this.requireFinalExportPreparationRun(input.workflowRunId, input.canvasId);
    if ((run.rowVersion ?? 0) !== input.expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${input.expectedRowVersion}, got ${run.rowVersion ?? 0}`,
      );
    }

    const productionPlan = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    const visualConstitution = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.VisualConstitution,
    );
    const derivedAssembly = this.deriveFinalExportSegments(input.canvasId);
    this.requireAcceptedProductionMedia(
      run.id as WorkflowRunId,
      input.canvasId,
      productionPlan,
      visualConstitution,
    );
    const output = validateFinalExportOutput(
      input.output,
      buildFinalExportFileName(derivedAssembly.canvasName, input.output.codec),
    );
    const { segments, estimatedDurationSeconds } = derivedAssembly;
    const planBudget = asRecord(productionPlan.content.budget);
    const approvedAttempts = requireNonNegativeInteger(
      planBudget.maxAttemptsPerShot,
      'Production Plan budget.maxAttemptsPerShot',
    );
    const content: FinalExportManifestContent = {
      manifestVersion: 1,
      workflowRunId: run.id,
      productionPlan: {
        revision: productionPlan.revision,
        contentHash: productionPlan.contentHash,
      },
      visualConstitution: {
        revision: visualConstitution.revision,
        contentHash: visualConstitution.contentHash,
      },
      canvasId: input.canvasId,
      assemblySnapshotHash: sha256(
        canonicalJson({ segments, audioTracks: [], subtitleTracks: [] }),
      ),
      segments,
      audioTracks: [],
      subtitleTracks: [],
      output,
      expectedDurationMs: Math.round(estimatedDurationSeconds * 1000),
      estimatedDurationSeconds,
      maxRenderAttempts: Math.max(1, Math.min(2, approvedAttempts || 1)),
      capabilities: {
        embeddedClipAudio: true,
        separateAudioMix: false,
        subtitles: false,
      },
    };
    const contentHash = sha256(canonicalJson(content));
    const latest = this.wf.getLatestDocument(run.id as WorkflowRunId, 'final-export');
    const latestApproval = this.wf.getLatestApproval(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.FinalExport,
    );
    if (
      latest?.contentHash === contentHash &&
      latestApproval &&
      (latestApproval.status === 'pending' || latestApproval.status === 'approved') &&
      latestApproval.subjectLogicalKey === latest.logicalKey &&
      latestApproval.subjectRevision === latest.revision &&
      latestApproval.subjectHash === latest.contentHash
    ) {
      const context = this.getFinalExportContext(run.id);
      if (!context) throw new Error('Final Export context could not be restored');
      return { context, created: false };
    }

    const createdAt = this.nextTimestamp();
    const document = this.createWorkflowDocument(
      run.id,
      'final-export',
      'final_export_manifest',
      (latest?.revision ?? 0) + 1,
      content,
      createdAt,
    );
    const resumeToken = this.nextId();
    const approval: WorkflowApproval = {
      id: this.nextId(),
      workflowRunId: run.id,
      gateKey: WorkflowApprovalGateKey.FinalExport,
      subjectLogicalKey: document.logicalKey,
      subjectRevision: document.revision,
      subjectHash: document.contentHash,
      manifestHash: document.contentHash,
      resumeTokenHash: sha256(resumeToken),
      status: 'pending',
      createdAt,
      updatedAt: createdAt,
    };
    this.wf.createApprovalGateRevision({
      expectedRowVersion: input.expectedRowVersion,
      document,
      approval,
      event: {
        workflowRunId: run.id,
        eventId: this.nextId(),
        actor: 'assistant',
        correlationId: this.nextId(),
        payload: {
          type: 'workflow.gate.requested',
          gateKey: approval.gateKey,
          approvalId: approval.id,
          subjectLogicalKey: document.logicalKey,
          subjectRevision: document.revision,
          subjectHash: document.contentHash,
          canvasId: input.canvasId,
          segmentCount: segments.length,
          output,
        },
        timestamp: createdAt,
      },
    });
    const context = this.getFinalExportContext(run.id);
    if (!context) throw new Error('Final Export approval gate was not persisted');
    return { context, created: true };
  }

  getFinalExportContext(workflowRunId: string): WorkflowFinalExportContext | undefined {
    const runId = this.runId(workflowRunId) as WorkflowRunId;
    const run = this.wf.getRun(runId);
    if (!run) return undefined;
    const manifest = this.wf.getLatestDocument(runId, 'final-export');
    if (!manifest) return undefined;
    const approval = this.wf.getLatestApproval(runId, WorkflowApprovalGateKey.FinalExport);
    if (
      !approval ||
      approval.subjectLogicalKey !== manifest.logicalKey ||
      approval.subjectRevision !== manifest.revision ||
      approval.subjectHash !== manifest.contentHash
    ) {
      throw new Error(`Workflow "${workflowRunId}" Final Export approval is inconsistent`);
    }
    const execution = this.wf.getLatestExportExecution(runId);
    const matchingExecution =
      execution?.manifestRevision === manifest.revision &&
      execution.manifestHash === manifest.contentHash
        ? execution
        : undefined;
    const { resumeTokenHash: _hostOnlyResumeTokenHash, ...approvalView } = approval;
    return {
      run,
      manifest,
      approval: approvalView,
      ...(matchingExecution ? { execution: matchingExecution } : {}),
    };
  }

  /**
   * Host-side render authorization. Besides the exact approved revision/hash,
   * this re-derives the canvas segment projection so an approved stale canvas
   * can never be rendered accidentally.
   */
  requireApprovedFinalExportManifest(workflowRunId: string, canvasId: string): WorkflowDocument {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (
      run.workflowType !== 'movie.production.v2' ||
      run.entityType !== 'canvas' ||
      run.entityId !== canvasId
    ) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if (run.currentGate) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    const manifest = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.FinalExport,
    );
    const content = manifest.content as FinalExportManifestContent;
    if (content.canvasId !== canvasId || !Array.isArray(content.segments)) {
      throw new Error('Approved Final Export manifest has an invalid canvas projection');
    }
    const productionPlan = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.ProductionPlan,
    );
    const visualConstitution = this.requireExactApprovedDocument(
      run.id as WorkflowRunId,
      WorkflowApprovalGateKey.VisualConstitution,
    );
    if (
      content.productionPlan?.revision !== productionPlan.revision ||
      content.productionPlan.contentHash !== productionPlan.contentHash ||
      content.visualConstitution?.revision !== visualConstitution.revision ||
      content.visualConstitution.contentHash !== visualConstitution.contentHash
    ) {
      throw new Error(
        'Approved Final Export manifest is not bound to the current approved documents',
      );
    }
    validateFinalExportOutput(content.output);
    const current = this.deriveFinalExportSegments(canvasId);
    if (canonicalJson(current.segments) !== canonicalJson(content.segments)) {
      throw new Error('Canvas media no longer matches the approved Final Export manifest');
    }
    this.requireAcceptedProductionMedia(
      run.id as WorkflowRunId,
      canvasId,
      productionPlan,
      visualConstitution,
    );
    return manifest;
  }

  getPendingApprovalContext(workflowRunId: string): WorkflowApprovalContext | undefined {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run?.currentGate) return undefined;
    const approval = this.wf.getPendingApproval(
      this.runId(workflowRunId) as WorkflowRunId,
      run.currentGate,
    );
    if (!approval) {
      throw new Error(`Workflow "${workflowRunId}" has a gate but no pending approval`);
    }
    const document = this.wf.getDocumentRevision(
      this.runId(workflowRunId) as WorkflowRunId,
      approval.subjectLogicalKey,
      approval.subjectRevision,
    );
    if (
      !document ||
      document.revision !== approval.subjectRevision ||
      document.contentHash !== approval.subjectHash
    ) {
      throw new Error(`Workflow "${workflowRunId}" approval subject is inconsistent`);
    }
    const { resumeTokenHash: _hostOnlyResumeTokenHash, ...approvalView } = approval;
    return { run, approval: approvalView, document };
  }

  approvePendingGateFromUser(input: UserApproveWorkflowGateInput): ApproveWorkflowGateResult {
    const pending = this.wf.getPendingApproval(
      this.runId(input.workflowRunId) as WorkflowRunId,
      input.gateKey,
    );
    const latest = pending
      ? undefined
      : this.wf.getLatestApproval(this.runId(input.workflowRunId) as WorkflowRunId, input.gateKey);
    const approval = pending ?? latest;
    if (!approval) {
      const run = this.wf.getRun(this.runId(input.workflowRunId) as WorkflowRunId);
      return run ? { ok: false, code: 'no_approval' } : { ok: false, code: 'run_not_found' };
    }

    return this.wf.approveGate({
      workflowRunId: this.runId(input.workflowRunId) as WorkflowRunId,
      gateKey: input.gateKey,
      expectedRowVersion: input.expectedRowVersion,
      expectedSubjectRevision: input.expectedSubjectRevision,
      expectedSubjectHash: input.expectedSubjectHash,
      resumeTokenHash: approval.resumeTokenHash,
      eventId: this.nextId(),
      actor: 'user',
      correlationId: this.nextId(),
      approvedAt: this.nextTimestamp(),
      nextStageId: nextStageForGate(input.gateKey),
    });
  }

  async pause(workflowRunId: string): Promise<void> {
    this.wf.updateRun(this.runId(workflowRunId) as WorkflowRunId, {
      status: 'paused',
      updatedAt: this.nextTimestamp(),
    });
  }

  async resume(workflowRunId: string): Promise<void> {
    this.assertNotAwaitingHumanApproval(workflowRunId);
    this.wf.updateRun(this.runId(workflowRunId) as WorkflowRunId, {
      status: 'ready',
      updatedAt: this.nextTimestamp(),
    });
    await this.refreshAvailability(workflowRunId);
  }

  async cancel(workflowRunId: string): Promise<void> {
    // Discard any in-flight autoPump before mutating state, so the pump loop
    // cannot race ahead and start new tasks after we mark everything cancelled.
    if (this.autoPump) {
      const pending = this.autoPump;
      this.autoPump = undefined;
      await pending.catch(() => {
        /* ignore — we are cancelling */
      });
    }

    const tasks = this.wf.listTaskRuns(this.runId(workflowRunId) as WorkflowRunId).rows;
    const stages = this.wf.listStageRuns(this.runId(workflowRunId) as WorkflowRunId).rows;

    for (const task of tasks) {
      if (TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.wf.updateTaskRun(this.taskId(task.id), {
        status: TaskRunStatus.Cancelled,
        completedAt: this.nextTimestamp(),
        updatedAt: this.nextTimestamp(),
      });
    }

    for (const stage of stages) {
      this.wf.recomputeStageAggregate(this.stageId(stage.id));
    }
    this.wf.recomputeWorkflowAggregate(this.runId(workflowRunId) as WorkflowRunId);
  }

  async retryTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    this.assertNotAwaitingHumanApproval(record.workflowRun.id);
    if (!TASK_TERMINAL_STATUSES.has(record.taskRun.status)) {
      return;
    }

    this.wf.updateTaskRun(this.taskId(taskRunId), {
      status: TaskRunStatus.Blocked,
      updatedAt: this.nextTimestamp(),
    });
    await this.refreshAvailability(record.workflowRun.id);
  }

  async retryStage(stageRunId: string): Promise<void> {
    const stageRun = this.wf.getStageRun(this.stageId(stageRunId));
    if (!stageRun) {
      throw new Error(`Workflow stage "${stageRunId}" not found`);
    }
    this.assertNotAwaitingHumanApproval(stageRun.workflowRunId);

    for (const task of this.wf.listTaskRunsByStage(this.stageId(stageRunId)).rows) {
      if (!TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.wf.updateTaskRun(this.taskId(task.id), {
        status: TaskRunStatus.Blocked,
        updatedAt: this.nextTimestamp(),
      });
    }

    await this.refreshAvailability(stageRun.workflowRunId);
  }

  async retryWorkflow(workflowRunId: string): Promise<void> {
    this.assertNotAwaitingHumanApproval(workflowRunId);
    for (const task of this.wf.listTaskRuns(this.runId(workflowRunId) as WorkflowRunId).rows) {
      if (!TASK_TERMINAL_STATUSES.has(task.status)) {
        continue;
      }

      this.wf.updateTaskRun(this.taskId(task.id), {
        status: TaskRunStatus.Blocked,
        updatedAt: this.nextTimestamp(),
      });
    }

    await this.refreshAvailability(workflowRunId);
  }

  async pump(workflowRunId?: string): Promise<number> {
    let executed = 0;
    await this.refreshAvailability(workflowRunId);

    const MAX_PUMP_ITERATIONS = 1000;
    let iterations = 0;
    for (;;) {
      if (++iterations > MAX_PUMP_ITERATIONS) {
        throw new Error('pump: max iterations exceeded — possible runaway workflow');
      }
      if (workflowRunId) {
        const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
        if (run && (run.status === 'paused' || run.status === 'cancelled' || run.currentGate)) {
          return executed;
        }
      }
      const slots = this.maxConcurrentTasks - this.activeTasks;
      if (slots <= 0) return executed;
      const readyTasks = this.wf.listReadyTasks(this.runId(workflowRunId)).rows;
      if (readyTasks.length === 0) return executed;

      const batch = readyTasks.slice(0, slots);
      this.activeTasks += batch.length;
      const results = await Promise.allSettled(batch.map((task) => this.executeTask(task.id)));
      this.activeTasks -= batch.length;
      executed += results.length;
    }
  }

  /** Await the auto-pump started by the most recent `start()` call. */
  async waitForAutoPump(): Promise<void> {
    if (this.autoPump) {
      const pending = this.autoPump;
      this.autoPump = undefined;
      await pending;
    }
  }

  async recover(workflowRunId?: string): Promise<number> {
    const candidates = this.getRecoverableTasks(workflowRunId);
    let recovered = 0;

    for (const task of candidates) {
      await this.recoverTask(task.id);
      recovered += 1;
    }

    return recovered;
  }

  private async executeTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    const handler = this.resolveHandler(record.taskRun);
    const attempts = record.taskRun.attempts + 1;

    this.wf.updateTaskRun(this.taskId(taskRunId), {
      status: TaskRunStatus.Running,
      attempts,
      startedAt: record.taskRun.startedAt ?? this.nextTimestamp(),
      updatedAt: this.nextTimestamp(),
    });

    try {
      const runningRecord = this.getRecord(taskRunId);
      const result = await handler.execute({
        workflowRun: runningRecord.workflowRun,
        stageRun: runningRecord.stageRun,
        taskRun: runningRecord.taskRun,
        db: this.options.db,
      });

      this.applyTaskResult(runningRecord.taskRun, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.applyTaskResult(this.getRecord(taskRunId).taskRun, {
        status:
          attempts < record.taskRun.maxRetries
            ? TaskRunStatus.RetryableFailed
            : TaskRunStatus.Failed,
        error: message,
        progress: record.taskRun.progress,
      });
    }

    await this.refreshAvailability(record.workflowRun.id);
  }

  private async recoverTask(taskRunId: string): Promise<void> {
    const record = this.getRecord(taskRunId);
    const handler = this.resolveHandler(record.taskRun);

    if (!handler.recover) {
      if (record.taskRun.status === TaskRunStatus.Running) {
        this.wf.updateTaskRun(this.taskId(taskRunId), {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        this.wf.recomputeStageAggregate(this.stageId(record.stageRun.id));
        this.wf.recomputeWorkflowAggregate(this.runId(record.workflowRun.id) as WorkflowRunId);
        await this.refreshAvailability(record.workflowRun.id);
      }
      return;
    }

    const result = await handler.recover({
      workflowRun: record.workflowRun,
      stageRun: record.stageRun,
      taskRun: record.taskRun,
      db: this.options.db,
    });

    if (!result) {
      if (record.taskRun.status === TaskRunStatus.Running) {
        this.wf.updateTaskRun(this.taskId(taskRunId), {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        this.wf.recomputeStageAggregate(this.stageId(record.stageRun.id));
        this.wf.recomputeWorkflowAggregate(this.runId(record.workflowRun.id) as WorkflowRunId);
        await this.refreshAvailability(record.workflowRun.id);
      }
      return;
    }

    this.applyTaskResult(record.taskRun, result);
    await this.refreshAvailability(record.workflowRun.id);
  }

  private applyTaskResult(taskRun: WorkflowTaskRun, result: WorkflowTaskExecutionResult): void {
    const status = result.status;
    const isTerminal = TASK_TERMINAL_STATUSES.has(status);

    this.wf.updateTaskRun(this.taskId(taskRun.id), {
      status,
      output: result.output ?? taskRun.output,
      error: result.error,
      progress: result.progress ?? (status === TaskRunStatus.Completed ? 100 : taskRun.progress),
      currentStep: result.currentStep,
      providerTaskId: result.providerTaskId ?? taskRun.providerTaskId,
      assetId: result.assetId ?? taskRun.assetId,
      completedAt: isTerminal ? this.nextTimestamp() : taskRun.completedAt,
      updatedAt: this.nextTimestamp(),
    });

    this.wf.recomputeStageAggregate(this.stageId(taskRun.stageRunId));
    this.wf.recomputeWorkflowAggregate(this.runId(taskRun.workflowRunId) as WorkflowRunId);
  }

  private async refreshAvailability(workflowRunId?: string): Promise<void> {
    const workflowIds = workflowRunId
      ? [workflowRunId]
      : this.wf.listRuns().rows.map((workflow) => workflow.id);

    for (const id of workflowIds) {
      const workflow = this.wf.getRun(this.runId(id) as WorkflowRunId);
      if (workflow?.currentGate) continue;
      const stages = this.wf.listStageRuns(this.runId(id) as WorkflowRunId).rows;
      const tasks = this.wf.listTaskRuns(this.runId(id) as WorkflowRunId).rows;
      const stageByRunId = new Map(stages.map((stage) => [stage.id, stage]));
      const stageByStageId = new Map(stages.map((stage) => [stage.stageId, stage]));
      const taskByRunId = new Map(tasks.map((task) => [task.id, task]));
      let changed = false;

      for (const task of [...tasks].sort(
        (left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id),
      )) {
        if (task.status !== TaskRunStatus.Blocked && task.status !== TaskRunStatus.Pending) {
          continue;
        }

        const stage = stageByRunId.get(task.stageRunId);
        if (!stage) {
          continue;
        }

        if (!this.areStageDependenciesSatisfied(stage, stageByStageId)) {
          continue;
        }

        if (!this.areTaskDependenciesSatisfied(task, taskByRunId)) {
          continue;
        }

        this.wf.updateTaskRun(this.taskId(task.id), {
          status: TaskRunStatus.Ready,
          updatedAt: this.nextTimestamp(),
        });
        task.status = TaskRunStatus.Ready;
        changed = true;
      }

      if (changed) {
        for (const stage of stages) {
          this.wf.recomputeStageAggregate(this.stageId(stage.id));
        }
        this.wf.recomputeWorkflowAggregate(this.runId(id) as WorkflowRunId);
      }
    }
  }

  private areStageDependenciesSatisfied(
    stageRun: WorkflowStageRun,
    stageByStageId: Map<string, WorkflowStageRun>,
  ): boolean {
    const dependsOnStageIds = this.readStringArray(stageRun.metadata?.dependsOnStageIds);
    return dependsOnStageIds.every((dependsOnStageId) => {
      const dependency = stageByStageId.get(dependsOnStageId);
      return (
        dependency !== undefined &&
        (dependency.status === 'completed' ||
          dependency.status === 'completed_with_errors' ||
          dependency.status === 'skipped')
      );
    });
  }

  private areTaskDependenciesSatisfied(
    taskRun: WorkflowTaskRun,
    taskByRunId: Map<string, WorkflowTaskRun>,
  ): boolean {
    return taskRun.dependencyIds.every((dependencyId) => {
      const dependency = taskByRunId.get(dependencyId);
      return dependency !== undefined && TASK_SUCCESS_STATUSES.has(dependency.status);
    });
  }

  private getRecord(taskRunId: string): WorkflowStateRecord {
    const taskRun = this.wf.getTaskRun(this.taskId(taskRunId));
    if (!taskRun) {
      throw new Error(`Workflow task "${taskRunId}" not found`);
    }

    const stageRun = this.wf.getStageRun(this.stageId(taskRun.stageRunId));
    if (!stageRun) {
      throw new Error(`Workflow stage "${taskRun.stageRunId}" not found`);
    }

    const workflowRun = this.wf.getRun(this.runId(taskRun.workflowRunId) as WorkflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run "${taskRun.workflowRunId}" not found`);
    }

    return { workflowRun, stageRun, taskRun };
  }

  private resolveHandler(taskRun: WorkflowTaskRun): WorkflowTaskHandler {
    const handlerId =
      typeof taskRun.input.handlerId === 'string' ? taskRun.input.handlerId : undefined;
    if (!handlerId) {
      throw new Error(`Workflow task "${taskRun.id}" is missing a handlerId`);
    }

    const handler = this.handlers.get(handlerId);
    if (!handler) {
      throw new Error(`Workflow handler "${handlerId}" is not registered`);
    }

    return handler;
  }

  private getRecoverableTasks(workflowRunId?: string): WorkflowTaskRun[] {
    const tasks = workflowRunId
      ? this.wf.listTaskRuns(this.runId(workflowRunId) as WorkflowRunId).rows
      : this.wf
          .listRuns()
          .rows.flatMap(
            (workflow) => this.wf.listTaskRuns(this.runId(workflow.id) as WorkflowRunId).rows,
          );

    return tasks
      .filter(
        (task) =>
          !this.wf.getRun(this.runId(task.workflowRunId) as WorkflowRunId)?.currentGate &&
          (task.status === TaskRunStatus.Running || task.status === TaskRunStatus.AwaitingProvider),
      )
      .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id));
  }

  private readStringArray(value: unknown): string[] {
    return Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === 'string')
      : [];
  }

  private requireFinalExportPreparationRun(workflowRunId: string, canvasId: string): WorkflowRun {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (run.workflowType !== 'movie.production.v2') {
      throw new Error(`Workflow "${workflowRunId}" is not a persistent video workflow`);
    }
    if (run.entityType !== 'canvas' || run.entityId !== canvasId) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if (run.currentGate && run.currentGate !== WorkflowApprovalGateKey.FinalExport) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    if (run.currentStageId !== 'media-generation' && run.currentStageId !== 'final-export') {
      throw new Error(
        `Workflow "${workflowRunId}" cannot prepare Final Export from stage ${run.currentStageId ?? 'none'}`,
      );
    }
    return run;
  }

  private deriveFinalExportSegments(canvasId: string): {
    segments: FinalExportManifestSegment[];
    estimatedDurationSeconds: number;
    canvasName: string;
  } {
    const canvas = this.options.db.repos.canvases.get(canvasId as never);
    if (!canvas) throw new Error(`Canvas "${canvasId}" not found`);

    const unsupportedAudioNodes = canvas.nodes.filter(
      (node) => node.type === 'audio' && !node.bypassed,
    );
    if (unsupportedAudioNodes.length > 0) {
      throw new Error(
        'Final movie rendering does not yet support separate audio nodes; mix or embed audio before requesting Final Export approval',
      );
    }

    const videoNodes = canvas.nodes
      .filter((node) => node.type === 'video' && !node.bypassed)
      .sort(
        (left, right) =>
          left.position.x - right.position.x ||
          left.position.y - right.position.y ||
          left.id.localeCompare(right.id),
      );
    if (videoNodes.length === 0) {
      throw new Error('Final Export requires at least one non-bypassed video node');
    }

    const segments = videoNodes.map((node, order): FinalExportManifestSegment => {
      const data = asRecord(node.data);
      const variants = Array.isArray(data.variants)
        ? data.variants.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const selectedVariantIndex =
        typeof data.selectedVariantIndex === 'number' &&
        Number.isInteger(data.selectedVariantIndex) &&
        data.selectedVariantIndex >= 0
          ? data.selectedVariantIndex
          : 0;
      const assetHash =
        variants[selectedVariantIndex] ??
        (typeof data.assetHash === 'string' && data.assetHash.trim() ? data.assetHash : undefined);
      if (!assetHash) {
        throw new Error(`Video node "${node.id}" has no selected rendered variant`);
      }
      const asset = this.options.db.repos.assets.findByHash(assetHash);
      if (!asset || asset.type !== 'video') {
        throw new Error(`Selected video asset "${assetHash}" is missing from the CAS index`);
      }
      if (
        typeof data.durationOverride === 'number' &&
        typeof asset.duration === 'number' &&
        Math.abs(data.durationOverride - asset.duration) > 1e-6
      ) {
        throw new Error(
          `Video node "${node.id}" requests a duration trim, but Final Export currently supports full selected clips only`,
        );
      }
      const durationCandidate =
        typeof asset.duration === 'number'
          ? asset.duration
          : typeof data.duration === 'number'
            ? data.duration
            : undefined;
      const durationSeconds = requirePositiveFiniteNumber(
        durationCandidate,
        `Video node "${node.id}" duration`,
      );
      return {
        order,
        nodeId: node.id,
        nodeUpdatedAt: node.updatedAt,
        title: node.title,
        assetHash,
        assetFormat: asset.format,
        selectedVariantIndex,
        trimInMs: 0,
        trimOutMs: Math.round(durationSeconds * 1000),
        sourceDurationMs: Math.round(durationSeconds * 1000),
        sourceStartSeconds: 0,
        durationSeconds,
        speed: 1,
      };
    });

    return {
      segments,
      canvasName: canvas.name,
      estimatedDurationSeconds: Number(
        segments
          .reduce((sum, segment) => sum + segment.durationSeconds / segment.speed, 0)
          .toFixed(6),
      ),
    };
  }

  private requireAcceptedProductionMedia(
    workflowRunId: WorkflowRunId,
    canvasId: string,
    productionPlan: WorkflowDocument,
    visualConstitution: WorkflowDocument,
  ): void {
    const canvas = this.options.db.repos.canvases.get(canvasId as never);
    if (!canvas) throw new Error(`Canvas "${canvasId}" not found`);
    const attempts = this.wf.listMediaAttempts(workflowRunId);
    const evaluations = new Map(
      this.wf
        .listMediaEvaluations(workflowRunId)
        .map((evaluation) => [evaluation.attemptId, evaluation]),
    );
    const productionNodes = canvas.nodes.filter(
      (node) => !node.bypassed && (node.type === 'image' || node.type === 'video'),
    );
    for (const node of productionNodes) {
      const data = asRecord(node.data);
      const variants = Array.isArray(data.variants)
        ? data.variants.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const selectedVariantIndex =
        typeof data.selectedVariantIndex === 'number' &&
        Number.isInteger(data.selectedVariantIndex) &&
        data.selectedVariantIndex >= 0
          ? data.selectedVariantIndex
          : 0;
      const selectedAssetHash =
        variants[selectedVariantIndex] ??
        (typeof data.assetHash === 'string' && data.assetHash.trim() ? data.assetHash : undefined);
      if (!selectedAssetHash) {
        throw new Error(`Production node "${node.id}" has no selected graded asset`);
      }
      const accepted = attempts.find(
        (attempt) =>
          attempt.nodeId === node.id &&
          attempt.status === 'accepted' &&
          attempt.assetHash === selectedAssetHash &&
          attempt.generationSpec.nodeUpdatedAt === node.updatedAt &&
          attempt.generationSpec.productionPlan.revision === productionPlan.revision &&
          attempt.generationSpec.productionPlan.contentHash === productionPlan.contentHash &&
          attempt.generationSpec.visualConstitution.revision === visualConstitution.revision &&
          attempt.generationSpec.visualConstitution.contentHash === visualConstitution.contentHash,
      );
      const evaluation = accepted ? evaluations.get(accepted.id) : undefined;
      if (
        !accepted ||
        !evaluation ||
        evaluation.verdict !== 'pass' ||
        evaluation.assetHash !== selectedAssetHash
      ) {
        throw new Error(
          `Production node "${node.id}" must pass persistent media evaluation before Final Export`,
        );
      }
    }
  }

  private requireStyleExplorationRun(workflowRunId: string, canvasId?: string): WorkflowRun {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (!run) throw new Error(`Workflow "${workflowRunId}" not found`);
    if (run.workflowType !== 'movie.production.v2') {
      throw new Error(`Workflow "${workflowRunId}" is not a persistent video workflow`);
    }
    if (canvasId !== undefined && (run.entityType !== 'canvas' || run.entityId !== canvasId)) {
      throw new Error(`Workflow "${workflowRunId}" is not bound to canvas "${canvasId}"`);
    }
    if (run.currentGate) {
      throw new Error(`Workflow "${workflowRunId}" is awaiting ${run.currentGate} approval`);
    }
    if (run.status !== WorkflowRunStatus.Ready || run.currentStageId !== 'style-exploration') {
      throw new Error(
        `Workflow "${workflowRunId}" is not ready for style exploration (status=${run.status}, stage=${run.currentStageId ?? 'none'})`,
      );
    }
    return run;
  }

  private requireExactApprovedDocument(
    workflowRunId: WorkflowRunId,
    gateKey: WorkflowApprovalGateKey,
  ): WorkflowDocument {
    const approval = this.wf.getLatestApproval(workflowRunId, gateKey);
    if (!approval || approval.status !== 'approved') {
      throw new Error(`Exact ${gateKey} approval is required`);
    }
    const document = this.wf.getDocumentRevision(
      workflowRunId,
      approval.subjectLogicalKey,
      approval.subjectRevision,
    );
    if (!document || document.contentHash !== approval.subjectHash) {
      throw new Error(`Approved ${gateKey} subject revision/hash is inconsistent`);
    }
    return document;
  }

  private createWorkflowDocument(
    workflowRunId: string,
    logicalKey: string,
    documentType: string,
    revision: number,
    content: Record<string, unknown>,
    createdAt: number,
  ): WorkflowDocument {
    return {
      id: this.nextId(),
      workflowRunId,
      logicalKey,
      documentType,
      revision,
      schemaVersion: 1,
      content,
      contentHash: sha256(canonicalJson(content)),
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    };
  }

  private nextTimestamp(): number {
    return this.now() + this.tick++;
  }

  private nextId(): string {
    return this.idFactory ? this.idFactory() : randomUUID();
  }

  private assertNotAwaitingHumanApproval(workflowRunId: string): void {
    const run = this.wf.getRun(this.runId(workflowRunId) as WorkflowRunId);
    if (run?.currentGate) {
      throw new Error(
        `Workflow "${workflowRunId}" requires human approval at ${run.currentGate}; resume and retry cannot bypass approval gates`,
      );
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer`);
  }
  return value;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative finite number`);
  }
  return value;
}

function requirePositiveFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

function validateFinalExportOutput(
  value:
    | Pick<FinalExportOutputSettings, 'codec' | 'quality' | 'width' | 'height' | 'fps'>
    | FinalExportOutputSettings,
  derivedLogicalFileName?: string,
): FinalExportOutputSettings {
  if (!value || typeof value !== 'object') {
    throw new TypeError('Final Export output settings are required');
  }
  const codec = value.codec;
  if (codec !== 'h264' && codec !== 'h265' && codec !== 'prores') {
    throw new TypeError('Final Export codec must be h264, h265, or prores');
  }
  const quality = value.quality;
  if (quality !== 'draft' && quality !== 'standard' && quality !== 'high') {
    throw new TypeError('Final Export quality must be draft, standard, or high');
  }
  const width = requirePositiveInteger(value.width, 'Final Export width');
  const height = requirePositiveInteger(value.height, 'Final Export height');
  if (width > 7680 || height > 7680 || width % 2 !== 0 || height % 2 !== 0) {
    throw new TypeError('Final Export dimensions must be even integers no larger than 7680');
  }
  const fps = requirePositiveInteger(value.fps, 'Final Export fps');
  if (fps < 12 || fps > 120) {
    throw new TypeError('Final Export fps must be between 12 and 120');
  }
  const container = codec === 'prores' ? 'mov' : 'mp4';
  if ('container' in value && value.container !== container) {
    throw new TypeError(`Final Export codec ${codec} requires the ${container} container`);
  }
  const logicalFileName =
    'logicalFileName' in value ? value.logicalFileName : derivedLogicalFileName;
  if (
    typeof logicalFileName !== 'string' ||
    logicalFileName.length === 0 ||
    logicalFileName.length > 180 ||
    /[\\/]/.test(logicalFileName) ||
    hasAsciiControlCharacter(logicalFileName) ||
    !logicalFileName.toLowerCase().endsWith(`.${container}`)
  ) {
    throw new TypeError(`Final Export logicalFileName must be a safe .${container} basename`);
  }
  const audioCodec = codec === 'prores' ? 'pcm_s24le' : 'aac';
  const pixelFormat = codec === 'prores' ? 'yuva444p10le' : 'yuv420p';
  if ('audioCodec' in value && value.audioCodec !== audioCodec) {
    throw new TypeError(`Final Export codec ${codec} requires audio codec ${audioCodec}`);
  }
  if ('pixelFormat' in value && value.pixelFormat !== pixelFormat) {
    throw new TypeError(`Final Export codec ${codec} requires pixel format ${pixelFormat}`);
  }
  if ('overwritePolicy' in value && value.overwritePolicy !== 'fail') {
    throw new TypeError('Final Export overwrite policy must be fail');
  }
  return {
    container,
    codec,
    quality,
    width,
    height,
    fps,
    logicalFileName,
    audioCodec,
    pixelFormat,
    overwritePolicy: 'fail',
  };
}

function buildFinalExportFileName(
  canvasName: string,
  codec: FinalExportOutputSettings['codec'],
): string {
  const container = codec === 'prores' ? 'mov' : 'mp4';
  const base = canvasName
    .normalize('NFKC')
    .split('')
    .map((character) =>
      hasAsciiControlCharacter(character) || /[\\/:*?"<>|]/.test(character) ? '-' : character,
    )
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 160);
  return `${base || 'lucid-final'}.${container}`;
}

function hasAsciiControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) <= 0x1f);
}

function requireScore(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new TypeError(`${label} must be a finite score from 0 to 100`);
  }
  return value;
}

function requireStringList(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === 'string' && entry.trim().length > 0)
  ) {
    throw new TypeError(`${label} must be an array of non-empty strings`);
  }
  return value;
}

function validateVisualCandidateProposals(candidates: VisualDirectionCandidateProposal[]): void {
  if (!Array.isArray(candidates) || candidates.length < 2 || candidates.length > 4) {
    throw new TypeError('Visual audition requires between 2 and 4 candidates');
  }
  const ids = new Set<string>();
  const grammarStringKeys: Array<keyof VisualDirectionCandidateProposal['constitution']> = [
    'medium',
    'era',
    'rendering',
    'linework',
    'palette',
    'lighting',
    'texture',
    'mood',
    'cameraGrammar',
    'lensGrammar',
    'compositionGrammar',
    'motionGrammar',
  ];
  for (const [index, candidate] of candidates.entries()) {
    if (!candidate || typeof candidate !== 'object') {
      throw new TypeError(`candidates[${index}] must be an object`);
    }
    const id = requireNonEmptyString(candidate.id, `candidates[${index}].id`);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw new TypeError(`candidates[${index}].id must use 1-64 letters, digits, _ or -`);
    }
    if (ids.has(id)) throw new TypeError(`Duplicate visual candidate id: ${id}`);
    ids.add(id);
    requireNonEmptyString(candidate.name, `candidates[${index}].name`);
    requireNonEmptyString(candidate.summary, `candidates[${index}].summary`);
    requireNonEmptyString(candidate.prompt, `candidates[${index}].prompt`);
    if (candidate.negativePrompt !== undefined) {
      requireNonEmptyString(candidate.negativePrompt, `candidates[${index}].negativePrompt`);
    }
    if (!Number.isInteger(candidate.seed) || candidate.seed < 0 || candidate.seed > 0xffff_ffff) {
      throw new TypeError(`candidates[${index}].seed must be a uint32 integer`);
    }
    if (!candidate.constitution || typeof candidate.constitution !== 'object') {
      throw new TypeError(`candidates[${index}].constitution is required`);
    }
    for (const key of grammarStringKeys) {
      requireNonEmptyString(
        candidate.constitution[key],
        `candidates[${index}].constitution.${key}`,
      );
    }
    requireStringList(
      candidate.constitution.characterAnchors,
      `candidates[${index}].constitution.characterAnchors`,
    );
    requireStringList(
      candidate.constitution.locationAnchors,
      `candidates[${index}].constitution.locationAnchors`,
    );
    requireStringList(
      candidate.constitution.negativeConstraints,
      `candidates[${index}].constitution.negativeConstraints`,
    );
  }
}

function proposalProjection(candidate: VisualAuditionCandidate): VisualDirectionCandidateProposal {
  return {
    id: candidate.id,
    name: candidate.name,
    summary: candidate.summary,
    prompt: candidate.prompt,
    ...(candidate.negativePrompt ? { negativePrompt: candidate.negativePrompt } : {}),
    seed: candidate.seed,
    constitution: candidate.constitution,
  };
}

function validateVisualAuditionSnapshot(
  content: VisualAuditionDocumentContent,
  previous: VisualAuditionDocumentContent,
  assetExists: (assetHash: string) => boolean,
): void {
  if (!content || typeof content !== 'object') {
    throw new TypeError('Visual audition snapshot must be an object');
  }
  for (const key of ['requestHash', 'rubricVersion', 'providerId'] as const) {
    if (content[key] !== previous[key]) {
      throw new Error(`Visual audition immutable field changed: ${key}`);
    }
  }
  if (
    content.width !== previous.width ||
    content.height !== previous.height ||
    canonicalJson(content.productionPlan) !== canonicalJson(previous.productionPlan)
  ) {
    throw new Error('Visual audition immutable plan or dimensions changed');
  }
  validateVisualCandidateProposals(content.candidates.map(proposalProjection));
  if (
    canonicalJson(content.candidates.map(proposalProjection)) !==
    canonicalJson(previous.candidates.map(proposalProjection))
  ) {
    throw new Error('Visual audition candidate proposals are immutable');
  }
  if (
    content.budget.approvedStyleAuditionCostUsd !== previous.budget.approvedStyleAuditionCostUsd ||
    content.budget.maxRegenerations !== previous.budget.maxRegenerations ||
    content.budget.maxAttemptsPerCandidate !== previous.budget.maxAttemptsPerCandidate
  ) {
    throw new Error('Visual audition approved budget bounds are immutable');
  }

  const approved = requireNonNegativeNumber(
    content.budget.approvedStyleAuditionCostUsd,
    'visual audition approved budget',
  );
  const estimated = requireNonNegativeNumber(
    content.budget.estimatedCommittedUsd,
    'visual audition estimated committed cost',
  );
  if (estimated > approved + 1e-9) {
    throw new Error(
      `Visual audition estimated cost ${estimated} exceeds approved budget ${approved}`,
    );
  }
  if (content.budget.reportedActualUsd !== undefined) {
    requireNonNegativeNumber(content.budget.reportedActualUsd, 'visual audition reported cost');
  }
  requireStringList(content.budget.unpricedOperations, 'visual audition unpricedOperations');

  let computedEstimated = 0;
  let computedReported = 0;
  let hasUnreported = false;
  let regenerationCount = 0;
  for (const candidate of content.candidates) {
    if (candidate.attempts.length > content.budget.maxAttemptsPerCandidate) {
      throw new Error(`Visual candidate "${candidate.id}" exceeded its approved attempt bound`);
    }
    const attemptNumbers = candidate.attempts.map((attempt) => attempt.attempt);
    regenerationCount += Math.max(0, candidate.attempts.length - 1);
    if (attemptNumbers.some((attempt, index) => attempt !== index + 1)) {
      throw new Error(`Visual candidate "${candidate.id}" attempts must be contiguous from 1`);
    }
    for (const attempt of candidate.attempts) {
      requireNonEmptyString(attempt.prompt, `${candidate.id} attempt prompt`);
      if (attempt.promptHash !== sha256(attempt.prompt)) {
        throw new Error(`Visual candidate "${candidate.id}" attempt prompt hash is invalid`);
      }
      if (attempt.providerId !== content.providerId) {
        throw new Error(`Visual candidate "${candidate.id}" changed provider`);
      }
      requirePositiveInteger(attempt.width, `${candidate.id} attempt width`);
      requirePositiveInteger(attempt.height, `${candidate.id} attempt height`);
      computedEstimated += requireNonNegativeNumber(
        attempt.estimatedCostUsd,
        `${candidate.id} estimated cost`,
      );
      if (attempt.reportedActualCostUsd === undefined) {
        hasUnreported = true;
      } else {
        computedReported += requireNonNegativeNumber(
          attempt.reportedActualCostUsd,
          `${candidate.id} reported cost`,
        );
      }
      if (attempt.status === 'completed') {
        if (!attempt.assetHash || !assetExists(attempt.assetHash)) {
          throw new Error(`Visual candidate "${candidate.id}" completed asset is missing`);
        }
        if (!attempt.grade) {
          throw new Error(`Visual candidate "${candidate.id}" completed attempt has no grade`);
        }
        for (const key of [
          'promptAdherence',
          'styleClarity',
          'storyFit',
          'lighting',
          'composition',
          'continuityPotential',
          'total',
        ] as const) {
          requireScore(attempt.grade[key], `${candidate.id} grade.${key}`);
        }
        if (attempt.grade.rubricVersion !== content.rubricVersion) {
          throw new Error(`Visual candidate "${candidate.id}" grade rubric is stale`);
        }
        requireStringList(attempt.grade.strengths, `${candidate.id} grade strengths`);
        requireStringList(attempt.grade.risks, `${candidate.id} grade risks`);
        requireNonEmptyString(attempt.grade.evidence, `${candidate.id} grade evidence`);
        requireNonEmptyString(
          attempt.grade.visionProviderId,
          `${candidate.id} grade vision provider`,
        );
      } else if (!attempt.error) {
        throw new Error(`Visual candidate "${candidate.id}" failed attempt has no error evidence`);
      }
    }
    if (candidate.status === 'completed') {
      const selected = candidate.attempts.find(
        (attempt) =>
          attempt.attempt === candidate.selectedAttempt && attempt.status === 'completed',
      );
      if (!selected) {
        throw new Error(`Visual candidate "${candidate.id}" has no selected completed attempt`);
      }
    }
  }
  if (regenerationCount > content.budget.maxRegenerations) {
    throw new Error('Visual audition exceeded the approved total regeneration bound');
  }
  if (Math.abs(computedEstimated - estimated) > 1e-6) {
    throw new Error('Visual audition estimated cost total does not match its attempts');
  }
  if (
    content.budget.reportedActualUsd !== undefined &&
    Math.abs(computedReported - content.budget.reportedActualUsd) > 1e-6
  ) {
    throw new Error('Visual audition reported cost total does not match its attempts');
  }
  if (content.budget.hasUnreportedActualCosts !== hasUnreported) {
    throw new Error('Visual audition unreported-cost marker does not match its attempts');
  }
  if (content.status === 'complete') {
    if (!content.candidates.every((candidate) => candidate.status === 'completed')) {
      throw new Error('A complete visual audition must have only completed candidates');
    }
    if (
      !content.recommendedCandidateId ||
      !content.candidates.some((candidate) => candidate.id === content.recommendedCandidateId)
    ) {
      throw new Error('A complete visual audition requires a valid recommendation');
    }
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Workflow documents must be JSON-serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${entries.join(',')}}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function nextStageForGate(gateKey: WorkflowApprovalGateKey): string {
  switch (gateKey) {
    case WorkflowApprovalGateKey.ProductionPlan:
      return 'style-exploration';
    case WorkflowApprovalGateKey.VisualConstitution:
      return 'media-generation';
    case WorkflowApprovalGateKey.FinalExport:
      return 'final-export';
  }
}
