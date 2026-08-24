import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildPersistentTaskListContext } = vi.hoisted(() => ({
  buildPersistentTaskListContext: vi.fn(),
}));
vi.mock('./commander-context.service.js', () => ({ buildPersistentTaskListContext }));

import {
  buildTaskListCommanderContinuation,
  createCommanderTaskContinuationController,
} from './commander-task-continuation.js';

describe('Commander persistent Task List continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists only the keyless, bounded runtime fields', () => {
    const continuation = buildTaskListCommanderContinuation({
      defaultCanvasId: 'canvas-1',
      authorizedCanvasIds: ['canvas-1'],
      sessionId: 'session-1',
      intent: { kind: 'user_message', message: 'make a film' },
      selectedNodes: [],
      promptGuides: [{ id: 'private-guide', name: 'Private', content: 'do not persist' }],
      customLLMProvider: {
        id: 'openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-5.6-sol',
        protocol: 'openai-responses',
        authStyle: 'bearer',
        apiKey: 'must-not-persist',
      } as never,
      permissionMode: 'auto',
      locale: 'zh-CN',
      resourceBudget: { maxTokens: 10_000, maxCostUsd: 0 },
      contextWindowTokens: 120_000,
      maxOutputTokens: 4_096,
      defaultProviders: {
        image: 'image-provider',
        video: 'video-provider',
        secret: 'must-not-persist',
      },
    }, 'run-root');

    expect(continuation).toMatchObject({
      version: 1,
      sessionId: 'session-1',
      permissionMode: 'auto',
      locale: 'zh-CN',
      resourceBudget: { maxTokens: 10_000, maxCostUsd: 0 },
      lastRunId: 'run-root',
      contextWindowTokens: 120_000,
      maxOutputTokens: 4_096,
      provider: { id: 'openai', model: 'gpt-5.6-sol' },
      defaultProviders: { image: 'image-provider', video: 'video-provider' },
    });
    expect(JSON.stringify(continuation)).not.toContain('apiKey');
    expect(JSON.stringify(continuation)).not.toContain('private-guide');
    expect(JSON.stringify(continuation)).not.toContain('must-not-persist');
  });

  it('claims and runs one external task, then stops at the next human gate', async () => {
    const readyRun = {
      id: 'task-list-1',
      taskListType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      metadata: { commanderSessionId: 'session-1' },
      rowVersion: 4,
      currentTaskId: 'task-style-1',
    };
    const gatedRun = {
      ...readyRun,
      status: 'awaiting_approval',
      currentGate: 'visual_constitution',
    };
    const task = {
      id: 'task-style-1',
      taskListId: 'task-list-1',
      taskId: 'style-audition',
      status: 'ready',
      input: { executionMode: 'external', taskRole: 'style_audition' },
    };
    const taskExecutionEngine = {
      waitForAutoPump: vi.fn(async () => undefined),
      get: vi.fn().mockReturnValueOnce(readyRun).mockReturnValueOnce(gatedRun),
      getTasks: vi.fn(() => [task]),
      claimCommanderContinuation: vi.fn(() => ({
        ok: true,
        run: { ...readyRun, rowVersion: 5 },
        task,
        continuation: {
          version: 1,
          sessionId: 'session-1',
          provider: {
            id: 'openai',
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.6-sol',
            protocol: 'openai-responses',
            authStyle: 'bearer',
          },
          permissionMode: 'auto',
          resourceBudget: { maxTokens: 10_000 },
          lastRunId: 'run-root',
          contextWindowTokens: 120_000,
          maxOutputTokens: 4_096,
        },
      })),
      finishCommanderContinuationClaim: vi.fn(() => true),
      list: vi.fn(() => []),
      getLatestVisualAudition: vi.fn(),
    };
    buildPersistentTaskListContext.mockReturnValue({
      taskListToolPolicy: {
        taskListId: 'task-list-1',
        phase: 'style_exploration',
      },
    });
    const runCommander = vi.fn(async () => ({ runId: 'run-continuation-1', succeeded: true }));
    const controller = createCommanderTaskContinuationController({
      taskExecutionEngine: taskExecutionEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander,
    });

    controller.request('task-list-1', 'gate-approved:production_plan');
    await vi.waitFor(() => expect(runCommander).toHaveBeenCalledOnce());

    expect(taskExecutionEngine.claimCommanderContinuation).toHaveBeenCalledWith({
      taskListId: 'task-list-1',
      taskId: 'task-style-1',
      claimKey: 'task-style-1:style_exploration:0',
      claimOwnerId: expect.any(String),
      expectedRowVersion: 4,
    });
    expect(buildPersistentTaskListContext).toHaveBeenCalledWith(
      expect.anything(),
      'canvas-1',
      'session-1',
    );
    expect(runCommander).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultCanvasId: 'canvas-1',
        authorizedCanvasIds: ['canvas-1'],
        sessionId: 'session-1',
        selectedNodes: [],
        promptGuides: [],
        permissionMode: 'auto',
        resourceBudget: { maxTokens: 10_000 },
        continuationOfRunId: 'run-root',
        contextWindowTokens: 120_000,
        maxOutputTokens: 4_096,
      }),
    );
    expect(taskExecutionEngine.finishCommanderContinuationClaim).toHaveBeenCalledWith({
      taskListId: 'task-list-1',
      claimKey: 'task-style-1:style_exploration:0',
      claimOwnerId: expect.any(String),
      expectedRowVersion: 4,
      outcome: 'completed',
      runId: 'run-continuation-1',
    });
  });

  it('records a failed claim when Commander ends without completing the durable task', async () => {
    const readyRun = {
      id: 'task-list-1',
      taskListType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      metadata: { commanderSessionId: 'session-1' },
      rowVersion: 4,
      currentTaskId: 'task-style-1',
    };
    const task = {
      id: 'task-style-1',
      taskListId: 'task-list-1',
      taskId: 'style-audition',
      status: 'ready',
      input: { executionMode: 'external', taskRole: 'style_audition' },
    };
    const taskExecutionEngine = {
      waitForAutoPump: vi.fn(async () => undefined),
      get: vi.fn(() => readyRun),
      getTasks: vi.fn(() => [task]),
      claimCommanderContinuation: vi.fn(() => ({
        ok: true,
        run: { ...readyRun, rowVersion: 5 },
        task,
        continuation: {
          version: 1,
          sessionId: 'session-1',
          provider: {
            id: 'openai',
            name: 'OpenAI',
            baseUrl: 'https://api.openai.com/v1',
            model: 'gpt-5.6-sol',
            protocol: 'openai-responses',
            authStyle: 'bearer',
          },
          permissionMode: 'normal',
        },
      })),
      finishCommanderContinuationClaim: vi.fn(() => true),
      list: vi.fn(() => []),
      getLatestVisualAudition: vi.fn(),
    };
    buildPersistentTaskListContext.mockReturnValue({
      taskListToolPolicy: { taskListId: 'task-list-1', phase: 'style_exploration' },
    });
    const controller = createCommanderTaskContinuationController({
      taskExecutionEngine: taskExecutionEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander: vi.fn(async () => ({ runId: 'run-failed', succeeded: false })),
    });

    controller.request('task-list-1', 'application-recovery');
    await vi.waitFor(() =>
      expect(taskExecutionEngine.finishCommanderContinuationClaim).toHaveBeenCalledOnce(),
    );

    expect(taskExecutionEngine.finishCommanderContinuationClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        taskListId: 'task-list-1',
        claimKey: 'task-style-1:style_exploration:0',
        outcome: 'failed',
        reason: expect.stringContaining('failed'),
      }),
    );
  });

  it('continues every persisted task beyond the former fixed chain limit', async () => {
    const taskCount = 57;
    let currentTaskIndex = 0;
    const taskExecutionEngine = {
      waitForAutoPump: vi.fn(async () => undefined),
      get: vi.fn(() => {
        if (currentTaskIndex === taskCount) {
          return {
            id: 'task-list-1',
            taskListType: 'movie.production.v2',
            entityType: 'canvas',
            entityId: 'canvas-1',
            status: 'completed',
            metadata: { commanderSessionId: 'session-1' },
            totalTasks: taskCount,
          };
        }
        return {
          id: 'task-list-1',
          taskListType: 'movie.production.v2',
          entityType: 'canvas',
          entityId: 'canvas-1',
          status: 'ready',
          metadata: { commanderSessionId: 'session-1' },
          rowVersion: currentTaskIndex,
          totalTasks: taskCount,
          currentTaskId: `task-${currentTaskIndex}`,
        };
      }),
      getTasks: vi.fn(() =>
        currentTaskIndex === taskCount
          ? []
          : [
              {
                id: `task-${currentTaskIndex}`,
                taskListId: 'task-list-1',
                taskId: `task-${currentTaskIndex}`,
                status: 'ready',
                input: { executionMode: 'external', taskRole: 'production_media' },
              },
            ],
      ),
      claimCommanderContinuation: vi.fn(() => ({
        ok: true,
        continuation: {
          version: 1,
          sessionId: 'session-1',
          provider: { id: 'openai' },
          permissionMode: 'normal',
        },
      })),
      finishCommanderContinuationClaim: vi.fn(() => true),
      list: vi.fn(() => []),
      getLatestVisualAudition: vi.fn(),
    };
    buildPersistentTaskListContext.mockReturnValue({
      taskListToolPolicy: { taskListId: 'task-list-1', phase: 'preproduction' },
    });
    const runCommander = vi.fn(async () => {
      currentTaskIndex += 1;
      return { runId: `run-${currentTaskIndex}`, succeeded: true };
    });
    const controller = createCommanderTaskContinuationController({
      taskExecutionEngine: taskExecutionEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander,
    });

    controller.request('task-list-1', 'large-production-graph');
    await vi.waitFor(() => expect(runCommander).toHaveBeenCalledTimes(taskCount));

    expect(taskExecutionEngine.finishCommanderContinuationClaim).toHaveBeenCalledTimes(taskCount);
  });

  it('recovers and grades a durable pending preview before Commander continues', async () => {
    const readyRun = {
      id: 'task-list-1',
      taskListType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      metadata: { commanderSessionId: 'session-1' },
      rowVersion: 4,
      currentTaskId: 'task-style-1',
    };
    const task = {
      id: 'task-style-1',
      taskListId: 'task-list-1',
      taskId: 'style-audition',
      status: 'ready',
      input: { executionMode: 'external', taskRole: 'style_audition' },
    };
    const taskExecutionEngine = {
      waitForAutoPump: vi.fn(async () => undefined),
      get: vi
        .fn()
        .mockReturnValueOnce(readyRun)
        .mockReturnValueOnce({
          ...readyRun,
          status: 'awaiting_approval',
          currentGate: 'visual_constitution',
        }),
      getTasks: vi.fn(() => [task]),
      getLatestVisualAudition: vi.fn(() => ({
        content: {
          status: 'evaluation_pending',
          candidates: [
            {
              status: 'evaluation_pending',
              attempts: [{ status: 'evaluation_pending', assetHash: 'asset-1', grade: undefined }],
            },
          ],
        },
      })),
      claimCommanderContinuation: vi.fn(() => ({
        ok: true,
        run: { ...readyRun, rowVersion: 5 },
        task,
        continuation: {
          version: 1,
          sessionId: 'session-1',
          provider: { id: 'openai' },
          permissionMode: 'auto',
        },
      })),
      finishCommanderContinuationClaim: vi.fn(() => true),
      list: vi.fn(() => [readyRun]),
    };
    buildPersistentTaskListContext.mockReturnValue({
      taskListToolPolicy: { taskListId: 'task-list-1', phase: 'style_exploration' },
    });
    const evaluatePendingVisualAudition = vi.fn(async () => 'commander_required' as const);
    const runCommander = vi.fn(async () => ({ runId: 'run-visual-1', succeeded: true }));
    const controller = createCommanderTaskContinuationController({
      taskExecutionEngine: taskExecutionEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander,
      evaluatePendingVisualAudition,
    });

    controller.recoverPending();
    await vi.waitFor(() => expect(runCommander).toHaveBeenCalledOnce());

    expect(evaluatePendingVisualAudition).toHaveBeenCalledWith('task-list-1', 'canvas-1');
    expect(evaluatePendingVisualAudition.mock.invocationCallOrder[0]).toBeLessThan(
      taskExecutionEngine.claimCommanderContinuation.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('continues the same queued Task List after Commander yields a new evaluation boundary', async () => {
    const readyRun = {
      id: 'task-list-1',
      taskListType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      metadata: { commanderSessionId: 'session-1' },
      rowVersion: 4,
      currentTaskId: 'task-style-1',
    };
    const task = {
      id: 'task-style-1',
      taskListId: 'task-list-1',
      taskId: 'style-audition',
      status: 'ready',
      input: { executionMode: 'external', taskRole: 'style_audition' },
    };
    const taskExecutionEngine = {
      waitForAutoPump: vi.fn(async () => undefined),
      get: vi.fn(() => readyRun),
      getTasks: vi.fn(() => [task]),
      getLatestVisualAudition: vi.fn(() => ({
        content: {
          status: 'evaluation_pending',
          candidates: [
            {
              status: 'evaluation_pending',
              attempts: [{ status: 'evaluation_pending', assetHash: 'asset-1', grade: undefined }],
            },
          ],
        },
      })),
      claimCommanderContinuation: vi.fn(() => ({
        ok: true,
        run: { ...readyRun, rowVersion: 5 },
        task,
        continuation: {
          version: 1,
          sessionId: 'session-1',
          provider: { id: 'openai' },
          permissionMode: 'auto',
        },
      })),
      finishCommanderContinuationClaim: vi.fn(() => true),
      list: vi.fn(() => []),
    };
    buildPersistentTaskListContext.mockReturnValue({
      taskListToolPolicy: { taskListId: 'task-list-1', phase: 'style_exploration' },
    });
    const evaluatePendingVisualAudition = vi
      .fn()
      .mockResolvedValueOnce('idle')
      .mockResolvedValueOnce('complete');
    const runCommander = vi.fn(async () => ({ runId: 'run-visual-2', succeeded: true }));
    const controller = createCommanderTaskContinuationController({
      taskExecutionEngine: taskExecutionEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander,
      evaluatePendingVisualAudition,
    });

    controller.request('task-list-1', 'style-audition-evaluation');
    await vi.waitFor(() => expect(evaluatePendingVisualAudition).toHaveBeenCalledTimes(2));

    expect(runCommander).toHaveBeenCalledOnce();
    expect(taskExecutionEngine.finishCommanderContinuationClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'failed',
        reason: expect.stringContaining('evaluation boundary'),
      }),
    );
  });

  it('schedules only the pending visual evaluation for an idle canvas', async () => {
    const readyRun = {
      id: 'task-list-1',
      taskListType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      metadata: { commanderSessionId: 'session-1' },
      currentTaskId: 'task-style-1',
    };
    const evaluatePendingVisualAudition = vi.fn(async () => 'complete' as const);
    const taskExecutionEngine = {
      waitForAutoPump: vi.fn(async () => undefined),
      get: vi.fn(() => readyRun),
      getTasks: vi.fn(() => []),
      getLatestVisualAudition: vi.fn(() => ({
        content: {
          status: 'evaluation_pending',
          candidates: [
            {
              status: 'evaluation_pending',
              attempts: [{ status: 'evaluation_pending', assetHash: 'asset-1', grade: undefined }],
            },
          ],
        },
      })),
      list: vi.fn(() => [readyRun]),
    };
    const controller = createCommanderTaskContinuationController({
      taskExecutionEngine: taskExecutionEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander: vi.fn(async () => ({ runId: 'run-recovery-1', succeeded: true })),
      evaluatePendingVisualAudition,
    });

    controller.recoverPendingVisualEvaluations('canvas-1');
    await vi.waitFor(() => expect(evaluatePendingVisualAudition).toHaveBeenCalledOnce());
    expect(evaluatePendingVisualAudition).toHaveBeenCalledWith('task-list-1', 'canvas-1');
  });

  it('grades durable production media after Commander yields without starting another run', async () => {
    const readyRun = {
      id: 'task-list-1',
      taskListType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      metadata: { commanderSessionId: 'session-1' },
      rowVersion: 4,
      currentTaskId: 'task-media-1',
    };
    const completedRun = { ...readyRun, status: 'completed', currentTaskId: undefined };
    const taskExecutionEngine = {
      waitForAutoPump: vi.fn(async () => undefined),
      get: vi.fn().mockReturnValueOnce(readyRun).mockReturnValueOnce(completedRun),
      getTasks: vi.fn(() => []),
      getLatestVisualAudition: vi.fn(),
      list: vi.fn(() => []),
    };
    const evaluatePendingProductionMedia = vi.fn(async () => 'progressed' as const);
    const runCommander = vi.fn(async () => ({ runId: 'run-media-1', succeeded: true }));
    const controller = createCommanderTaskContinuationController({
      taskExecutionEngine: taskExecutionEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander,
      evaluatePendingProductionMedia,
    });

    controller.request('task-list-1', 'production-media-evaluation-pending');
    await vi.waitFor(() => expect(evaluatePendingProductionMedia).toHaveBeenCalledOnce());

    expect(evaluatePendingProductionMedia).toHaveBeenCalledWith('task-list-1', 'canvas-1');
    expect(runCommander).not.toHaveBeenCalled();
  });

  it('schedules only Task Lists with durable production media awaiting evaluation', async () => {
    const readyRun = {
      id: 'task-list-1',
      taskListType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      metadata: { commanderSessionId: 'session-1' },
      rowVersion: 4,
      currentTaskId: 'task-media-1',
    };
    const evaluatePendingProductionMedia = vi.fn(async () => 'pending' as const);
    const taskExecutionEngine = {
      waitForAutoPump: vi.fn(async () => undefined),
      get: vi.fn(() => readyRun),
      getTasks: vi.fn(() => []),
      getLatestVisualAudition: vi.fn(),
      list: vi.fn(() => [readyRun]),
    };
    const db = {
      repos: {
        taskLists: {
          listProductionMediaAttempts: vi.fn(() => [{ status: 'asset_ready' }]),
        },
      },
    };
    const controller = createCommanderTaskContinuationController({
      taskExecutionEngine: taskExecutionEngine as never,
      db: db as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander: vi.fn(async () => ({ runId: 'run-media-2', succeeded: true })),
      evaluatePendingProductionMedia,
    });

    controller.recoverPendingMediaEvaluations('canvas-1');
    await vi.waitFor(() => expect(evaluatePendingProductionMedia).toHaveBeenCalledOnce());

    expect(db.repos.taskLists.listProductionMediaAttempts).toHaveBeenCalledWith('task-list-1');
  });
});
