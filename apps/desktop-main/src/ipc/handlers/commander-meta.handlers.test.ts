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

import { runningSessions } from './commander-registry.js';
import { registerCommanderMetaHandlers } from './commander-meta.handlers.js';

function runningSession(runId: string, orchestrator?: Record<string, unknown>) {
  return {
    aborted: false,
    sessionId: 'session-1',
    defaultCanvasId: 'canvas-1',
    authorizedCanvasIds: ['canvas-1'],
    runId,
    lastActivity: Date.now(),
    ...(orchestrator ? { orchestrator: orchestrator as never } : {}),
  };
}

function durableEngine(
  answerAskUserDecisionFromUser: ReturnType<typeof vi.fn>,
  hasPendingDecision = true,
) {
  return {
    listPendingDecisions: vi.fn(() =>
      hasPendingDecision
        ? [{ questionId: 'question-1', canvasId: 'canvas-1', taskListId: 'task-list-1' }]
        : [],
    ),
    get: vi.fn(() => ({ metadata: { commanderSessionId: 'session-1' } })),
    answerAskUserDecisionFromUser,
  } as never;
}

describe('registerCommanderMetaHandlers', () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;

  beforeEach(() => {
    vi.clearAllMocks();
    runningSessions.clear();
    handlers = new Map();
  });

  it('leaves Run lifecycle controls to the unified dispatcher', () => {
    registerCommanderMetaHandlers({
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never);

    expect(handlers.has('commander:cancel')).toBe(false);
    expect(handlers.has('commander:cancel-step')).toBe(false);
    expect(handlers.has('commander:inject-message')).toBe(false);
  });

  it('waits for cold recovery before delivering decisions, answers, and compaction', async () => {
    let release!: () => void;
    const recoveryReady = new Promise<void>((resolve) => { release = resolve; });
    const confirmTool = vi.fn(() => true);
    runningSessions.set('run-1', runningSession('run-1', { confirmTool }));
    registerCommanderMetaHandlers({
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never, { taskExecutionEngine: durableEngine(vi.fn(), false), recoveryReady });

    const pending = handlers.get('commander:tool:decision')?.({}, {
      sessionId: 'session-1', runId: 'run-1', toolCallId: 'call-1', approved: true,
    });
    await Promise.resolve();
    expect(confirmTool).not.toHaveBeenCalled();
    release();
    await pending;
    expect(confirmTool).toHaveBeenCalledOnce();
  });

  it('returns explicit ACKs for active and missing tool sessions', async () => {
    registerCommanderMetaHandlers({
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never);

    const confirmTool = vi.fn(() => true);
    const answerQuestion = vi.fn(() => true);
    const hasPendingQuestion = vi.fn(() => true);
    runningSessions.set(
      'run-1',
      runningSession('run-1', {
        confirmTool,
        answerQuestion,
        hasPendingQuestion,
      }),
    );

    const decide = handlers.get('commander:tool:decision');
    const answer = handlers.get('commander:tool:answer');

    await expect(
      decide?.(
        {},
        { sessionId: 'session-1', runId: 'run-1', toolCallId: 'call-1', approved: true },
      ),
    ).resolves.toEqual({ accepted: true, delivery: 'active_run' });
    await expect(
      answer?.({}, { sessionId: 'session-1', runId: 'run-1', toolCallId: 'call-2', answer: 'yes' }),
    ).resolves.toEqual({ accepted: true, delivery: 'active_run' });

    expect(confirmTool).toHaveBeenCalledWith('call-1', true);
    expect(answerQuestion).toHaveBeenCalledWith('call-2', 'yes');
    expect(scopedLogger.info).toHaveBeenCalledWith(
      'Commander tool decision received',
      expect.objectContaining({
        sessionId: 'session-1',
        toolCallId: 'call-1',
        approved: true,
      }),
    );
    expect(scopedLogger.info).toHaveBeenCalledWith(
      'Commander tool answer received',
      expect.objectContaining({
        sessionId: 'session-1',
        toolCallId: 'call-2',
      }),
    );

    runningSessions.clear();

    await expect(
      decide?.(
        {},
        { sessionId: 'session-2', runId: 'run-2', toolCallId: 'call-3', approved: false },
      ),
    ).resolves.toEqual({ accepted: false, code: 'no_active_session' });
    await expect(
      answer?.({}, { sessionId: 'session-2', runId: 'run-2', toolCallId: 'call-4', answer: 'no' }),
    ).resolves.toEqual({ accepted: false, code: 'no_active_session' });

    expect(scopedLogger.warn).toHaveBeenCalledWith(
      'Commander tool decision received with no active session',
      expect.objectContaining({
        sessionId: 'session-2',
        toolCallId: 'call-3',
      }),
    );
    expect(scopedLogger.warn).toHaveBeenCalledWith(
      'Commander tool answer received with no active session',
      expect.objectContaining({
        sessionId: 'session-2',
        toolCallId: 'call-4',
      }),
    );
  });

  it('rejects stale and non-pending tool calls with explicit ACKs', async () => {
    registerCommanderMetaHandlers({
      handle(channel: string, handler: (...args: unknown[]) => unknown) {
        handlers.set(channel, handler);
      },
    } as never);
    const confirmTool = vi.fn(() => false);
    const answerQuestion = vi.fn(() => false);
    const hasPendingQuestion = vi.fn(() => false);
    runningSessions.set(
      'run-current',
      runningSession('run-current', { confirmTool, answerQuestion, hasPendingQuestion }),
    );

    await expect(
      handlers.get('commander:tool:decision')?.(
        {},
        { sessionId: 'session-1', runId: 'run-stale', toolCallId: 'call-1', approved: true },
      ),
    ).resolves.toEqual({ accepted: false, code: 'stale_run' });
    await expect(
      handlers.get('commander:tool:decision')?.(
        {},
        { sessionId: 'session-1', runId: 'run-current', toolCallId: 'call-1', approved: true },
      ),
    ).resolves.toEqual({ accepted: false, code: 'not_pending' });
    await expect(
      handlers.get('commander:tool:answer')?.(
        {},
        { sessionId: 'session-1', runId: 'run-current', toolCallId: 'call-2', answer: 'yes' },
      ),
    ).resolves.toEqual({ accepted: false, code: 'not_pending' });
    expect(confirmTool).toHaveBeenCalledTimes(1);
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('ACKs a persisted Task List answer only after scheduling its continuation', async () => {
    const answerAskUserDecisionFromUser = vi.fn(() => ({
      answered: true,
      decision: {
        id: 'decision-1',
        taskListId: 'task-list-1',
        status: 'answered',
      },
    }));
    const requestTaskContinuation = vi.fn();
    registerCommanderMetaHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      {
        taskExecutionEngine: durableEngine(answerAskUserDecisionFromUser),
        requestTaskContinuation,
      },
    );

    await expect(
      handlers.get('commander:tool:answer')?.(
        {},
        { sessionId: 'session-1', runId: 'run-1', toolCallId: 'question-1', answer: 'Analog' },
      ),
    ).resolves.toEqual({
      accepted: true,
      delivery: 'task_list_continuation',
      taskListId: 'task-list-1',
    });

    expect(answerAskUserDecisionFromUser).toHaveBeenCalledWith({
      canvasId: 'canvas-1',
      questionId: 'question-1',
      answer: 'Analog',
      status: 'answered',
    });
    expect(requestTaskContinuation).toHaveBeenCalledWith(
      'task-list-1',
      'durable-question-answered',
    );
  });

  it('does not persist a durable answer when the active question is no longer pending', async () => {
    const answerAskUserDecisionFromUser = vi.fn();
    const answerQuestion = vi.fn(() => false);
    const hasPendingQuestion = vi.fn(() => false);
    runningSessions.set('run-1', runningSession('run-1', { answerQuestion, hasPendingQuestion }));
    registerCommanderMetaHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      { taskExecutionEngine: durableEngine(answerAskUserDecisionFromUser, false) },
    );

    await expect(
      handlers.get('commander:tool:answer')?.(
        {},
        { sessionId: 'session-1', runId: 'run-1', toolCallId: 'question-1', answer: 'Analog' },
      ),
    ).resolves.toEqual({ accepted: false, code: 'not_pending' });

    expect(answerAskUserDecisionFromUser).not.toHaveBeenCalled();
    expect(answerQuestion).not.toHaveBeenCalled();
  });

  it('does not consume a durable answer when no run or continuation can receive it', async () => {
    const answerAskUserDecisionFromUser = vi.fn();
    registerCommanderMetaHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      { taskExecutionEngine: durableEngine(answerAskUserDecisionFromUser) },
    );

    await expect(
      handlers.get('commander:tool:answer')?.(
        {},
        { sessionId: 'session-1', runId: 'run-1', toolCallId: 'question-1', answer: 'Analog' },
      ),
    ).resolves.toEqual({ accepted: false, code: 'no_active_session' });

    expect(answerAskUserDecisionFromUser).not.toHaveBeenCalled();
  });

  it('schedules Task List continuation when an active resolver no longer accepts a durable answer', async () => {
    const answerAskUserDecisionFromUser = vi.fn(() => ({
      answered: true,
      decision: {
        id: 'decision-1',
        taskListId: 'task-list-1',
        status: 'answered',
      },
    }));
    const requestTaskContinuation = vi.fn();
    const answerQuestion = vi.fn(() => false);
    const hasPendingQuestion = vi.fn(() => false);
    runningSessions.set('run-1', runningSession('run-1', { answerQuestion, hasPendingQuestion }));
    registerCommanderMetaHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      {
        taskExecutionEngine: durableEngine(answerAskUserDecisionFromUser),
        requestTaskContinuation,
      },
    );

    await expect(
      handlers.get('commander:tool:answer')?.(
        {},
        { sessionId: 'session-1', runId: 'run-1', toolCallId: 'question-1', answer: 'Analog' },
      ),
    ).resolves.toEqual({
      accepted: true,
      delivery: 'task_list_continuation',
      taskListId: 'task-list-1',
    });

    expect(answerQuestion).toHaveBeenCalledWith('question-1', 'Analog');
    expect(requestTaskContinuation).toHaveBeenCalledWith(
      'task-list-1',
      'durable-question-answered',
    );
  });

  it('returns already_resolved for a durable answer that was previously accepted', async () => {
    const answerAskUserDecisionFromUser = vi.fn(() => ({
      answered: false,
      decision: { id: 'decision-1', taskListId: 'task-list-1', status: 'answered' },
    }));
    registerCommanderMetaHandlers(
      {
        handle(channel: string, handler: (...args: unknown[]) => unknown) {
          handlers.set(channel, handler);
        },
      } as never,
      {
        taskExecutionEngine: durableEngine(answerAskUserDecisionFromUser),
        requestTaskContinuation: vi.fn(),
      },
    );

    await expect(
      handlers.get('commander:tool:answer')?.(
        {},
        { sessionId: 'session-1', runId: 'run-1', toolCallId: 'question-1', answer: 'Analog' },
      ),
    ).resolves.toEqual({ accepted: false, code: 'already_resolved' });
  });
});
