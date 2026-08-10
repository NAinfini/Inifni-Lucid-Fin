import { beforeEach, describe, expect, it, vi } from 'vitest';

const { buildPersistentWorkflowContext } = vi.hoisted(() => ({
  buildPersistentWorkflowContext: vi.fn(),
}));
vi.mock('./commander-context.service.js', () => ({ buildPersistentWorkflowContext }));

import {
  buildWorkflowCommanderContinuation,
  createCommanderWorkflowContinuationController,
} from './commander-workflow-continuation.js';

describe('Commander persistent-workflow continuation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists only the keyless, bounded runtime fields', () => {
    const continuation = buildWorkflowCommanderContinuation({
      canvasId: 'canvas-1',
      sessionId: 'session-1',
      message: 'make a film',
      history: [],
      selectedNodeIds: [],
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
      defaultProviders: {
        image: 'image-provider',
        video: 'video-provider',
        secret: 'must-not-persist',
      },
    });

    expect(continuation).toMatchObject({
      version: 1,
      sessionId: 'session-1',
      permissionMode: 'auto',
      locale: 'zh-CN',
      provider: { id: 'openai', model: 'gpt-5.6-sol' },
      defaultProviders: { image: 'image-provider', video: 'video-provider' },
    });
    expect(JSON.stringify(continuation)).not.toContain('apiKey');
    expect(JSON.stringify(continuation)).not.toContain('private-guide');
    expect(JSON.stringify(continuation)).not.toContain('must-not-persist');
  });

  it('claims and runs one external task, then stops at the next human gate', async () => {
    const readyRun = {
      id: 'workflow-1',
      workflowType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
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
      workflowRunId: 'workflow-1',
      taskId: 'style-audition',
      status: 'ready',
      input: { executionMode: 'external', workflowTaskRole: 'style_audition' },
    };
    const workflowEngine = {
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
        },
      })),
      finishCommanderContinuationClaim: vi.fn(() => true),
      list: vi.fn(() => []),
    };
    buildPersistentWorkflowContext.mockReturnValue({
      workflowToolPolicy: {
        workflowRunId: 'workflow-1',
        phase: 'style_exploration',
      },
    });
    const runCommander = vi.fn(async () => true);
    const controller = createCommanderWorkflowContinuationController({
      workflowEngine: workflowEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander,
    });

    controller.request('workflow-1', 'gate-approved:production_plan');
    await vi.waitFor(() => expect(runCommander).toHaveBeenCalledOnce());

    expect(workflowEngine.claimCommanderContinuation).toHaveBeenCalledWith({
      workflowRunId: 'workflow-1',
      taskRunId: 'task-style-1',
      claimKey: 'task-style-1:style_exploration:0',
      claimOwnerId: expect.any(String),
      expectedRowVersion: 4,
    });
    expect(runCommander).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasId: 'canvas-1',
        sessionId: 'session-1',
        history: [],
        selectedNodeIds: [],
        promptGuides: [],
        permissionMode: 'auto',
      }),
    );
    expect(workflowEngine.finishCommanderContinuationClaim).toHaveBeenCalledWith({
      workflowRunId: 'workflow-1',
      claimKey: 'task-style-1:style_exploration:0',
      claimOwnerId: expect.any(String),
      expectedRowVersion: 4,
      outcome: 'completed',
    });
  });

  it('records a failed claim when Commander ends without completing the durable task', async () => {
    const readyRun = {
      id: 'workflow-1',
      workflowType: 'movie.production.v2',
      entityType: 'canvas',
      entityId: 'canvas-1',
      status: 'ready',
      rowVersion: 4,
      currentTaskId: 'task-style-1',
    };
    const task = {
      id: 'task-style-1',
      workflowRunId: 'workflow-1',
      taskId: 'style-audition',
      status: 'ready',
      input: { executionMode: 'external', workflowTaskRole: 'style_audition' },
    };
    const workflowEngine = {
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
    };
    buildPersistentWorkflowContext.mockReturnValue({
      workflowToolPolicy: { workflowRunId: 'workflow-1', phase: 'style_exploration' },
    });
    const controller = createCommanderWorkflowContinuationController({
      workflowEngine: workflowEngine as never,
      db: {} as never,
      canvasStore: { get: vi.fn(() => ({ id: 'canvas-1' })) } as never,
      isCanvasBusy: () => false,
      runCommander: vi.fn(async () => false),
    });

    controller.request('workflow-1', 'application-recovery');
    await vi.waitFor(() =>
      expect(workflowEngine.finishCommanderContinuationClaim).toHaveBeenCalledOnce(),
    );

    expect(workflowEngine.finishCommanderContinuationClaim).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'workflow-1',
        claimKey: 'task-style-1:style_exploration:0',
        outcome: 'failed',
        reason: expect.stringContaining('failed'),
      }),
    );
  });
});
