import type {
  WorkflowRun,
  WorkflowStageRun,
  WorkflowTaskRun,
  WorkflowArtifact,
  WorkflowArtifactSummary,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';
import type BetterSqlite3 from 'better-sqlite3';
import {
  getWorkflowRun,
  listWorkflowStageRuns,
  listWorkflowTaskRuns,
  updateWorkflowRun,
  updateWorkflowStageRun,
  listWorkflowArtifactsByTaskRun,
} from './sqlite-workflows.js';

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
