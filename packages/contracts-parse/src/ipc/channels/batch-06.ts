/**
 * workflow:* channels — Batch 6.
 *
 * Covers the 11 invoke handlers in
 * `apps/desktop-main/src/ipc/handlers/workflow.handlers.ts` plus the 3 push
 * channels the WorkflowEngine emits through the main process
 * (`workflow:updated`, `workflow:task-updated`, `workflow:stage-updated`).
 *
 * Complex workflow DTOs (`WorkflowActivitySummary`, `WorkflowStageRun`,
 * `WorkflowTaskSummary`) remain `z.unknown()` per Phase B-1 precedent — Phase C
 * will zodify them once the DTOs move into contract ownership.
 *
 * Branded ids (`WorkflowRunId`, `StageRunId`, `TaskRunId`) use plain
 * `z.string()`; brand enforcement is compile-time only.
 */
import { z } from 'zod';
import { defineInvokeChannel, definePushChannel } from '../../channels.js';

// ── Shared primitives ────────────────────────────────────────
// WorkflowActivitySummary / WorkflowStageRun / WorkflowTaskSummary stay opaque
// (`unknown`) at this stage — Phase C will zodify the DTOs.
const WorkflowSummaryShape = z.unknown();
const WorkflowStageShape = z.unknown();
const WorkflowTaskShape = z.unknown();

// ── workflow:list (invoke) ───────────────────────────────────
const WorkflowListRequest = z
  .object({ status: z.string().optional() })
  .strict();
const WorkflowListResponse = z.array(WorkflowSummaryShape);
export const workflowListChannel = defineInvokeChannel({
  channel: 'workflow:list',
  request: WorkflowListRequest,
  response: WorkflowListResponse,
});
export type WorkflowListRequest = z.infer<typeof WorkflowListRequest>;
export type WorkflowListResponse = z.infer<typeof WorkflowListResponse>;

// ── workflow:get (invoke) ────────────────────────────────────
const WorkflowGetRequest = z.object({ id: z.string().min(1) });
const WorkflowGetResponse = WorkflowSummaryShape;
export const workflowGetChannel = defineInvokeChannel({
  channel: 'workflow:get',
  request: WorkflowGetRequest,
  response: WorkflowGetResponse,
});
export type WorkflowGetRequest = z.infer<typeof WorkflowGetRequest>;
export type WorkflowGetResponse = z.infer<typeof WorkflowGetResponse>;

// ── workflow:getStages (invoke) ──────────────────────────────
const WorkflowGetStagesRequest = z.object({ workflowRunId: z.string().min(1) });
const WorkflowGetStagesResponse = z.array(WorkflowStageShape);
export const workflowGetStagesChannel = defineInvokeChannel({
  channel: 'workflow:getStages',
  request: WorkflowGetStagesRequest,
  response: WorkflowGetStagesResponse,
});
export type WorkflowGetStagesRequest = z.infer<typeof WorkflowGetStagesRequest>;
export type WorkflowGetStagesResponse = z.infer<typeof WorkflowGetStagesResponse>;

// ── workflow:getTasks (invoke) ───────────────────────────────
const WorkflowGetTasksRequest = z.object({ workflowRunId: z.string().min(1) });
const WorkflowGetTasksResponse = z.array(WorkflowTaskShape);
export const workflowGetTasksChannel = defineInvokeChannel({
  channel: 'workflow:getTasks',
  request: WorkflowGetTasksRequest,
  response: WorkflowGetTasksResponse,
});
export type WorkflowGetTasksRequest = z.infer<typeof WorkflowGetTasksRequest>;
export type WorkflowGetTasksResponse = z.infer<typeof WorkflowGetTasksResponse>;

