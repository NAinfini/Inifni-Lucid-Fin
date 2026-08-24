import { getCommanderSessionId } from '@lucid-fin/contracts';
import type {
  AnswerTaskDecisionInput,
  AnswerTaskDecisionResult,
  ApprovePlanGateInput,
  ApprovePlanGateResult,
  RevisePlanGateInput,
  RevisePlanGateResult,
  ReserveTaskDecisionInput,
  ReserveTaskDecisionResult,
  PlanApproval,
  TaskDecision,
  TaskDecisionFilter,
  TaskList,
  TaskListSummary,
  Task,
  TaskArtifact,
  TaskArtifactSummary,
  PlanDocument,
  TaskEvent,
  DeliveryPackageTaskAttempt,
  ProductionMediaTaskAttempt,
  ProductionMediaTaskAttemptStatus,
  ProductionMediaGenerationSpec,
  TaskCostSummary,
  TaskEvaluation,
  TaskExecutionAttempt,
  TaskSummary,
  PromptAssemblyPurpose,
} from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

export interface PlanApprovalGateBundle {
  taskList: TaskList;
  tasks: Task[];
  document: PlanDocument;
  approval: PlanApproval;
  events: TaskEvent[];
}
/** Atomic append of a later approval-gate revision to an existing Task List. */
export interface PlanApprovalGateRevisionBundle {
  expectedRowVersion: number;
  document: PlanDocument;
  approval: PlanApproval;
  event: Omit<TaskEvent, 'seq'>;
  /**
   * A Production Plan revision may change shot topology before the first plan
   * approval. Rebind the still-unstarted downstream graph in the same CAS
   * transaction so task rows can never describe the rejected plan.
   */
  replacementGraph?: {
    tasks: Task[];
    taskListMetadata: Record<string, unknown>;
    invalidatedByRevision: number;
    updatedAt: number;
  };
}

export interface PlanApprovalGateRevisionResult {
  taskList: TaskList;
  event: TaskEvent;
}

export interface ReserveDeliveryPackageTaskAttemptInput {
  attempt: DeliveryPackageTaskAttempt;
}

export interface ReserveDeliveryPackageTaskAttemptResult {
  attempt: DeliveryPackageTaskAttempt;
  created: boolean;
}

export interface TransitionDeliveryPackageTaskAttemptInput {
  id: string;
  expectedRowVersion: number;
  expectedStatuses: DeliveryPackageTaskAttempt['status'][];
  status: DeliveryPackageTaskAttempt['status'];
  updatedAt: number;
  stagingPath?: string;
  packageHash?: string;
  packageBytes?: number;
  fileCount?: number;
  error?: string;
}

export interface CompleteDeliveryPackageTaskAttemptInput {
  id: string;
  expectedExecutionRowVersion: number;
  expectedTaskListRowVersion: number;
  packageHash: string;
  packageBytes: number;
  fileCount: number;
  completedAt: number;
  taskListOutput: Record<string, unknown>;
  event: Omit<TaskEvent, 'seq'>;
}

export interface ReserveProductionMediaTaskAttemptInput {
  attempt: ProductionMediaTaskAttempt;
  expectedTaskListRowVersion: number;
}

export interface ReserveTaskExecutionAttemptInput {
  attempt: TaskExecutionAttempt;
}

export interface TransitionTaskExecutionAttemptInput {
  id: string;
  expectedRowVersion: number;
  expectedStatuses: TaskExecutionAttempt['status'][];
  status: TaskExecutionAttempt['status'];
  output?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  providerJobId?: string;
  assetHash?: string;
  error?: string;
  updatedAt: number;
  submittedAt?: number;
  assetReadyAt?: number;
  completedAt?: number;
}

export interface ReserveProductionMediaTaskAttemptResult {
  attempt: ProductionMediaTaskAttempt;
  created: boolean;
}

export interface TransitionProductionMediaTaskAttemptInput {
  id: string;
  expectedRowVersion: number;
  expectedStatuses: ProductionMediaTaskAttemptStatus[];
  status: ProductionMediaTaskAttemptStatus;
  updatedAt: number;
  model?: string;
  providerJobId?: string;
  providerReceipt?: string;
  assetHash?: string;
  reportedActualCostUsd?: number;
  error?: string;
  submittedAt?: number;
  submissionStartedAt?: number;
  cancelRequestedAt?: number;
  assetReadyAt?: number;
  evaluatedAt?: number;
  completedAt?: number;
}

export interface BeginMediaSubmissionInput {
  attemptId: string;
  expectedAttemptRowVersion: number;
  promptAssemblyId: string;
  expectedPromptAssemblyRowVersion: number;
  artifactId: string;
  submissionStartedAt: number;
}

export interface BeginMediaSubmissionResult {
  attempt: ProductionMediaTaskAttempt;
  artifact: TaskArtifact;
  created: boolean;
}

export interface RecordMediaOutputInput {
  attemptId: string;
  expectedAttemptRowVersion: number;
  artifact: TaskArtifact;
  model: string;
  providerJobId?: string;
  providerReceipt: string;
  reportedActualCostUsd?: number;
  assetReadyAt: number;
}

export interface RecordMediaOutputResult {
  attempt: ProductionMediaTaskAttempt;
  artifact: TaskArtifact;
  created: boolean;
}

export interface RecordTaskEvaluationInput {
  evaluation: TaskEvaluation;
  expectedAttemptRowVersion: number;
  expectedAttemptStatuses: ProductionMediaTaskAttemptStatus[];
  resultingAttemptStatus: Extract<
    ProductionMediaTaskAttemptStatus,
    'accepted' | 'repair_required' | 'regenerate_required' | 'human_review'
  >;
  evaluatedAt: number;
}

export interface RecordTaskEvaluationResult {
  evaluation: TaskEvaluation;
  attempt: ProductionMediaTaskAttempt;
  created: boolean;
}

export interface CompleteExternalTaskInput {
  taskListId: string;
  taskId: string;
  expectedTaskListRowVersion: number;
  output: Record<string, unknown>;
  completedAt: number;
  event: Omit<TaskEvent, 'seq'>;
}

export interface CompleteExternalTaskResult {
  taskList: TaskList;
  task: Task;
  event: TaskEvent;
}

interface ReopenProductionMediaTaskInput {
  taskListId: string;
  canvasId: string;
  taskId: string;
  attemptId: string;
  expectedTaskListRowVersion: number;
  feedback: string;
  reopenedAt: number;
  event: Omit<TaskEvent, 'seq'>;
}

interface ReopenProductionMediaTaskResult {
  taskList: TaskList;
  task: Task;
  event: TaskEvent;
}

export interface ReserveProductionMediaFeedbackAttemptInput extends ReopenProductionMediaTaskInput {
  basePromptHash: string;
  attempt: ProductionMediaTaskAttempt;
}

export interface ReserveProductionMediaFeedbackAttemptResult extends ReopenProductionMediaTaskResult {
  attempt: ProductionMediaTaskAttempt;
  created: boolean;
}

// --- Task Lists ---

