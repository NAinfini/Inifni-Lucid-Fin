import { beforeEach, describe, expect, it, vi } from 'vitest';

const scopedLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  default: {
    debug: scopedLogger.debug,
    info: scopedLogger.info,
    warn: scopedLogger.warn,
    error: scopedLogger.error,
    fatal: scopedLogger.fatal,
    scoped: vi.fn(() => scopedLogger),
  },
  debug: scopedLogger.debug,
  info: scopedLogger.info,
  warn: scopedLogger.warn,
  error: scopedLogger.error,
  fatal: scopedLogger.fatal,
}));

import { runningSessions, setLastToolRegistry } from './commander-registry.js';
import { registerCommanderMetaHandlers } from './commander-meta.handlers.js';

describe('registerCommanderMetaHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    runningSessions.clear();
    handlers = new Map();
  });

  it('logs and marks an active session as aborted when cancel is requested', async () => {
    registerCommanderMetaHandlers({
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never);

    runningSessions.set('canvas-1', { aborted: false, canvasId: 'canvas-1' });
    const cancel = handlers.get('commander:cancel');

    await expect(cancel?.({}, { canvasId: 'canvas-1' })).resolves.toBeUndefined();

    expect(runningSessions.has('canvas-1')).toBe(false);
    expect(scopedLogger.info).toHaveBeenCalledWith(
      'Commander cancel requested',
      expect.objectContaining({
        canvasId: 'canvas-1',
        hasSession: true,
      }),
    );
  });

  it('warns and throws when inject-message targets a missing session', async () => {
    registerCommanderMetaHandlers({
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never);

    const inject = handlers.get('commander:inject-message');

    await expect(inject?.({}, { canvasId: 'canvas-1', message: 'continue' })).rejects.toThrow(
      'Commander has no active session',
    );

    expect(scopedLogger.warn).toHaveBeenCalledWith(
      'Commander message injection requested with no active session',
      expect.objectContaining({
        canvasId: 'canvas-1',
      }),
    );
  });

  it('logs tool decisions and answers, warning when no active session is available', async () => {
    registerCommanderMetaHandlers({
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never);

    const confirmTool = vi.fn();
    const answerQuestion = vi.fn();
    runningSessions.set('canvas-1', {
      aborted: false,
      canvasId: 'canvas-1',
      orchestrator: {
        confirmTool,
        answerQuestion,
      } as never,
    });

    const decide = handlers.get('commander:tool:decision');
    const answer = handlers.get('commander:tool:answer');

    await expect(
      decide?.({}, { canvasId: 'canvas-1', toolCallId: 'call-1', approved: true }),
    ).resolves.toBeUndefined();
    await expect(
      answer?.({}, { canvasId: 'canvas-1', toolCallId: 'call-2', answer: 'yes' }),
    ).resolves.toBeUndefined();

    expect(confirmTool).toHaveBeenCalledWith('call-1', true);
    expect(answerQuestion).toHaveBeenCalledWith('call-2', 'yes');
    expect(scopedLogger.info).toHaveBeenCalledWith(
      'Commander tool decision received',
      expect.objectContaining({
        canvasId: 'canvas-1',
        toolCallId: 'call-1',
        approved: true,
      }),
    );
    expect(scopedLogger.info).toHaveBeenCalledWith(
      'Commander tool answer received',
      expect.objectContaining({
        canvasId: 'canvas-1',
        toolCallId: 'call-2',
      }),
    );

    runningSessions.clear();

    await expect(
      decide?.({}, { canvasId: 'canvas-2', toolCallId: 'call-3', approved: false }),
    ).resolves.toBeUndefined();
    await expect(
      answer?.({}, { canvasId: 'canvas-2', toolCallId: 'call-4', answer: 'no' }),
    ).resolves.toBeUndefined();

    expect(scopedLogger.warn).toHaveBeenCalledWith(
      'Commander tool decision received with no active session',
      expect.objectContaining({
        canvasId: 'canvas-2',
        toolCallId: 'call-3',
      }),
    );
    expect(scopedLogger.warn).toHaveBeenCalledWith(
      'Commander tool answer received with no active session',
      expect.objectContaining({
        canvasId: 'canvas-2',
        toolCallId: 'call-4',
      }),
    );
  });

  it('returns tool list and search results with request logs', async () => {
    registerCommanderMetaHandlers({
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never);

    const tools = [
      { name: 'canvas.createNodes', description: 'Add node', tags: ['canvas'], tier: 1 },
      { name: 'guide.get', description: 'Fetch guide', tags: ['guide'], tier: 0 },
    ];
    setLastToolRegistry({
      list: () => tools,
    } as never);

    const list = handlers.get('commander:tool-list');
    const search = handlers.get('commander:tool-search');

    await expect(list?.({})).resolves.toEqual(tools);
    await expect(search?.({}, { query: 'guide' })).resolves.toEqual([
      { name: 'guide.get', description: 'Fetch guide' },
    ]);

    expect(scopedLogger.info).toHaveBeenCalledWith(
      'Commander tool list requested',
      expect.objectContaining({
        toolCount: 2,
      }),
    );
    expect(scopedLogger.info).toHaveBeenCalledWith(
      'Commander tool search requested',
      expect.objectContaining({
        query: 'guide',
        resultCount: 1,
      }),
    );
  });

  it('persists a workflow-bound answer without an active Commander and marks recovery required', async () => {
    const answerAskUserDecisionFromUser = vi.fn(() => ({
      answered: true,
      decision: {
        id: 'decision-1',
        workflowRunId: 'workflow-1',
        status: 'recovery_required',
      },
    }));
    registerCommanderMetaHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      { workflowEngine: { answerAskUserDecisionFromUser } as never },
    );

    await expect(
      handlers.get('commander:tool:answer')?.(
        {},
        { canvasId: 'canvas-1', toolCallId: 'question-1', answer: 'Analog' },
      ),
    ).resolves.toBeUndefined();

    expect(answerAskUserDecisionFromUser).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      questionId: 'question-1',
      answer: 'Analog',
      status: 'recovery_required',
    });
    expect(scopedLogger.warn).toHaveBeenCalledWith(
      'Workflow decision answer persisted without an active Commander continuation',
      expect.objectContaining({
        canvasId: 'canvas-1',
        workflowRunId: 'workflow-1',
        questionId: 'question-1',
        recoveryRequired: true,
      }),
    );
  });
});
