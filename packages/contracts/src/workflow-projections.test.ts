import { describe, expectTypeOf, it } from 'vitest';
import type {
  WorkflowActivitySummary,
  WorkflowTaskSummary,
  WorkflowUpdatedEvent,
  WorkflowTaskUpdatedEvent,
  WorkflowStageUpdatedEvent,
} from './dto/workflow.js';
import type { IpcChannelMap } from './ipc.js';

describe('workflow projection contracts', () => {
  it('defines workflow activity summaries for renderer-facing execution views', () => {
    expectTypeOf<WorkflowActivitySummary>().toMatchTypeOf<{
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
    }>();
  });

  it('defines workflow task summaries for task center and workflow details', () => {
    expectTypeOf<WorkflowTaskSummary>().toMatchTypeOf<{
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
    }>();
  });

  it('defines typed workflow event payloads for preload subscriptions', () => {
    expectTypeOf<WorkflowUpdatedEvent>().toMatchTypeOf<{ workflow: WorkflowActivitySummary }>();
    expectTypeOf<WorkflowTaskUpdatedEvent>().toMatchTypeOf<{ task: WorkflowTaskSummary }>();
    expectTypeOf<WorkflowStageUpdatedEvent>().toMatchTypeOf<{
      workflowRunId: string;
      stageId: string;
    }>();
  });

  it('uses projection types in renderer-facing workflow ipc responses', () => {
    expectTypeOf<IpcChannelMap['workflow:list']['response']>().toEqualTypeOf<
      WorkflowActivitySummary[]
    >();
    expectTypeOf<
      IpcChannelMap['workflow:get']['response']
    >().toEqualTypeOf<WorkflowActivitySummary>();
    expectTypeOf<IpcChannelMap['workflow:getTasks']['response']>().toEqualTypeOf<
      WorkflowTaskSummary[]
    >();
  });
});