export function insertTaskList(db: BetterSqlite3.Database, taskList: TaskList): void {
  db.prepare(
    `
    INSERT INTO task_lists (
      id, task_list_type, entity_type, entity_id, trigger_source,
      status, summary, progress, completed_phases, total_phases,
      completed_tasks, total_tasks, current_phase_key, current_task_id,
      input_json, output_json, error_text, metadata_json,
      created_at, started_at, completed_at, updated_at,
      row_version, current_gate, engine_version, definition_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    taskList.id,
    taskList.taskListType,
    taskList.entityType,
    taskList.entityId ?? null,
    taskList.triggerSource,
    taskList.status,
    taskList.summary,
    taskList.progress,
    taskList.completedPhases,
    taskList.totalPhases,
    taskList.completedTasks,
    taskList.totalTasks,
    taskList.currentPhaseKey ?? null,
    taskList.currentTaskId ?? null,
    JSON.stringify(taskList.input),
    JSON.stringify(taskList.output),
    taskList.error ?? null,
    JSON.stringify(taskList.metadata),
    taskList.createdAt,
    taskList.startedAt ?? null,
    taskList.completedAt ?? null,
    taskList.updatedAt,
    taskList.rowVersion ?? 0,
    taskList.currentGate ?? null,
    taskList.engineVersion ?? 'legacy',
    taskList.definitionVersion ?? 1,
  );
}

export function getTaskList(db: BetterSqlite3.Database, id: string): TaskList | undefined {
  const row = db.prepare('SELECT * FROM task_lists WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToTaskList(row);
}

export function listTaskLists(
  db: BetterSqlite3.Database,
  filter?: {
    status?: string;
    taskListType?: string;
    entityType?: string;
    entityId?: string;
  },
): TaskList[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter?.taskListType) {
    conditions.push('task_list_type = ?');
    params.push(filter.taskListType);
  }
  if (filter?.entityType) {
    conditions.push('entity_type = ?');
    params.push(filter.entityType);
  }
  if (filter?.entityId) {
    conditions.push('entity_id = ?');
    params.push(filter.entityId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM task_lists ${where} ORDER BY updated_at DESC, created_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToTaskList(row));
}

export function getTaskListSummary(
  db: BetterSqlite3.Database,
  id: string,
): TaskListSummary | undefined {
  return listTaskListSummaries(db, { id })[0];
}

export function listTaskListSummaries(
  db: BetterSqlite3.Database,
  filter?: {
    id?: string;
    status?: string;
    taskListType?: string;
    entityType?: string;
    entityId?: string;
  },
): TaskListSummary[] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter?.id) {
    conditions.push('w.id = ?');
    params.push(filter.id);
  }
  if (filter?.status) {
    conditions.push('w.status = ?');
    params.push(filter.status);
  }
  if (filter?.taskListType) {
    conditions.push('w.task_list_type = ?');
    params.push(filter.taskListType);
  }
  if (filter?.entityType) {
    conditions.push('w.entity_type = ?');
    params.push(filter.entityType);
  }
  if (filter?.entityId) {
    conditions.push('w.entity_id = ?');
    params.push(filter.entityId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT w.* FROM task_lists w ${where} ORDER BY w.updated_at DESC, w.created_at DESC`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const artifactRows = db
    .prepare(
      `SELECT a.* FROM task_artifacts a
       JOIN task_lists w ON w.id = a.task_list_id
       ${where}
       ORDER BY a.created_at ASC, a.id ASC`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  const artifactsByTaskListId = new Map<string, TaskArtifact[]>();
  for (const artifactRow of artifactRows) {
    const artifact = rowToTaskArtifact(artifactRow);
    const current = artifactsByTaskListId.get(artifact.taskListId);
    if (current) current.push(artifact);
    else artifactsByTaskListId.set(artifact.taskListId, [artifact]);
  }
  return rows.map((row) => rowToTaskListSummary(row, artifactsByTaskListId));
}

export function updateTaskList(
  db: BetterSqlite3.Database,
  id: string,
  updates: Partial<
    Pick<
      TaskList,
      | 'status'
      | 'summary'
      | 'progress'
      | 'completedPhases'
      | 'totalPhases'
      | 'completedTasks'
      | 'totalTasks'
      | 'currentPhaseKey'
      | 'currentTaskId'
      | 'input'
      | 'output'
      | 'error'
      | 'metadata'
      | 'startedAt'
      | 'completedAt'
      | 'updatedAt'
    >
  >,
): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    params.push(updates.status);
  }
  if (updates.summary !== undefined) {
    sets.push('summary = ?');
    params.push(updates.summary);
  }
  if (updates.progress !== undefined) {
    sets.push('progress = ?');
    params.push(updates.progress);
  }
  if (updates.completedPhases !== undefined) {
    sets.push('completed_phases = ?');
    params.push(updates.completedPhases);
  }
  if (updates.totalPhases !== undefined) {
    sets.push('total_phases = ?');
    params.push(updates.totalPhases);
  }
  if (updates.completedTasks !== undefined) {
    sets.push('completed_tasks = ?');
    params.push(updates.completedTasks);
  }
  if (updates.totalTasks !== undefined) {
    sets.push('total_tasks = ?');
    params.push(updates.totalTasks);
  }
  if (updates.currentPhaseKey !== undefined) {
    sets.push('current_phase_key = ?');
    params.push(updates.currentPhaseKey ?? null);
  } else if (
    updates.status === 'completed' ||
    updates.status === 'completed_with_errors' ||
    updates.status === 'cancelled'
  ) {
    sets.push('current_phase_key = NULL');
  }
  if (updates.currentTaskId !== undefined) {
    sets.push('current_task_id = ?');
    params.push(updates.currentTaskId ?? null);
  } else if (
    updates.status === 'completed' ||
    updates.status === 'completed_with_errors' ||
    updates.status === 'cancelled'
  ) {
    sets.push('current_task_id = NULL');
  }
  if (updates.input !== undefined) {
    sets.push('input_json = ?');
    params.push(JSON.stringify(updates.input));
  }
  if (updates.output !== undefined) {
    sets.push('output_json = ?');
    params.push(JSON.stringify(updates.output));
  }
  if (updates.error !== undefined) {
    sets.push('error_text = ?');
    params.push(updates.error);
  }
  if (updates.metadata !== undefined) {
    sets.push('metadata_json = ?');
    params.push(JSON.stringify(updates.metadata));
  }
  if (updates.startedAt !== undefined) {
    sets.push('started_at = ?');
    params.push(updates.startedAt);
  }
  if (updates.completedAt !== undefined) {
    sets.push('completed_at = ?');
    params.push(updates.completedAt);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    params.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE task_lists SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

/** Optimistically replace Task List metadata while advancing the aggregate version. */
export function compareAndSetTaskListMetadata(
  db: BetterSqlite3.Database,
  id: string,
  expectedRowVersion: number,
  metadata: Record<string, unknown>,
  updatedAt: number,
): boolean {
  const result = db
    .prepare(
      `UPDATE task_lists
       SET metadata_json = ?, row_version = row_version + 1, updated_at = ?
       WHERE id = ? AND row_version = ?`,
    )
    .run(JSON.stringify(metadata), updatedAt, id, expectedRowVersion);
  return result.changes === 1;
}

// --- Persistent TaskList Documents, Approvals, and Events ---

export function insertPlanDocument(db: BetterSqlite3.Database, document: PlanDocument): void {
  db.prepare(
    `INSERT INTO plan_documents (
       id, task_list_id, logical_key, document_type, revision, schema_version,
       content_json, content_hash, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    document.id,
    document.taskListId,
    document.logicalKey,
    document.documentType,
    document.revision,
    document.schemaVersion,
    JSON.stringify(document.content),
    document.contentHash,
    document.status,
    document.createdAt,
    document.updatedAt,
  );
}

export function getLatestPlanDocument(
  db: BetterSqlite3.Database,
  taskListId: string,
  logicalKey: string,
): PlanDocument | undefined {
  const row = db
    .prepare(
      `SELECT * FROM plan_documents
       WHERE task_list_id = ? AND logical_key = ?
       ORDER BY revision DESC
       LIMIT 1`,
    )
    .get(taskListId, logicalKey) as Record<string, unknown> | undefined;
  return row ? rowToPlanDocument(row) : undefined;
}

export function getPlanDocumentRevision(
  db: BetterSqlite3.Database,
  taskListId: string,
  logicalKey: string,
  revision: number,
): PlanDocument | undefined {
  const row = db
    .prepare(
      `SELECT * FROM plan_documents
       WHERE task_list_id = ? AND logical_key = ? AND revision = ?
       LIMIT 1`,
    )
    .get(taskListId, logicalKey, revision) as Record<string, unknown> | undefined;
  return row ? rowToPlanDocument(row) : undefined;
}

export function insertPendingPlanApproval(
  db: BetterSqlite3.Database,
  approval: PlanApproval,
): void {
  if (approval.status !== 'pending') {
    throw new TypeError('A newly created task list approval must have pending status');
  }

  const create = db.transaction(() => {
    const subject = db
      .prepare(
        `SELECT content_hash FROM plan_documents
         WHERE task_list_id = ? AND logical_key = ? AND revision = ?`,
      )
      .get(approval.taskListId, approval.subjectLogicalKey, approval.subjectRevision) as
      { content_hash: string } | undefined;

    if (!subject) {
      throw new Error('TaskList approval subject revision does not exist');
    }
    if (subject.content_hash !== approval.subjectHash) {
      throw new Error('TaskList approval subject hash does not match the stored document');
    }

    db.prepare(
      `UPDATE plan_approvals
       SET status = 'invalidated', decided_at = ?, updated_at = ?
       WHERE task_list_id = ? AND gate_key = ? AND status = 'pending'`,
    ).run(approval.createdAt, approval.updatedAt, approval.taskListId, approval.gateKey);

    db.prepare(
      `INSERT INTO plan_approvals (
         id, task_list_id, gate_key, subject_logical_key, subject_revision,
         subject_hash, manifest_hash, resume_token_hash, status,
         created_at, updated_at, decided_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      approval.id,
      approval.taskListId,
      approval.gateKey,
      approval.subjectLogicalKey,
      approval.subjectRevision,
      approval.subjectHash,
      approval.manifestHash,
      approval.resumeTokenHash,
      approval.status,
      approval.createdAt,
      approval.updatedAt,
      approval.decidedAt ?? null,
    );

    const changed = db
      .prepare(
        `UPDATE task_lists
         SET current_gate = ?, status = 'awaiting_approval', row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND (current_gate IS NULL OR current_gate = ?)`,
      )
      .run(approval.gateKey, approval.updatedAt, approval.taskListId, approval.gateKey).changes;
    if (changed !== 1) {
      throw new Error('Task List is missing or blocked at a different approval gate');
    }
  });

  create.immediate();
}

/**
 * Atomically creates a new task list aggregate and its first approval gate.
 * This is the durable boundary used by Commander: no partial Task List, document,
 * approval, or event rows survive if any insert fails.
 */
export function insertPlanApprovalGateBundle(
  db: BetterSqlite3.Database,
  bundle: PlanApprovalGateBundle,
): void {
  const create = db.transaction(() => {
    if (
      bundle.document.taskListId !== bundle.taskList.id ||
      bundle.approval.taskListId !== bundle.taskList.id ||
      bundle.tasks.some((task) => task.taskListId !== bundle.taskList.id) ||
      bundle.events.some((event) => event.taskListId !== bundle.taskList.id)
    ) {
      throw new Error('Task List approval-gate bundle contains mismatched Task List IDs');
    }

    const taskIds = new Set(bundle.tasks.map((task) => task.id));
    if (taskIds.size !== bundle.tasks.length) {
      throw new Error('TaskList approval-gate bundle contains duplicate graph IDs');
    }
    if (
      bundle.taskList.currentPhaseKey &&
      !bundle.tasks.some((task) => task.phaseKey === bundle.taskList.currentPhaseKey)
    ) {
      throw new Error('TaskList currentPhaseKey must reference an inserted task phase');
    }
    if (bundle.taskList.currentTaskId && !taskIds.has(bundle.taskList.currentTaskId)) {
      throw new Error('Task List currentTaskId must reference an inserted Task');
    }
    for (const task of bundle.tasks) {
      if (!Array.isArray(task.dependencyIds)) {
        throw new Error(`Task ${task.id} is missing canonical dependencyIds`);
      }
    }
    if (
      bundle.tasks.some((task) =>
        task.dependencyIds.some(
          (dependencyId) => dependencyId === task.id || !taskIds.has(dependencyId),
        ),
      )
    ) {
      throw new Error('TaskList task dependency references an invalid task in its aggregate');
    }

    const expectedSequences = bundle.events.map((_event, index) => index + 1);
    if (bundle.events.some((event, index) => event.seq !== expectedSequences[index])) {
      throw new Error('Initial task list events must use contiguous sequences beginning at 1');
    }

    insertTaskList(db, bundle.taskList);
    for (const task of bundle.tasks) insertTask(db, task);
    insertPlanDocument(db, bundle.document);
    insertPendingPlanApproval(db, bundle.approval);
    for (const event of bundle.events) insertTaskEvent(db, event);
  });

  create.immediate();
}

/**
 * Atomically appends an immutable document, replaces the pending approval for
 * that gate, CAS-advances the Task List, and writes the next contiguous event.
 */
export function insertPlanApprovalGateRevision(
  db: BetterSqlite3.Database,
  bundle: PlanApprovalGateRevisionBundle,
): PlanApprovalGateRevisionResult {
  const create = db.transaction((): PlanApprovalGateRevisionResult => {
    const { document, approval } = bundle;
    if (
      document.taskListId !== approval.taskListId ||
      document.taskListId !== bundle.event.taskListId
    ) {
      throw new Error('Task List gate revision contains mismatched Task List IDs');
    }
    if (
      approval.status !== 'pending' ||
      approval.subjectLogicalKey !== document.logicalKey ||
      approval.subjectRevision !== document.revision ||
      approval.subjectHash !== document.contentHash
    ) {
      throw new Error('TaskList gate revision approval does not match its immutable subject');
    }

    const taskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(document.taskListId) as Record<string, unknown> | undefined;
    if (!taskListRow) throw new Error(`TaskList "${document.taskListId}" not found`);
    const actualRowVersion = Number(taskListRow.row_version ?? 0);
    if (actualRowVersion !== bundle.expectedRowVersion) {
      throw new Error(
        `TaskList row version changed: expected ${bundle.expectedRowVersion}, got ${actualRowVersion}`,
      );
    }
    const currentGate =
      taskListRow.current_gate == null ? undefined : String(taskListRow.current_gate);
    if (currentGate && currentGate !== approval.gateKey) {
      throw new Error(`TaskList is blocked at a different approval gate: ${currentGate}`);
    }

    if (bundle.replacementGraph) {
      replaceUnstartedProductionGraph(
        db,
        document.taskListId,
        approval.gateKey,
        bundle.replacementGraph,
      );
    }

    const latestRevisionRow = db
      .prepare(
        `SELECT COALESCE(MAX(revision), 0) AS latest_revision
         FROM plan_documents
         WHERE task_list_id = ? AND logical_key = ?`,
      )
      .get(document.taskListId, document.logicalKey) as { latest_revision: number };
    const expectedRevision = Number(latestRevisionRow.latest_revision) + 1;
    if (document.revision !== expectedRevision) {
      throw new Error(
        `TaskList document revision changed: expected ${expectedRevision}, got ${document.revision}`,
      );
    }

    insertPlanDocument(db, document);
    db.prepare(
      `UPDATE plan_approvals
       SET status = 'invalidated', decided_at = ?, updated_at = ?
       WHERE task_list_id = ? AND gate_key = ? AND status = 'pending'`,
    ).run(approval.createdAt, approval.updatedAt, approval.taskListId, approval.gateKey);
    db.prepare(
      `INSERT INTO plan_approvals (
         id, task_list_id, gate_key, subject_logical_key, subject_revision,
         subject_hash, manifest_hash, resume_token_hash, status,
         created_at, updated_at, decided_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      approval.id,
      approval.taskListId,
      approval.gateKey,
      approval.subjectLogicalKey,
      approval.subjectRevision,
      approval.subjectHash,
      approval.manifestHash,
      approval.resumeTokenHash,
      approval.status,
      approval.createdAt,
      approval.updatedAt,
      approval.decidedAt ?? null,
    );

    const changed = db
      .prepare(
        `UPDATE task_lists
         SET current_gate = ?, status = 'awaiting_approval',
             metadata_json = COALESCE(?, metadata_json),
             total_tasks = COALESCE(?, total_tasks),
             row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ?
           AND (current_gate IS NULL OR current_gate = ?)`,
      )
      .run(
        approval.gateKey,
        bundle.replacementGraph ? JSON.stringify(bundle.replacementGraph.taskListMetadata) : null,
        bundle.replacementGraph ? bundle.replacementGraph.tasks.length + 1 : null,
        approval.updatedAt,
        approval.taskListId,
        bundle.expectedRowVersion,
        approval.gateKey,
      ).changes;
    if (changed !== 1) throw new Error('Task List changed inside gate transaction');

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_list_id = ?',
      )
      .get(document.taskListId) as { next_seq: number };
    const event: TaskEvent = { ...bundle.event, seq: Number(seqRow.next_seq) };
    insertTaskEvent(db, event);

    const updatedTaskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(document.taskListId) as Record<string, unknown>;
    return { taskList: rowToTaskList(updatedTaskListRow), event };
  });

  return create.immediate();
}

function replaceUnstartedProductionGraph(
  db: BetterSqlite3.Database,
  taskListId: string,
  gateKey: PlanApproval['gateKey'],
  graph: NonNullable<PlanApprovalGateRevisionBundle['replacementGraph']>,
): void {
  if (gateKey !== 'production_plan') {
    throw new Error('Only a Production Plan revision may replace the unstarted production graph');
  }
  if (
    graph.invalidatedByRevision < 2 ||
    graph.tasks.some(
      (task) => task.taskListId !== taskListId || task.phaseKey === 'production-plan',
    )
  ) {
    throw new Error('Replacement production graph is not bound to the revised task list');
  }

  const producerRow = db
    .prepare(
      `SELECT tasks.* FROM tasks
       WHERE tasks.task_list_id = ?
         AND tasks.phase_key = 'production-plan'
         AND tasks.task_key = 'production-plan'
       LIMIT 1`,
    )
    .get(taskListId) as Record<string, unknown> | undefined;
  if (!producerRow) throw new Error('Production Plan producer task is missing');
  const producerTask = rowToTask(db, producerRow);

  const desiredTaskIds = new Set(graph.tasks.map((task) => task.id));
  if (desiredTaskIds.size !== graph.tasks.length || desiredTaskIds.has(producerTask.id)) {
    throw new Error('Replacement production graph contains duplicate or producer task IDs');
  }
  for (const task of graph.tasks) {
    if (!Array.isArray(task.dependencyIds)) {
      throw new Error(`Replacement task ${task.id} is missing canonical dependencyIds`);
    }
  }
  if (
    graph.tasks.some((task) =>
      task.dependencyIds.some(
        (dependencyId) =>
          dependencyId === task.id ||
          (!desiredTaskIds.has(dependencyId) && dependencyId !== producerTask.id),
      ),
    )
  ) {
    throw new Error('Replacement production graph contains an invalid task dependency');
  }

  const downstreamSideEffects = db
    .prepare(
      `SELECT
         EXISTS(
           SELECT 1 FROM task_attempts
            WHERE task_list_id = ?
              AND (task_id IS NULL OR task_id <> ?)
         ) OR EXISTS(
           SELECT 1 FROM task_decisions
            WHERE task_list_id = ? AND task_id <> ?
         ) OR EXISTS(
           SELECT 1 FROM task_artifacts
            WHERE task_list_id = ? AND task_id <> ?
         ) AS found`,
    )
    .get(
      taskListId,
      producerTask.id,
      taskListId,
      producerTask.id,
      taskListId,
      producerTask.id,
    ) as { found: number };
  if (Number(downstreamSideEffects.found) !== 0) {
    throw new Error('A Production Plan with downstream side effects cannot replace its task graph');
  }

  const activeTaskRows = db
    .prepare(
      `SELECT tasks.* FROM tasks
       WHERE tasks.task_list_id = ?
         AND tasks.phase_key <> 'production-plan'
         AND json_extract(tasks.input_json, '$.invalidatedByPlanRevision') IS NULL`,
    )
    .all(taskListId) as Array<Record<string, unknown>>;
  const activeTasks = activeTaskRows.map((row) => rowToTask(db, row));
  if (
    activeTasks.some(
      (task) =>
        (task.status !== 'blocked' && task.status !== 'pending' && task.status !== 'skipped') ||
        task.attempts !== 0 ||
        task.progress !== 0 ||
        task.providerTaskId !== undefined ||
        task.assetId !== undefined ||
        Object.keys(task.output).length > 0,
    )
  ) {
    throw new Error('Only an unstarted downstream production graph can be replaced');
  }

  const existingById = new Map(activeTasks.map((task) => [task.id, task]));
  for (const task of graph.tasks) {
    const existing = existingById.get(task.id);
    if (existing) {
      const changed = db
        .prepare(
          `UPDATE tasks
           SET phase_key = ?, phase_name = ?, phase_order = ?, task_key = ?,
               name = ?, kind = ?, status = ?, provider = ?,
               dependency_ids_json = ?, attempts = 0, max_retries = ?, input_json = ?,
               output_json = '{}', provider_task_id = NULL, asset_id = NULL, error_text = NULL,
               progress = 0, current_step = NULL, started_at = NULL, completed_at = NULL,
               updated_at = ?
           WHERE id = ? AND task_list_id = ?`,
        )
        .run(
          task.phaseKey,
          task.phaseName,
          task.phaseOrder,
          task.taskKey,
          task.name,
          task.kind,
          task.status,
          task.provider ?? null,
          JSON.stringify(task.dependencyIds),
          task.maxRetries,
          JSON.stringify(task.input),
          graph.updatedAt,
          task.id,
          taskListId,
        ).changes;
      if (changed !== 1) throw new Error(`Replacement task "${task.taskKey}" changed`);
      replaceTaskDependencies(db, task.id, task.dependencyIds);
    } else {
      insertTask(db, task);
    }
  }

  for (const task of activeTasks) {
    if (desiredTaskIds.has(task.id)) continue;
    replaceTaskDependencies(db, task.id, []);
    db.prepare(
      `UPDATE tasks
       SET status = 'skipped', input_json = ?, output_json = '{}', progress = 100,
           current_step = 'invalidated_by_plan_revision', completed_at = ?, updated_at = ?
       WHERE id = ? AND task_list_id = ?`,
    ).run(
      JSON.stringify({
        ...task.input,
        invalidatedByPlanRevision: graph.invalidatedByRevision,
      }),
      graph.updatedAt,
      graph.updatedAt,
      task.id,
      taskListId,
    );
  }
}

export function getPendingPlanApproval(
  db: BetterSqlite3.Database,
  taskListId: string,
  gateKey: PlanApproval['gateKey'],
): PlanApproval | undefined {
  const row = db
    .prepare(
      `SELECT * FROM plan_approvals
       WHERE task_list_id = ? AND gate_key = ? AND status = 'pending'
       ORDER BY subject_revision DESC, created_at DESC
       LIMIT 1`,
    )
    .get(taskListId, gateKey) as Record<string, unknown> | undefined;
  return row ? rowToPlanApproval(row) : undefined;
}

export function getLatestPlanApproval(
  db: BetterSqlite3.Database,
  taskListId: string,
  gateKey: PlanApproval['gateKey'],
): PlanApproval | undefined {
  const row = db
    .prepare(
      `SELECT * FROM plan_approvals
       WHERE task_list_id = ? AND gate_key = ?
       ORDER BY subject_revision DESC, created_at DESC
       LIMIT 1`,
    )
    .get(taskListId, gateKey) as Record<string, unknown> | undefined;
  return row ? rowToPlanApproval(row) : undefined;
}

export function approvePlanGate(
  db: BetterSqlite3.Database,
  input: ApprovePlanGateInput,
): ApprovePlanGateResult {
  const approve = db.transaction((): ApprovePlanGateResult => {
    const taskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(input.taskListId) as Record<string, unknown> | undefined;
    if (!taskListRow) {
      return { ok: false, code: 'task_list_not_found' };
    }

    const approvalRow = db
      .prepare(
        `SELECT * FROM plan_approvals
         WHERE task_list_id = ? AND gate_key = ?
         ORDER BY subject_revision DESC, created_at DESC
         LIMIT 1`,
      )
      .get(input.taskListId, input.gateKey) as Record<string, unknown> | undefined;
    if (!approvalRow) {
      return { ok: false, code: 'no_approval' };
    }

    const approval = rowToPlanApproval(approvalRow);
    if (approval.status === 'approved') {
      return { ok: false, code: 'already_approved', approval };
    }
    if (approval.status !== 'pending') {
      return { ok: false, code: 'approval_not_pending', status: approval.status };
    }

    const actualGate =
      taskListRow.current_gate == null
        ? undefined
        : (String(taskListRow.current_gate) as PlanApproval['gateKey']);
    if (actualGate !== input.gateKey) {
      return { ok: false, code: 'gate_not_current', actualGate };
    }

    const actualRowVersion = Number(taskListRow.row_version ?? 0);
    if (actualRowVersion !== input.expectedRowVersion) {
      return { ok: false, code: 'stale_row_version', actualRowVersion };
    }
    if (approval.subjectRevision !== input.expectedSubjectRevision) {
      return {
        ok: false,
        code: 'stale_subject_revision',
        actualSubjectRevision: approval.subjectRevision,
      };
    }
    if (approval.subjectHash !== input.expectedSubjectHash) {
      return { ok: false, code: 'subject_hash_mismatch' };
    }
    if (approval.resumeTokenHash !== input.resumeTokenHash) {
      return { ok: false, code: 'resume_token_mismatch' };
    }

    const approvalUpdated = db
      .prepare(
        `UPDATE plan_approvals
         SET status = 'approved', decided_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(input.approvedAt, input.approvedAt, approval.id).changes;
    if (approvalUpdated !== 1) {
      return { ok: false, code: 'already_approved', approval };
    }

    if (input.completedProducerTaskId) {
      const producerRow = db
        .prepare('SELECT * FROM tasks WHERE id = ? AND task_list_id = ?')
        .get(input.completedProducerTaskId, input.taskListId) as
        Record<string, unknown> | undefined;
      if (!producerRow) throw new Error('TaskList gate producer task does not exist');
      const producer = rowToTask(db, producerRow);
      if (producer.input.executionMode !== 'external') {
        throw new Error('TaskList gate producer must be an external task');
      }
      if (producer.status !== 'completed') {
        const producerUpdated = db
          .prepare(
            `UPDATE tasks
             SET status = 'completed', progress = 100, current_step = 'approved',
                 error_text = NULL, completed_at = ?, updated_at = ?
             WHERE id = ? AND task_list_id = ? AND status <> 'completed'`,
          )
          .run(input.approvedAt, input.approvedAt, producer.id, input.taskListId).changes;
        if (producerUpdated !== 1) {
          throw new Error(
            `TaskList gate producer cannot complete from status "${producer.status}"`,
          );
        }
      }
      recomputePhaseAggregate(db, producer.taskListId, producer.phaseKey);
    }

    const taskListUpdated = db
      .prepare(
        `UPDATE task_lists
         SET current_gate = NULL, status = 'ready',
             current_phase_key = COALESCE(?, current_phase_key),
             current_task_id = COALESCE(?, current_task_id),
             row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ? AND current_gate = ?`,
      )
      .run(
        input.nextPhaseKey ?? null,
        input.nextTaskId ?? null,
        input.approvedAt,
        input.taskListId,
        input.expectedRowVersion,
        input.gateKey,
      ).changes;
    if (taskListUpdated !== 1) {
      throw new Error('Task List changed inside approval transaction');
    }

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_list_id = ?',
      )
      .get(input.taskListId) as { next_seq: number };
    const event: TaskEvent = {
      taskListId: input.taskListId,
      seq: Number(seqRow.next_seq),
      eventId: input.eventId,
      actor: input.actor,
      correlationId: input.correlationId,
      causationId: input.causationId,
      payload: {
        type: 'task_list.gate.approved',
        gateKey: input.gateKey,
        approvalId: approval.id,
        subjectLogicalKey: approval.subjectLogicalKey,
        subjectRevision: approval.subjectRevision,
        subjectHash: approval.subjectHash,
        manifestHash: approval.manifestHash,
      },
      timestamp: input.approvedAt,
    };
    insertTaskEvent(db, event);

    const updatedTaskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(input.taskListId) as Record<string, unknown>;
    const updatedApprovalRow = db
      .prepare('SELECT * FROM plan_approvals WHERE id = ?')
      .get(approval.id) as Record<string, unknown>;

    return {
      ok: true,
      code: 'approved',
      taskList: rowToTaskList(updatedTaskListRow),
      approval: rowToPlanApproval(updatedApprovalRow),
      event,
    };
  });

  return approve.immediate();
}

/** Reject the exact subject and reopen its external producer task atomically. */
export function revisePlanGate(
  db: BetterSqlite3.Database,
  input: RevisePlanGateInput,
): RevisePlanGateResult {
  const reason = input.reason.trim();
  if (!reason) throw new TypeError('TaskList gate revision reason must not be empty');

  const revise = db.transaction((): RevisePlanGateResult => {
    const taskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(input.taskListId) as Record<string, unknown> | undefined;
    if (!taskListRow) return { ok: false, code: 'task_list_not_found' };

    const actualGate =
      taskListRow.current_gate == null
        ? undefined
        : (String(taskListRow.current_gate) as PlanApproval['gateKey']);
    if (actualGate !== input.gateKey) {
      return { ok: false, code: 'gate_not_current', actualGate };
    }

    const actualRowVersion = Number(taskListRow.row_version ?? 0);
    if (actualRowVersion !== input.expectedRowVersion) {
      return { ok: false, code: 'stale_row_version', actualRowVersion };
    }

    const approvalRow = db
      .prepare(
        `SELECT * FROM plan_approvals
         WHERE task_list_id = ? AND gate_key = ?
         ORDER BY subject_revision DESC, created_at DESC
         LIMIT 1`,
      )
      .get(input.taskListId, input.gateKey) as Record<string, unknown> | undefined;
    if (!approvalRow) return { ok: false, code: 'no_approval' };
    const previousApproval = rowToPlanApproval(approvalRow);
    if (previousApproval.status !== 'pending') {
      return {
        ok: false,
        code: 'approval_not_pending',
        status: previousApproval.status,
      };
    }
    if (previousApproval.subjectRevision !== input.expectedSubjectRevision) {
      return {
        ok: false,
        code: 'stale_subject_revision',
        actualSubjectRevision: previousApproval.subjectRevision,
      };
    }
    if (previousApproval.subjectHash !== input.expectedSubjectHash) {
      return { ok: false, code: 'subject_hash_mismatch' };
    }

    const previousDocumentRow = db
      .prepare(
        `SELECT * FROM plan_documents
         WHERE task_list_id = ? AND logical_key = ? AND revision = ?`,
      )
      .get(
        input.taskListId,
        previousApproval.subjectLogicalKey,
        previousApproval.subjectRevision,
      ) as Record<string, unknown> | undefined;
    if (!previousDocumentRow) {
      throw new Error('Pending task list approval has no immutable subject document');
    }
    const previousDocument = rowToPlanDocument(previousDocumentRow);
    const producerTaskRow = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND task_list_id = ?')
      .get(input.producerTaskId, input.taskListId) as Record<string, unknown> | undefined;
    if (!producerTaskRow) throw new Error('TaskList gate producer task does not exist');
    const producerTask = rowToTask(db, producerTaskRow);
    const revisionRequest = {
      action: input.action,
      reason,
      previousRevision: previousDocument.revision,
      requestedAt: input.revisedAt,
    };

    const approvalUpdated = db
      .prepare(
        `UPDATE plan_approvals
         SET status = 'rejected', decided_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(input.revisedAt, input.revisedAt, previousApproval.id).changes;
    if (approvalUpdated !== 1) {
      throw new Error('Pending task list approval changed inside revision transaction');
    }

    const producerUpdated = db
      .prepare(
        `UPDATE tasks
         SET status = 'ready', input_json = ?, output_json = '{}', error_text = NULL,
             progress = 0, current_step = 'revision_requested', completed_at = NULL,
             updated_at = ?
         WHERE id = ? AND task_list_id = ?`,
      )
      .run(
        JSON.stringify({ ...producerTask.input, revisionRequest }),
        input.revisedAt,
        producerTask.id,
        input.taskListId,
      ).changes;
    if (producerUpdated !== 1) throw new Error('TaskList gate producer task changed');

    const taskListUpdated = db
      .prepare(
        `UPDATE task_lists
         SET status = 'ready', current_gate = NULL,
             current_phase_key = ?, current_task_id = ?,
             row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ? AND current_gate = ?`,
      )
      .run(
        producerTask.phaseKey,
        producerTask.id,
        input.revisedAt,
        input.taskListId,
        input.expectedRowVersion,
        input.gateKey,
      ).changes;
    if (taskListUpdated !== 1) {
      throw new Error('Task List changed inside gate revision transaction');
    }

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_list_id = ?',
      )
      .get(input.taskListId) as { next_seq: number };
    const event: TaskEvent = {
      taskListId: input.taskListId,
      seq: Number(seqRow.next_seq),
      eventId: input.eventId,
      actor: input.actor,
      correlationId: input.correlationId,
      causationId: input.causationId,
      payload: {
        type:
          input.action === 'request_changes'
            ? 'task_list.gate.changes_requested'
            : 'task_list.gate.rejected',
        gateKey: input.gateKey,
        reason,
        previousApprovalId: previousApproval.id,
        previousSubjectRevision: previousApproval.subjectRevision,
        subjectLogicalKey: previousDocument.logicalKey,
        requestedSubjectRevision: previousDocument.revision + 1,
        producerTaskId: producerTask.id,
      },
      timestamp: input.revisedAt,
    };
    insertTaskEvent(db, event);

    const updatedTaskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(input.taskListId) as Record<string, unknown>;
    const updatedPreviousApprovalRow = db
      .prepare('SELECT * FROM plan_approvals WHERE id = ?')
      .get(previousApproval.id) as Record<string, unknown>;
    const updatedProducerTaskRow = db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(producerTask.id) as Record<string, unknown>;

    return {
      ok: true,
      code: 'revision_requested',
      taskList: rowToTaskList(updatedTaskListRow),
      previousApproval: rowToPlanApproval(updatedPreviousApprovalRow),
      producerTask: rowToTask(db, updatedProducerTaskRow),
      event,
    };
  });

  return revise.immediate();
}

export function listTaskEvents(db: BetterSqlite3.Database, taskListId: string): TaskEvent[] {
  const rows = db
    .prepare('SELECT * FROM task_events WHERE task_list_id = ? ORDER BY seq ASC')
    .all(taskListId) as Array<Record<string, unknown>>;
  return rows.map(rowToTaskEvent);
}

// --- Durable task list-bound AskUser decisions ---

export function reserveTaskDecision(
  db: BetterSqlite3.Database,
  input: ReserveTaskDecisionInput,
): ReserveTaskDecisionResult {
  const reserve = db.transaction((): ReserveTaskDecisionResult => {
    const proposed = input.decision;
    const decisionKey = proposed.decisionKey.trim();
    const question = proposed.question.trim();
    if (
      !decisionKey ||
      !question ||
      proposed.status !== 'pending' ||
      proposed.rowVersion !== 0 ||
      proposed.answer !== undefined ||
      proposed.answeredAt !== undefined ||
      proposed.subjectRevision < 1
    ) {
      throw new TypeError('New task list decisions must be a valid unanswered pending decision');
    }
    if (input.event.taskListId !== proposed.taskListId) {
      throw new Error('Task List decision event belongs to a different Task List');
    }
    const options = Array.isArray(proposed.options) ? proposed.options : [];
    const normalizedOptions = options.map((option) => ({
      id: typeof option?.id === 'string' ? option.id.trim() : '',
      label: typeof option?.label === 'string' ? option.label.trim() : '',
      previewAssetHash: option?.previewAssetHash,
    }));
    if (!proposed.allowFreeText && normalizedOptions.length === 0) {
      throw new TypeError('TaskList decision empty option lists require allowFreeText=true');
    }
    if (
      !Array.isArray(proposed.options) ||
      normalizedOptions.some((option) => !option.id || !option.label) ||
      new Set(normalizedOptions.map((option) => option.id)).size !== normalizedOptions.length ||
      new Set(normalizedOptions.map((option) => option.label)).size !== normalizedOptions.length
    ) {
      throw new TypeError('TaskList decision options require unique non-empty ids and labels');
    }
    if (
      normalizedOptions.some(
        (option) =>
          option.previewAssetHash !== undefined &&
          (typeof option.previewAssetHash !== 'string' ||
            !/^[a-f0-9]{64}$/i.test(option.previewAssetHash.trim())),
      )
    ) {
      throw new TypeError('TaskList decision previewAssetHash must be a SHA-256 CAS asset hash');
    }

    const existingRow = db
      .prepare(
        `SELECT * FROM task_decisions
         WHERE task_list_id = ? AND decision_key = ? AND subject_revision = ?`,
      )
      .get(proposed.taskListId, decisionKey, proposed.subjectRevision) as
      Record<string, unknown> | undefined;
    if (existingRow) {
      const existing = rowToTaskDecision(existingRow);
      if (
        existing.taskId !== proposed.taskId ||
        existing.canvasId !== proposed.canvasId ||
        existing.question !== question ||
        canonicalJson(existing.options) !== canonicalJson(proposed.options) ||
        existing.allowFreeText !== proposed.allowFreeText
      ) {
        throw new Error(
          'TaskList decision idempotency key conflicts with different persisted content',
        );
      }
      const existingTaskListRow = db
        .prepare('SELECT * FROM task_lists WHERE id = ?')
        .get(existing.taskListId) as Record<string, unknown>;
      const existingTaskRow = db
        .prepare('SELECT * FROM tasks WHERE id = ?')
        .get(existing.taskId) as Record<string, unknown>;
      return {
        decision: existing,
        taskList: rowToTaskList(existingTaskListRow),
        task: rowToTask(db, existingTaskRow),
        created: false,
      };
    }

    const taskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(proposed.taskListId) as Record<string, unknown> | undefined;
    if (!taskListRow) throw new Error(`TaskList "${proposed.taskListId}" not found`);
    if (
      String(taskListRow.task_list_type) !== 'movie.production.v2' ||
      String(taskListRow.entity_type) !== 'canvas' ||
      String(taskListRow.entity_id ?? '') !== proposed.canvasId
    ) {
      throw new Error('TaskList decision is not bound to the requested persistent video canvas');
    }
    const actualTaskListRowVersion = Number(taskListRow.row_version ?? 0);
    if (actualTaskListRowVersion !== input.expectedTaskListRowVersion) {
      throw new Error(
        `TaskList row version changed: expected ${input.expectedTaskListRowVersion}, got ${actualTaskListRowVersion}`,
      );
    }
    if (String(taskListRow.current_task_id ?? '') !== proposed.taskId) {
      throw new Error('TaskList decision must bind to the current task list task');
    }

    const taskRow = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND task_list_id = ?')
      .get(proposed.taskId, proposed.taskListId) as Record<string, unknown> | undefined;
    if (!taskRow) throw new Error(`TaskList task "${proposed.taskId}" not found`);
    const taskStatus = String(taskRow.status);
    if (taskStatus !== 'ready' && taskStatus !== 'running') {
      throw new Error(`TaskList task cannot ask the user while status is "${taskStatus}"`);
    }

    db.prepare(
      `INSERT INTO task_decisions (
         id, task_list_id, task_id, canvas_id, question_id,
         decision_key, subject_revision, question, options_json, allow_free_text,
         status, answer, selected_option_id, row_version,
         created_at, updated_at, answered_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      proposed.id,
      proposed.taskListId,
      proposed.taskId,
      proposed.canvasId,
      proposed.questionId,
      decisionKey,
      proposed.subjectRevision,
      question,
      JSON.stringify(proposed.options),
      proposed.allowFreeText ? 1 : 0,
      'pending',
      null,
      null,
      0,
      proposed.createdAt,
      proposed.updatedAt,
      null,
    );

    const taskChanged = db
      .prepare(
        `UPDATE tasks
         SET status = 'blocked', current_step = 'awaiting_user_decision', updated_at = ?
         WHERE id = ? AND task_list_id = ? AND status IN ('ready', 'running')`,
      )
      .run(proposed.updatedAt, proposed.taskId, proposed.taskListId).changes;
    if (taskChanged !== 1) throw new Error('TaskList task changed inside decision transaction');

    const taskListChanged = db
      .prepare(
        `UPDATE task_lists
         SET status = 'blocked', row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ? AND current_task_id = ?`,
      )
      .run(
        proposed.updatedAt,
        proposed.taskListId,
        input.expectedTaskListRowVersion,
        proposed.taskId,
      ).changes;
    if (taskListChanged !== 1) throw new Error('Task List changed inside decision transaction');

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_list_id = ?',
      )
      .get(proposed.taskListId) as { next_seq: number };
    const event: TaskEvent = {
      ...input.event,
      seq: Number(seqRow.next_seq),
      payload: {
        ...input.event.payload,
        type: 'task_list.decision.requested',
        decisionId: proposed.id,
        decisionKey,
        subjectRevision: proposed.subjectRevision,
        taskId: proposed.taskId,
        questionId: proposed.questionId,
      },
    };
    insertTaskEvent(db, event);

    const insertedRow = db
      .prepare('SELECT * FROM task_decisions WHERE id = ?')
      .get(proposed.id) as Record<string, unknown>;
    const updatedTaskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(proposed.taskListId) as Record<string, unknown>;
    const updatedTaskRow = db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(proposed.taskId) as Record<string, unknown>;
    return {
      decision: rowToTaskDecision(insertedRow),
      taskList: rowToTaskList(updatedTaskListRow),
      task: rowToTask(db, updatedTaskRow),
      event,
      created: true,
    };
  });
  return reserve.immediate();
}

export function getTaskDecisionByQuestion(
  db: BetterSqlite3.Database,
  canvasId: string,
  questionId: string,
): TaskDecision | undefined {
  const row = db
    .prepare(
      `SELECT * FROM task_decisions
       WHERE canvas_id = ? AND question_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 1`,
    )
    .get(canvasId, questionId) as Record<string, unknown> | undefined;
  return row ? rowToTaskDecision(row) : undefined;
}

export function listPendingTaskDecisions(
  db: BetterSqlite3.Database,
  filter: TaskDecisionFilter = {},
): TaskDecision[] {
  const conditions = ["status IN ('pending', 'recovery_required')"];
  const params: unknown[] = [];
  if (filter.taskListId) {
    conditions.push('task_list_id = ?');
    params.push(filter.taskListId);
  }
  if (filter.canvasId) {
    conditions.push('canvas_id = ?');
    params.push(filter.canvasId);
  }
  const rows = db
    .prepare(
      `SELECT * FROM task_decisions
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at ASC, id ASC`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map(rowToTaskDecision);
}

export function answerTaskDecision(
  db: BetterSqlite3.Database,
  input: AnswerTaskDecisionInput,
): AnswerTaskDecisionResult | undefined {
  const answer = input.answer.trim();
  if (!answer) throw new TypeError('TaskList decision answer must not be empty');

  const persist = db.transaction((): AnswerTaskDecisionResult | undefined => {
    const decisionRow = db
      .prepare(
        `SELECT * FROM task_decisions
         WHERE canvas_id = ? AND question_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 1`,
      )
      .get(input.canvasId, input.questionId) as Record<string, unknown> | undefined;
    if (!decisionRow) return undefined;
    const decision = rowToTaskDecision(decisionRow);
    if (input.event.taskListId !== decision.taskListId) {
      throw new Error('Task List decision answer event belongs to a different Task List');
    }
    const resumesRecoveredDecision =
      decision.status === 'recovery_required' &&
      input.status === 'answered' &&
      decision.answer === answer &&
      (input.selectedOptionId === undefined ||
        decision.selectedOptionId === input.selectedOptionId);
    if (decision.status !== 'pending' && !resumesRecoveredDecision) {
      if (
        decision.answer === answer &&
        (input.selectedOptionId === undefined ||
          decision.selectedOptionId === input.selectedOptionId)
      ) {
        const taskListRow = db
          .prepare('SELECT * FROM task_lists WHERE id = ?')
          .get(decision.taskListId) as Record<string, unknown>;
        const taskRow = db
          .prepare('SELECT * FROM tasks WHERE id = ?')
          .get(decision.taskId) as Record<string, unknown>;
        return {
          decision,
          taskList: rowToTaskList(taskListRow),
          task: rowToTask(db, taskRow),
          answered: false,
        };
      }
      throw new Error('TaskList decision has already been answered differently');
    }

    const selectedOptionId =
      input.selectedOptionId ?? decision.options.find((option) => option.label === answer)?.id;
    const selectedOption =
      selectedOptionId === undefined
        ? undefined
        : decision.options.find((option) => option.id === selectedOptionId);
    if (selectedOptionId !== undefined && selectedOption === undefined) {
      throw new Error('TaskList decision selected option does not exist');
    }
    if (!decision.allowFreeText && selectedOption?.label !== answer) {
      throw new Error('TaskList decision requires one of the listed options');
    }

    const taskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(decision.taskListId) as Record<string, unknown> | undefined;
    const taskRow = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND task_list_id = ?')
      .get(decision.taskId, decision.taskListId) as Record<string, unknown> | undefined;
    if (!taskListRow || !taskRow) throw new Error('TaskList decision binding no longer exists');
    const actualTaskListRowVersion = Number(taskListRow.row_version ?? 0);

    const decisionChanged = db
      .prepare(
        `UPDATE task_decisions
         SET status = ?, answer = ?, selected_option_id = ?, answered_at = ?, updated_at = ?,
             row_version = row_version + 1
         WHERE id = ? AND row_version = ? AND status = ?`,
      )
      .run(
        input.status,
        answer,
        selectedOptionId ?? null,
        input.answeredAt,
        input.answeredAt,
        decision.id,
        decision.rowVersion,
        decision.status,
      ).changes;
    if (decisionChanged !== 1) throw new Error('TaskList decision changed before answer');

    const canResume = input.status === 'answered';
    const taskChanged = db
      .prepare(
        `UPDATE tasks
         SET status = ?, current_step = ?, updated_at = ?
         WHERE id = ? AND task_list_id = ? AND status = 'blocked'`,
      )
      .run(
        canResume ? 'ready' : 'blocked',
        canResume ? 'user_decision_answered' : 'recovery_required',
        input.answeredAt,
        decision.taskId,
        decision.taskListId,
      ).changes;
    if (taskChanged !== 1) throw new Error('TaskList decision task is not awaiting an answer');

    const taskListChanged = db
      .prepare(
        `UPDATE task_lists
         SET status = CASE
               WHEN ? = 0 THEN 'blocked'
               WHEN current_gate IS NULL THEN 'ready'
               ELSE 'awaiting_approval'
             END,
             row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ? AND current_task_id = ?`,
      )
      .run(
        canResume ? 1 : 0,
        input.answeredAt,
        decision.taskListId,
        actualTaskListRowVersion,
        decision.taskId,
      ).changes;
    if (taskListChanged !== 1) throw new Error('Task List changed before decision answer');

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_list_id = ?',
      )
      .get(decision.taskListId) as { next_seq: number };
    const event: TaskEvent = {
      ...input.event,
      seq: Number(seqRow.next_seq),
      payload: {
        ...input.event.payload,
        type: 'task_list.decision.answered',
        decisionId: decision.id,
        decisionKey: decision.decisionKey,
        subjectRevision: decision.subjectRevision,
        taskId: decision.taskId,
        questionId: decision.questionId,
        selectedOptionId: selectedOptionId ?? null,
        resumeStatus: input.status,
      },
    };
    insertTaskEvent(db, event);

    const updatedDecisionRow = db
      .prepare('SELECT * FROM task_decisions WHERE id = ?')
      .get(decision.id) as Record<string, unknown>;
    const updatedTaskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(decision.taskListId) as Record<string, unknown>;
    const updatedTaskRow = db
      .prepare('SELECT * FROM tasks WHERE id = ?')
      .get(decision.taskId) as Record<string, unknown>;
    return {
      decision: rowToTaskDecision(updatedDecisionRow),
      taskList: rowToTaskList(updatedTaskListRow),
      task: rowToTask(db, updatedTaskRow),
      event,
      answered: true,
    };
  });
  return persist.immediate();
}

/**
 * Atomically accepts host-verified output for the one current external task.
 * Dependency checks and the Task List CAS happen in the same transaction so an AI
 * cannot skip ahead, complete a stale task, or detach evidence from its task.
 */
export function completeExternalTask(
  db: BetterSqlite3.Database,
  input: CompleteExternalTaskInput,
): CompleteExternalTaskResult {
  const complete = db.transaction((): CompleteExternalTaskResult => {
    if (input.event.taskListId !== input.taskListId) {
      throw new Error('External task completion event belongs to a different Task List');
    }
    const taskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(input.taskListId) as Record<string, unknown> | undefined;
    if (!taskListRow) throw new Error(`TaskList "${input.taskListId}" not found`);
    const taskList = rowToTaskList(taskListRow);
    if (taskList.taskListType !== 'movie.production.v2') {
      throw new Error('External production completion requires movie.production.v2');
    }
    if ((taskList.rowVersion ?? 0) !== input.expectedTaskListRowVersion) {
      throw new Error(
        `TaskList row version changed: expected ${input.expectedTaskListRowVersion}, got ${taskList.rowVersion ?? 0}`,
      );
    }
    if (taskList.currentGate) {
      throw new Error(`TaskList is awaiting ${taskList.currentGate} approval`);
    }
    if (taskList.currentTaskId !== input.taskId) {
      throw new Error('External completion must target the host-derived current task');
    }

    const taskRow = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND task_list_id = ?')
      .get(input.taskId, input.taskListId) as Record<string, unknown> | undefined;
    if (!taskRow) throw new Error(`TaskList task "${input.taskId}" not found`);
    const task = rowToTask(db, taskRow);
    if (task.input.executionMode !== 'external') {
      throw new Error('Only external task list tasks can use host completion');
    }
    if (task.status !== 'ready' && task.status !== 'running') {
      throw new Error(`External task list task cannot complete from status "${task.status}"`);
    }
    const unsatisfied = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM task_dependencies d
         JOIN tasks dependency ON dependency.id = d.depends_on_task_id
         WHERE d.task_id = ? AND dependency.status NOT IN ('completed', 'skipped')`,
      )
      .get(task.id) as { count: number };
    if (Number(unsatisfied.count) > 0) {
      throw new Error('External task list task dependencies are not complete');
    }

    const taskChanged = db
      .prepare(
        `UPDATE tasks
         SET status = 'completed', output_json = ?, progress = 100,
             current_step = 'completed', error_text = NULL,
             completed_at = ?, updated_at = ?
         WHERE id = ? AND task_list_id = ? AND status IN ('ready', 'running')`,
      )
      .run(
        JSON.stringify(input.output),
        input.completedAt,
        input.completedAt,
        task.id,
        input.taskListId,
      ).changes;
    if (taskChanged !== 1) throw new Error('External task list task changed before completion');

    recomputePhaseAggregate(db, task.taskListId, task.phaseKey);
    recomputeTaskListAggregate(db, input.taskListId);
    const taskListChanged = db
      .prepare(
        `UPDATE task_lists
         SET row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ? AND current_gate IS NULL`,
      )
      .run(input.completedAt, input.taskListId, input.expectedTaskListRowVersion).changes;
    if (taskListChanged !== 1)
      throw new Error('TaskList changed inside external completion transaction');

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_list_id = ?',
      )
      .get(input.taskListId) as { next_seq: number };
    const event: TaskEvent = {
      ...input.event,
      seq: Number(seqRow.next_seq),
      payload: {
        ...input.event.payload,
        type: 'task_list.external_task.completed',
        taskId: task.id,
        taskKey: task.taskKey,
      },
    };
    insertTaskEvent(db, event);

    const updatedTaskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(input.taskListId) as Record<string, unknown>;
    const updatedTaskRow = db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Record<
      string,
      unknown
    >;
    return {
      taskList: rowToTaskList(updatedTaskListRow),
      task: rowToTask(db, updatedTaskRow),
      event,
    };
  });
  return complete.immediate();
}

/**
 * Reopen one completed shot for an additive user refinement without rewinding
 * the plan, Visual Constitution, other completed shots, or budget ledger.
 */
function reopenProductionMediaTask(
  db: BetterSqlite3.Database,
  input: ReopenProductionMediaTaskInput,
): ReopenProductionMediaTaskResult {
  const reopen = db.transaction((): ReopenProductionMediaTaskResult => {
    const feedback = input.feedback.trim();
    if (!feedback) throw new Error('Production-media feedback must not be empty');
    if (input.event.taskListId !== input.taskListId) {
      throw new Error('Production-media feedback event belongs to a different Task List');
    }
    const taskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(input.taskListId) as Record<string, unknown> | undefined;
    if (!taskListRow) throw new Error(`TaskList "${input.taskListId}" not found`);
    const taskList = rowToTaskList(taskListRow);
    if (
      taskList.taskListType !== 'movie.production.v2' ||
      taskList.entityType !== 'canvas' ||
      taskList.entityId !== input.canvasId
    ) {
      throw new Error('Production-media feedback is not bound to this persistent canvas task list');
    }
    if ((taskList.rowVersion ?? 0) !== input.expectedTaskListRowVersion) {
      throw new Error(
        `TaskList row version changed: expected ${input.expectedTaskListRowVersion}, got ${taskList.rowVersion ?? 0}`,
      );
    }
    if (taskList.currentGate) {
      throw new Error(`TaskList is awaiting ${taskList.currentGate} approval`);
    }
    const busyAssembly = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM tasks task
         WHERE task.task_list_id = ? AND task.phase_key = 'assembly'
           AND task.status IN ('running', 'awaiting_provider', 'completed')`,
      )
      .get(input.taskListId) as { count: number };
    if (Number(busyAssembly.count) > 0) {
      throw new Error('Assembly has already started; revise that phase before changing media');
    }

    const attempt = getProductionMediaTaskAttempt(db, input.attemptId);
    if (
      !attempt ||
      attempt.taskListId !== input.taskListId ||
      attempt.canvasId !== input.canvasId ||
      attempt.generationSpec.task.id !== input.taskId
    ) {
      throw new Error('Production-media feedback attempt/task binding is invalid');
    }
    const latest = getLatestProductionMediaTaskAttempt(db, input.taskListId, attempt.nodeId);
    if (!latest || latest.id !== attempt.id || attempt.status !== 'accepted') {
      throw new Error('Only the exact latest accepted media attempt can reopen a completed task');
    }
    const taskRow = db
      .prepare('SELECT * FROM tasks WHERE id = ? AND task_list_id = ?')
      .get(input.taskId, input.taskListId) as Record<string, unknown> | undefined;
    if (!taskRow) throw new Error(`TaskList task "${input.taskId}" not found`);
    const task = rowToTask(db, taskRow);
    if (task.input.taskRole !== 'production_media' || task.id !== attempt.generationSpec.task.id) {
      throw new Error('Only the attempt-bound production_media task can be reopened');
    }
    if (task.status !== 'completed') {
      throw new Error(`Production-media task cannot reopen from status "${task.status}"`);
    }

    const taskChanged = db
      .prepare(
        `UPDATE tasks
         SET status = 'ready', output_json = '{}', progress = 0,
             current_step = 'user_feedback_received', error_text = NULL,
             completed_at = NULL, updated_at = ?
         WHERE id = ? AND task_list_id = ? AND status = 'completed'`,
      )
      .run(input.reopenedAt, task.id, input.taskListId).changes;
    if (taskChanged !== 1) throw new Error('Production-media task changed before it was reopened');
    recomputePhaseAggregate(db, task.taskListId, task.phaseKey);
    recomputeTaskListAggregate(db, input.taskListId);
    const taskListChanged = db
      .prepare(
        `UPDATE task_lists
         SET row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ? AND current_gate IS NULL`,
      )
      .run(input.reopenedAt, input.taskListId, input.expectedTaskListRowVersion).changes;
    if (taskListChanged !== 1) {
      throw new Error('TaskList changed inside media feedback transaction');
    }

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_list_id = ?',
      )
      .get(input.taskListId) as { next_seq: number };
    const event: TaskEvent = {
      ...input.event,
      seq: Number(seqRow.next_seq),
      payload: {
        ...input.event.payload,
        type: 'task_list.media.feedback_requested',
        taskId: task.id,
        attemptId: attempt.id,
        nodeId: attempt.nodeId,
        basePromptHash: attempt.promptHash,
        feedback,
      },
    };
    insertTaskEvent(db, event);

    return {
      taskList: rowToTaskList(
        db.prepare('SELECT * FROM task_lists WHERE id = ?').get(input.taskListId) as Record<
          string,
          unknown
        >,
      ),
      task: rowToTask(
        db,
        db.prepare('SELECT * FROM tasks WHERE id = ?').get(task.id) as Record<string, unknown>,
      ),
      event,
    };
  });
  return reopen.immediate();
}

