import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type {
  WorkflowActivitySummary,
  WorkflowArtifactSummary,
  WorkflowStageRun,
  WorkflowTaskSummary,
} from '@lucid-fin/contracts';

type WorkflowStartRequest = {
  workflowType: string;
  entityType: string;
  entityId?: string;
  triggerSource?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

type WorkflowSummaryLike = Partial<WorkflowActivitySummary> & {
  id: string;
  workflowType: string;
  entityType: string;
  triggerSource: string;
  status: WorkflowActivitySummary['status'];
  summary: string;
  progress: number;
  completedStages: number;
  totalStages: number;
  completedTasks: number;
  totalTasks: number;
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
  output?: Record<string, unknown>;
  placeholder?: boolean;
};

type WorkflowTaskLike = Partial<WorkflowTaskSummary> & {
  id: string;
  workflowRunId: string;
  stageRunId: string;
  taskId: string;
  kind: WorkflowTaskSummary['kind'];
  status: WorkflowTaskSummary['status'];
  updatedAt: number;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  name?: string;
};

export interface WorkflowSummaryRecord extends WorkflowActivitySummary {
  metadata?: Record<string, unknown>;
  output?: Record<string, unknown>;
  placeholder?: boolean;
}

export interface WorkflowsState {
  summariesById: Record<string, WorkflowSummaryRecord>;
  allIds: string[];
  stagesByWorkflowId: Record<string, WorkflowStageRun[]>;
  tasksByWorkflowId: Record<string, WorkflowTaskSummary[]>;
}

type StartWorkflowPayload = {
  placeholderId: string;
  createdAt: number;
  request: WorkflowStartRequest;
};

function createPlaceholderId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `workflow-placeholder-${crypto.randomUUID()}`
    : `workflow-placeholder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(record: Record<string, unknown>, key: string, fallback = 0): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function artifactSummaries(value: unknown): WorkflowArtifactSummary[] | undefined {
  return Array.isArray(value) ? (value as WorkflowArtifactSummary[]) : undefined;
}

function normalizeWorkflowSummary(workflow: WorkflowSummaryLike): WorkflowSummaryRecord {
  const metadata = asRecord(workflow.metadata);

  return {
    id: workflow.id,
    workflowType: workflow.workflowType,
    entityType: workflow.entityType,
    entityId: workflow.entityId,
    triggerSource: workflow.triggerSource,
    status: workflow.status,
    summary: workflow.summary,
    progress: workflow.progress,
    completedStages: workflow.completedStages,
    totalStages: workflow.totalStages,
    completedTasks: workflow.completedTasks,
    totalTasks: workflow.totalTasks,
    currentStageId: workflow.currentStageId,
    currentTaskId: workflow.currentTaskId,
    displayCategory:
      workflow.displayCategory ?? readString(metadata, 'displayCategory') ?? workflow.workflowType,
    displayLabel:
      workflow.displayLabel ?? readString(metadata, 'displayLabel') ?? workflow.workflowType,
    relatedEntityLabel:
      workflow.relatedEntityLabel ??
      readString(metadata, 'relatedEntityLabel') ??
      workflow.entityId,
    provider: workflow.provider ?? readString(metadata, 'provider'),
    modelKey: workflow.modelKey ?? readString(metadata, 'modelKey'),
    promptTemplateId: workflow.promptTemplateId ?? readString(metadata, 'promptTemplateId'),
    promptTemplateVersion:
      workflow.promptTemplateVersion ?? readString(metadata, 'promptTemplateVersion'),
    createdAt: workflow.createdAt,
    startedAt: workflow.startedAt,
    completedAt: workflow.completedAt,
    updatedAt: workflow.updatedAt,
    producedArtifacts: workflow.producedArtifacts ?? artifactSummaries(metadata.producedArtifacts),
    metadata,
    output: asRecord(workflow.output),
    placeholder: workflow.placeholder ?? false,
  };
}

function normalizeWorkflowTask(task: WorkflowTaskLike): WorkflowTaskSummary {
  const input = asRecord(task.input);
  const output = asRecord(task.output);

  return {
    id: task.id,
    workflowRunId: task.workflowRunId,
    stageRunId: task.stageRunId,
    taskId: task.taskId,
    stageId: task.stageId ?? readString(input, 'stageId'),
    name: task.name ?? readString(input, 'name'),
    kind: task.kind,
    status: task.status,
    progress: task.progress ?? readNumber(output, 'progress', 0),
    currentStep: task.currentStep,
    displayCategory:
      task.displayCategory ?? readString(input, 'displayCategory') ?? String(task.kind),
    displayLabel:
      task.displayLabel ?? readString(input, 'displayLabel') ?? task.name ?? task.taskId,
    relatedEntityType: task.relatedEntityType ?? readString(input, 'relatedEntityType'),
    relatedEntityId: task.relatedEntityId ?? readString(input, 'relatedEntityId'),
    relatedEntityLabel: task.relatedEntityLabel ?? readString(input, 'relatedEntityLabel'),
    provider: task.provider ?? readString(input, 'provider'),
    modelKey: task.modelKey ?? readString(input, 'modelKey'),
    promptTemplateId: task.promptTemplateId ?? readString(input, 'promptTemplateId'),
    promptTemplateVersion: task.promptTemplateVersion ?? readString(input, 'promptTemplateVersion'),
    summary: task.summary ?? readString(input, 'summary'),
    error: task.error,
    attempts: task.attempts,
    maxRetries: task.maxRetries,
    assetId: task.assetId,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    updatedAt: task.updatedAt,
    producedArtifacts: task.producedArtifacts,
  };
}

function sortIdsByUpdatedAt(state: WorkflowsState): void {
  state.allIds = Object.values(state.summariesById)
    .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
    .map((workflow) => workflow.id);
}

export const workflowsSlice = createSlice({
  name: 'workflows',
  initialState: {
    summariesById: {},
    allIds: [],
    stagesByWorkflowId: {},
    tasksByWorkflowId: {},
  } as WorkflowsState,
  reducers: {
    setWorkflowSummaries(state, action: PayloadAction<WorkflowSummaryLike[]>) {
      for (const workflow of action.payload) {
        const normalized = normalizeWorkflowSummary(workflow);
        state.summariesById[normalized.id] = normalized;
      }
      sortIdsByUpdatedAt(state);
    },
    upsertWorkflowSummary(state, action: PayloadAction<WorkflowSummaryLike>) {
      const normalized = normalizeWorkflowSummary(action.payload);
      state.summariesById[normalized.id] = normalized;
      sortIdsByUpdatedAt(state);
    },
    setWorkflowStages(
      state,
      action: PayloadAction<{ workflowRunId: string; stages: WorkflowStageRun[] }>,
    ) {
      state.stagesByWorkflowId[action.payload.workflowRunId] = action.payload.stages;
    },
    setWorkflowTasks(
      state,
      action: PayloadAction<{ workflowRunId: string; tasks: WorkflowTaskLike[] }>,
    ) {
      state.tasksByWorkflowId[action.payload.workflowRunId] =
        action.payload.tasks.map(normalizeWorkflowTask);
    },
    startWorkflow: {
      prepare(request: WorkflowStartRequest) {
        return {
          payload: {
            placeholderId: createPlaceholderId(),
            createdAt: Date.now(),
            request,
          } satisfies StartWorkflowPayload,
        };
      },
      reducer(state, action: PayloadAction<StartWorkflowPayload>) {
        const metadata = asRecord(action.payload.request.metadata);
        state.summariesById[action.payload.placeholderId] = {
          id: action.payload.placeholderId,
          workflowType: action.payload.request.workflowType,
          entityType: action.payload.request.entityType,
          entityId: action.payload.request.entityId,
          triggerSource: action.payload.request.triggerSource ?? 'user',
          status: 'pending',
          summary: 'Starting workflow',
          progress: 0,
          completedStages: 0,
          totalStages: 0,
          completedTasks: 0,
          totalTasks: 0,
          currentStageId: undefined,
          currentTaskId: undefined,
          displayCategory:
            readString(metadata, 'displayCategory') ?? action.payload.request.workflowType,
          displayLabel: readString(metadata, 'displayLabel') ?? action.payload.request.workflowType,
          relatedEntityLabel:
            readString(metadata, 'relatedEntityLabel') ?? action.payload.request.entityId,
          provider: readString(metadata, 'provider'),
          modelKey: readString(metadata, 'modelKey'),
          promptTemplateId: readString(metadata, 'promptTemplateId'),
          promptTemplateVersion: readString(metadata, 'promptTemplateVersion'),
          createdAt: action.payload.createdAt,
          updatedAt: action.payload.createdAt,
          placeholder: true,
          metadata,
          output: {},
        };
        sortIdsByUpdatedAt(state);
      },
    },
    workflowStarted(
      state,
      action: PayloadAction<{ placeholderId: string; workflowRunId: string }>,
    ) {
      const placeholder = state.summariesById[action.payload.placeholderId];
      if (!placeholder) {
        return;
      }

      delete state.summariesById[action.payload.placeholderId];
      state.summariesById[action.payload.workflowRunId] = {
        ...placeholder,
        id: action.payload.workflowRunId,
        status: 'ready',
        placeholder: false,
        updatedAt: Date.now(),
      };
      sortIdsByUpdatedAt(state);
    },
    removeWorkflowPlaceholder(state, action: PayloadAction<string>) {
      delete state.summariesById[action.payload];
      sortIdsByUpdatedAt(state);
    },
    loadWorkflows(_state, _action: PayloadAction<Record<string, unknown> | undefined>) {},
    loadWorkflowStages(_state, _action: PayloadAction<string>) {},
    loadWorkflowTasks(_state, _action: PayloadAction<string>) {},
    pauseWorkflow(state, action: PayloadAction<string>) {
      const workflow = state.summariesById[action.payload];
      if (workflow) {
        workflow.status = 'paused';
        workflow.updatedAt = Date.now();
      }
    },
    resumeWorkflow(state, action: PayloadAction<string>) {
      const workflow = state.summariesById[action.payload];
      if (workflow) {
        workflow.status = 'ready';
        workflow.updatedAt = Date.now();
      }
    },
    cancelWorkflow(state, action: PayloadAction<string>) {
      const workflow = state.summariesById[action.payload];
      if (workflow) {
        workflow.status = 'cancelled';
        workflow.updatedAt = Date.now();
      }
    },
    retryWorkflowTask(_state, _action: PayloadAction<string>) {},
    retryWorkflowStage(_state, _action: PayloadAction<string>) {},
    retryWorkflow(_state, _action: PayloadAction<string>) {},
  },
});

export const {
  setWorkflowSummaries,
  upsertWorkflowSummary,
  setWorkflowStages,
  setWorkflowTasks,
  startWorkflow,
  workflowStarted,
  removeWorkflowPlaceholder,
  loadWorkflows,
  loadWorkflowStages,
  loadWorkflowTasks,
  pauseWorkflow,
  resumeWorkflow,
  cancelWorkflow,
  retryWorkflowTask,
  retryWorkflowStage,
  retryWorkflow,
} = workflowsSlice.actions;