// ── workflow:start (invoke) ──────────────────────────────────
const WorkflowStartRequest = z
  .object({
    workflowType: z.string().min(1),
    entityType: z.string().min(1),
    entityId: z.string().optional(),
    triggerSource: z.string().optional(),
    input: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const WorkflowStartResponse = z.object({ workflowRunId: z.string() });
export const workflowStartChannel = defineInvokeChannel({
  channel: 'workflow:start',
  request: WorkflowStartRequest,
  response: WorkflowStartResponse,
});
export type WorkflowStartRequest = z.infer<typeof WorkflowStartRequest>;
export type WorkflowStartResponse = z.infer<typeof WorkflowStartResponse>;

// ── workflow:pause (invoke) ──────────────────────────────────
const WorkflowPauseRequest = z.object({ id: z.string().min(1) });
const WorkflowPauseResponse = z.void();
export const workflowPauseChannel = defineInvokeChannel({
  channel: 'workflow:pause',
  request: WorkflowPauseRequest,
  response: WorkflowPauseResponse,
});
export type WorkflowPauseRequest = z.infer<typeof WorkflowPauseRequest>;
export type WorkflowPauseResponse = z.infer<typeof WorkflowPauseResponse>;

// ── workflow:resume (invoke) ─────────────────────────────────
const WorkflowResumeRequest = z.object({ id: z.string().min(1) });
const WorkflowResumeResponse = z.void();
export const workflowResumeChannel = defineInvokeChannel({
  channel: 'workflow:resume',
  request: WorkflowResumeRequest,
  response: WorkflowResumeResponse,
});
export type WorkflowResumeRequest = z.infer<typeof WorkflowResumeRequest>;
export type WorkflowResumeResponse = z.infer<typeof WorkflowResumeResponse>;

// ── workflow:cancel (invoke) ─────────────────────────────────
const WorkflowCancelRequest = z.object({ id: z.string().min(1) });
const WorkflowCancelResponse = z.void();
export const workflowCancelChannel = defineInvokeChannel({
  channel: 'workflow:cancel',
  request: WorkflowCancelRequest,
  response: WorkflowCancelResponse,
});
export type WorkflowCancelRequest = z.infer<typeof WorkflowCancelRequest>;
export type WorkflowCancelResponse = z.infer<typeof WorkflowCancelResponse>;

// ── workflow:retryTask (invoke) ──────────────────────────────
const WorkflowRetryTaskRequest = z.object({ taskRunId: z.string().min(1) });
const WorkflowRetryTaskResponse = z.void();
export const workflowRetryTaskChannel = defineInvokeChannel({
  channel: 'workflow:retryTask',
  request: WorkflowRetryTaskRequest,
  response: WorkflowRetryTaskResponse,
});
export type WorkflowRetryTaskRequest = z.infer<typeof WorkflowRetryTaskRequest>;
export type WorkflowRetryTaskResponse = z.infer<typeof WorkflowRetryTaskResponse>;

// ── workflow:retryStage (invoke) ─────────────────────────────
const WorkflowRetryStageRequest = z.object({ stageRunId: z.string().min(1) });
const WorkflowRetryStageResponse = z.void();
export const workflowRetryStageChannel = defineInvokeChannel({
  channel: 'workflow:retryStage',
  request: WorkflowRetryStageRequest,
  response: WorkflowRetryStageResponse,
});
export type WorkflowRetryStageRequest = z.infer<typeof WorkflowRetryStageRequest>;
export type WorkflowRetryStageResponse = z.infer<typeof WorkflowRetryStageResponse>;

// ── workflow:retryWorkflow (invoke) ──────────────────────────
const WorkflowRetryWorkflowRequest = z.object({ id: z.string().min(1) });
const WorkflowRetryWorkflowResponse = z.void();
export const workflowRetryWorkflowChannel = defineInvokeChannel({
  channel: 'workflow:retryWorkflow',
  request: WorkflowRetryWorkflowRequest,
  response: WorkflowRetryWorkflowResponse,
});
export type WorkflowRetryWorkflowRequest = z.infer<typeof WorkflowRetryWorkflowRequest>;
export type WorkflowRetryWorkflowResponse = z.infer<typeof WorkflowRetryWorkflowResponse>;

// ── workflow:updated (push) ──────────────────────────────────
// Payload mirrors `WorkflowUpdatedEvent` ({ workflow: WorkflowActivitySummary }).
// The inner summary stays opaque at this stage.
const WorkflowUpdatedPayload = z.object({ workflow: WorkflowSummaryShape });
export const workflowUpdatedChannel = definePushChannel({
  channel: 'workflow:updated',
  payload: WorkflowUpdatedPayload,
});
export type WorkflowUpdatedPayload = z.infer<typeof WorkflowUpdatedPayload>;

// ── workflow:task-updated (push) ─────────────────────────────
// Payload mirrors `WorkflowTaskUpdatedEvent` ({ task: WorkflowTaskSummary }).
const WorkflowTaskUpdatedPayload = z.object({ task: WorkflowTaskShape });
export const workflowTaskUpdatedChannel = definePushChannel({
  channel: 'workflow:task-updated',
  payload: WorkflowTaskUpdatedPayload,
});
export type WorkflowTaskUpdatedPayload = z.infer<typeof WorkflowTaskUpdatedPayload>;

// ── workflow:stage-updated (push) ────────────────────────────
// Payload mirrors `WorkflowStageUpdatedEvent` ({ workflowRunId, stageId }).
const WorkflowStageUpdatedPayload = z.object({
  workflowRunId: z.string(),
  stageId: z.string(),
});
export const workflowStageUpdatedChannel = definePushChannel({
  channel: 'workflow:stage-updated',
  payload: WorkflowStageUpdatedPayload,
});
export type WorkflowStageUpdatedPayload = z.infer<typeof WorkflowStageUpdatedPayload>;

export const workflowChannels = [
  workflowListChannel,
  workflowGetChannel,
  workflowGetStagesChannel,
  workflowGetTasksChannel,
  workflowStartChannel,
  workflowPauseChannel,
  workflowResumeChannel,
  workflowCancelChannel,
  workflowRetryTaskChannel,
  workflowRetryStageChannel,
  workflowRetryWorkflowChannel,
  workflowUpdatedChannel,
  workflowTaskUpdatedChannel,
  workflowStageUpdatedChannel,
] as const;
