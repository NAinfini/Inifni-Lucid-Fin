import type {
  ProductionMediaTaskAttempt,
  Task,
  TaskList,
} from '@lucid-fin/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMediaTaskService } from './media-task.service.js';

describe('createMediaTaskService', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops automatic grading after a transient failure and retries only on explicit request', async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const service = createMediaTaskService({
      db: fixture.db,
      canvasStore: fixture.canvasStore,
      taskExecutionEngine: fixture.engine,
      promptAssemblyService: fixture.promptAssemblyService,
      mediaGenerationService: { cancel: vi.fn() },
      mediaEvaluationService: { evaluate: fixture.evaluate },
      pollIntervalMs: 5,
    });

    service.resumePending();
    await vi.advanceTimersByTimeAsync(5);

    expect(fixture.engine.recover).toHaveBeenCalledTimes(1);
    expect(fixture.evaluate).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(50);
    expect(fixture.engine.recover).toHaveBeenCalledTimes(1);
    expect(fixture.evaluate).toHaveBeenCalledTimes(1);

    await service.retryEvaluation('task-list-1', 'session-1');
    expect(fixture.evaluate).toHaveBeenCalledTimes(2);
    expect(fixture.engine.recover).toHaveBeenCalledTimes(1);

    service.stop();
  });
});

function createFixture() {
  const taskList = {
    id: 'task-list-1',
    taskListType: 'media.generation.v1',
    entityType: 'canvas',
    entityId: 'canvas-1',
    status: 'awaiting_provider',
    metadata: { commanderSessionId: 'session-1' },
    createdAt: 10,
    updatedAt: 10,
  } as TaskList;
  const task = {
    id: 'task-1',
    taskListId: taskList.id,
    status: 'awaiting_provider',
    progress: 50,
    input: { nodeId: 'node-1' },
    output: { promptAssemblyId: 'assembly-1' },
  } as Task;
  const attempt = {
    id: 'attempt-1',
    kind: 'production_media',
    taskListId: taskList.id,
    taskId: task.id,
    canvasId: 'canvas-1',
    nodeId: 'node-1',
    status: 'asset_ready',
    scope: 'canvas',
    generationSpec: {
      authority: { kind: 'task-list' },
      nodeUpdatedAt: 10,
    },
  } as ProductionMediaTaskAttempt;
  const taskListRepo = {
    getLatestProductionMediaAttempt: vi.fn(() => attempt),
    getTaskEvaluation: vi.fn(),
    getArtifactByAttempt: vi.fn(),
  };
  const db = { repos: { taskLists: taskListRepo } } as never;
  const engine = {
    list: vi.fn(() => [taskList]),
    get: vi.fn(() => taskList),
    getTasks: vi.fn(() => [task]),
    recover: vi.fn(async () => undefined),
    cancel: vi.fn(async () => undefined),
    start: vi.fn(),
    waitForAutoPump: vi.fn(async () => undefined),
  } as never;
  const canvasStore = {
    get: vi.fn(() => ({
      id: 'canvas-1',
      settings: {},
      nodes: [{ id: 'node-1', title: 'Frame', updatedAt: 10 }],
    })),
  } as never;
  const promptAssemblyService = {
    get: vi.fn(() => ({ id: 'assembly-1', status: 'assembled' })),
    submitCommanderOutput: vi.fn(),
  } as never;
  const evaluate = vi.fn(async () => ({
    status: 'evaluation_pending' as const,
    attempt,
    message: 'visual provider unavailable',
  }));

  return {
    db,
    engine,
    canvasStore,
    promptAssemblyService,
    evaluate,
  };
}
