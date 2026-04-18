/**
 * Workflow-domain DTO schemas — Phase G1-2.11.
 *
 * Scoped tight on the ID + status surfaces most likely to corrupt
 * (enums + provider strings); nested payloads stay `z.unknown()` so the
 * repository stays fault-soft without forcing feature code to live in the
 * schema. Shape enforcement for task-run params / outputs stays in feature
 * code where the per-kind union already lives.
 *
 * Status + kind enums mirror the contract unions in
 * `@lucid-fin/contracts/dto/workflow` so corrupt persisted strings
 * (e.g. `"runing"`) degrade via `parseOrDegrade` instead of leaking
 * impossible states to the UI.
 */

import { z } from 'zod';

const baseTimestamp = z.number();
const optionalString = z.string().optional();

const WorkflowRunStatusEnum = z.enum([
  'pending',
  'blocked',
  'ready',
  'queued',
  'preparing',
  'running',
  'paused',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'dead',
]);

const StageRunStatusEnum = z.enum([
  'pending',
  'blocked',
  'ready',
  'running',
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
  'skipped',
]);

const TaskRunStatusEnum = z.enum([
  'pending',
  'blocked',
  'ready',
  'running',
  'awaiting_provider',
  'retryable_failed',
  'completed',
  'failed',
  'cancelled',
  'skipped',
]);

const TaskKindEnum = z.enum([
  'adapter_generation',
  'provider_poll',
  'transform',
  'validation',
  'asset_resolve',
  'metadata_extract',
  'timeline_assembly',
  'export',
  'cleanup',
]);

export const WorkflowRunRecordSchema = z.object({
  id: z.string().min(1),
  workflowType: z.string(),
  entityType: z.string(),
  entityId: optionalString,
  triggerSource: z.string(),
  status: WorkflowRunStatusEnum,
  summary: z.string().default(''),
  progress: z.number(),
  completedStages: z.number(),
  totalStages: z.number(),
  completedTasks: z.number(),
  totalTasks: z.number(),
  currentStageId: optionalString,
  currentTaskId: optionalString,
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.record(z.string(), z.unknown()).default({}),
  error: optionalString,
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: baseTimestamp,
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  updatedAt: baseTimestamp,
});
export type WorkflowRunRecordDto = z.infer<typeof WorkflowRunRecordSchema>;

export const WorkflowStageRunRecordSchema = z.object({
  id: z.string().min(1),
  workflowRunId: z.string().min(1),
  stageId: z.string(),
  name: z.string(),
  status: StageRunStatusEnum,
  order: z.number(),
  progress: z.number(),
  completedTasks: z.number(),
  totalTasks: z.number(),
  error: optionalString,
  metadata: z.record(z.string(), z.unknown()).default({}),
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  updatedAt: baseTimestamp,
});
export type WorkflowStageRunRecordDto = z.infer<typeof WorkflowStageRunRecordSchema>;

export const WorkflowTaskRunRecordSchema = z.object({
  id: z.string().min(1),
  workflowRunId: z.string().min(1),
  stageRunId: z.string().min(1),
  taskId: z.string(),
  name: z.string(),
  kind: TaskKindEnum,
  status: TaskRunStatusEnum,
  provider: optionalString,
  dependencyIds: z.array(z.string()).default([]),
  attempts: z.number(),
  maxRetries: z.number(),
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.record(z.string(), z.unknown()).default({}),
  providerTaskId: optionalString,
  assetId: optionalString,
  error: optionalString,
  progress: z.number(),
  currentStep: optionalString,
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  updatedAt: baseTimestamp,
});
export type WorkflowTaskRunRecordDto = z.infer<typeof WorkflowTaskRunRecordSchema>;
