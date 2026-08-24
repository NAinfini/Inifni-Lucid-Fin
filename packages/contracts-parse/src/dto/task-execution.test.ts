import { describe, expect, it } from 'vitest';
import {
  parseTaskId,
  parseTaskListId,
  tryTaskId,
  tryTaskListId,
} from '../brands/task-execution-ids.js';
import {
  TaskAttemptsTable,
  TaskArtifactsTable,
  TaskEvaluationsTable,
  TaskListsTable,
  TasksTable,
} from '../storage/tables/task-execution.js';
import {
  DeliveryManifestSchema,
  TaskListRecordSchema,
  TaskRecordSchema,
} from './task-execution.js';

describe('task execution parsers', () => {
  it('parses canonical task-list and task records with phase fields', () => {
    expect(
      TaskListRecordSchema.parse({
        id: 'list-1',
        taskListType: 'movie.production.v2',
        entityType: 'canvas',
        triggerSource: 'commander',
        status: 'running',
        summary: 'Generating media',
        progress: 25,
        completedPhases: 1,
        totalPhases: 4,
        completedTasks: 2,
        totalTasks: 8,
        input: {},
        output: {},
        metadata: {},
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toMatchObject({ id: 'list-1', status: 'running', rowVersion: 0 });

    expect(
      TaskRecordSchema.parse({
        id: 'task-1',
        taskListId: 'list-1',
        phaseKey: 'media-generation',
        phaseName: 'Generate media',
        phaseOrder: 2,
        taskKey: 'shot-1',
        name: 'Generate shot 1',
        kind: 'adapter_generation',
        status: 'ready',
        attempts: 0,
        maxRetries: 2,
        progress: 0,
        updatedAt: 2,
      }),
    ).toMatchObject({
      taskListId: 'list-1',
      phaseKey: 'media-generation',
      taskKey: 'shot-1',
      dependencyIds: [],
    });
  });

  it('rejects corrupt statuses and missing phase identity', () => {
    const validTask = {
      id: 'task-1',
      taskListId: 'list-1',
      phaseKey: 'planning',
      phaseName: 'Planning',
      phaseOrder: 0,
      taskKey: 'plan',
      name: 'Plan',
      kind: 'validation',
      status: 'ready',
      attempts: 0,
      maxRetries: 0,
      progress: 0,
      updatedAt: 1,
    };
    expect(TaskRecordSchema.safeParse({ ...validTask, status: 'runing' }).success).toBe(false);
    expect(TaskRecordSchema.safeParse({ ...validTask, phaseKey: '' }).success).toBe(false);
  });

  it('exports trimmed ID parsers and canonical table bindings only', () => {
    expect(parseTaskListId('  list-1  ')).toBe('list-1');
    expect(parseTaskId('  task-1  ')).toBe('task-1');
    expect(tryTaskListId('   ')).toBeUndefined();
    expect(tryTaskId('')).toBeUndefined();

    expect(TaskListsTable.tableName).toBe('task_lists');
    expect(TaskListsTable.cols.currentPhaseKey.sqlName).toBe('current_phase_key');
    expect(TasksTable.tableName).toBe('tasks');
    expect(TasksTable.cols.phaseKey.sqlName).toBe('phase_key');
    expect(TaskAttemptsTable.tableName).toBe('task_attempts');
    expect(TaskAttemptsTable.cols.inputJson.sqlName).toBe('input_json');
    expect(TaskAttemptsTable.cols.scope.sqlName).toBe('scope');
    expect(TaskAttemptsTable.cols.providerReceipt.sqlName).toBe('provider_receipt');
    expect(TaskAttemptsTable.cols.packageHash.sqlName).toBe('package_hash');
    expect(TaskAttemptsTable.cols.packageBytes.sqlName).toBe('package_bytes');
    expect(TaskAttemptsTable.cols.fileCount.sqlName).toBe('file_count');
    expect(TaskEvaluationsTable.tableName).toBe('task_evaluations');
    expect(TaskEvaluationsTable.cols.artifactId.sqlName).toBe('artifact_id');
    expect(TaskEvaluationsTable.cols.sourcePromptHash.sqlName).toBe('source_prompt_hash');
    expect(TaskArtifactsTable.cols.attemptId.sqlName).toBe('attempt_id');
  });

  it('accepts only the ordered-source Delivery manifest', () => {
    const hash = 'a'.repeat(64);
    const manifest = {
      taskListId: 'list-1',
      productionPlan: { revision: 1, contentHash: hash },
      visualConstitution: { revision: 1, contentHash: hash },
      canvasId: 'canvas-1',
      deliverySequence: { revision: 3, contentHash: hash },
      namingPolicy: {
        packageBaseName: 'spring-campaign',
        orderPrefixWidth: 3,
        separator: '_',
        overwritePolicy: 'fail',
      },
      items: [
        {
          shotId: 'shot-1',
          selectedVideoHash: hash,
          packageFileName: '001_opening_shot-1.mp4',
          sourceFileName: 'opening.mp4',
          sourceFormat: 'mp4',
          sourceBytes: 42,
          sourceDurationMs: 3_000,
          sourceWidth: 1920,
          sourceHeight: 1080,
          hasEmbeddedAudio: true,
          trimInMs: 500,
          trimOutMs: 2_500,
          embeddedAudioEnabled: true,
          provenance: {
            assetCreatedAt: 10,
            nodeId: 'node-1',
            taskId: 'task-1',
            attemptId: 'attempt-1',
            evaluationId: 'evaluation-1',
            promptAssemblyId: 'assembly-1',
            providerId: 'provider-1',
            model: 'model-1',
          },
        },
      ],
    };

    expect(DeliveryManifestSchema.parse(manifest)).toEqual(manifest);
    expect(DeliveryManifestSchema.safeParse({ ...manifest, manifestVersion: 2 }).success).toBe(false);
    expect(
      DeliveryManifestSchema.safeParse({
        ...manifest,
        output: { codec: 'h264' },
      }).success,
    ).toBe(false);
    expect(
      DeliveryManifestSchema.safeParse({
        ...manifest,
        items: [{ ...manifest.items[0], trimOutMs: 500 }],
      }).success,
    ).toBe(false);
  });
});