/**
 * Accept one user-feedback revision as a single durable fact: the completed
 * task is reopened, its feedback event is written, and the next immutable
 * attempt is reserved in the same immediate transaction. Any failed CAS,
 * approval, retry, or budget check rolls all three mutations back.
 */
export function reserveProductionMediaFeedbackAttempt(
  db: BetterSqlite3.Database,
  input: ReserveProductionMediaFeedbackAttemptInput,
): ReserveProductionMediaFeedbackAttemptResult {
  const reserveFeedback = db.transaction((): ReserveProductionMediaFeedbackAttemptResult => {
    const feedback = input.feedback.trim();
    const target = getProductionMediaTaskAttempt(db, input.attemptId);
    if (!target || target.promptHash !== input.basePromptHash) {
      throw new Error('The exact production-media feedback prompt hash is required');
    }
    const delta = input.attempt.repairDelta;
    if (
      !delta ||
      delta.source !== 'user_feedback' ||
      delta.parentAttemptId !== target.id ||
      delta.basePromptHash !== target.promptHash ||
      delta.userFeedback?.trim() !== feedback ||
      input.attempt.taskListId !== target.taskListId ||
      input.attempt.canvasId !== target.canvasId ||
      input.attempt.nodeId !== target.nodeId ||
      input.attempt.providerId !== target.providerId
    ) {
      throw new Error('Production-media feedback attempt lineage is invalid');
    }

    const reopened = reopenProductionMediaTask(db, input);
    const reserved = reserveProductionMediaTaskAttempt(db, {
      attempt: input.attempt,
      expectedTaskListRowVersion: reopened.taskList.rowVersion ?? -1,
    });
    return {
      ...reopened,
      attempt: reserved.attempt,
      created: reserved.created,
    };
  });
  return reserveFeedback.immediate();
}

