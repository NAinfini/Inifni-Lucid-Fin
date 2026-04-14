import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkflowHandlers } from './workflow.handlers.js';

const logger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: logger,
  debug: logger.debug,
  info: logger.info,
  warn: logger.warn,
  error: logger.error,
  fatal: logger.fatal,
}));

describe('registerWorkflowHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = new Map();
  });

  it('logs workflow lifecycle control requests with structured workflow context', async () => {
    const workflowEngine = {
      list: vi.fn(() => [{ id: 'wf-1', status: 'ready' }]),
      get: vi.fn((id: string) => (id === 'wf-1' ? { id: 'wf-1', status: 'ready' } : undefined)),
      getStages: vi.fn(() => [{ id: 'stage-1' }]),
      getTasks: vi.fn(() => [{ id: 'task-1' }]),
      start: vi.fn(() => 'wf-1'),
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      retryTask: vi.fn(async () => undefined),
      retryStage: vi.fn(async () => undefined),
      retryWorkflow: vi.fn(async () => undefined),
    };

    registerWorkflowHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      workflowEngine as never,
    );

    const start = handlers.get('workflow:start');
    const get = handlers.get('workflow:get');
    const getStages = handlers.get('workflow:getStages');
    const getTasks = handlers.get('workflow:getTasks');
    const pause = handlers.get('workflow:pause');
    const resume = handlers.get('workflow:resume');
    const cancel = handlers.get('workflow:cancel');

    await expect(start?.({}, {
      workflowType: 'storyboard.generate',
      entityType: 'scene',
      entityId: 'scene-1',
      triggerSource: 'user',
    })).resolves.toEqual({ workflowRunId: 'wf-1' });

    await expect(get?.({}, { id: 'wf-1' })).resolves.toEqual({ id: 'wf-1', status: 'ready' });
    await expect(getStages?.({}, { workflowRunId: 'wf-1' })).resolves.toEqual([{ id: 'stage-1' }]);
    await expect(getTasks?.({}, { workflowRunId: 'wf-1' })).resolves.toEqual([{ id: 'task-1' }]);
    await pause?.({}, { id: 'wf-1' });
    await resume?.({}, { id: 'wf-1' });
    await cancel?.({}, { id: 'wf-1' });

    expect(logger.info).toHaveBeenCalledWith(
      'Workflow start requested',
      expect.objectContaining({
        category: 'workflow',
        workflowType: 'storyboard.generate',
        entityType: 'scene',
        entityId: 'scene-1',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow started',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'wf-1',
        workflowType: 'storyboard.generate',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow pause requested',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'wf-1',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow resume requested',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'wf-1',
      }),
    );
    expect(logger.info).toHaveBeenCalledWith(
      'Workflow cancel requested',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'wf-1',
      }),
    );
  });

  it('logs a structured error when workflow:get misses', async () => {
    registerWorkflowHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      {
        list: vi.fn(),
        get: vi.fn(() => undefined),
        getStages: vi.fn(),
        getTasks: vi.fn(),
        start: vi.fn(),
        pause: vi.fn(),
        resume: vi.fn(),
        cancel: vi.fn(),
        retryTask: vi.fn(),
        retryStage: vi.fn(),
        retryWorkflow: vi.fn(),
      } as never,
    );

    const get = handlers.get('workflow:get');
    await expect(get?.({}, { id: 'missing-run' })).rejects.toThrow('Workflow "missing-run" not found');

    expect(logger.error).toHaveBeenCalledWith(
      'Workflow not found',
      expect.objectContaining({
        category: 'workflow',
        workflowRunId: 'missing-run',
      }),
    );
  });
});
