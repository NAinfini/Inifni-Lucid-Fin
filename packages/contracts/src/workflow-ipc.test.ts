import { describe, expectTypeOf, it } from 'vitest';
import type {
  WorkflowListResponse,
  WorkflowGetRequest,
  WorkflowGetResponse,
  WorkflowGetStagesRequest,
  WorkflowGetStagesResponse,
  WorkflowGetTasksRequest,
  WorkflowGetTasksResponse,
  WorkflowStartRequest,
  WorkflowStartResponse,
  WorkflowPauseRequest,
  WorkflowResumeRequest,
  WorkflowCancelRequest,
  WorkflowRetryTaskRequest,
  WorkflowRetryStageRequest,
  WorkflowRetryWorkflowRequest,
  ColorStyleExtractResponse,
} from '@lucid-fin/contracts-parse';
import type {
  WorkflowActivitySummary,
  WorkflowStageRun,
  WorkflowTaskSummary,
} from './dto/workflow.js';

describe('workflow ipc contract', () => {
  it('defines workflow channels with concrete shapes', () => {
    expectTypeOf<WorkflowListResponse>().toMatchTypeOf<WorkflowActivitySummary[]>();
    expectTypeOf<WorkflowGetRequest>().toMatchTypeOf<{ id: string }>();
    expectTypeOf<WorkflowGetResponse>().toMatchTypeOf<WorkflowActivitySummary>();
    expectTypeOf<WorkflowGetStagesRequest>().toMatchTypeOf<{
      workflowRunId: string;
    }>();
    expectTypeOf<WorkflowGetStagesResponse>().toMatchTypeOf<WorkflowStageRun[]>();
    expectTypeOf<WorkflowGetTasksRequest>().toMatchTypeOf<{
      workflowRunId: string;
    }>();
    expectTypeOf<WorkflowGetTasksResponse>().toMatchTypeOf<WorkflowTaskSummary[]>();
    expectTypeOf<WorkflowStartRequest>().toMatchTypeOf<{
      workflowType: string;
      entityType: string;
      entityId?: string;
      triggerSource?: string;
      input?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }>();
    expectTypeOf<WorkflowStartResponse>().toEqualTypeOf<{
      workflowRunId: string;
    }>();
    expectTypeOf<WorkflowPauseRequest>().toMatchTypeOf<{ id: string }>();
    expectTypeOf<WorkflowResumeRequest>().toMatchTypeOf<{ id: string }>();
    expectTypeOf<WorkflowCancelRequest>().toMatchTypeOf<{ id: string }>();
    expectTypeOf<WorkflowRetryTaskRequest>().toMatchTypeOf<{
      taskRunId: string;
    }>();
    expectTypeOf<WorkflowRetryStageRequest>().toMatchTypeOf<{
      stageRunId: string;
    }>();
    expectTypeOf<WorkflowRetryWorkflowRequest>().toMatchTypeOf<{
      id: string;
    }>();
  });

  it('returns workflow-backed color style extraction response', () => {
    expectTypeOf<ColorStyleExtractResponse>().toEqualTypeOf<{
      workflowRunId: string;
    }>();
  });
});