// --- Task execution attempts ---

export function reserveTaskExecutionAttempt(
  db: BetterSqlite3.Database,
  input: ReserveTaskExecutionAttemptInput,
): { attempt: TaskExecutionAttempt; created: boolean } {
  const proposed = input.attempt;
  if (proposed.kind !== 'task' || proposed.rowVersion !== 0 || proposed.attempt < 1) {
    throw new Error('New task execution attempts must begin at rowVersion 0');
  }
  const task = db.prepare('SELECT task_list_id FROM tasks WHERE id = ?').get(proposed.taskId) as
    { task_list_id: string } | undefined;
  if (!task || task.task_list_id !== proposed.taskListId) {
    throw new Error('Task execution attempt has an invalid Task binding');
  }
  const existing = db
    .prepare('SELECT * FROM task_attempts WHERE id = ? OR idempotency_key = ? LIMIT 1')
    .get(proposed.id, proposed.idempotencyKey) as Record<string, unknown> | undefined;
  if (existing) {
    const attempt = rowToTaskExecutionAttempt(existing);
    if (
      attempt.id !== proposed.id ||
      attempt.taskId !== proposed.taskId ||
      attempt.attempt !== proposed.attempt
    ) {
      throw new Error('Task execution idempotency key belongs to another attempt');
    }
    return { attempt, created: false };
  }
  db.prepare(
    `INSERT INTO task_attempts (
       id, task_list_id, task_id, kind, idempotency_key, status, row_version, attempt,
       input_json, output_json, metadata_json, provider_job_id, asset_hash, error_text,
       created_at, submitted_at, asset_ready_at, updated_at, completed_at
     ) VALUES (?, ?, ?, 'task', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    proposed.id,
    proposed.taskListId,
    proposed.taskId,
    proposed.idempotencyKey,
    proposed.status,
    proposed.rowVersion,
    proposed.attempt,
    JSON.stringify(proposed.input),
    JSON.stringify(proposed.output),
    JSON.stringify(proposed.metadata),
    proposed.providerJobId ?? null,
    proposed.assetHash ?? null,
    proposed.error ?? null,
    proposed.createdAt,
    proposed.submittedAt ?? null,
    proposed.assetReadyAt ?? null,
    proposed.updatedAt,
    proposed.completedAt ?? null,
  );
  return { attempt: requireTaskExecutionAttempt(db, proposed.id), created: true };
}

export function getTaskExecutionAttempt(
  db: BetterSqlite3.Database,
  id: string,
): TaskExecutionAttempt | undefined {
  const row = db.prepare("SELECT * FROM task_attempts WHERE id = ? AND kind = 'task'").get(id) as
    Record<string, unknown> | undefined;
  return row ? rowToTaskExecutionAttempt(row) : undefined;
}

function requireTaskExecutionAttempt(db: BetterSqlite3.Database, id: string): TaskExecutionAttempt {
  const attempt = getTaskExecutionAttempt(db, id);
  if (!attempt) throw new Error(`Task execution attempt "${id}" not found`);
  return attempt;
}

export function listTaskExecutionAttempts(
  db: BetterSqlite3.Database,
  taskId: string,
): TaskExecutionAttempt[] {
  return (
    db
      .prepare(
        "SELECT * FROM task_attempts WHERE task_id = ? AND kind = 'task' ORDER BY attempt ASC",
      )
      .all(taskId) as Array<Record<string, unknown>>
  ).map(rowToTaskExecutionAttempt);
}

export function transitionTaskExecutionAttempt(
  db: BetterSqlite3.Database,
  input: TransitionTaskExecutionAttemptInput,
): TaskExecutionAttempt {
  if (input.expectedStatuses.length === 0) {
    throw new Error('Task execution transition requires an expected status');
  }
  const placeholders = input.expectedStatuses.map(() => '?').join(', ');
  const changed = db
    .prepare(
      `UPDATE task_attempts
       SET status = ?, row_version = row_version + 1,
           output_json = COALESCE(?, output_json), metadata_json = COALESCE(?, metadata_json),
           provider_job_id = COALESCE(?, provider_job_id),
           asset_hash = COALESCE(?, asset_hash), error_text = ?,
           submitted_at = COALESCE(?, submitted_at),
           asset_ready_at = COALESCE(?, asset_ready_at),
           updated_at = ?, completed_at = COALESCE(?, completed_at)
       WHERE id = ? AND kind = 'task' AND row_version = ?
         AND status IN (${placeholders})`,
    )
    .run(
      input.status,
      input.output ? JSON.stringify(input.output) : null,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.providerJobId ?? null,
      input.assetHash ?? null,
      input.error ?? null,
      input.submittedAt ?? null,
      input.assetReadyAt ?? null,
      input.updatedAt,
      input.completedAt ?? null,
      input.id,
      input.expectedRowVersion,
      ...input.expectedStatuses,
    ).changes;
  if (changed !== 1) throw new Error('Task execution attempt changed concurrently');
  return requireTaskExecutionAttempt(db, input.id);
}

// --- Persistent production-media attempts and evaluations ---

function assertProductionMediaSpec(spec: ProductionMediaGenerationSpec): void {
  const expectedAuthority = {
    canvas: 'task-list',
    style_audition: 'task-list-production-plan',
    production: 'task-list-approved',
  } as const;
  const operationMatchesMedia =
    (spec.mediaType === 'image' &&
      (spec.operation === 'text-to-image' || spec.operation === 'image-to-image')) ||
    (spec.mediaType === 'video' &&
      (spec.operation === 'text-to-video' || spec.operation === 'image-to-video'));
  if (
    spec.authority.kind !== expectedAuthority[spec.scope] ||
    !operationMatchesMedia ||
    !spec.taskListId.trim() ||
    !spec.taskId.trim() ||
    !spec.canvasId.trim() ||
    !Number.isFinite(spec.canvasUpdatedAt) ||
    !spec.nodeId.trim() ||
    !Number.isFinite(spec.nodeUpdatedAt) ||
    !spec.providerId.trim() ||
    !spec.modelId.trim() ||
    !spec.promptAssemblyId.trim() ||
    !spec.promptHash.trim() ||
    !Array.isArray(spec.referenceEvidence) ||
    !Number.isInteger(spec.lineage.variantIndex) ||
    !Number.isInteger(spec.lineage.variantCount) ||
    spec.lineage.variantCount < 1 ||
    spec.lineage.variantIndex < 0 ||
    spec.lineage.variantIndex >= spec.lineage.variantCount
  ) {
    throw new Error('Generation Spec v3 is incomplete or has conflicting authority');
  }
  if (spec.scope === 'style_audition') {
    const authority = spec.authority as Extract<
      ProductionMediaGenerationSpec['authority'],
      { kind: 'task-list-production-plan' }
    >;
    if (!authority.planId.trim() || !authority.planHash.trim() || !authority.candidateId.trim()) {
      throw new Error('Style-audition authority requires an exact plan and candidate');
    }
  }
  if (spec.scope === 'production') {
    const authority = spec.authority as Extract<
      ProductionMediaGenerationSpec['authority'],
      { kind: 'task-list-approved' }
    >;
    if (
      !authority.planId.trim() ||
      !authority.planHash.trim() ||
      !authority.constitutionId.trim() ||
      !authority.constitutionHash.trim()
    ) {
      throw new Error('Production authority requires exact approved plan documents');
    }
  }
}

function assertProductionMediaAuthority(
  db: BetterSqlite3.Database,
  taskListId: string,
  spec: ProductionMediaGenerationSpec,
): void {
  if (spec.authority.kind === 'task-list') return;
  assertApprovedMediaDocument(
    db,
    taskListId,
    'production_plan',
    spec.authority.planId,
    spec.authority.planHash,
  );
  if (spec.authority.kind === 'task-list-approved') {
    assertApprovedMediaDocument(
      db,
      taskListId,
      'visual_constitution',
      spec.authority.constitutionId,
      spec.authority.constitutionHash,
    );
  }
}

function assertApprovedMediaDocument(
  db: BetterSqlite3.Database,
  taskListId: string,
  gateKey: 'production_plan' | 'visual_constitution',
  documentId: string,
  documentHash: string,
): void {
  const document = db
    .prepare(
      `SELECT revision, content_hash, status FROM plan_documents
       WHERE id = ? AND task_list_id = ?`,
    )
    .get(documentId, taskListId) as
    { revision: number; content_hash: string; status: string } | undefined;
  const approval = document
    ? (db
        .prepare(
          `SELECT subject_revision, subject_hash, status FROM plan_approvals
           WHERE task_list_id = ? AND gate_key = ?
           ORDER BY subject_revision DESC, created_at DESC LIMIT 1`,
        )
        .get(taskListId, gateKey) as
        { subject_revision: number; subject_hash: string; status: string } | undefined)
    : undefined;
  if (
    !document ||
    document.status !== 'active' ||
    document.content_hash !== documentHash ||
    !approval ||
    approval.status !== 'approved' ||
    Number(approval.subject_revision) !== Number(document.revision) ||
    approval.subject_hash !== documentHash
  ) {
    throw new Error(`Exact approved ${gateKey} document is required before generation`);
  }
}

export function reserveProductionMediaTaskAttempt(
  db: BetterSqlite3.Database,
  input: ReserveProductionMediaTaskAttemptInput,
): ReserveProductionMediaTaskAttemptResult {
  const reserve = db.transaction((): ReserveProductionMediaTaskAttemptResult => {
    const proposed = input.attempt;
    if (
      proposed.kind !== 'production_media' ||
      proposed.status !== 'reserved' ||
      proposed.rowVersion !== 0 ||
      proposed.attempt < 1
    ) {
      throw new Error('New production-media attempts must begin reserved at rowVersion 0');
    }

    const taskListRow = db
      .prepare(
        `SELECT task_lists.task_list_type, task_lists.entity_type,
                task_lists.entity_id, task_lists.status,
                task_lists.current_phase_key,
                task_lists.current_task_id, task_lists.current_gate,
                task_lists.row_version
         FROM task_lists
         WHERE task_lists.id = ?`,
      )
      .get(proposed.taskListId) as
      | {
          task_list_type: string;
          entity_type: string;
          entity_id: string | null;
          status: string;
          current_phase_key: string | null;
          current_task_id: string | null;
          current_gate: string | null;
          row_version: number;
        }
      | undefined;
    if (!taskListRow) throw new Error(`TaskList "${proposed.taskListId}" not found`);
    if (taskListRow.entity_type !== 'canvas' || taskListRow.entity_id !== proposed.canvasId) {
      throw new Error('Production-media attempt is not bound to this persistent canvas task list');
    }
    if (Number(taskListRow.row_version) !== input.expectedTaskListRowVersion) {
      throw new Error('TaskList changed before production-media reservation');
    }
    if (taskListRow.current_gate !== null) {
      throw new Error(`TaskList is awaiting ${taskListRow.current_gate} approval`);
    }
    const currentTaskRow = taskListRow.current_task_id
      ? (db
          .prepare('SELECT * FROM tasks WHERE id = ? AND task_list_id = ?')
          .get(taskListRow.current_task_id, proposed.taskListId) as
          Record<string, unknown> | undefined)
      : undefined;
    const currentTask = currentTaskRow ? rowToTask(db, currentTaskRow) : undefined;
    const currentRole =
      typeof currentTask?.input.taskRole === 'string' ? currentTask.input.taskRole : undefined;
    const expectedRoleByScope = {
      canvas: 'canvas_media',
      style_audition: 'style_audition',
      production: 'production_media',
    } as const;
    if (
      !currentTask ||
      currentRole !== expectedRoleByScope[proposed.scope] ||
      (currentTask.status !== 'ready' && currentTask.status !== 'running') ||
      (taskListRow.status !== 'ready' && taskListRow.status !== 'running')
    ) {
      throw new Error(
        `TaskList is not ready for task-bound media generation (status=${taskListRow.status}, phase=${taskListRow.current_phase_key ?? 'invalid'}, task=${currentTask?.taskKey ?? 'none'})`,
      );
    }

    const spec = proposed.generationSpec;
    if (
      spec.specVersion !== 3 ||
      spec.scope !== proposed.scope ||
      spec.taskListId !== proposed.taskListId ||
      spec.taskId !== currentTask.id ||
      spec.canvasId !== proposed.canvasId ||
      spec.nodeId !== proposed.nodeId ||
      spec.mediaType !== proposed.mediaType ||
      spec.providerId !== proposed.providerId ||
      spec.modelId !== proposed.model ||
      spec.promptAssemblyId !== proposed.promptAssemblyId ||
      spec.promptHash !== proposed.promptHash ||
      spec.prompt !== proposed.prompt ||
      spec.request.type !== proposed.mediaType ||
      spec.request.providerId !== proposed.providerId ||
      spec.request.prompt !== proposed.prompt ||
      spec.request.negativePrompt !== proposed.negativePrompt ||
      spec.lineage.purpose !== proposed.submissionPurpose ||
      spec.lineage.parentAttemptId !== proposed.parentAttemptId ||
      spec.task.id !== currentTask.id ||
      spec.task.key !== currentTask.taskKey ||
      spec.task.role !== currentRole
    ) {
      throw new Error('Generation Spec identity does not match its attempt reservation');
    }
    assertProductionMediaSpec(spec);
    assertProductionMediaAuthority(db, proposed.taskListId, spec);
    if (
      proposed.repairDelta &&
      (!Array.isArray(proposed.repairDelta.reasonCodes) ||
        proposed.repairDelta.reasonCodes.length === 0 ||
        proposed.repairDelta.parentAttemptId !== proposed.parentAttemptId)
    ) {
      throw new Error('Repair Delta requires stable reasons and exact parent-attempt lineage');
    }

    const existingRow = db
      .prepare(
        `SELECT * FROM task_attempts
         WHERE idempotency_key = ? OR id = ?
         LIMIT 1`,
      )
      .get(proposed.idempotencyKey, proposed.id) as Record<string, unknown> | undefined;
    if (existingRow) {
      const existing = rowToProductionMediaTaskAttempt(existingRow);
      if (
        existing.id !== proposed.id ||
        existing.idempotencyKey !== proposed.idempotencyKey ||
        existing.taskListId !== proposed.taskListId ||
        existing.nodeId !== proposed.nodeId ||
        existing.attempt !== proposed.attempt ||
        existing.specHash !== proposed.specHash
      ) {
        throw new Error('Production-media idempotency key already belongs to another attempt');
      }
      return { attempt: existing, created: false };
    }

    const limits = spec.limits;
    if (
      !Number.isInteger(limits.maxAttemptsPerShot) ||
      limits.maxAttemptsPerShot < 0 ||
      !Number.isInteger(limits.maxRegenerations) ||
      limits.maxRegenerations < 0 ||
      !Number.isFinite(limits.maxTotalCostUsd) ||
      limits.maxTotalCostUsd < 0 ||
      !Number.isFinite(limits.styleAuditionCommittedCostUsd) ||
      limits.styleAuditionCommittedCostUsd < 0 ||
      !Number.isFinite(proposed.estimatedCostUsd) ||
      proposed.estimatedCostUsd < 0
    ) {
      throw new Error('Generation Spec contains invalid approved budget limits');
    }
    if (proposed.attempt > Math.max(1, limits.maxAttemptsPerShot)) {
      throw new Error('Approved per-shot production-media attempt limit is exhausted');
    }
    const aggregate = db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END), 0) AS regeneration_count,
                COALESCE(SUM(COALESCE(reported_actual_cost_usd, estimated_cost_usd)), 0) AS committed_cost_usd
         FROM task_attempts WHERE task_list_id = ? AND kind = 'production_media'`,
      )
      .get(proposed.taskListId) as {
      regeneration_count: number;
      committed_cost_usd: number;
    };
    const projectedRegenerations =
      Number(aggregate.regeneration_count) + (proposed.attempt > 1 ? 1 : 0);
    if (projectedRegenerations > limits.maxRegenerations) {
      throw new Error('Approved global production-media regeneration limit is exhausted');
    }
    const projectedCostUsd =
      limits.styleAuditionCommittedCostUsd +
      Number(aggregate.committed_cost_usd) +
      proposed.estimatedCostUsd;
    if (projectedCostUsd > limits.maxTotalCostUsd + 1e-9) {
      throw new Error('Approved total production-media budget would be exceeded');
    }

    const latest = db
      .prepare(
        `SELECT COALESCE(MAX(attempt), 0) AS latest_attempt
         FROM task_attempts
         WHERE task_list_id = ? AND kind = 'production_media' AND node_id = ?`,
      )
      .get(proposed.taskListId, proposed.nodeId) as { latest_attempt: number };
    const expectedAttempt = Number(latest.latest_attempt) + 1;
    if (proposed.attempt !== expectedAttempt) {
      throw new Error(
        `Production-media attempt must be ${expectedAttempt}; received ${proposed.attempt}`,
      );
    }

    db.prepare(
      `INSERT INTO task_attempts (
         id, task_list_id, task_id, kind, canvas_id, node_id, attempt, idempotency_key,
         scope, parent_attempt_id, submission_purpose,
         spec_hash, generation_spec_json, repair_delta_json, media_type, status,
         row_version, provider_id, model, prompt, prompt_hash, negative_prompt,
         seed, estimated_cost_usd, reported_actual_cost_usd, provider_job_id, provider_receipt,
         asset_hash, error_text, created_at, submitted_at, asset_ready_at,
         submission_started_at, cancel_requested_at, evaluated_at, completed_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      proposed.id,
      proposed.taskListId,
      proposed.taskId ?? proposed.generationSpec.task.id,
      'production_media',
      proposed.canvasId,
      proposed.nodeId,
      proposed.attempt,
      proposed.idempotencyKey,
      proposed.scope,
      proposed.parentAttemptId ?? null,
      proposed.submissionPurpose,
      proposed.specHash,
      JSON.stringify(proposed.generationSpec),
      proposed.repairDelta ? JSON.stringify(proposed.repairDelta) : null,
      proposed.mediaType,
      proposed.status,
      proposed.rowVersion,
      proposed.providerId,
      proposed.model ?? null,
      proposed.prompt,
      proposed.promptHash,
      proposed.negativePrompt ?? null,
      proposed.seed ?? null,
      proposed.estimatedCostUsd,
      proposed.reportedActualCostUsd ?? null,
      proposed.providerJobId ?? null,
      proposed.providerReceipt ?? null,
      proposed.assetHash ?? null,
      proposed.error ?? null,
      proposed.createdAt,
      proposed.submittedAt ?? null,
      proposed.assetReadyAt ?? null,
      proposed.submissionStartedAt ?? null,
      proposed.cancelRequestedAt ?? null,
      proposed.evaluatedAt ?? null,
      proposed.completedAt ?? null,
      proposed.updatedAt,
    );
    return {
      attempt: requireProductionMediaTaskAttempt(db, proposed.id),
      created: true,
    };
  });
  return reserve.immediate();
}

export function beginMediaSubmission(
  db: BetterSqlite3.Database,
  input: BeginMediaSubmissionInput,
): BeginMediaSubmissionResult {
  const begin = db.transaction((): BeginMediaSubmissionResult => {
    const attempt = requireProductionMediaTaskAttempt(db, input.attemptId);
    if (attempt.promptAssemblyId !== input.promptAssemblyId) {
      throw new Error('Prompt Assembly does not belong to this production-media attempt');
    }
    const assembly = db
      .prepare('SELECT * FROM prompt_assemblies WHERE id = ?')
      .get(input.promptAssemblyId) as Record<string, unknown> | undefined;
    if (!assembly) throw new Error(`Prompt Assembly "${input.promptAssemblyId}" not found`);

    const existing = getTaskArtifactByAttempt(db, attempt.id, 'media_submission');
    if (existing) {
      if (
        existing.id !== input.artifactId ||
        attempt.status !== 'submitting' ||
        assembly.status !== 'submitted'
      ) {
        throw new Error('Media submission artifact conflicts with persisted submission state');
      }
      return { attempt, artifact: existing, created: false };
    }

    if (
      attempt.status !== 'reserved' ||
      attempt.rowVersion !== input.expectedAttemptRowVersion ||
      assembly.status !== 'assembled' ||
      Number(assembly.row_version) !== input.expectedPromptAssemblyRowVersion ||
      assembly.task_list_id !== attempt.taskListId ||
      assembly.task_id !== attempt.taskId ||
      assembly.canvas_id !== attempt.canvasId ||
      assembly.node_id !== attempt.nodeId
    ) {
      throw new Error('Media submission state or Prompt Assembly binding changed concurrently');
    }
    const output = JSON.parse(String(assembly.output_json || '{}')) as {
      finalPrompt?: unknown;
      negativePrompt?: unknown;
    };
    const outputNegative =
      typeof output.negativePrompt === 'string' ? output.negativePrompt : undefined;
    if (
      output.finalPrompt !== attempt.prompt ||
      outputNegative !== attempt.negativePrompt ||
      attempt.generationSpec.request.prompt !== attempt.prompt ||
      attempt.generationSpec.request.negativePrompt !== attempt.negativePrompt ||
      attempt.generationSpec.promptHash !== attempt.promptHash
    ) {
      throw new Error('Provider request does not exactly match the assembled prompt');
    }

    const assemblyChanged = db
      .prepare(
        `UPDATE prompt_assemblies
         SET status = 'submitted', submitted_at = ?, updated_at = ?, row_version = row_version + 1
         WHERE id = ? AND status = 'assembled' AND row_version = ?`,
      )
      .run(
        input.submissionStartedAt,
        input.submissionStartedAt,
        input.promptAssemblyId,
        input.expectedPromptAssemblyRowVersion,
      ).changes;
    const attemptChanged = db
      .prepare(
        `UPDATE task_attempts
         SET status = 'submitting', submission_started_at = ?, updated_at = ?,
             row_version = row_version + 1
         WHERE id = ? AND kind = 'production_media' AND status = 'reserved' AND row_version = ?`,
      )
      .run(
        input.submissionStartedAt,
        input.submissionStartedAt,
        input.attemptId,
        input.expectedAttemptRowVersion,
      ).changes;
    if (assemblyChanged !== 1 || attemptChanged !== 1) {
      throw new Error('Media submission CAS failed');
    }

    const artifact: TaskArtifact = {
      id: input.artifactId,
      taskListId: attempt.taskListId,
      taskId: attempt.taskId,
      attemptId: attempt.id,
      artifactType: 'media_submission',
      entityType: 'canvas-node',
      entityId: attempt.nodeId,
      metadata: {
        taskListId: attempt.taskListId,
        taskId: attempt.taskId,
        attemptId: attempt.id,
        providerId: attempt.providerId,
        modelId: attempt.model,
        promptAssemblyId: attempt.promptAssemblyId,
        promptHash: attempt.promptHash,
        idempotencyKey: attempt.idempotencyKey,
      },
      createdAt: input.submissionStartedAt,
    };
    insertTaskArtifact(db, artifact);
    return {
      attempt: requireProductionMediaTaskAttempt(db, attempt.id),
      artifact: getTaskArtifactByAttempt(db, attempt.id, 'media_submission')!,
      created: true,
    };
  });
  return begin.immediate();
}

/** Atomically binds one provider output to its exact durable attempt. */
export function recordMediaOutput(
  db: BetterSqlite3.Database,
  input: RecordMediaOutputInput,
): RecordMediaOutputResult {
  const record = db.transaction((): RecordMediaOutputResult => {
    const attempt = requireProductionMediaTaskAttempt(db, input.attemptId);
    const existing = getTaskArtifactByAttempt(db, attempt.id, 'media_output');
    if (existing) {
      if (
        existing.id !== input.artifact.id ||
        existing.assetHash !== input.artifact.assetHash ||
        attempt.assetHash !== input.artifact.assetHash ||
        attempt.status !== 'asset_ready'
      ) {
        throw new Error('Media output artifact conflicts with persisted attempt state');
      }
      return { attempt, artifact: existing, created: false };
    }
    if (
      attempt.rowVersion !== input.expectedAttemptRowVersion ||
      (attempt.status !== 'submitting' && attempt.status !== 'awaiting_provider')
    ) {
      throw new Error('Production-media attempt changed before output persistence');
    }
    if (
      input.artifact.artifactType !== 'media_output' ||
      input.artifact.attemptId !== attempt.id ||
      input.artifact.taskListId !== attempt.taskListId ||
      input.artifact.taskId !== attempt.taskId ||
      !input.artifact.assetHash
    ) {
      throw new Error('Media output artifact does not match its production-media attempt');
    }
    if (!input.providerReceipt.trim()) {
      throw new Error('Media output requires a durable provider receipt');
    }
    if (
      input.reportedActualCostUsd !== undefined &&
      (!Number.isFinite(input.reportedActualCostUsd) || input.reportedActualCostUsd < 0)
    ) {
      throw new Error('reportedActualCostUsd must be a non-negative finite number');
    }

    const changed = db
      .prepare(
        `UPDATE task_attempts
         SET status = 'asset_ready', row_version = row_version + 1,
             model = ?, provider_job_id = COALESCE(?, provider_job_id),
             provider_receipt = ?, asset_hash = ?,
             reported_actual_cost_usd = COALESCE(?, reported_actual_cost_usd),
             submitted_at = COALESCE(submitted_at, ?), asset_ready_at = ?, updated_at = ?
         WHERE id = ? AND kind = 'production_media' AND row_version = ?
           AND status IN ('submitting', 'awaiting_provider')`,
      )
      .run(
        input.model,
        input.providerJobId ?? null,
        input.providerReceipt,
        input.artifact.assetHash,
        input.reportedActualCostUsd ?? null,
        input.assetReadyAt,
        input.assetReadyAt,
        input.assetReadyAt,
        attempt.id,
        input.expectedAttemptRowVersion,
      ).changes;
    if (changed !== 1) {
      throw new Error('Production-media output persistence CAS failed');
    }
    insertTaskArtifact(db, input.artifact);
    return {
      attempt: requireProductionMediaTaskAttempt(db, attempt.id),
      artifact: getTaskArtifactByAttempt(db, attempt.id, 'media_output')!,
      created: true,
    };
  });
  return record.immediate();
}

export function getProductionMediaTaskAttempt(
  db: BetterSqlite3.Database,
  id: string,
): ProductionMediaTaskAttempt | undefined {
  const row = db
    .prepare("SELECT * FROM task_attempts WHERE id = ? AND kind = 'production_media'")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToProductionMediaTaskAttempt(row) : undefined;
}

function requireProductionMediaTaskAttempt(
  db: BetterSqlite3.Database,
  id: string,
): ProductionMediaTaskAttempt {
  const attempt = getProductionMediaTaskAttempt(db, id);
  if (!attempt) throw new Error(`Production-media attempt "${id}" disappeared after persistence`);
  return attempt;
}

export function getLatestProductionMediaTaskAttempt(
  db: BetterSqlite3.Database,
  taskListId: string,
  nodeId: string,
): ProductionMediaTaskAttempt | undefined {
  const row = db
    .prepare(
      `SELECT * FROM task_attempts
       WHERE task_list_id = ? AND kind = 'production_media' AND node_id = ?
       ORDER BY attempt DESC LIMIT 1`,
    )
    .get(taskListId, nodeId) as Record<string, unknown> | undefined;
  return row ? rowToProductionMediaTaskAttempt(row) : undefined;
}

export function listProductionMediaTaskAttempts(
  db: BetterSqlite3.Database,
  taskListId: string,
): ProductionMediaTaskAttempt[] {
  const rows = db
    .prepare(
      `SELECT * FROM task_attempts
       WHERE task_list_id = ? AND kind = 'production_media' ORDER BY node_id ASC, attempt ASC`,
    )
    .all(taskListId) as Array<Record<string, unknown>>;
  return rows.map(rowToProductionMediaTaskAttempt);
}

export function listRecoverableProductionMediaTaskAttempts(
  db: BetterSqlite3.Database,
): ProductionMediaTaskAttempt[] {
  const rows = db
    .prepare(
      `SELECT * FROM task_attempts
       WHERE kind = 'production_media'
         AND status IN ('reserved', 'submitting', 'awaiting_provider', 'asset_ready', 'evaluating')
       ORDER BY updated_at ASC, id ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToProductionMediaTaskAttempt);
}

