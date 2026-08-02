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
  rowVersion: col<number>('row_version'),
  currentGate: col<string | null>('current_gate'),
  engineVersion: col<string>('engine_version'),
  definitionVersion: col<number>('definition_version'),
});

export const WorkflowDocumentsTable = defineTable('workflow_documents', {
  id: col<string>('id'),
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  logicalKey: col<string>('logical_key'),
  documentType: col<string>('document_type'),
  revision: col<number>('revision'),
  schemaVersion: col<number>('schema_version'),
  contentJson: col<string>('content_json'),
  contentHash: col<string>('content_hash'),
  status: col<string>('status'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
});

export const WorkflowApprovalsTable = defineTable('workflow_approvals', {
  id: col<string>('id'),
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  gateKey: col<string>('gate_key'),
  subjectLogicalKey: col<string>('subject_logical_key'),
  subjectRevision: col<number>('subject_revision'),
  subjectHash: col<string>('subject_hash'),
  manifestHash: col<string>('manifest_hash'),
  resumeTokenHash: col<string>('resume_token_hash'),
  status: col<string>('status'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
  decidedAt: col<number | null>('decided_at'),
});

export const WorkflowEventsTable = defineTable('workflow_events', {
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  seq: col<number>('seq'),
  eventId: col<string>('event_id'),
  actor: col<string>('actor'),
  correlationId: col<string | null>('correlation_id'),
  causationId: col<string | null>('causation_id'),
  payloadJson: col<string>('payload_json'),
  eventTimestamp: col<number>('event_timestamp'),
});

export const WorkflowExportExecutionsTable = defineTable('workflow_export_executions', {
  id: col<string>('id'),
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  manifestRevision: col<number>('manifest_revision'),
  manifestHash: col<string>('manifest_hash'),
  idempotencyKey: col<string>('idempotency_key'),
  status: col<string>('status'),
  rowVersion: col<number>('row_version'),
  stagingPath: col<string | null>('staging_path'),
  destinationPath: col<string>('destination_path'),
  outputAssetHash: col<AssetHash | null>('output_asset_hash'),
  outputHash: col<string | null>('output_hash'),
  outputSize: col<number | null>('output_size'),
  attempt: col<number>('attempt'),
  errorText: col<string | null>('error_text'),
  createdAt: col<number>('created_at'),
  updatedAt: col<number>('updated_at'),
  completedAt: col<number | null>('completed_at'),
});

export const WorkflowMediaAttemptsTable = defineTable('workflow_media_attempts', {
  id: col<string>('id'),
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  canvasId: col<string>('canvas_id'),
  nodeId: col<string>('node_id'),
  attempt: col<number>('attempt'),
  idempotencyKey: col<string>('idempotency_key'),
  specHash: col<string>('spec_hash'),
  generationSpecJson: col<string>('generation_spec_json'),
  repairDeltaJson: col<string | null>('repair_delta_json'),
  mediaType: col<string>('media_type'),
  status: col<string>('status'),
  rowVersion: col<number>('row_version'),
  providerId: col<string>('provider_id'),
  model: col<string | null>('model'),
  prompt: col<string>('prompt'),
  promptHash: col<string>('prompt_hash'),
  negativePrompt: col<string | null>('negative_prompt'),
  seed: col<number | null>('seed'),
  estimatedCostUsd: col<number>('estimated_cost_usd'),
  reportedActualCostUsd: col<number | null>('reported_actual_cost_usd'),
  providerJobId: col<string | null>('provider_job_id'),
  assetHash: col<AssetHash | null>('asset_hash'),
  errorText: col<string | null>('error_text'),
  createdAt: col<number>('created_at'),
  submittedAt: col<number | null>('submitted_at'),
  assetReadyAt: col<number | null>('asset_ready_at'),
  evaluatedAt: col<number | null>('evaluated_at'),
  completedAt: col<number | null>('completed_at'),
  updatedAt: col<number>('updated_at'),
});

export const WorkflowMediaEvaluationsTable = defineTable('workflow_media_evaluations', {
  id: col<string>('id'),
  attemptId: col<string>('attempt_id'),
  workflowRunId: col<WorkflowRunId>('workflow_run_id'),
  canvasId: col<string>('canvas_id'),
  nodeId: col<string>('node_id'),
  assetHash: col<AssetHash>('asset_hash'),
  mediaType: col<string>('media_type'),
  rubricVersion: col<string>('rubric_version'),
  evaluatorProviderId: col<string>('evaluator_provider_id'),
  evaluatorModel: col<string | null>('evaluator_model'),
  scoresJson: col<string>('scores_json'),
  total: col<number>('total'),
  verdict: col<string>('verdict'),
  strengthsJson: col<string>('strengths_json'),
  risksJson: col<string>('risks_json'),
  evidenceJson: col<string>('evidence_json'),
  repairDeltaJson: col<string | null>('repair_delta_json'),
  metadataJson: col<string>('metadata_json'),
  frameEvidenceJson: col<string>('frame_evidence_json'),
  createdAt: col<number>('created_at'),
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
