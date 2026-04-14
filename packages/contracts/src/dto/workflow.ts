export const WorkflowRunStatus = {
  Pending: 'pending',
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
}

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
