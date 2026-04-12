import type {
  WorkflowRun,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
  WorkflowArtifactSummary,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';

// --- Workflow Runs ---

export function insertWorkflowRun(db: BetterSqlite3.Database, run: WorkflowRun): void {
  db.prepare(
    `
    INSERT INTO workflow_runs (
      id, workflow_type, project_id, entity_type, entity_id, trigger_source,
      status, summary, progress, completed_stages, total_stages,
      completed_tasks, total_tasks, current_stage_id, current_task_id,
      input_json, output_json, error_text, metadata_json,
      created_at, started_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  ).run(
    run.id,
    run.workflowType,
    run.projectId,
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
  );
}

export function getWorkflowRun(db: BetterSqlite3.Database, id: string): WorkflowRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  return rowToWorkflowRun(row);
}

export function listWorkflowRuns(
  db: BetterSqlite3.Database,
  filter?: {
    projectId?: string;
    status?: string;
    workflowType?: string;
    entityType?: string;
  },
): WorkflowRun[] {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filter?.projectId) {
    conditions.push('project_id = ?');
    params.push(filter.projectId);
  }
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
    .prepare(
      'SELECT * FROM workflow_stage_runs WHERE workflow_run_id = ? ORDER BY stage_order ASC',
    )
    .all(workflowRunId) as Array<Record<string, unknown>>;
  return rows.map((row) => rowToWorkflowStageRun(row));
}

export function getWorkflowStageRun(
  db: BetterSqlite3.Database,
  id: string,
): WorkflowStageRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_stage_runs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
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

export function insertWorkflowTaskRun(
  db: BetterSqlite3.Database,
  taskRun: WorkflowTaskRun,
): void {
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
  return rows.map((row) => rowToWorkflowTaskRun(db, row));
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
  return rows.map((row) => rowToWorkflowTaskRun(db, row));
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
  return rows.map((row) => rowToWorkflowTaskRun(db, row));
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
  return rows.map((row) => rowToWorkflowTaskRun(db, row));
}

export function getWorkflowTaskRun(
  db: BetterSqlite3.Database,
  id: string,
): WorkflowTaskRun | undefined {
  const row = db.prepare('SELECT * FROM workflow_task_runs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
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

// --- Task Summaries ---

export function listWorkflowTaskSummaries(
  db: BetterSqlite3.Database,
  filter?: {
    projectId?: string;
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

  if (filter?.projectId) {
    conditions.push('w.project_id = ?');
    params.push(filter.projectId);
  }
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

  return rows.map((row) => rowToWorkflowTaskSummary(db, row));
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
  const workflow = getWorkflowRun(db, workflowRunId);
  if (!workflow) {
    return;
  }

  const stages = listWorkflowStageRuns(db, workflowRunId);
  const tasks = listWorkflowTaskRuns(db, workflowRunId);

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
            task.status !== 'completed' &&
            task.status !== 'skipped' &&
            task.status !== 'cancelled',
        ));

  const summary = `${status} ${completedStages}/${totalStages} stages, ${completedTasks}/${totalTasks} tasks`;
  const updatedAt = Math.max(
    workflow.updatedAt,
    ...stages.map((stage) => stage.updatedAt),
    ...tasks.map((task) => task.updatedAt),
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
    projectId: row.project_id as string,
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
  } catch { /* malformed JSON column value — return empty record */
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
  db: BetterSqlite3.Database,
  row: Record<string, unknown>,
): WorkflowTaskSummary {
  const taskInput = parseJsonRecord(row.input_json);
  const taskOutput = parseJsonRecord(row.output_json);
  const workflowMetadata = parseJsonRecord(row.workflow_metadata_json);
  const taskMetadata = getProjectionSources(taskInput, taskOutput);
  const workflowSources = getProjectionSources(workflowMetadata);
  const producedArtifacts = listWorkflowArtifactsByTaskRun(db, row.id as string).map(
    (artifact) => toWorkflowArtifactSummary(artifact),
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
      pickProjectionString(taskMetadata, ['displayLabel', 'label', 'name']) ??
      (row.name as string),
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
