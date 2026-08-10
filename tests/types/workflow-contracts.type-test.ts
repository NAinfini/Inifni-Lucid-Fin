import type {
  WorkflowCancelRequest,
  WorkflowGetRequest,
  WorkflowGetResponse,
  WorkflowGetStagesRequest,
  WorkflowGetStagesResponse,
  WorkflowGetTasksRequest,
  WorkflowGetTasksResponse,
  WorkflowListResponse,
  WorkflowPauseRequest,
  WorkflowResumeRequest,
  WorkflowRetryStageRequest,
  WorkflowRetryTaskRequest,
  WorkflowRetryWorkflowRequest,
  WorkflowStartRequest,
  WorkflowStartResponse,
} from '../../packages/contracts-parse/src/ipc/channels/batch-06.js';
import type { ColorStyleExtractResponse } from '../../packages/contracts-parse/src/ipc/channels/batch-03.js';
import {
  commanderChatChannel,
  type CommanderBlockerPayload,
  type CommanderEvidencePayload,
  type CommanderExitDecisionPayload,
  type CommanderIntentPayload,
} from '../../packages/contracts-parse/src/ipc/channels/batch-09.js';

type Assert<T extends true> = T;
type IsAssignable<Actual, Expected> = [Actual] extends [Expected] ? true : false;
type IsExact<Actual, Expected> =
  (<T>() => T extends Actual ? 1 : 2) extends <T>() => T extends Expected ? 1 : 2
    ? (<T>() => T extends Expected ? 1 : 2) extends <T>() => T extends Actual ? 1 : 2
      ? true
      : false
    : false;

type _WorkflowGetRequest = Assert<IsAssignable<WorkflowGetRequest, { id: string }>>;
// Batch 06 deliberately keeps workflow projection responses opaque until its
// DTO schemas are zodified. These exact checks document the real contract;
// the deleted Vitest expectTypeOf calls never ran a TypeScript checker.
type _WorkflowListResponse = Assert<IsExact<WorkflowListResponse, unknown[]>>;
type _WorkflowGetResponse = Assert<IsExact<WorkflowGetResponse, unknown>>;
type _WorkflowGetStagesRequest = Assert<
  IsAssignable<WorkflowGetStagesRequest, { workflowRunId: string }>
>;
type _WorkflowGetStagesResponse = Assert<IsExact<WorkflowGetStagesResponse, unknown[]>>;
type _WorkflowGetTasksRequest = Assert<
  IsAssignable<WorkflowGetTasksRequest, { workflowRunId: string }>
>;
type _WorkflowGetTasksResponse = Assert<IsExact<WorkflowGetTasksResponse, unknown[]>>;
type _WorkflowStartRequest = Assert<
  IsAssignable<
    WorkflowStartRequest,
    {
      workflowType: string;
      entityType: string;
      entityId?: string;
      triggerSource?: string;
      input?: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    }
  >
>;
type _WorkflowStartResponse = Assert<IsExact<WorkflowStartResponse, { workflowRunId: string }>>;
type _WorkflowPauseRequest = Assert<IsAssignable<WorkflowPauseRequest, { id: string }>>;
type _WorkflowResumeRequest = Assert<IsAssignable<WorkflowResumeRequest, { id: string }>>;
type _WorkflowCancelRequest = Assert<IsAssignable<WorkflowCancelRequest, { id: string }>>;
type _WorkflowRetryTaskRequest = Assert<
  IsAssignable<WorkflowRetryTaskRequest, { taskRunId: string }>
>;
type _WorkflowRetryStageRequest = Assert<
  IsAssignable<WorkflowRetryStageRequest, { stageRunId: string }>
>;
type _WorkflowRetryWorkflowRequest = Assert<
  IsAssignable<WorkflowRetryWorkflowRequest, { id: string }>
>;
type _ColorStyleExtractResponse = Assert<
  IsExact<ColorStyleExtractResponse, { workflowRunId: string }>
>;

type HistoryEntry =
  | {
      role: 'user' | 'assistant';
      content: string;
      toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
    }
  | { role: 'tool'; content: string; toolCallId: string };

type InferredHistoryElement = (typeof commanderChatChannel)['_types']['request']['history'][number];

type _HistoryEntryDrift = Assert<IsAssignable<InferredHistoryElement, HistoryEntry>>;
type _IntentPayloadDrift = Assert<IsAssignable<CommanderIntentPayload, { kind: string }>>;
type _EvidencePayloadDrift = Assert<
  IsAssignable<CommanderEvidencePayload, { kind: string; at: number }>
>;
type _BlockerPayloadDrift = Assert<IsAssignable<CommanderBlockerPayload, { kind: string }>>;
type _ExitPayloadDrift = Assert<IsAssignable<CommanderExitDecisionPayload, { outcome: string }>>;

export {};