export function transitionProductionMediaTaskAttempt(
  db: BetterSqlite3.Database,
  input: TransitionProductionMediaTaskAttemptInput,
): ProductionMediaTaskAttempt {
  if (input.expectedStatuses.length === 0) {
    throw new Error('Production-media transition requires at least one expected status');
  }
  if (
    input.reportedActualCostUsd !== undefined &&
    (!Number.isFinite(input.reportedActualCostUsd) || input.reportedActualCostUsd < 0)
  ) {
    throw new Error('reportedActualCostUsd must be a non-negative finite number');
  }
  const current = requireProductionMediaTaskAttempt(db, input.id);
  if (!input.expectedStatuses.includes(current.status)) {
    throw new Error('Production-media attempt state changed concurrently');
  }
  const allowed: Partial<
    Record<ProductionMediaTaskAttemptStatus, ProductionMediaTaskAttemptStatus[]>
  > = {
    reserved: ['failed', 'cancelled'],
    submitting: ['awaiting_provider', 'asset_ready', 'ambiguous', 'failed', 'cancelled'],
    awaiting_provider: ['asset_ready', 'ambiguous', 'failed', 'cancelled'],
    asset_ready: ['evaluating', 'human_review', 'failed', 'cancelled'],
    evaluating: ['asset_ready', 'human_review', 'failed', 'cancelled'],
  };
  if (!allowed[current.status]?.includes(input.status)) {
    throw new Error(`Invalid production-media transition: ${current.status} -> ${input.status}`);
  }
  if (input.status === 'awaiting_provider' && !input.providerReceipt?.trim()) {
    throw new Error('Provider receipt is required before awaiting provider recovery');
  }
  const resultingAssetHash = input.assetHash ?? current.assetHash;
  if ((input.status === 'asset_ready' || input.status === 'evaluating') && !resultingAssetHash) {
    throw new Error(`${input.status} requires a persisted output asset hash`);
  }
  if (input.status === 'evaluating' && !getTaskArtifactByAttempt(db, current.id, 'media_output')) {
    throw new Error('Evaluation requires the exact persisted media output artifact');
  }
  const placeholders = input.expectedStatuses.map(() => '?').join(', ');
  const changed = db
    .prepare(
      `UPDATE task_attempts
       SET status = ?, row_version = row_version + 1,
           model = COALESCE(?, model), provider_job_id = COALESCE(?, provider_job_id),
           provider_receipt = COALESCE(?, provider_receipt),
           asset_hash = COALESCE(?, asset_hash),
           reported_actual_cost_usd = COALESCE(?, reported_actual_cost_usd),
           error_text = ?, submitted_at = COALESCE(?, submitted_at),
           submission_started_at = COALESCE(?, submission_started_at),
           cancel_requested_at = COALESCE(?, cancel_requested_at),
           asset_ready_at = COALESCE(?, asset_ready_at),
           evaluated_at = COALESCE(?, evaluated_at),
           completed_at = COALESCE(?, completed_at), updated_at = ?
       WHERE id = ? AND kind = 'production_media'
         AND row_version = ? AND status IN (${placeholders})`,
    )
    .run(
      input.status,
      input.model ?? null,
      input.providerJobId ?? null,
      input.providerReceipt ?? null,
      input.assetHash ?? null,
      input.reportedActualCostUsd ?? null,
      input.error ?? null,
      input.submittedAt ?? null,
      input.submissionStartedAt ?? null,
      input.cancelRequestedAt ?? null,
      input.assetReadyAt ?? null,
      input.evaluatedAt ?? null,
      input.completedAt ?? null,
      input.updatedAt,
      input.id,
      input.expectedRowVersion,
      ...input.expectedStatuses,
    ).changes;
  if (changed !== 1) {
    throw new Error('Production-media attempt state changed concurrently');
  }
  return requireProductionMediaTaskAttempt(db, input.id);
}

