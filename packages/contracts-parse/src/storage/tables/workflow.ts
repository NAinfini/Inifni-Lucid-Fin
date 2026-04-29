/**
 * Workflow-domain table constants.
 *
 * Covers the full runs → stages → tasks → artifacts graph. Dependency
 * join table is included so repositories can traverse DAG edges without
 * reaching for a string literal.
 */
import type {
  WorkflowRunId,
  WorkflowStageId,
  WorkflowTaskId,
  AssetHash,
} from '@lucid-fin/contracts';
import { defineTable, col } from '../../tables.js';

export const WorkflowRunsTable = defineTable('workflow_runs', {
  id: col<WorkflowRunId>('id'),
  workflowType: col<string>('workflow_type'),
  entityType: col<string>('entity_type'),
  entityId: col<string | null>('entity_id'),
  triggerSource: col<string>('trigger_source'),
  status: col<string>('status'),
  summary: col<string>('summary'),
  progress: col<number>('progress'),
  completedStages: col<number>('completed_stages'),
  totalStages: col<number>('total_stages'),
  completedTasks: col<number>('completed_tasks'),
  totalTasks: col<number>('total_tasks'),
  currentStageId: col<WorkflowStageId | null>('current_stage_id'),
  currentTaskId: col<WorkflowTaskId | null>('current_task_id'),
  inputJson: col<string>('input_json'),
  outputJson: col<string>('output_json'),
  errorText: col<string | null>('error_text'),
  metadataJson: col<string>('metadata_json'),
  createdAt: col<number>('created_at'),
  startedAt: col<number | null>('started_at'),
  completedAt: col<number | null>('completed_at'),
  updatedAt: col<number>('updated_at'),
});

export const WorkflowStageRunsTable = defineTable('workflow_stage_runs', {
  id: col<WorkflowStageId>('id'),
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  stageId: col<string>('stage_id'),
  name: col<string>('name'),
  status: col<string>('status'),
  stageOrder: col<number>('stage_order'),
  progress: col<number>('progress'),
  completedTasks: col<number>('completed_tasks'),
  totalTasks: col<number>('total_tasks'),
  errorText: col<string | null>('error_text'),
  metadataJson: col<string>('metadata_json'),
  startedAt: col<number | null>('started_at'),
  completedAt: col<number | null>('completed_at'),
  updatedAt: col<number>('updated_at'),
});

export const WorkflowTaskRunsTable = defineTable('workflow_task_runs', {
  id: col<WorkflowTaskId>('id'),
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  stageRunId: col<WorkflowStageId>('stage_run_id'),
  taskId: col<string>('task_id'),
  name: col<string>('name'),
  kind: col<string>('kind'),
  status: col<string>('status'),
  provider: col<string | null>('provider'),
  dependencyIdsJson: col<string>('dependency_ids_json'),
  attempts: col<number>('attempts'),
  maxRetries: col<number>('max_retries'),
  inputJson: col<string>('input_json'),
  outputJson: col<string>('output_json'),
  providerTaskId: col<string | null>('provider_task_id'),
  assetId: col<string | null>('asset_id'),
  errorText: col<string | null>('error_text'),
  progress: col<number>('progress'),
  currentStep: col<string | null>('current_step'),
  startedAt: col<number | null>('started_at'),
  completedAt: col<number | null>('completed_at'),
  updatedAt: col<number>('updated_at'),
});

export const WorkflowTaskDependenciesTable = defineTable('workflow_task_dependencies', {
  taskRunId: col<WorkflowTaskId>('task_run_id'),
  dependsOnTaskRunId: col<WorkflowTaskId>('depends_on_task_run_id'),
});

export const WorkflowArtifactsTable = defineTable('workflow_artifacts', {
  id: col<string>('id'),
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  taskRunId: col<WorkflowTaskId>('task_run_id'),
  artifactType: col<string>('artifact_type'),
  entityType: col<string | null>('entity_type'),
  entityId: col<string | null>('entity_id'),
  assetHash: col<AssetHash | null>('asset_hash'),
  path: col<string | null>('path'),
  metadataJson: col<string>('metadata_json'),
  createdAt: col<number>('created_at'),
});
