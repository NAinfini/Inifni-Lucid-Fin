import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  TaskKind,
  TaskRunStatus,
  WorkflowRunStatus,
  type WorkflowTaskHandler,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { WorkflowEngine } from './workflow-engine.js';
import { WorkflowRegistry, type RegisteredWorkflowDefinition } from './workflow-registry.js';
import { WorkflowRecovery } from './workflow-recovery.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-recovery-'));
}

describe('WorkflowRecovery', () => {
  let base: string;
  let db: SqliteIndex;
  let registry: WorkflowRegistry;
  let engine: WorkflowEngine;
  let recovery: WorkflowRecovery;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    registry = new WorkflowRegistry();

    const definition: RegisteredWorkflowDefinition = {
      id: 'style.extract',
      name: 'Extract style',
      version: 1,
      kind: 'style.extract',
      description: 'Extract style data from an asset',
      displayCategory: 'Style',
      displayLabel: 'Extract style',
      stages: [
        {
          id: 'extract',
          name: 'Extract',
          order: 0,
          tasks: [
            {
              id: 'recover-task',
              name: 'Recover task',
              kind: TaskKind.AdapterGeneration,
              handlerId: 'recover-task',
              maxRetries: 2,
              providerHint: 'mock-provider',
              displayCategory: 'Style',
              displayLabel: 'Recover task',
            },
          ],
        },
      ],
    };
    registry.register(definition);

    const handlers: WorkflowTaskHandler[] = [
      {
        id: 'recover-task',
        kind: TaskKind.AdapterGeneration,
        async execute() {
          return {
            status: TaskRunStatus.AwaitingProvider,
            providerTaskId: 'provider-task-1',
            progress: 20,
            currentStep: 'submitted',
          };
        },
        async recover(context) {
          if (context.taskRun.status === TaskRunStatus.AwaitingProvider) {
            return {
              status: TaskRunStatus.Completed,
              progress: 100,
              output: { recovered: true },
            };
          }

          return {
            status: TaskRunStatus.Completed,
            progress: 100,
            output: { restarted: true },
          };
        },
      },
    ];

    engine = new WorkflowEngine({
      db,
      registry,
      handlers,
      idFactory: (() => {
        const ids = ['wf-1', 'stage-1', 'task-1', 'wf-2', 'stage-2', 'task-2'];
        return () => ids.shift() ?? 'exhausted';
      })(),
      now: () => 1000,
    });
    recovery = new WorkflowRecovery(engine);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('recovers running and awaiting_provider tasks back into terminal workflow state', async () => {
    const awaitingWorkflowId = engine.start({
      workflowType: 'style.extract',
      entityType: 'asset',
      entityId: 'asset-1',
    });
    await engine.pump(awaitingWorkflowId);

    const runningWorkflowId = engine.start({
      workflowType: 'style.extract',
      entityType: 'asset',
      entityId: 'asset-2',
    });
    db.updateWorkflowTaskRun('task-2', {
      status: TaskRunStatus.Running,
      startedAt: 1010,
      updatedAt: 1010,
    });
    db.recomputeStageAggregate('stage-2');
    db.recomputeWorkflowAggregate('wf-2');

    const recovered = await recovery.recover();

    expect(recovered).toBe(2);
    expect(engine.getTasks(awaitingWorkflowId)).toEqual([
      expect.objectContaining({
        id: 'task-1',
        status: TaskRunStatus.Completed,
        output: { recovered: true },
      }),
    ]);
    expect(engine.getTasks(runningWorkflowId)).toEqual([
      expect.objectContaining({
        id: 'task-2',
        status: TaskRunStatus.Completed,
        output: { restarted: true },
      }),
    ]);
    expect(engine.get(awaitingWorkflowId)).toEqual(
      expect.objectContaining({
        id: awaitingWorkflowId,
        status: WorkflowRunStatus.Completed,
      }),
    );
    expect(engine.get(runningWorkflowId)).toEqual(
      expect.objectContaining({
        id: runningWorkflowId,
        status: WorkflowRunStatus.Completed,
      }),
    );
  });
});
