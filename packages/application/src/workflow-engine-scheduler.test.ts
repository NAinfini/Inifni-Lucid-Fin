import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  StageRunStatus,
  TaskKind,
  TaskRunStatus,
  WorkflowRunStatus,
  type WorkflowTaskHandler,
} from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { WorkflowEngine } from './workflow-engine.js';
import { WorkflowRegistry, type RegisteredWorkflowDefinition } from './workflow-registry.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-scheduler-'));
}

describe('WorkflowEngine scheduling', () => {
  let base: string;
  let db: SqliteIndex;
  let registry: WorkflowRegistry;
  let executionOrder: string[];
  let engine: WorkflowEngine;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    registry = new WorkflowRegistry();
    executionOrder = [];

    const definition: RegisteredWorkflowDefinition = {
      id: 'storyboard.generate',
      name: 'Generate storyboard',
      version: 1,
      kind: 'storyboard.generate',
      description: 'Generate storyboard assets',
      displayCategory: 'Storyboard',
      displayLabel: 'Generate storyboard',
      stages: [
        {
          id: 'prepare',
          name: 'Prepare',
          order: 0,
          tasks: [
            {
              id: 'task-b',
              name: 'Task B',
              kind: TaskKind.Validation,
              handlerId: 'task-b',
              maxRetries: 1,
              displayCategory: 'Validation',
              displayLabel: 'Task B',
            },
            {
              id: 'task-a',
              name: 'Task A',
              kind: TaskKind.Validation,
              handlerId: 'task-a',
              maxRetries: 1,
              displayCategory: 'Validation',
              displayLabel: 'Task A',
            },
          ],
        },
        {
          id: 'render',
          name: 'Render',
          order: 1,
          dependsOnStageIds: ['prepare'],
          tasks: [
            {
              id: 'task-c',
              name: 'Task C',
              kind: TaskKind.Export,
              handlerId: 'task-c',
              maxRetries: 1,
              displayCategory: 'Render',
              displayLabel: 'Task C',
            },
          ],
        },
      ],
    };

    registry.register(definition);

    const handlers: WorkflowTaskHandler[] = [
      {
        id: 'task-a',
        kind: TaskKind.Validation,
        async execute(context) {
          executionOrder.push(context.taskRun.taskId);
          return { status: TaskRunStatus.Completed, progress: 100 };
        },
      },
      {
        id: 'task-b',
        kind: TaskKind.Validation,
        async execute(context) {
          executionOrder.push(context.taskRun.taskId);
          return { status: TaskRunStatus.Completed, progress: 100 };
        },
      },
      {
        id: 'task-c',
        kind: TaskKind.Export,
        async execute(context) {
          executionOrder.push(context.taskRun.taskId);
          return { status: TaskRunStatus.Completed, progress: 100 };
        },
      },
    ];

    engine = new WorkflowEngine({
      db,
      registry,
      handlers,
      idFactory: (() => {
        const ids = ['wf-1', 'stage-1', 'task-b-run', 'task-a-run', 'stage-2', 'task-c-run'];
        return () => ids.shift() ?? 'exhausted';
      })(),
      now: () => 1000,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('runs ready tasks in deterministic order and unlocks dependent stages', async () => {
    const workflowRunId = engine.start({
      workflowType: 'storyboard.generate',
      entityType: 'scene',
    });

    await engine.waitForAutoPump();

    expect(executionOrder).toEqual(['task-a', 'task-b', 'task-c']);
    expect(engine.getStages(workflowRunId)).toEqual([
      expect.objectContaining({
        id: 'stage-1',
        status: StageRunStatus.Completed,
      }),
      expect.objectContaining({
        id: 'stage-2',
        status: StageRunStatus.Completed,
      }),
    ]);
    expect(
      engine.getTasks(workflowRunId).map((task) => ({ id: task.taskId, status: task.status })),
    ).toEqual([
      { id: 'task-c', status: TaskRunStatus.Completed },
      { id: 'task-b', status: TaskRunStatus.Completed },
      { id: 'task-a', status: TaskRunStatus.Completed },
    ]);
    expect(engine.get(workflowRunId)).toEqual(
      expect.objectContaining({
        id: workflowRunId,
        status: WorkflowRunStatus.Completed,
        progress: 100,
      }),
    );
  });
});
