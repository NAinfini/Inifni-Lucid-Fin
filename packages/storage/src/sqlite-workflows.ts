import type {
  ApproveWorkflowGateInput,
  ApproveWorkflowGateResult,
  WorkflowApproval,
  WorkflowRun,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
  WorkflowArtifactSummary,
  WorkflowDocument,
  WorkflowEvent,
  WorkflowExportExecution,
  WorkflowMediaAttempt,
  WorkflowMediaAttemptStatus,
  WorkflowMediaCostSummary,
  WorkflowMediaEvaluation,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

export interface WorkflowApprovalGateBundle {
  run: WorkflowRun;
  document: WorkflowDocument;
  approval: WorkflowApproval;
  events: WorkflowEvent[];
}

/** Atomic append of a later approval-gate revision to an existing run. */
export interface WorkflowApprovalGateRevisionBundle {
  expectedRowVersion: number;
  document: WorkflowDocument;
  approval: WorkflowApproval;
  event: Omit<WorkflowEvent, 'seq'>;
}

export interface WorkflowApprovalGateRevisionResult {
  run: WorkflowRun;
  event: WorkflowEvent;
}

export interface ReserveWorkflowExportExecutionInput {
  execution: WorkflowExportExecution;
}

export interface ReserveWorkflowExportExecutionResult {
  execution: WorkflowExportExecution;
  created: boolean;
}

export interface TransitionWorkflowExportExecutionInput {
  id: string;
  expectedRowVersion: number;
  expectedStatuses: WorkflowExportExecution['status'][];
  status: WorkflowExportExecution['status'];
  updatedAt: number;
  stagingPath?: string;
  outputAssetHash?: string;
  outputHash?: string;
  outputSize?: number;
  error?: string;
}

export interface CompleteWorkflowExportExecutionInput {
  id: string;
  expectedExecutionRowVersion: number;
  expectedRunRowVersion: number;
  outputAssetHash: string;
  outputHash: string;
  outputSize: number;
  completedAt: number;
  runOutput: Record<string, unknown>;
  event: Omit<WorkflowEvent, 'seq'>;
}

export interface ReserveWorkflowMediaAttemptInput {
  attempt: WorkflowMediaAttempt;
  expectedRunRowVersion: number;
}

export interface ReserveWorkflowMediaAttemptResult {
  attempt: WorkflowMediaAttempt;
  created: boolean;
}

export interface TransitionWorkflowMediaAttemptInput {
  id: string;
  expectedRowVersion: number;
  expectedStatuses: WorkflowMediaAttemptStatus[];
  status: WorkflowMediaAttemptStatus;
  updatedAt: number;
  model?: string;
  providerJobId?: string;
  assetHash?: string;
  reportedActualCostUsd?: number;
  error?: string;
  submittedAt?: number;
  assetReadyAt?: number;
  evaluatedAt?: number;
  completedAt?: number;
}

export interface RecordWorkflowMediaEvaluationInput {
  evaluation: WorkflowMediaEvaluation;
  expectedAttemptRowVersion: number;
  expectedAttemptStatuses: WorkflowMediaAttemptStatus[];
  resultingAttemptStatus: Extract<
    WorkflowMediaAttemptStatus,
    'accepted' | 'repair_required' | 'regenerate_required' | 'human_review'
  >;
  evaluatedAt: number;
}

export interface RecordWorkflowMediaEvaluationResult {
  evaluation: WorkflowMediaEvaluation;
  attempt: WorkflowMediaAttempt;
  created: boolean;
}

// --- Workflow Runs ---

export function insertWorkflowRun(db: BetterSqlite3.Database, run: WorkflowRun): void {
  db.prepare(
    `
    INSERT INTO workflow_runs (
      id, workflow_type, entity_type, entity_id, trigger_source,
      status, summary, progress, completed_stages, total_stages,
      completed_tasks, total_tasks, current_stage_id, current_task_id,
      input_json, output_json, error_text, metadata_json,
      created_at, started_at, completed_at, updated_at,
      row_version, current_gate, engine_version, definition_version
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    run.id,
    run.workflowType,
    run.entityType,
    run.entityId ?? null,
    run.triggerSource,
    run.status,
    run.summary,
    run.progress,
    run.completedStages,
    run.totalStages,
    run.completedTasks,
    run.totalTasks,
    run.currentStageId ?? null,
    run.currentTaskId ?? null,
    JSON.stringify(run.input),
    JSON.stringify(run.output),
    run.error ?? null,
    JSON.stringify(run.metadata),
    run.createdAt,
    run.startedAt ?? null,
    run.completedAt ?? null,
    run.updatedAt,
    run.rowVersion ?? 0,
    run.currentGate ?? null,
    run.engineVersion ?? 'legacy',
    run.definitionVersion ?? 1,
  );
}

export function getWorkflowRun(db: BetterSqlite3.Database, id: string): WorkflowRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToWorkflowRun(row);
}

export function listWorkflowRuns(
  db: BetterSqlite3.Database,
  filter?: {
    status?: string;
    workflowType?: string;
    entityType?: string;
  },
): WorkflowRun[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.status) {
    conditions.push('status = ?');
    params.push(filter.status);
  }
  if (filter?.workflowType) {
    conditions.push('workflow_type = ?');
    params.push(filter.workflowType);
  }
  if (filter?.entityType) {
    conditions.push('entity_type = ?');
    params.push(filter.entityType);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM workflow_runs ${where} ORDER BY updated_at DESC, created_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToWorkflowRun(row));
}

export function updateWorkflowRun(
  db: BetterSqlite3.Database,
  id: string,
  updates: Partial<
    Pick<
      WorkflowRun,
      | 'status'
      | 'summary'
      | 'progress'
      | 'completedStages'
      | 'totalStages'
      | 'completedTasks'
      | 'totalTasks'
      | 'currentStageId'
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
  if (updates.completedStages !== undefined) {
    sets.push('completed_stages = ?');
    params.push(updates.completedStages);
  }
  if (updates.totalStages !== undefined) {
    sets.push('total_stages = ?');
    params.push(updates.totalStages);
  }
  if (updates.completedTasks !== undefined) {
    sets.push('completed_tasks = ?');
    params.push(updates.completedTasks);
  }
  if (updates.totalTasks !== undefined) {
    sets.push('total_tasks = ?');
    params.push(updates.totalTasks);
  }
  if (updates.currentStageId !== undefined) {
    sets.push('current_stage_id = ?');
    params.push(updates.currentStageId ?? null);
  } else if (
    updates.status === 'completed' ||
    updates.status === 'completed_with_errors' ||
    updates.status === 'cancelled'
  ) {
    sets.push('current_stage_id = NULL');
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
  db.prepare(`UPDATE workflow_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// --- Persistent Workflow Documents, Approvals, and Events ---

export function insertWorkflowDocument(
  db: BetterSqlite3.Database,
  document: WorkflowDocument,
): void {
  db.prepare(
    `INSERT INTO workflow_documents (
       id, workflow_run_id, logical_key, document_type, revision, schema_version,
       content_json, content_hash, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    document.id,
    document.workflowRunId,
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

export function getLatestWorkflowDocument(
  db: BetterSqlite3.Database,
  workflowRunId: string,
  logicalKey: string,
): WorkflowDocument | undefined {
  const row = db
    .prepare(
      `SELECT * FROM workflow_documents
       WHERE workflow_run_id = ? AND logical_key = ?
       ORDER BY revision DESC
       LIMIT 1`,
    )
    .get(workflowRunId, logicalKey) as Record<string, unknown> | undefined;
  return row ? rowToWorkflowDocument(row) : undefined;
}

export function getWorkflowDocumentRevision(
  db: BetterSqlite3.Database,
  workflowRunId: string,
  logicalKey: string,
  revision: number,
): WorkflowDocument | undefined {
  const row = db
    .prepare(
      `SELECT * FROM workflow_documents
       WHERE workflow_run_id = ? AND logical_key = ? AND revision = ?
       LIMIT 1`,
    )
    .get(workflowRunId, logicalKey, revision) as Record<string, unknown> | undefined;
  return row ? rowToWorkflowDocument(row) : undefined;
}

export function insertPendingWorkflowApproval(
  db: BetterSqlite3.Database,
  approval: WorkflowApproval,
): void {
  if (approval.status !== 'pending') {
    throw new TypeError('A newly created workflow approval must have pending status');
  }

  const create = db.transaction(() => {
    const subject = db
      .prepare(
        `SELECT content_hash FROM workflow_documents
         WHERE workflow_run_id = ? AND logical_key = ? AND revision = ?`,
      )
      .get(approval.workflowRunId, approval.subjectLogicalKey, approval.subjectRevision) as
      { content_hash: string } | undefined;

    if (!subject) {
      throw new Error('Workflow approval subject revision does not exist');
    }
    if (subject.content_hash !== approval.subjectHash) {
      throw new Error('Workflow approval subject hash does not match the stored document');
    }

    db.prepare(
      `UPDATE workflow_approvals
       SET status = 'invalidated', decided_at = ?, updated_at = ?
       WHERE workflow_run_id = ? AND gate_key = ? AND status = 'pending'`,
    ).run(approval.createdAt, approval.updatedAt, approval.workflowRunId, approval.gateKey);

    db.prepare(
      `INSERT INTO workflow_approvals (
         id, workflow_run_id, gate_key, subject_logical_key, subject_revision,
         subject_hash, manifest_hash, resume_token_hash, status,
         created_at, updated_at, decided_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      approval.id,
      approval.workflowRunId,
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
        `UPDATE workflow_runs
         SET current_gate = ?, status = 'awaiting_approval', row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND (current_gate IS NULL OR current_gate = ?)`,
      )
      .run(approval.gateKey, approval.updatedAt, approval.workflowRunId, approval.gateKey).changes;
    if (changed !== 1) {
      throw new Error('Workflow run is missing or blocked at a different approval gate');
    }
  });

  create.immediate();
}

/**
 * Atomically creates a new workflow aggregate and its first approval gate.
 * This is the durable boundary used by Commander: no partial run, document,
 * approval, or event rows survive if any insert fails.
 */
export function insertWorkflowApprovalGateBundle(
  db: BetterSqlite3.Database,
  bundle: WorkflowApprovalGateBundle,
): void {
  const create = db.transaction(() => {
    if (
      bundle.document.workflowRunId !== bundle.run.id ||
      bundle.approval.workflowRunId !== bundle.run.id ||
      bundle.events.some((event) => event.workflowRunId !== bundle.run.id)
    ) {
      throw new Error('Workflow approval-gate bundle contains mismatched workflow run IDs');
    }

    const expectedSequences = bundle.events.map((_event, index) => index + 1);
    if (bundle.events.some((event, index) => event.seq !== expectedSequences[index])) {
      throw new Error('Initial workflow events must use contiguous sequences beginning at 1');
    }

    insertWorkflowRun(db, bundle.run);
    insertWorkflowDocument(db, bundle.document);
    insertPendingWorkflowApproval(db, bundle.approval);
    for (const event of bundle.events) insertWorkflowEvent(db, event);
  });

  create.immediate();
}

/**
 * Atomically appends an immutable document, replaces the pending approval for
 * that gate, CAS-advances the run, and writes the next contiguous event.
 */
export function insertWorkflowApprovalGateRevision(
  db: BetterSqlite3.Database,
  bundle: WorkflowApprovalGateRevisionBundle,
): WorkflowApprovalGateRevisionResult {
  const create = db.transaction((): WorkflowApprovalGateRevisionResult => {
    const { document, approval } = bundle;
    if (
      document.workflowRunId !== approval.workflowRunId ||
      document.workflowRunId !== bundle.event.workflowRunId
    ) {
      throw new Error('Workflow gate revision contains mismatched workflow run IDs');
    }
    if (
      approval.status !== 'pending' ||
      approval.subjectLogicalKey !== document.logicalKey ||
      approval.subjectRevision !== document.revision ||
      approval.subjectHash !== document.contentHash
    ) {
      throw new Error('Workflow gate revision approval does not match its immutable subject');
    }

    const runRow = db
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(document.workflowRunId) as Record<string, unknown> | undefined;
    if (!runRow) throw new Error(`Workflow "${document.workflowRunId}" not found`);
    const actualRowVersion = Number(runRow.row_version ?? 0);
    if (actualRowVersion !== bundle.expectedRowVersion) {
      throw new Error(
        `Workflow row version changed: expected ${bundle.expectedRowVersion}, got ${actualRowVersion}`,
      );
    }
    const currentGate = runRow.current_gate == null ? undefined : String(runRow.current_gate);
    if (currentGate && currentGate !== approval.gateKey) {
      throw new Error(`Workflow is blocked at a different approval gate: ${currentGate}`);
    }

    const latestRevisionRow = db
      .prepare(
        `SELECT COALESCE(MAX(revision), 0) AS latest_revision
         FROM workflow_documents
         WHERE workflow_run_id = ? AND logical_key = ?`,
      )
      .get(document.workflowRunId, document.logicalKey) as { latest_revision: number };
    const expectedRevision = Number(latestRevisionRow.latest_revision) + 1;
    if (document.revision !== expectedRevision) {
      throw new Error(
        `Workflow document revision changed: expected ${expectedRevision}, got ${document.revision}`,
      );
    }

    insertWorkflowDocument(db, document);
    db.prepare(
      `UPDATE workflow_approvals
       SET status = 'invalidated', decided_at = ?, updated_at = ?
       WHERE workflow_run_id = ? AND gate_key = ? AND status = 'pending'`,
    ).run(approval.createdAt, approval.updatedAt, approval.workflowRunId, approval.gateKey);
    db.prepare(
      `INSERT INTO workflow_approvals (
         id, workflow_run_id, gate_key, subject_logical_key, subject_revision,
         subject_hash, manifest_hash, resume_token_hash, status,
         created_at, updated_at, decided_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      approval.id,
      approval.workflowRunId,
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
        `UPDATE workflow_runs
         SET current_gate = ?, status = 'awaiting_approval',
             row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ?
           AND (current_gate IS NULL OR current_gate = ?)`,
      )
      .run(
        approval.gateKey,
        approval.updatedAt,
        approval.workflowRunId,
        bundle.expectedRowVersion,
        approval.gateKey,
      ).changes;
    if (changed !== 1) throw new Error('Workflow run CAS changed inside gate transaction');

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM workflow_events WHERE workflow_run_id = ?',
      )
      .get(document.workflowRunId) as { next_seq: number };
    const event: WorkflowEvent = { ...bundle.event, seq: Number(seqRow.next_seq) };
    insertWorkflowEvent(db, event);

    const updatedRunRow = db
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(document.workflowRunId) as Record<string, unknown>;
    return { run: rowToWorkflowRun(updatedRunRow), event };
  });

  return create.immediate();
}

export function getPendingWorkflowApproval(
  db: BetterSqlite3.Database,
  workflowRunId: string,
  gateKey: WorkflowApproval['gateKey'],
): WorkflowApproval | undefined {
  const row = db
    .prepare(
      `SELECT * FROM workflow_approvals
       WHERE workflow_run_id = ? AND gate_key = ? AND status = 'pending'
       ORDER BY subject_revision DESC, created_at DESC
       LIMIT 1`,
    )
    .get(workflowRunId, gateKey) as Record<string, unknown> | undefined;
  return row ? rowToWorkflowApproval(row) : undefined;
}

export function getLatestWorkflowApproval(
  db: BetterSqlite3.Database,
  workflowRunId: string,
  gateKey: WorkflowApproval['gateKey'],
): WorkflowApproval | undefined {
  const row = db
    .prepare(
      `SELECT * FROM workflow_approvals
       WHERE workflow_run_id = ? AND gate_key = ?
       ORDER BY subject_revision DESC, created_at DESC
       LIMIT 1`,
    )
    .get(workflowRunId, gateKey) as Record<string, unknown> | undefined;
  return row ? rowToWorkflowApproval(row) : undefined;
}

export function approveWorkflowGate(
  db: BetterSqlite3.Database,
  input: ApproveWorkflowGateInput,
): ApproveWorkflowGateResult {
  const approve = db.transaction((): ApproveWorkflowGateResult => {
    const runRow = db
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(input.workflowRunId) as Record<string, unknown> | undefined;
    if (!runRow) {
      return { ok: false, code: 'run_not_found' };
    }

    const approvalRow = db
      .prepare(
        `SELECT * FROM workflow_approvals
         WHERE workflow_run_id = ? AND gate_key = ?
         ORDER BY subject_revision DESC, created_at DESC
         LIMIT 1`,
      )
      .get(input.workflowRunId, input.gateKey) as Record<string, unknown> | undefined;
    if (!approvalRow) {
      return { ok: false, code: 'no_approval' };
    }

    const approval = rowToWorkflowApproval(approvalRow);
    if (approval.status === 'approved') {
      return { ok: false, code: 'already_approved', approval };
    }
    if (approval.status !== 'pending') {
      return { ok: false, code: 'approval_not_pending', status: approval.status };
    }

    const actualGate =
      runRow.current_gate == null
        ? undefined
        : (String(runRow.current_gate) as WorkflowApproval['gateKey']);
    if (actualGate !== input.gateKey) {
      return { ok: false, code: 'gate_not_current', actualGate };
    }

    const actualRowVersion = Number(runRow.row_version ?? 0);
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
        `UPDATE workflow_approvals
         SET status = 'approved', decided_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(input.approvedAt, input.approvedAt, approval.id).changes;
    if (approvalUpdated !== 1) {
      return { ok: false, code: 'already_approved', approval };
    }

    const runUpdated = db
      .prepare(
        `UPDATE workflow_runs
         SET current_gate = NULL, status = 'ready',
             current_stage_id = COALESCE(?, current_stage_id),
             row_version = row_version + 1, updated_at = ?
         WHERE id = ? AND row_version = ? AND current_gate = ?`,
      )
      .run(
        input.nextStageId ?? null,
        input.approvedAt,
        input.workflowRunId,
        input.expectedRowVersion,
        input.gateKey,
      ).changes;
    if (runUpdated !== 1) {
      throw new Error('Workflow run CAS changed inside approval transaction');
    }

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM workflow_events WHERE workflow_run_id = ?',
      )
      .get(input.workflowRunId) as { next_seq: number };
    const event: WorkflowEvent = {
      workflowRunId: input.workflowRunId,
      seq: Number(seqRow.next_seq),
      eventId: input.eventId,
      actor: input.actor,
      correlationId: input.correlationId,
      causationId: input.causationId,
      payload: {
        type: 'workflow.gate.approved',
        gateKey: input.gateKey,
        approvalId: approval.id,
        subjectLogicalKey: approval.subjectLogicalKey,
        subjectRevision: approval.subjectRevision,
        subjectHash: approval.subjectHash,
        manifestHash: approval.manifestHash,
      },
      timestamp: input.approvedAt,
    };
    insertWorkflowEvent(db, event);

    const updatedRunRow = db
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(input.workflowRunId) as Record<string, unknown>;
    const updatedApprovalRow = db
      .prepare('SELECT * FROM workflow_approvals WHERE id = ?')
      .get(approval.id) as Record<string, unknown>;

    return {
      ok: true,
      code: 'approved',
      run: rowToWorkflowRun(updatedRunRow),
      approval: rowToWorkflowApproval(updatedApprovalRow),
      event,
    };
  });

  return approve.immediate();
}

export function listWorkflowEvents(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): WorkflowEvent[] {
  const rows = db
    .prepare('SELECT * FROM workflow_events WHERE workflow_run_id = ? ORDER BY seq ASC')
    .all(workflowRunId) as Array<Record<string, unknown>>;
  return rows.map(rowToWorkflowEvent);
}

// --- Persistent Production Media Attempts and Evaluations ---

export function reserveWorkflowMediaAttempt(
  db: BetterSqlite3.Database,
  input: ReserveWorkflowMediaAttemptInput,
): ReserveWorkflowMediaAttemptResult {
  const reserve = db.transaction((): ReserveWorkflowMediaAttemptResult => {
    const proposed = input.attempt;
    if (proposed.status !== 'reserved' || proposed.rowVersion !== 0 || proposed.attempt < 1) {
      throw new Error('New production-media attempts must begin reserved at rowVersion 0');
    }

    const run = db
      .prepare(
        `SELECT workflow_type, entity_type, entity_id, status, current_stage_id,
                current_gate, row_version
         FROM workflow_runs WHERE id = ?`,
      )
      .get(proposed.workflowRunId) as
      | {
          workflow_type: string;
          entity_type: string;
          entity_id: string | null;
          status: string;
          current_stage_id: string | null;
          current_gate: string | null;
          row_version: number;
        }
      | undefined;
    if (!run) throw new Error(`Workflow "${proposed.workflowRunId}" not found`);
    if (
      run.workflow_type !== 'movie.production.v2' ||
      run.entity_type !== 'canvas' ||
      run.entity_id !== proposed.canvasId
    ) {
      throw new Error('Production-media attempt is not bound to this persistent canvas workflow');
    }
    if (Number(run.row_version) !== input.expectedRunRowVersion) {
      throw new Error('Workflow changed before production-media reservation');
    }
    if (run.current_gate !== null) {
      throw new Error(`Workflow is awaiting ${run.current_gate} approval`);
    }
    if (
      run.current_stage_id !== 'media-generation' ||
      (run.status !== 'ready' && run.status !== 'running')
    ) {
      throw new Error(
        `Workflow is not ready for media generation (status=${run.status}, stage=${run.current_stage_id ?? 'none'})`,
      );
    }

    const spec = proposed.generationSpec;
    if (
      spec.workflowRunId !== proposed.workflowRunId ||
      spec.canvasId !== proposed.canvasId ||
      spec.nodeId !== proposed.nodeId ||
      spec.mediaType !== proposed.mediaType ||
      spec.providerId !== proposed.providerId
    ) {
      throw new Error('Generation Spec identity does not match its attempt reservation');
    }

    for (const [gateKey, subject] of [
      ['production_plan', spec.productionPlan],
      ['visual_constitution', spec.visualConstitution],
    ] as const) {
      const approval = db
        .prepare(
          `SELECT subject_revision, subject_hash, status
           FROM workflow_approvals
           WHERE workflow_run_id = ? AND gate_key = ?
           ORDER BY subject_revision DESC, created_at DESC
           LIMIT 1`,
        )
        .get(proposed.workflowRunId, gateKey) as
        { subject_revision: number; subject_hash: string; status: string } | undefined;
      if (
        !approval ||
        approval.status !== 'approved' ||
        Number(approval.subject_revision) !== subject.revision ||
        String(approval.subject_hash) !== subject.contentHash
      ) {
        throw new Error(`Exact approved ${gateKey} document is required before generation`);
      }
    }

    const existingRow = db
      .prepare(
        `SELECT * FROM workflow_media_attempts
         WHERE idempotency_key = ? OR id = ?
         LIMIT 1`,
      )
      .get(proposed.idempotencyKey, proposed.id) as Record<string, unknown> | undefined;
    if (existingRow) {
      const existing = rowToWorkflowMediaAttempt(existingRow);
      if (
        existing.id !== proposed.id ||
        existing.idempotencyKey !== proposed.idempotencyKey ||
        existing.workflowRunId !== proposed.workflowRunId ||
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
         FROM workflow_media_attempts WHERE workflow_run_id = ?`,
      )
      .get(proposed.workflowRunId) as {
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
         FROM workflow_media_attempts
         WHERE workflow_run_id = ? AND node_id = ?`,
      )
      .get(proposed.workflowRunId, proposed.nodeId) as { latest_attempt: number };
    const expectedAttempt = Number(latest.latest_attempt) + 1;
    if (proposed.attempt !== expectedAttempt) {
      throw new Error(
        `Production-media attempt must be ${expectedAttempt}; received ${proposed.attempt}`,
      );
    }

    db.prepare(
      `INSERT INTO workflow_media_attempts (
         id, workflow_run_id, canvas_id, node_id, attempt, idempotency_key,
         spec_hash, generation_spec_json, repair_delta_json, media_type, status,
         row_version, provider_id, model, prompt, prompt_hash, negative_prompt,
         seed, estimated_cost_usd, reported_actual_cost_usd, provider_job_id,
         asset_hash, error_text, created_at, submitted_at, asset_ready_at,
         evaluated_at, completed_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      proposed.id,
      proposed.workflowRunId,
      proposed.canvasId,
      proposed.nodeId,
      proposed.attempt,
      proposed.idempotencyKey,
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
      proposed.assetHash ?? null,
      proposed.error ?? null,
      proposed.createdAt,
      proposed.submittedAt ?? null,
      proposed.assetReadyAt ?? null,
      proposed.evaluatedAt ?? null,
      proposed.completedAt ?? null,
      proposed.updatedAt,
    );
    return {
      attempt: requireWorkflowMediaAttempt(db, proposed.id),
      created: true,
    };
  });
  return reserve.immediate();
}

export function getWorkflowMediaAttempt(
  db: BetterSqlite3.Database,
  id: string,
): WorkflowMediaAttempt | undefined {
  const row = db.prepare('SELECT * FROM workflow_media_attempts WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  return row ? rowToWorkflowMediaAttempt(row) : undefined;
}

function requireWorkflowMediaAttempt(db: BetterSqlite3.Database, id: string): WorkflowMediaAttempt {
  const attempt = getWorkflowMediaAttempt(db, id);
  if (!attempt) throw new Error(`Production-media attempt "${id}" disappeared after persistence`);
  return attempt;
}

export function getLatestWorkflowMediaAttempt(
  db: BetterSqlite3.Database,
  workflowRunId: string,
  nodeId: string,
): WorkflowMediaAttempt | undefined {
  const row = db
    .prepare(
      `SELECT * FROM workflow_media_attempts
       WHERE workflow_run_id = ? AND node_id = ?
       ORDER BY attempt DESC LIMIT 1`,
    )
    .get(workflowRunId, nodeId) as Record<string, unknown> | undefined;
  return row ? rowToWorkflowMediaAttempt(row) : undefined;
}

export function listWorkflowMediaAttempts(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): WorkflowMediaAttempt[] {
  const rows = db
    .prepare(
      `SELECT * FROM workflow_media_attempts
       WHERE workflow_run_id = ? ORDER BY node_id ASC, attempt ASC`,
    )
    .all(workflowRunId) as Array<Record<string, unknown>>;
  return rows.map(rowToWorkflowMediaAttempt);
}

export function listRecoverableWorkflowMediaAttempts(
  db: BetterSqlite3.Database,
): WorkflowMediaAttempt[] {
  const rows = db
    .prepare(
      `SELECT * FROM workflow_media_attempts
       WHERE status IN ('reserved', 'submitted', 'asset_ready', 'evaluating')
       ORDER BY updated_at ASC, id ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToWorkflowMediaAttempt);
}

export function transitionWorkflowMediaAttempt(
  db: BetterSqlite3.Database,
  input: TransitionWorkflowMediaAttemptInput,
): WorkflowMediaAttempt {
  if (input.expectedStatuses.length === 0) {
    throw new Error('Production-media transition requires at least one expected status');
  }
  if (
    input.reportedActualCostUsd !== undefined &&
    (!Number.isFinite(input.reportedActualCostUsd) || input.reportedActualCostUsd < 0)
  ) {
    throw new Error('reportedActualCostUsd must be a non-negative finite number');
  }
  const placeholders = input.expectedStatuses.map(() => '?').join(', ');
  const changed = db
    .prepare(
      `UPDATE workflow_media_attempts
       SET status = ?, row_version = row_version + 1,
           model = COALESCE(?, model), provider_job_id = COALESCE(?, provider_job_id),
           asset_hash = COALESCE(?, asset_hash),
           reported_actual_cost_usd = COALESCE(?, reported_actual_cost_usd),
           error_text = ?, submitted_at = COALESCE(?, submitted_at),
           asset_ready_at = COALESCE(?, asset_ready_at),
           evaluated_at = COALESCE(?, evaluated_at),
           completed_at = COALESCE(?, completed_at), updated_at = ?
       WHERE id = ? AND row_version = ? AND status IN (${placeholders})`,
    )
    .run(
      input.status,
      input.model ?? null,
      input.providerJobId ?? null,
      input.assetHash ?? null,
      input.reportedActualCostUsd ?? null,
      input.error ?? null,
      input.submittedAt ?? null,
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
  return requireWorkflowMediaAttempt(db, input.id);
}

export function recordWorkflowMediaEvaluation(
  db: BetterSqlite3.Database,
  input: RecordWorkflowMediaEvaluationInput,
): RecordWorkflowMediaEvaluationResult {
  if (input.expectedAttemptStatuses.length === 0) {
    throw new Error('Media evaluation requires an expected attempt status');
  }
  const record = db.transaction((): RecordWorkflowMediaEvaluationResult => {
    const evaluation = input.evaluation;
    const attemptRow = db
      .prepare('SELECT * FROM workflow_media_attempts WHERE id = ?')
      .get(evaluation.attemptId) as Record<string, unknown> | undefined;
    if (!attemptRow)
      throw new Error(`Production-media attempt "${evaluation.attemptId}" not found`);
    const attempt = rowToWorkflowMediaAttempt(attemptRow);
    if (
      attempt.workflowRunId !== evaluation.workflowRunId ||
      attempt.canvasId !== evaluation.canvasId ||
      attempt.nodeId !== evaluation.nodeId ||
      attempt.assetHash !== evaluation.assetHash ||
      attempt.mediaType !== evaluation.mediaType
    ) {
      throw new Error('Media evaluation identity does not match its provider attempt');
    }

    const existingRow = db
      .prepare('SELECT * FROM workflow_media_evaluations WHERE attempt_id = ?')
      .get(evaluation.attemptId) as Record<string, unknown> | undefined;
    if (existingRow) {
      const existing = rowToWorkflowMediaEvaluation(existingRow);
      if (JSON.stringify(existing) !== JSON.stringify(evaluation)) {
        throw new Error('A different immutable evaluation already exists for this attempt');
      }
      return { evaluation: existing, attempt, created: false };
    }

    if (
      attempt.rowVersion !== input.expectedAttemptRowVersion ||
      !input.expectedAttemptStatuses.includes(attempt.status)
    ) {
      throw new Error('Production-media attempt changed before evaluation was recorded');
    }

    db.prepare(
      `INSERT INTO workflow_media_evaluations (
         id, attempt_id, workflow_run_id, canvas_id, node_id, asset_hash,
         media_type, rubric_version, evaluator_provider_id, evaluator_model,
         scores_json, total, verdict, strengths_json, risks_json, evidence_json,
         repair_delta_json, metadata_json, frame_evidence_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      evaluation.id,
      evaluation.attemptId,
      evaluation.workflowRunId,
      evaluation.canvasId,
      evaluation.nodeId,
      evaluation.assetHash,
      evaluation.mediaType,
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
        `UPDATE workflow_media_attempts
         SET status = ?, row_version = row_version + 1, evaluated_at = ?,
             completed_at = ?, error_text = NULL, updated_at = ?
         WHERE id = ? AND row_version = ? AND status IN (${placeholders})`,
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
      evaluation: requireWorkflowMediaEvaluation(db, evaluation.attemptId),
      attempt: requireWorkflowMediaAttempt(db, attempt.id),
      created: true,
    };
  });
  return record.immediate();
}

export function getWorkflowMediaEvaluation(
  db: BetterSqlite3.Database,
  attemptId: string,
): WorkflowMediaEvaluation | undefined {
  const row = db
    .prepare('SELECT * FROM workflow_media_evaluations WHERE attempt_id = ?')
    .get(attemptId) as Record<string, unknown> | undefined;
  return row ? rowToWorkflowMediaEvaluation(row) : undefined;
}

function requireWorkflowMediaEvaluation(
  db: BetterSqlite3.Database,
  attemptId: string,
): WorkflowMediaEvaluation {
  const evaluation = getWorkflowMediaEvaluation(db, attemptId);
  if (!evaluation) {
    throw new Error(`Production-media evaluation "${attemptId}" disappeared after persistence`);
  }
  return evaluation;
}

export function listWorkflowMediaEvaluations(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): WorkflowMediaEvaluation[] {
  const rows = db
    .prepare(
      `SELECT * FROM workflow_media_evaluations
       WHERE workflow_run_id = ? ORDER BY created_at ASC, id ASC`,
    )
    .all(workflowRunId) as Array<Record<string, unknown>>;
  return rows.map(rowToWorkflowMediaEvaluation);
}

export function getWorkflowMediaCostSummary(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): WorkflowMediaCostSummary {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS attempt_count,
              COALESCE(SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END), 0) AS regeneration_count,
              COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
              COALESCE(SUM(reported_actual_cost_usd), 0) AS reported_actual_cost_usd,
              COALESCE(SUM(COALESCE(reported_actual_cost_usd, estimated_cost_usd)), 0) AS committed_cost_usd,
              COALESCE(SUM(CASE WHEN reported_actual_cost_usd IS NULL THEN 1 ELSE 0 END), 0) AS unreported_count
       FROM workflow_media_attempts WHERE workflow_run_id = ?`,
    )
    .get(workflowRunId) as Record<string, unknown>;
  return {
    attemptCount: Number(row.attempt_count),
    regenerationCount: Number(row.regeneration_count),
    estimatedCostUsd: Number(row.estimated_cost_usd),
    reportedActualCostUsd: Number(row.reported_actual_cost_usd),
    committedCostUsd: Number(row.committed_cost_usd),
    hasUnreportedActualCosts: Number(row.unreported_count) > 0,
  };
}

export function reserveWorkflowExportExecution(
  db: BetterSqlite3.Database,
  input: ReserveWorkflowExportExecutionInput,
): ReserveWorkflowExportExecutionResult {
  const reserve = db.transaction((): ReserveWorkflowExportExecutionResult => {
    const proposed = input.execution;
    if (proposed.status !== 'queued' || proposed.rowVersion !== 0 || proposed.attempt !== 1) {
      throw new Error('New Final Export execution must begin queued at rowVersion 0 and attempt 1');
    }
    const run = db
      .prepare('SELECT current_gate FROM workflow_runs WHERE id = ?')
      .get(proposed.workflowRunId) as { current_gate: string | null } | undefined;
    if (!run) throw new Error(`Workflow "${proposed.workflowRunId}" not found`);
    if (run.current_gate !== null) {
      throw new Error(`Workflow is awaiting ${run.current_gate} approval`);
    }
    const approval = db
      .prepare(
        `SELECT subject_revision, subject_hash, status
         FROM workflow_approvals
         WHERE workflow_run_id = ? AND gate_key = 'final_export'
         ORDER BY subject_revision DESC, created_at DESC
         LIMIT 1`,
      )
      .get(proposed.workflowRunId) as
      { subject_revision: number; subject_hash: string; status: string } | undefined;
    if (
      !approval ||
      approval.status !== 'approved' ||
      Number(approval.subject_revision) !== proposed.manifestRevision ||
      String(approval.subject_hash) !== proposed.manifestHash
    ) {
      throw new Error('Exact approved Final Export manifest is required before execution');
    }

    const existingRow = db
      .prepare(
        `SELECT * FROM workflow_export_executions
         WHERE idempotency_key = ?
            OR (workflow_run_id = ? AND manifest_revision = ? AND manifest_hash = ?)
         LIMIT 1`,
      )
      .get(
        proposed.idempotencyKey,
        proposed.workflowRunId,
        proposed.manifestRevision,
        proposed.manifestHash,
      ) as Record<string, unknown> | undefined;
    if (existingRow) {
      const existing = rowToWorkflowExportExecution(existingRow);
      if (
        existing.idempotencyKey !== proposed.idempotencyKey ||
        existing.destinationPath !== proposed.destinationPath
      ) {
        throw new Error(
          'Final Export execution already exists with a different identity or destination',
        );
      }
      return { execution: existing, created: false };
    }

    db.prepare(
      `INSERT INTO workflow_export_executions (
         id, workflow_run_id, manifest_revision, manifest_hash, idempotency_key,
         status, row_version, staging_path, destination_path, output_asset_hash,
         output_hash, output_size, attempt, error_text, created_at, updated_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      proposed.id,
      proposed.workflowRunId,
      proposed.manifestRevision,
      proposed.manifestHash,
      proposed.idempotencyKey,
      proposed.status,
      proposed.rowVersion,
      proposed.stagingPath ?? null,
      proposed.destinationPath,
      proposed.outputAssetHash ?? null,
      proposed.outputHash ?? null,
      proposed.outputSize ?? null,
      proposed.attempt,
      proposed.error ?? null,
      proposed.createdAt,
      proposed.updatedAt,
      proposed.completedAt ?? null,
    );
    const createdRow = db
      .prepare('SELECT * FROM workflow_export_executions WHERE id = ?')
      .get(proposed.id) as Record<string, unknown>;
    return { execution: rowToWorkflowExportExecution(createdRow), created: true };
  });
  return reserve.immediate();
}

export function getWorkflowExportExecution(
  db: BetterSqlite3.Database,
  id: string,
): WorkflowExportExecution | undefined {
  const row = db.prepare('SELECT * FROM workflow_export_executions WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  return row ? rowToWorkflowExportExecution(row) : undefined;
}

function requireWorkflowExportExecution(
  db: BetterSqlite3.Database,
  id: string,
): WorkflowExportExecution {
  const execution = getWorkflowExportExecution(db, id);
  if (!execution) throw new Error(`Final Export execution "${id}" disappeared after persistence`);
  return execution;
}

export function getLatestWorkflowExportExecution(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): WorkflowExportExecution | undefined {
  const row = db
    .prepare(
      `SELECT * FROM workflow_export_executions
       WHERE workflow_run_id = ?
       ORDER BY manifest_revision DESC, created_at DESC
       LIMIT 1`,
    )
    .get(workflowRunId) as Record<string, unknown> | undefined;
  return row ? rowToWorkflowExportExecution(row) : undefined;
}

export function listRecoverableWorkflowExportExecutions(
  db: BetterSqlite3.Database,
): WorkflowExportExecution[] {
  const rows = db
    .prepare(
      `SELECT * FROM workflow_export_executions
       WHERE status IN ('queued', 'running', 'ready_to_publish', 'recovery_required')
       ORDER BY updated_at ASC, id ASC`,
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToWorkflowExportExecution);
}

export function transitionWorkflowExportExecution(
  db: BetterSqlite3.Database,
  input: TransitionWorkflowExportExecutionInput,
): WorkflowExportExecution {
  if (input.expectedStatuses.length === 0) {
    throw new Error('Final Export transition requires at least one expected status');
  }
  const placeholders = input.expectedStatuses.map(() => '?').join(', ');
  const changed = db
    .prepare(
      `UPDATE workflow_export_executions
       SET status = ?, row_version = row_version + 1,
           staging_path = COALESCE(?, staging_path),
           output_asset_hash = COALESCE(?, output_asset_hash),
           output_hash = COALESCE(?, output_hash),
           output_size = COALESCE(?, output_size),
           error_text = ?, updated_at = ?
       WHERE id = ? AND row_version = ? AND status IN (${placeholders})`,
    )
    .run(
      input.status,
      input.stagingPath ?? null,
      input.outputAssetHash ?? null,
      input.outputHash ?? null,
      input.outputSize ?? null,
      input.error ?? null,
      input.updatedAt,
      input.id,
      input.expectedRowVersion,
      ...input.expectedStatuses,
    ).changes;
  if (changed !== 1) throw new Error('Final Export execution state changed concurrently');
  return requireWorkflowExportExecution(db, input.id);
}

export function retryWorkflowExportExecution(
  db: BetterSqlite3.Database,
  input: { id: string; expectedRowVersion: number; updatedAt: number },
): WorkflowExportExecution {
  const changed = db
    .prepare(
      `UPDATE workflow_export_executions
       SET status = 'queued', row_version = row_version + 1, attempt = attempt + 1,
           staging_path = NULL, output_asset_hash = NULL, output_hash = NULL,
           output_size = NULL, error_text = NULL, completed_at = NULL, updated_at = ?
       WHERE id = ? AND row_version = ?
         AND status IN ('failed', 'cancelled', 'recovery_required')`,
    )
    .run(input.updatedAt, input.id, input.expectedRowVersion).changes;
  if (changed !== 1)
    throw new Error('Final Export execution is not retryable or changed concurrently');
  return requireWorkflowExportExecution(db, input.id);
}

export function completeWorkflowExportExecution(
  db: BetterSqlite3.Database,
  input: CompleteWorkflowExportExecutionInput,
): { execution: WorkflowExportExecution; run: WorkflowRun; event: WorkflowEvent } {
  const complete = db.transaction(() => {
    const executionRow = db
      .prepare('SELECT * FROM workflow_export_executions WHERE id = ?')
      .get(input.id) as Record<string, unknown> | undefined;
    if (!executionRow) throw new Error(`Final Export execution "${input.id}" not found`);
    const execution = rowToWorkflowExportExecution(executionRow);
    if (
      execution.rowVersion !== input.expectedExecutionRowVersion ||
      execution.status !== 'ready_to_publish'
    ) {
      throw new Error('Final Export execution is not ready to complete or changed concurrently');
    }
    const executionChanged = db
      .prepare(
        `UPDATE workflow_export_executions
         SET status = 'completed', row_version = row_version + 1,
             output_asset_hash = ?, output_hash = ?, output_size = ?,
             error_text = NULL, updated_at = ?, completed_at = ?
         WHERE id = ? AND row_version = ? AND status = 'ready_to_publish'`,
      )
      .run(
        input.outputAssetHash,
        input.outputHash,
        input.outputSize,
        input.completedAt,
        input.completedAt,
        input.id,
        input.expectedExecutionRowVersion,
      ).changes;
    if (executionChanged !== 1) throw new Error('Final Export completion CAS failed');

    const runChanged = db
      .prepare(
        `UPDATE workflow_runs
         SET status = 'completed', summary = 'Final export completed', progress = 100,
             output_json = ?, error_text = NULL, completed_at = ?, updated_at = ?,
             row_version = row_version + 1
         WHERE id = ? AND row_version = ? AND current_gate IS NULL`,
      )
      .run(
        JSON.stringify(input.runOutput),
        input.completedAt,
        input.completedAt,
        execution.workflowRunId,
        input.expectedRunRowVersion,
      ).changes;
    if (runChanged !== 1) throw new Error('Workflow changed before Final Export completion');

    const seqRow = db
      .prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM workflow_events WHERE workflow_run_id = ?',
      )
      .get(execution.workflowRunId) as { next_seq: number };
    const event: WorkflowEvent = { ...input.event, seq: Number(seqRow.next_seq) };
    insertWorkflowEvent(db, event);

    const updatedExecution = requireWorkflowExportExecution(db, input.id);
    const updatedRunRow = db
      .prepare('SELECT * FROM workflow_runs WHERE id = ?')
      .get(execution.workflowRunId) as Record<string, unknown>;
    return { execution: updatedExecution, run: rowToWorkflowRun(updatedRunRow), event };
  });
  return complete.immediate();
}

function insertWorkflowEvent(db: BetterSqlite3.Database, event: WorkflowEvent): void {
  db.prepare(
    `INSERT INTO workflow_events (
       workflow_run_id, seq, event_id, actor, correlation_id, causation_id,
       payload_json, event_timestamp
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.workflowRunId,
    event.seq,
    event.eventId,
    event.actor,
    event.correlationId ?? null,
    event.causationId ?? null,
    JSON.stringify(event.payload),
    event.timestamp,
  );
}

// --- Workflow Stage Runs ---

export function insertWorkflowStageRun(
  db: BetterSqlite3.Database,
  stageRun: WorkflowStageRun,
): void {
  db.prepare(
    `
    INSERT INTO workflow_stage_runs (
      id, workflow_run_id, stage_id, name, status, stage_order,
      progress, completed_tasks, total_tasks, error_text, metadata_json,
      started_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    stageRun.id,
    stageRun.workflowRunId,
    stageRun.stageId,
    stageRun.name,
    stageRun.status,
    stageRun.order,
    stageRun.progress,
    stageRun.completedTasks,
    stageRun.totalTasks,
    stageRun.error ?? null,
    JSON.stringify(stageRun.metadata),
    stageRun.startedAt ?? null,
    stageRun.completedAt ?? null,
    stageRun.updatedAt,
  );
}

export function listWorkflowStageRuns(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): WorkflowStageRun[] {
  const rows = db
    .prepare('SELECT * FROM workflow_stage_runs WHERE workflow_run_id = ? ORDER BY stage_order ASC')
    .all(workflowRunId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToWorkflowStageRun(row));
}

export function getWorkflowStageRun(
  db: BetterSqlite3.Database,
  id: string,
): WorkflowStageRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_stage_runs WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToWorkflowStageRun(row);
}

export function updateWorkflowStageRun(
  db: BetterSqlite3.Database,
  id: string,
  updates: Partial<
    Pick<
      WorkflowStageRun,
      | 'status'
      | 'progress'
      | 'completedTasks'
      | 'totalTasks'
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
  if (updates.progress !== undefined) {
    sets.push('progress = ?');
    params.push(updates.progress);
  }
  if (updates.completedTasks !== undefined) {
    sets.push('completed_tasks = ?');
    params.push(updates.completedTasks);
  }
  if (updates.totalTasks !== undefined) {
    sets.push('total_tasks = ?');
    params.push(updates.totalTasks);
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
  db.prepare(`UPDATE workflow_stage_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

// --- Workflow Task Runs ---

export function insertWorkflowTaskRun(db: BetterSqlite3.Database, taskRun: WorkflowTaskRun): void {
  db.prepare(
    `
    INSERT INTO workflow_task_runs (
      id, workflow_run_id, stage_run_id, task_id, name, kind, status,
      provider, dependency_ids_json, attempts, max_retries,
      input_json, output_json, provider_task_id, asset_id, error_text,
      progress, current_step, started_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    taskRun.id,
    taskRun.workflowRunId,
    taskRun.stageRunId,
    taskRun.taskId,
    taskRun.name,
    taskRun.kind,
    taskRun.status,
    taskRun.provider ?? null,
    JSON.stringify(taskRun.dependencyIds),
    taskRun.attempts,
    taskRun.maxRetries,
    JSON.stringify(taskRun.input),
    JSON.stringify(taskRun.output),
    taskRun.providerTaskId ?? null,
    taskRun.assetId ?? null,
    taskRun.error ?? null,
    taskRun.progress,
    taskRun.currentStep ?? null,
    taskRun.startedAt ?? null,
    taskRun.completedAt ?? null,
    taskRun.updatedAt,
  );

  replaceWorkflowTaskDependencies(db, taskRun.id, taskRun.dependencyIds);
}

export function listWorkflowTaskRuns(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): WorkflowTaskRun[] {
  const rows = db
    .prepare(
      'SELECT * FROM workflow_task_runs WHERE workflow_run_id = ? ORDER BY updated_at DESC, id ASC',
    )
    .all(workflowRunId) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const depsMap = listTaskDependenciesBatch(db, ids);
  return rows.map((row) => rowToWorkflowTaskRunWithDeps(row, depsMap));
}

export function listWorkflowTaskRunsByStage(
  db: BetterSqlite3.Database,
  stageRunId: string,
): WorkflowTaskRun[] {
  const rows = db
    .prepare(
      'SELECT * FROM workflow_task_runs WHERE stage_run_id = ? ORDER BY updated_at DESC, id ASC',
    )
    .all(stageRunId) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const depsMap = listTaskDependenciesBatch(db, ids);
  return rows.map((row) => rowToWorkflowTaskRunWithDeps(row, depsMap));
}

export function listReadyWorkflowTasks(
  db: BetterSqlite3.Database,
  workflowRunId?: string,
): WorkflowTaskRun[] {
  const params: unknown[] = ['ready'];
  let where = 'status = ?';

  if (workflowRunId !== undefined) {
    where += ' AND workflow_run_id = ?';
    params.push(workflowRunId);
  }

  const rows = db
    .prepare(`SELECT * FROM workflow_task_runs WHERE ${where} ORDER BY updated_at ASC, id ASC`)
    .all(...params) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const depsMap = listTaskDependenciesBatch(db, ids);
  return rows.map((row) => rowToWorkflowTaskRunWithDeps(row, depsMap));
}

export function listAwaitingProviderTasks(
  db: BetterSqlite3.Database,
  workflowRunId?: string,
): WorkflowTaskRun[] {
  const params: unknown[] = ['awaiting_provider'];
  let where = 'status = ?';

  if (workflowRunId !== undefined) {
    where += ' AND workflow_run_id = ?';
    params.push(workflowRunId);
  }

  const rows = db
    .prepare(`SELECT * FROM workflow_task_runs WHERE ${where} ORDER BY updated_at ASC, id ASC`)
    .all(...params) as Array<Record<string, unknown>>;
  const ids = rows.map((r) => r.id as string);
  const depsMap = listTaskDependenciesBatch(db, ids);
  return rows.map((row) => rowToWorkflowTaskRunWithDeps(row, depsMap));
}

export function getWorkflowTaskRun(
  db: BetterSqlite3.Database,
  id: string,
): WorkflowTaskRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_task_runs WHERE id = ?').get(id) as
    Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToWorkflowTaskRun(db, row);
}

export function updateWorkflowTaskRun(
  db: BetterSqlite3.Database,
  id: string,
  updates: Partial<
    Pick<
      WorkflowTaskRun,
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
  db.prepare(`UPDATE workflow_task_runs SET ${sets.join(', ')} WHERE id = ?`).run(...params);

  if (updates.dependencyIds !== undefined) {
    replaceWorkflowTaskDependencies(db, id, updates.dependencyIds);
  }
}

// --- Task Dependencies ---

export function replaceWorkflowTaskDependencies(
  db: BetterSqlite3.Database,
  taskRunId: string,
  dependencyIds: string[],
): void {
  const replaceDependencies = db.transaction((nextDependencyIds: string[]) => {
    db.prepare('DELETE FROM workflow_task_dependencies WHERE task_run_id = ?').run(taskRunId);
    const insertDependency = db.prepare(`
      INSERT OR IGNORE INTO workflow_task_dependencies (task_run_id, depends_on_task_run_id)
      VALUES (?, ?)
    `);
    for (const dependencyId of nextDependencyIds) {
      insertDependency.run(taskRunId, dependencyId);
    }
  });

  replaceDependencies(dependencyIds);
}

export function insertWorkflowTaskDependency(
  db: BetterSqlite3.Database,
  taskRunId: string,
  dependsOnTaskRunId: string,
): void {
  db.prepare(
    `
    INSERT OR IGNORE INTO workflow_task_dependencies (task_run_id, depends_on_task_run_id)
    VALUES (?, ?)
  `,
  ).run(taskRunId, dependsOnTaskRunId);

  const dependencyIds = listTaskDependencies(db, taskRunId);
  db.prepare(
    `
    UPDATE workflow_task_runs
    SET dependency_ids_json = ?
    WHERE id = ?
  `,
  ).run(JSON.stringify(dependencyIds), taskRunId);
}

export function listTaskDependencies(db: BetterSqlite3.Database, taskRunId: string): string[] {
  const rows = db
    .prepare(
      'SELECT depends_on_task_run_id FROM workflow_task_dependencies WHERE task_run_id = ? ORDER BY depends_on_task_run_id ASC',
    )
    .all(taskRunId) as Array<{ depends_on_task_run_id: string }>;
  return rows.map((row) => row.depends_on_task_run_id);
}

/**
 * Batch version of listTaskDependencies — fetches dependencies for all
 * provided task run IDs in a single query, avoiding N+1 per-row lookups.
 * Returns a Map<taskRunId, dependsOnTaskRunId[]>.
 */
export function listTaskDependenciesBatch(
  db: BetterSqlite3.Database,
  taskRunIds: string[],
): Map<string, string[]> {
  if (taskRunIds.length === 0) return new Map();
  const placeholders = taskRunIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT task_run_id, depends_on_task_run_id
       FROM workflow_task_dependencies
       WHERE task_run_id IN (${placeholders})
       ORDER BY task_run_id ASC, depends_on_task_run_id ASC`,
    )
    .all(...taskRunIds) as Array<{ task_run_id: string; depends_on_task_run_id: string }>;
  const result = new Map<string, string[]>();
  for (const id of taskRunIds) result.set(id, []);
  for (const row of rows) {
    result.get(row.task_run_id)!.push(row.depends_on_task_run_id);
  }
  return result;
}

export function listTaskDependents(
  db: BetterSqlite3.Database,
  dependsOnTaskRunId: string,
): string[] {
  const rows = db
    .prepare(
      'SELECT task_run_id FROM workflow_task_dependencies WHERE depends_on_task_run_id = ? ORDER BY task_run_id ASC',
    )
    .all(dependsOnTaskRunId) as Array<{ task_run_id: string }>;
  return rows.map((row) => row.task_run_id);
}

// --- Workflow Artifacts ---

export function insertWorkflowArtifact(
  db: BetterSqlite3.Database,
  artifact: WorkflowArtifact,
): void {
  db.prepare(
    `
    INSERT INTO workflow_artifacts (
      id, workflow_run_id, task_run_id, artifact_type, entity_type,
      entity_id, asset_hash, path, metadata_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    artifact.id,
    artifact.workflowRunId,
    artifact.taskRunId,
    artifact.artifactType,
    artifact.entityType ?? null,
    artifact.entityId ?? null,
    artifact.assetHash ?? null,
    artifact.path ?? null,
    JSON.stringify(artifact.metadata),
    artifact.createdAt,
  );
}

export function listWorkflowArtifacts(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): WorkflowArtifact[] {
  const rows = db
    .prepare(
      'SELECT * FROM workflow_artifacts WHERE workflow_run_id = ? ORDER BY created_at DESC, id ASC',
    )
    .all(workflowRunId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToWorkflowArtifact(row));
}

export function listEntityArtifacts(
  db: BetterSqlite3.Database,
  entityType: string,
  entityId: string,
): WorkflowArtifact[] {
  const rows = db
    .prepare(
      'SELECT * FROM workflow_artifacts WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC, id ASC',
    )
    .all(entityType, entityId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToWorkflowArtifact(row));
}

export function listWorkflowArtifactsByTaskRun(
  db: BetterSqlite3.Database,
  taskRunId: string,
): WorkflowArtifact[] {
  const rows = db
    .prepare(
      'SELECT * FROM workflow_artifacts WHERE task_run_id = ? ORDER BY created_at DESC, id ASC',
    )
    .all(taskRunId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToWorkflowArtifact(row));
}

/**
 * Batch version of listWorkflowArtifactsByTaskRun — fetches artifacts for all
 * provided task run IDs in a single query, avoiding N+1 per-row lookups.
 * Returns a Map<taskRunId, WorkflowArtifact[]>.
 */
export function listWorkflowArtifactsByTaskRunBatch(
  db: BetterSqlite3.Database,
  taskRunIds: string[],
): Map<string, WorkflowArtifact[]> {
  if (taskRunIds.length === 0) return new Map();
  const placeholders = taskRunIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT * FROM workflow_artifacts
       WHERE task_run_id IN (${placeholders})
       ORDER BY created_at DESC, id ASC`,
    )
    .all(...taskRunIds) as Array<Record<string, unknown>>;
  const result = new Map<string, WorkflowArtifact[]>();
  for (const id of taskRunIds) result.set(id, []);
  for (const row of rows) {
    const taskRunId = row.task_run_id as string;
    result.get(taskRunId)?.push(rowToWorkflowArtifact(row));
  }
  return result;
}

// --- Task Summaries ---

export function listWorkflowTaskSummaries(
  db: BetterSqlite3.Database,
  filter?: {
    workflowRunId?: string;
    stageRunId?: string;
    status?: WorkflowTaskRun['status'];
    kind?: WorkflowTaskRun['kind'];
    limit?: number;
    offset?: number;
  },
): WorkflowTaskSummary[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.workflowRunId) {
    conditions.push('t.workflow_run_id = ?');
    params.push(filter.workflowRunId);
  }
  if (filter?.stageRunId) {
    conditions.push('t.stage_run_id = ?');
    params.push(filter.stageRunId);
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
      s.stage_id AS stage_id_value,
      w.entity_type AS workflow_entity_type,
      w.entity_id AS workflow_entity_id,
      w.metadata_json AS workflow_metadata_json
    FROM workflow_task_runs t
    JOIN workflow_stage_runs s ON s.id = t.stage_run_id
    JOIN workflow_runs w ON w.id = t.workflow_run_id
    ${where}
    ORDER BY t.updated_at DESC, t.id ASC
    LIMIT ? OFFSET ?
  `,
    )
    .all(...params, limit, offset) as Array<Record<string, unknown>>;

  const taskRunIds = rows.map((r) => r.id as string);
  const artifactsMap = listWorkflowArtifactsByTaskRunBatch(db, taskRunIds);
  return rows.map((row) => rowToWorkflowTaskSummary(row, artifactsMap));
}

// --- Aggregation ---

export function recomputeStageAggregate(db: BetterSqlite3.Database, stageRunId: string): void {
  const stageRow = db
    .prepare('SELECT workflow_run_id, updated_at FROM workflow_stage_runs WHERE id = ?')
    .get(stageRunId) as { workflow_run_id: string; updated_at: number } | undefined;
  if (!stageRow) {
    return;
  }

  const taskRows = db
    .prepare(
      'SELECT id, status, progress, updated_at FROM workflow_task_runs WHERE stage_run_id = ? ORDER BY updated_at DESC, id ASC',
    )
    .all(stageRunId) as Array<{
    id: string;
    status: WorkflowTaskRun['status'];
    progress: number | null;
    updated_at: number;
  }>;

  const totalTasks = taskRows.length;
  const completedTasks = taskRows.filter((task) => task.status === 'completed').length;
  const hasRunning = taskRows.some(
    (task) => task.status === 'running' || task.status === 'awaiting_provider',
  );
  const hasFailed = taskRows.some(
    (task) => task.status === 'failed' || task.status === 'retryable_failed',
  );
  const hasCancelled = taskRows.some((task) => task.status === 'cancelled');
  const hasBlocked = taskRows.some((task) => task.status === 'blocked');
  const hasReady = taskRows.some((task) => task.status === 'ready');
  const allTerminal =
    totalTasks > 0 &&
    taskRows.every(
      (task) =>
        task.status === 'completed' ||
        task.status === 'skipped' ||
        task.status === 'failed' ||
        task.status === 'retryable_failed' ||
        task.status === 'cancelled',
    );
  const allCompleteLike =
    totalTasks > 0 &&
    taskRows.every((task) => task.status === 'completed' || task.status === 'skipped');
  const hasCompletedWithErrors = allTerminal && hasFailed && completedTasks > 0;

  let status: WorkflowStageRun['status'] = 'pending';
  if (hasRunning) {
    status = 'running';
  } else if (hasCompletedWithErrors) {
    status = 'completed_with_errors';
  } else if (hasFailed) {
    status = 'failed';
  } else if (hasCancelled) {
    status = 'cancelled';
  } else if (allCompleteLike) {
    status = 'completed';
  } else if (hasBlocked) {
    status = 'blocked';
  } else if (hasReady) {
    status = 'ready';
  }

  const progress =
    allCompleteLike || hasCompletedWithErrors
      ? 100
      : totalTasks === 0
        ? 0
        : Math.round(
            taskRows.reduce((sum, task) => sum + Number(task.progress ?? 0), 0) / totalTasks,
          );
  const updatedAt = Math.max(stageRow.updated_at, ...taskRows.map((task) => task.updated_at));

  updateWorkflowStageRun(db, stageRunId, {
    status,
    totalTasks,
    completedTasks,
    progress,
    updatedAt,
  });
}

export function recomputeWorkflowAggregate(
  db: BetterSqlite3.Database,
  workflowRunId: string,
): void {
  const workflowRow = db
    .prepare('SELECT updated_at FROM workflow_runs WHERE id = ?')
    .get(workflowRunId) as { updated_at: number } | undefined;
  if (!workflowRow) {
    return;
  }

  // Lightweight stage query — only columns needed for aggregate computation.
  // Avoids loading metadata_json for each stage.
  const stages = db
    .prepare(
      `SELECT id, status, progress, updated_at
       FROM workflow_stage_runs
       WHERE workflow_run_id = ?
       ORDER BY stage_order ASC`,
    )
    .all(workflowRunId) as Array<{
    id: string;
    status: WorkflowStageRun['status'];
    progress: number;
    updated_at: number;
  }>;

  // Lightweight task query — only columns needed for aggregate computation.
  // Avoids loading input_json/output_json for each task.
  const tasks = db
    .prepare(
      `SELECT id, status, updated_at
       FROM workflow_task_runs
       WHERE workflow_run_id = ?
       ORDER BY updated_at DESC, id ASC`,
    )
    .all(workflowRunId) as Array<{
    id: string;
    status: WorkflowTaskRun['status'];
    updated_at: number;
  }>;

  const totalStages = stages.length;
  const completedStages = stages.filter((stage) => stage.status === 'completed').length;
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((task) => task.status === 'completed').length;

  const hasRunningTask = tasks.some(
    (task) => task.status === 'running' || task.status === 'awaiting_provider',
  );
  const hasFailedStage = stages.some((stage) => stage.status === 'failed');
  const hasFailedTask = tasks.some(
    (task) => task.status === 'failed' || task.status === 'retryable_failed',
  );
  const hasCancelled =
    stages.some((stage) => stage.status === 'cancelled') ||
    tasks.some((task) => task.status === 'cancelled');
  const hasBlocked =
    stages.some((stage) => stage.status === 'blocked') ||
    tasks.some((task) => task.status === 'blocked');
  const hasReady =
    stages.some((stage) => stage.status === 'ready') ||
    tasks.some((task) => task.status === 'ready');
  const allStagesCompleted =
    totalStages > 0 && stages.every((stage) => stage.status === 'completed');
  const allStagesTerminal =
    totalStages > 0 &&
    stages.every(
      (stage) =>
        stage.status === 'completed' ||
        stage.status === 'completed_with_errors' ||
        stage.status === 'failed' ||
        stage.status === 'cancelled' ||
        stage.status === 'skipped',
    );
  const hasCompletedWithErrors =
    allStagesTerminal &&
    stages.some((stage) => stage.status === 'completed_with_errors') &&
    completedTasks > 0;

  let status: WorkflowRun['status'];
  if (hasRunningTask) {
    status = 'running';
  } else if (hasCompletedWithErrors) {
    status = 'completed_with_errors';
  } else if (hasFailedStage || hasFailedTask) {
    status = 'failed';
  } else if (hasCancelled) {
    status = 'cancelled';
  } else if (allStagesCompleted) {
    status = 'completed';
  } else if (hasBlocked) {
    status = 'blocked';
  } else if (hasReady) {
    status = 'ready';
  } else {
    status = 'pending';
  }

  const progress =
    status === 'completed' || status === 'completed_with_errors' || status === 'cancelled'
      ? 100
      : totalStages === 0
        ? 0
        : Math.round(stages.reduce((sum, stage) => sum + stage.progress, 0) / totalStages);

  const currentStage =
    status === 'completed' || status === 'completed_with_errors' || status === 'cancelled'
      ? undefined
      : (stages.find((stage) => stage.status === 'running') ??
        stages.find(
          (stage) =>
            stage.status !== 'completed' &&
            stage.status !== 'completed_with_errors' &&
            stage.status !== 'skipped' &&
            stage.status !== 'cancelled',
        ));
  const currentTask =
    status === 'completed' || status === 'completed_with_errors' || status === 'cancelled'
      ? undefined
      : (tasks.find((task) => task.status === 'running' || task.status === 'awaiting_provider') ??
        tasks.find(
          (task) =>
            task.status !== 'completed' && task.status !== 'skipped' && task.status !== 'cancelled',
        ));

  const summary = `${status} ${completedStages}/${totalStages} stages, ${completedTasks}/${totalTasks} tasks`;
  const updatedAt = Math.max(
    workflowRow.updated_at,
    ...stages.map((stage) => stage.updated_at),
    ...tasks.map((task) => task.updated_at),
  );

  updateWorkflowRun(db, workflowRunId, {
    status,
    progress,
    completedStages,
    totalStages,
    completedTasks,
    totalTasks,
    currentStageId: currentStage?.id,
    currentTaskId: currentTask?.id,
    summary,
    updatedAt,
  });
}

// --- Row Mappers ---

export function rowToWorkflowRun(row: Record<string, unknown>): WorkflowRun {
  return {
    id: row.id as string,
    workflowType: row.workflow_type as string,
    entityType: row.entity_type as string,
    entityId: row.entity_id == null ? undefined : String(row.entity_id),
    triggerSource: row.trigger_source as string,
    status: row.status as WorkflowRun['status'],
    summary: (row.summary as string) ?? '',
    progress: Number(row.progress ?? 0),
    completedStages: Number(row.completed_stages ?? 0),
    totalStages: Number(row.total_stages ?? 0),
    completedTasks: Number(row.completed_tasks ?? 0),
    totalTasks: Number(row.total_tasks ?? 0),
    currentStageId: row.current_stage_id == null ? undefined : String(row.current_stage_id),
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
      row.current_gate == null
        ? undefined
        : (String(row.current_gate) as WorkflowRun['currentGate']),
    engineVersion: row.engine_version == null ? 'legacy' : String(row.engine_version),
    definitionVersion: Number(row.definition_version ?? 1),
  };
}

function rowToWorkflowDocument(row: Record<string, unknown>): WorkflowDocument {
  return {
    id: String(row.id),
    workflowRunId: String(row.workflow_run_id),
    logicalKey: String(row.logical_key),
    documentType: String(row.document_type),
    revision: Number(row.revision),
    schemaVersion: Number(row.schema_version),
    content: JSON.parse(String(row.content_json || '{}')) as Record<string, unknown>,
    contentHash: String(row.content_hash),
    status: row.status as WorkflowDocument['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToWorkflowApproval(row: Record<string, unknown>): WorkflowApproval {
  return {
    id: String(row.id),
    workflowRunId: String(row.workflow_run_id),
    gateKey: row.gate_key as WorkflowApproval['gateKey'],
    subjectLogicalKey: String(row.subject_logical_key),
    subjectRevision: Number(row.subject_revision),
    subjectHash: String(row.subject_hash),
    manifestHash: String(row.manifest_hash),
    resumeTokenHash: String(row.resume_token_hash),
    status: row.status as WorkflowApproval['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    decidedAt: row.decided_at == null ? undefined : Number(row.decided_at),
  };
}

function rowToWorkflowExportExecution(row: Record<string, unknown>): WorkflowExportExecution {
  return {
    id: String(row.id),
    workflowRunId: String(row.workflow_run_id),
    manifestRevision: Number(row.manifest_revision),
    manifestHash: String(row.manifest_hash),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as WorkflowExportExecution['status'],
    rowVersion: Number(row.row_version ?? 0),
    stagingPath: row.staging_path == null ? undefined : String(row.staging_path),
    destinationPath: String(row.destination_path),
    outputAssetHash: row.output_asset_hash == null ? undefined : String(row.output_asset_hash),
    outputHash: row.output_hash == null ? undefined : String(row.output_hash),
    outputSize: row.output_size == null ? undefined : Number(row.output_size),
    attempt: Number(row.attempt),
    error: row.error_text == null ? undefined : String(row.error_text),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
  };
}

function rowToWorkflowMediaAttempt(row: Record<string, unknown>): WorkflowMediaAttempt {
  return {
    id: String(row.id),
    workflowRunId: String(row.workflow_run_id),
    canvasId: String(row.canvas_id),
    nodeId: String(row.node_id),
    attempt: Number(row.attempt),
    idempotencyKey: String(row.idempotency_key),
    specHash: String(row.spec_hash),
    generationSpec: JSON.parse(String(row.generation_spec_json || '{}')),
    repairDelta:
      row.repair_delta_json == null ? undefined : JSON.parse(String(row.repair_delta_json)),
    mediaType: row.media_type as WorkflowMediaAttempt['mediaType'],
    status: row.status as WorkflowMediaAttempt['status'],
    rowVersion: Number(row.row_version ?? 0),
    providerId: String(row.provider_id),
    model: row.model == null ? undefined : String(row.model),
    prompt: String(row.prompt),
    promptHash: String(row.prompt_hash),
    negativePrompt: row.negative_prompt == null ? undefined : String(row.negative_prompt),
    seed: row.seed == null ? undefined : Number(row.seed),
    estimatedCostUsd: Number(row.estimated_cost_usd),
    reportedActualCostUsd:
      row.reported_actual_cost_usd == null ? undefined : Number(row.reported_actual_cost_usd),
    providerJobId: row.provider_job_id == null ? undefined : String(row.provider_job_id),
    assetHash: row.asset_hash == null ? undefined : String(row.asset_hash),
    error: row.error_text == null ? undefined : String(row.error_text),
    createdAt: Number(row.created_at),
    submittedAt: row.submitted_at == null ? undefined : Number(row.submitted_at),
    assetReadyAt: row.asset_ready_at == null ? undefined : Number(row.asset_ready_at),
    evaluatedAt: row.evaluated_at == null ? undefined : Number(row.evaluated_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    updatedAt: Number(row.updated_at),
  };
}

function rowToWorkflowMediaEvaluation(row: Record<string, unknown>): WorkflowMediaEvaluation {
  return {
    id: String(row.id),
    attemptId: String(row.attempt_id),
    workflowRunId: String(row.workflow_run_id),
    canvasId: String(row.canvas_id),
    nodeId: String(row.node_id),
    assetHash: String(row.asset_hash),
    mediaType: row.media_type as WorkflowMediaEvaluation['mediaType'],
    rubricVersion: String(row.rubric_version),
    evaluatorProviderId: String(row.evaluator_provider_id),
    evaluatorModel: row.evaluator_model == null ? undefined : String(row.evaluator_model),
    scores: JSON.parse(String(row.scores_json || '{}')),
    total: Number(row.total),
    verdict: row.verdict as WorkflowMediaEvaluation['verdict'],
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

function rowToWorkflowEvent(row: Record<string, unknown>): WorkflowEvent {
  return {
    workflowRunId: String(row.workflow_run_id),
    seq: Number(row.seq),
    eventId: String(row.event_id),
    actor: String(row.actor),
    correlationId: row.correlation_id == null ? undefined : String(row.correlation_id),
    causationId: row.causation_id == null ? undefined : String(row.causation_id),
    payload: JSON.parse(String(row.payload_json || '{}')) as Record<string, unknown>,
    timestamp: Number(row.event_timestamp),
  };
}

function rowToWorkflowStageRun(row: Record<string, unknown>): WorkflowStageRun {
  return {
    id: row.id as string,
    workflowRunId: row.workflow_run_id as string,
    stageId: row.stage_id as string,
    name: row.name as string,
    status: row.status as WorkflowStageRun['status'],
    order: Number(row.stage_order ?? 0),
    progress: Number(row.progress ?? 0),
    completedTasks: Number(row.completed_tasks ?? 0),
    totalTasks: Number(row.total_tasks ?? 0),
    error: row.error_text == null ? undefined : String(row.error_text),
    metadata: JSON.parse((row.metadata_json as string) || '{}'),
    startedAt: row.started_at == null ? undefined : Number(row.started_at),
    completedAt: row.completed_at == null ? undefined : Number(row.completed_at),
    updatedAt: row.updated_at as number,
  };
}

function rowToWorkflowTaskRun(
  db: BetterSqlite3.Database,
  row: Record<string, unknown>,
): WorkflowTaskRun {
  return {
    id: row.id as string,
    workflowRunId: row.workflow_run_id as string,
    stageRunId: row.stage_run_id as string,
    taskId: row.task_id as string,
    name: row.name as string,
    kind: row.kind as WorkflowTaskRun['kind'],
    status: row.status as WorkflowTaskRun['status'],
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

/** Variant of rowToWorkflowTaskRun that uses a pre-fetched dependencies map to avoid N+1 queries. */
function rowToWorkflowTaskRunWithDeps(
  row: Record<string, unknown>,
  depsMap: Map<string, string[]>,
): WorkflowTaskRun {
  return {
    id: row.id as string,
    workflowRunId: row.workflow_run_id as string,
    stageRunId: row.stage_run_id as string,
    taskId: row.task_id as string,
    name: row.name as string,
    kind: row.kind as WorkflowTaskRun['kind'],
    status: row.status as WorkflowTaskRun['status'],
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

function rowToWorkflowArtifact(row: Record<string, unknown>): WorkflowArtifact {
  return {
    id: row.id as string,
    workflowRunId: row.workflow_run_id as string,
    taskRunId: row.task_run_id as string,
    artifactType: row.artifact_type as string,
    entityType: row.entity_type == null ? undefined : String(row.entity_type),
    entityId: row.entity_id == null ? undefined : String(row.entity_id),
    assetHash: row.asset_hash == null ? undefined : String(row.asset_hash),
    path: row.path == null ? undefined : String(row.path),
    metadata: JSON.parse((row.metadata_json as string) || '{}'),
    createdAt: row.created_at as number,
  };
}

function toWorkflowArtifactSummary(artifact: WorkflowArtifact): WorkflowArtifactSummary {
  return {
    id: artifact.id,
    artifactType: artifact.artifactType,
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

function rowToWorkflowTaskSummary(
  row: Record<string, unknown>,
  artifactsMap: Map<string, WorkflowArtifact[]>,
): WorkflowTaskSummary {
  const taskInput = parseJsonRecord(row.input_json);
  const taskOutput = parseJsonRecord(row.output_json);
  const workflowMetadata = parseJsonRecord(row.workflow_metadata_json);
  const taskMetadata = getProjectionSources(taskInput, taskOutput);
  const workflowSources = getProjectionSources(workflowMetadata);
  const producedArtifacts = (artifactsMap.get(row.id as string) ?? []).map((artifact) =>
    toWorkflowArtifactSummary(artifact),
  );

  return {
    id: row.id as string,
    workflowRunId: row.workflow_run_id as string,
    stageRunId: row.stage_run_id as string,
    taskId: row.task_id as string,
    stageId: row.stage_id_value == null ? undefined : String(row.stage_id_value),
    name: row.name == null ? undefined : String(row.name),
    kind: row.kind as WorkflowTaskRun['kind'],
    status: row.status as WorkflowTaskRun['status'],
    progress: Number(row.progress ?? 0),
    currentStep: row.current_step == null ? undefined : String(row.current_step),
    displayCategory:
      pickProjectionString(taskMetadata, ['displayCategory', 'category']) ??
      pickProjectionString(workflowSources, ['displayCategory', 'category']) ??
      String(row.kind),
    displayLabel:
      pickProjectionString(taskMetadata, ['displayLabel', 'label', 'name']) ?? (row.name as string),
    relatedEntityType:
      pickProjectionString(taskMetadata, ['relatedEntityType']) ??
      (row.workflow_entity_type == null ? undefined : String(row.workflow_entity_type)),
    relatedEntityId:
      pickProjectionString(taskMetadata, ['relatedEntityId']) ??
      (row.workflow_entity_id == null ? undefined : String(row.workflow_entity_id)),
    relatedEntityLabel:
      pickProjectionString(taskMetadata, ['relatedEntityLabel']) ??
      pickProjectionString(workflowSources, ['relatedEntityLabel']),
    provider:
      row.provider == null
        ? (pickProjectionString(taskMetadata, ['provider']) ??
          pickProjectionString(workflowSources, ['provider']))
        : String(row.provider),
    modelKey:
      pickProjectionString(taskMetadata, ['modelKey']) ??
      pickProjectionString(workflowSources, ['modelKey']),
    promptTemplateId:
      pickProjectionString(taskMetadata, ['promptTemplateId']) ??
      pickProjectionString(workflowSources, ['promptTemplateId']),
    promptTemplateVersion:
      pickProjectionString(taskMetadata, ['promptTemplateVersion']) ??
      pickProjectionString(workflowSources, ['promptTemplateVersion']),
    summary:
      pickProjectionString(taskMetadata, ['summary', 'description']) ??
      pickProjectionString(workflowSources, ['summary']),
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
