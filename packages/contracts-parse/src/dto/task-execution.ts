/**
 * Task-execution DTO schemas — Phase G1-2.11.
 *
 * Scoped tight on the ID + status surfaces most likely to corrupt
 * (enums + provider strings); nested payloads stay `z.unknown()` so the
 * repository stays fault-soft without forcing feature code to live in the
 * schema. Shape enforcement for task parameters and outputs stays in feature
 * code where the per-kind union already lives.
 *
 * Status + kind enums mirror the contract unions in
 * `@lucid-fin/contracts/dto/task-execution` so corrupt persisted strings
 * (e.g. `"runing"`) degrade via `parseOrDegrade` instead of leaking
 * impossible states to the UI.
 */

import { z } from 'zod';

const baseTimestamp = z.number();
const optionalString = z.string().optional();

const TaskListStatusEnum = z.enum([
  'pending',
  'awaiting_approval',
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

const PlanApprovalGateKeyEnum = z.enum(['production_plan', 'visual_constitution', 'delivery']);

const TaskStatusEnum = z.enum([
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
  'export',
  'cleanup',
]);

export const TaskListRecordSchema = z.object({
  id: z.string().min(1),
  taskListType: z.string(),
  entityType: z.string(),
  entityId: optionalString,
  triggerSource: z.string(),
  status: TaskListStatusEnum,
  summary: z.string().default(''),
  progress: z.number(),
  completedPhases: z.number(),
  totalPhases: z.number(),
  completedTasks: z.number(),
  totalTasks: z.number(),
  currentPhaseKey: optionalString,
  currentTaskId: optionalString,
  input: z.record(z.string(), z.unknown()).default({}),
  output: z.record(z.string(), z.unknown()).default({}),
  error: optionalString,
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: baseTimestamp,
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  updatedAt: baseTimestamp,
  rowVersion: z.number().int().nonnegative().default(0),
  currentGate: PlanApprovalGateKeyEnum.optional(),
  engineVersion: z.string().min(1).default('legacy'),
  definitionVersion: z.number().int().positive().default(1),
  leaseOwner: optionalString,
  leaseToken: z.number().int().nonnegative().default(0),
  leaseExpiresAt: z.number().optional(),
  heartbeatAt: z.number().optional(),
});
export type TaskListRecordDto = z.infer<typeof TaskListRecordSchema>;

export const TaskRecordSchema = z.object({
  id: z.string().min(1),
  taskListId: z.string().min(1),
  phaseKey: z.string().min(1),
  phaseName: z.string().min(1),
  phaseOrder: z.number().int().nonnegative(),
  taskKey: z.string(),
  name: z.string(),
  kind: TaskKindEnum,
  status: TaskStatusEnum,
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
export type TaskRecordDto = z.infer<typeof TaskRecordSchema>;

const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const MillisecondsSchema = z.number().finite().int().nonnegative();
const SafeFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/[\\/]/.test(value) && value !== '.' && value !== '..', {
    message: 'Expected a file name without path separators',
  });

export const DeliveryNamingPolicySchema = z
  .object({
    packageBaseName: SafeFileNameSchema,
    orderPrefixWidth: z.number().int().positive().max(12),
    separator: z.literal('_'),
    overwritePolicy: z.literal('fail'),
  })
  .strict();

export const DeliveryProvenanceSchema = z
  .object({
    assetCreatedAt: MillisecondsSchema,
    nodeId: z.string().trim().min(1).optional(),
    taskId: z.string().trim().min(1).optional(),
    attemptId: z.string().trim().min(1).optional(),
    evaluationId: z.string().trim().min(1).optional(),
    promptAssemblyId: z.string().trim().min(1).optional(),
    providerId: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).optional(),
  })
  .strict();

export const DeliveryManifestItemSchema = z
  .object({
    shotId: z.string().trim().min(1),
    selectedVideoHash: Sha256Schema,
    packageFileName: SafeFileNameSchema,
    sourceFileName: SafeFileNameSchema,
    sourceFormat: z.string().trim().min(1),
    sourceBytes: z.number().int().positive(),
    sourceDurationMs: z.number().int().positive(),
    sourceWidth: z.number().int().positive().optional(),
    sourceHeight: z.number().int().positive().optional(),
    hasEmbeddedAudio: z.boolean(),
    trimInMs: MillisecondsSchema,
    trimOutMs: z.number().int().positive(),
    embeddedAudioEnabled: z.boolean(),
    provenance: DeliveryProvenanceSchema,
  })
  .strict()
  .superRefine((item, ctx) => {
    if (item.trimOutMs <= item.trimInMs || item.trimOutMs > item.sourceDurationMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['trimOutMs'],
        message: 'trimOutMs must be greater than trimInMs and within sourceDurationMs',
      });
    }
    if ((item.sourceWidth === undefined) !== (item.sourceHeight === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceWidth'],
        message: 'sourceWidth and sourceHeight must be provided together',
      });
    }
    if (item.embeddedAudioEnabled && !item.hasEmbeddedAudio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['embeddedAudioEnabled'],
        message: 'embedded audio cannot be enabled when the source has no audio',
      });
    }
  });

export const DeliveryManifestSchema = z
  .object({
    taskListId: z.string().trim().min(1),
    canvasId: z.string().trim().min(1),
    productionPlan: z
      .object({ revision: z.number().int().positive(), contentHash: Sha256Schema })
      .strict(),
    visualConstitution: z
      .object({ revision: z.number().int().positive(), contentHash: Sha256Schema })
      .strict(),
    deliverySequence: z
      .object({ revision: z.number().int().positive(), contentHash: Sha256Schema })
      .strict(),
    namingPolicy: DeliveryNamingPolicySchema,
    items: z.array(DeliveryManifestItemSchema).min(1),
  })
  .strict()
  .superRefine((manifest, ctx) => {
    const shotIds = new Set<string>();
    const fileNames = new Set<string>();
    for (const [index, item] of manifest.items.entries()) {
      if (shotIds.has(item.shotId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'shotId'],
          message: `Duplicate shotId: ${item.shotId}`,
        });
      }
      if (fileNames.has(item.packageFileName)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'packageFileName'],
          message: `Duplicate packageFileName: ${item.packageFileName}`,
        });
      }
      const expectedPrefix = `${String(index + 1).padStart(
        manifest.namingPolicy.orderPrefixWidth,
        '0',
      )}${manifest.namingPolicy.separator}`;
      if (!item.packageFileName.startsWith(expectedPrefix)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['items', index, 'packageFileName'],
          message: `packageFileName must start with ${expectedPrefix}`,
        });
      }
      shotIds.add(item.shotId);
      fileNames.add(item.packageFileName);
    }
  });
export type DeliveryManifestDto = z.infer<typeof DeliveryManifestSchema>;
