/** Renderer-visible Task List channels. Execution mutations remain Commander tools. */

import { z } from 'zod';
import { defineInvokeChannel } from '../../channels.js';

const taskListSummary = z.unknown();
const taskSummary = z.unknown();
const gateKey = z.enum(['production_plan', 'visual_constitution', 'delivery']);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/i);

const TaskListListRequest = z
  .object({
    status: z.string().optional(),
    taskListType: z.string().optional(),
    entityType: z.string().optional(),
  })
  .strict();
export const taskListListChannel = defineInvokeChannel({
  channel: 'taskList:list',
  request: TaskListListRequest,
  response: z.array(taskListSummary),
});
export type TaskListListRequest = z.infer<typeof TaskListListRequest>;
export type TaskListListResponse = unknown[];

const TaskListGetRequest = z.object({ id: z.string().min(1) }).strict();
export const taskListGetChannel = defineInvokeChannel({
  channel: 'taskList:get',
  request: TaskListGetRequest,
  response: taskListSummary,
});
export type TaskListGetRequest = z.infer<typeof TaskListGetRequest>;
export type TaskListGetResponse = unknown;

const TaskListGetTasksRequest = z.object({ taskListId: z.string().min(1) }).strict();
export const taskListGetTasksChannel = defineInvokeChannel({
  channel: 'taskList:getTasks',
  request: TaskListGetTasksRequest,
  response: z.array(taskSummary),
});
export type TaskListGetTasksRequest = z.infer<typeof TaskListGetTasksRequest>;
export type TaskListGetTasksResponse = unknown[];

const TaskListStartMediaRequest = z
  .object({
    canvasId: z.string().min(1),
    nodeId: z.string().min(1),
    commanderSessionId: z.string().trim().min(1),
    providerId: z.string().min(1).optional(),
    seed: z.number().int().optional(),
    commanderIntent: z.string().trim().min(1).optional(),
  })
  .strict();
export const taskListStartMediaChannel = defineInvokeChannel({
  channel: 'taskList:startMedia',
  request: TaskListStartMediaRequest,
  response: z
    .object({ taskListId: z.string().min(1), promptAssemblyId: z.string().min(1) })
    .strict(),
});
export type TaskListStartMediaRequest = z.infer<typeof TaskListStartMediaRequest>;
export type TaskListStartMediaResponse = z.infer<typeof taskListStartMediaChannel.schemas.response>;

const TaskListCancelMediaRequest = z
  .object({
    canvasId: z.string().min(1),
    nodeId: z.string().min(1),
    commanderSessionId: z.string().trim().min(1),
  })
  .strict();
export const taskListCancelMediaChannel = defineInvokeChannel({
  channel: 'taskList:cancelMedia',
  request: TaskListCancelMediaRequest,
  response: z.union([
    z
      .object({ ok: z.literal(true), taskListId: z.string().min(1), status: z.string().min(1) })
      .strict(),
    z.object({ ok: z.literal(false), code: z.literal('no_active_task') }).strict(),
  ]),
});
export type TaskListCancelMediaRequest = z.infer<typeof TaskListCancelMediaRequest>;
export type TaskListCancelMediaResponse = z.infer<
  typeof taskListCancelMediaChannel.schemas.response
>;

const TaskListRetryMediaEvaluationRequest = z
  .object({ taskListId: z.string().min(1), commanderSessionId: z.string().trim().min(1) })
  .strict();
export const taskListRetryMediaEvaluationChannel = defineInvokeChannel({
  channel: 'taskList:retryMediaEvaluation',
  request: TaskListRetryMediaEvaluationRequest,
  response: z.object({ taskListId: z.string().min(1), status: z.string().min(1) }).strict(),
});
export type TaskListRetryMediaEvaluationRequest = z.infer<
  typeof TaskListRetryMediaEvaluationRequest
>;
export type TaskListRetryMediaEvaluationResponse = z.infer<
  typeof taskListRetryMediaEvaluationChannel.schemas.response
>;

const TaskListRetryMediaRequest = z
  .object({
    canvasId: z.string().min(1),
    nodeId: z.string().min(1),
    commanderSessionId: z.string().trim().min(1),
    providerId: z.string().min(1).optional(),
  })
  .strict();
export const taskListRetryMediaChannel = defineInvokeChannel({
  channel: 'taskList:retryMedia',
  request: TaskListRetryMediaRequest,
  response: z
    .object({ taskListId: z.string().min(1), promptAssemblyId: z.string().min(1) })
    .strict(),
});
export type TaskListRetryMediaRequest = z.infer<typeof TaskListRetryMediaRequest>;
export type TaskListRetryMediaResponse = z.infer<typeof taskListRetryMediaChannel.schemas.response>;

const PromptAssemblyGetRequest = z.object({ id: z.string().min(1) }).strict();
export const promptAssemblyGetChannel = defineInvokeChannel({
  channel: 'promptAssembly:get',
  request: PromptAssemblyGetRequest,
  response: z.unknown().nullable(),
});
export type PromptAssemblyGetRequest = z.infer<typeof PromptAssemblyGetRequest>;
export type PromptAssemblyGetResponse = unknown;

const taskListIdRequest = z.object({ taskListId: z.string().min(1) }).strict();

