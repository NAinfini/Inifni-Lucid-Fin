/** Pure type shapes for the renderer-visible Task List IPC surface. */

import type {
  ApprovePlanGateResult,
  DeliveryManifestContext,
  PlanApprovalContext,
  PlanApprovalGateKey,
  RequestVisualAuditionChangesInput,
  RequestVisualAuditionChangesResult,
  RevisePlanGateResult,
  SelectVisualConstitutionCandidateInput,
  TaskDecision,
  TaskListSummary,
  TaskSummary,
  VisualAuditionContext,
  VisualConstitutionSelectionResult,
  TaskListStatus,
} from '../../dto/task-execution.js';
import type { PromptAssemblyRecord } from '../../dto/prompt-assembly.js';

export interface TaskListListRequest {
  status?: string;
  taskListType?: string;
  entityType?: string;
}
export type TaskListListResponse = TaskListSummary[];

export interface TaskListGetRequest {
  id: string;
}
export type TaskListGetResponse = TaskListSummary;

export interface TaskListGetTasksRequest {
  taskListId: string;
}
export type TaskListGetTasksResponse = TaskSummary[];

export interface TaskListStartMediaRequest {
  canvasId: string;
  nodeId: string;
  commanderSessionId: string;
  providerId?: string;
  seed?: number;
  commanderIntent?: string;
}
export interface TaskListStartMediaResponse {
  taskListId: string;
  promptAssemblyId: string;
}

export interface TaskListCancelMediaRequest {
  canvasId: string;
  nodeId: string;
  commanderSessionId: string;
}
export type TaskListCancelMediaResponse =
  { ok: true; taskListId: string; status: TaskListStatus } | { ok: false; code: 'no_active_task' };

export interface TaskListRetryMediaEvaluationRequest {
  taskListId: string;
  commanderSessionId: string;
}
export interface TaskListRetryMediaEvaluationResponse {
  taskListId: string;
  status: TaskListStatus;
}

export interface TaskListRetryMediaRequest {
  canvasId: string;
  nodeId: string;
  commanderSessionId: string;
  providerId?: string;
}
export type TaskListRetryMediaResponse = TaskListStartMediaResponse;

export interface PromptAssemblyGetRequest {
  id: string;
}
export type PromptAssemblyGetResponse = PromptAssemblyRecord | null;

export interface TaskListGetPendingApprovalRequest {
  taskListId: string;
}
export type TaskListGetPendingApprovalResponse = PlanApprovalContext | null;

export interface TaskListGetVisualAuditionsRequest {
  taskListId: string;
}
export type TaskListGetVisualAuditionsResponse = VisualAuditionContext | null;

export interface TaskListGetDeliveryRequest {
  taskListId: string;
}
export type TaskListGetDeliveryResponse = DeliveryManifestContext | null;

export type TaskListSelectVisualCandidateRequest = SelectVisualConstitutionCandidateInput;
export type TaskListSelectVisualCandidateResponse = VisualConstitutionSelectionResult;

export type TaskListRequestVisualAuditionChangesRequest = RequestVisualAuditionChangesInput;
export type TaskListRequestVisualAuditionChangesResponse = RequestVisualAuditionChangesResult;

export interface TaskListApproveGateRequest {
  taskListId: string;
  gateKey: PlanApprovalGateKey;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
}
export type TaskListApproveGateResponse = ApprovePlanGateResult;

export interface TaskListRequestChangesRequest {
  taskListId: string;
  gateKey: PlanApprovalGateKey;
  expectedRowVersion: number;
  expectedSubjectRevision: number;
  expectedSubjectHash: string;
  reason: string;
}
export type TaskListRequestChangesResponse = RevisePlanGateResult;

export type TaskListRejectGateRequest = TaskListRequestChangesRequest;
export type TaskListRejectGateResponse = RevisePlanGateResult;

export interface TaskListListPendingDecisionsRequest {
  taskListId?: string;
  canvasId?: string;
}
export type TaskListListPendingDecisionsResponse = TaskDecision[];
