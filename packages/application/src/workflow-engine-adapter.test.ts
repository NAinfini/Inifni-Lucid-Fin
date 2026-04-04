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

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-adapter-'));
}

describe('WorkflowEngine async execution', () => {
  let base: string;
  let db: SqliteIndex;
  let registry: WorkflowRegistry;
  let engine: WorkflowEngine;

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
              id: 'submit-provider-job',
              name: 'Submit provider job',
              kind: TaskKind.AdapterGeneration,
              handlerId: 'submit-provider-job',
              maxRetries: 2,
              providerHint: 'mock-provider',
              displayCategory: 'Style',
              displayLabel: 'Submit provider job',
            },
          ],
        },
      ],
    };
    registry.register(definition);

    const handlers: WorkflowTaskHandler[] = [
      {
        id: 'submit-provider-job',
        kind: TaskKind.AdapterGeneration,
        async execute() {
          return {
            status: TaskRunStatus.AwaitingProvider,
            providerTaskId: 'provider-task-1',
            progress: 25,
            currentStep: 'submitted',
          };
        },
      },
    ];

    engine = new WorkflowEngine({
      db,
      registry,
      handlers,
      idFactory: (() => {
        const ids = ['wf-1', 'stage-1', 'task-1'];
        return () => ids.shift() ?? 'exhausted';
      })(),
      now: () => 1000,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('persists awaiting_provider tasks with provider tracking data', async () => {
    const workflowRunId = engine.start({
      workflowType: 'style.extract',
      projectId: 'project-1',
      entityType: 'asset',
      entityId: 'asset-1',
    });

    const executed = await engine.pump(workflowRunId);

    expect(executed).toBe(1);
    expect(engine.getTasks(workflowRunId)).toEqual([
      expect.objectContaining({
        id: 'task-1',
        status: TaskRunStatus.AwaitingProvider,
        provider: 'mock-provider',
        providerTaskId: 'provider-task-1',
        progress: 25,
        currentStep: 'submitted',
      }),
    ]);
    expect(engine.get(workflowRunId)).toEqual(
      expect.objectContaining({
        id: workflowRunId,
        status: WorkflowRunStatus.Running,
        currentTaskId: 'task-1',
      }),
    );
  });
});