export const taskListGetPendingApprovalChannel = defineInvokeChannel({
  channel: 'taskList:getPendingApproval',
  request: taskListIdRequest,
  response: z.unknown(),
});
export type TaskListGetPendingApprovalRequest = z.infer<typeof taskListIdRequest>;
export type TaskListGetPendingApprovalResponse = unknown;

export const taskListGetVisualAuditionsChannel = defineInvokeChannel({
  channel: 'taskList:getVisualAuditions',
  request: taskListIdRequest,
  response: z.unknown(),
});
export type TaskListGetVisualAuditionsRequest = z.infer<typeof taskListIdRequest>;
export type TaskListGetVisualAuditionsResponse = unknown;

export const taskListGetDeliveryChannel = defineInvokeChannel({
  channel: 'taskList:getDelivery',
  request: taskListIdRequest,
  response: z.unknown(),
});
export type TaskListGetDeliveryRequest = z.infer<typeof taskListIdRequest>;
export type TaskListGetDeliveryResponse = unknown;

const TaskListSelectVisualCandidateRequest = z
  .object({
    taskListId: z.string().min(1),
    candidateId: z.string().min(1),
    expectedRowVersion: z.number().int().nonnegative(),
    expectedAuditionRevision: z.number().int().positive(),
    expectedAuditionHash: sha256,
  })
  .strict();
export const taskListSelectVisualCandidateChannel = defineInvokeChannel({
  channel: 'taskList:selectVisualCandidate',
  request: TaskListSelectVisualCandidateRequest,
  response: z.unknown(),
});
export type TaskListSelectVisualCandidateRequest = z.infer<
  typeof TaskListSelectVisualCandidateRequest
>;
export type TaskListSelectVisualCandidateResponse = unknown;

const TaskListRequestVisualAuditionChangesRequest = z
  .object({
    taskListId: z.string().min(1),
    expectedRowVersion: z.number().int().nonnegative(),
    expectedAuditionRevision: z.number().int().positive(),
    expectedAuditionHash: sha256,
    reason: z.string().trim().min(1),
  })
  .strict();
export const taskListRequestVisualAuditionChangesChannel = defineInvokeChannel({
  channel: 'taskList:requestVisualAuditionChanges',
  request: TaskListRequestVisualAuditionChangesRequest,
  response: z.unknown(),
});
export type TaskListRequestVisualAuditionChangesRequest = z.infer<
  typeof TaskListRequestVisualAuditionChangesRequest
>;
export type TaskListRequestVisualAuditionChangesResponse = unknown;

const TaskListApproveGateRequest = z
  .object({
    taskListId: z.string().min(1),
    gateKey,
    expectedRowVersion: z.number().int().nonnegative(),
    expectedSubjectRevision: z.number().int().positive(),
    expectedSubjectHash: sha256,
  })
  .strict();
export const taskListApproveGateChannel = defineInvokeChannel({
  channel: 'taskList:approveGate',
  request: TaskListApproveGateRequest,
  response: z.unknown(),
});
export type TaskListApproveGateRequest = z.infer<typeof TaskListApproveGateRequest>;
export type TaskListApproveGateResponse = unknown;

const TaskListGateRevisionRequest = TaskListApproveGateRequest.extend({
  reason: z.string().trim().min(1),
}).strict();

export const taskListRequestChangesChannel = defineInvokeChannel({
  channel: 'taskList:requestChanges',
  request: TaskListGateRevisionRequest,
  response: z.unknown(),
});
export type TaskListRequestChangesRequest = z.infer<typeof TaskListGateRevisionRequest>;
export type TaskListRequestChangesResponse = unknown;

export const taskListRejectGateChannel = defineInvokeChannel({
  channel: 'taskList:rejectGate',
  request: TaskListGateRevisionRequest,
  response: z.unknown(),
});
export type TaskListRejectGateRequest = z.infer<typeof TaskListGateRevisionRequest>;
export type TaskListRejectGateResponse = unknown;

const TaskListListPendingDecisionsRequest = z
  .object({
    taskListId: z.string().min(1).optional(),
    canvasId: z.string().min(1).optional(),
  })
  .strict()
  .refine((request) => request.taskListId !== undefined || request.canvasId !== undefined, {
    message: 'taskListId or canvasId is required',
  });
export const taskListListPendingDecisionsChannel = defineInvokeChannel({
  channel: 'taskList:listPendingDecisions',
  request: TaskListListPendingDecisionsRequest,
  response: z.array(z.unknown()),
});
export type TaskListListPendingDecisionsRequest = z.infer<
  typeof TaskListListPendingDecisionsRequest
>;
export type TaskListListPendingDecisionsResponse = unknown[];

export const taskListChannels = [
  taskListListChannel,
  taskListGetChannel,
  taskListGetTasksChannel,
  taskListStartMediaChannel,
  taskListCancelMediaChannel,
  taskListRetryMediaEvaluationChannel,
  taskListRetryMediaChannel,
  promptAssemblyGetChannel,
  taskListGetPendingApprovalChannel,
  taskListGetVisualAuditionsChannel,
  taskListGetDeliveryChannel,
  taskListSelectVisualCandidateChannel,
  taskListRequestVisualAuditionChangesChannel,
  taskListApproveGateChannel,
  taskListRequestChangesChannel,
  taskListRejectGateChannel,
  taskListListPendingDecisionsChannel,
] as const;
