import type {
  WorkflowActivitySummary,
  WorkflowStageUpdatedEvent,
  WorkflowTaskSummary,
  WorkflowTaskUpdatedEvent,
  WorkflowUpdatedEvent,
} from './dto/workflow.js';

type Assert<T extends true> = T;

type Extends<A, B> = A extends B ? true : false;

type _WorkflowActivitySummaryShape = Assert<
  Extends<
    WorkflowActivitySummary,
    {
      id: string;
      workflowType: string;
      entityType: string;
      entityId?: string;
      status: string;
      summary: string;
      progress: number;
      displayCategory: string;
      displayLabel: string;
      relatedEntityLabel?: string;
      provider?: string;
      modelKey?: string;
      updatedAt: number;
    }
  >
>;

type _WorkflowTaskSummaryShape = Assert<
  Extends<
    WorkflowTaskSummary,
    {
      id: string;
      workflowRunId: string;
      stageRunId: string;
      taskId: string;
      kind: string;
      status: string;
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
      updatedAt: number;
    }
  >
>;

type _WorkflowUpdatedEventShape = Assert<
  Extends<WorkflowUpdatedEvent, { workflow: WorkflowActivitySummary }>
>;

type _WorkflowTaskUpdatedEventShape = Assert<
  Extends<WorkflowTaskUpdatedEvent, { task: WorkflowTaskSummary }>
>;

type _WorkflowStageUpdatedEventShape = Assert<
  Extends<WorkflowStageUpdatedEvent, { workflowRunId: string; stageId: string }>
>;

export {};
