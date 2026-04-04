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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-engine-'));
}

function createHandler(id: string): WorkflowTaskHandler {
  return {
    id,
    kind: TaskKind.Validation,
    async execute() {
      return {
        status: TaskRunStatus.Completed,
        output: { ok: true },
        progress: 100,
      };
    },
  };
}

function createDefinition(): RegisteredWorkflowDefinition {
  return {
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
            id: 'validate-input',
            name: 'Validate input',
            kind: TaskKind.Validation,
            handlerId: 'validate-input',
            maxRetries: 1,
            displayCategory: 'Validation',
            displayLabel: 'Validate input',
          },
        ],
      },
    ],
  };
}

describe('WorkflowEngine', () => {
  let base: string;
  let db: SqliteIndex;
  let registry: WorkflowRegistry;
  let engine: WorkflowEngine;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    registry = new WorkflowRegistry();
    registry.register(createDefinition());
    engine = new WorkflowEngine({
      db,
      registry,
      handlers: [createHandler('validate-input')],
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

  it('starts workflows and exposes persisted list/get state', () => {
    const workflowRunId = engine.start({
      workflowType: 'storyboard.generate',
      projectId: 'project-1',
      entityType: 'scene',
      entityId: 'scene-1',
      input: { sceneId: 'scene-1' },
      metadata: { relatedEntityLabel: 'Opening Scene' },
    });

    expect(workflowRunId).toBe('wf-1');
    expect(engine.list()).toEqual([
      expect.objectContaining({
        id: 'wf-1',
        workflowType: 'storyboard.generate',
        projectId: 'project-1',
        entityType: 'scene',
        entityId: 'scene-1',
        status: WorkflowRunStatus.Ready,
        currentStageId: 'stage-1',
        currentTaskId: 'task-1',
      }),
    ]);
    expect(engine.get('wf-1')).toEqual(
      expect.objectContaining({
        id: 'wf-1',
        status: WorkflowRunStatus.Ready,
      }),
    );
    expect(engine.getStages('wf-1')).toEqual([
      expect.objectContaining({
        id: 'stage-1',
        workflowRunId: 'wf-1',
      }),
    ]);
    expect(engine.getTasks('wf-1')).toEqual([
      expect.objectContaining({
        id: 'task-1',
        workflowRunId: 'wf-1',
        status: TaskRunStatus.Ready,
        input: expect.objectContaining({
          handlerId: 'validate-input',
          sceneId: 'scene-1',
        }),
      }),
    ]);
  });
});
