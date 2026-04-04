import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TaskKind, type WorkflowTaskHandler } from '@lucid-fin/contracts';
import { SqliteIndex } from '@lucid-fin/storage';
import { WorkflowEngine } from '@lucid-fin/application';
import { WorkflowRegistry, type RegisteredWorkflowDefinition } from '@lucid-fin/application';
import { registerWorkflowHandlers } from './workflow.handlers.js';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'lucid-workflow-ipc-'));
}

describe('registerWorkflowHandlers', () => {
  let base: string;
  let db: SqliteIndex;
  let registry: WorkflowRegistry;
  let engine: WorkflowEngine;
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    base = tmpDir();
    db = new SqliteIndex(path.join(base, 'test.db'));
    registry = new WorkflowRegistry();
    handlers = new Map();

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
    registry.register(definition);

    const taskHandlers: WorkflowTaskHandler[] = [
      {
        id: 'validate-input',
        kind: TaskKind.Validation,
        async execute() {
          return { status: 'completed', progress: 100 };
        },
      },
    ];

    engine = new WorkflowEngine({
      db,
      registry,
      handlers: taskHandlers,
      idFactory: (() => {
        const ids = ['wf-1', 'stage-1', 'task-1'];
        return () => ids.shift() ?? 'exhausted';
      })(),
      now: () => 1000,
    });

    registerWorkflowHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as unknown as Parameters<typeof registerWorkflowHandlers>[0],
      engine,
    );
  });

  afterEach(() => {
    db.close();
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('registers workflow ipc methods and proxies workflow engine state', async () => {
    const start = handlers.get('workflow:start');
    const list = handlers.get('workflow:list');
    const get = handlers.get('workflow:get');
    const getStages = handlers.get('workflow:getStages');
    const getTasks = handlers.get('workflow:getTasks');
    const pause = handlers.get('workflow:pause');
    const resume = handlers.get('workflow:resume');
    const cancel = handlers.get('workflow:cancel');

    expect(start).toBeTypeOf('function');
    expect(list).toBeTypeOf('function');
    expect(get).toBeTypeOf('function');
    expect(getStages).toBeTypeOf('function');
    expect(getTasks).toBeTypeOf('function');
    expect(pause).toBeTypeOf('function');
    expect(resume).toBeTypeOf('function');
    expect(cancel).toBeTypeOf('function');

    const started = (await start?.(
      {},
      {
        workflowType: 'storyboard.generate',
        projectId: 'project-1',
        entityType: 'scene',
        entityId: 'scene-1',
      },
    )) as { workflowRunId: string };
    expect(started).toEqual({ workflowRunId: 'wf-1' });

    const listed = (await list?.({}, {})) as Array<{ id: string; status: string }>;
    expect(listed).toEqual([
      expect.objectContaining({
        id: 'wf-1',
        status: 'ready',
      }),
    ]);
    expect(await get?.({}, { id: 'wf-1' })).toEqual(expect.objectContaining({ id: 'wf-1' }));
    expect(await getStages?.({}, { workflowRunId: 'wf-1' })).toEqual([
      expect.objectContaining({ id: 'stage-1' }),
    ]);
    expect(await getTasks?.({}, { workflowRunId: 'wf-1' })).toEqual([
      expect.objectContaining({ id: 'task-1' }),
    ]);

    await pause?.({}, { id: 'wf-1' });
    expect(engine.get('wf-1')).toEqual(expect.objectContaining({ status: 'paused' }));

    await resume?.({}, { id: 'wf-1' });
    expect(engine.get('wf-1')).toEqual(expect.objectContaining({ status: 'ready' }));

    await cancel?.({}, { id: 'wf-1' });
    expect(engine.get('wf-1')).toEqual(expect.objectContaining({ status: 'cancelled' }));
  });
});