export function recordTaskEvaluation(
  db: BetterSqlite3.Database,
  input: RecordTaskEvaluationInput,
): RecordTaskEvaluationResult {
  if (input.expectedAttemptStatuses.length === 0) {
    throw new Error('Media evaluation requires an expected attempt status');
  }
  const record = db.transaction((): RecordTaskEvaluationResult => {
    const evaluation = input.evaluation;
    const attemptRow = db
      .prepare("SELECT * FROM task_attempts WHERE id = ? AND kind = 'production_media'")
      .get(evaluation.attemptId) as Record<string, unknown> | undefined;
    if (!attemptRow)
      throw new Error(`Production-media attempt "${evaluation.attemptId}" not found`);
    const attempt = rowToProductionMediaTaskAttempt(attemptRow);
    if (
      attempt.taskListId !== evaluation.taskListId ||
      attempt.canvasId !== evaluation.canvasId ||
      attempt.nodeId !== evaluation.nodeId ||
      attempt.assetHash !== evaluation.assetHash ||
      attempt.mediaType !== evaluation.mediaType
    ) {
      throw new Error('Media evaluation identity does not match its provider attempt');
    }
    const artifact = getTaskArtifactByAttempt(db, attempt.id, 'media_output');
    const expectedProfile = {
      canvas: 'canvas_media.v1',
      style_audition: 'style_audition.v1',
      production: 'production_media.v1',
    } as const;
    if (
      !artifact ||
      artifact.id !== evaluation.artifactId ||
      artifact.assetHash !== evaluation.assetHash ||
      evaluation.profile !== expectedProfile[attempt.scope] ||
      evaluation.sourcePromptHash !== attempt.promptHash
    ) {
      throw new Error('Media evaluation lineage does not match its exact output artifact');
    }
    if (
      evaluation.repairDelta &&
      (!Array.isArray(evaluation.repairDelta.reasonCodes) ||
        evaluation.repairDelta.reasonCodes.length === 0 ||
        evaluation.repairDelta.sourceEvaluationId !== evaluation.id ||
        evaluation.repairDelta.sourceArtifactId !== evaluation.artifactId)
    ) {
      throw new Error('Evaluation Repair Delta is missing exact evaluation/artifact lineage');
    }

    const existingRow = db
      .prepare('SELECT * FROM task_evaluations WHERE attempt_id = ?')
      .get(evaluation.attemptId) as Record<string, unknown> | undefined;
    if (existingRow) {
      const existing = rowToTaskEvaluation(existingRow);
      if (JSON.stringify(existing) !== JSON.stringify(evaluation)) {
        throw new Error('A different immutable evaluation already exists for this attempt');
      }
      return { evaluation: existing, attempt, created: false };
    }

    if (
      attempt.rowVersion !== input.expectedAttemptRowVersion ||
      attempt.status !== 'evaluating' ||
      !input.expectedAttemptStatuses.includes('evaluating')
    ) {
      throw new Error('Production-media attempt changed before evaluation was recorded');
    }

    db.prepare(
      `INSERT INTO task_evaluations (
         id, attempt_id, task_list_id, task_id, kind, canvas_id, node_id, artifact_id,
         asset_hash, media_type, profile, source_prompt_hash,
         rubric_version, evaluator_provider_id, evaluator_model,
         scores_json, total, verdict, strengths_json, risks_json, evidence_json,
         repair_delta_json, metadata_json, frame_evidence_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      evaluation.id,
      evaluation.attemptId,
      evaluation.taskListId,
      attempt.taskId ?? null,
      'production_media',
      evaluation.canvasId,
      evaluation.nodeId,
      evaluation.artifactId,
      evaluation.assetHash,
      evaluation.mediaType,
      evaluation.profile,
      evaluation.sourcePromptHash,
      evaluation.rubricVersion,
      evaluation.evaluatorProviderId,
      evaluation.evaluatorModel ?? null,
      JSON.stringify(evaluation.scores),
      evaluation.total,
      evaluation.verdict,
      JSON.stringify(evaluation.strengths),
      JSON.stringify(evaluation.risks),
      JSON.stringify(evaluation.evidence),
      evaluation.repairDelta ? JSON.stringify(evaluation.repairDelta) : null,
      JSON.stringify(evaluation.metadata),
      JSON.stringify(evaluation.frameEvidence),
      evaluation.createdAt,
    );

    const placeholders = input.expectedAttemptStatuses.map(() => '?').join(', ');
    const changed = db
      .prepare(
        `UPDATE task_attempts
         SET status = ?, row_version = row_version + 1, evaluated_at = ?,
             completed_at = ?, error_text = NULL, updated_at = ?
         WHERE id = ? AND kind = 'production_media'
           AND row_version = ? AND status IN (${placeholders})`,
      )
      .run(
        input.resultingAttemptStatus,
        input.evaluatedAt,
        input.evaluatedAt,
        input.evaluatedAt,
        attempt.id,
        input.expectedAttemptRowVersion,
        ...input.expectedAttemptStatuses,
      ).changes;
    if (changed !== 1) throw new Error('Production-media evaluation CAS failed');

    return {
      evaluation: requireTaskEvaluation(db, evaluation.attemptId),
      attempt: requireProductionMediaTaskAttempt(db, attempt.id),
      created: true,
    };
  });
  return record.immediate();
}

export function getTaskEvaluation(
  db: BetterSqlite3.Database,
  attemptId: string,
): TaskEvaluation | undefined {
  const row = db.prepare('SELECT * FROM task_evaluations WHERE attempt_id = ?').get(attemptId) as
    Record<string, unknown> | undefined;
  return row ? rowToTaskEvaluation(row) : undefined;
}

function requireTaskEvaluation(db: BetterSqlite3.Database, attemptId: string): TaskEvaluation {
  const evaluation = getTaskEvaluation(db, attemptId);
  if (!evaluation) {
    throw new Error(`Production-media evaluation "${attemptId}" disappeared after persistence`);
  }
  return evaluation;
}

export function listTaskEvaluations(
  db: BetterSqlite3.Database,
  taskListId: string,
): TaskEvaluation[] {
  const rows = db
    .prepare(
      `SELECT * FROM task_evaluations
       WHERE task_list_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(taskListId) as Array<Record<string, unknown>>;
  return rows.map(rowToTaskEvaluation);
}

export function getTaskCostSummary(
  db: BetterSqlite3.Database,
  taskListId: string,
): TaskCostSummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS attempt_count,
              COALESCE(SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END), 0) AS regeneration_count,
              COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
              COALESCE(SUM(reported_actual_cost_usd), 0) AS reported_actual_cost_usd,
              COALESCE(SUM(COALESCE(reported_actual_cost_usd, estimated_cost_usd)), 0) AS committed_cost_usd,
              COALESCE(SUM(CASE WHEN reported_actual_cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unreported_count
       FROM task_attempts WHERE task_list_id = ? AND kind = 'production_media'`,
    )
    .get(taskListId) as Record<string, unknown>;
  return {
    attemptCount: Number(row.attempt_count),
    regenerationCount: Number(row.regeneration_count),
    estimatedCostUsd: Number(row.estimated_cost_usd),
    reportedActualCostUsd: Number(row.reported_actual_cost_usd),
    committedCostUsd: Number(row.committed_cost_usd),
    hasUnreportedActualCosts: Number(row.unreported_count) > 0,
  };
}

export function reserveDeliveryPackageTaskAttempt(
  db: BetterSqlite3.Database,
  input: ReserveDeliveryPackageTaskAttemptInput,
): ReserveDeliveryPackageTaskAttemptResult {
  const reserve = db.transaction((): ReserveDeliveryPackageTaskAttemptResult => {
    const proposed = input.attempt;
    if (
      proposed.kind !== 'batch_export' ||
      proposed.status !== 'queued' ||
      proposed.rowVersion !== 0 ||
      proposed.attempt !== 1
    ) {
      throw new Error('New Delivery package execution must begin queued at rowVersion 0 and attempt 1');
    }
    const taskListRow = db
      .prepare('SELECT current_gate FROM task_lists WHERE id = ?')
      .get(proposed.taskListId) as { current_gate: string | null } | undefined;
    if (!taskListRow) throw new Error(`TaskList "${proposed.taskListId}" not found`);
    if (taskListRow.current_gate !== null) {
      throw new Error(`TaskList is awaiting ${taskListRow.current_gate} approval`);
    }
    const approval = db
      .prepare(
        `SELECT subject_revision, subject_hash, status
         FROM plan_approvals
         WHERE task_list_id = ? AND gate_key = 'delivery'
         ORDER BY subject_revision DESC, created_at DESC
         LIMIT 1`,
      )
      .get(proposed.taskListId) as
      { subject_revision: number; subject_hash: string; status: string } | undefined;
    if (
      !approval ||
      approval.status !== 'approved' ||
      Number(approval.subject_revision) !== proposed.manifestRevision ||
      String(approval.subject_hash) !== proposed.manifestHash
    ) {
      throw new Error('Exact approved Delivery package manifest is required before execution');
    }

    const existingRow = db
      .prepare(
        `SELECT * FROM task_attempts
         WHERE idempotency_key = ?
            OR (task_list_id = ? AND manifest_revision = ? AND manifest_hash = ?)
         LIMIT 1`,
      )
      .get(
        proposed.idempotencyKey,
        proposed.taskListId,
        proposed.manifestRevision,
        proposed.manifestHash,
      ) as Record<string, unknown> | undefined;
    if (existingRow) {
      const existing = rowToDeliveryPackageTaskAttempt(existingRow);
      if (
        existing.idempotencyKey !== proposed.idempotencyKey ||
        existing.destinationPath !== proposed.destinationPath
      ) {
        throw new Error(
          'Delivery package execution already exists with a different identity or destination',
        );
      }
      return { attempt: existing, created: false };
    }

    db.prepare(
      `INSERT INTO task_attempts (
         id, task_list_id, task_id, kind, manifest_revision, manifest_hash, idempotency_key,
         status, row_version, staging_path, destination_path, package_hash,
         package_bytes, file_count, attempt, error_text, created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      proposed.id,
      proposed.taskListId,
      proposed.taskId ?? null,
      'batch_export',
      proposed.manifestRevision,
      proposed.manifestHash,
      proposed.idempotencyKey,
      proposed.status,
      proposed.rowVersion,
      proposed.stagingPath ?? null,
      proposed.destinationPath,
      proposed.packageHash ?? null,
      proposed.packageBytes ?? null,
      proposed.fileCount ?? null,
      proposed.attempt,
      proposed.error ?? null,
      proposed.createdAt,
      proposed.updatedAt,
      proposed.completedAt ?? null,
    );
    const createdRow = db
      .prepare("SELECT * FROM task_attempts WHERE id = ? AND kind = 'batch_export'")
      .get(proposed.id) as Record<string, unknown>;
    return { attempt: rowToDeliveryPackageTaskAttempt(createdRow), created: true };
  });
  return reserve.immediate();
}

export function getDeliveryPackageTaskAttempt(
  db: BetterSqlite3.Database,
  id: string,
): DeliveryPackageTaskAttempt | undefined {
  const row = db
    .prepare("SELECT * FROM task_attempts WHERE id = ? AND kind = 'batch_export'")
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToDeliveryPackageTaskAttempt(row) : undefined;
}

function requireDeliveryPackageTaskAttempt(
  db: BetterSqlite3.Database,
  id: string,
): DeliveryPackageTaskAttempt {
  const execution = getDeliveryPackageTaskAttempt(db, id);
  if (!execution) throw new Error(`Delivery package execution "${id}" disappeared after persistence`);
  return execution;
}

export function getLatestDeliveryPackageTaskAttempt(
  db: BetterSqlite3.Database,
  taskListId: string,
): DeliveryPackageTaskAttempt | undefined {
  const row = db
    .prepare(
      `SELECT * FROM task_attempts
       WHERE task_list_id = ? AND kind = 'batch_export'
       ORDER BY manifest_revision DESC, created_at DESC
       LIMIT 1`,
    )
    .get(taskListId) as Record<string, unknown> | undefined;
  return row ? rowToDeliveryPackageTaskAttempt(row) : undefined;
}

export function listRecoverableDeliveryPackageTaskAttempts(
  db: BetterSqlite3.Database,
): DeliveryPackageTaskAttempt[] {
  const rows = db
    .prepare(
      `SELECT * FROM task_attempts
       WHERE kind = 'batch_export'
         AND status IN ('queued', 'running', 'ready_to_publish', 'recovery_required')
       ORDER BY updated_at ASC, id ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToDeliveryPackageTaskAttempt);
}

export function transitionDeliveryPackageTaskAttempt(
  db: BetterSqlite3.Database,
  input: TransitionDeliveryPackageTaskAttemptInput,
): DeliveryPackageTaskAttempt {
  if (input.expectedStatuses.length === 0) {
    throw new Error('Delivery package transition requires at least one expected status');
  }
  const placeholders = input.expectedStatuses.map(() => '?').join(', ');
  const changed = db
    .prepare(
      `UPDATE task_attempts
       SET status = ?, row_version = row_version + 1,
           staging_path = COALESCE(?, staging_path),
           package_hash = COALESCE(?, package_hash),
           package_bytes = COALESCE(?, package_bytes),
           file_count = COALESCE(?, file_count),
           error_text = ?, updated_at = ?
       WHERE id = ? AND kind = 'batch_export'
         AND row_version = ? AND status IN (${placeholders})`,
    )
    .run(
      input.status,
      input.stagingPath ?? null,
      input.packageHash ?? null,
      input.packageBytes ?? null,
      input.fileCount ?? null,
      input.error ?? null,
      input.updatedAt,
      input.id,
      input.expectedRowVersion,
      ...input.expectedStatuses,
    ).changes;
  if (changed !== 1) throw new Error('Delivery package execution state changed concurrently');
  return requireDeliveryPackageTaskAttempt(db, input.id);
}

export function retryDeliveryPackageTaskAttempt(
  db: BetterSqlite3.Database,
  input: { id: string; expectedRowVersion: number; updatedAt: number },
): DeliveryPackageTaskAttempt {
  const changed = db
    .prepare(
      `UPDATE task_attempts
       SET status = 'queued', row_version = row_version + 1, attempt = attempt + 1,
           staging_path = NULL, package_hash = NULL, package_bytes = NULL,
           file_count = NULL, error_text = NULL, completed_at = NULL, updated_at = ?
       WHERE id = ? AND kind = 'batch_export' AND row_version = ?
         AND status IN ('failed', 'cancelled', 'recovery_required')`,
    )
    .run(input.updatedAt, input.id, input.expectedRowVersion).changes;
  if (changed !== 1)
    throw new Error('Delivery package execution is not retryable or changed concurrently');
  return requireDeliveryPackageTaskAttempt(db, input.id);
}

export function completeDeliveryPackageTaskAttempt(
  db: BetterSqlite3.Database,
  input: CompleteDeliveryPackageTaskAttemptInput,
): { attempt: DeliveryPackageTaskAttempt; taskList: TaskList; event: TaskEvent } {
  const complete = db.transaction(() => {
    const executionRow = db
      .prepare("SELECT * FROM task_attempts WHERE id = ? AND kind = 'batch_export'")
      .get(input.id) as Record<string, unknown> | undefined;
    if (!executionRow) throw new Error(`Delivery package execution "${input.id}" not found`);
    const execution = rowToDeliveryPackageTaskAttempt(executionRow);
    if (
      execution.rowVersion !== input.expectedExecutionRowVersion ||
      execution.status !== 'ready_to_publish'
    ) {
      throw new Error('Delivery package execution is not ready to complete or changed concurrently');
    }
    const executionChanged = db
      .prepare(
        `UPDATE task_attempts
         SET status = 'completed', row_version = row_version + 1,
             package_hash = ?, package_bytes = ?, file_count = ?,
             error_text = NULL, updated_at = ?, completed_at = ?
         WHERE id = ? AND row_version = ? AND status = 'ready_to_publish'`,
      )
      .run(
        input.packageHash,
        input.packageBytes,
        input.fileCount,
        input.completedAt,
        input.completedAt,
        input.id,
        input.expectedExecutionRowVersion,
      ).changes;
    if (executionChanged !== 1) throw new Error('Delivery package completion CAS failed');

    const finalTaskRow = db
      .prepare(
        `SELECT tasks.*
         FROM tasks
         WHERE tasks.task_list_id = ?
           AND tasks.phase_key = 'delivery'
           AND tasks.task_key = 'delivery'
         LIMIT 1`,
      )
      .get(execution.taskListId) as Record<string, unknown> | undefined;
    if (!finalTaskRow) throw new Error('Delivery package task list task is missing');
    const finalTask = rowToTask(db, finalTaskRow);
    const finalTaskChanged = db
      .prepare(
        `UPDATE tasks
         SET status = 'completed', progress = 100, current_step = 'published',
             output_json = ?, error_text = NULL, completed_at = ?, updated_at = ?
         WHERE id = ? AND task_list_id = ? AND status IN ('ready', 'running')`,
      )
      .run(
        JSON.stringify({
          executionId: execution.id,
          packageHash: input.packageHash,
          packageBytes: input.packageBytes,
          fileCount: input.fileCount,
        }),
        input.completedAt,
        input.completedAt,
        finalTask.id,
        execution.taskListId,
      ).changes;
    if (finalTaskChanged !== 1) {
      throw new Error(
        `Delivery package task list task cannot complete from status "${finalTask.status}"`,
      );
    }
    const taskListIdentity = db
      .prepare('SELECT entity_type, entity_id FROM task_lists WHERE id = ?')
      .get(execution.taskListId) as { entity_type: string; entity_id: string | null } | undefined;
    if (!taskListIdentity) throw new Error('Delivery package Task List disappeared before completion');
    insertTaskArtifact(db, {
      id: `delivery-package-output:${execution.id}`,
      taskListId: execution.taskListId,
      taskId: finalTask.id,
      attemptId: execution.id,
      artifactType: 'delivery_package',
      entityType: taskListIdentity.entity_type,
      entityId: taskListIdentity.entity_id ?? undefined,
      path: execution.destinationPath,
      metadata: {
        manifestRevision: execution.manifestRevision,
        manifestHash: execution.manifestHash,
        packageHash: input.packageHash,
        packageBytes: input.packageBytes,
        fileCount: input.fileCount,
      },
      createdAt: input.completedAt,
    });
    recomputePhaseAggregate(db, finalTask.taskListId, finalTask.phaseKey);

    const taskListChanged = db
      .prepare(
        `UPDATE task_lists
         SET status = 'completed', summary = 'Delivery package completed', progress = 100,
             completed_phases = total_phases, completed_tasks = total_tasks,
             current_phase_key = NULL, current_task_id = NULL,
             output_json = ?, error_text = NULL, completed_at = ?, updated_at = ?,
             row_version = row_version + 1
         WHERE id = ? AND row_version = ? AND current_gate IS NULL`,
      )
      .run(
        JSON.stringify(input.taskListOutput),
        input.completedAt,
        input.completedAt,
        execution.taskListId,
        input.expectedTaskListRowVersion,
      ).changes;
    if (taskListChanged !== 1) {
      throw new Error('TaskList changed before Delivery package completion');
    }

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM task_events WHERE task_list_id = ?',
      )
      .get(execution.taskListId) as { next_seq: number };
    const event: TaskEvent = { ...input.event, seq: Number(seqRow.next_seq) };
    insertTaskEvent(db, event);

    const updatedExecution = requireDeliveryPackageTaskAttempt(db, input.id);
    const updatedTaskListRow = db
      .prepare('SELECT * FROM task_lists WHERE id = ?')
      .get(execution.taskListId) as Record<string, unknown>;
    return { attempt: updatedExecution, taskList: rowToTaskList(updatedTaskListRow), event };
  });
  return complete.immediate();
}

function insertTaskEvent(db: BetterSqlite3.Database, event: TaskEvent): void {
  db.prepare(
    `INSERT INTO task_events (
       task_list_id, seq, event_id, actor, correlation_id, causation_id,
       payload_json, event_timestamp
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.taskListId,
    event.seq,
    event.eventId,
    event.actor,
    event.correlationId ?? null,
    event.causationId ?? null,
    JSON.stringify(event.payload),
    event.timestamp,
  );
}

// --- Tasks ---

export function insertTask(db: BetterSqlite3.Database, task: Task): void {
  db.prepare(
    `
    INSERT INTO tasks (
      id, task_list_id, phase_key, phase_name, phase_order, task_key, name, kind, status,
      provider, dependency_ids_json, attempts, max_retries,
      input_json, output_json, provider_task_id, asset_id, error_text,
      progress, current_step, started_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    task.id,
    task.taskListId,
    task.phaseKey,
    task.phaseName,
    task.phaseOrder,
    task.taskKey,
    task.name,
    task.kind,
    task.status,
    task.provider ?? null,
    JSON.stringify(task.dependencyIds),
    task.attempts,
    task.maxRetries,
    JSON.stringify(task.input),
    JSON.stringify(task.output),
    task.providerTaskId ?? null,
    task.assetId ?? null,
    task.error ?? null,
    task.progress,
    task.currentStep ?? null,
    task.startedAt ?? null,
    task.completedAt ?? null,
    task.updatedAt,
  );

  replaceTaskDependencies(db, task.id, task.dependencyIds);
}

export function listTasks(db: BetterSqlite3.Database, taskListId: string): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE task_list_id = ?
         AND json_extract(input_json, '$.invalidatedByPlanRevision') IS NULL
       ORDER BY phase_order ASC, updated_at DESC, id ASC`,
    )
    .all(taskListId) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const depsMap = listTaskDependenciesBatch(db, ids);
  return rows.map((row) => rowToTaskWithDeps(row, depsMap));
}

export function listTasksByPhase(
  db: BetterSqlite3.Database,
  taskListId: string,
  phaseKey: string,
): Task[] {
  const rows = db
    .prepare(
      `SELECT * FROM tasks
       WHERE task_list_id = ? AND phase_key = ?
         AND json_extract(input_json, '$.invalidatedByPlanRevision') IS NULL
       ORDER BY updated_at DESC, id ASC`,
    )
    .all(taskListId, phaseKey) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const depsMap = listTaskDependenciesBatch(db, ids);
  return rows.map((row) => rowToTaskWithDeps(row, depsMap));
}

export function listReadyTasks(db: BetterSqlite3.Database, taskListId?: string): Task[] {
  const params: unknown[] = ['ready'];
  let where = 'status = ?';

  if (taskListId !== undefined) {
    where += ' AND task_list_id = ?';
    params.push(taskListId);
  }

  const rows = db
    .prepare(`SELECT * FROM tasks WHERE ${where} ORDER BY updated_at ASC, id ASC`)
    .all(...params) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const depsMap = listTaskDependenciesBatch(db, ids);
  return rows.map((row) => rowToTaskWithDeps(row, depsMap));
}

export function listAwaitingProviderTasks(db: BetterSqlite3.Database, taskListId?: string): Task[] {
  const params: unknown[] = ['awaiting_provider'];
  let where = 'status = ?';

  if (taskListId !== undefined) {
    where += ' AND task_list_id = ?';
    params.push(taskListId);
  }

  const rows = db
    .prepare(`SELECT * FROM tasks WHERE ${where} ORDER BY updated_at ASC, id ASC`)
    .all(...params) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const depsMap = listTaskDependenciesBatch(db, ids);
  return rows.map((row) => rowToTaskWithDeps(row, depsMap));
}

export function listRecoverableTasks(db: BetterSqlite3.Database, taskListId?: string): Task[] {
  const params: unknown[] = [];
  const taskListCondition = taskListId === undefined ? '' : 'AND tasks.task_list_id = ?';
  if (taskListId !== undefined) params.push(taskListId);
  const rows = db
    .prepare(
      `SELECT tasks.*,
              COALESCE((
                SELECT json_group_array(ordered.depends_on_task_id)
                  FROM (
                    SELECT depends_on_task_id
                      FROM task_dependencies
                     WHERE task_id = tasks.id
                     ORDER BY depends_on_task_id
                  ) ordered
              ), '[]') AS recoverable_dependency_ids_json
         FROM tasks
         JOIN task_lists ON task_lists.id = tasks.task_list_id
        WHERE tasks.status IN ('running', 'awaiting_provider')
          AND task_lists.current_gate IS NULL
          AND json_extract(tasks.input_json, '$.invalidatedByPlanRevision') IS NULL
          ${taskListCondition}
        ORDER BY tasks.updated_at ASC, tasks.id ASC`,
    )
    .all(...params) as Array<Record<string, unknown>>;
  const depsMap = new Map(
    rows.map((row) => [
      String(row.id),
      JSON.parse(String(row.recoverable_dependency_ids_json ?? '[]')) as string[],
    ]),
  );
  return rows.map((row) => rowToTaskWithDeps(row, depsMap));
}

export function getTask(db: BetterSqlite3.Database, id: string): Task | undefined {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToTask(db, row);
}

export function updateTask(
  db: BetterSqlite3.Database,
  id: string,
  updates: Partial<
    Pick<
      Task,
      | 'status'
      | 'provider'
      | 'dependencyIds'
      | 'attempts'
      | 'maxRetries'
      | 'input'
      | 'output'
      | 'providerTaskId'
      | 'assetId'
      | 'error'
      | 'progress'
      | 'currentStep'
      | 'startedAt'
      | 'completedAt'
      | 'updatedAt'
    >
  >,
): void {
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.status !== undefined) {
    sets.push('status = ?');
    params.push(updates.status);
  }
  if (updates.provider !== undefined) {
    sets.push('provider = ?');
    params.push(updates.provider);
  }
  if (updates.dependencyIds !== undefined) {
    sets.push('dependency_ids_json = ?');
    params.push(JSON.stringify(updates.dependencyIds));
  }
  if (updates.attempts !== undefined) {
    sets.push('attempts = ?');
    params.push(updates.attempts);
  }
  if (updates.maxRetries !== undefined) {
    sets.push('max_retries = ?');
    params.push(updates.maxRetries);
  }
  if (updates.input !== undefined) {
    sets.push('input_json = ?');
    params.push(JSON.stringify(updates.input));
  }
  if (updates.output !== undefined) {
    sets.push('output_json = ?');
    params.push(JSON.stringify(updates.output));
  }
  if (updates.providerTaskId !== undefined) {
    sets.push('provider_task_id = ?');
    params.push(updates.providerTaskId);
  }
  if (updates.assetId !== undefined) {
    sets.push('asset_id = ?');
    params.push(updates.assetId);
  }
  if (updates.error !== undefined) {
    sets.push('error_text = ?');
    params.push(updates.error);
  }
  if (updates.progress !== undefined) {
    sets.push('progress = ?');
    params.push(updates.progress);
  }
  if (updates.currentStep !== undefined) {
    sets.push('current_step = ?');
    params.push(updates.currentStep);
  }
  if (updates.startedAt !== undefined) {
    sets.push('started_at = ?');
    params.push(updates.startedAt);
  }
  if (updates.completedAt !== undefined) {
    sets.push('completed_at = ?');
    params.push(updates.completedAt);
  }
  if (updates.updatedAt !== undefined) {
    sets.push('updated_at = ?');
    params.push(updates.updatedAt);
  }

  if (sets.length === 0) return;
  params.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  if (updates.dependencyIds !== undefined) {
    replaceTaskDependencies(db, id, updates.dependencyIds);
  }
}

// --- Task Dependencies ---

export function replaceTaskDependencies(
  db: BetterSqlite3.Database,
  taskId: string,
  dependencyIds: string[],
): void {
  const replaceDependencies = db.transaction((nextDependencyIds: string[]) => {
    const uniqueDependencyIds = [...new Set(nextDependencyIds)];
    if (uniqueDependencyIds.includes(taskId)) {
      throw new Error('A task cannot depend on itself');
    }
    const task = db.prepare('SELECT task_list_id FROM tasks WHERE id = ?').get(taskId) as
      { task_list_id: string } | undefined;
    if (!task) throw new Error(`Task "${taskId}" does not exist`);
    if (uniqueDependencyIds.length > 0) {
      const placeholders = uniqueDependencyIds.map(() => '?').join(', ');
      const valid = db
        .prepare(
          `SELECT COUNT(*) AS count FROM tasks
           WHERE task_list_id = ? AND id IN (${placeholders})`,
        )
        .get(task.task_list_id, ...uniqueDependencyIds) as { count: number };
      if (Number(valid.count) !== uniqueDependencyIds.length) {
        throw new Error('Task dependencies must exist in the same task list');
      }
    }
    db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(taskId);
    const insertDependency = db.prepare(`
      INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_task_id)
      VALUES (?, ?)
    `);
    for (const dependencyId of uniqueDependencyIds) {
      insertDependency.run(taskId, dependencyId);
    }
    db.prepare('UPDATE tasks SET dependency_ids_json = ? WHERE id = ?').run(
      JSON.stringify(uniqueDependencyIds),
      taskId,
    );
  });

  replaceDependencies(dependencyIds);
}

export function listTaskDependencies(db: BetterSqlite3.Database, taskId: string): string[] {
  const rows = db
    .prepare(
      'SELECT depends_on_task_id FROM task_dependencies WHERE task_id = ? ORDER BY depends_on_task_id ASC',
    )
    .all(taskId) as Array<{ depends_on_task_id: string }>;
  return rows.map((row) => row.depends_on_task_id);
}

/**
 * Batch version of listTaskDependencies — fetches dependencies for all
 * provided Task IDs in a single query, avoiding N+1 per-row lookups.
 * Returns a Map<taskId, dependsOnTaskId[]>.
 */
export function listTaskDependenciesBatch(
  db: BetterSqlite3.Database,
  taskIds: string[],
): Map<string, string[]> {
  if (taskIds.length === 0) return new Map();
  const placeholders = taskIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT task_id, depends_on_task_id
       FROM task_dependencies
       WHERE task_id IN (${placeholders})
       ORDER BY task_id ASC, depends_on_task_id ASC`,
    )
    .all(...taskIds) as Array<{ task_id: string; depends_on_task_id: string }>;
  const result = new Map<string, string[]>();
  for (const id of taskIds) result.set(id, []);
  for (const row of rows) {
    result.get(row.task_id)!.push(row.depends_on_task_id);
  }
  return result;
}

export function listTaskDependents(db: BetterSqlite3.Database, dependsOnTaskId: string): string[] {
  const rows = db
    .prepare(
      'SELECT task_id FROM task_dependencies WHERE depends_on_task_id = ? ORDER BY task_id ASC',
    )
    .all(dependsOnTaskId) as Array<{ task_id: string }>;
  return rows.map((row) => row.task_id);
}

// --- TaskList Artifacts ---

export function insertTaskArtifact(db: BetterSqlite3.Database, artifact: TaskArtifact): void {
  assertTaskArtifactLineage(db, artifact);
  db.prepare(
    `
    INSERT INTO task_artifacts (
      id, task_list_id, task_id, attempt_id, artifact_type, entity_type,
      entity_id, asset_hash, path, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    artifact.id,
    artifact.taskListId,
    artifact.taskId,
    artifact.attemptId ?? null,
    artifact.artifactType,
    artifact.entityType ?? null,
    artifact.entityId ?? null,
    artifact.assetHash ?? null,
    artifact.path ?? null,
    JSON.stringify(artifact.metadata),
    artifact.createdAt,
  );
}

function assertTaskArtifactLineage(db: BetterSqlite3.Database, artifact: TaskArtifact): void {
  if (artifact.artifactType !== 'media_submission' && artifact.artifactType !== 'media_output') {
    return;
  }
  if (!artifact.attemptId) throw new Error('Media artifact requires an exact attempt binding');
  const attempt = requireProductionMediaTaskAttempt(db, artifact.attemptId);
  if (attempt.taskListId !== artifact.taskListId || attempt.taskId !== artifact.taskId) {
    throw new Error('Media artifact Task List/Task binding does not match its attempt');
  }
  const requiredMetadata: Record<string, string> = {
    taskListId: attempt.taskListId,
    taskId: attempt.taskId,
    attemptId: attempt.id,
    providerId: attempt.providerId,
    modelId: attempt.model,
    promptAssemblyId: attempt.promptAssemblyId,
    promptHash: attempt.promptHash,
    idempotencyKey: attempt.idempotencyKey,
  };
  for (const [key, value] of Object.entries(requiredMetadata)) {
    if (artifact.metadata[key] !== value) {
      throw new Error(`Media artifact metadata does not match attempt ${key}`);
    }
  }
  if (attempt.providerReceipt && artifact.metadata.providerReceipt !== attempt.providerReceipt) {
    throw new Error('Media artifact provider receipt does not match its attempt');
  }
  if (artifact.artifactType === 'media_submission') {
    if (artifact.assetHash || artifact.path) {
      throw new Error('Media submission artifact cannot claim a generated asset');
    }
    return;
  }
  if (
    !artifact.assetHash ||
    artifact.assetHash !== attempt.assetHash ||
    artifact.metadata.contentHash !== artifact.assetHash ||
    typeof artifact.metadata.assetEntryId !== 'string' ||
    !artifact.metadata.assetEntryId
  ) {
    throw new Error('Media output artifact requires exact Asset entry/content lineage');
  }
  const assetEntry = db
    .prepare('SELECT asset_hash FROM asset_entries WHERE id = ?')
    .get(artifact.metadata.assetEntryId) as { asset_hash: string } | undefined;
  if (!assetEntry || assetEntry.asset_hash !== artifact.assetHash) {
    throw new Error('Media output artifact references a missing or different Asset entry');
  }
}

export function getTaskArtifactByAttempt(
  db: BetterSqlite3.Database,
  attemptId: string,
  artifactType: string,
): TaskArtifact | undefined {
  const row = db
    .prepare('SELECT * FROM task_artifacts WHERE attempt_id = ? AND artifact_type = ?')
    .get(attemptId, artifactType) as Record<string, unknown> | undefined;
  return row ? rowToTaskArtifact(row) : undefined;
}

export function listTaskArtifacts(db: BetterSqlite3.Database, taskListId: string): TaskArtifact[] {
  const rows = db
    .prepare('SELECT * FROM task_artifacts WHERE task_list_id = ? ORDER BY created_at DESC, id ASC')
    .all(taskListId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToTaskArtifact(row));
}

export function listEntityArtifacts(
  db: BetterSqlite3.Database,
  entityType: string,
  entityId: string,
): TaskArtifact[] {
  const rows = db
    .prepare(
      'SELECT * FROM task_artifacts WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, id ASC',
    )
    .all(entityType, entityId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToTaskArtifact(row));
}

export function listTaskArtifactsByTask(
  db: BetterSqlite3.Database,
  taskId: string,
): TaskArtifact[] {
  const rows = db
    .prepare('SELECT * FROM task_artifacts WHERE task_id = ? ORDER BY created_at DESC, id ASC')
    .all(taskId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToTaskArtifact(row));
}

/**
 * Batch version of listTaskArtifactsByTask — fetches artifacts for all
 * provided Task IDs in a single query, avoiding N+1 per-row lookups.
 * Returns a Map<taskId, TaskArtifact[]>.
 */
export function listTaskArtifactsByTaskBatch(
  db: BetterSqlite3.Database,
  taskIds: string[],
): Map<string, TaskArtifact[]> {
  if (taskIds.length === 0) return new Map();
  const placeholders = taskIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT * FROM task_artifacts
       WHERE task_id IN (${placeholders})
       ORDER BY created_at DESC, id ASC`,
    )
    .all(...taskIds) as Array<Record<string, unknown>>;
  const result = new Map<string, TaskArtifact[]>();
  for (const id of taskIds) result.set(id, []);
  for (const row of rows) {
    const taskId = row.task_id as string;
    result.get(taskId)?.push(rowToTaskArtifact(row));
  }
  return result;
}

// --- Task Summaries ---

export function listTaskSummaries(
  db: BetterSqlite3.Database,
  filter?: {
    taskListId?: string;
    phaseKey?: string;
    status?: Task['status'];
    kind?: Task['kind'];
    limit?: number;
    offset?: number;
  },
): TaskSummary[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.taskListId) {
    conditions.push('t.task_list_id = ?');
    params.push(filter.taskListId);
  }
  if (filter?.phaseKey) {
    conditions.push('t.phase_key = ?');
    params.push(filter.phaseKey);
  }
  if (filter?.status) {
    conditions.push('t.status = ?');
    params.push(filter.status);
  }
  if (filter?.kind) {
    conditions.push('t.kind = ?');
    params.push(filter.kind);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filter?.limit ?? 100;
  const offset = filter?.offset ?? 0;
  const rows = db
    .prepare(
      `
    SELECT
      t.*,
      w.entity_type AS task_list_entity_type,
      w.entity_id AS task_list_entity_id,
      w.metadata_json AS task_list_metadata_json
    FROM tasks t
    JOIN task_lists w ON w.id = t.task_list_id
    ${where}
    ORDER BY t.updated_at DESC, t.id ASC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  const taskIds = rows.map((r) => r.id as string);
  const artifactsMap = listTaskArtifactsByTaskBatch(db, taskIds);
  return rows.map((row) => rowToTaskSummary(row, artifactsMap));
}

// --- Derived phase and task-list aggregates ---

type TaskPhaseStatus =
  | 'pending'
  | 'blocked'
  | 'ready'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

interface TaskPhaseAggregate {
  key: string;
  order: number;
  status: TaskPhaseStatus;
  progress: number;
  completedTasks: number;
  totalTasks: number;
  updatedAt: number;
}

function derivePhaseAggregates(
  tasks: Array<{
    phase_key: string;
    phase_order: number;
    status: Task['status'];
    progress: number;
    updated_at: number;
  }>,
): TaskPhaseAggregate[] {
  const grouped = new Map<string, typeof tasks>();
  for (const task of tasks) {
    const phase = grouped.get(task.phase_key);
    if (phase) phase.push(task);
    else grouped.set(task.phase_key, [task]);
  }

  return [...grouped.entries()]
    .map(([key, phaseTasks]): TaskPhaseAggregate => {
      const completedTasks = phaseTasks.filter((task) => task.status === 'completed').length;
      const hasRunning = phaseTasks.some(
        (task) => task.status === 'running' || task.status === 'awaiting_provider',
      );
      const hasFailed = phaseTasks.some(
        (task) => task.status === 'failed' || task.status === 'retryable_failed',
      );
      const allTerminal = phaseTasks.every((task) =>
        ['completed', 'skipped', 'failed', 'retryable_failed', 'cancelled'].includes(task.status),
      );
      const allCompleteLike = phaseTasks.every(
        (task) => task.status === 'completed' || task.status === 'skipped',
      );
      let status: TaskPhaseStatus = 'pending';
      if (hasRunning) status = 'running';
      else if (allTerminal && hasFailed && completedTasks > 0) status = 'completed_with_errors';
      else if (hasFailed) status = 'failed';
      else if (phaseTasks.some((task) => task.status === 'cancelled')) status = 'cancelled';
      else if (allCompleteLike) status = 'completed';
      else if (phaseTasks.some((task) => task.status === 'ready')) status = 'ready';
      else if (phaseTasks.some((task) => task.status === 'blocked')) status = 'blocked';

      return {
        key,
        order: Math.min(...phaseTasks.map((task) => task.phase_order)),
        status,
        progress:
          allCompleteLike || status === 'completed_with_errors'
            ? 100
            : Math.round(
                phaseTasks.reduce((sum, task) => sum + task.progress, 0) / phaseTasks.length,
              ),
        completedTasks,
        totalTasks: phaseTasks.length,
        updatedAt: Math.max(...phaseTasks.map((task) => task.updated_at)),
      };
    })
    .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key));
}

