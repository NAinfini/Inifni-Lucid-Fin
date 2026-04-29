/**
 * Pure type shapes for Batch 6 (workflow:*).
 *
 * No zod, no runtime. Complex workflow DTOs (`WorkflowActivitySummary`,
 * `WorkflowStageRun`, `WorkflowTaskSummary`) remain `unknown` — Phase C will
 * promote them once the DTOs themselves are contract-owned.
 *
 * Branded ids (`WorkflowRunId`, `StageRunId`, `TaskRunId`) are typed as
 * plain `string`; brand enforcement is compile-time only.
 */

// ── workflow:list (invoke) ───────────────────────────────────
export interface WorkflowListRequest {
  status?: string;
}
export type WorkflowListResponse = unknown[];

// ── workflow:get (invoke) ────────────────────────────────────
export interface WorkflowGetRequest {
  id: string;
}
export type WorkflowGetResponse = unknown;

// ── workflow:getStages (invoke) ──────────────────────────────
export interface WorkflowGetStagesRequest {
  workflowRunId: string;
}
export type WorkflowGetStagesResponse = unknown[];

// ── workflow:getTasks (invoke) ───────────────────────────────
export interface WorkflowGetTasksRequest {
  workflowRunId: string;
}
export type WorkflowGetTasksResponse = unknown[];

// ── workflow:start (invoke) ──────────────────────────────────
export interface WorkflowStartRequest {
  workflowType: string;
  entityType: string;
  entityId?: string;
  triggerSource?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}
export interface WorkflowStartResponse {
  workflowRunId: string;
}

// ── workflow:pause (invoke) ──────────────────────────────────
export interface WorkflowPauseRequest {
  id: string;
}
export type WorkflowPauseResponse = void;

// ── workflow:resume (invoke) ─────────────────────────────────
export interface WorkflowResumeRequest {
  id: string;
}
export type WorkflowResumeResponse = void;

// ── workflow:cancel (invoke) ─────────────────────────────────
export interface WorkflowCancelRequest {
  id: string;
}
export type WorkflowCancelResponse = void;

// ── workflow:retryTask (invoke) ──────────────────────────────
export interface WorkflowRetryTaskRequest {
  taskRunId: string;
}
export type WorkflowRetryTaskResponse = void;

// ── workflow:retryStage (invoke) ─────────────────────────────
export interface WorkflowRetryStageRequest {
  stageRunId: string;
}
export type WorkflowRetryStageResponse = void;

// ── workflow:retryWorkflow (invoke) ──────────────────────────
export interface WorkflowRetryWorkflowRequest {
  id: string;
}
export type WorkflowRetryWorkflowResponse = void;
