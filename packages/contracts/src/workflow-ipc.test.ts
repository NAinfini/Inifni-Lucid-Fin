import { describe, expectTypeOf, it } from 'vitest';
import type { IpcChannelMap } from './ipc.js';
import type {
  WorkflowActivitySummary,
  WorkflowStageRun,
  WorkflowTaskSummary,
} from './dto/workflow.js';

describe('workflow ipc contract', () => {
  it('defines workflow channels with concrete shapes', () => {
    expectTypeOf<IpcChannelMap['workflow:list']['response']>().toEqualTypeOf<
      WorkflowActivitySummary[]
    >();
    expectTypeOf<IpcChannelMap['workflow:get']['request']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<
      IpcChannelMap['workflow:get']['response']
    >().toEqualTypeOf<WorkflowActivitySummary>();
    expectTypeOf<IpcChannelMap['workflow:getStages']['request']>().toEqualTypeOf<{
      workflowRunId: string;
    }>();
    expectTypeOf<IpcChannelMap['workflow:getStages']['response']>().toEqualTypeOf<
      WorkflowStageRun[]
    >();
    expectTypeOf<IpcChannelMap['workflow:getTasks']['request']>().toEqualTypeOf<{
      workflowRunId: string;
    }>();
    expectTypeOf<IpcChannelMap['workflow:getTasks']['response']>().toEqualTypeOf<
      WorkflowTaskSummary[]
    >();
    expectTypeOf<IpcChannelMap['workflow:start']['request']>().toEqualTypeOf<{
      workflowType: string;
      entityType: string;
      entityId?: string;
      triggerSource?: string;
      input?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }>();
    expectTypeOf<IpcChannelMap['workflow:start']['response']>().toEqualTypeOf<{
      workflowRunId: string;
    }>();
    expectTypeOf<IpcChannelMap['workflow:pause']['request']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<IpcChannelMap['workflow:resume']['request']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<IpcChannelMap['workflow:cancel']['request']>().toEqualTypeOf<{ id: string }>();
    expectTypeOf<IpcChannelMap['workflow:retryTask']['request']>().toEqualTypeOf<{
      taskRunId: string;
    }>();
    expectTypeOf<IpcChannelMap['workflow:retryStage']['request']>().toEqualTypeOf<{
      stageRunId: string;
    }>();
    expectTypeOf<IpcChannelMap['workflow:retryWorkflow']['request']>().toEqualTypeOf<{
      id: string;
    }>();
  });

  it('returns workflow-backed color style extraction response', () => {
    expectTypeOf<IpcChannelMap['colorStyle:extract']['response']>().toEqualTypeOf<{
      workflowRunId: string;
    }>();
  });
});