/** Phases have no rows; this refreshes the owning list from its phase's Tasks. */
export function recomputePhaseAggregate(
  db: BetterSqlite3.Database,
  taskListId: string,
  phaseKey: string,
): void {
  const phase = db
    .prepare('SELECT 1 FROM tasks WHERE task_list_id = ? AND phase_key = ? LIMIT 1')
    .get(taskListId, phaseKey);
  if (phase) recomputeTaskListAggregate(db, taskListId);
}

export function recomputeTaskListAggregate(db: BetterSqlite3.Database, taskListId: string): void {
  const taskListRow = db
    .prepare(
      `SELECT updated_at, current_gate, current_phase_key, current_task_id
       FROM task_lists WHERE id = ?`,
    )
    .get(taskListId) as
    | {
        updated_at: number;
        current_gate: string | null;
        current_phase_key: string | null;
        current_task_id: string | null;
      }
    | undefined;
  if (!taskListRow) return;

  const tasks = db
    .prepare(
      `SELECT id, phase_key, phase_order, task_key, status, progress, updated_at
       FROM tasks
       WHERE task_list_id = ?
         AND json_extract(input_json, '$.invalidatedByPlanRevision') IS NULL
       ORDER BY phase_order ASC,
                CASE status
                  WHEN 'running' THEN 0 WHEN 'awaiting_provider' THEN 1
                  WHEN 'ready' THEN 2 WHEN 'blocked' THEN 3 WHEN 'pending' THEN 4 ELSE 5
                END ASC,
                updated_at DESC, task_key ASC, id ASC`,
    )
    .all(taskListId) as Array<{
    id: string;
    phase_key: string;
    phase_order: number;
    task_key: string;
    status: Task['status'];
    progress: number;
    updated_at: number;
  }>;
  const phases = derivePhaseAggregates(tasks);
  const completedTasks = tasks.filter((task) => task.status === 'completed').length;
  const completedPhases = phases.filter((phase) => phase.status === 'completed').length;
  const allPhasesCompleted = phases.length > 0 && completedPhases === phases.length;
  const allPhasesTerminal =
    phases.length > 0 &&
    phases.every((phase) =>
      ['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(phase.status),
    );

  let status: TaskList['status'] = 'pending';
  if (taskListRow.current_gate !== null) status = 'awaiting_approval';
  else if (tasks.some((task) => task.status === 'running' || task.status === 'awaiting_provider'))
    status = 'running';
  else if (
    allPhasesTerminal &&
    phases.some((phase) => phase.status === 'completed_with_errors') &&
    completedTasks > 0
  )
    status = 'completed_with_errors';
  else if (phases.some((phase) => phase.status === 'failed')) status = 'failed';
  else if (phases.some((phase) => phase.status === 'cancelled')) status = 'cancelled';
  else if (allPhasesCompleted) status = 'completed';
  else if (phases.some((phase) => phase.status === 'ready')) status = 'ready';
  else if (phases.some((phase) => phase.status === 'blocked')) status = 'blocked';

  const terminal = ['completed', 'completed_with_errors', 'cancelled'].includes(status);
  const currentPhase = terminal
    ? undefined
    : taskListRow.current_gate !== null
      ? phases.find((phase) => phase.key === taskListRow.current_phase_key)
      : (phases.find((phase) => phase.status === 'running') ??
        phases.find(
          (phase) => !['completed', 'completed_with_errors', 'cancelled'].includes(phase.status),
        ));
  const currentTask = terminal
    ? undefined
    : taskListRow.current_gate !== null
      ? tasks.find((task) => task.id === taskListRow.current_task_id)
      : (tasks.find(
          (task) =>
            task.phase_key === currentPhase?.key &&
            (task.status === 'running' || task.status === 'awaiting_provider'),
        ) ??
        tasks.find(
          (task) =>
            task.phase_key === currentPhase?.key &&
            !['completed', 'skipped', 'cancelled'].includes(task.status),
        ));
  const progress =
    terminal && phases.length > 0
      ? 100
      : phases.length === 0
        ? 0
        : Math.round(phases.reduce((sum, phase) => sum + phase.progress, 0) / phases.length);

  updateTaskList(db, taskListId, {
    status,
    progress,
    completedPhases,
    totalPhases: phases.length,
    completedTasks,
    totalTasks: tasks.length,
    currentPhaseKey: currentPhase?.key,
    currentTaskId: currentTask?.id,
    summary:
      taskListRow.current_gate !== null
        ? `awaiting ${taskListRow.current_gate} approval; ${completedPhases}/${phases.length} phases, ${completedTasks}/${tasks.length} tasks`
        : `${status} ${completedPhases}/${phases.length} phases, ${completedTasks}/${tasks.length} tasks`,
    updatedAt: Math.max(
      taskListRow.updated_at,
      ...phases.map((phase) => phase.updatedAt),
      ...tasks.map((task) => task.updated_at),
    ),
  });
}

// --- Row Mappers ---

export function rowToTaskList(row: Record<string, unknown>): TaskList {
  return {
    id: row.id as string,
    taskListType: row.task_list_type as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id == null ? undefined : String(row.entity_id),
    triggerSource: row.trigger_source as string,
    status: row.status as TaskList['status'],
    summary: (row.summary as string) ?? '',
    progress: Number(row.progress ?? 0),
    completedPhases: Number(row.completed_phases ?? 0),
    totalPhases: Number(row.total_phases ?? 0),
    completedTasks: Number(row.completed_tasks ?? 0),
    totalTasks: Number(row.total_tasks ?? 0),
    currentPhaseKey: row.current_phase_key == null ? undefined : String(row.current_phase_key),
    currentTaskId: row.current_task_id == null ? undefined : String(row.current_task_id),
    input: JSON.parse((row.input_json as string) || '{}'),
    output: JSON.parse((row.output_json as string) || '{}'),
    error: row.error_text == null ? undefined : String(row.error_text),
    metadata: JSON.parse((row.metadata_json as string) || '{}'),
    createdAt: row.created_at as number,
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    updatedAt: row.updated_at as number,
    rowVersion: Number(row.row_version ?? 0),
    currentGate:
      row.current_gate == null ? undefined : (String(row.current_gate) as TaskList['currentGate']),
    engineVersion: row.engine_version == null ? 'legacy' : String(row.engine_version),
    definitionVersion: Number(row.definition_version ?? 1),
    leaseOwner: row.lease_owner == null ? undefined : String(row.lease_owner),
    leaseToken: Number(row.lease_token ?? 0),
    leaseExpiresAt: row.lease_expires_at == null ? undefined : Number(row.lease_expires_at),
    heartbeatAt: row.heartbeat_at == null ? undefined : Number(row.heartbeat_at),
  };
}

function rowToPlanDocument(row: Record<string, unknown>): PlanDocument {
  return {
    id: String(row.id),
    taskListId: String(row.task_list_id),
    logicalKey: String(row.logical_key),
    documentType: String(row.document_type),
    revision: Number(row.revision),
    schemaVersion: Number(row.schema_version),
    content: JSON.parse(String(row.content_json || '{}')) as Record<string, unknown>,
    contentHash: String(row.content_hash),
    status: row.status as PlanDocument['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToPlanApproval(row: Record<string, unknown>): PlanApproval {
  return {
    id: String(row.id),
    taskListId: String(row.task_list_id),
    gateKey: row.gate_key as PlanApproval['gateKey'],
    subjectLogicalKey: String(row.subject_logical_key),
    subjectRevision: Number(row.subject_revision),
    subjectHash: String(row.subject_hash),
    manifestHash: String(row.manifest_hash),
    resumeTokenHash: String(row.resume_token_hash),
    status: row.status as PlanApproval['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    decidedAt: row.decided_at == null ? undefined : Number(row.decided_at),
  };
}

function rowToTaskDecision(row: Record<string, unknown>): TaskDecision {
  return {
    id: String(row.id),
    taskListId: String(row.task_list_id),
    taskId: String(row.task_id),
    canvasId: String(row.canvas_id),
    questionId: String(row.question_id),
    decisionKey: String(row.decision_key),
    subjectRevision: Number(row.subject_revision),
    question: String(row.question),
    options: JSON.parse(String(row.options_json || '[]')) as TaskDecision['options'],
    allowFreeText: Number(row.allow_free_text) === 1,
    status: row.status as TaskDecision['status'],
    answer: row.answer == null ? undefined : String(row.answer),
    selectedOptionId: row.selected_option_id == null ? undefined : String(row.selected_option_id),
    rowVersion: Number(row.row_version ?? 0),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    answeredAt: row.answered_at == null ? undefined : Number(row.answered_at),
  };
}

function rowToTaskExecutionAttempt(row: Record<string, unknown>): TaskExecutionAttempt {
  if (row.kind !== 'task') throw new Error('Task attempt is not a task execution attempt');
  return {
    kind: 'task',
    id: String(row.id),
    taskListId: String(row.task_list_id),
    taskId: String(row.task_id),
    attempt: Number(row.attempt),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as TaskExecutionAttempt['status'],
    rowVersion: Number(row.row_version ?? 0),
    input: JSON.parse(String(row.input_json || '{}')) as Record<string, unknown>,
    output: JSON.parse(String(row.output_json || '{}')) as Record<string, unknown>,
    metadata: JSON.parse(String(row.metadata_json || '{}')) as Record<string, unknown>,
    providerJobId: row.provider_job_id == null ? undefined : String(row.provider_job_id),
    assetHash: row.asset_hash == null ? undefined : String(row.asset_hash),
    error: row.error_text == null ? undefined : String(row.error_text),
    createdAt: Number(row.created_at),
    submittedAt: row.submitted_at == null ? undefined : Number(row.submitted_at),
    assetReadyAt: row.asset_ready_at == null ? undefined : Number(row.asset_ready_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
  };
}

function rowToDeliveryPackageTaskAttempt(row: Record<string, unknown>): DeliveryPackageTaskAttempt {
  if (row.kind !== 'batch_export') throw new Error('Task attempt is not a Delivery package attempt');
  return {
    kind: 'batch_export',
    id: String(row.id),
    taskListId: String(row.task_list_id),
    taskId: row.task_id == null ? undefined : String(row.task_id),
    manifestRevision: Number(row.manifest_revision),
    manifestHash: String(row.manifest_hash),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as DeliveryPackageTaskAttempt['status'],
    rowVersion: Number(row.row_version ?? 0),
    stagingPath: row.staging_path == null ? undefined : String(row.staging_path),
    destinationPath: String(row.destination_path),
    packageHash: row.package_hash == null ? undefined : String(row.package_hash),
    packageBytes: row.package_bytes == null ? undefined : Number(row.package_bytes),
    fileCount: row.file_count == null ? undefined : Number(row.file_count),
    attempt: Number(row.attempt),
    error: row.error_text == null ? undefined : String(row.error_text),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
  };
}

function rowToProductionMediaTaskAttempt(row: Record<string, unknown>): ProductionMediaTaskAttempt {
  if (row.kind !== 'production_media') {
    throw new Error('Task attempt is not a production-media attempt');
  }
  const generationSpec = JSON.parse(
    String(row.generation_spec_json || '{}'),
  ) as ProductionMediaTaskAttempt['generationSpec'];
  return {
    kind: 'production_media',
    id: String(row.id),
    taskListId: String(row.task_list_id),
    taskId: String(row.task_id),
    canvasId: String(row.canvas_id),
    nodeId: String(row.node_id),
    attempt: Number(row.attempt),
    idempotencyKey: String(row.idempotency_key),
    specHash: String(row.spec_hash),
    generationSpec,
    repairDelta:
      row.repair_delta_json == null ? undefined : JSON.parse(String(row.repair_delta_json)),
    scope: row.scope as ProductionMediaTaskAttempt['scope'],
    mediaType: row.media_type as ProductionMediaTaskAttempt['mediaType'],
    status: row.status as ProductionMediaTaskAttempt['status'],
    rowVersion: Number(row.row_version ?? 0),
    providerId: String(row.provider_id),
    promptAssemblyId: generationSpec.promptAssemblyId,
    parentAttemptId: row.parent_attempt_id == null ? undefined : String(row.parent_attempt_id),
    submissionPurpose: row.submission_purpose as PromptAssemblyPurpose,
    model: String(row.model),
    prompt: String(row.prompt),
    promptHash: String(row.prompt_hash),
    negativePrompt: row.negative_prompt == null ? undefined : String(row.negative_prompt),
    seed: row.seed == null ? undefined : Number(row.seed),
    estimatedCostUsd: Number(row.estimated_cost_usd),
    reportedActualCostUsd:
      row.reported_actual_cost_usd == null ? undefined : Number(row.reported_actual_cost_usd),
    providerJobId: row.provider_job_id == null ? undefined : String(row.provider_job_id),
    providerReceipt: row.provider_receipt == null ? undefined : String(row.provider_receipt),
    assetHash: row.asset_hash == null ? undefined : String(row.asset_hash),
    error: row.error_text == null ? undefined : String(row.error_text),
    createdAt: Number(row.created_at),
    submittedAt: row.submitted_at == null ? undefined : Number(row.submitted_at),
    submissionStartedAt:
      row.submission_started_at == null ? undefined : Number(row.submission_started_at),
    cancelRequestedAt:
      row.cancel_requested_at == null ? undefined : Number(row.cancel_requested_at),
    assetReadyAt: row.asset_ready_at == null ? undefined : Number(row.asset_ready_at),
    evaluatedAt: row.evaluated_at == null ? undefined : Number(row.evaluated_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToTaskEvaluation(row: Record<string, unknown>): TaskEvaluation {
  if (row.kind !== 'production_media') {
    throw new Error('Task evaluation has an unsupported kind');
  }
  return {
    kind: 'production_media',
    id: String(row.id),
    attemptId: String(row.attempt_id),
    taskListId: String(row.task_list_id),
    canvasId: String(row.canvas_id),
    nodeId: String(row.node_id),
    artifactId: String(row.artifact_id),
    assetHash: String(row.asset_hash),
    mediaType: row.media_type as TaskEvaluation['mediaType'],
    profile: row.profile as TaskEvaluation['profile'],
    sourcePromptHash: String(row.source_prompt_hash),
    rubricVersion: String(row.rubric_version),
    evaluatorProviderId: String(row.evaluator_provider_id),
    evaluatorModel: row.evaluator_model == null ? undefined : String(row.evaluator_model),
    scores: JSON.parse(String(row.scores_json || '{}')),
    total: Number(row.total),
    verdict: row.verdict as TaskEvaluation['verdict'],
    strengths: JSON.parse(String(row.strengths_json || '[]')),
    risks: JSON.parse(String(row.risks_json || '[]')),
    evidence: JSON.parse(String(row.evidence_json || '[]')),
    repairDelta:
      row.repair_delta_json == null ? undefined : JSON.parse(String(row.repair_delta_json)),
    metadata: JSON.parse(String(row.metadata_json || '{}')),
    frameEvidence: JSON.parse(String(row.frame_evidence_json || '[]')),
    createdAt: Number(row.created_at),
  };
}

function rowToTaskEvent(row: Record<string, unknown>): TaskEvent {
  return {
    taskListId: String(row.task_list_id),
    seq: Number(row.seq),
    eventId: String(row.event_id),
    actor: String(row.actor),
    correlationId: row.correlation_id == null ? undefined : String(row.correlation_id),
    causationId: row.causation_id == null ? undefined : String(row.causation_id),
    payload: JSON.parse(String(row.payload_json || '{}')) as Record<string, unknown>,
    timestamp: Number(row.event_timestamp),
  };
}

function rowToTask(db: BetterSqlite3.Database, row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    taskListId: row.task_list_id as string,
    phaseKey: row.phase_key as string,
    phaseName: row.phase_name as string,
    phaseOrder: Number(row.phase_order),
    taskKey: row.task_key as string,
    name: row.name as string,
    kind: row.kind as Task['kind'],
    status: row.status as Task['status'],
    provider: row.provider == null ? undefined : String(row.provider),
    dependencyIds: listTaskDependencies(db, row.id as string),
    attempts: Number(row.attempts ?? 0),
    maxRetries: Number(row.max_retries ?? 0),
    input: JSON.parse((row.input_json as string) || '{}'),
    output: JSON.parse((row.output_json as string) || '{}'),
    providerTaskId: row.provider_task_id == null ? undefined : String(row.provider_task_id),
    assetId: row.asset_id == null ? undefined : String(row.asset_id),
    error: row.error_text == null ? undefined : String(row.error_text),
    progress: Number(row.progress ?? 0),
    currentStep: row.current_step == null ? undefined : String(row.current_step),
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    updatedAt: row.updated_at as number,
  };
}

/** Variant of rowToTask that uses a pre-fetched dependencies map to avoid N+1 queries. */
function rowToTaskWithDeps(row: Record<string, unknown>, depsMap: Map<string, string[]>): Task {
  return {
    id: row.id as string,
    taskListId: row.task_list_id as string,
    phaseKey: row.phase_key as string,
    phaseName: row.phase_name as string,
    phaseOrder: Number(row.phase_order),
    taskKey: row.task_key as string,
    name: row.name as string,
    kind: row.kind as Task['kind'],
    status: row.status as Task['status'],
    provider: row.provider == null ? undefined : String(row.provider),
    dependencyIds: depsMap.get(row.id as string) ?? [],
    attempts: Number(row.attempts ?? 0),
    maxRetries: Number(row.max_retries ?? 0),
    input: JSON.parse((row.input_json as string) || '{}'),
    output: JSON.parse((row.output_json as string) || '{}'),
    providerTaskId: row.provider_task_id == null ? undefined : String(row.provider_task_id),
    assetId: row.asset_id == null ? undefined : String(row.asset_id),
    error: row.error_text == null ? undefined : String(row.error_text),
    progress: Number(row.progress ?? 0),
    currentStep: row.current_step == null ? undefined : String(row.current_step),
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    updatedAt: row.updated_at as number,
  };
}

function rowToTaskArtifact(row: Record<string, unknown>): TaskArtifact {
  return {
    id: row.id as string,
    taskListId: row.task_list_id as string,
    taskId: row.task_id as string,
    attemptId: row.attempt_id == null ? undefined : String(row.attempt_id),
    artifactType: row.artifact_type as string,
    entityType: row.entity_type == null ? undefined : String(row.entity_type),
    entityId: row.entity_id == null ? undefined : String(row.entity_id),
    assetHash: row.asset_hash == null ? undefined : String(row.asset_hash),
    path: row.path == null ? undefined : String(row.path),
    metadata: JSON.parse((row.metadata_json as string) || '{}'),
    createdAt: row.created_at as number,
  };
}

function toTaskArtifactSummary(artifact: TaskArtifact): TaskArtifactSummary {
  return {
    id: artifact.id,
    artifactType: artifact.artifactType,
    attemptId: artifact.attemptId,
    entityType: artifact.entityType,
    entityId: artifact.entityId,
    assetHash: artifact.assetHash,
    path: artifact.path,
    createdAt: artifact.createdAt,
  };
}

// --- Summary Projection Helpers ---

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    /* malformed JSON column value — return empty record */
    return {};
  }
}

function getProjectionSources(
  ...records: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  const sources: Array<Record<string, unknown>> = [];

  for (const record of records) {
    if (!record || typeof record !== 'object') {
      continue;
    }

    sources.push(record);

    for (const nestedKey of ['display', 'ui', 'metadata']) {
      const nested = record[nestedKey];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        sources.push(nested as Record<string, unknown>);
      }
    }
  }

  return sources;
}

function pickProjectionString(
  sources: Array<Record<string, unknown>>,
  keys: string[],
): string | undefined {
  for (const source of sources) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  }

  return undefined;
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('TaskList content must be JSON-serializable');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function rowToTaskSummary(
  row: Record<string, unknown>,
  artifactsMap: Map<string, TaskArtifact[]>,
): TaskSummary {
  const taskInput = parseJsonRecord(row.input_json);
  const taskOutput = parseJsonRecord(row.output_json);
  const taskListMetadata = parseJsonRecord(row.task_list_metadata_json);
  const taskMetadata = getProjectionSources(taskInput, taskOutput);
  const taskListSources = getProjectionSources(taskListMetadata);
  const producedArtifacts = (artifactsMap.get(row.id as string) ?? []).map((artifact) =>
    toTaskArtifactSummary(artifact),
  );

  return {
    id: row.id as string,
    taskListId: row.task_list_id as string,
    phaseKey: row.phase_key as string,
    phaseName: row.phase_name as string,
    phaseOrder: Number(row.phase_order),
    taskKey: row.task_key as string,
    name: row.name == null ? undefined : String(row.name),
    kind: row.kind as Task['kind'],
    status: row.status as Task['status'],
    progress: Number(row.progress ?? 0),
    currentStep: row.current_step == null ? undefined : String(row.current_step),
    displayCategory:
      pickProjectionString(taskMetadata, ['displayCategory', 'category']) ??
      pickProjectionString(taskListSources, ['displayCategory', 'category']) ??
      String(row.kind),
    displayLabel:
      pickProjectionString(taskMetadata, ['displayLabel', 'label', 'name']) ?? (row.name as string),
    displayLabelKey: pickProjectionString(taskMetadata, ['displayLabelKey']),
    relatedEntityType:
      pickProjectionString(taskMetadata, ['relatedEntityType']) ??
      (row.task_list_entity_type == null ? undefined : String(row.task_list_entity_type)),
    relatedEntityId:
      pickProjectionString(taskMetadata, ['relatedEntityId']) ??
      (row.task_list_entity_id == null ? undefined : String(row.task_list_entity_id)),
    relatedEntityLabel:
      pickProjectionString(taskMetadata, ['relatedEntityLabel']) ??
      pickProjectionString(taskListSources, ['relatedEntityLabel']),
    provider:
      row.provider == null
        ? (pickProjectionString(taskMetadata, ['provider']) ??
          pickProjectionString(taskListSources, ['provider']))
        : String(row.provider),
    modelKey:
      pickProjectionString(taskMetadata, ['modelKey']) ??
      pickProjectionString(taskListSources, ['modelKey']),
    promptTemplateId:
      pickProjectionString(taskMetadata, ['promptTemplateId']) ??
      pickProjectionString(taskListSources, ['promptTemplateId']),
    promptTemplateVersion:
      pickProjectionString(taskMetadata, ['promptTemplateVersion']) ??
      pickProjectionString(taskListSources, ['promptTemplateVersion']),
    summary:
      pickProjectionString(taskMetadata, ['summary', 'description']) ??
      pickProjectionString(taskListSources, ['summary']),
    error: row.error_text == null ? undefined : String(row.error_text),
    attempts: Number(row.attempts ?? 0),
    maxRetries: Number(row.max_retries ?? 0),
    assetId: row.asset_id == null ? undefined : String(row.asset_id),
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    updatedAt: row.updated_at as number,
    producedArtifacts,
  };
}

function rowToTaskListSummary(
  row: Record<string, unknown>,
  artifactsByTaskListId: Map<string, TaskArtifact[]>,
): TaskListSummary {
  const input = parseJsonRecord(row.input_json);
  const output = parseJsonRecord(row.output_json);
  const metadata = parseJsonRecord(row.metadata_json);
  const sources = getProjectionSources(input, output, metadata);
  return {
    id: row.id as string,
    commanderSessionId: getCommanderSessionId(metadata),
    taskListType: row.task_list_type as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id == null ? undefined : String(row.entity_id),
    triggerSource: row.trigger_source as string,
    status: row.status as TaskList['status'],
    summary: row.summary as string,
    progress: Number(row.progress ?? 0),
    completedPhases: Number(row.completed_phases ?? 0),
    totalPhases: Number(row.total_phases ?? 0),
    completedTasks: Number(row.completed_tasks ?? 0),
    totalTasks: Number(row.total_tasks ?? 0),
    currentPhaseKey:
      row.current_phase_key == null ? undefined : String(row.current_phase_key),
    currentTaskId: row.current_task_id == null ? undefined : String(row.current_task_id),
    displayCategory:
      pickProjectionString(sources, ['displayCategory', 'category']) ??
      String(row.task_list_type),
    displayLabel:
      pickProjectionString(sources, ['displayLabel', 'label', 'name']) ??
      String(row.summary),
    displayLabelKey: pickProjectionString(sources, ['displayLabelKey']),
    relatedEntityLabel: pickProjectionString(sources, ['relatedEntityLabel']),
    provider: pickProjectionString(sources, ['provider', 'providerId']),
    modelKey: pickProjectionString(sources, ['modelKey', 'model']),
    promptTemplateId: pickProjectionString(sources, ['promptTemplateId']),
    promptTemplateVersion: pickProjectionString(sources, ['promptTemplateVersion']),
    createdAt: Number(row.created_at),
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    updatedAt: Number(row.updated_at),
    producedArtifacts: (artifactsByTaskListId.get(row.id as string) ?? []).map((artifact) =>
      toTaskArtifactSummary(artifact),
    ),
  };
}

